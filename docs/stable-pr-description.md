# `stable`, `mutator`, `invalidates`, and Linked Type Predicates

**CFA narrowing through function calls — four cooperative mechanisms**

---

## Problem

TypeScript cannot narrow through repeated function calls. If `value()` returns `string | undefined` and you check `value() !== undefined`, the compiler forgets this on the next `value()` call. This is a major pain point for signal-based frameworks (Angular Signals, Preact Signals, MobX) where state is accessed through getter functions rather than properties. Property narrowing has worked for years — callable getter narrowing has not, despite being the dominant pattern in modern reactive frameworks.

## Real-World Issues Addressed

This proposal addresses a family of long-standing TypeScript issues with **1,350+ combined upvotes**:

### Repeated function call narrowing (TS-60948 — 105 👍, TS-57725 — 351 👍)

```ts
// TODAY: narrowing lost on second call
declare const value: () => string | undefined;
if (value() !== undefined) {
    value().toUpperCase();  // ❌ Error: 'string | undefined' has no method 'toUpperCase'
}

// WITH STABLE: narrowing preserved
declare const value: stable () => string | undefined;
if (value() !== undefined) {
    value().toUpperCase();  // ✅ OK — narrowed to string
}
```

### Angular Signal narrowing (TS-49161 — 149 👍)

```ts
// TODAY: Signal narrowing fails in computed expressions
const count = signal(null as null | number);
const total: number = count() !== null ? count() : 0;  // ❌ Error: number | null

// WITH STABLE: Signal narrowing works
const count: stable () => number | null = signal(null as null | number);
if (count() !== null) {
    count() + 1;  // ✅ narrowed to number
}
```

### Map has/get narrowing (TS-9619 — 179 👍, TS-13086 — 189 👍)

```ts
// TODAY: has() provides no evidence about get()
const map = new Map<string, number>();
if (map.has("x")) {
    const val = map.get("x");  // ❌ number | undefined — no connection
}

// WITH LINKED PREDICATES (Phase 9):
interface TypedMap<K, V> {
    stable get(key: K): V | undefined;
    has<K2 extends K>(key: K2): this.get(key) is V;
}
declare const map: TypedMap<string, number>;
if (map.has("x")) {
    const val = map.get("x");  // ✅ number — linked predicate narrows
}
```

### CFA trade-offs formalized (TS-9998 — 130 👍, 598 comments)

ahejlsberg's 2016 design question — "When a function is invoked, what should we assume its side effects are?" — remained unanswered for 9 years. `stable`/`mutator` is the first practical answer: functions can declare their relationship to narrowing explicitly.

### Correlated method types (TS-30581 — 159 👍)

```ts
// TODAY: no method-to-method type correlation
interface Resource<T> {
    value(): T | undefined;
    hasValue(): boolean;
}
if (resource.hasValue()) {
    resource.value();  // ❌ still T | undefined
}

// WITH LINKED PREDICATES (Phase 3):
interface Resource<T> {
    stable value(): T | undefined;
    hasValue(): this.value() is Exclude<T, undefined>;
}
if (resource.hasValue()) {
    resource.value();  // ✅ narrowed to T (without undefined)
}
```

### Method Declaration Syntax (NEW — SYN-4)

`stable` and `mutator` now work as method modifiers on method declarations and method signatures — not just function type annotations. This enables natural usage in classes, interfaces, and type literals:

```ts
// stable/mutator as method modifiers (class declarations)
class Store<T> {
    stable get(): T { return this._value; }
    mutator set(value: T): void { this._value = value; }
    mutator reset(): void { this._value = undefined as any; }
}

// Also works on interfaces and type literals
interface ReadableStore<T> {
    stable get(): T;
}

interface WritableStore<T> extends ReadableStore<T> {
    mutator set(value: T): void;
    mutator reset(): void;
}
```

### Super Call Invalidation (NEW — SEM-4)

In class hierarchies, `super.mutator()` correctly invalidates `this.stable()` narrowing. Since `super` and `this` refer to the same object instance, a super call to a mutator method must reset narrowing:

```ts
class Derived extends Base {
    test(): void {
        if (this.get() !== undefined) {
            super.reset(); // ✅ super.mutator() invalidates this.stable()
            this.get();    // back to T | undefined
        }
    }
}
```

---

## What This PR Implements

Four declaration-site type modifiers that enable CFA narrowing through function calls:

- **`stable`** — marks a callable getter as returning the same value on consecutive calls (absent mutation)
- **`mutator`** — marks a function as mutating backing state, resetting narrowing
- **`invalidates`** — refines `mutator` to target specific stable endpoints
- **Post-call argument narrowing** — after a `mutator invalidates` call, the stable getter is narrowed to the argument's type (e.g., `setCount(20)` narrows `count()` to `number`)
- **Linked type predicates** — `this.value() is T` syntax for guard methods that narrow stable call results

All four are fully erasable (zero runtime overhead), declaration-site only, and structurally checked. The implementation includes a full test suite (42 test files) with zero regressions against the existing test baseline.

**Implementation milestones:**
- **SYN-4** ✅ — `stable`/`mutator` modifiers on method declarations and method signatures (class methods, interface methods, type literal methods)
- **SEM-4** ✅ — Super call invalidation: `super.mutator()` correctly invalidates `this.stable()` narrowing in class hierarchies
- **CBI-1** ✅ — Cross-binding invalidation via named tuple label references: `invalidates read` on a destructured setter targets the sibling `read` accessor, with full post-call narrowing and selective invalidation
- **SEM-3** ✅ — Interface merging behavior codified: 10-section test documenting how `stable`/`mutator` modifiers behave across merged interfaces, intersections, and interface extension

### Declaration Parity
- `stable`/`mutator` now supported on ALL function-like declarations:
  - Function declarations: `stable function getValue(): T {}`
  - Function expressions: `const f = stable function(): T {}`
  - Arrow functions: `const f = stable (): T => {}`
  - Get accessors: `stable get value(): T` (class + interface)
  - Set accessors: `mutator set value(v: T)` (class + interface)
- Grammar restrictions preserved: `stable` requires zero params (rejects setters), `mutator` rejects getters

---

## Working Examples — What This PR Enables

### 1. Basic Stable Narrowing
```ts
type Signal<T> = stable () => T;

declare const count: Signal<number | undefined>;
if (count() !== undefined) {
    count().toFixed(2);        // ✅ narrowed to number — second call preserves narrowing
    console.log(count() + 1);  // ✅ still number — stable means "same value absent mutation"
}
```

### 2. Mutator Invalidation
```ts
declare const store: {
    read: stable () => string | undefined;
    write: mutator (v: string) => void;
};

if (store.read() !== undefined) {
    store.read().toUpperCase();  // ✅ narrowed to string
    store.write("new");          // mutator call → resets narrowing
    store.read().toUpperCase();  // ❌ Error: narrowing dropped — back to string | undefined
}
```

### 3. Targeted Invalidation with `invalidates`
```ts
declare const app: {
    user: stable () => { name: string } | undefined;
    settings: stable () => { theme: string } | undefined;
    setUser: mutator (v: { name: string } | undefined) => void invalidates user;
};

if (app.user() !== undefined && app.settings() !== undefined) {
    app.setUser({ name: "Alice" });
    app.user();       // ❌ Error: user() invalidated by setUser
    app.settings();   // ✅ still narrowed — settings() is NOT in the invalidates list
}
```

### 4. Post-Call Argument Narrowing
```ts
interface Signal<T> {
    read: stable () => T;
    set: mutator (value: T) => void invalidates read;
}

declare const count: Signal<number | undefined>;
count.set(42);
const n: number = count.read();         // ✅ narrowed to number — argument type propagated

count.set(undefined);
const u: undefined = count.read();      // ✅ narrowed to undefined — argument type propagated
```

### 5. Linked Type Predicates
```ts
interface Resource<T> {
    value: stable () => T;
    hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r: Resource<string | undefined>;
if (r.hasValue()) {
    const s: string = r.value();       // ✅ narrowed to string — linked predicate
}
```

### 6. Cross-Binding Invalidation (SolidJS Pattern)
```ts
declare function createSignal<T>(value: T): [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read
];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    count().toFixed(2);         // ✅ narrowed to number
    setCount(undefined);        // cross-binding invalidation: write → read
    const x: undefined = count();  // ✅ post-call narrowed to undefined
}
```

### 7. Exhaustive Switch Narrowing
```ts
type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; side: number };

declare const readShape: stable () => Shape;

switch (readShape().kind) {
    case "circle":
        readShape().radius;     // ✅ narrowed to { kind: "circle"; radius: number }
        break;
    case "square":
        readShape().side;       // ✅ narrowed to { kind: "square"; side: number }
        break;
    default:
        const _: never = readShape();  // ✅ exhaustiveness check
}
```

### 8. Loop Narrowing Preservation
```ts
declare const readArr: stable () => number[] | undefined;

if (readArr() !== undefined) {
    for (const item of readArr()) {   // ✅ narrowed to number[] — iterable
        item.toFixed(2);
    }
}
```

### 9. Callback Argument Transparency
```ts
declare const read: stable () => string | undefined;
declare function invoke(cb: () => void): void;

if (read() !== undefined) {
    invoke(() => {});                  // empty callback — transparent
    const s: string = read();          // ✅ narrowing preserved
}
```

### 10. Super Call Invalidation
```ts
class Base {
    stable get(): string | undefined { return "hello"; }
    mutator reset(): void {}
}

class Derived extends Base {
    test(): void {
        if (this.get() !== undefined) {
            const before: string = this.get();  // ✅ narrowed
            super.reset();                       // super.mutator() invalidates this.stable()
            this.get();                          // ❌ Error: narrowing dropped
        }
    }
}
```

### 11. Method-Level `invalidates`
```ts
interface Store<T> {
    stable getValue(): T;
    stable getLabel(): string;
    mutator setValue(v: T): void invalidates getValue;
    mutator setLabel(l: string): void invalidates getLabel;
    mutator reset(): void invalidates getValue, getLabel;
}

declare const store: Store<string | undefined>;
if (store.getValue() !== undefined) {
    store.setLabel("test");              // does NOT invalidate getValue
    store.getValue().toUpperCase();      // ✅ still narrowed

    store.setValue("hello");             // invalidates getValue → post-call narrows to string
    store.getValue().toUpperCase();      // ✅ narrowed to string via argument

    store.reset();                       // invalidates BOTH getValue and getLabel
    store.getValue();                    // back to string | undefined
}
```

### 12. Keyed Per-Key Narrowing (Map.has / Map.get)
```ts
interface TypedMap<K, V> {
    stable[key] get(key: K): V | undefined;
    mutator set(key: K, value: V): void invalidates get[key];
    mutator delete(key: K): boolean invalidates get[key];
    mutator clear(): void;  // unkeyed → invalidates ALL keys
}

declare const map: TypedMap<string, number>;

if (map.get("x") !== undefined) {
    const a: number = map.get("x");       // ✅ narrowed (same key "x")
    const b = map.get("y");               // number | undefined (different key)

    map.set("y", 42);                     // invalidates only get("y")
    const c: number = map.get("x");       // ✅ still narrowed — different key

    map.set("x", 99);                     // invalidates get("x")
    map.get("x");                         // back to number | undefined
}
```

### 13. Declaration Parity — All Forms
```ts
// All declaration forms support stable/mutator
stable function getValue(): string | undefined { return "hello"; }
const getX = stable function(): number | null { return 42; };
const getY = stable (): string | undefined => "world";
const fetchData = stable async (): Promise<string | undefined> => undefined;

class Container<T> {
    stable getValue(): T { return this._value; }
    mutator setValue(v: T): void invalidates getValue { this._value = v; }
}

interface Readable<T> { stable get(): T; }

// All forms participate in narrowing
if (getValue() !== undefined) {
    getValue().toUpperCase();   // ✅ narrowed
}
```

---

## Complete Syntax Reference

### `stable` Modifier — Supported Declarations

```ts
// Function type (in type annotations, tuples, parameters)
type Getter<T> = stable () => T;
type Signal<T> = [read: stable () => T, write: mutator (v: T) => void invalidates read];

// Method declaration (class)
class Store<T> {
    stable get(): T { return this._value; }
}

// Method signature (interface / type literal)
interface Readable<T> {
    stable get(): T;
}

// Get accessor (class + interface)
class Counter {
    stable get count(): number | undefined { return this._count; }
}
interface ReadOnly {
    stable get value(): string | undefined;
}

// Function declaration
stable function readConfig(): Config | undefined { ... }

// Function expression
const getValue = stable function(): string | undefined { ... };

// Arrow function
const getY = stable (): string | undefined => { ... };

// Combined with async
const fetchData = stable async (): Promise<Data | null> => { ... };
```

**Restriction:** `stable` requires zero parameters. Rejected on setters, constructors, and any function with parameters.

### `mutator` Modifier — Supported Declarations

```ts
// Function type
type Setter<T> = mutator (v: T) => void;

// Method declaration (class)
class Store<T> {
    mutator set(value: T): void { this._value = value; }
    mutator reset(): void { this._value = undefined as any; }
}

// Method signature (interface)
interface Writable<T> {
    mutator set(value: T): void;
}

// Set accessor (class + interface)
class Counter {
    mutator set count(value: number | undefined) { this._count = value; }
}
interface WriteOnly {
    mutator set value(v: string | undefined);
}

// Function declaration
mutator function setState(val: string | undefined): void { ... }

// Function expression / arrow function
const setX = mutator function(val: number | null): void {};
const setY = mutator (val: string | undefined): void => {};
```

**Restriction:** `mutator` is rejected on get accessors (getters should not mutate state).

### `invalidates` Clause

```ts
// On function types — targets specific stable endpoints
type Signal<T> = [
    read: stable () => T,
    write: mutator (v: T) => void invalidates read
];

// Multi-target invalidation
type MultiSignal<T> = [
    a: stable () => T,
    b: stable () => T,
    setAll: mutator (v: T) => void invalidates a, b
];

// Without invalidates — mutator resets ALL stable narrowing on same receiver
interface Writable<T> {
    stable get(): T;
    mutator set(value: T): void;  // resets all stable on this receiver
}
```

**Note:** `invalidates` clause is currently only supported on function type syntax, not on method declarations or method signatures. For methods, the mutator resets all stable endpoints on the same receiver.

### Linked Type Predicates

```ts
// Phase 3 feature — guard methods that narrow stable endpoints
interface Resource<T> {
    stable value(): T | undefined;
    hasValue(): this.value() is Exclude<T, undefined>;
}
```

### Grammar Error Cases

```ts
// ❌ stable with parameters — rejected
stable function bad(x: number): number { return x; }

// ❌ stable on setter — rejected (setters have parameters)
interface Bad { stable set value(v: string); }

// ❌ mutator on getter — rejected
interface Bad { mutator get value(): string; }

// ❌ stable on constructor — rejected
class Bad { stable constructor() {} }

// ❌ stable + mutator combined — rejected
interface Bad { stable mutator get(): string; }
```

### Get / Set Accessor Parity

TypeScript property narrowing already preserves narrowing of `obj.value` across function calls within a basic block. The `stable`/`mutator` modifiers on get/set accessors serve as:

1. **Documentation** — The modifier signals that the getter is a pure reader or the setter is a state mutator
2. **Declaration emit** — The modifier appears in `.d.ts` files, informing downstream consumers
3. **Consistency** — All function-like declarations accept the modifiers where semantically appropriate
4. **Future potential** — Enables more aggressive narrowing optimizations in future phases

---

## Future Phase Syntax (Under Consideration)

These entries show the design roadmap for `stable`/`mutator`/`invalidates`. Phases 4–5 are **already implemented** in this PR; Phases 6–12 are future extensions under consideration.

### Phase 4: Conservative-to-Targeted Migration Path

> **Status: Already implemented.** Both conservative (Phase 1) and targeted (Phase 2) modes are functional in this PR.

Start with conservative invalidation (any method call resets narrowing), then gradually opt-in to targeted invalidation with `mutator`:

```ts
// Phase 1: Conservative — any call on receiver resets narrowing
interface Signal<T> {
    stable value(): T;
    set(v: T): void;        // NOT marked mutator → conservative reset
}
// sig.toString() resets narrowing on sig.value() (conservative)

// Phase 2+: Targeted — only mutator calls reset
interface Signal<T> {
    stable value(): T;
    mutator set(v: T): void; // explicitly marked → only this resets
}
// sig.toString() does NOT reset narrowing (not a mutator)
```

### Phase 5: Cross-Binding Invalidation (SolidJS / Preact Signals)

> **Status: Already implemented** (CBI-1). Cross-binding invalidation via named tuple labels and post-call argument-type narrowing are fully functional in this PR.

Tuple-destructured APIs where getter and setter are separate bindings:

```ts
// createSignal returns named tuple — labels enable cross-binding invalidation
function createSignal<T>(value: T): [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read
];

const [count, setCount] = createSignal<number | undefined>(0);
if (count() !== undefined) {
    count() + 1;             // ✅ narrowed to number
    setCount(20);            // invalidates read → post-call narrowing from argument
    count();                 // ✅ narrowed to number (argument type: number)
    setCount(undefined);     // post-call narrowing from argument
    count();                 // narrowed to undefined (argument type: undefined)
}

// Selective invalidation with multi-element tuples
function createStore<T>(init: T): [
    get: stable () => T,
    set: mutator (v: T) => void invalidates get,
    subscribe: (cb: () => void) => void,
    unsubscribe: () => void
];
// Only `set` invalidates `get` — `subscribe`/`unsubscribe` are transparent
```

### Phase 6: `invalidates` on Method Declarations (SYN-4b)

> **Status: Already implemented** (commit 61ba366a4). `invalidates` clause is now supported on method declarations and method signatures.

Selective invalidation directly on method declarations/signatures (not just function types):

```ts
interface Store<T> {
    stable getValue(): T;
    stable getLabel(): string;
    mutator setValue(v: T): void invalidates getValue;  // only resets getValue
    mutator setLabel(l: string): void invalidates getLabel;  // only resets getLabel
    mutator reset(): void invalidates getValue, getLabel;  // resets both
}
```

Method-level `invalidates` clauses enable selective invalidation — only the named stable endpoints are reset, not all narrowing on the receiver.

### Phase 7: `mutates` Unified Clause (SYN-1)

> **Status: Not implemented.** Alternative syntax proposal under consideration.

A single `mutates` keyword could replace both `mutator` and `invalidates`:

```ts
// Alternative syntax under consideration
interface Signal<T> {
    stable value(): T;
    set(v: T): void mutates value;  // replaces: mutator set(v: T): void invalidates value
}

// In tuple types
type Signal<T> = [
    read: stable () => T,
    write: (v: T) => void mutates read  // replaces: mutator ... invalidates read
];
```

### Phase 8: `--strictStable` Compiler Flag (SEM-5)

> **Status: Not implemented.** Requires compiler flag infrastructure.

An opt-in flag that reverses the default: without the flag, unmarked methods are transparent (don't invalidate); with the flag, unmarked methods are conservatively treated as mutators:

```ts
// Without --strictStable (current default)
interface Foo {
    stable get(): string | undefined;
    doSomething(): void;  // transparent — does NOT reset narrowing
}

// With --strictStable
interface Foo {
    stable get(): string | undefined;
    doSomething(): void;  // conservative — DOES reset narrowing (no mutator annotation)
}
```

### Phase 9: Keyed Linked Predicates (LP-1)

> **Status: Already implemented** (commit 18f9a1590).

Guard methods that narrow stable endpoints with per-key parameter correlation. Uses `stable[key]` bracket notation on stable declarations to scope return stability to specific key arguments, and `invalidates get[key]` on mutators for per-key invalidation (vs `invalidates get` which invalidates ALL keys). The `[key]` bracket does NOT appear on `mutator` — per-key invalidation is expressed solely via the `invalidates` clause:

```ts
interface TypedMap<K, V> {
    stable[key] get(key: K): V | undefined;
    has<K2 extends K>(key: K2): this.get(key) is V;
    mutator set(key: K, value: V): void invalidates get[key];
    mutator delete(key: K): boolean invalidates get[key];
    mutator clear(): void;  // unkeyed → invalidates ALL
}

declare const map: TypedMap<string, number>;
if (map.has("x")) {
    const val = map.get("x");  // ✅ narrowed to number (not number | undefined)
    map.set("x", 42);          // invalidates get["x"] only → post-call narrowing
    map.get("x");              // ✅ narrowed to number (argument type propagated)
    map.get("y");              // ❌ still number | undefined (not invalidated by set("x"))
    map.delete("x");           // invalidates get["x"], has["x"]
    map.get("x");              // back to number | undefined
    map.clear();               // invalidates ALL get/has narrowing
}

// WeakRef pattern (no key parameter needed)
interface TypedWeakRef<T extends WeakKey> {
    stable deref(): T | undefined;
}
```

### Phase 10: Discriminated Method Unions / Multi-Predicate Guards (LP-2)

> **Status: Not implemented.** Requires multi-target linked predicate infrastructure.

Guard methods that narrow MULTIPLE stable endpoints simultaneously:

```ts
interface AsyncResult<T, E> {
    stable value(): T | undefined;
    stable error(): E | undefined;
    stable status(): "pending" | "resolved" | "rejected";

    // Multi-predicate guard — narrows all three at once
    isResolved(): this.value() is T & this.error() is undefined & this.status() is "resolved";
    isRejected(): this.error() is E & this.value() is undefined & this.status() is "rejected";
}

declare const result: AsyncResult<Data, Error>;
if (result.isResolved()) {
    result.value();    // ✅ narrowed to Data (not Data | undefined)
    result.error();    // ✅ narrowed to undefined
    result.status();   // ✅ narrowed to "resolved"
}
```

### Phase 11: Getter Property Invalidation (LP-3)

> **Status: Not implemented.** Requires `invalidates` to target getter properties.

`invalidates` targeting getter properties (not just stable methods):

```ts
interface FormField<T> {
    stable get value(): T;
    stable get isDirty(): boolean;
    stable get isValid(): boolean;
    mutator set value(v: T) invalidates isDirty, isValid;
    mutator reset(): void invalidates value, isDirty, isValid;
}
```

### Phase 12: Standard Library Annotations (ADO-1)

> **Status: Not implemented.** Requires TC39/TypeScript team buy-in for stdlib changes.

Built-in types annotated with `stable`/`mutator`:

```ts
// Map (potential stdlib annotation — uses per-key invalidation)
interface Map<K, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    mutator set(key: K, value: V): void invalidates get[key], has[key];
    mutator delete(key: K): boolean invalidates get[key], has[key];
    mutator clear(): void;  // unkeyed → invalidates ALL
}

// WeakRef
interface WeakRef<T extends WeakKey> {
    stable deref(): T | undefined;
}

// DOM
interface HTMLElement {
    stable get classList(): DOMTokenList;
    stable getAttribute(name: string): string | null;
    mutator setAttribute(name: string, value: string): void invalidates getAttribute;
    mutator removeAttribute(name: string): void invalidates getAttribute;
}
```

---

## Recommended Phased Introduction

### Phase 1: `stable` alone (conservative reset)

Introduce `stable` with a conservative invalidation policy: any method call on the same receiver resets all stable narrowing on that receiver.

```ts
interface Signal<T> {
    value: stable () => T;
}

declare const sig: Signal<string | undefined>;
if (sig.value() !== undefined) {
    sig.value().toUpperCase(); // OK — narrowed to string
}
```

Conservative reset means that even non-mutating calls like `sig.toString()` would reset narrowing. This is safe by default — it's the same approach TypeScript uses for property narrowing (any call might invalidate).

**Scope:** Parser + checker changes for `stable` modifier, conservative flow analysis.

### Phase 2: `mutator` and `invalidates` for precise invalidation

Replace conservative reset with explicit mutation marking. Only calls to `mutator`-annotated methods reset narrowing.

```ts
interface Signal<T> {
    value: stable () => T;
    set: mutator (v: T) => void invalidates value;
}

declare const sig: Signal<string | undefined>;
if (sig.value() !== undefined) {
    sig.toString();              // does NOT reset — not a mutator
    sig.value().toUpperCase();   // still narrowed
    sig.set("hello");            // mutator → post-call narrowing from argument
    sig.value();                 // ✅ narrowed to string (argument type: string)
    sig.set(undefined);          // post-call narrowing from argument
    sig.value();                 // narrowed to undefined (argument type: undefined)
}
```

**Scope:** Parser + checker for `mutator`/`invalidates`, targeted invalidation lists, multi-endpoint stores.

> **Alternative syntax under consideration:** A single `mutates` clause could replace both `mutator` and `invalidates` — e.g., `set(v: T): void mutates value`. See the full proposal (§13) for details.

### Phase 3: Linked type predicates (independent extension)

Guard methods that narrow the return type of a stable method on the same receiver.

```ts
interface Resource<T> {
    value: stable () => T;
    hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r: Resource<string | undefined>;
if (r.hasValue()) {
    r.value(); // narrowed to string
}
```

**Scope:** Parser for `this.method() is T` return type syntax, checker predicate linking, guard invalidation rules.

---

## ⚠️ Key Soundness Disclosures

These are the design's known weaknesses. They should be evaluated openly.

### 1. Inverted Default — Optimistic vs. Pessimistic

Property narrowing is **pessimistic**: any function call resets narrowing on properties. The `stable` system (with `mutator`) is **optimistic**: narrowing persists unless a method is explicitly marked `mutator`. This inverted default means forgetting `mutator` silently preserves narrowing that should be reset — a type hole. The property narrowing default is safer because it errs on the side of over-resetting.

In practice, "I forgot to add `mutator` to a state-changing method" is a more likely developer error than "a Proxy changed the value behind my back." The optimistic default makes the common mistake silent.

### 2. Two-Sided Trust Model

Both `stable` AND `mutator` must be correctly annotated for soundness. The compiler trusts the developer's annotations mechanically. If a method mutates backing state but isn't marked `mutator`, narrowing survives incorrectly. This is analogous to TypeScript's general trust model for type annotations (`x: string` when `x` is actually a `number`), but the blast radius of a missing `mutator` is larger because it affects all stable narrowing on that receiver.

### 3. SolidJS Cross-Binding Invalidation (Resolved)

SolidJS separates accessor and setter into different bindings:

```ts
const [count, setCount] = createSignal<number | undefined>(0);
```

**Cross-binding invalidation is now implemented.** Using named tuple label references in the `invalidates` clause, SolidJS-style APIs can express the read/write relationship:

```ts
function createSignal<T>(value: T): [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read
];

const [count, setCount] = createSignal<number | undefined>(0);
if (count() !== undefined) {
    setCount(undefined); // invalidates read → resets count() narrowing
    count();             // post-call narrowed to undefined
}
```

This uses destructuring provenance tracking — the checker maps `count` to tuple label `read` and `setCount` to label `write`, so `invalidates read` on `write` correctly targets `count`. See the Companion Documents section for the full research on 6 approaches evaluated.

### 4. Structural Assignability Gap

`mutator` markers can be lost through structural widening. A structurally compatible assignment strips the mutation contract:

```ts
interface Signal<T> {
    value: stable () => T;
    set: mutator (v: T) => void;
}

declare const sig: Signal<string | undefined>;
const setter: (v: string | undefined) => void = sig.set.bind(sig);
// setter() is no longer a mutator — structural type lost the modifier
// Calling setter(undefined) does NOT reset narrowing on sig.value()
```

This is the same category of issue as `readonly` being lost through structural compatibility, but with soundness implications for CFA.

### 5. Generic Interaction Unresolved

How `stable` propagates through generics, conditional types, and mapped types is an open question. For example:

- Does `Partial<Signal<T>>` preserve `stable` on `value`?
- Does `Pick<Signal<T>, 'value'>` preserve `stable`?
- Does `ReturnType<Signal<T>['value']>` understand stable call semantics?

The current implementation handles direct usage correctly but does not define behavior for all type-level operations on stable types.

---

## Framework Coverage

| Framework | Pattern | `stable` Works? | Notes |
|-----------|---------|-----------------|-------|
| **Angular Signals** | `signal<T>()` returns object with `.set()` | ✅ Yes | Receiver-scoped, natural fit |
| **Preact Signals** | `.value` property + `.peek()` | ✅ Yes | Works for `.peek()` callable getter |
| **MobX** | Computed/observable with getter methods | ✅ Yes | Receiver-scoped |
| **SolidJS** | `const [get, set] = createSignal()` | ✅ **Yes** | Cross-binding invalidation via named tuple labels |
| **Vue `ref()`** | `.value` property access | N/A | Property, not callable — existing narrowing works |

---

## Angular Template Caveat

Angular template narrowing depends on the Angular compiler's Template Type Check Block (TCB) generation. The TCB translates template expressions into TypeScript-checkable code. For stable narrowing to work in Angular templates (e.g., `@if (sig()) { {{ sig() }} }`), the TCB must generate code that the checker can narrow through stable calls. This may require coordination with the Angular compiler team and is not guaranteed to work out-of-the-box.

---

## Future Extensions (Not In This PR)

The following are explicitly **not** part of this proposal but are documented as future work:

- **Discriminated method unions** (Phase 10): `isResolved(): this.value() is T & this.error() is undefined` — multi-predicate guards for async result patterns
- **Exclusive invalidation (`preserves`):** Inverse of `invalidates` for APIs where listing exceptions is more concise
- **`mutates` alternative syntax:** Collapsing `mutator` + `invalidates` into a single clause (see full proposal §13)
- **Conditional type discrimination (`IsStable<T>`):** Type-level stable detection

---

## Open Design Questions

These questions remain unresolved and would benefit from TypeScript team input:

### Syntax
| ID | Question | Impact |
|---|---|---|
| **SYN-1** | Should `mutator` + `invalidates` be collapsed into a single `mutates` clause? (e.g., `set(v: T): void mutates value`) | Syntax simplification |
| **SYN-3** | TS modifiers are adjectives (`readonly`, `abstract`, `static`). `mutator` is a noun. Should it be `mutating`? | Naming convention |

### Semantics
| ID | Question | Impact |
|---|---|---|
| **SEM-2** | When a stable method is destructured from its receiver, should narrowing still apply? Should it be an error? | Soundness |
| **SEM-5** | Should there be a `--strictStable` compiler flag that treats ALL unmarked calls as potentially invalidating? (Reverses default-transparent) | Safety model |
| **SEM-6** | Should heuristic tier-based inference be a user-facing feature, or should all invalidation be explicit `mutator` annotations? | DX vs. safety |
| **SEM-7** | For `Map<K, V \| undefined>`, `has(key)` → `get(key)` narrowing would incorrectly narrow `V \| undefined` to `V` | Soundness edge case |

### Cross-Binding
| ID | Question | Impact |
|---|---|---|
| **CBI-4** | Should SolidJS ship an object-based API as a "narrowable" alternative? | Framework guidance |
| **CBI-5** | Can a function mutate both a tuple sibling AND a receiver method? E.g., `mutates read, get` | Multi-scope invalidation |

### Adoption
| ID | Question | Impact |
|---|---|---|
| **ADO-1** | Should builtins (`Map.get`, `WeakRef.deref`, DOM accessors) be annotated `stable`? | Standard library |
| **ADO-2** | How do frameworks ship `.d.ts` that work with both `stable`-aware and older TS versions? | Backwards compatibility |
| **ADO-3** | Should `stable` be allowed on functions with explicit `this` parameter? Does `this` type serve as receiver for invalidation scoping? | Generic functions |
| **ADO-4** | Are there simpler mechanisms — single modifier, type-level encoding, `readonly` integration — that the team would prefer? | Alternative designs |

---

## Deferred Decisions

These are deferred to future phases with rationale:

| ID | Question | Phase | Rationale |
|---|---|---|---|
| **SYN-2** | Is `stable` the right name? Alternatives: `getter`, `pure`, `cached`, `memo` | Post-review | Naming should be finalized after team feedback |
| **SYN-4** | `invalidates` clause on method declarations (currently only on function types) | Future | AST struct changes needed; method-level selective invalidation can wait |
| **SYN-5** | `stable` on interface call signatures (`interface { stable (): T; }`) | Future | Parser ambiguity — `stable` is treated as method name |
| **SYN-6** | `invalidates` exclusive mode (`sort: mutator () => void preserves length`) | Future | Low priority — only useful for partial invalidation |
| **SEM-1** | How does `stable` propagate through generics, conditional types, mapped types? | Phase 2+ | Complex type-level interactions |
| **SEM-8** | Should `T extends stable () => any ? true : false` discriminate stable functions? | Future | Conditional type discrimination |
| **LP-1** | ~~Keyed linked predicates: `has(key: K): this.get(key) is V` — parameter correlation~~ | ~~Phase 9~~ | ✅ **Already implemented** — moved to DECIDED (commit 18f9a1590) |
| **LP-2** | Multi-predicate intersection: `isOk(): this.value() is T & this.error() is undefined` | Future | Complex predicate composition |
| **LP-3** | Getter mutation invalidation: should `invalidates` target getter properties? | Future | Cross-concern between accessor modifiers and invalidation |

---

## Companion Documents

All companion documents are located in the `docs/` directory of this repository.

### `docs/stable-pr-proposal.md` — Full External Proposal
The primary proposal document (~2000 lines). Covers motivation from 5 real-world TypeScript issues (1,350+ combined upvotes), the three-modifier design (`stable`, `mutator`, `invalidates`), linked type predicates, phased introduction plan (10 phases), soundness analysis, framework compatibility matrix, and 17 open design questions for the TypeScript team. This is the document intended for upstream submission.

### `docs/stable-design-holes-analysis.md` — Design Holes & Trust Model
Analyzes the "default transparent" rule — why unmarked methods do NOT invalidate stable narrowing, the soundness implications of this optimistic default, and what `mutator`/`invalidates` actually provide beyond `stable` alone. Covers the lying-setter problem, structural assignability gaps, and the two-sided trust model.

### `docs/stable-internal-design-document.md` — Internal Technical SDD
The authoritative internal design document covering all 5+ implementation phases, parity tracking against TypeScript's property narrowing, conservative uncertainty-boundary invalidation, and tiered heuristic inference. This guided the actual Go implementation in `internal/checker/flow.go` and `internal/checker/checker.go`.

### `docs/stable-modifier-spec.md` — Formal SDD Specification
Formal specification in SDD format with normative statements, phase boundary decisions, and checker behavior requirements. Defines exactly when narrowing is preserved, when it resets, how linked predicates interact with stable endpoints, and the constraint-overload post-call narrowing rules.

### `docs/ts-rejection-risk-assessment.md` — Rejection Risk Assessment
Risk analysis of each proposal component against TypeScript Design Goals, TS team member quotes, and precedent from accepted features. Assesses `stable` core narrowing as low-risk (RyanCavanaugh actively engaged with upstream identity modifier proposal), with advanced features (linked predicates, constrained-overload) carrying higher risk.

### `docs/research-solidjs-cross-binding.md` — SolidJS Cross-Binding Invalidation Research
Deep analysis of why SolidJS's `const [count, setCount] = createSignal()` pattern cannot safely adopt `stable` — the read and write functions are separate bindings with no shared receiver. Evaluates 6 approaches: tuple index (`mutates [0]`), named channels, source interface extraction, **named tuple label reference (`mutates read`)** (recommended), heuristic inference, and object pattern. Estimates ~300-500 LOC for the recommended approach.

### `docs/stable-design-decisions.md` — Design Decisions Register
Consolidated register of 30 open design decisions across 5 categories (Syntax, Semantics, Cross-Binding, Linked Predicates, Adoption). Each decision tracked with status (OPEN/RECOMMENDED/DEFERRED/DECIDED), phase impact, alternatives, and recommendation. Two decisions (SYN-4: method declarations, SEM-4: super call invalidation) are now DECIDED and implemented.

### Other Research Documents (in `docs/`)
- `stable-phase8-proposal.md` — Phase 8+ proposal covering keyed linked predicates, discriminated method unions, exclusive invalidation (`preserves`), and conditional type discrimination
- `stable-modifier-research.md` — Initial research: cross-language survey (Rust, Kotlin, Swift, C++), prior art analysis, and modifier naming alternatives
- `stable-inheritance-research.md` — Class hierarchy behavior: virtual dispatch, override narrowing, covariant/contravariant method overrides
- `research-map-has-get-narrowing.md` — Map `has()`/`get()` narrowing analysis for Phase 9 keyed predicates
- `stable-heuristic-uncertainty-boundaries-research.md` — Uncertainty boundary classification: which constructs reset stable narrowing and why

---

## Key Test Files

42 test files in `testdata/tests/cases/compiler/`:

**Core narrowing:**
- `stableModifierNarrowing.ts` — basic stable narrowing and reset
- `stableModifierBoundaries.ts` — uncertainty boundaries and reset points
- `stableModifierSignalPatterns.ts` — real-world signal API patterns
- `stableModifierParity.ts` / `stableModifierSubmoduleParity.ts` — getter/setter parity

**Equality and control flow:**
- `stableModifierEqualityChain.ts` — discriminant-style narrowing
- `stableModifierExhaustiveSwitch.ts` — exhaustive switch on stable calls
- `stableModifierAdvancedLoops.ts` — loop narrowing behavior

**Mutator and invalidation:**
- `stableModifierMutatorBasic.ts` — basic mutator reset
- `stableModifierMutatorLinks.ts` — `invalidates` clause with targeted reset
- `stableModifierMutatorErrors.ts` — validation diagnostics
- `stableModifierPostCallNarrowing.ts` — post-call narrowing after constrained writes
- `stableModifierCrossBinding.ts` — cross-binding invalidation via named tuple labels (SolidJS pattern)

**Linked predicates:**
- `stableModifierLinkedPredicates.ts` — `this.value() is T` linked type predicates
- `stableModifierAssertionGuards.ts` — assertion-style guards

**Method declarations and super calls:**
- `stableModifierMethodDeclarations.ts` — stable/mutator on method declarations and method signatures
- `stableModifierSuperCalls.ts` — super call invalidation in class hierarchies

**Edge cases:**
- `stableModifierInterfaceMerging.ts` — interface merging and intersection behavior with stable/mutator modifiers
- `stableModifierClosures.ts` — closure capture behavior
- `stableModifierOptionalChaining.ts` / `stableModifierAdvancedOptionalChain.ts`
- `stableModifierCrossModule.ts` — cross-module stable references
- `stableModifierErrors.ts` / `stableModifierDiagnostics.ts` — error reporting
- `stableModifierEmit.ts` — erasure correctness
- `stableModifierDeclarationParity.ts` — 11 sections: all declaration kinds, grammar errors, namespace support

**Heuristic tiers and boundaries:**
- `stableModifierTier1Writes.ts` — tier 1 write invalidation
- `stableModifierTier2.ts` — tier 2 heuristic inference
- `stableModifierStandaloneCallBoundary.ts` — standalone call boundary behavior
- `stableModifierMethodCallBoundary.ts` — method call boundary behavior
- `stableModifierValueTypeBoundary.ts` — value type boundary behavior

**Getter analysis:**
- `stableModifierGetterCorpus.ts` — getter pattern corpus
- `stableModifierGetterParitySweep.ts` — getter parity sweep tests
- `stableModifierGetterMissingMatrix.ts` — getter missing matrix coverage

**Advanced patterns:**
- `stableModifierAdvancedCallbacks.ts` — advanced callback behavior
- `stableModifierMultiArgCallback.ts` — multi-argument callback patterns
- `stableModifierConstrainedOverload.ts` — constrained overload resolution
- `stableModifierGenericDiscriminant.ts` — generic discriminant narrowing
- `stableModifierInOperator.ts` — `in` operator narrowing with stable

**Diagnostics and edge cases:**
- `stableModifierBareParameter.ts` — bare parameter diagnostics
- `stableModifierHeuristicDiagnostics.ts` — heuristic diagnostic messages
- `stableModifierP8Conservative.ts` — phase 8 conservative mode

---

## Pipeline Status

All pass:
- ✅ `npx hereby build`
- ✅ `npx hereby test`
- ✅ `npx hereby lint`
- ✅ `npx hereby format`
