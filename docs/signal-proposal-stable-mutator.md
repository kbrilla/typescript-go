# TC39 Signals × `stable` / `mutator` / `invalidates`

**How TypeScript's new type modifiers provide perfect type-level semantics for reactive signals**

---

## 1. Executive Summary

The [TC39 Signals proposal](https://github.com/tc39/proposal-signals) introduces a standard reactive primitive for JavaScript. Signals have two fundamental operations: **reading** a value (pure, idempotent) and **writing** a value (mutation that invalidates cached reads). These operations map directly to TypeScript's new `stable` / `mutator` / `invalidates` type modifiers:

| Signal Operation | TypeScript Modifier | Meaning |
|-----------------|---------------------|---------|
| `.get()` | `stable` | Returns the same value on repeated calls — CFA can narrow and preserve the type |
| `.set(v)` | `mutator ... invalidates *` | Mutates state, invalidating all narrowed stable references on this receiver |

```ts
interface Signal<T> {
    stable get(): T;
    mutator set(value: T): void invalidates get;
}
```

With these annotations, TypeScript's Control Flow Analysis can **narrow signal values**, **preserve narrowing across repeated reads**, and **reset narrowing after mutations** — catching the most common class of bugs in reactive code at compile time, with zero runtime cost.

---

## 2. TC39 Signals Proposal Overview

### Status

- **Stage 1** at TC39 (as of 2025)
- Broad ecosystem support from Angular, Solid, Vue, Svelte, Preact, and others
- Champions: Daniel Ehrenberg (Bloomberg), Rob Eisenberg (Microsoft)

### Core API

The proposal defines two core signal types:

```ts
namespace Signal {
    class State<T> {
        constructor(initialValue: T, options?: SignalOptions<T>);
        get(): T;          // Read the current value
        set(value: T): void; // Write a new value
    }

    class Computed<T> {
        constructor(computation: () => T, options?: SignalOptions<T>);
        get(): T;          // Read the computed value (recomputes if dirty)
        // No set() — computed signals are derived, not writable
    }
}
```

### Key Properties

- **`.get()` is a pure read**: Calling `.get()` multiple times without an intervening `.set()` always returns the same value. This is the defining characteristic that makes it `stable`.
- **`.set()` is a mutation**: Calling `.set()` changes the signal's value, invalidating any cached reads. This is the defining characteristic that makes it a `mutator`.
- **Computed signals are read-only**: `Signal.Computed<T>` only exposes `.get()` — there is no way to mutate a computed signal directly.

### Framework Adoption

Every major frontend framework has converged on the signals pattern:

- **Angular** — `signal()`, `computed()`, `effect()` (shipped in v16+)
- **Solid** — `createSignal()`, `createMemo()`, `createEffect()`
- **Vue** — `ref()`, `computed()`, `watchEffect()`
- **Svelte 5** — `$state`, `$derived`, `$effect`
- **Preact** — `@preact/signals`: `signal()`, `computed()`, `effect()`

The TC39 proposal aims to unify these into a standard primitive.

---

## 3. Mapping Signals to `stable` / `mutator` / `invalidates`

### TC39 `Signal.State<T>`

```ts
interface State<T> {
    /**
     * Read the current value. Marked `stable` because repeated calls
     * without an intervening set() return the same value.
     */
    stable get(): T;

    /**
     * Write a new value. Marked `mutator` because it changes state.
     * `invalidates get` tells CFA that any narrowing derived from
     * get() must be reset after this call.
     */
    mutator set(value: T): void invalidates get;
}
```

### TC39 `Signal.Computed<T>`

```ts
interface Computed<T> {
    /**
     * Read the computed value. Stable because the same computation
     * with the same inputs always produces the same output.
     * No mutator methods exist — computed signals are inherently readonly.
     */
    stable get(): T;
}
```

### Why This Mapping Is Natural

The `stable` / `mutator` / `invalidates` system was designed for exactly this kind of pattern:

1. **`stable` captures idempotent reads.** `signal.get()` returns the same value if the signal hasn't been mutated. This is the semantic contract that `stable` encodes.

2. **`mutator` captures state changes.** `signal.set(v)` modifies the signal's internal state. This is the semantic contract that `mutator` encodes.

3. **`invalidates` connects mutations to reads.** After `signal.set(v)`, any previous narrowing of `signal.get()` is stale. The `invalidates get` clause tells CFA precisely which stable method's narrowing to reset.

---

## 4. Practical Examples — What This Enables

### 4a. Basic Narrowing with Signals

```ts
declare const count: Signal.State<number | undefined>;

const val = count.get();
if (val !== undefined) {
    // val is narrowed to `number` — standard CFA
    console.log(val + 1); // ✅ Works

    // Stable: calling .get() again preserves narrowing
    console.log(count.get() + 1); // ✅ CFA knows .get() returns same value

    // Mutator invalidates:
    count.set(42);
    console.log(count.get() + 1); // ✅ OK: post-call narrowing — count.get() is now `number`
}
```

> **Note:** Post-call narrowing (P3) narrows the stable reference to the type of the argument passed to the mutator. `set(42)` narrows `get()` to `number` because `42` is `number`, which is a subtype of `number | undefined`.

Without `stable`, the second `count.get()` call would return the full `number | undefined` type — TypeScript has no way to know that `.get()` returns the same value. Without `mutator invalidates`, the third `count.get()` call after `.set(42)` might *appear* narrowed when it shouldn't be.

### 4b. Computed Signals Preserve Narrowing

```ts
declare const user: Signal.Computed<User | null>;

if (user.get() !== null) {
    // user.get() is narrowed to `User` — and stays narrowed
    console.log(user.get().name); // ✅ Safe — stable means same value

    // No mutations possible on Computed — narrowing holds indefinitely
    doSomethingElse();
    console.log(user.get().email); // ✅ Still narrowed to `User`
}
```

Computed signals are the ideal case for `stable`: they have no mutator methods at all. Once narrowed, the narrowing persists until the end of the control flow scope.

### 4c. Angular Signals

Angular uses call-syntax signals rather than `.get()`:

```ts
// Angular's WritableSignal<T> with stable/mutator annotations
interface WritableSignal<T> {
    stable (): T; // Angular uses signal() call syntax
    mutator set(value: T): void invalidates *;
    mutator update(fn: (value: T) => T): void invalidates *;
    asReadonly(): Signal<T>;
}

interface Signal<T> {
    stable (): T; // Pure read, no mutation possible
}
```

Usage with Angular:

```ts
const name = signal<string | null>(null);

if (name() !== null) {
    console.log(name().toUpperCase()); // ✅ Narrowed to `string` — stable call

    name.set("Alice");
    console.log(name().toUpperCase()); // ❌ Error: name() is `string | null` again
}

const readonlyName: Signal<string | null> = name.asReadonly();
if (readonlyName() !== null) {
    console.log(readonlyName().length); // ✅ Narrowed, and no way to invalidate
}
```

### 4d. Cross-Receiver Independence

A mutation on one signal does not invalidate narrowing on a different signal:

```ts
declare const a: Signal.State<string | null>;
declare const b: Signal.State<number | null>;

if (a.get() !== null && b.get() !== null) {
    a.set("hello"); // Only invalidates a.get(), not b.get()
    console.log(b.get() + 1);     // ✅ Still narrowed — different receiver
    console.log(a.get().length);   // ❌ Error: a.get() is `string | null` again
}
```

This is sound because `a` and `b` are separate objects — mutating `a` has no effect on `b`'s state. The `invalidates` clause is scoped to the receiver, not global.

### 4e. Effects and Watchers

```ts
function effect(fn: () => void): void { /* ... */ }

effect(() => {
    const val = count.get(); // stable read
    if (val !== undefined) {
        console.log(val.toFixed(2)); // ✅ Narrowed to `number`
        // No mutations between reads — narrowing holds
        console.log(count.get().toFixed(4)); // ✅ Still narrowed
    }
});
```

Inside an effect callback, `stable` annotations let TypeScript narrow signal reads just like any other value. The effect body is analyzed with standard CFA — `stable` ensures that repeated reads are recognized as the same value.

### 4f. Signal-Based State Machines

```ts
type AppState =
    | { status: "loading" }
    | { status: "ready"; data: Data }
    | { status: "error"; error: Error };

declare const appState: Signal.State<AppState>;

const state = appState.get();
if (state.status === "ready") {
    console.log(state.data); // ✅ Narrowed via discriminated union

    // Re-reading preserves the discriminant narrowing
    console.log(appState.get().data); // ✅ Stable — same value, same narrowing

    appState.set({ status: "loading" });
    console.log(appState.get().data); // ❌ Error: property 'data' doesn't exist on { status: "loading" }
}
```

---

## 5. Framework Comparison Table

| Framework | Read Syntax | Write Syntax | `stable` Mapping | `mutator` Mapping |
|-----------|------------|--------------|-------------------|-------------------|
| **TC39 Signals** | `.get()` | `.set(v)` | `stable get(): T` | `mutator set(v: T): void invalidates get` |
| **Angular** | `signal()` | `.set(v)` / `.update(fn)` | `stable (): T` | `mutator set(v: T): void invalidates *` |
| **Solid** | `getter()` | `setter(v)` | `stable (): T` | `mutator (v: T): void invalidates *` |
| **Vue** | `ref.value` | `ref.value = v` | Property getter → `stable` | Property setter → `mutator invalidates *` |
| **Preact** | `signal.value` | `signal.value = v` | Property getter → `stable` | Property setter → `mutator invalidates *` |
| **Svelte 5** | `$state` | `$state = v` | Compiler transforms — no explicit annotation | Compiler transforms — no explicit annotation |
| **RxJS (BehaviorSubject)** | `.getValue()` | `.next(v)` | `stable getValue(): T` | `mutator next(v: T): void invalidates getValue` |

### Notes on Property-Based Signals (Vue, Preact)

Vue's `ref.value` and Preact's `signal.value` use property access rather than method calls. Since `stable` and `mutator` apply to methods, these frameworks would need a future extension or conventions for property accessors:

```ts
// Potential future syntax for property-level annotations
interface Ref<T> {
    stable get value(): T;
    mutator set value(v: T) invalidates value;
}
```

For now, Vue and Preact users can wrap access in methods to get the same CFA benefits.

---

## 6. Why This Matters

### Type Safety for Reactive Patterns

The single most common bug in signal-based code is **reading a stale value after mutation**:

```ts
// BUG: narrowing is silently wrong without stable/mutator
const user = signal<User | null>(null);

if (user.get() !== null) {
    user.set(null);
    // Without our feature: TypeScript thinks user.get() is still `User`
    // With our feature: TypeScript correctly resets to `User | null`
    user.get().name; // Our feature catches this ❌
}
```

Today, TypeScript treats every method call as potentially returning a new value — so **no narrowing is preserved across calls at all**. This is overly conservative for reads and overly permissive after mutations. The `stable` / `mutator` / `invalidates` system gives CFA the information it needs to be both precise and sound.

### Zero Runtime Cost

`stable`, `mutator`, and `invalidates` are **type-level annotations only**. They are completely erased at emit — no runtime wrapper, no proxy, no overhead. The emitted JavaScript is identical with or without annotations:

```ts
// TypeScript source
interface Signal<T> {
    stable get(): T;
    mutator set(value: T): void invalidates get;
}

// Emitted JavaScript: nothing — interfaces are erased entirely
```

### Framework-Agnostic

The feature works with **any** signal library. It doesn't require adopting TC39 Signals specifically. Any API that follows the read/write pattern can benefit:

- State management libraries (Redux stores, MobX observables)
- Database query caches (TanStack Query)
- Form state managers (React Hook Form, Formily)
- Custom domain-specific reactive primitives

### Gradual Adoption

Libraries can add `stable` / `mutator` / `invalidates` annotations incrementally:

1. **Unannotated code continues to work** — the feature is fully backward-compatible.
2. **Library authors add annotations to `.d.ts` files** — consumers get better CFA immediately.
3. **Application code doesn't need to change** — the benefits come from the library types.

### Future-Proof

When TC39 Signals ship natively in JavaScript engines, TypeScript's built-in `lib.d.ts` files can include `stable` / `mutator` / `invalidates` annotations on the standard `Signal` types. Every TypeScript user will get improved type checking for signals automatically — without any code changes.

---

## 7. Future: Key-Aware Stable

A future phase of the feature could introduce **key-aware invalidation**, enabling finer-grained CFA for keyed data structures:

```ts
interface SignalMap<K, V> {
    stable get(key: K): V | undefined;
    mutator set(key: K, value: V): void invalidates get;
    mutator delete(key: K): boolean invalidates get;
    stable has(key: K): boolean;
    mutator clear(): void invalidates *;
}
```

With key-aware invalidation, CFA could track that `map.set("x", 1)` only invalidates `map.get("x")`, not `map.get("y")`:

```ts
declare const m: SignalMap<string, number>;

if (m.get("x") !== undefined && m.get("y") !== undefined) {
    m.set("x", 42);
    console.log(m.get("y")! + 1); // ✅ Future: still narrowed — different key
    console.log(m.get("x")! + 1); // ❌ Future: invalidated — same key
}
```

This naturally extends to patterns like:
- **Reactive maps** (signal-based key-value stores)
- **Entity stores** (normalized state by ID)
- **Cache layers** (request-specific invalidation)

Key-aware invalidation is not part of the current implementation but is a natural extension of the `invalidates` mechanism.

---

## 8. Comparison with Alternative Approaches

### `readonly` Modifier

```ts
interface Signal<T> {
    readonly value: T; // Prevents assignment, but...
}
```

`readonly` prevents `signal.value = x` but cannot express that **calling a method** doesn't change state. It's a property-level constraint, not a behavioral one. It also can't express the relationship between a read method and a write method — there's no way to say "calling `.set()` invalidates the type of `.get()`."

### `@pure` / `@nosideeffects` JSDoc Annotations

```ts
interface Signal<T> {
    /** @pure */
    get(): T;
}
```

JSDoc annotations like `@pure` are:
- **Not type-checked** — TypeScript ignores them for CFA purposes
- **Not machine-readable** — no tooling enforces them
- **Lost at emit** — they're comments, not types
- **Ambiguous** — "pure" means different things to different people

`stable` is a first-class type modifier with precise semantics enforced by CFA.

### `as const` Assertions

```ts
const value = signal.get() as const;
```

`as const` narrows to literal types but doesn't establish any relationship between calls. It can't express that two calls to `.get()` return the same value, or that `.set()` invalidates `.get()`.

### Full Effect Systems (Koka, Eff)

Languages like Koka track effects at every call site:

```
fun get() : <read> T
fun set(v: T) : <write> ()
```

Full effect tracking is powerful but fundamentally at odds with TypeScript's design goals:
- **TypeScript is a superset of JavaScript** — it can't add syntax that changes runtime semantics
- **Gradual typing** — full effect systems require annotating everything; TypeScript allows partial annotation
- **Ecosystem compatibility** — full effect systems break interop with unannotated JavaScript

`stable` / `mutator` / `invalidates` provides the **subset of effect tracking that matters for CFA** without the weight of a full effect system. It's precisely scoped to the problem it solves: narrowing preservation across method calls.

### Branded Types / Phantom Types

```ts
type StableResult<T> = T & { __brand: "stable" };
```

Branded types can simulate some of this behavior, but:
- They leak into the type at every usage site
- They can't integrate with CFA narrowing
- They require manual casting at read sites
- They don't compose across libraries

---

## Appendix: Full TC39 Signal Type Definitions

For reference, here are complete type definitions for the TC39 Signals proposal with `stable` / `mutator` / `invalidates` annotations:

```ts
declare namespace Signal {
    interface Options<T> {
        equals?: (a: T, b: T) => boolean;
    }

    class State<T> {
        constructor(initialValue: T, options?: Options<T>);
        stable get(): T;
        mutator set(value: T): void invalidates get;
    }

    class Computed<T> {
        constructor(computation: () => T, options?: Options<T>);
        stable get(): T;
    }

    namespace subtle {
        function untrack<T>(fn: () => T): T;

        class Watcher {
            constructor(notify: () => void);
            watch(...signals: Signal<unknown>[]): void;
            unwatch(...signals: Signal<unknown>[]): void;
            getPending(): Signal<unknown>[];
        }
    }
}
```

---

*This document is part of the `stable` / `mutator` / `invalidates` feature design in the TypeScript-Go native compiler. For implementation details, see the compiler source in `internal/checker/` and test cases in `testdata/tests/cases/compiler/`.*
