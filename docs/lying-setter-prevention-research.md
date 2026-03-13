# Lying Setter/Mutator Prevention Strategies

> Research document analyzing 10 prevention strategies for the "lying setter" unsoundness
> in TypeScript's control flow analysis, with implications for the `stable`/`mutator` system.

---

## The Problem Statement

TypeScript narrows property types after assignment by assuming the setter stores the assigned value faithfully. This assumption is unsound when setters discard or transform the value:

```ts
class Player {
  #score: null | string | number = null;
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) {
    this.#score = null; // ALWAYS stores null — lying setter!
  }
}
const p = new Player();
p.score = '';           // CFA narrows to string
p.score.length;         // RUNTIME ERROR — actual value is null
```

The same pattern applies to `stable`/`mutator`:

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}
// Implementation:
function createBrokenResource<T>(): Resource<T> {
  return {
    value: () => undefined,  // always returns undefined
    set: (v: T) => { /* discards v */ },
  };
}
const r = createBrokenResource<string>();
r.set("hello");       // mutator narrows r.value() to string
r.value().length;      // RUNTIME ERROR — actual value is undefined
```

### Mechanism in the Codebase

The narrowing after assignment happens in `getTypeAtFlowAssignment` (see [flow.go](internal/checker/flow.go#L269-L288)):

```go
if t.flags&TypeFlagsUnion != 0 {
    return FlowType{t: c.getAssignmentReducedType(t, c.getInitialOrAssignedType(f, flow))}
}
```

For mutators, narrowing happens in `getMutatorCallNarrowedType` (see [flow.go](internal/checker/flow.go#L940-L955)):

```go
func (c *Checker) getMutatorCallNarrowedType(f *FlowState, mutatorCall *ast.Node) *Type {
    argType := c.getTypeOfExpression(mutatorCall.Arguments()[0])
    reduced := c.getAssignmentReducedType(f.declaredType, argType)
    // ...
    return reduced
}
```

Both use `getAssignmentReducedType`, which filters the union type to only constituents assignable from the assigned/argument type — **assuming the stored value matches the assigned value**.

---

## Strategy 1: Don't Narrow After Setter/Mutator (Nuclear Option)

### How It Works

Simply remove assignment-based narrowing for property accesses through setters and for stable references after mutator calls.

```ts
class Player {
  #score: null | string | number = null;
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) { this.#score = value; }
}

const p = new Player();
p.score = '';
// Strategy 1: p.score is still number | null | string (no narrowing)
if (typeof p.score === 'string') {
  p.score.length; // only narrowed INSIDE guard
}
```

For `stable`/`mutator`:
```ts
const r: Resource<string> = createResource();
r.set("hello");
// Strategy 1: r.value() is still string | undefined (no narrowing)
if (r.value() !== undefined) {
  r.value().length; // only narrowed inside guard
}
```

### Soundness Assessment

**Fully sound.** No false narrowing occurs. If the setter lies, the developer must re-check.

### Backward Compatibility

**Severely breaking.** TypeScript currently narrows properties after assignment:

```ts
let x: { value: string | number } = { value: 42 };
x.value = "hello";
x.value.length; // Currently works — narrowed to string
```

This is one of the most used CFA behaviors. Removing it would break enormous amounts of code.

For setters specifically, the breakage is smaller (most code uses direct properties), but the inconsistency between property-assignment narrowing and setter-assignment narrowing would be confusing.

### Ergonomics

**Poor.** Developers would need explicit guards after every setter call, even when the setter is trivially faithful. Code becomes substantially more verbose.

### Implementation Complexity

**Trivial.** In `getTypeAtFlowAssignment`, skip narrowing when the assignment target resolves to a setter. In the mutator path, skip calling `getMutatorCallNarrowedType`.

### Feasibility: 2/10

The soundness gain does not justify the massive ergonomic and compatibility cost.

---

## Strategy 2: Only Narrow If Getter and Setter Types Match Exactly

### How It Works

TypeScript 4.3+ allows different types for getters and setters. Only narrow after assignment when the getter and setter signatures are identical.

```ts
// Matching types — narrowing allowed
class A {
  get value(): string | number { ... }
  set value(v: string | number) { ... }
}
const a = new A();
a.value = "hello";
a.value.length; // ✓ narrowed to string

// Mismatched types — narrowing suppressed
class B {
  get value(): string | number { ... }
  set value(v: string | number | boolean) { ... }
}
const b = new B();
b.value = "hello";
// b.value still string | number — not narrowed
```

For `mutator`/`stable`, compare the mutator parameter type with the stable return type:
```ts
interface Resource<T> {
  value: stable () => T | undefined;   // returns T | undefined
  set: mutator (v: T) => void;         // accepts T (not T | undefined)
}
// Types don't match → no narrowing after set()
```

### Soundness Assessment

**Partially sound.** Catches cases where getter/setter type asymmetry signals transformation. But:
- Even with matching types, a setter can still lie (e.g., always store `null` when the type includes `null`)
- The asymmetric-type case (TS 4.3+) is relatively rare

### Backward Compatibility

**Minor breakage.** Only affects the small set of code using asymmetric getter/setter types AND relying on post-assignment narrowing. Most real code has matching types.

### Ergonomics

**Good.** The type signature already communicates the asymmetry; no extra annotation needed. Developers with matching types see no change.

### Implementation Complexity

**Low.** In `getTypeAtFlowAssignment`, resolve the setter signature and getter return type. If they differ, skip narrowing.

### Feasibility: 5/10

Handles one specific case but doesn't address the core problem. Limited utility as a standalone solution.

---

## Strategy 3: Narrow to Intersection of Assigned Type and Getter Return Type

### How It Works

After `p.score = ''`, narrow to `typeof '' & ReturnType<get score>` = `string & (number | null | string)` = `string`.

```ts
class Player {
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) { ... }
}
const p = new Player();
p.score = '';
// Narrowed to: string & (number | null | string) = string
// This IS what TypeScript currently does
```

### Soundness Assessment

**This is the status quo.** TypeScript already narrows this way. The logic is correct for the *type* — `string` is the right narrowed type *given the assumption that the value was stored*. The unsoundness isn't in the narrowing logic; it's in the assumption that assignment implies storage.

```ts
// The type logic is correct:
// assigned type = string
// declared type = number | null | string
// reduced type = string (only constituent assignable from string)
// The ERROR is: the actual runtime value might not be string
```

### Backward Compatibility

**None — this is current behavior.**

### Ergonomics

**Good — this is current behavior.**

### Implementation Complexity

**Zero — already implemented.**

### Feasibility: N/A

This isn't a prevention strategy; it's the existing behavior reframed. The analysis reveals that the bug isn't in narrowing arithmetic — it's in the foundational assumption.

---

## Strategy 4: Structural Verification of Setter Body

### How It Works

When the compiler can see the setter body, verify that it stores the parameter value in the backing field.

```ts
// VERIFIED — setter stores parameter
class Good {
  #value: string | number = 0;
  get value() { return this.#value; }
  set value(v: string | number) {
    this.#value = v; // Compiler detects: parameter stored ✓
  }
}

// WARNING — setter doesn't store parameter
class Bad {
  #value: string | number = 0;
  get value() { return this.#value; }
  set value(v: string | number) {
    this.#value = null as any; // Compiler detects: parameter NOT stored ⚠
  }
}
```

For mutators:
```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

// Can only verify if we see the implementation:
function createResource<T>(initial?: T): Resource<T> {
  let stored: T | undefined = initial;
  return {
    value: () => stored,             // ✓ returns stored
    set: (v: T) => { stored = v; },  // ✓ stores parameter
  };
}
```

### Soundness Assessment

**Sound when verifiable, useless otherwise.** Key limitations:

1. **`.d.ts` files** — Can't see the body. Most library code comes through declarations.
2. **Interface implementations** — Can't verify conformance until runtime dispatch.
3. **Abstract methods** — No body to verify.
4. **Indirect mutation** — `set value(v) { this.helper(v); }` requires cross-function analysis.
5. **Dynamic behavior** — `set value(v) { this[key] = v; }` is undecidable.

### Backward Compatibility

**No breakage** if verification is advisory (warnings only). Breakage if made an error.

### Ergonomics

**Poor.** TypeScript philosophically avoids verifying function bodies for type soundness. This would be a novel enforcement mechanism inconsistent with the rest of the type system. Developers would find it confusing that the compiler checks setter bodies but not regular function bodies.

### Implementation Complexity

**Very high.** Requires:
- Intra-procedural data flow analysis for setter bodies
- Tracking which variables a setter writes to
- Matching backing field reads in the getter
- Handling indirect mutation patterns
- Distinguishing "stored faithfully" from "transformed"

This is essentially a mini escape analysis / effect system embedded in the compiler.

### Feasibility: 2/10

Enormous implementation cost for incomplete coverage. TypeScript's design philosophy explicitly avoids this kind of body-level verification.

---

## Strategy 5: `faithful` Annotation (Opt-in Safety)

### How It Works

Introduce a `faithful` modifier for setters and mutators that asserts the setter stores the value faithfully. Only narrow after `faithful` setters.

```ts
class Player {
  #score: null | string | number = null;
  get score(): number | null | string { return this.#score; }
  faithful set score(value: number | string | null) {
    this.#score = value; // Developer asserts this is faithful
  }
}
const p = new Player();
p.score = '';
p.score.length; // ✓ narrowed — setter is marked faithful

class Dishonest {
  #data: string | null = null;
  get data(): string | null { return this.#data; }
  set data(v: string | null) {
    this.#data = null; // No faithful marker
  }
}
const d = new Dishonest();
d.data = "hello";
d.data; // string | null — NOT narrowed (no faithful marker)
```

For mutators:
```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: faithful mutator (v: T) => void; // only narrows with faithful
}
```

### Soundness Assessment

**Sound by default.** Without `faithful`, no narrowing occurs. The `faithful` marker is a developer assertion — if they lie, they get the same unsoundness as today, but they explicitly opted in.

However, this inverts current behavior: the **default becomes "don't narrow"**, which is a massive breaking change.

### Backward Compatibility

**Severely breaking.** All existing setter-based narrowing stops working unless `faithful` is added. This includes plain property assignments (which go through setters internally in some cases).

To maintain compatibility, you'd need to auto-apply `faithful` to:
- Direct property assignments (no setter)
- Compiler-generated setters
- All existing code

This makes it nearly identical to Strategy 6 (see below).

### Ergonomics

**Poor for adoption.** Requires annotating every setter that should narrow. High annotation burden.

### Implementation Complexity

**Medium.** New modifier keyword, parser/binder changes, flag on setter declarations, check in flow analysis.

### Feasibility: 3/10

The opt-in direction is backwards — it breaks all existing code to prevent a rare edge case.

---

## Strategy 6: `volatile` Annotation (Opt-out Safety)

### How It Works

Introduce a `volatile` modifier for setters that DON'T guarantee faithful storage. Default behavior (no annotation) preserves current narrowing.

```ts
// Current behavior preserved — no annotation needed
class Player {
  #score: null | string | number = null;
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) {
    this.#score = value;
  }
}
const p = new Player();
p.score = '';
p.score.length; // ✓ narrowed — default is faithful

// Dishonest setter explicitly marked
class Cached {
  #cache: string | null = null;
  get data(): string | null { return this.#cache; }
  volatile set data(v: string | null) {
    // Setter does validation/transformation — volatile
    this.#cache = v ? v.toUpperCase() : null;
  }
}
const c = new Cached();
c.data = "hello";
c.data; // string | null — NOT narrowed (volatile)
```

For mutators:
```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: volatile mutator (v: T) => void; // won't narrow after call
}
```

### Soundness Assessment

**Partially sound.** Developers who know their setter lies can opt out. Developers who don't annotate get current (unsound) behavior. The unsoundness is still present by default — this just provides an escape valve.

### Backward Compatibility

**Fully backward compatible.** Default behavior unchanged. `volatile` is purely additive.

### Ergonomics

**Good.** The common case (faithful setter) requires no annotation. Only the rare lying-setter case needs `volatile`.

### Implementation Complexity

**Medium.** Similar to Strategy 5 — new modifier, parser changes, flow analysis check.

### Feasibility: 6/10

Good backward compat and ergonomics, but adds a keyword for a relatively rare problem. The `volatile` keyword also has C/C++ connotations that don't perfectly apply.

---

## Strategy 7: Lint Rule (External Enforcement)

### How It Works

An ESLint rule with TypeScript type information that detects setter bodies where the parameter is not stored:

```ts
// eslint: no-lying-setter
class Bad {
  #value: string | number = 0;
  get value() { return this.#value; }
  set value(v: string | number) {
    this.#value = null as any;
    //           ~~~~~~~~~~~~ ESLint: setter does not store parameter value
  }
}
```

For mutators, a rule that checks the implementation body:
```ts
// eslint: no-lying-mutator
const resource = {
  value: () => stored,
  set: (v: string) => {
    // stored = v; // missing!
    //~~~~~~~~~~~ ESLint: mutator does not store parameter
  },
};
```

### Soundness Assessment

**Not sound.** The type system itself remains unchanged. Errors are only caught if:
1. The lint rule is enabled
2. The setter body is visible (not `.d.ts`)
3. The rule's heuristics correctly identify the lie

### Backward Compatibility

**Fully compatible.** Lint rules are advisory and opt-in.

### Ergonomics

**Good.** No language changes. Developers can adopt incrementally. CI enforcement is possible.

### Implementation Complexity

**Low** for the lint rule itself. **Hard** for accuracy — the same body-analysis challenges from Strategy 4 apply, but in ESLint's analysis framework rather than the compiler.

Existing eslint rules with type information (via `@typescript-eslint`) can access type checker APIs, but complex data-flow analysis within setter bodies is beyond what most rules attempt.

### Feasibility: 5/10

Practical as a supplementary measure but cannot provide type-level guarantees. Good as part of a defense-in-depth approach.

---

## Strategy 8: Require Explicit Re-narrowing

### How It Works

Don't implicitly narrow after setter/mutator calls. Require developers to re-narrow explicitly:

```ts
class Player {
  get score(): number | null | string { return this.#score; }
  set score(value: number | string | null) { this.#score = value; }
}

const p = new Player();
p.score = '';
// No implicit narrowing
if (typeof p.score === 'string') {
  p.score.length; // ✓ Sound — explicitly re-narrowed
}
```

For `stable`/`mutator`:
```ts
const r: Resource<string> = createResource();
r.set("hello");
// No implicit narrowing — r.value() is still T | undefined
const v = r.value();
if (v !== undefined) {
  v.length; // ✓ Sound — explicitly checked
}
```

### Soundness Assessment

**Fully sound.** Every use of the narrowed value requires an explicit guard.

### Backward Compatibility

**Identical to Strategy 1.** This IS Strategy 1 from the developer's perspective — they're told "narrowing doesn't happen, do it yourself."

### Ergonomics

**Poor.** The explicit re-narrowing pattern is exactly what `stable`/`mutator` narrowing was designed to eliminate. Requiring it defeats the purpose of the feature.

For the setter case specifically, it makes common patterns like `x.value = "hello"; x.value.length` require a guard.

### Implementation Complexity

**Trivial.** Same as Strategy 1.

### Feasibility: 2/10

Same practical problems as Strategy 1. The whole point of CFA narrowing is to avoid manual checks.

---

## Strategy 9: Document and Accept the Unsoundness

### How It Works

Formally document the lying-setter unsoundness as a known trade-off, alongside TypeScript's other known unsoundness points:

```
Known Unsoundness Points in TypeScript:

1. Bivariant method parameters (strictFunctionTypes only applies to
   function-typed properties, not methods)
2. `any` type escapes all checking
3. Type assertions (`as T`, `!`) bypass narrowing
4. `in` operator narrows even without sealed objects
5. `delete` of required properties
6. Index signature assumptions (all keys assumed present)
7. Getter narrowing (getters can return different values)
8. **Setter-based narrowing (setters can discard values)** ← NEW
9. **Mutator-based narrowing (mutators can discard values)** ← NEW
```

### Soundness Assessment

**Not sound by definition.** This strategy accepts the unsoundness rather than preventing it.

### Backward Compatibility

**Fully compatible.** No code changes.

### Ergonomics

**Excellent.** Nothing changes for developers. The documentation simply makes the trade-off explicit.

### Implementation Complexity

**Zero.** Documentation only.

### The Case For This Strategy

TypeScript's design philosophy is well-established (from [TypeScript Design Goals](https://github.com/Microsoft/TypeScript/wiki/TypeScript-Design-Goals)):

> **Non-Goal #3:** Apply a sound or "provably correct" type system. Instead, strike a balance between correctness and productivity.

The lying-setter problem is **structurally identical** to the lying-getter problem, which TypeScript already accepts:

```ts
let counter = 0;
const tricky = {
  get value(): string | undefined {
    return counter++ === 0 ? "hello" : undefined;
  }
};
if (tricky.value !== undefined) {
  tricky.value.toUpperCase(); // TS says ✓, runtime 💥
}
```

TypeScript narrows getter returns across accesses despite this unsoundness. The setter case is symmetric.

For `stable`/`mutator`, this is even more explicit — the developer DECLARES that the function is stable and the method is a mutator. If the implementation lies, the declaration is wrong, which is the same failure mode as an incorrect type annotation:

```ts
function lie(): string {
  return 42 as any; // lying type annotation
}
const s: string = lie();
s.length; // runtime error
```

TypeScript doesn't prevent lying type annotations. `stable`/`mutator` are in the same category — declarative contracts that the developer asserts are correct.

### Feasibility: 9/10

The most pragmatic approach. Consistent with TypeScript's philosophy and precedent.

---

## Strategy 10: Phantom Evidence Types

### How It Works

The setter returns a phantom type token proving the value was stored. The getter uses the token to narrow:

```ts
// Phantom evidence brand
declare const STORED: unique symbol;
type Stored<T> = T & { readonly [STORED]: true };

class Player {
  #score: null | string | number = null;

  get score(): typeof this.#lastStored extends Stored<infer U> ? U : number | null | string {
    return this.#score;
  }

  set score(value: number | string | null): Stored<typeof value> {
    this.#score = value;
    return value as Stored<typeof value>; // phantom evidence
  }
}

const p = new Player();
const evidence = (p.score = ''); // evidence: Stored<string>
// Getter narrows based on evidence
p.score; // string (narrowed via evidence token)
```

For mutators:
```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => Stored<T>;
}

const r = createResource<string>();
const ev = r.set("hello"); // ev: Stored<string>
r.value(); // string — narrowed because evidence exists
```

### Soundness Assessment

**Theoretically sound** — the evidence type proves the value matches. But:
- Setter return values don't exist in JavaScript (setters return `undefined`)
- The evidence brand is itself a type assertion — a lying setter can produce fake evidence
- The conditional type machinery adds enormous complexity
- This requires dependent types or GADTs, which TypeScript doesn't have

### Backward Compatibility

**Massively breaking.** Setters returning values is not valid TypeScript/JavaScript.

### Ergonomics

**Terrible.** Developers must capture evidence tokens, thread them through code, and the types become incomprehensible.

### Implementation Complexity

**Extreme.** Requires:
- Setter return types (language change)
- Evidence type tracking in CFA
- Conditional type resolution based on flow state
- Essentially a linear type system

### Feasibility: 1/10

Academically interesting but completely impractical for TypeScript.

---

## Comparative Analysis

| # | Strategy | Soundness | Compat | Ergonomics | Complexity | Feasibility |
|---|----------|-----------|--------|------------|------------|-------------|
| 1 | Nuclear — no narrowing | ✅ Full | ❌ Breaking | ❌ Poor | Trivial | 2/10 |
| 2 | Match getter/setter types | ⚠️ Partial | ✅ Minor | ✅ Good | Low | 5/10 |
| 3 | Intersection (status quo) | ❌ Unsound | ✅ None | ✅ Good | Zero | N/A |
| 4 | Body verification | ⚠️ Partial | ✅ Good | ❌ Poor | Very High | 2/10 |
| 5 | `faithful` (opt-in) | ✅ Sound default | ❌ Breaking | ❌ Poor | Medium | 3/10 |
| 6 | `volatile` (opt-out) | ⚠️ Opt-in | ✅ Full | ✅ Good | Medium | 6/10 |
| 7 | Lint rule | ❌ Advisory | ✅ Full | ✅ Good | Low-Med | 5/10 |
| 8 | Explicit re-narrowing | ✅ Full | ❌ Breaking | ❌ Poor | Trivial | 2/10 |
| 9 | Document & accept | ❌ Unsound | ✅ Full | ✅ Excellent | Zero | 9/10 |
| 10 | Phantom evidence | ✅ Theoretical | ❌ Breaking | ❌ Terrible | Extreme | 1/10 |

---

## Final Synthesis

### Ranked Strategies

1. **Strategy 9 — Document & Accept** (9/10)
2. **Strategy 6 — `volatile` opt-out** (6/10)
3. **Strategy 2 — Getter/setter type matching** (5/10)
4. **Strategy 7 — Lint rule** (5/10)
5. **Strategy 5 — `faithful` opt-in** (3/10)
6. **Strategy 1 — Nuclear no-narrow** (2/10)
7. **Strategy 4 — Body verification** (2/10)
8. **Strategy 8 — Explicit re-narrow** (2/10)
9. **Strategy 10 — Phantom evidence** (1/10)

### Top 3 Recommendations

#### Recommendation 1: Document & Accept (Strategy 9)

**This is the right approach for TypeScript-Go.** The lying-setter problem is:

- **Symmetric with lying-getter** — TypeScript already accepts getter unsoundness
- **Consistent with TypeScript's philosophy** — productivity over provable correctness
- **Rare in practice** — setters that discard their parameter are unusual and typically bugs
- **Self-inflicted** — a developer who writes a lying setter AND relies on narrowing has a logic error in their own code, not a language deficiency
- **Identical to lying type annotations** — TypeScript doesn't prevent `function f(): string { return 42 as any; }`

For `stable`/`mutator` specifically: the modifiers are *declarative contracts*. A `mutator` that lies about storing its argument is equivalent to a function that lies about its return type. Both are developer errors, not type system deficiencies.

#### Recommendation 2: `volatile` Opt-out (Strategy 6) — as a future consideration

If empirical evidence shows lying setters cause real-world pain, a `volatile` modifier provides a clean escape hatch without breaking existing code. This could be added later if needed. The design would be:

```ts
class Cache {
  volatile set data(v: string) { /* may transform */ }
}
// After assignment to volatile setter, no narrowing occurs
```

For mutators, this would be:
```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: volatile mutator (v: T) => void;
}
```

**Don't implement this now.** Wait for user demand.

#### Recommendation 3: Lint rule (Strategy 7) — as a supplementary tool

A `@typescript-eslint` rule that detects setter bodies where the parameter is never stored can catch the most obvious lying-setter bugs. This doesn't require any language changes and provides defense-in-depth.

### Is the Unsoundness Worth Fixing?

**No — not at the language level.** The pragmatic assessment:

1. **Frequency**: Lying setters are rare. Most setters either store the value directly or transform it in type-compatible ways (e.g., clamping a number, which doesn't change the narrowed type).

2. **Detectability**: When a lying setter causes a bug, it's typically caught quickly at runtime. The debugging path is clear — "I set X but got Y back."

3. **Developer responsibility**: The person writing the setter and the person relying on narrowing are typically the same person or team. This isn't a case where one developer's code silently corrupts another's types.

4. **Cost/benefit**: Every prevention strategy that actually achieves soundness either breaks existing code (Strategies 1, 5, 8) or requires machinery disproportionate to the problem (Strategies 4, 10). The "cure" is worse than the "disease."

5. **Precedent**: TypeScript has **at least 7 other known unsoundness points** (bivariant methods, `any`, assertions, `in` operator, `delete`, index signatures, getter narrowing). The lying-setter case is less severe than most of these because it requires the developer to actively write contradictory code.

6. **For `stable`/`mutator` specifically**: The modifiers are voluntary opt-in annotations. A developer who marks a function `stable` is asserting correctness. If they lie, they've made a false assertion — the same class of error as `as any` or `!` — and TypeScript has never tried to prevent those.

**Final verdict: Document the unsoundness, accept it as consistent with TypeScript's design philosophy, and move on.**
