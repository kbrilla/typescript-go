# `stable`/`mutator`/`invalidates`: Class Hierarchy & Inheritance Research

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [TypeScript Modifier Inheritance Patterns (Existing)](#2-typescript-modifier-inheritance-patterns)
3. [Analysis of Each Scenario](#3-analysis-of-each-scenario)
4. [Proposed Rules](#4-proposed-rules)
5. [Variance Rules for Overrides](#5-variance-rules-for-overrides)
6. [`this` vs `super` Invalidation Semantics](#6-this-vs-super-invalidation-semantics)
7. [Implementation Notes](#7-implementation-notes)

---

## 1. Executive Summary

`stable`, `mutator`, and `invalidates` are **type-level modifiers on callable signatures**. They currently live on `FunctionTypeNode` in declaration position (e.g., interface property types). Unlike `readonly`, `abstract`, or `override` — which are **member-level modifiers** on symbols — `stable`/`mutator`/`invalidates` are **signature-level flags** (`SignatureFlagsStable`, `SignatureFlagsMutator`) that propagate through signature instantiation via `SignatureFlagsPropagatingFlags`.

This distinction is critical: TypeScript's existing modifier inheritance patterns operate at the symbol level, but `stable`/`mutator`/`invalidates` are inherently **structural** — they are part of the function type, not the property declaration.

**Core conclusion**: These modifiers should follow **structural compatibility** rules, not nominal inheritance rules. A class method satisfies a `stable` interface property if and only if its type is structurally compatible with the declared stable function type. The modifiers are not "inherited" in the traditional sense — they are **checked** during type compatibility.

---

## 2. TypeScript Modifier Inheritance Patterns

### 2.1 `readonly` — Structural, Not Inherited

`readonly` is a **property modifier** (on the symbol), not a type modifier. Key behaviors:

1. **Not inherited by implementing classes**: A class implementing an interface with `readonly x: number` does NOT automatically get `readonly` on its `x` property. The class can have a mutable `x` and still satisfy the interface.

2. **Assignability**: `{ x: number }` is assignable to `{ readonly x: number }`, but not vice versa in strict subtype checks. For assignability, `readonly` doesn't affect compatibility.

3. **Variance**: `readonly` only affects *mutability direction* — a readonly property is covariant, a mutable property is invariant.

**Lesson for stable/mutator**: Like `readonly`, these modifiers should not be magically "inherited" by implementing classes. They are part of the *declared type* and checked structurally.

### 2.2 `abstract` — Nominal, Must Override

`abstract` is a **member modifier** on classes. Key behaviors:

1. **Must be implemented**: Non-abstract classes extending abstract classes must provide implementations for all abstract members.
2. **Not a type-level concern**: `abstract` is a declaration constraint, not a type compatibility issue. Once a member is implemented, the `abstract` flag disappears.
3. **No transitive inheritance**: If `A` is abstract, `B extends A` is abstract, and `C extends B` is concrete — `C` must implement all abstract members from both `A` and `B`.

**Lesson for stable/mutator**: Abstract methods can declare stable/mutator types, and concrete implementations must be *type-compatible* with those types. The stable/mutator constraint carries through the type, not through the abstract modifier.

### 2.3 `override` — Explicit Declaration Requirement

`override` is a **declaration modifier** that requires `noImplicitOverride`. Key behaviors:

1. **Pure declaration check**: `override` doesn't affect types at all — it only checks that a member in a derived class actually overrides something in the base.
2. **Not inherited**: An overridden member doesn't carry `override` to further subtypes.
3. **Orthogonal to type compatibility**: The type compatibility of overrides is checked separately by the relater.

**Lesson for stable/mutator**: `override` is orthogonal. A class member marked `override` can implement a stable/mutator interface member — the modifier stacking order is: `override stable () => T` would mean "this override provides a stable callable."

### 2.4 Access Modifiers (`public`/`private`/`protected`) — Structural + Nominal Hybrid

1. **Interface members are implicitly public**: Classes implementing interfaces must have public members.
2. **Private members are nominal**: Two classes with private members of the same name are NOT compatible unless they share the declaration.
3. **Protected members** require class derivation for compatibility.
4. **No widening/narrowing**: A derived class cannot change `public` to `protected` or vice versa.

**Lesson for stable/mutator**: Access modifiers and stable/mutator are orthogonal. A `private stable () => T` is valid — the stable contract applies within the class scope.

### 2.5 Signature-Level Flags Precedent: `abstract` on Construct Signatures

The closest existing precedent to `stable`/`mutator` as signature flags is `SignatureFlagsAbstract`, which marks abstract construct signatures. This flag:
- Is set from the declaration site (`ModifierFlagsAbstract`)
- Propagates through `SignatureFlagsPropagatingFlags`
- Is checked during instantiation to prevent `new AbstractClass()`

This is exactly the pattern `stable`/`mutator` follow.

---

## 3. Analysis of Each Scenario

### 3.1 Class Implementing Interface with stable/mutator

```ts
interface Readable<T> {
  read: stable () => T;
}

interface Writable<T> extends Readable<T> {
  write: mutator (value: T) => void invalidates read;
}

class MyStore<T> implements Writable<T> {
  read(): T { ... }       // Method declaration — NOT automatically stable
  write(value: T): void { ... }  // Method declaration — NOT automatically mutator
}
```

**Analysis**: The interface declares `read` as having type `stable () => T` (a function type with the `stable` modifier) and `write` as having type `mutator (value: T) => void invalidates read`. The class `MyStore` declares `read` and `write` as *method declarations* — these are `MethodDeclaration` nodes, not `PropertyDeclaration` nodes with function type annotations.

> **Update:** Full declaration parity is now implemented. `stable`/`mutator` work on method declarations, method signatures, function declarations, function expressions, arrow functions, and get/set accessors.

**Critical distinction**: Currently, `stable`/`mutator` are parsed only on `FunctionTypeNode` — they are syntactic modifiers on function type expressions. Method declarations (`read(): T`) are not function type nodes. So the class method does NOT carry the modifier unless the class uses property syntax:

```ts
class MyStore<T> implements Writable<T> {
  // Option A: method syntax — NO stable/mutator modifier syntax available
  read(): T { ... }

  // Option B: property syntax with function type — stable/mutator CAN be declared
  read: stable () => T = () => { ... };
}
```

**Rule**: When a class implements an interface with stable/mutator typed properties:
- The *interface's* type carries the `stable`/`mutator` flags on its signatures
- During type compatibility, the class member's callable signature is checked against the interface's callable signature
- The stable/mutator flags on the *interface side* are what CFA uses when the value is accessed through the interface type
- If the value is accessed through the concrete class type, the *class member's own type* determines CFA behavior

This is **exactly** how `readonly` works: accessing `x` through `Readable<T>` gives you the `readonly` version; accessing through `MyStore<T>` gives you whatever `MyStore` declared.

### 3.2 Override Narrowing/Widening

```ts
interface Base {
  get: stable () => number | string;
  set: mutator (v: number | string) => void invalidates get;
}

interface Derived extends Base {
  get: stable () => number;  // Narrowed return type
  set: mutator (v: number) => void invalidates get;  // Narrowed parameter
}
```

**Return type narrowing (`get`)**: A `stable () => number` is assignable to `stable () => number | string` because `number` is a subtype of `number | string`. Return types are covariant. This is **valid**.

**Parameter narrowing (`set`)**: A `mutator (v: number) => void` is NOT assignable to `mutator (v: number | string) => void` under strict function types. Parameters are contravariant — the derived type must accept *at least* what the base accepts. Passing a `string` to `Derived.set` would fail, but the base type says it should accept `string`. This is **unsound** under strict variance.

However, TypeScript's method override checking is **bivariant** for methods (not strict function types). So:
- If `set` is declared as a method: bivariant, TypeScript permits the narrowing (unsound but pragmatic)
- If `set` is declared as a property with function type: contravariant under `strictFunctionTypes`, TypeScript rejects the narrowing

**Rule**: `stable`/`mutator` do not change variance rules. The existing TypeScript variance rules for function type properties vs method declarations continue to apply. Specifically:
- Property-typed function types: strict (covariant return, contravariant parameters)
- Methods: bivariant

**`stable`/`mutator` modifier compatibility**: The `stable` and `mutator` flags are part of the signature. For type compatibility, the **presence** of these flags should be structural:
- A `stable () => T` should be assignable to `() => T` (a stable function is usable as a regular function — it just provides more guarantees)
- A non-stable `() => T` should NOT be assignable to `stable () => T` (you can't claim stability without declaring it)
- A `mutator (T) => void` should be assignable to `(T) => void` (a mutator is just a regular call with extra metadata)
- A non-mutator `(T) => void` should NOT be assignable to `mutator (T) => void` (you can't claim mutation semantics without declaring it)

This follows the Liskov Substitution Principle: a stable function provides *more* guarantee (CFA can narrow), so it's a *stronger* subtype.

### 3.3 `this` and `super` Interaction

```ts
class Base {
  get: stable () => number;
  set: mutator (v: number) => void invalidates get;

  reset() {
    super.set(0);  // Q1: Does this invalidate this.get()?
    this.set(0);   // Q2: Does this invalidate this.get()?
  }
}

class Derived extends Base {
  get: stable () => number;

  doSomething() {
    this.set(0);   // Q3: Invalidates Derived's get or Base's get or both?
    super.set(0);  // Q4: What about super calls?
  }
}
```

**Q1 — `super.set(0)` in Base**: `super.set(0)` calls the Base implementation of `set`. The *receiver* is still `this` — `super` only changes method dispatch, not the target object. Since `set` is a mutator that `invalidates get`, and the receiver/object is the same `this`, **yes, this invalidates `this.get()`**.

**Q2 — `this.set(0)` in Base**: Direct `this.set(0)` call. `set` is a mutator, receiver matches. **Yes, invalidates `this.get()`**.

**Q3 — `this.set(0)` in Derived**: `this.set(0)` on the Derived instance. The set's `invalidates get` clause names `get`. At CFA time, the receiver is `this`, and `get` resolves to whatever `get` is visible on `this`. Since `Derived` redeclares `get`, CFA should invalidate the narrowing of `this.get()`. Whether it was "Derived's get" or "Base's get" is not meaningful from CFA perspective — there is one `get` on `this` at runtime, and the mutator invalidates it.

**Rule**: `super` calls do NOT change the receiver identity for invalidation purposes. `super.mutator()` still invalidates `this`-based stable references because the mutation happens on the same object instance. CFA checks receiver identity, not dispatch target identity.

**Q4 — `super.set(0)` in Derived**: Same answer as Q1 — `super` changes dispatch but not the receiver object. The mutation still happens on `this`, so `this.get()` narrowing is invalidated.

### 3.4 Multiple Inheritance (Interfaces)

```ts
interface A {
  read: stable () => number;
}

interface B {
  read: stable () => string;
}

interface C extends A, B {
  read: stable () => number | string;  // Must re-declare?
}
```

**Analysis**: TypeScript merges interface declarations structurally. When `C extends A, B`, if both `A` and `B` declare `read` with incompatible types, TypeScript produces an error unless `C` provides a compatible declaration.

For `stable`:
- `A.read` has type `stable () => number`
- `B.read` has type `stable () => string`
- These are incompatible (return types don't overlap in a useful way)
- `C` must redeclare `read` with a type that satisfies both: `stable () => number | string`

**The `stable` modifier must be re-declared on the merged type.** TypeScript's interface merging does not automatically infer modifiers from constituent types — the merged declaration is what C's type uses. If `C` declares `read: () => number | string` without `stable`, it loses the stable guarantee.

**Rule**: When merging interface members that have `stable`/`mutator` in some but not all constituent types:
- If ALL constituents agree on the modifier → merged type inherits it (structural intersection)
- If SOME but not all have the modifier → an explicit declaration is needed; the merged type without explicit modifier loses the guarantee
- This follows the same pattern as `readonly` in intersection types: `{ readonly x: T } & { x: T }` loses readonly in the intersection

### 3.5 Abstract Classes

```ts
abstract class Container<T> {
  abstract get: stable () => T;
  abstract set: mutator (v: T) => void invalidates get;
}

class NumberContainer extends Container<number> {
  get(): number { return this.value; }
  set(v: number): void { this.value = v; }
}
```

**Analysis**: `abstract` modifies the property member, while `stable`/`mutator` modify the function type of that property. When `NumberContainer` implements `get`, it must provide a type compatible with `stable () => number` (the instantiated abstract type).

Same as scenario 3.1: if `get` is declared as a method (`get(): number`), it doesn't carry the `stable` flag syntactically. But the *interface type* `Container<number>` has the stable signature, so:
- Accessing `get` through a `Container<number>` reference uses the stable signature
- Accessing `get` through a `NumberContainer` reference uses whatever `NumberContainer` declares

If `NumberContainer` wants its own `get` to be treated as stable in CFA, it must declare it with the stable modifier:
```ts
class NumberContainer extends Container<number> {
  get: stable () => number = () => this.value;
}
```

**Rule**: `abstract` and `stable`/`mutator` are orthogonal. `abstract` controls whether an implementation must exist; `stable`/`mutator` control the function type's CFA behavior. The implementing class inherits the stable/mutator semantics *through the base class type* but must explicitly declare them on its own members for direct access.

### 3.6 Mixin Patterns

```ts
function Cacheable<T extends Constructor>(Base: T) {
  return class extends Base {
    cached: stable () => CachedValue;
    invalidateCache: mutator () => void invalidates cached;
  };
}
```

**Analysis**: This is a class expression returning a new type. The returned class type has properties `cached` and `invalidateCache` with their function type modifiers. This works naturally because:
1. The class expression creates a new type with these property types
2. The stable/mutator modifiers live on the function types, not on the class members
3. When the mixin result is used, the type carries the modifiers structurally

**No special rules needed**. Mixins create new types with the declared properties and their types. The modifiers flow through structural typing.

---

## 4. Proposed Rules

### Rule 1: Structural Inheritance via Type, Not Nominal Modifier

**`stable`/`mutator`/`invalidates` are NOT inherited as modifiers.** They are part of the function type and follow structural type compatibility:

- When code uses a value through interface type `Readable<T>`, the `stable` flag on `read`'s signature is active ← comes from the interface type
- When code uses a value through concrete class type `MyStore<T>`, the `stable` flag is active ONLY IF the class property's type includes it
- This matches `readonly`: `readonly x: number` on an interface doesn't make `x` readonly when accessed through a class that implements it without `readonly`

### Rule 2: Explicit Declaration Required on Class Members

If a class wants its own members to participate in stable/mutator CFA when accessed through the class type, it must explicitly declare them:

```ts
// Explicit — CFA works through both interface and class type
class MyStore<T> implements Writable<T> {
  read: stable () => T = () => { ... };
  write: mutator (value: T) => void invalidates read = (v) => { ... };
}

// Implicit — CFA only works through interface type
class MyStore<T> implements Writable<T> {
  read(): T { ... }      // Regular method, no stable CFA through MyStore type
  write(value: T): void { ... }  // Regular method, no mutator CFA through MyStore type
}
```

### Rule 3: Type Compatibility Rules

For structural assignability of function types with stable/mutator:

| Source | Target | Compatible? | Reason |
|--------|--------|-------------|--------|
| `stable () => T` | `() => T` | ✅ Yes | Stable is a stronger guarantee, usable as regular |
| `() => T` | `stable () => T` | ❌ No | Cannot claim stability without declaring it |
| `mutator (T) => void` | `(T) => void` | ✅ Yes | Mutator is callable as regular function |
| `(T) => void` | `mutator (T) => void` | ❌ No | Cannot claim mutation semantics without declaring it |
| `stable () => S` | `stable () => T` | if `S` <: `T` | Normal covariant return |
| `mutator (S) => void` | `mutator (T) => void` | if `T` <: `S` | Normal contravariant parameter |

### Rule 4: `invalidates` Clauses in Overrides

When a derived interface overrides a mutator with an `invalidates` clause:

```ts
interface Base {
  a: stable () => number;
  b: stable () => string;
  reset: mutator () => void invalidates a, b;
}

interface Derived extends Base {
  reset: mutator () => void invalidates a;  // NARROWED invalidation set
}
```

**Narrowing the invalidation set** (invalidating fewer endpoints) is **safe** — the derived type preserves more narrowing, which is a stronger guarantee.

**Widening the invalidation set** (invalidating more endpoints) is also **safe** — the derived type is more conservative, which is always sound.

**Changing the invalidation set to reference non-existent endpoints** is an **error** — `invalidates c` where `c` doesn't exist on the type produces a diagnostic.

**Rule**: There are no variance constraints on `invalidates` sets. Both narrowing and widening are safe because:
- Narrowing = "this mutator is less destructive than the interface says" = preserves more info = sound
- Widening = "this mutator is more destructive than the interface says" = drops more info = sound (conservative)

However, the `invalidates` clause should be checked for validity — all referenced names must resolve to stable endpoints on the same type.

### Rule 5: `this` vs `super` for Invalidation

**`super.mutator()` invalidates `this`-based stable references.**

Rationale: `super` only changes method dispatch (vtable lookup), not the receiver object. The mutation happens on the same object as `this`, so any cached CFA facts about `this.stableRead()` must be invalidated.

Implementation: `isMutatorCallBoundary` already uses `isMatchingReference` on the receiver portion of the access. For `super.set()`, the receiver should be normalized to `this` for matching purposes, since `super` refers to the same object instance.

### Rule 6: Interface Merging

When interfaces merge declarations of the same property:

1. If all declarations agree on `stable` → result is `stable`
2. If all declarations agree on `mutator` → result is `mutator`
3. If declarations disagree → the merged member follows the intersection semantics of the function types:
   - `stable () => T & () => T` → `stable` is lost (the non-stable constituent doesn't guarantee stability)
   - Explicitly re-declare with the desired modifier on the merged interface

---

## 5. Variance Rules for Overrides

### 5.1 `stable` Function Types (Read Endpoints)

`stable` functions are **covariant producers**: they return values. Variance applies to return types:

```ts
interface Base { get: stable () => number | string }
interface Derived extends Base { get: stable () => number }  // ✅ Covariant
interface Widened extends Base { get: stable () => number | string | boolean }  // ❌ Not assignable
```

The `stable` modifier itself doesn't change variance — it's an additional guarantee that narrows what CFA can do, but the underlying type compatibility rules are unchanged.

### 5.2 `mutator` Function Types (Write Endpoints)

`mutator` functions are **contravariant consumers**: they accept values. Variance applies to parameters:

```ts
interface Base { set: mutator (v: number | string) => void invalidates get }
interface Derived extends Base { set: mutator (v: number) => void invalidates get }  // ❌ Contravariant violation
interface Widened extends Base { set: mutator (v: number | string | boolean) => void invalidates get }  // ✅ Accepts more
```

**Exception**: As noted in §3.2, TypeScript permits bivariant method overrides. If `set` is a method declaration (not a property with function type), the contravariant check is relaxed.

### 5.3 Combined Read-Write Interfaces

When `stable` and `mutator` are related via `invalidates`, the variance is naturally constrained:

```ts
interface Container<T> {
  get: stable () => T;                                    // Covariant in T
  set: mutator (v: T) => void invalidates get;            // Contravariant in T
}
```

This makes `Container<T>` **invariant** in `T` — exactly the same as `{ value: T }` (a mutable property is both read and written). This is correct: if `Container<number>` was assignable to `Container<number | string>`, code could call `set("hello")` and then `get()` would return a `string` where `number` was expected.

### 5.4 Summary Table

| Override Direction | Return Type | Parameter Type | `invalidates` Set | Valid? |
|---|---|---|---|---|
| Narrow return | `T → S` where `S <: T` | — | — | ✅ Covariant |
| Widen return | `T → U` where `U ⊃ T` | — | — | ❌ Not assignable |
| Narrow parameter | — | `T → S` where `S <: T` | — | ❌ Contravariant violation |
| Widen parameter | — | `T → U` where `U ⊃ T` | — | ✅ Accepts more |
| Shrink invalidates | — | — | `{a,b} → {a}` | ✅ Preserves more |
| Expand invalidates | — | — | `{a} → {a,b}` | ✅ More conservative |

---

## 6. `this` vs `super` Invalidation Semantics

### 6.1 Core Principle

`super` is a dispatch mechanism, not a different receiver. In JavaScript/TypeScript:
- `this.method()` — dispatches to the most-derived implementation
- `super.method()` — dispatches to the parent class implementation

In both cases, `this` refers to the same object instance. Any side effects of `super.method()` affect the same object as `this.method()`.

### 6.2 CFA Implications

```ts
class A {
  get: stable () => number | undefined;
  set: mutator (v: number) => void invalidates get;
}

class B extends A {
  doWork() {
    if (this.get() !== undefined) {
      // this.get() narrowed to `number`

      super.set(42);
      // super.set() mutates the same object
      // post-call narrowing applies from argument type

      this.get();  // narrowed to number (post-call narrowing from argument type)
    }
  }
}
```

### 6.3 Implementation Requirement

In `isMutatorCallBoundary`, the receiver matching logic uses `isMatchingReference`. For `super.method()`:
- The expression is `SuperExpression.PropertyAccess("method")`
- The reference is `ThisExpression.PropertyAccess("get")`

The receiver portion needs to match `super` against `this` as equivalent for invalidation purposes. The current implementation uses `getLiteralNamedAccessReceiverAndName` — this should normalize `super` to `this` for receiver identity matching.

### 6.4 Edge Case: Mixed `this`/`super` in Overrides

```ts
class A {
  get: stable () => number | undefined;
  set: mutator (v: number) => void invalidates get;
}

class B extends A {
  // B does NOT redeclare get or set — inherits from A

  mixedCalls() {
    if (this.get() !== undefined) {
      // this.get() narrowed to `number`

      // All of these should invalidate this.get():
      this.set(1);     // ✅ same receiver, same dispatch
      super.set(2);    // ✅ same receiver, parent dispatch
    }
  }
}
```

All mutator calls on `this`/`super` with the same receiver identity should invalidate matching stable references. The dispatch target (derived vs base implementation) is irrelevant for CFA soundness.

---

## 7. Implementation Notes

### 7.1 Current State

The current implementation handles `stable`/`mutator` at the `FunctionTypeNode` level:
- Parser: modifiers on `FunctionTypeNode` declarations
- Binder: `ModifierFlagsStable`, `ModifierFlagsMutator`
- Checker: `SignatureFlagsStable`, `SignatureFlagsMutator` propagated through `SignatureFlagsPropagatingFlags`
- CFA: `classifyStableBoundary` → `isMutatorCallBoundary` → receiver matching → invalidation

### 7.2 What Needs to Be Added for Class Hierarchy Support

1. **Structural compatibility check**: The relater should check `stable`/`mutator` flag compatibility:
   - `stable () => T` assignable to `() => T` ✅
   - `() => T` NOT assignable to `stable () => T` ❌
   - `mutator (T) => void` assignable to `(T) => void` ✅
   - `(T) => void` NOT assignable to `mutator (T) => void` ❌

2. **`super` receiver normalization**: `isMutatorCallBoundary` needs to treat `super.X` and `this.X` as the same receiver for invalidation matching.

3. **No implicit inheritance**: Do NOT add code to infer `stable`/`mutator` from base types onto derived class members. The modifiers are structural.

4. **Interface merge validation**: When interfaces merge, validate that `invalidates` clauses reference valid endpoint names on the merged type.

### 7.3 What Should NOT Be Done

1. **No modifier inheritance magic**: Do not auto-propagate `stable`/`mutator` from interface to implementing class members. This would be unprecedented in TypeScript (even `readonly` doesn't do this).

2. **No special variance rules**: The existing TypeScript variance rules apply unchanged. `stable`/`mutator` are additional guarantees, not variance modifiers.

3. **No `invalidates` clause checking in the relater**: The `invalidates` clause is a CFA hint, not a type compatibility concern. Changing invalid invalidation sets is always sound (just changes CFA precision).

### 7.4 Phase Recommendation

These scenarios are mostly **Phase 2/3 work**:
- Phase 1 (current): `stable`/`mutator`/`invalidates` on interface property types, CFA narrowing
- **Phase 2**: Structural compatibility rules for stable/mutator signatures in the relater
> **Update:** Super call invalidation is now implemented (SEM-4).

- **Phase 2**: `super` receiver normalization for invalidation
- **Phase 3**: Method declaration syntax support for `stable`/`mutator` (currently only `FunctionTypeNode`)
- **Phase 3**: Interface merge validation for `invalidates` clauses
- **Phase X**: Implicit stable/mutator inference from patterns (e.g., getter-only property → stable)
