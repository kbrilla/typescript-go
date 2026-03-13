# Purity, Readonly, and Effect Annotation Systems for TypeScript

> Research document analyzing approaches to preserving `stable` narrowing
> across uncertainty boundaries via purity/effect annotations.

**Status**: Research (informational)  
**Context**: Phase 1 `stable`/`mutator`/`invalidates` system in TypeScript-Go  
**Related**:
- [stable-modifier-spec.md](stable-modifier-spec.md) — Phase 1 SDD
- [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) — Transitive mutator research
- [escape-analysis-research.md](escape-analysis-research.md) — Escape analysis research

---

## 1. Motivating Problem

The `stable`/`mutator` system preserves narrowing across repeated reads and
invalidates it at known mutation points. But between those extremes lies a
grey zone — **uncertainty boundaries** — where narrowing is lost conservatively:

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

declare const r: Resource<string>;
if (r.value()) {
  const before: string = r.value();  // ✅ narrowed via stable

  unknownCall();                      // ❌ uncertainty boundary — narrowing lost

  const after: string | undefined = r.value();  // reset to declared type
}
```

**Question**: Could `unknownCall()` be annotated as "side-effect-free" so that
stable narrowing is preserved across it? What are the design options?

### 1.1 Current Behavior

The `classifyStableBoundary` function in [internal/checker/flow.go](../internal/checker/flow.go)
classifies each CFA boundary node relative to a stable reference:

| Classification | Meaning | Narrowing |
|---|---|---|
| `stableBoundaryKindNone` | Transparent (unrelated) | Preserved |
| `stableBoundaryKindMutatorCall` | Known mutator on same receiver | Reset to arg type |
| `stableBoundaryKindUnknownCall` | Unknown call involving receiver | Checked via preserve rules |
| `stableBoundaryKindCallbackCall` | Callback on same receiver | Checked via preserve rules |
| `stableBoundaryKindAwaitBoundary` | Async suspension | Checked via preserve rules |
| `stableBoundaryKindAliasEscape` | Receiver alias escapes | Always invalidated |
| `stableBoundaryKindOther` | Other non-matching boundary | Checked via preserve rules |

The system already has shape-guarded preserve rules (e.g. `stableBoundaryPreserveRuleAmbientNoArgVoidUnknownCall`)
that allow narrowing to survive certain well-known patterns. A purity annotation
would generalize this — making calls transparent to stable narrowing by declaration.

### 1.2 How "Unrelated Calls" Already Work

The checker already recognizes some calls as irrelevant to a stable reference:

```go
// From flow.go — isUnrelatedCallForStableReference
// Calls on objects/functions unrelated to the stable reference
// cannot affect the stable function's backing state.
```

This handles `unrelated.doSomething()` — calls on objects with no connection to the
stable reference's receiver. A purity annotation would extend this to cover calls
that DO have a connection but are known not to mutate.

---

## 2. Approach Analysis

### 2.1 `pure` Function Modifier

**Syntax option A — keyword modifier**:
```ts
pure function unknownCall(): void { /* ... */ }
// or
function unknownCall(): pure void { /* ... */ }
// or on function types
type Logger = pure (msg: string) => void;
```

**Syntax option B — on function type**:
```ts
interface Logger {
  log: pure (msg: string) => void;
}
```

**Semantics**: A `pure` function guarantees no observable side effects relevant to
the type system:
- Cannot call any `mutator` method on any object
- Cannot write to any property of any parameter or captured reference
- Cannot write to global mutable state
- CAN read from any source (contrast with mathematical purity)
- CAN allocate memory, perform I/O logging, etc. (practical purity)

**Interaction with `stable`**: A `pure` call cannot invalidate any stable narrowing.
In CFA terms, `classifyStableBoundary` would return `stableBoundaryKindNone` for any
call to a `pure` function, regardless of whether the receiver flows into it:

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

declare const r: Resource<string>;
declare pure function log(msg: string): void;
declare pure function validate(r: Resource<string>): boolean;

if (r.value()) {
  log("checking");           // pure — narrowing preserved
  validate(r);                // pure — even though r flows in, narrowing preserved
  const x: string = r.value(); // ✅ still narrowed
}
```

**Verification options**:

| Approach | What it checks | Feasibility |
|---|---|---|
| **Trusted annotation** | Nothing — the developer asserts purity | ✅ Trivial — same as `stable`/`mutator` |
| **Level 1 body check** | No mutator calls, no property writes in immediate body | ⚠️ Moderate — fails for higher-order |
| **Full verification** | Transitive purity through call graph | ❌ Infeasible — same problems as transitive mutator propagation |

**Recommendation**: Trusted annotation (like `stable` and `mutator`). TypeScript's philosophy
is to trust developer declarations — `readonly` doesn't prevent runtime mutation,
`as const` is an assertion, `stable` is trusted. The `pure` annotation should follow suit.

**Feasibility**: **7/10**

Pros:
- Natural extension of the existing modifier vocabulary (`stable`, `mutator`, `pure`)
- Directly solves the uncertainty boundary problem
- Simple CFA integration — pure calls are transparent
- No new grammar complexity (same modifier position as `stable`/`mutator`)
- Gradual adoption — libraries can add `pure` to their `.d.ts` files

Cons:
- New keyword (though TypeScript regularly adds contextual keywords)
- "Pure" is overloaded — means different things in different contexts
- No enforcement in function bodies (trusted, not checked)
- Doesn't compose well with higher-order functions (is `Array.map` pure? Only if the callback is)

---

### 2.2 `readonly` Parameter Extension

**Concept**: Extend `readonly` from properties to parameters, meaning "this function
won't mutate through this reference":

```ts
function process(readonly r: Resource<string>): void {
  console.log(r.value());  // OK — reading
  r.set("new");            // ❌ Error: cannot call mutator on readonly parameter
}
```

**Semantics**: More granular than `pure` — the function can have side effects,
just not through the `readonly` parameter:

```ts
declare function process(readonly r: Resource<string>): void;

if (r.value()) {
  process(r);                   // r is readonly in process — narrowing preserved
  const x: string = r.value();  // ✅ still narrowed
}
```

**Relation to `Readonly<T>`**: The existing `Readonly<T>` utility type makes all
properties readonly at the type level, but doesn't affect method calls. A `readonly`
parameter modifier would additionally prevent calling `mutator` methods:

```ts
// Readonly<T> today:
function f(r: Readonly<Resource<string>>): void {
  r.set("x");  // Currently allowed — Readonly only affects properties, not method calls
}

// readonly parameter (proposed):
function f(readonly r: Resource<string>): void {
  r.set("x");  // ❌ Error — mutator calls blocked on readonly references
}
```

**CFA interaction**: When a stable reference `r` is passed to a function with
`readonly r`, the checker can treat the call as non-mutating for `r`:

```ts
// classifyStableBoundary sees that r's parameter is readonly
// → return stableBoundaryKindNone for this call
```

**Verification**: Unlike `pure`, this is partially checkable:
- Can verify the function body doesn't call `mutator` methods on the parameter
- Can verify no property writes on the parameter
- But can't prevent aliasing escape:
  ```ts
  function sneaky(readonly r: Resource<string>): void {
    const alias = r;  // alias is not readonly
    alias.set("x");   // bypasses the constraint?
  }
  ```

**Depth problem**: `Readonly<T>` is shallow. Should `readonly r` be deep?

```ts
function f(readonly container: { resource: Resource<string> }): void {
  container.resource.set("x");  // Is this blocked? It's a mutator on a nested object
}
```

**Feasibility**: **5/10**

Pros:
- Leverages existing `readonly` concept
- More granular than `pure` — specifies WHICH parameters are protected
- Partially verifiable (body checking is feasible for Level 1)
- Familiar concept from C/C++ (`const` references), Rust (`&` vs `&mut`), Swift (`borrowing`)

Cons:
- `readonly` on parameters is new syntax for TypeScript (currently only on properties)
- Depth ambiguity (shallow vs deep readonly)
- Doesn't address calls that don't take the resource as a parameter
- Aliasing escape problem
- Doesn't help with global state mutations
- More complex grammar than `pure` modifier
- Higher-order function composition is awkward:
  ```ts
  // How do you say "fn won't mutate its argument"?
  function apply(fn: (readonly r: Resource<string>) => void, r: Resource<string>): void
  ```

---

### 2.3 Effect Systems

#### 2.3.1 Full Effect System

**Syntax concept** (hypothetical):
```ts
function foo(): void ! { mutate(r) }
function bar(): void ! { io, mutate(r) }
function pure(): void ! {}  // empty effect set = pure
```

Every function carries an effect set. Effects propagate through calls and compose
through higher-order functions via **effect polymorphism**:

```ts
function map<T, U, E>(arr: T[], fn: (t: T) => U ! E): U[] ! E
//                                                      ^^^ effect parameter
```

**Academic precedents**:

| System | Approach | Effect polymorphism | Adoption |
|---|---|---|---|
| **Koka** | Row-polymorphic effects | Yes, first-class | Research language |
| **Eff/OCaml 5** | Algebraic effects + handlers | Yes, via handlers | Niche/research |
| **Frank** | Effect types | Yes, with effect rows | Research language |
| **Hack** | Contexts & capabilities | Yes, via context parameters | Production (Meta) |
| **Java** | Checked exceptions | No (no polymorphism) | Widely disliked |

**Koka example**:
```koka
// Effect polymorphism
fun map(xs : list<a>, f : (a) -> e b) : e list<b>
  match xs
    Nil -> Nil
    Cons(x,xx) -> Cons(f(x), map(xx, f))

// Pure function — no effects
fun double(x : int) : int
  x * 2

// Effect-ful function
fun print-double(x : int) : console ()
  println(x * 2)

// map infers effect from callback:
// map([1,2,3], double)        : list<int>        — no effects
// map([1,2,3], print-double)  : console list<int> — console effect
```

**Why TypeScript can't adopt this**:

1. **Backward incompatibility**: Every existing function type `(x: A) => B` would
   need to become `(x: A) => B ! E` with an implicit `E = <everything>` effect set.
   This changes the meaning of every function type in every `.d.ts` file globally.

2. **JavaScript semantics**: JS functions are inherently effectful. The default effect
   set would be enormous (`io, mutate, throw, async, ...`). Only explicitly annotated
   pure functions would have empty effects. This inverts the usual useful/useless ratio.

3. **TypeScript Design Goals**:
   - Goal #5: "Avoid adding expression-level syntax" — effect annotations are expression-level
   - Goal #7: "Preserve runtime behavior of JavaScript code" — effects are erasable, but the
     annotation burden is enormous
   - Goal #8: "Align with ECMAScript proposals" — no TC39 effect proposals exist

4. **Performance**: Effect checking requires tracking effect sets through every call
   chain. For large codebases, this could significantly slow type checking.

**Feasibility**: **2/10** for full effect system. Academically elegant but practically
incompatible with TypeScript's design philosophy and ecosystem.

#### 2.3.2 Lightweight Effect System (`pure` vs `impure`)

Instead of full effects, a binary distinction — `pure` (no effects) vs default (may
have effects):

```ts
pure function add(a: number, b: number): number { return a + b; }
function print(msg: string): void { console.log(msg); }  // implicitly impure
```

This is essentially approach **2.1** (the `pure` modifier) by another name. It has
the same properties and limitations — see section 2.1.

The key difference from a full effect system: no effect polymorphism. `Array.map`
can't be "pure when given a pure callback, impure when given an impure callback."

**Feasibility**: **7/10** — same as the `pure` modifier proposal.

#### 2.3.3 Row-Polymorphic Effects (Koka-style)

**Concept**: Functions carry effect type parameters that compose:
```ts
function map<T, U, effect E>(arr: T[], fn: (t: T) => U ! E): U[] ! E
```

This solves the higher-order function composition problem but at enormous complexity
cost. See section 2.3.1 for why this is infeasible for TypeScript.

**Feasibility**: **1/10**

#### 2.3.4 Algebraic Effects (Eff/OCaml 5)

**Concept**: Effects are first-class values that can be handled:
```ts
effect Mutate = {
  set: (key: string, value: unknown) => void;
}

function wrapper() {
  perform Mutate.set("key", "value");
}

handler {
  Mutate.set(key, value) => { /* handle mutation */ resume(); }
} {
  wrapper();
}
```

This is even more alien to JavaScript than row-polymorphic effects. There is no
TC39 proposal and no precedent in the JavaScript ecosystem.

**Feasibility**: **0/10** for TypeScript.

---

### 2.4 `@pure` JSDoc / Decorator Approach

#### 2.4.1 JSDoc `@pure`

```ts
/** @pure */
function validate(r: Resource<string>): boolean {
  return r.value() !== undefined;
}
```

**Precedent**: TypeScript already processes JSDoc annotations for type information
(`@type`, `@param`, `@returns`, `@template`, `@satisfies`, `@import`, etc.).

**Semantics in the type system**: The checker could read `@pure` and set a flag
on the function's signature, making it transparent to stable CFA. This is
functionally identical to the `pure` modifier but uses comment syntax.

**Pros**:
- Zero new syntax — uses existing JSDoc infrastructure
- Backward compatible with all JS runtimes
- Can be adopted incrementally without parser changes
- Already familiar to developers who use `/*#__PURE__*/` comments

**Cons**:
- JSDoc is the "second class citizen" annotation mechanism vs first-class syntax
- Less discoverable than a keyword
- Harder to enforce in function types (JSDoc is statement-level, not type-level)
- Can't annotate function types in interfaces:
  ```ts
  interface Resource<T> {
    /** @pure */  // No good place for this
    validate: (r: Resource<T>) => boolean;
  }
  ```

**Feasibility**: **6/10**

#### 2.4.2 Stage 3 Decorator `@pure`

```ts
@pure
function validate(r: Resource<string>): boolean {
  return r.value() !== undefined;
}
```

**Problems**:
- Decorators can only be applied to class declarations, class methods, class fields,
  class accessors, and class auto-accessors (TC39 Stage 3). They cannot be applied
  to standalone functions, function expressions, or function types.
- Even for class methods, decorators have runtime semantics — they execute code.
  A `@pure` decorator would need to be a no-op at runtime (just a type-system marker),
  which conflicts with the decorator spec.
- No TC39 proposal for function decorators.

**Feasibility**: **2/10** — decorators are the wrong mechanism for type-level annotations.

---

### 2.5 The `/*#__PURE__*/` / `@__NO_SIDE_EFFECTS__` Precedent

Bundlers (Terser, esbuild, Rollup) already use special comments for purity:

```ts
// Call-site annotation
const result = /*#__PURE__*/ createComponent();

// Function-level annotation (esbuild/Rollup convention)
/*@__NO_SIDE_EFFECTS__*/
function createComponent() {
  return { /* ... */ };
}
```

**Key distinction**: Bundler purity ≠ CFA purity:

| Aspect | Bundler `__PURE__` | CFA purity (proposed) |
|---|---|---|
| **Scope** | Individual CALL EXPRESSION | Function SIGNATURE |
| **Meaning** | "This call can be tree-shaken if result unused" | "This function doesn't invalidate narrowing" |
| **Verification** | None — trusted comment | None — trusted annotation |
| **Granularity** | Per-call-site | Per-function-declaration |
| **Effect on types** | None | Affects CFA narrowing flow |
| **Runtime output** | Comment stripped | Modifier stripped |

**Could TypeScript formalize `/*#__PURE__*/`?**

TypeScript already emits `/*#__PURE__*/` in downlevel class transforms (since TS 2.5,
[#13721](https://github.com/microsoft/TypeScript/issues/13721), [PR #16631](https://github.com/microsoft/TypeScript/pull/16631)).
But this is an emit concern, not a type system concern.

Formalizing it as a type system feature would require:
1. Defining what "pure" means for the TYPE CHECKER (not the bundler)
2. Deciding on syntax (comment vs modifier vs JSDoc)
3. Implementing CFA interaction

The bundler precedent validates the CONCEPT (developers understand purity annotations)
but doesn't define the TYPE SYSTEM semantics needed for CFA.

**Feasibility of formalization**: **5/10** — the concept is proven, but the semantics
need to be designed specifically for the type system.

---

### 2.6 Summary: `noSideEffects` / `__NO_SIDE_EFFECTS__` Relationship

The relationship between tree-shaking purity and CFA purity:

```
                    ┌─────────────────────────┐
  Tree-shaking      │ "Can I remove this call  │
  purity            │  if the RESULT is unused?"│
  (bundler)         └────────────┬────────────┘
                                 │
                    No mutual    │  Different questions
                    implication  │
                                 │
                    ┌────────────┴────────────┐
  CFA purity        │ "Does this call change   │
  (type checker)    │  any OBSERVABLE STATE?"   │
                    └─────────────────────────┘
```

A function can be tree-shakeable but not CFA-pure (e.g., it has side effects but
its return value is meaningful). And a function can be CFA-pure but not tree-shakeable
(e.g., it performs I/O but doesn't mutate state that matters for narrowing).

For the `stable` narrowing system, the relevant question is specifically:
**"Does this call invalidate any stable narrowing?"** — which is narrower than both
tree-shaking purity and general CFA purity.

---

## 3. Existing TypeScript Proposals & Issues

### 3.1 Direct Precedents

| Issue | Title | Status | Relevance |
|---|---|---|---|
| [#7770](https://github.com/microsoft/TypeScript/issues/7770) | Add a modifier for pure functions | Open (Needs Proposal) | Directly relevant — 245 👍, proposed `pure` keyword |
| [#17181](https://github.com/microsoft/TypeScript/issues/17181) | Add pure and immutable keywords | Open (In Discussion) | Comprehensive proposal with `pure` + `immutable` keywords |
| [#13721](https://github.com/microsoft/TypeScript/issues/13721) | Pure annotation in downlevel emits | **Closed** (Fixed in TS 2.5) | `/*#__PURE__*/` emit — bundler purity |
| [#42758](https://github.com/microsoft/TypeScript/issues/42758) | Readonly references and readonlyThis methods | Open (Awaiting Feedback) | `readonly` parameter + `readonlyMethod` concept |
| [#10467](https://github.com/microsoft/TypeScript/issues/10467) | Side effects of unused ES6 classes | **Closed** (→ #13721) | Tree-shaking side effect concern |

### 3.2 Related Issues

| Issue | Title | Relevance |
|---|---|---|
| [#6614](https://github.com/microsoft/TypeScript/issues/6614) | Readonly modifier support | Foundation for readonly semantics |
| [#8353](https://github.com/microsoft/TypeScript/issues/8353) | Control flow based type analysis | CFA foundation that purity would extend |
| [#19202](https://github.com/microsoft/TypeScript/issues/19202) | Leverage `sideEffects: false` in package.json | Ecosystem-level purity annotation |
| [#38303](https://github.com/microsoft/TypeScript/issues/38303) | Must-use / noignore return values | Pure functions should require return value use |

### 3.3 TypeScript Team Position

Based on public comments:

- **Ryan Cavanaugh** (#7770): "We need more information about what you would expect this to do" — cautious, wants concrete proposal
- **Mohamed Hegazy** (#7770, #13721): Open to emit-level purity annotations; referenced readonly modifier discussions
- **Issues #7770 and #17181**: Both labeled "Needs Proposal" / "In Discussion" — not rejected, but no concrete plan. Active since 2016-2017 with periodic renewed interest.

### 3.4 TC39 Proposals

There are **no active TC39 proposals** for purity, effects, or readonly function
parameters. Relevant tangential proposals:

| Proposal | Stage | Relevance |
|---|---|---|
| **Records & Tuples** | Stage 2 | Immutable data structures — conceptually related |
| **Decorators** | Stage 3 | Could carry purity metadata, but decorators are runtime features |
| **`const` value types** | Stage 1 (withdrawn) | Was related to immutability |

The absence of TC39 purity proposals means TypeScript would be going beyond ECMAScript
with a `pure` modifier — which it already does with `readonly`, type annotations,
`abstract`, `override`, etc.

---

## 4. Interaction with `stable`/`mutator`

### 4.1 Semantic Compatibility Matrix

A `pure` function, by definition, cannot invalidate stable narrowing because:

```
╔════════════════════════════╦══════════════╦═══════════════════╗
║ Call type                  ║ Narrowing    ║ CFA boundary kind ║
╠════════════════════════════╬══════════════╬═══════════════════╣
║ stable call (same ref)     ║ Preserved    ║ None              ║
║ pure call (any args)       ║ Preserved    ║ None              ║
║ unrelated call (no ref)    ║ Preserved    ║ None              ║
║ unknown call (ref flows)   ║ Invalidated  ║ UnknownCall       ║
║ mutator call (same ref)    ║ Reset to arg ║ MutatorCall       ║
╚════════════════════════════╩══════════════╩═══════════════════╝
```

### 4.2 Purity vs Mutator: Semantic Exclusion

`pure` and `mutator` are mutually exclusive by definition:

```ts
// ILLEGAL — contradiction
pure mutator (v: T) => void  // Can't be pure AND mutate
```

Grammar rule: `pure` and `mutator` modifiers conflict (like `stable` and `mutator`).

### 4.3 Purity and `stable`: Compatible but Distinct

A function can be both `stable` and `pure`:
```ts
// stable: repeated calls return same narrowing
// pure: no side effects
// Both can apply — getter that's also side-effect-free
interface StoreView<T> {
  value: stable pure () => T | undefined;  // stable + pure
}
```

But typically `stable` implies a weaker form of purity — stable calls are already
treated as transparent in CFA. Adding `pure` to a `stable` function is redundant
for CFA purposes but communicates intent.

### 4.4 CFA Integration

In `classifyStableBoundary`, a pure function call would be classified:

```go
func (c *Checker) classifyStableBoundary(reference *ast.Node, boundary *ast.Node) stableBoundaryKind {
    // ... existing checks ...
    
    // Pure calls are transparent to stable narrowing
    if c.isPureCallExpression(boundary) {
        return stableBoundaryKindNone
    }
    
    // ... rest of classification ...
}
```

Where `isPureCallExpression` checks whether the resolved signature has a `SignatureFlagsPure` flag.

### 4.5 Verification: Checked or Trusted?

**Recommendation: Trusted**, for consistency with the existing system:

| Feature | Verification | Rationale |
|---|---|---|
| `stable` | Trusted | Developer asserts idempotent reads |
| `mutator` | Trusted | Developer asserts mutation |
| `invalidates` | Trusted | Developer specifies linkage |
| `readonly` (property) | Partially checked | Only prevents direct property writes |
| `pure` (proposed) | Trusted | Developer asserts no side effects |

The checker COULD do Level 1 body checking (no mutator calls in immediate body)
but this would be:
- Incomplete for calls to other functions
- Impossible for declaration files
- Inconsistent with `stable`/`mutator` which don't verify their contracts

### 4.6 Inference: Could the Compiler Infer Purity?

For **simple leaf functions** with no calls to other functions, yes:

```ts
function add(a: number, b: number): number {
  return a + b;  // No calls, no writes → inferably pure
}
```

But inference hits the same barriers as transitive mutator propagation:

1. **Cross-module calls**: Can't inspect called function bodies
2. **Declaration files**: No bodies available
3. **Higher-order functions**: Purity depends on callbacks
4. **Built-in functions**: Is `Math.random()` pure? (No.) Is `console.log()` pure? (Depends on definition.)
5. **Getter side effects**: Property access can trigger impure getters

Inference is useful only as a **diagnostic hint**, not as a type system feature.

---

## 5. Design Proposal: The `pure` Modifier

If we were to add **one annotation** to help with uncertainty boundaries, the `pure`
function type modifier is the most TypeScript-idiomatic choice.

### 5.1 Syntax

```ts
// On function type (primary use case — type-level annotation)
type Validator<T> = pure (value: T) => boolean;

// In interface declarations
interface Logger {
  log: pure (msg: string) => void;
  format: pure (template: string, ...args: unknown[]) => string;
}

// On standalone function declarations (secondary — rarely needed)
pure function validate(x: unknown): x is string {
  return typeof x === 'string';
}

// In type position (callback parameters)
function process(
  r: Resource<string>,
  validate: pure (r: Resource<string>) => boolean
): void {
  if (r.value()) {
    validate(r);  // pure callback — narrowing preserved
    r.value();    // ✅ still narrowed
  }
}
```

The modifier position follows `stable`/`mutator` precedent — before the function
arrow/parentheses in type position.

### 5.2 Semantics

**Core guarantee**: Calling a `pure` function does not invalidate any stable narrowing.

**Not guaranteed** (weaker than mathematical purity):
- Determinism (pure functions CAN read external state — `Date.now()`, `Math.random()`)
- Referential transparency (calling twice CAN return different results)
- Absence of I/O (pure functions CAN log, read files, etc.)

**Guaranteed** (for the type system):
- No mutation of any `stable` endpoint's backing state
- No property writes on any argument or captured reference
- No `mutator` calls on any object

This is "CFA purity" — a weaker, more practical notion than mathematical purity,
designed specifically to preserve type narrowing.

### 5.3 Verification

Trusted annotation. The compiler does not verify the body.

Optional future enhancement: A `--strictPure` flag could enable Level 1 body checking
(no mutator calls, no property writes in immediate function body). This would be:
- Opt-in (not default)
- Incomplete (can't check cross-module calls)
- Useful for catching obvious mistakes
- Analogous to `--strictNullChecks` gradually tightening

### 5.4 Interaction with Existing Features

| Feature | Interaction |
|---|---|
| `readonly` properties | Orthogonal — `pure` is about the function, `readonly` is about the property |
| `Readonly<T>` utility | Compatible — `pure` functions can accept `Readonly<T>` params |
| `as const` assertions | Orthogonal — `as const` is about values, `pure` is about functions |
| `stable` modifier | Compatible — `pure` calls don't invalidate stable narrowing |
| `mutator` modifier | Exclusive — cannot be both `pure` and `mutator` |
| Type predicates | Compatible — `pure` functions can have type predicates |
| `asserts` return type | Incompatible — assertion functions have side effects (they throw) |
| Generic functions | Compatible — `pure <T>(x: T) => T` works |
| Overloaded functions | Each overload can independently be `pure` or not |

### 5.5 Subtyping

A `pure` function type is a **subtype** of the corresponding non-pure type:

```ts
type PureFn = pure (x: number) => number;
type AnyFn = (x: number) => number;

declare const pf: PureFn;
const af: AnyFn = pf;  // ✅ OK — pure is more constrained

declare const af2: AnyFn;
const pf2: PureFn = af2;  // ❌ Error — can't widen to pure
```

This is analogous to how `readonly` arrays are supertypes of mutable arrays —
a pure function promise is a constraint that can be relaxed but not added.

### 5.6 Higher-Order Functions

The key limitation: purity doesn't compose through higher-order functions without
effect polymorphism:

```ts
// Without effect polymorphism:
declare function map<T, U>(arr: T[], fn: (t: T) => U): U[];  // not pure
// Even if fn is pure, map's signature doesn't reflect it

// With pure callback parameter:
declare function map<T, U>(arr: T[], fn: pure (t: T) => U): U[];
// Now map requires a pure callback — but can map ITSELF be pure?
// It allocates a new array (side effect? depends on definition)

// Pragmatic approach:
declare pure function map<T, U>(arr: T[], fn: pure (t: T) => U): U[];
// Pure with pure callback — the common case
```

Without effect polymorphism, each combination of pure/impure callback must be a
separate overload or a separate function. This is verbose but workable for the
most common patterns. TypeScript already uses overloads extensively for similar
type-level distinctions.

### 5.7 Migration Path

1. **Phase 0**: Internal prototype in TypeScript-Go. `pure` modifier on function types,
   CFA treats pure calls as transparent.
2. **Phase 1**: Built-in `.d.ts` annotations. Mark standard library functions as `pure`
   where appropriate (`Array.prototype.map`, `Array.prototype.filter`, `Object.keys`,
   string methods, math operations, etc.).
3. **Phase 2**: Guidance for library authors to annotate `.d.ts` files.
4. **Phase 3** (optional): `--strictPure` flag for body verification.

---

## 6. Feasibility Ratings

| # | Approach | Rating | Rationale |
|---|---|---|---|
| 1 | **`pure` modifier keyword** | **7/10** | Natural extension, simple CFA integration, consistent with stable/mutator vocabulary. Main concern: higher-order composition. |
| 2 | **`readonly` parameter extension** | **5/10** | Granular but complex. Depth ambiguity, aliasing problems, new syntax in parameter position. |
| 3a | **Full effect system** | **2/10** | Academically elegant, practically impossible. Breaks all existing code. |
| 3b | **Lightweight `pure`/`impure`** | **7/10** | Same as #1 — binary distinction is the practical minimum. |
| 3c | **Row-polymorphic effects** | **1/10** | Requires fundamentally different type system. |
| 3d | **Algebraic effects** | **0/10** | Alien to JavaScript, no TC39 precedent. |
| 4a | **JSDoc `@pure`** | **6/10** | Zero syntax cost, but second-class, can't annotate function types in interfaces. |
| 4b | **Decorator `@pure`** | **2/10** | Decorators are runtime features, can't apply to standalone functions. |
| 5 | **Formalized `/*#__PURE__*/`** | **5/10** | Proven concept at bundler level, but comment-based type annotations are fragile. |

### 6.1 Recommendation

The **`pure` function type modifier** (approaches #1/#3b) is the clear winner:

1. **Minimal syntax**: Same modifier grammar as `stable`/`mutator`
2. **Clear semantics**: "This function doesn't invalidate stable narrowing"
3. **Simple CFA integration**: Pure calls → `stableBoundaryKindNone`
4. **Trusted annotation**: Consistent with existing modifiers
5. **Gradual adoption**: Can be added to `.d.ts` files without breaking changes
6. **No ecosystem disruption**: Doesn't require new syntax at call sites

The main open question is whether `pure` is the right NAME:
- `pure` — well-understood but overloaded (mathematical purity vs CFA purity)
- `sideEffectFree` — accurate but verbose
- `nonmutating` — Swift's terminology, precise for CFA purposes
- `transparent` — describes CFA behavior but obscure

Given that `stable` and `mutator` already establish a "what does your function do
to narrowing state" vocabulary, `pure` fits naturally as "my function does nothing
to narrowing state."

---

## 7. Interaction Example: Complete Scenario

```ts
// Library declarations
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

// Pure utility functions
declare pure function validate<T>(value: T | undefined): value is T;
declare pure function log(msg: string): void;
declare pure function format(r: Resource<unknown>): string;

// Impure function (default)
declare function unknownHelper(r: Resource<string>): void;

// Usage
declare const r: Resource<string>;

if (r.value()) {
  // All pure calls — narrowing preserved throughout
  log("value exists");                    // pure → transparent
  const formatted = format(r);           // pure → transparent even though r flows in
  const valid = validate(r.value());     // pure + stable = narrowing unchanged

  const x: string = r.value();          // ✅ still narrowed to string

  // Impure call — uncertainty boundary
  unknownHelper(r);                      // NOT pure → narrowing invalidated
  const y: string | undefined = r.value(); // ❌ back to string | undefined

  // Explicit mutation — known invalidation
  r.set("new");                          // mutator → post-call narrowing from argument
  const z: string = r.value(); // narrowed to string (argument type propagated)
}
```

---

## 8. Alternative: Extending the Preserve Rules System

Instead of a full `pure` modifier, a lighter alternative: extend the existing
preserve rules system in `classifyStableBoundary`:

```go
// New preserve rule: ambient function with all pure formal parameters
const (
    stableBoundaryPreserveRulePureDeclaredFunction stableBoundaryPreserveRuleID = iota + N
)
```

This would add a heuristic: "If an ambient function has no overloads, takes only
`Readonly<>` or primitive parameters, and returns a non-void type, assume it's
non-mutating."

**Pros**: No new syntax, no modifier, no parser changes
**Cons**: Heuristic-based, may have false positives, not user-controllable

This could serve as a **Phase 0** step before introducing the `pure` modifier —
prove the concept works with heuristics, then add the modifier for explicit control.

---

## 9. Conclusion

The landscape of purity and effect annotations for TypeScript is well-explored
in academic literature and in TypeScript community proposals. The key findings:

1. **Full effect systems are impractical** for TypeScript. They require fundamental
   type system changes incompatible with JavaScript semantics and TypeScript design goals.

2. **A `pure` modifier is the most practical single addition** that would solve the
   uncertainty boundary problem for `stable` narrowing.

3. **The modifier should be trusted** (not verified), following the precedent set by
   `stable`, `mutator`, and `readonly`.

4. **Higher-order function composition is the main limitation** — without effect
   polymorphism, purity doesn't propagate through generic callbacks. This is
   acceptable because the most common use case (calling declared-pure library functions)
   doesn't require composition.

5. **The bundler `/*#__PURE__*/` precedent validates the concept** — developers already
   understand and use purity annotations — but the type system needs its own semantics.

6. **Existing TypeScript issues** (#7770, #17181) show sustained community interest
   (245+ 👍) but no concrete proposal has been accepted. The `stable`/`mutator` system
   provides the first concrete motivating use case for a CFA-level purity annotation.

The recommended path forward:
- **Short term**: Extend preserve rules heuristically for common ambient patterns
- **Medium term**: Propose `pure` modifier as part of the `stable`/`mutator` family
- **Long term**: If demand warrants, consider `--strictPure` for body verification

---

## Appendix A: Cross-Language Survey — Preserving Type Refinements Across Function Calls

> How do other programming languages solve the problem of maintaining type narrowing
> when functions with potential side effects are called?

### A.1 Rust — Ownership + Borrow Checker

**How refinements work**: Rust uses **pattern matching** on enums to narrow types.
The `match` expression destructures variants and binds their inner values:

```rust
enum Shape { Circle(f64), Rectangle(f64, f64) }

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Rectangle(w, h) => w * h,
    }
}
```

**Refinements across function calls**: Rust's borrow checker **structurally prevents**
the aliased mutation problem. At any given time, you can have **either** one `&mut`
reference **or** any number of `&` references, but not both:

```rust
fn process(s: &String) {
    // s is immutable borrow — nobody can mutate while this ref exists
    println!("{}", s.len());
    other_function();
    println!("{}", s.len()); // SAFE — borrow checker guarantees no mutation
}
```

If you hold a `&T`, **no function call can mutate that data**. Refinements are
preserved by construction. Once you've matched an enum variant and extracted data,
the borrow rules protect it throughout the scope.

**Interior mutability (escape hatch)**: `RefCell<T>` allows mutation through `&`
references by moving borrow checks to **runtime**. This is the acknowledged escape
hatch — Rust trades compile-time guarantees for flexibility when needed:

```rust
use std::cell::RefCell;
let data = RefCell::new(42);
let r = &data;              // immutable reference
*r.borrow_mut() = 100;      // runtime borrow checking — panics on conflict
```

**TypeScript lessons**:
- The principle is sound: if you can prove no mutation path exists, refinements are safe.
- Interior mutability shows even Rust needs an escape hatch — TypeScript's `mutator`
  is analogous but inverted: instead of opting INTO interior mutability, you opt into
  declaring side effects.
- The ownership model is incompatible with JS's reference semantics, but the INSIGHT
  about aliased mutation prevention directly applies.

---

### A.2 Kotlin — Smart Casts

**How refinements work**: Kotlin's **smart casts** automatically narrow types after
`is` checks:

```kotlin
fun process(x: Any) {
    if (x is String) {
        println(x.length)  // automatic smart cast — no explicit cast
    }
}
```

**When smart casts are invalidated**:

| Scenario | Smart cast preserved? | Why |
|----------|----------------------|-----|
| `val` local | ✅ Yes | Immutable, can't change |
| `var` local (not captured) | ✅ Yes | Not aliased |
| `var` local (captured by lambda) | ❌ No (K1) / ⚠️ Sometimes (K2) | Lambda might mutate |
| Mutable class property | ❌ No | Another thread/method could change it |
| Open property (overridable) | ❌ No | Subclass getter might return different values |

```kotlin
class Container {
    var value: Any = "hello"
    fun process() {
        if (value is String) {
            // ERROR: Smart cast impossible — 'value' is mutable property
            // println(value.length)
        }
    }
}
```

**K2 compiler improvements**: Kotlin 2.0's K2 compiler brought significantly better
smart cast analysis — smart casts in more positions, better lambda capture tracking,
and limited smart casts after function calls when the compiler can prove the called
function doesn't modify the narrowed variable.

**TypeScript lessons**:
- The `val`/`var` distinction directly maps to `stable`/`mutator`: stable methods are
  like `val` properties (can be narrowed), mutator methods invalidate narrowing.
- K2's approach of tracking lambda capture/usage is sophisticated — `mutator` provides
  similar information without requiring expensive analysis.
- All languages agree: local variables survive function calls safely.

---

### A.3 Swift — `mutating` Keyword + Exclusive Access

**How `mutating` works**: Swift requires the `mutating` keyword on struct methods
that modify `self`:

```swift
struct Point {
    var x = 0.0, y = 0.0
    mutating func moveBy(x deltaX: Double, y deltaY: Double) {
        x += deltaX; y += deltaY
    }
}
var p = Point(x: 1.0, y: 1.0)
p.moveBy(x: 2.0, y: 3.0)       // OK — var allows mutation
let fixed = Point(x: 3.0, y: 3.0)
// fixed.moveBy(x: 2.0, y: 3.0)  // ERROR — let is immutable
```

This is **directly analogous** to TypeScript's proposed `mutator` modifier:
- Swift's `mutating` = TypeScript's `mutator`
- Swift's non-`mutating` (default for structs) ≈ TypeScript's `stable`

**Exclusive access enforcement** (SE-0176): Swift 5 prevents overlapping read/write
access. A `mutating` method has write access to `self` for the **entire duration** of
the call:

```swift
var stepSize = 1
func increment(_ number: inout Int) {
    number += stepSize  // ERROR if stepSize is being written simultaneously
}
```

**Pattern matching and narrowing**: Swift uses `switch`/`case` for enum narrowing but
doesn't have TypeScript-style general flow analysis. Once you extract associated values
via pattern match, they become local bindings — function calls can't affect them.

**TypeScript lessons**:
- **`mutating` is the strongest direct precedent** for `mutator`. Swift proves this
  annotation is practical and intuitive.
- Swift's `mutating` only applies to value types (structs). TypeScript operates in
  reference-type territory, making `mutator` even more valuable.
- Exclusive access is too restrictive for TS but "who has write access" is the core insight.

---

### A.4 Flow — Refinement Invalidation ("Havoc")

**How refinements work**: Very similar to TypeScript's narrowing:

```javascript
// @flow
function func(value: ?string) {
    if (value != null) {
        value; // string (refined from ?string)
    }
}
```

**Refinement invalidation rule**: Simple and conservative:

> **Any function call invalidates refinements on object properties and captured variables.**

```javascript
// @flow
function func(value: {prop?: string}) {
    if (value.prop) {
        otherFunc();
        value.prop.charAt(0);  // ERROR! Refinement invalidated
    }
}
```

Why? `otherFunc()` might have a reference to `value` and could delete `value.prop`.

**What survives**: Local variables (not captured in closures) survive function calls:

```javascript
// @flow
function func(value: {prop?: string}) {
    if (value.prop) {
        const prop = value.prop;  // capture into local
        otherFunc();
        prop.charAt(0);  // OK — local can't be modified
    }
}
```

Internally, Flow uses a **"havoc"** mechanism — when it encounters a function call,
it invalidates all refinements that could potentially be affected, broadly.

**TypeScript lessons**:
- Flow validates the problem: the "assign to local" workaround is exactly what
  developers do today. `stable` eliminates this workaround.
- Havoc is too broad — Flow's all-or-nothing approach is exactly what `stable`/`mutator`
  aims to improve with fine-grained control.
- Flow's approach is the **baseline** — TypeScript's current behavior is similar.

---

### A.5 Dart — Type Promotion

**How promotion works**: Dart's type promotion narrows variables after type checks:

```dart
void process(Object obj) {
    if (obj is String) {
        print(obj.length);  // promoted to String
    }
}
```

**When promotion fails** (Dart has extremely detailed documented rules):

| Scenario | Promotable? | Why |
|----------|------------|-----|
| Local variable | ✅ Yes | Can't be aliased |
| Private `final` field | ✅ Yes (Dart 3.2+) | Private + final = always same value |
| Public field | ❌ No | Could be overridden by subclass |
| Non-`final` field | ❌ No | Could be written between check and use |
| Getter | ❌ No | Could return different value each call |
| Write-captured variable | ❌ No | Lambda might write to it |

**Getters can't be promoted** — the compiler can't guarantee a getter returns the same
value each time. This is **exactly** the problem `stable` solves:

```dart
class Example {
    int? get _computed => Random().nextBool() ? 1 : null;
}
void f(Example x) {
    if (x._computed != null) {
        // int i = x._computed;  // ERROR — getter can't be promoted
    }
}
```

**Conflicting declarations**: Even unrelated classes can prevent promotion. If
class `A` has `final int? _i` and class `B` has a nondeterministic `int? get _i`,
then `_i` can't be promoted on either class.

**"Why promotion failed" diagnostics**: Dart tells users exactly why promotion
failed — each failure type has a documented code and fix suggestion. Excellent DX.

**TypeScript lessons**:
- **Dart's getter problem is our method problem.** `stable` directly solves this by
  letting developers declare "this getter/method returns the same value."
- Private + final is necessary but not sufficient for Dart. TypeScript's `stable`/`mutator`
  is more flexible — a public method can be `stable`.
- "Why promotion failed" diagnostics: TypeScript should provide similarly clear
  error messages when narrowing is lost.
- Conflicting declarations: TypeScript must consider the whole type hierarchy when
  trusting `stable`.

---

### A.6 Ceylon / Whiley — Academic Flow-Sensitive Typing

**Ceylon**: One of the first mainstream-ish languages with comprehensive flow-sensitive
typing. Key contributions:

- **Union and intersection types** with flow-sensitive narrowing (predating TypeScript)
- **`variable` annotation** distinguished mutable from immutable values
- **Narrowing survived function calls** for non-`variable` values because immutability
  was the default

```ceylon
void process(String|Integer val) {
    if (is String val) {
        print(val.size);  // narrowed to String
    }
}
```

**Whiley**: A research language with flow-sensitive typing plus verification conditions.
Functions are **pure by default** — function calls don't invalidate refinements because
side-effect-free is the norm. Explicit effect annotations mark side-effecting functions.

**TypeScript lessons**:
- Immutability as default gives narrowing preservation for free — but TS can't change
  JavaScript's mutable-by-default semantics.
- Purity annotations are the academic version of `stable`/`mutator` — TS's approach is
  the pragmatic, gradual-adoption version.
- Ceylon's union types + flow typing directly influenced TypeScript's design.

---

### A.7 Hack (Meta) — Type Refinement

**How refinements work**: Similar to TypeScript/Flow:

```hack
function f1(?int $p): void {
    if ($p is int) {
        $x = $p % 3;  // OK — $p refined to int
    }
}
```

**Method call invalidation**: The critical rule:

> After calling **any method on `$this`**, all property refinements on `$this` are invalidated.

```hack
class C {
    private ?int $p = 8;
    public function m(): void {
        if ($this->p is int) {
            $x = $this->p << 2;  // OK — refined
            $this->n();           // method call!
            // $x = $this->p << 2;  // ERROR — refinement invalidated
        }
    }
    public function n(): void { /* ... */ }
}
```

Any method call — even a pure getter — invalidates ALL property refinements on `$this`.
Local variables remain safe.

**TypeScript lessons**:
- Hack demonstrates the problem clearly: even calling a getter invalidates all
  refinements. `stable` allows getters/methods to preserve refinements.
- The "any method invalidates everything" rule is exactly what's too conservative.
  `mutator` narrows invalidation to only methods that actually cause mutation.

---

### A.8 C# — Nullable Reference Types + Pattern Matching

**Null narrowing** (C# 8+):

```csharp
string? name = GetName();
if (name != null) {
    Console.WriteLine(name.Length);  // narrowed to non-nullable
}
```

**Refinements across function calls**: C# is **less conservative** than Flow/Hack for
locals — since `s` is local, `SomeMethod()` can't change it:

```csharp
string? s = "hello";
if (s != null) {
    SomeMethod();              // does NOT invalidate null narrowing
    Console.WriteLine(s.Length);  // still non-null
}
```

But for **fields and properties**, C# is conservative — field narrowing is invalidated
after method calls. The `readonly` modifier exists but doesn't improve narrowing
(missed opportunity).

**TypeScript lessons**:
- Locals surviving function calls is safe — C# proves it works in practice.
- `readonly` could but doesn't help narrowing in C#. TypeScript's `stable` fills this gap.
- C#'s approach to fields is similarly conservative to TypeScript's current approach.

---

### A.9 Koka — Full Effect System

**How effects work**: Every function's type includes its effect. Koka is the most
theoretically rigorous approach:

```koka
fun sqr(x: int): total int        // total: pure function
fun divide(x: int, y: int): exn int   // exn: may throw
fun print(s: string): console ()   // console: may write to console
fun rand(): ndet int               // ndet: nondeterministic
```

**Effect tracking for mutation**: Koka has explicit state effects and
**row-polymorphic effect polymorphism**:

```koka
fun map(xs: list<a>, f: (a) -> e b): e list<b>
  match xs
    Cons(x, xx) -> Cons(f(x), map(xx, f))
    Nil -> Nil
```

The `map` function has effect `e` — whatever effect `f` has. If `f` is pure, `map`
is pure. If `f` writes to console, `map` writes to console.

**Local state discharge**: Even mutable local variables can produce `total` (pure)
effect:

```koka
fun fib-mutable(): total int
  var x := 0; var y := 1
  repeat(10)
    val temp = x + y; x := y; y := temp
  y
```

Internal mutation doesn't leak — Koka proves local state can be safely ignored via
polymorphic heap types that are discharged when the state doesn't escape.

**Could effects preserve refinements?** If a function has effect `total` (pure),
calling it cannot invalidate any refinement. For functions with `state` effects,
narrowing is only invalidated for state in the same heap region.

**TypeScript lessons**:
- **The fundamental insight**: A function without mutation effect **cannot invalidate
  refinements**. TypeScript's `stable` is the pragmatic version of "no relevant mutation."
- Local state discharge: TypeScript's `stable` method that internally uses mutation but
  returns the same external result is the same concept.
- Effect polymorphism is elegant but too complex for TypeScript's type system.
- A full effect system is **too heavyweight** — but the insight is distilled into
  the `stable`/`mutator` design.

---

### A.10 Cross-Language Comparison

| Language | Mechanism | Locals survive calls? | Properties survive? | Key insight |
|----------|-----------|----------------------|--------------------|----|
| **Rust** | Ownership + borrow checker | Yes (`&T`) | N/A (no classes) | Structural mutation prevention |
| **Kotlin** | Smart casts + `val`/`var` | Yes | No (unless `val`) | `val`/`var` ≈ `stable`/`mutator` |
| **Swift** | `mutating` + exclusive access | Pattern-match bindings: yes | Limited | `mutating` = direct `mutator` precedent |
| **Flow** | Havoc on function calls | Yes | No | Simple but too conservative |
| **Dart** | Promotion + field analysis | Yes | Private final: yes. Getters: no | Getter limitation = our problem |
| **Ceylon** | Flow typing + immutable default | Immutable: yes | N/A | Immutability-first design |
| **Hack** | Refinement invalidation | Yes | No (any method call kills all) | Method calls too coarse |
| **C#** | Nullable analysis + patterns | Yes | No (fields conservative) | `readonly` doesn't help |
| **Koka** | Effect system | Pure: yes | Pure: yes | Pure functions can't invalidate |

### A.11 Cross-Language Patterns

**Universal patterns across all languages:**

1. **Local variables always survive function calls.** Every language agrees: a local
   variable that isn't captured by a closure can't be modified by a function call.

2. **Properties are the hard case.** Every language struggles with property refinements
   across calls — properties can be aliased, modified by other methods, or overridden.

3. **Immutability helps.** `val` (Kotlin), `let` (Swift), `final` (Dart), `&` (Rust) —
   strong immutability guarantees preserve more refinements. `stable` is TypeScript's
   equivalent for method return values.

4. **Explicit mutation annotation** appears in Swift (`mutating`), Rust (`&mut`), and
   Koka (`st<h>` effect). TypeScript's `mutator` follows this established pattern.

5. **The spectrum**: Conservative (Flow/Hack: any call invalidates) → Middle (Kotlin/Dart:
   distinguish locals/properties, val/var) → Precise (Rust: structural prevention,
   Koka: effect system).

### A.12 Novel Insight: TypeScript's Two-Sided Annotation

**None of the surveyed languages have a two-sided annotation system like `stable`/`mutator`:**

- Rust uses structural prevention (borrow checker) — not annotations
- Swift has `mutating` but no explicit "non-mutating" annotation (it's the struct default)
- Kotlin has `val`/`var` but these are property-level, not method-level
- Dart has `final` but can't annotate getters/methods as "stable"
- Koka has effects but they're inferred, not method-level annotations

TypeScript's innovation is providing **both sides**:
1. `stable` = "calling this method won't change observable state" → **preserve** refinements
2. `mutator` = "calling this method changes state" → **invalidate** refinements

This two-sided approach works with **structural typing**: a `stable` method is part
of the type signature, so structural compatibility flows through interfaces and generics.
An effect system (Koka-style) would require nominal typing or row polymorphism.

### A.13 Applicability Assessment

Given TypeScript's constraints (structural typing, JS compatibility, no runtime changes,
gradual adoption, performance):

| Technique | Value for TypeScript | Notes |
|-----------|---------------------|-------|
| Swift's `mutating` → `mutator` | **Very High** | Direct precedent, proven intuitive |
| Dart's field promotion → `stable` methods | **High** | Getter limitation is our exact problem |
| Kotlin's `val`/`var` smart cast logic | **High** | Local vs property distinction confirmed |
| Flow/Hack's havoc as default + `stable` opt-out | **High** | Current behavior = havoc; `stable` = targeted escape |
| Koka's purity insight → `pure` modifier | **Medium** | Pragmatic version without full effect system |
| Rust's borrow checker | **Low** | Ownership model incompatible with JS |
| Full effect system | **Very Low** | Too heavyweight for TypeScript |

### A.14 Quick Reference: Motivating Example Across Languages

How each language handles the scenario:
```
Resource { value: stable, set: mutator }
if (r.value()) { r.value(); unknownCall(); r.value(); }
```

| Language | `r.value()` narrowed? | After `unknownCall()`? | Mechanism |
|----------|----------------------|---------------------------|-----------|
| **Rust** | N/A (pattern match) | Yes (if `&T`) | Borrow checker |
| **Kotlin** | No (method call) | No | Smart casts don't apply to methods |
| **Swift** | No (getter) | No | No flow narrowing on getters |
| **Flow** | No (property access) | No | Havoc |
| **Dart** | No (getter) | No | Getter promotion unsupported |
| **Hack** | No (method result) | No | Method call invalidates |
| **C#** | No (property) | No | Conservative analysis |
| **Koka** | Yes (if `total`) | Yes (if `total`) | Effect system |
| **TS + stable/mutator** | **Yes** | **Yes** (if no `mutator` in scope) | Annotation-based |

TypeScript's `stable`/`mutator` system would be **the first mainstream language** to
allow narrowing through method calls on reference types via an annotation system.
The theoretical backing comes from Koka's effect system, but the design is pragmatic
and gradual — fitting TypeScript's philosophy.
