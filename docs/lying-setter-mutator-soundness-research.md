# Lying Setter/Mutator Soundness Research

> Comprehensive analysis of the "lying setter" unsoundness in TypeScript's CFA
> and its implications for the `stable`/`mutator` modifier system in TypeScript-Go.
>
> **Status:** Research Complete  
> **Decision:** Document & Accept (consistent with TypeScript's existing approach)  
> **Related:** [lying-setter-prevention-research.md](lying-setter-prevention-research.md) (strategy deep-dive)

---

## 1. Executive Summary

TypeScript narrows types after property assignment by assuming the setter faithfully stores the
assigned value. This assumption can be violated by "lying" setters — setters that discard,
transform, or conditionally store the value. The same unsoundness applies to our `stable`/`mutator`
system, where CFA narrows a `stable` reference's type after a `mutator` call.

**Key findings:**

1. The unsoundness mechanism is **identical** between TS getter/setter CFA and our stable/mutator CFA —
   both funnel through `getAssignmentReducedType`.
2. Our unsoundness is **strictly less risky** than TypeScript's: it requires explicit opt-in via the
   `mutator` keyword, whereas TS applies narrowing to all property assignments through setters implicitly.
3. No known real-world signal implementation "lies" — TC39 Signals, Angular, SolidJS, and Preact all
   guarantee faithful storage.
4. TypeScript already accepts 8+ deliberate unsoundness points. Getter/setter CFA (added in TS 4.4)
   is one of them.

**Recommendation:** Document and accept this unsoundness, consistent with TypeScript's philosophy
that practical ergonomics outweigh theoretical soundness for rare edge cases. Reserve `volatile`
as a future opt-out escape hatch if real-world demand emerges.

---

## 2. The Problem

### 2.1 TypeScript Getter/Setter Version

```ts
class Player {
  #score: null | string | number = null;
  
  get score(): number | null | string { return this.#score; }
  
  set score(value: number | string | null) {
    this.#score = null;  // ALWAYS stores null, ignores input!
  }
}

const p = new Player();

if (p.score == null) {
  p.score = null;
  p.score = '';           // CFA narrows p.score to string
  p.score.length;         // ❌ RUNTIME ERROR! score is actually null
}
```

After `p.score = ''`, TypeScript's CFA removes `null` and `number` from the declared type
`number | null | string`, concluding that `p.score` must be `string`. But the setter silently
discards the value and stores `null` instead. The getter returns `null`, and `.length` crashes.

### 2.2 Stable/Mutator Version

```ts
class BadResource<T> {
  #value: T | undefined = undefined;
  
  value: stable () => T | undefined = () => this.#value;
  
  set: mutator (v: T) => void = (v) => {
    this.#value = undefined;  // ignores v!
  };
}

const r = new BadResource<string>();
r.set("hello");       // CFA narrows r.value() to string
r.value();            // ❌ RUNTIME ERROR: actual value is undefined
```

The same mechanism applies: CFA sees `r.set("hello")` and narrows the `stable` reference
`r.value()` from `string | undefined` to `string`. But the mutator discards the argument,
so `r.value()` actually returns `undefined`.

### 2.3 Why This Matters

Both cases violate the **contract** that the CFA relies on:

> **Setter/mutator contract:** After calling a setter/mutator with a value of type `T`,
> the getter/stable reference will return a value of type `T`.

This is not a bug in the type system — it is a **contract violation by the implementation**.
The type system assumes the contract holds because it has no way to verify implementation
behavior at the type level.

---

## 3. TypeScript's Existing Behavior

### 3.1 How Setter CFA Works

TypeScript 4.4 introduced narrowing after property assignment. When you write `x.prop = value`,
CFA filters the declared type of `x.prop` to only the union constituents that are assignable
from `typeof value`.

The mechanism is in `getTypeAtFlowAssignment` in the checker:

```go
// In flow.go, line ~289:
if t.flags&TypeFlagsUnion != 0 {
    return FlowType{t: c.getAssignmentReducedType(t, c.getInitialOrAssignedType(f, flow))}
}
```

`getAssignmentReducedType` (at [flow.go line 3599](../internal/checker/flow.go#L3599)) filters a union type:

```go
func (c *Checker) getAssignmentReducedType(declaredType *Type, assignedType *Type) *Type {
    // ... filters declaredType's union constituents to those assignable from assignedType
}
```

### 3.2 TypeScript's Acceptance of This Unsoundness

The TypeScript team explicitly accepted this unsoundness when shipping getter/setter CFA.
Their reasoning:

1. **Pragmatism over purity:** The vast majority of setters faithfully store values. Narrowing
   after assignment is enormously useful for everyday code.
2. **Consistency:** Regular property assignments (`x.y = v`) have always been narrowed. Not
   narrowing setter assignments would create an unexplainable inconsistency.
3. **No verification is possible:** The type system cannot statically determine whether a setter
   faithfully stores the value. Any heuristic would be incomplete.
4. **Existing precedent:** TypeScript already accepts multiple unsoundness points (see Section 8).

### 3.3 What TypeScript Does NOT Do

TypeScript does not:
- Warn when a setter discards or transforms the value
- Provide an opt-out annotation (no `volatile`, `unsafe`, or similar modifier)
- Distinguish between "lying" and "faithful" setters in the type system
- Offer a lint rule for this pattern

It is simply accepted as a known limitation.

---

## 4. The Exact Parallel: Side-by-Side

### 4.1 Code Path Comparison

Both TypeScript's getter/setter CFA and our stable/mutator CFA converge on the same function:

| Step | TS getter/setter CFA | Our stable/mutator CFA |
|------|---------------------|----------------------|
| Trigger | `p.score = ''` (property assignment) | `r.set('')` (mutator call) |
| Flow node | `FlowAssignment` | `FlowCall` (with mutator flag) |
| Entry point | `getTypeAtFlowAssignment` | `getTypeAtFlowCall` → `getMutatorCallNarrowedType` |
| Value type | `getInitialOrAssignedType(flow)` → `string` | `getTypeOfExpression(args[0])` → `string` |
| Narrowing | `getAssignmentReducedType(declaredType, string)` | `getAssignmentReducedType(declaredType, string)` |
| Result | `number \| null \| string` → `string` | `string \| undefined` → `string` |

### 4.2 The Mutator Narrowing Code

From [flow.go lines 940–953](../internal/checker/flow.go#L940-L953):

```go
func (c *Checker) getMutatorCallNarrowedType(f *FlowState, mutatorCall *ast.Node) *Type {
    if !ast.IsCallExpression(mutatorCall) || len(mutatorCall.Arguments()) == 0 {
        return nil
    }
    if f.declaredType.flags&TypeFlagsUnion == 0 {
        return nil
    }
    argType := c.getTypeOfExpression(mutatorCall.Arguments()[0])
    reduced := c.getAssignmentReducedType(f.declaredType, argType)
    if reduced == f.declaredType {
        return nil
    }
    return reduced
}
```

This is a direct parallel:
- `argType` ↔ the assigned value type in TS's property assignment
- `f.declaredType` ↔ the declared property type
- `getAssignmentReducedType` ↔ the exact same function used by TS

### 4.3 Risk Comparison

| Dimension | TS getter/setter CFA | Our stable/mutator CFA |
|-----------|---------------------|----------------------|
| Trigger | Any property assignment via setter | Only explicit `mutator` calls |
| Opt-in | **Implicit** — all properties with get/set | **Explicit** — requires `mutator` keyword |
| Risk scope | Every property with a setter | Only annotated members |
| Developer intent | May not realize CFA narrows | Deliberately requested narrowing |
| Verification | None | None (same) |
| Real-world lying | Rare | Very rare (signals never lie) |
| Reversibility | Can't opt out | Could add `volatile` later |

**Conclusion:** Our unsoundness is a strict subset of TypeScript's existing unsoundness,
with additional safety from requiring explicit opt-in.

---

## 5. Taxonomy of "Lying" Patterns

A comprehensive catalog of the ways a setter or mutator can violate the storage contract.

### 5.1 Ignores Value (Most Dangerous)

The setter/mutator completely discards the assigned value.

```ts
// Getter/setter:
class A {
  #x: string | null = null;
  get x(): string | null { return this.#x; }
  set x(v: string | null) { /* noop — discards v */ }
}

// stable/mutator:
class B {
  #x: string | null = null;
  x: stable () => string | null = () => this.#x;
  setX: mutator (v: string) => void = (v) => { /* noop */ };
}
```

**Risk:** High. CFA narrows to the assigned type, but the stored value is unchanged.

### 5.2 Always Stores a Fixed Value

A special case of "ignores value" — the setter always writes a specific value.

```ts
class Player {
  #score: null | string | number = null;
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) {
    this.#score = null;  // always stores null
  }
}
```

**Risk:** High. This is the motivating example — the setter appears to accept any value
but always stores `null`.

### 5.3 Transforms Value

The setter stores a transformation of the input, changing its type.

```ts
class C {
  #x: string | number = 0;
  get x(): string | number { return this.#x; }
  set x(v: string | number) {
    this.#x = String(v);  // always stores string, even if v is number
  }
}

const c = new C();
c.x = 42;           // CFA narrows to number
typeof c.x;          // "string" at runtime — CFA was wrong!
```

**Risk:** Medium. The type changes but within the declared union, so errors are subtler.

### 5.4 Conditional Write

The setter only stores the value if it passes validation.

```ts
class D {
  #x: string | null = null;
  get x(): string | null { return this.#x; }
  set x(v: string | null) {
    if (v !== null && v.length > 0) {
      this.#x = v;
    }
    // else: silently drops the assignment
  }
}

const d = new D();
d.x = "";            // CFA narrows to string, but setter rejected it
d.x;                 // null at runtime
```

**Risk:** Medium. The setter sometimes stores faithfully, sometimes not.

### 5.5 Async/Deferred Write

The setter schedules the write for later, not synchronously.

```ts
class E {
  #x: string | null = null;
  get x(): string | null { return this.#x; }
  set x(v: string | null) {
    setTimeout(() => { this.#x = v; }, 0);
  }
}

const e = new E();
e.x = "hello";       // CFA narrows to string
e.x;                 // null — the write hasn't happened yet!
```

**Risk:** Low. This is a timing issue rather than a type issue. The value will eventually
be correct, but not synchronously.

### 5.6 Getter Returns Different Source

The getter reads from a different source than where the setter writes.

```ts
class F {
  #x: string | null = null;
  #y: string | null = null;
  
  get x(): string | null { return this.#y; }  // reads from #y
  set x(v: string | null) { this.#x = v; }    // writes to #x
}

const f = new F();
f.x = "hello";       // writes to #x, CFA narrows to string
f.x;                 // reads from #y — null!
```

**Risk:** Low in practice. This is a clear programming error, not a realistic pattern.

### 5.7 Non-Deterministic Getter

The getter doesn't read from storage at all.

```ts
class G {
  get x(): string | number { return Math.random() > 0.5 ? "a" : 42; }
  set x(v: string | number) { /* stored somewhere */ }
}
```

**Risk:** N/A for the lying setter problem specifically, but illustrates that getters
can also violate expectations. A `stable` modifier on such a getter would be the lie here.

### 5.8 Summary Table

| Pattern | Frequency | Severity | Detectable? |
|---------|-----------|----------|-------------|
| Ignores value | Very rare | Critical | Not statically |
| Fixed value | Very rare | Critical | Partially (lint) |
| Transforms value | Rare | Medium | Partially (type comparison) |
| Conditional write | Uncommon | Medium | Not statically |
| Async write | Rare | Low | Not statically |
| Different source | Very rare | Low | Not statically |
| Non-deterministic getter | Very rare | N/A | Not for setters |

---

## 6. Real-World Risk Assessment

### 6.1 Signal Implementations Never Lie

The primary use case for `stable`/`mutator` is reactive signal APIs. Every major signal
implementation guarantees faithful storage:

| Framework | API | Faithful? | Notes |
|-----------|-----|-----------|-------|
| TC39 Signals | `signal.set(v)` | ✅ Yes | Spec mandates it |
| Angular | `WritableSignal.set(v)` | ✅ Yes | Always stores value |
| SolidJS | `createSignal()[1](v)` | ✅ Yes | Direct storage |
| Preact | `signal.value = v` | ✅ Yes | Direct storage |
| Vue | `ref.value = v` | ✅ Yes | Reactive wrapper, faithful |
| Svelte | `$state` rune | ✅ Yes | Compiler-managed |
| Jotai | `useSetAtom(atom)` | ✅ Yes | Atom update |

**No known signal implementation "lies."** The entire purpose of a signal setter is
to update the stored value and notify subscribers. A signal that discards its input
would be useless.

### 6.2 When Would a Mutator Lie?

For a `mutator` to lie, a developer would need to:

1. Explicitly annotate a function as `mutator` (already an unusual step)
2. Write an implementation that discards or transforms the argument
3. Have other code rely on the narrowed type after the call

This is a deliberate three-step process. By contrast, TypeScript's getter/setter
unsoundness can occur accidentally when a developer writes a setter that performs
validation or transformation — a common pattern in real code.

### 6.3 Empirical Evidence

A search across major open-source TypeScript codebases for "lying setters" finds:

- **Validation setters** (conditional write): Somewhat common, but these typically
  throw on invalid input rather than silently discarding it.
- **Transform setters** (`set x(v) { this.#x = normalize(v); }`): Uncommon but real.
  Usually the transformation preserves the type.
- **Noop setters**: Extremely rare. Usually indicates a read-only property that should
  use `readonly` instead.

### 6.4 Risk Verdict

The risk of `stable`/`mutator` lying is **negligible** in practice:

- The primary use case (signals) is provably faithful.
- The opt-in nature means only deliberate users are affected.
- The lying patterns that exist are overwhelmingly rare and usually accidental bugs.

---

## 7. Prevention Strategy Analysis

Ten strategies were analyzed in depth (see [lying-setter-prevention-research.md](lying-setter-prevention-research.md)
for the full analysis). Here is a summary ranking:

### 7.1 Document & Accept — Feasibility: 9/10

**Approach:** Accept the unsoundness as a known limitation. Document it prominently.

```ts
// ✅ The contract: mutators MUST faithfully store the value.
// Violating this contract leads to incorrect CFA narrowing.
// This is consistent with TypeScript's treatment of setters.
```

**Pros:**
- Consistent with TypeScript's philosophy
- Zero implementation cost
- Zero compatibility risk
- Zero ergonomic penalty

**Cons:**
- Does not prevent the issue (but neither does TypeScript)

### 7.2 `volatile` Opt-Out Modifier — Feasibility: 6/10

**Approach:** Add a future `volatile` modifier that suppresses narrowing.

```ts
class UnsafeResource<T> {
  value: stable () => T | undefined = () => this.#value;
  set: volatile mutator (v: T) => void = (v) => {
    // volatile signals that CFA should NOT narrow after this call
  };
}
```

**Pros:**
- Precise opt-out for known-lying implementations
- Composable with existing modifier system
- No cost for the common (faithful) case

**Cons:**
- Adds complexity to the modifier system
- No immediate demand (signals don't lie)
- Implementation and specification cost

### 7.3 Lint Rule — Feasibility: 5/10

**Approach:** A lint rule that warns when a setter/mutator implementation doesn't use its argument.

```ts
// ⚠️ Warning: mutator parameter 'v' is not used in the function body.
// This may indicate a "lying mutator" that doesn't store the assigned value.
set: mutator (v: T) => void = (v) => { this.#value = undefined; };
```

**Pros:**
- Catches the most obvious cases ("ignores value", "fixed value")
- Non-breaking, advisory only

**Cons:**
- Cannot detect transform, conditional, or async patterns
- Cannot analyze `.d.ts` declarations (no implementation to inspect)
- False positives possible (e.g., mutator that logs but delegates storage)

### 7.4 Don't Narrow After Mutator — Feasibility: 1/10

**Approach:** Remove narrowing after mutator calls entirely.

**Why it's rejected:** This eliminates the primary value proposition of the `mutator` modifier.
Without narrowing, there is no reason to have `mutator` at all — developers would just use
regular functions. This is a non-starter.

### 7.5 Structural Verification — Feasibility: 3/10

**Approach:** Statically verify that the setter/mutator implementation stores the value.

**Why it's impractical:**
- Cannot analyze `.d.ts` declarations (most library code)
- Cannot verify behavior across module boundaries
- Cannot determine if a function call inside the setter stores the value
- Would need full program analysis for non-trivial implementations

### 7.6 Other Strategies (2–4/10)

| Strategy | Feasibility | Issue |
|----------|-------------|-------|
| Only narrow if types match exactly | 5/10 | Incomplete — matching types can still lie |
| Narrow to intersection | 4/10 | No improvement — same result for common unions |
| Require `faithful`/`pure` annotation | 3/10 | Wrong default — all setters would need annotation |
| Runtime assertion injection | 2/10 | TypeScript doesn't emit runtime code |
| Dependent types / refinement types | 2/10 | Beyond TypeScript's type system |

---

## 8. TypeScript Precedent: Accepted Unsoundness

TypeScript deliberately accepts multiple unsoundness points. Our lying setter/mutator
is consistent with this established philosophy.

### 8.1 Bivariant Method Parameters

```ts
interface Animal { name: string; }
interface Dog extends Animal { breed: string; }

interface Comparer<T> {
  compare(a: T, b: T): number;  // method syntax — bivariant
}
declare let animalComparer: Comparer<Animal>;
declare let dogComparer: Comparer<Dog>;

animalComparer = dogComparer; // ✅ Allowed — unsound!
```

Methods use bivariant parameter checking. `--strictFunctionTypes` fixes this for
function-property syntax but not method syntax, for backward compatibility.

### 8.2 `any` Type

```ts
const x: any = 42;
x.nonexistent.property.chain;  // ✅ No error — crashes at runtime
```

Explicit escape hatch. Accepted because it enables gradual typing and migration.

### 8.3 Type Assertions (`as`)

```ts
const x = "hello" as unknown as number;
x.toFixed(2);  // ✅ No error — crashes at runtime
```

Explicit escape hatch for developer-asserted type knowledge.

### 8.4 Covariant Arrays

```ts
const dogs: Dog[] = [{ name: "Rex", breed: "Labrador" }];
const animals: Animal[] = dogs;  // ✅ Allowed — unsound!
animals.push({ name: "Cat" });   // Pushes a non-Dog into dogs array
dogs[1].breed;                   // ❌ Runtime error — no breed property
```

Arrays are covariant in TypeScript for ergonomic reasons. Making them invariant would
break enormous amounts of code.

### 8.5 Index Signatures

```ts
const dict: { [key: string]: number } = { a: 1 };
const value: number = dict["nonexistent"];  // ✅ No error — value is undefined
value.toFixed(2);  // ❌ Runtime error
```

Index signatures assume all keys exist. `--noUncheckedIndexedAccess` is the opt-in fix.

### 8.6 `delete` on Required Properties

```ts
interface Config { debug: boolean; }
const config: Config = { debug: true };
delete (config as any).debug;  // bypasses type check
// config.debug is now undefined, but type says boolean
```

### 8.7 Getter/Setter CFA (Our Exact Parallel)

```ts
class X {
  #v: string | null = null;
  get v() { return this.#v; }
  set v(x: string | null) { this.#v = null; }
}
const x = new X();
x.v = "hello";   // Narrowed to string
x.v.length;      // ❌ Runtime error — v is null
```

This is the exact pattern we're analyzing. TypeScript accepted it in TS 4.4.

### 8.8 `in` Operator Narrowing

```ts
function f(x: { a: number } | { b: string }) {
  if ("a" in x) {
    x.a;  // narrowed — but x could have BOTH a and b
  }
}
```

The `in` operator narrows to the branch containing the property, but objects can have
extra properties beyond their declared type.

### 8.9 Summary

TypeScript's type system is **intentionally unsound** in service of pragmatism.
The TypeScript team's design principle is:

> "We want to strike a balance between correctness and productivity."
> — TypeScript Design Goals

Our lying setter/mutator unsoundness is fully consistent with this principle:
- It mirrors an existing accepted unsoundness (getter/setter CFA)
- It requires **more** explicit developer action to trigger (mutator keyword)
- It affects a use case where lying is empirically non-existent (signals)

---

## 9. The Core Insight

### 9.1 Contract Violation, Not Type System Bug

The lying setter/mutator is not a bug in the type system. It is a **contract violation**
by the implementation.

When a developer writes:
```ts
set: mutator (v: T) => void
```

They are making a contract with the type system:

> "Calling `set(v)` will cause the associated `stable` property to return a value
> consistent with `v`'s type."

A lying mutator violates this contract, just as a lying setter violates TypeScript's
implicit property-assignment contract.

### 9.2 The Type System Cannot Verify Contracts

No decidable type system can verify arbitrary behavioral contracts. To prove that a setter
faithfully stores its value, you would need:

1. **Effect tracking** — know which memory locations the setter modifies
2. **Aliasing analysis** — know what the getter reads
3. **Equivalence checking** — prove that the getter returns the stored value

This is equivalent to the halting problem for non-trivial implementations.

### 9.3 The Available Options

Given that verification is impossible, the options are:

| Option | Effect |
|--------|--------|
| Don't narrow | Lose the feature entirely |
| Always narrow | Accept the unsoundness (TypeScript's choice) |
| Narrow with opt-out | Accept by default, allow escape (future `volatile`) |
| Narrow with opt-in | Require annotation for every narrowing (too verbose) |

TypeScript chose "always narrow." We choose "always narrow for explicit mutators" —
which is strictly more conservative.

### 9.4 The Analogy

The lying setter problem is analogous to:

- **`@override` in Java:** The compiler trusts that `@Override` methods actually override
  a parent method. If you manually construct a class hierarchy that lies, the compiler
  won't catch it. But nobody does this.
- **`const` in C++:** The compiler trusts that `const` methods don't modify state.
  You can use `mutable` or `const_cast` to lie. But nobody considers `const` broken.
- **`pure` in Haskell:** Functions marked `IO`-free are trusted. You can use
  `unsafePerformIO` to lie. But nobody considers the purity system broken.

In all cases: the annotation establishes a contract, and the type system trusts it.

---

## 10. Recommendation

### 10.1 Primary: Document & Accept

Accept the lying setter/mutator unsoundness as a known, documented limitation.
This is consistent with TypeScript's treatment of getter/setter CFA and the broader
philosophy of pragmatic unsoundness.

**Documentation should state:**

> The `mutator` modifier establishes a contract: calling a mutator with a value of type `T`
> causes the associated `stable` reference to return a value consistent with `T`. CFA narrows
> the stable reference accordingly. If a mutator implementation does not faithfully store the
> value, narrowing will be incorrect. This is analogous to TypeScript's existing behavior with
> property assignment through setters.

### 10.2 Secondary: Reserve `volatile` as Future Escape Hatch

If real-world demand emerges for suppressing narrowing on specific mutators, introduce
a `volatile` modifier:

```ts
interface UncachedResource<T> {
  value: stable () => T | undefined;
  refresh: volatile mutator (v: T) => void;  // no narrowing after call
}
```

This is a low-priority, future consideration. No signal implementation needs it today.

### 10.3 Tertiary: Consider a Supplementary Lint Rule

An optional lint rule could warn when:
- A mutator/setter parameter is unused in the function body
- A mutator/setter always writes a literal value regardless of input

This catches the most egregious cases without adding type system complexity.

---

## 11. Open Questions

### 11.1 Should `volatile` Apply to Getters Too?

A `volatile` getter would suppress caching optimizations (if we ever add them).
This is a separate concern from the lying setter problem but worth considering
for a unified modifier design.

### 11.2 Should We Warn on Type-Asymmetric Mutators?

If a `mutator` parameter type is wider than the `stable` return type:
```ts
value: stable () => string;
set: mutator (v: string | number) => void;
```
This is suspicious — the mutator accepts values the stable reference can't return.
Should we warn? Currently we don't, and TypeScript doesn't warn for the getter/setter
analog either.

### 11.3 Could `mutator` Be Weakened to "Reset" Narrowing?

Instead of narrowing to the argument type, a mutator call could simply reset the
stable reference to its declared type (i.e., invalidate narrowing without applying
new narrowing). This would be sound but less useful.

```ts
const r: Resource<string> = createResource();
// r.value() : string | undefined
r.set("hello");
// Weakened: r.value() : string | undefined (reset, not narrowed)
// Current:  r.value() : string             (narrowed)
```

This sacrifices the main ergonomic benefit and is not recommended.

### 11.4 Multi-Argument Mutators

For mutators with multiple arguments, which argument determines the narrowed type?
Currently we use the first argument. Is this always correct?

```ts
interface Map<K, V> {
  get: stable (key: K) => V | undefined;
  set: mutator (key: K, value: V) => void;
}
```

For `Map.set(key, value)`, the narrowing should be based on `value` (arg 1), not `key` (arg 0).
This may need refinement for multi-argument mutators.

### 11.5 Interaction with `satisfies` and Other Checks

Does `satisfies` interact with mutator narrowing?
```ts
const r = createResource<string>();
r.set("hello");
r.value() satisfies string;  // Should this work after narrowing?
```

Currently this works because `satisfies` checks the narrowed type. If CFA is wrong
due to a lying mutator, `satisfies` would also be wrong — but this is consistent
with how `satisfies` interacts with all CFA narrowing.

---

## 12. References

### Internal Documents

- [lying-setter-prevention-research.md](lying-setter-prevention-research.md) — Deep-dive analysis
  of 10 prevention strategies with implementation details
- [stable-modifier-spec.md](stable-modifier-spec.md) — Specification for the `stable` modifier
- [stable-heuristic-uncertainty-boundaries-research.md](stable-heuristic-uncertainty-boundaries-research.md) —
  Research on uncertainty boundaries in CFA
- [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) —
  How mutator effects propagate transitively

### Codebase

- [internal/checker/flow.go](../internal/checker/flow.go) — CFA implementation
  - `getTypeAtFlowAssignment` (line ~269) — property assignment narrowing
  - `getMutatorCallNarrowedType` (line ~940) — mutator call narrowing
  - `getAssignmentReducedType` (line ~3599) — shared narrowing logic

### External

- [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals)
- [TypeScript 4.4 Release Notes — CFA for Aliased Conditions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-4.html)
- [TC39 Signals Proposal](https://github.com/tc39/proposal-signals)
- [Angular Signals Documentation](https://angular.dev/guide/signals)
