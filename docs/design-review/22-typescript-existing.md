# Design Review #22: Existing TypeScript Features & Proposals vs. Identity/Mutator/Links

**Status:** Research  
**Date:** 2026-03-11  
**Scope:** Analyze how existing TypeScript features, patterns, and proposals relate to the `identity`/`mutator`/`links` system

---

## Overview

The `identity`/`mutator`/`links` system introduces three coordinated concepts:

- **`identity`** — marks parameterless callable read endpoints as stable for CFA narrowing
- **`mutator`** — marks functions that invalidate identity narrowing
- **`links`** — selective invalidation clause targeting specific identity endpoints

This document examines how each existing TypeScript feature relates to, overlaps with, or differs from these concepts. The goal is to clarify the design space and show why a new modifier system is necessary despite TypeScript's existing rich type system.

---

## 1. `readonly` Keyword

### What It Does

TypeScript's `readonly` prevents assignment to properties after initialization:

```typescript
interface Config {
    readonly host: string;
    readonly port: number;
}

const config: Config = { host: "localhost", port: 3000 };
config.host = "example.com"; // Error: Cannot assign to 'host' because it is a read-only property
```

`readonly` also applies to array/tuple element positions (`readonly string[]`, `readonly [string, number]`).

### Relationship to `identity`

| Dimension | `readonly` | `identity` |
|---|---|---|
| **Target** | Properties, array elements, tuple elements | Parameterless call expressions |
| **Guarantee** | Assignment prevention (structural) | Repeated-read stability (CFA) |
| **CFA impact** | None — `readonly` doesn't affect narrowing | Enables narrowing across repeated calls |
| **Invalidation** | Compiler rejects writes statically | `mutator`/heuristic inference governs invalidation |
| **Scope** | Structural type contract | Flow-analysis behavioral contract |

### Key Difference

`readonly` is a **structural** constraint: it removes the ability to write. `identity` is a **behavioral** contract: it asserts that repeated reads return the same value within a flow scope, enabling CFA to carry narrowing across call boundaries.

A `readonly` property can still have a getter that returns different values:

```typescript
interface Unstable {
    readonly value: string | number; // readonly, but getter could be impure
}

const obj: Unstable = {
    get value() { return Math.random() > 0.5 ? "hello" : 42; } // Legal!
};
```

TypeScript still narrows `readonly` properties despite this unsoundness. `identity` makes the same pragmatic trade-off for function calls, which TypeScript currently refuses to narrow.

### Why `readonly` Alone Can't Solve This

1. `readonly` doesn't apply to function return types — there's no syntax for "this function's return is readonly"
2. Even if it did, `readonly` says nothing about _return value stability_ across calls
3. Signals are accessed via `signal()` calls, not property reads — `readonly` has no syntactic surface here

---

## 2. `as const`

### What It Does

`as const` creates immutable literal types, widening prevention, and deep `readonly`:

```typescript
const config = { host: "localhost", port: 3000 } as const;
// Type: { readonly host: "localhost"; readonly port: 3000 }

const directions = ["north", "south", "east", "west"] as const;
// Type: readonly ["north", "south", "east", "west"]
```

### Relationship to `identity`

`as const` and `identity` operate in entirely different domains:

| Dimension | `as const` | `identity` |
|---|---|---|
| **Domain** | Value-level literal inference | Call-expression CFA |
| **Effect** | Produces `readonly` types with literal members | Enables narrowing reuse across repeated calls |
| **Scope** | Single expression | Flow graph region |
| **Mutability** | Makes the value's type deeply immutable | Says nothing about the backing data's mutability |

### Why `as const` Can't Solve This

```typescript
const signal = createSignal<string | undefined>(undefined);
const read = signal[0]; // () => string | undefined

// `as const` doesn't help:
const read2 = signal[0] as const; // Still () => string | undefined — no CFA effect
```

`as const` affects the inferred _type_ of an expression, not the _control flow analysis_ of calls to that expression. It cannot express "calling this function twice yields the same value."

---

## 3. Type Predicates (`is`)

### What It Does

Type predicates enable user-defined type guards that narrow a parameter:

```typescript
function isString(value: unknown): value is string {
    return typeof value === "string";
}

declare const x: string | number;
if (isString(x)) {
    x.toUpperCase(); // x is string
}
```

### Relationship to `identity`

Type predicates provide **one-shot narrowing**: a single call gates a type guard that applies to a reference. `identity` provides **repeated-read narrowing**: the same call expression can be used multiple times with narrowing preserved.

```typescript
// Type predicate: narrows the ARGUMENT, not the function's own return
function isDefined<T>(v: T | undefined): v is T { return v !== undefined; }

declare const read: identity () => string | undefined;

// Type predicate approach — requires intermediate variable:
const val = read();
if (isDefined(val)) {
    val.toUpperCase(); // ✅ Works, but val is stale — doesn't track reactive updates
}

// identity approach — no intermediate needed:
if (read() !== undefined) {
    read().toUpperCase(); // ✅ Works, tracks reactive reads
}
```

### Critical Distinction

Type predicates narrow a _reference_ (variable/parameter) through a _boolean return_. They require:
1. Storing the value in a variable first
2. Passing it to the predicate function
3. Using the original variable (not re-calling the function)

This fundamentally conflicts with the Signals pattern where:
- The call site matters (reactive tracking depends on _where_ `signal()` is invoked)
- Extracting to a variable may alter reactive behavior
- The value should be "live" — re-read, not cached in a local

`identity` solves the problem type predicates cannot: narrowing across _repeated call expressions_ without requiring an intermediate variable.

---

## 4. Assertion Functions (`asserts`)

### What It Does

Assertion functions narrow types unconditionally after the call:

```typescript
function assertDefined<T>(v: T | undefined): asserts v is T {
    if (v === undefined) throw new Error("Expected defined");
}

declare const x: string | undefined;
assertDefined(x);
x.toUpperCase(); // x is string — narrowed by assertion
```

### Relationship to `identity`

Assertion functions provide **post-condition narrowing**: after the assertion call, the variable is narrowed for the remainder of the scope. This is the closest existing feature to what `identity` provides, but with critical differences:

| Dimension | `asserts` | `identity` |
|---|---|---|
| **Mechanism** | Narrows an existing reference post-call | Enables narrowing of call-expression results |
| **Target** | Variables/parameters passed to the function | The function's own return value |
| **Invalidation** | Standard CFA rules for the narrowed variable | `mutator`/heuristic invalidation for the endpoint |
| **Side effects** | Function must throw on failure (runtime behavior) | No runtime behavior change — type-level only |
| **Reuse** | Narrows once; subsequent calls to the assertion redundantly re-assert | Each `read()` call shares narrowed type automatically |

### Why `asserts` Can't Solve Signals

```typescript
declare const count: () => number | undefined;

// Can't write: function assertCount(): asserts count() is number
// asserts only works on parameters, not call expressions
```

Assertion functions fundamentally require a _reference_ (variable or parameter) to narrow. They cannot narrow the return type of a function call expression. Additionally, assertion functions are _imperative_ (throw on failure), while `identity` is _declarative_ (assert stability for CFA).

### Complementary Interaction

Assertion functions _do_ work with `identity` endpoints:

```typescript
declare const read: identity () => string | undefined;

function assertDefined<T>(v: T | undefined): asserts v is T {
    if (v === undefined) throw new Error();
}

// Not directly composable — assertDefined(read()) doesn't narrow future read() calls
// But guards work naturally:
if (read() !== undefined) {
    read().toUpperCase(); // ✅ identity handles this directly
}
```

---

## 5. Branded/Nominal Types

### What It Does

TypeScript's structural type system can be augmented with branded types to create nominal distinctions:

```typescript
type ReadonlySignal<T> = (() => T) & { readonly __brand: "readonly-signal" };
type WritableSignal<T> = ReadonlySignal<T> & { set(v: T): void };
```

This is how Angular and similar frameworks currently model the read/write distinction:

```typescript
// Angular's approach (simplified):
interface Signal<T> {
    (): T;
}
interface WritableSignal<T> extends Signal<T> {
    set(value: T): void;
    update(updateFn: (value: T) => T): void;
}
```

### Relationship to `identity`

Branded types can express the _structural_ difference between read-only and writable signals, but they cannot affect _CFA narrowing_:

```typescript
declare const sig: WritableSignal<string | undefined>;

if (sig() !== undefined) {
    sig().toUpperCase(); // Still error — branded type doesn't enable CFA
}
```

### Why Brands Can't Solve This

1. Brands are structural ornaments — they don't change how the checker handles call expressions
2. No amount of branding can make the checker recognize that `f()` called twice returns the same value
3. Brands can distinguish "readable" from "writable" at the type level, but this distinction doesn't feed into flow analysis

Branded types remain useful _alongside_ `identity`: they can encode the read/write API distinction while `identity` enables CFA narrowing for the read path.

---

## 6. `Readonly<T>` and `DeepReadonly<T>`

### What It Does

`Readonly<T>` makes all properties of `T` readonly:

```typescript
type Readonly<T> = { readonly [P in keyof T]: T[P] };

interface Mutable { x: number; y: string; }
type Immutable = Readonly<Mutable>;
// { readonly x: number; readonly y: string; }
```

`DeepReadonly<T>` (not built-in, but common) recursively applies:

```typescript
type DeepReadonly<T> = {
    readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

### Relationship to `identity`

These utility types operate at the _structural_ level, preventing writes to properties. They have zero impact on CFA narrowing of function calls.

```typescript
type ReadonlySignalAPI<T> = Readonly<{
    read: () => T;
}>;

declare const api: ReadonlySignalAPI<string | undefined>;

if (api.read() !== undefined) {
    api.read().toUpperCase(); // Still error — Readonly doesn't affect CFA
}
```

### The Orthogonality

`Readonly<T>` prevents mutation of the _container_. `identity` enables narrowing of the _read result_. They are orthogonal:

- `Readonly` answers: "Can I reassign this property?"
- `identity` answers: "Can I trust that re-calling this function gives the same type?"

You might want both: a `Readonly` container with `identity` reads. Neither subsumes the other.

---

## 7. Getter/Setter CFA

### What TypeScript Currently Does

TypeScript narrows getters as if they were properties:

```typescript
declare const model: {
    get value(): string | undefined;
    set value(v: string | undefined);
};

if (model.value !== undefined) {
    model.value.toUpperCase(); // ✅ Narrowed to string
    model.value = undefined;   // Write invalidates narrowing
    model.value.toUpperCase(); // ❌ Error: possibly undefined
}
```

This works because the checker treats getter reads as _dotted-name references_ and applies standard CFA narrowing. Writes to the setter invalidate narrowing.

### What Doesn't Work

```typescript
// Functions don't get this treatment:
declare const model: {
    getValue(): string | undefined;
    setValue(v: string | undefined): void;
};

if (model.getValue() !== undefined) {
    model.getValue().toUpperCase(); // ❌ Error: Object is possibly 'undefined'
}
```

The checker doesn't carry narrowing across repeated _call expressions_, only across repeated _dotted-name references_.

### The Parity Gap

This is precisely the gap `identity` fills. The design goal is **getter-parity CFA**: `identity` calls should narrow identically to getter reads. The implementation tracks this explicitly:

- Repeated reads after guard → parity
- Write invalidation → parity
- Callback/await boundaries → parity
- Uncertainty-boundary behavior → parity

The `identity` modifier tells the checker: "Treat `obj.read()` like `obj.value` for CFA purposes."

### Getter Unsoundness Precedent

TypeScript's getter narrowing is already unsound:

```typescript
let counter = 0;
const tricky = {
    get value(): string | undefined {
        return counter++ === 0 ? "hello" : undefined;
    }
};

if (tricky.value !== undefined) {
    tricky.value.toUpperCase(); // TypeScript says ✅, runtime says 💥
}
```

TypeScript accepts this trade-off for getters because the ergonomic benefit vastly outweighs the edge-case unsoundness. `identity` makes the same trade-off explicit: the developer opts into "treat my function like a getter" by adding the modifier.

---

## 8. Decorators

### What They Do

TypeScript decorators (TC39 Stage 3) allow runtime metadata and behavior modification on classes, methods, accessors, and fields:

```typescript
function logged(target: any, context: ClassMethodDecoratorContext) {
    return function (...args: any[]) {
        console.log(`Calling ${String(context.name)}`);
        return target.apply(this, args);
    };
}

class Store {
    @logged
    getValue() { return this.value; }
}
```

### Could Decorators Mark Stability Contracts?

In theory, a `@stable` decorator could mark functions as identity-like:

```typescript
class Store {
    @stable
    read(): string | undefined { ... }

    @mutates("read")
    set(v: string | undefined): void { ... }
}
```

### Why Decorators Are Unsuitable

1. **Runtime semantics mismatch**: Decorators are _runtime_ constructs — they execute JavaScript code. `identity` is a _type-level_ declaration that should not emit any runtime code. Using decorators would violate TypeScript's design goal of not emitting different JS based on types.

2. **No interface support**: Decorators cannot appear on interface members. The primary use case for `identity` is in type declarations and interfaces (e.g., `Signal<T>` type definitions). Interfaces are the canonical way to define signal APIs.

3. **No function type support**: Decorators cannot appear on function type expressions (`@stable () => T` is not valid syntax). `identity` must work on function _types_, not just function _declarations_, because signals are often defined through type aliases and interfaces.

4. **String-based links**: `@mutates("read")` would use a string argument, losing compile-time checking that the target exists and is an identity endpoint. The `links` clause uses identifier references that are resolved by the checker.

5. **Wrong abstraction level**: Decorators modify _behavior_. `identity` declares a _type-level invariant_ consumed by CFA. These are fundamentally different abstraction levels.

---

## 9. `using` and `Symbol.dispose`

### What It Does

The `using` declaration (TC39 Stage 3, TypeScript 5.2+) manages resource lifetimes with deterministic cleanup:

```typescript
function processFile() {
    using handle = openFile("data.txt");
    // handle is automatically disposed at end of block
    return handle.read();
} // handle[Symbol.dispose]() called here
```

### Relationship to `identity`

Both `using` and `identity` deal with _scoped invariants_:

| Dimension | `using` / `Symbol.dispose` | `identity` |
|---|---|---|
| **Scope** | Block-scoped resource lifetime | Flow-scoped type narrowing |
| **Invariant** | "Resource is valid within this block" | "Read result is stable within this flow region" |
| **Cleanup** | Deterministic disposal at block exit | Narrowing invalidation at uncertainty boundaries |

### Analogy, Not Equivalence

`using` provides a _runtime_ guarantee: the resource will be cleaned up. `identity` provides a _type-level_ guarantee: CFA facts are valid within scope.

There's no way to leverage `using` to solve the signals narrowing problem:

```typescript
// This doesn't help:
using snapshot = read(); // read() isn't a Disposable, and this defeats reactive tracking
```

The connection is purely conceptual: both features manage scoped assumptions with deterministic invalidation points.

---

## 10. TC39 Records & Tuples Proposal

### What It Proposes

The Records & Tuples proposal (TC39 Stage 2) introduces immutable value types:

```javascript
const record = #{ x: 1, y: 2 };
const tuple = #[1, 2, 3];

record.x = 3; // TypeError at runtime
record === #{ x: 1, y: 2 }; // true — value equality
```

### Relationship to `identity`

Records and Tuples provide runtime immutability and value equality. If adopted, they would give TypeScript stronger guarantees about data stability:

```typescript
// Hypothetical: a signal returning a Record
declare const data: identity () => #{ name: string; age: number } | undefined;

if (data() !== undefined) {
    data().name; // ✅ Narrowed — and the Record guarantees the value is truly frozen
}
```

### Why Records & Tuples Don't Replace `identity`

1. **Stage 2, not shipped**: The proposal is not in any JavaScript engine yet. `identity` solves the problem today.

2. **Orthogonal concern**: Records & Tuples guarantee _value immutability_. `identity` guarantees _call stability_. A mutable signal can still benefit from `identity` (the value may change, but within a synchronous flow region, repeated reads return the same result).

3. **No CFA effect**: Even with Records & Tuples, TypeScript wouldn't automatically narrow `f()` called twice without an `identity`-like mechanism.

4. **Complementary**: If Records & Tuples land, `identity` signals returning records would give both guarantees — CFA narrowing _and_ deep immutability.

---

## 11. Existing GitHub Issues

### TypeScript #60948 — `identity` Modifier Proposal

**Filed by:** JoshuaKGoldberg (Jan 10, 2025)  
**Status:** Open, labeled "Needs More Info"

This is the upstream proposal that directly motivated the implementation. Key discussion points:

- **RyanCavanaugh** (TS team) suggested distributive conditional types as an alternative: `type PossibleFuncs<T> = T extends unknown ? () => T : never`. This works for top-level union narrowing but fails for narrowing properties within `T` (combinatorial explosion) and cannot be expressed in non-declaration code.

- **RyanCavanaugh** also raised the critical mutation question: _"if `get` 'always returns the same value', why is there a `set` method?"_ — This directly motivates the `mutator`/`links` system. Without mutation tracking, the feature is "immediately going to run into another feature request before it's considered useful."

- **alxhub** (Angular team) explained why extracting to local variables is insufficient: signal reads have side effects (reactive tracking), and hoisting changes execution order. The `const v = value()` workaround alters behavior.

- **ryansolid** (Solid.js) confirmed this is a fundamental signals composability problem, not just a convenience issue. Signals libraries are being pushed toward `.value` getter syntax purely because of TypeScript limitations.

- **robbiespeed** raised soundness concerns about overly optimistic narrowing in reactive scopes where signals can be mutated during derivation.

**How our implementation addresses these concerns:**
- Tiered heuristic invalidation (conservative by default) addresses the soundness concern
- `mutator`/`links` explicit contracts (Phase 5) answer RyanCavanaugh's mutation question
- Getter-parity CFA (not "better than getter") keeps the unsoundness envelope unchanged
- Uncertainty-boundary invalidation at callbacks/await handles reactive scope interleaving

### TypeScript #57725 — Pure/Impure Narrowing Control

**Filed by:** matthew-dean (Mar 11, 2024)  
**Status:** Open, labeled "Awaiting More Feedback" (351 👍)

This issue frames the problem more broadly: properties can always be narrowed but getters may be impure, while functions can never be narrowed but may be pure. The proposal asks for bidirectional control:
- Mark functions as "stable" (enable narrowing)
- Mark properties/getters as "unstable" (disable narrowing)

**Relationship to `identity`/`mutator`/`links`:**

The `identity` modifier directly addresses the "stable function" half. The "unstable property" half remains unaddressed — but it's a separate, lower-priority concern. The community response (351 upvotes, extensive Angular/Solid/Vue discussion) confirms the Signal narrowing use case as the primary motivator.

Notable comment from **robbiespeed**: _"Any calls to something impure should reset all pure fn/prop narrowing"_ — this aligns with the heuristic invalidation approach where unknown calls conservatively invalidate identity narrowing.

### Angular #49161 — Signals and Nullability

**Filed by:** cexbrayat (Feb 22, 2023)  
**Status:** Open, "In Progress" in Angular's Reactivity project (149 👍)

The original Angular signals issue that catalyzed the entire discussion. Key insight:

```typescript
const count = signal(null as null | number);
const total: number = count() !== null ? count() : 0;
// Error: Type `number | null` is not assignable to type `number`
```

The Angular team explored:
- Template-level hacks (`@if` with implicit variable extraction)
- Language service plugins (concluded infeasible — variable extraction changes semantics)
- `Signal.isPresent()` type predicate (partial solution, doesn't scale to discriminated unions)

All roads lead back to needing a TypeScript language feature. `identity` is that feature.

### Related Issues

- **TypeScript #9998** — Trade-offs in CFA: Documents the existing unsoundness in property narrowing that `identity` matches (not exceeds)
- **TypeScript #40562** — Non-void returning assertion functions: Partially related, as it discusses post-call type narrowing
- **TypeScript #49669** — Getter narrowing control: Directly related to the "impure getter" half of #57725

---

## 12. Alternative Approaches Within Existing TypeScript

### Approach A: Distributive Conditional Types

RyanCavanaugh's suggestion from #60948:

```typescript
type PossibleFuncs<T> = T extends unknown ? () => T : never;

declare class Signal<T> {
    get: PossibleFuncs<T>;
    set(value: T): void;
}

const sig = new Signal<string | undefined>(undefined);
if (sig.get() !== undefined) {
    sig.get().toUpperCase(); // ✅ Narrows via function union narrowing
}
```

**Why this fails:**
1. **Doesn't work for nested unions**: If `T = { id: string | number; value: Data | undefined }`, properties can be narrowed independently but encoding this requires `2^n` function type variants — combinatorial explosion.
2. **Can't express in class implementations**: `get: PossibleFuncs<T> = () => this.value` doesn't type-check.
3. **Doesn't handle discriminated unions**: `typeof sig.get() === "string"` doesn't narrow through the distributive conditional in practice.
4. **Verbose and brittle**: Framework authors must manually maintain the type machinery rather than adding a single keyword.

### Approach B: Wrapper Functions with Type Predicates

```typescript
function narrowSignal<T>(signal: () => T | undefined): T | undefined {
    return signal();
}

// Or with assertion:
function assertSignalDefined<T>(signal: () => T | undefined): asserts signal is () => T {
    if (signal() === undefined) throw new Error();
}
```

**Why this fails:**
1. **Doesn't narrow repeated calls**: `narrowSignal` returns a value, not a narrowed reference
2. **Assertion on the function narrows the wrong thing**: Making `signal` become `() => T` is actually unsound — the next call after mutation could return `undefined`
3. **Requires variable extraction**: The whole point is to avoid `const v = signal()`

### Approach C: Template Literal Types / Conditional Types for State Machines

```typescript
type NarrowedSignal<T, Narrowed extends T> = {
    (): Narrowed;
    set(v: T): void;
};
```

**Why this fails:**
1. **Requires tracking `Narrowed` at the type level**: TypeScript would need dependent types to track the narrowed state through control flow
2. **The narrowed type changes through the program**: Generic parameters are fixed at instantiation, but CFA narrowing is flow-dependent
3. **Combinatorial**: Multiple independent narrowable components multiply the type space

### Approach D: Phantom Types / State Tags

```typescript
type Checked = { __checked: true };
type Unchecked = { __checked: false };

type Signal<T, S = Unchecked> = S extends Checked
    ? { (): NonNullable<T> }
    : { (): T; check(): Signal<T, Checked> };
```

**Why this fails:**
1. **Requires explicit state transitions**: Developer must call `.check()` and use the returned value — this is more ceremony than `const v = signal()`
2. **Doesn't compose with standard CFA**: TypeScript's flow analysis doesn't track phantom type parameters through assignment
3. **API surface pollution**: Signal types become littered with state-tracking generics

### Approach E: Overloaded Call Signatures

```typescript
interface Signal<T> {
    (): T;                           // Default
    (guard: (v: T) => v is T): T;    // Guarded overload
}
```

**Why this fails:**
1. **Adds ceremony**: Every narrowing check requires passing a guard function
2. **Doesn't match the natural `if (sig() !== undefined)` pattern**
3. **Overload resolution doesn't carry narrowing to subsequent calls**

### Conclusion: None Work

Every existing TypeScript mechanism falls short because the fundamental problem is **CFA doesn't track call-expression results across repeated calls**. This is an architectural gap in the flow analysis system, not a gap in the type system. Structural solutions (brands, conditional types, readonly) can't fix a flow-analysis problem. Behavioral solutions (predicates, assertions) target variables, not call expressions.

`identity` is the minimal addition that bridges this gap: it tells CFA to treat a call expression like a dotted-name reference, unlocking getter-parity narrowing with no runtime cost.

---

## Summary Matrix

| Feature | Domain | Affects CFA? | Addresses Signal Narrowing? | Relationship to `identity` |
|---|---|---|---|---|
| `readonly` | Structural | No | No | Orthogonal — prevents writes, doesn't enable call narrowing |
| `as const` | Literal inference | No | No | Unrelated — affects inferred types, not flow analysis |
| Type predicates (`is`) | CFA | Yes (one-shot) | Partially | Complementary — narrows variables, not call expressions |
| Assertion functions (`asserts`) | CFA | Yes (post-call) | No | Complementary — narrows variables, not call returns |
| Branded types | Structural | No | No | Orthogonal — encodes API shape, no CFA effect |
| `Readonly<T>` | Structural | No | No | Orthogonal — prevents property writes |
| Getter/setter CFA | CFA | Yes | For properties only | **Direct predecessor** — `identity` extends this to calls |
| Decorators | Runtime | No | No | Wrong abstraction level — runtime vs. type-level |
| `using` / dispose | Resource management | No | No | Conceptual analogy only — scoped invariants |
| Records & Tuples | Value types | Potentially | No (no CFA) | Complementary — immutable data + `identity` narrowing |
| Conditional types | Type operations | No | Partially (fragile) | Workaround — doesn't scale to nested/complex types |

**Bottom line:** `identity` fills a gap that no existing TypeScript feature addresses. It is the minimal, targeted extension that gives call expressions the same CFA treatment that property/getter accesses already receive.
