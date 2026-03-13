# Novel Approaches to Preserving Type Narrowing Across Call Boundaries

> Research document investigating unconventional strategies for preserving `stable`
> narrowing across uncertainty boundaries — approaches not covered by existing
> escape analysis, purity annotation, or transitive mutator propagation research.

**Status**: Research (informational)  
**Context**: Phase 1 `stable`/`mutator`/`invalidates` system in TypeScript-Go  
**Related**:
- [stable-modifier-spec.md](stable-modifier-spec.md) — Phase 1 SDD
- [purity-effects-research.md](purity-effects-research.md) — Purity & effect systems
- [escape-analysis-research.md](escape-analysis-research.md) — Escape analysis
- [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) — Transitive mutator propagation

---

## 0. Framing: The Central Tension

The `stable`/`mutator` system establishes a CFA-tracked narrowing discipline for
callable getter patterns. The remaining unsolved problem is **uncertainty boundaries**:
calls where the checker cannot determine whether the stable reference's backing state
may have changed.

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}
declare const r: Resource<string>;
if (r.value()) {
  unknownCall();           // ← uncertainty boundary
  r.value();               // narrowing lost — could we preserve it?
}
```

Existing research covers three strategies:
1. **Escape analysis** — prove `unknownCall` can't reach `r` (infeasible in general)
2. **Purity annotations** — mark `unknownCall` as `pure` (annotation burden)
3. **Transitive mutator propagation** — propagate `mutator` through call chains (circular)

This document explores **12 novel approaches** that attack the problem from entirely
different angles — some grounded in established type theory, some speculative.

---

## 1. Inverse `invalidates` — The `preserves` Clause

### 1.1 Concept

The `invalidates` clause is a **negative** annotation — it declares what a mutator
destroys. A `preserves` clause flips the polarity: a function explicitly declares
which stable endpoints it **does not affect**:

```ts
// Instead of annotating what changes (invalidates):
function unknownCall(): preserves(r.value) void;

// Or at the type level — pure with respect to a specific type:
function unknownCall(): preserves(Resource) void;

// Or fine-grained — preserve specific endpoints of a specific type:
function swap<T>(a: Resource<T>, b: Resource<T>): preserves(a.value, b.value) void;
```

### 1.2 Detailed Design

**Syntax** — `preserves` clause on return type position:

```ts
// Instance-level: preserves specific stable endpoints for specific parameters
function process(r: Resource<string>): preserves(r.value) void {
  console.log(r.value());  // OK — reads are always fine
  // r.set("x");           // Would conflict with preserves(r.value) — error
}

// Type-level: preserves all stable endpoints on a type
function log<T>(r: Resource<T>): preserves(Resource<T>) void;

// Multi-preserve:
function complex(a: Resource<string>, b: Store): preserves(a.value, b.user) void;
```

**CFA integration**:
```
classifyStableBoundary:
  1. Check if call target has `preserves` clause
  2. If reference's stable endpoint is in the preserves set → stableBoundaryKindNone
  3. Otherwise → fall through to normal classification
```

**Body checking** (enforcement — optional but high value):
```ts
function process(r: Resource<string>): preserves(r.value) void {
  r.set("x");  // ❌ Error: calling mutator on 'r' conflicts with preserves(r.value)
}
```

The checker can verify preservation at Level 1 (direct calls only):
- No mutator calls on preserved parameters in the immediate body
- No property writes on preserved parameters
- No passing preserved parameters to functions without `preserves` (conservative)

### 1.3 Soundness Analysis

**Soundness guarantee**: Strong IF enforcement is enabled. The function body must not
call any mutator that invalidates the preserved endpoints. Aliasing is the main escape hatch:

```ts
function sneaky(r: Resource<string>): preserves(r.value) void {
  const alias: Resource<string> = r;
  alias.set("x");  // Without alias tracking, this bypasses enforcement
}
```

**With trusted annotation** (no enforcement): Same soundness model as `stable` itself —
the developer asserts correctness, the compiler trusts it. Unsound in theory, practical
in practice. TypeScript's `readonly`, `as const`, and `stable` all follow this model.

**Soundness rating**: 8/10 with enforcement, 6/10 without (same as `stable`)

### 1.4 Interaction with `stable`/`mutator`

- `preserves` is orthogonal to `stable` and `mutator` — it's a property of the CALLER, not the callee's methods
- A function can be both a `mutator` for one endpoint and `preserves` for another:
  ```ts
  interface Store {
    stable user(): User;
    stable settings(): Settings;
    mutator setUser(u: User) invalidates user: preserves(settings) void;
  }
  ```
  Though this is redundant when `invalidates` is precise — `invalidates user` already implies `settings` is preserved. The value is for NON-mutator functions.

### 1.5 Key Insight: Duality with `invalidates`

`invalidates` says "I destroy X." `preserves` says "I don't destroy X."

For **mutators**, `invalidates` is natural — you want to know WHAT changed.
For **unknown calls**, `preserves` is natural — you want to know what DIDN'T change.

This is the **open-world vs closed-world** duality:
- Closed-world (invalidates): list what changes; everything else is preserved
- Open-world (preserves): list what's safe; everything else might change

Uncertainty boundaries are inherently open-world — we don't know what the function does,
so listing what it preserves is more ergonomic than listing what it might invalidate.

### 1.6 Feasibility: **8/10**

**Pros**:
- Natural dual of existing `invalidates`
- Directly solves the uncertainty boundary problem without full purity
- More granular than `pure` — specifies WHICH endpoints are safe
- Body enforcement is tractable (Level 1 checks are straightforward)
- Ergonomic: library authors annotate their non-mutating public APIs
- Composable: `preserves` clauses compose via intersection

**Cons**:
- New syntax / keyword
- Requires parameter-to-reference linking (which stable endpoint does "r" refer to?)
- Higher-order composition is hard (does `arr.map(fn)` preserve if `fn` preserves?)
- Partial overlap with `pure` — a `pure` function implicitly preserves everything

---

## 2. Type-Level Mutation Tracking (Phantom Generation Types)

### 2.1 Concept

Embed a phantom "generation" type parameter in the container type. Each mutator call
conceptually advances the generation, and narrowing is keyed to a specific generation.
Unknown calls cannot change the generation because they don't call mutators — only code
with knowledge of the type's mutation interface can advance it.

```ts
// The type carries a phantom generation marker
interface Resource<T, Gen = unknown> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;  // conceptually: Resource<T, Gen+1>
}

// Narrowing is keyed to Gen:
declare const r: Resource<string, Gen0>;
if (r.value()) {             // Now T is narrowed to string at Gen0
  unknownCall();              // Cannot change Gen0 — no access to mutator
  r.value();                  // Still Gen0 → narrowing preserved!
  r.set("x");                // Advances to Gen1 → narrowing invalidated
}
```

### 2.2 Detailed Design

This approach requires NO new syntax — it uses existing TypeScript generics:

```ts
// Brand type for generations
declare const GenBrand: unique symbol;
type Gen<N extends number = 0> = { readonly [GenBrand]: N };

// Resource type with generation tracking
interface Resource<T, G extends Gen = Gen<0>> {
  value: stable () => T | undefined;
  // mutator returns a new generation (type-level only)
  set(v: T): Resource<T, Gen<G[typeof GenBrand] extends number ? /* G+1 */ number : never>>;
}
```

The problem immediately surfaces: TypeScript doesn't have type-level arithmetic.
We'd need a different encoding.

**Alternative — branded uniqueness via `unique symbol`**:
```ts
interface Resource<T> {
  readonly _gen: unique symbol;  // Each instance has a unique generation brand
  value: stable () => T | undefined;
  set: mutator (v: T) => void;  // After calling: _gen changes conceptually
}
```

But `unique symbol` is per-declaration, not per-mutation-event. This fundamentally
can't track "the generation changed because `set` was called."

### 2.3 The Fatal Flaw: Mutation Is a Value-Level Event

Type-level generation tracking requires reflecting value-level mutation events
(calling `set()`) into the type system. TypeScript's type system is erasable and
doesn't track state changes across expressions. The type of `r` doesn't change
after calling `r.set()` — it's still `Resource<string>`.

Languages that CAN do this:
- **Idris** — dependent types; the type of a value can depend on runtime state
- **Linear Haskell** — linear types track consumption; `use(r)` changes `r`'s type
- **Rust** — ownership/borrowing; `&mut r` is exclusive, compiler tracks consumed moves

TypeScript has none of these. A generation counter requires dependent typing or linear
types, neither of which TypeScript will adopt.

### 2.4 Could CFA Simulate Generations Internally?

The CFA engine already tracks narrowed types through flow nodes. Internally, each flow
node is effectively a "generation" — the type of `r.value()` at flow node N may differ
from flow node N+1 if a mutator was called between them.

In other words: **CFA already IS a generation system**. The question is just what
resets the generation — and currently, uncertainty boundaries reset it conservatively.

Adding an explicit `Gen` type parameter doesn't give us new information that CFA
doesn't already have. The insight is that what we need isn't MORE type-level
information, but LESS conservative CFA behavior at uncertainty boundaries.

### 2.5 Soundness Analysis

If it could be made to work: **Sound** — generations are monotonic, and only
mutator calls advance them. Unknown calls can't advance what they can't access.

In practice: **Not applicable** — TypeScript can't express it.

### 2.6 Feasibility: **2/10**

**Pros**: Theoretically elegant, aligns with linear/affine type theory.
**Cons**: Requires dependent types or linear types. Fundamentally incompatible
with TypeScript's erasable, structural type system. CFA already provides the
mechanism — the deficit is in boundary policy, not type representation.

---

## 3. Capability-Based Mutation Control

### 3.1 Concept

Inspired by Scala 3's capability-based effects and object-capability security:
only code that possesses a "mutation capability" token can call mutators. If a
function doesn't receive the capability, it provably cannot mutate the resource.

```ts
// The mutation capability is a phantom type — a zero-cost marker
interface MutCap<T> { readonly __brand: unique symbol; }

interface Resource<T> {
  value: stable () => T | undefined;
  // set() requires the capability token
  set(v: T, cap: MutCap<Resource<T>>): void;
}

// Usage:
declare const r: Resource<string>;
declare const rCap: MutCap<Resource<string>>;

if (r.value()) {
  r.set("x", rCap);            // OK — has capability
  unknownCall();                 // Can't call r.set without rCap
  r.value();                    // ✅ narrowing preserved!
}

// unknownCall can't mutate r because it doesn't have rCap:
function unknownCall(): void {
  // r.set("x", ???);  // No capability available
}
```

### 3.2 Detailed Design

**Option A — Explicit capability passing (Scala 3 style)**:
```ts
class Resource<T> {
  #cap: MutCap<this> = Symbol() as any;

  value: stable () => T | undefined = () => this.#state;
  set(v: T): void {
    // Mutation is gated by private access to #cap
    this.#state = v;
  }

  // Give mutation rights to a specific function
  withMutation<R>(fn: (cap: MutCap<this>) => R): R {
    return fn(this.#cap);
  }
}
```

**Option B — Implicit capability via type narrowing**:
```ts
// A function that takes Resource<T> without MutCap<T> can't mutate
function process(r: Resource<string>): void {
  // r.set is NOT available because set requires MutCap
  // unless the function signature includes the capability:
}

function mutatingProcess(r: Resource<string>, cap: MutCap<Resource<string>>): void {
  r.set("x", cap);  // OK
}
```

### 3.3 The JavaScript Reality Check

This is elegant in theory but violates JavaScript's fundamental nature:

1. **JavaScript functions are closures** — `unknownCall` can capture `r` from the
   enclosing scope. The capability doesn't prevent closure capture.
2. **No linear types** — the capability token can be copied: `const cap2 = rCap;`
3. **Type erasure** — at runtime, there's no enforcement. The capability is purely
   a type-level trick.

The capability approach works in Scala 3 because the compiler tracks capabilities
through the type system AND enforces them at compilation. In TypeScript, the type
system is advisory — `as any` breaks any capability constraint.

### 3.4 What Actually Works: Private-Field-as-Capability

JavaScript already HAS a capability mechanism: **private fields** (`#field`). If the
mutator is a private method, external code literally cannot call it:

```ts
class Resource<T> {
  #state: T | undefined;
  value: stable () => T | undefined = () => this.#state;
  #set(v: T): void { this.#state = v; }  // private — external code CANNOT call this

  // Public mutation goes through a controlled API
  update(v: T): void { this.#set(v); }
}
```

But this is just access control, not a type-system feature. And it doesn't help
with the CFA problem — the checker still doesn't know that `unknownCall` can't
reach `#set` through some indirect path.

### 3.5 Soundness: **7/10** (theoretical), **3/10** (practical in TS)

Sound IF capabilities can't be copied or escaped. In TypeScript, they can — via
`as any`, type assertions, or closure capture. The approach works in capability-safe
languages (Scala 3, Pony, E language) but not in TypeScript.

### 3.6 Feasibility: **3/10**

**Pros**: Theoretically principled. Familiar from capability literature.
**Cons**: Requires linear types for soundness. JavaScript closures break the model.
Adds runtime complexity (capability tokens). Unfamiliar to TypeScript users.
Doesn't compose with existing `.d.ts` declarations.

---

## 4. Contextual Narrowing Scopes (`stable.assume`)

### 4.1 Concept

Provide a lexical scope within which all stable narrowings are trusted — the developer
asserting "nothing in this block mutates my stable references." Similar to Rust's
`unsafe` blocks or C#'s `unchecked` contexts.

```ts
// Option A: API-style scope
stable.assume(() => {
  unknownCall();
  const x: string = r.value();  // ✅ narrowing preserved by developer assertion
});

// Option B: Block directive (like "use strict")
{
  "preserve stable";
  unknownCall();
  const x: string = r.value();  // ✅ narrowing preserved
}

// Option C: Type assertion variant
const x: string = r.value()!;    // existing: non-null assertion
const y: string = r.value()!!;   // hypothetical: "trust stable narrowing" assertion
```

### 4.2 Detailed Design — Directive-Based

The most TypeScript-idiomatic approach would be a **pragma directive**:

```ts
if (r.value()) {
  const before: string = r.value();  // narrowed
  // @ts-preserve-stable
  unknownCall();
  const after: string = r.value();  // ✅ narrowing preserved (developer assertion)
}
```

Or a scope-level directive:

```ts
// @ts-preserve-stable-scope
function handler() {
  if (r.value()) {
    unknownCall();
    return r.value().toUpperCase();  // narrowing trusted
  }
}
```

**CFA integration**:
```
classifyStableBoundary:
  If boundary node is inside a preserve-stable scope → stableBoundaryKindNone
```

### 4.3 Comparison with Existing Assertion Mechanisms

TypeScript already has mechanisms for overriding the type checker's judgment:

| Mechanism | Scope | Risk | Granularity |
|---|---|---|---|
| `as T` | Single expression | Medium | Per-expression |
| `!` (non-null assertion) | Single expression | Low | Per-expression |
| `@ts-ignore` | Next line | High | Per-statement |
| `@ts-expect-error` | Next line | Medium | Per-statement |
| `// @ts-nocheck` | Entire file | Very high | Per-file |
| `stable.assume()` (proposed) | Block/scope | Medium | Per-block |

The `stable.assume` fills a gap: it's more targeted than `@ts-ignore` (only affects
stable narrowing, not all type checking) but broader than `!` (covers all stable
references in the scope, not just one expression).

### 4.4 Key Question: Is This Just a Fancy `as`?

Yes, partially. The developer could already write:

```ts
if (r.value()) {
  unknownCall();
  const x = r.value() as string;  // explicit assertion
}
```

`stable.assume` is syntactic sugar for "apply `as NarrowedType` to all stable
references after every uncertainty boundary in this scope."

**But there's an important difference**: `as` replaces the type entirely (you can
`as string` even if the check was for `number`). `stable.assume` only PRESERVES
existing narrowing — it doesn't add new narrowing. The developer is asserting
"the narrowing I already established is still valid," not "treat this as type X."

### 4.5 Soundness: **4/10**

Unsound by design — it's an assertion mechanism. The developer is asserting something
the compiler can't verify. However:
- Narrower than `as` — only preserves existing CFA-established narrowing
- Scope-bounded — doesn't leak beyond the assume block
- Self-documenting — clearly marks the assumption boundary

### 4.6 Feasibility: **6/10**

**Pros**: Simple to implement. No new type system concepts. Familiar pattern (assert
blocks). Scope-limited. Self-documenting.
**Cons**: Unsound. Shifts responsibility to developer. Doesn't scale — you'd need
`stable.assume` everywhere. Doesn't improve the TYPE SYSTEM, just suppresses errors.
Arguably, using `as` or `!` is already sufficient for this use case.

---

## 5. Deferred Invalidation / Lazy Re-Check

### 5.1 Concept

Instead of eagerly invalidating narrowing at uncertainty boundaries, DEFER the
invalidation decision until the narrowed type is actually USED after the boundary:

```ts
if (r.value()) {                       // narrowing established
  unknownCall();                        // boundary — but don't invalidate yet
  // ... other code ...
  const x: string = r.value();         // NOW decide: is narrowing still valid?
}
```

### 5.2 Detailed Design

The checker processes CFA boundaries lazily:

```
Phase 1 (forward pass, standard CFA):
  - Track narrowings normally
  - At uncertainty boundary: MARK but don't invalidate
  - Continue with narrowing intact

Phase 2 (validation pass, on demand):
  - When a narrowed reference is USED after a marked boundary:
    - Analyze the boundary to determine if invalidation is required
    - If required: emit error at the USE site (not the boundary)
    - If not required: allow the use
```

**Error placement shifts from boundary to use site**:

```ts
if (r.value()) {
  unknownCall();                        // No error HERE
  // ...100 lines of code...
  const x: string = r.value();         // Error HERE: "stable narrowing may have been
                                        // invalidated by unknownCall() at line N"
}
```

### 5.3 Key Insight: Most Boundaries Don't Matter

In real code, most uncertainty boundaries occur in code paths where the narrowed
reference ISN'T used afterwards:

```ts
if (r.value()) {
  processValue(r.value());   // use before boundary
  unknownCall();               // boundary — BUT r.value() is never used again
  return someResult;
}
```

By deferring invalidation, we avoid emitting diagnostics for boundaries that
don't affect any downstream narrowed use. This reduces diagnostic noise
significantly without changing soundness — the errors that DO fire are exactly
the ones that matter.

### 5.4 Problem: Forward Reference Analysis

CFA in TypeScript is a forward analysis — it processes statements top-to-bottom.
Deferred invalidation requires knowing whether a narrowed reference is used
LATER, which is a backward analysis.

**Options**:
1. **Two-pass CFA**: First pass collects boundaries; second pass resolves uses.
   Performance cost: ~2x for affected flow regions.
2. **Lazy/on-demand**: Only analyze when a narrowed reference is accessed.
   Requires re-walking the flow graph backward from the use site to find boundaries.
3. **Whole-function analysis**: Collect all uses and boundaries for the function,
   then resolve. This is how liveness analysis works in optimizing compilers.

Option 3 is most practical. The checker already walks the entire function body
for type checking — collecting "potentially invalidated" references and
"post-boundary uses" is a bounded addition.

### 5.5 Soundness: **9/10**

This approach IS sound if the deferred check is performed correctly. It produces
the same errors as eager invalidation — just at different locations (use sites
vs boundary sites). The narrowing facts are identical; only the diagnostic
reporting changes.

The 1-point deduction is for edge cases: if the deferred check SKIPS a boundary
(implementation bug), the narrowing is unsound.

### 5.6 Feasibility: **4/10**

**Pros**: Sound. Reduces diagnostic noise. No new syntax or annotations. The
check is the same — just relocated.
**Cons**: Requires two-pass or backward analysis (performance concern). Error
messages at use sites are less actionable than at boundary sites (the fix is at
the boundary, not the use). Complex implementation in CFA engine. The benefit
is primarily UX (fewer diagnostics) not capability (same soundness).

---

## 6. Module-Level Reachability Analysis

### 6.1 Concept

If `unknownCall` is defined in a module that doesn't import or transitively depend
on the type containing the mutator, it CAN'T call the mutator, and narrowing is safe.

```ts
// math.ts — no imports of Resource
export function add(a: number, b: number): number { return a + b; }

// app.ts
import { add } from "./math";

if (r.value()) {
  add(1, 2);                      // math.ts can't reach r.set → narrowing preserved!
  const x: string = r.value();    // ✅ safe
}
```

### 6.2 Detailed Design

**Module dependency graph construction**:
```
For each call at an uncertainty boundary:
  1. Resolve the call target's declaring module M
  2. Compute the transitive import closure of M: reachable(M)
  3. Determine the declaring module of the stable reference's receiver type: D
  4. If D ∉ reachable(M): the call CANNOT affect the stable reference
     → classify as stableBoundaryKindNone
  5. If D ∈ reachable(M): fall back to normal classification
```

**Example analysis**:
```
Module graph:
  app.ts → math.ts
         → utils.ts → resource.ts (declares Resource with mutator)
         → resource.ts

Call: add(1, 2) from math.ts
Reachable from math.ts: {} (no imports)
Resource declared in: resource.ts
resource.ts ∉ {} → SAFE → narrowing preserved

Call: process(r) from utils.ts
Reachable from utils.ts: {resource.ts}
resource.ts ∈ {resource.ts} → UNSAFE → normal classification
```

### 6.3 Handling Globals and Ambient Declarations

**Problem**: Global state (ambient declarations, `declare global`) is reachable
from every module:

```ts
// globals.d.ts
declare const r: Resource<string>;  // global — reachable from everywhere

// In app.ts:
if (r.value()) {
  add(1, 2);  // math.ts can't import Resource... but r is global!
}
```

For global stable references, module-level analysis must be more conservative:
the question isn't "can `math.ts` import `Resource`?" but "can `math.ts` access
the global variable `r`?" — and the answer is always yes for globals.

**Mitigation**: Only apply module-level preservation for locally-scoped (non-global)
stable references where the receiver was created in the current module.

### 6.4 Handling Dynamic Imports and `eval`

```ts
// math.ts — "no imports" ...but
export function sneaky(): void {
  const mod = await import("./resource");  // dynamic import!
  mod.globalResource.set("haha");
}
```

Dynamic imports break static module graph analysis. `eval` is even worse.

**Mitigation**: If a module contains `import()` or `eval`, conservatively mark it
as "may reach anything." This is the same approach dead-code eliminators use.

### 6.5 Performance Considerations

Module dependency graphs are already computed for:
- Module resolution
- Incremental compilation (find affected files)
- Tree shaking (unused export elimination)

The transitive import closure is a standard reachability query on the module graph.
For N modules and E import edges, it's O(N + E) per query — well within checker
performance budgets.

### 6.6 Key Insight: What This Actually Proves

Module-level analysis proves a STRONGER property than needed: it proves that
`unknownCall` can't even NAME the type, let alone call its mutator. This is
over-conservative in one direction (some module-reachable calls are still safe)
but perfectly sound.

### 6.7 Soundness: **8/10** (9/10 without dynamic imports)

Sound modulo dynamic `import()` and `eval`. Both are detectable and can trigger
conservative fallback. The analysis is a sound over-approximation of "can this
call reach the mutator."

### 6.8 Feasibility: **7/10**

**Pros**: No new syntax. No annotation burden. Sound. Leverages existing module
resolution infrastructure. Works automatically for well-structured codebases.
Provides meaningful benefit for the common case (calling utility functions from
unrelated modules).

**Cons**: Only helps when the call target is in an unrelated module — doesn't
help with same-module calls. Globals and ambient declarations are problematic.
Dynamic imports require conservative fallback. Doesn't help in single-file
programs. Module graph must be available during CFA (may require architectural
changes in the checker).

---

## 7. Two-Phase Narrowing with Opt-In Trust

### 7.1 Concept

Phase 1: The checker narrows optimistically — ALL calls are transparent to stable
narrowing (as if every call is `pure`).

Phase 2: The checker identifies invalidation points and emits **info-level diagnostics**
(not errors) where narrowing was optimistically preserved through a boundary that MIGHT
be unsafe.

The developer can suppress individual diagnostics for calls they KNOW are safe, or
upgrade the diagnostic severity if they want strict checking.

```ts
if (r.value()) {
  unknownCall();              // info: "stable narrowing preserved optimistically"
  const x: string = r.value(); // narrowed — optimistic assumption
  r.set("x");                 // error: mutator — narrowing actually invalidated
}
```

### 7.2 Detailed Design

**Compiler flag**: `--stableNarrowingMode`:
- `"strict"` (default phase 1): Conservative — current behavior, reset at boundaries
- `"optimistic"`: Preserve across boundaries, emit info diagnostics
- `"trusted"`: Preserve across boundaries, no diagnostics (full trust)

**Diagnostic levels**:
```ts
// In strict mode:
unknownCall();  // error: stable narrowing lost

// In optimistic mode:
unknownCall();  // info: "Stable narrowing for r.value() preserved optimistically.
                //        If unknownCall() may mutate the resource, extract to a
                //        local temporary before this call."

// In trusted mode:
unknownCall();  // (no diagnostic)
```

### 7.3 Comparison with Flow's Refinement Invalidation

Flow (Facebook's type checker) already does something similar for property access:

```js
// @flow
const obj: { x: ?string } = { x: "hello" };
if (obj.x) {
  someFunction();
  obj.x.length;  // Flow error: refinement invalidated
}
```

Flow is PESSIMISTIC about property narrowing across calls (unlike TypeScript, which is
optimistic). Our two-phase approach is the inverse: optimistic narrowing with
opt-in strictness.

### 7.4 Problem: The "Boil the Ocean" Effect

If the default is `strict`, this doesn't help — developers already face the current
behavior. If the default is `optimistic`, every uncertainty boundary emits an info
diagnostic, which is noisy. If the default is `trusted`, soundness is fully abandoned.

The sweet spot might be: `strict` by default, but with a per-call annotation to
opt into trust:

```ts
if (r.value()) {
  // @ts-trust-stable
  unknownCall();
  r.value().toUpperCase();  // narrowing preserved by developer annotation
}
```

But this is functionally identical to Approach 4 (`stable.assume` / assertion blocks).

### 7.5 Soundness: **Variable**

- Strict mode: 10/10 (same as current behavior)
- Optimistic mode: 5/10 (may produce false narrowing)
- Trusted mode: 1/10 (fully unsound for stable narrowing)

### 7.6 Feasibility: **5/10**

**Pros**: Configurable strictness. Graduated adoption path. Info diagnostics are
non-breaking. Familiar pattern (TypeScript has `strict`, `noImplicitAny`, etc.).
**Cons**: Multiple modes = confusion. "Optimistic" mode may hide real bugs.
"Trusted" mode is just `any` for stable narrowing. Doesn't fundamentally solve
the problem — just moves the strictness slider. Overlaps with approach 4.

---

## 8. Incremental Widening

### 8.1 Concept

Instead of binary narrowing (fully narrowed OR fully reset), use GRADUAL widening:
uncertainty boundaries partially widen the type, while mutator calls fully reset.

```ts
declare const r: { value: stable () => string | number | undefined };

if (r.value()) {
  // narrowed: string | number (removed undefined)
  unknownCall();
  // incrementally widened: string | number    ← NOT string | number | undefined
  //                                             uncertainty adds undefined back?
  // or: stays narrowed because "incremental widening" only adds back
  //     types that the boundary could plausibly restore
}
```

### 8.2 The Core Question: What Should Widen To?

After a truthiness check `if (r.value())`, the narrowing removes falsy types
(`undefined`, `null`, `""`, `0`, `false`). An uncertainty boundary MIGHT restore
these falsy types (if a mutator is called). But should incremental widening:

**Option A — Add back nullability only**:
```ts
// Narrowed from: string | undefined → string
// After boundary: string | undefined (only undefined is restored)
```
This makes sense for optional values but not for discriminated unions:
```ts
// Narrowed from: Circle | Square → Circle (via kind check)
// After boundary: Circle | ??? — adding undefined doesn't help
```

**Option B — Widen to the "next wider" type in a lattice**:
```ts
// Narrowed: string → string | undefined → string | number | undefined
// Each boundary widens by one step
```
But TypeScript doesn't have a canonical widening lattice for arbitrary types.

**Option C — Widen to the narrowing guard's complement**:
```ts
if (r.value() !== undefined) {
  // narrowed: string
  unknownCall();
  // widen: string | undefined (add back what the guard removed)
}
```
This is equivalent to "drop the narrowing entirely" for simple guards.

### 8.3 Soundness: **3/10**

Incremental widening is unsound unless the widening target is the declared type.
Any intermediate widening may miss valid states:

```ts
declare const r: { value: stable () => "a" | "b" | "c" | undefined };
if (r.value() === "a") {
  unknownCall();
  // Widened to "a" | undefined? But it could be "b" or "c" too!
  // Only widening to "a" | "b" | "c" | undefined is sound
  // Which is... the declared type. No benefit.
}
```

### 8.4 Feasibility: **2/10**

**Pros**: Interesting theoretical exploration.
**Cons**: Unsound for non-trivial narrowing. No principled basis for choosing
intermediate widening targets. For truthiness checks (the most common pattern),
incremental widening degenerates to full reset. Adds complexity without benefit.

---

## 9. Contract-Based Pre/Post Conditions

### 9.1 Concept

Functions declare explicit contracts about what stable narrowings they preserve:

```ts
function processResource(r: Resource<string>):
  requires(r.value() is string)
  ensures(r.value() is string)
  void
{
  // implementation must maintain: if r.value() was string, it's still string
}
```

Inspired by Eiffel's Design by Contract, Spec#, and JML (Java Modeling Language).

### 9.2 Detailed Design

**Syntax — explicit pre/post conditions**:
```ts
// Full contract syntax
function process(r: Resource<string>):
  pre(r.value() is string)      // precondition: narrowing holds before call
  post(r.value() is string)     // postcondition: narrowing holds after call
  void;

// Shorthand for "preserves this narrowing"
function process(r: Resource<string>): preserves(r.value() is string) void;

// Multiple conditions
function swap(a: Resource<string>, b: Resource<number>):
  pre(a.value() is string, b.value() is number)
  post(a.value() is string, b.value() is number)
  void;
```

**CFA integration**:
```
At call site:
  1. Check preconditions: are current narrowings compatible?
  2. If yes: apply postconditions as the new narrowing state
  3. If no: precondition violation error
```

This is more general than `preserves` — postconditions can CHANGE narrowing:

```ts
function validate(r: Resource<string | number>):
  post(r.value() is number)
  boolean;

if (validate(r)) {
  r.value();  // narrowed to number via postcondition
}
```

### 9.3 How This Differs from Type Predicates

Type predicates (`param is T`) narrow the parameter's type. Contract conditions
narrow a PROPERTY OF the parameter:

```ts
// Type predicate — narrows r itself:
function isResource(r: unknown): r is Resource<string>;

// Contract — narrows r.value() (a method call on r):
function validate(r: Resource<string | number>):
  post(r.value() is number) boolean;
```

This aligns exactly with linked predicates (Phase 2a): `hasValue(): this.value() is T`.
The contract approach generalizes linked predicates to arbitrary functions, not just
methods on the same interface.

### 9.4 Can This Be Expressed in Today's TypeScript?

Partially, using assertion functions and overloads:

```ts
// Assertion variant
function assertDefined(r: Resource<string>):
  asserts r.value() is string;  // ← hypothetical extension of asserts

// Overload variant
function process(r: Resource<string> & { value(): string }): void;
function process(r: Resource<string>): void;
```

The assertion variant is a natural extension of `asserts param is T` to
`asserts param.method() is T` — very similar to linked predicates.

### 9.5 Soundness: **7/10**

Sound IF contracts are checked in function bodies (Eiffel-style runtime checks or
static verification). Unsound if trusted (same as `stable`). The postcondition
model is inherently sound — it's just a type predicate with richer syntax.

### 9.6 Feasibility: **6/10**

**Pros**: Extremely expressive. Generalizes linked predicates and `preserves`.
Familiar from DbC literature. Can be introduced incrementally (start with simple
`preserves`, extend to full pre/post).
**Cons**: Complex syntax. Heavy annotation burden for full contracts. Verification
is expensive or impossible without runtime support. Overlaps with Phase 2a linked
predicates. May be over-engineered for the specific problem (uncertainty boundaries
are a narrow use case for the full DbC machinery).

---

## 10. Ownership-Lite: Scoped Mutation Authority

### 10.1 Concept

A lightweight ownership model: stable containers have a lexical "mutation scope" —
only code within that scope can call mutators. Code outside the scope can read
but not mutate, so unknown calls from outside are guaranteed safe.

```ts
// The mutation scope is the function where r is created or declared:
function handler() {
  const r = createResource<string>();  // r's mutation scope = handler

  if (r.value()) {
    externalCall();                      // not in r's mutation scope → SAFE
    r.value().toUpperCase();             // ✅ narrowing preserved

    r.set("new");                        // ✅ OK — we're in the mutation scope
  }
}

// External code can receive r but can't mutate:
function externalCall(): void {
  // Even if r is captured via closure, mutation is scope-restricted
}
```

### 10.2 How This Differs from `const`

`const r = ...` prevents reassigning `r`. Ownership-lite prevents MUTATING `r`'s
backing state from outside the owning scope. They're orthogonal:

| | `const` | Ownership-lite |
|---|---|---|
| Prevents `r = newValue` | ✅ | ❌ (not about binding) |
| Prevents `r.set(x)` from outside | ❌ | ✅ |
| Prevents `r.set(x)` from inside | ❌ | ❌ |

### 10.3 The Critical Problem: Closures

JavaScript closures make ownership analysis extremely difficult:

```ts
function handler() {
  const r = createResource<string>();

  const setter = () => r.set("leaked");  // closure captures r
  externalCall(setter);                   // passes setter to external code
  // Now externalCall CAN mutate r through the setter callback!
}
```

This is exactly the aliasing escape problem. The current system handles this via
`stableBoundaryKindAliasEscape` — if `r` or its mutator escapes to external code,
narrowing is invalidated.

Ownership-lite would need to track:
1. Whether the receiver (`r`) escapes
2. Whether any mutator bound to `r` escapes (as a method reference or closure)
3. Whether any code path from the call site can reach an escaped mutator

This is... escape analysis. We've come full circle.

### 10.4 What's ACTUALLY New Here vs Escape Analysis

The insight isn't the analysis — it's the DEFAULT ASSUMPTION. Escape analysis asks
"can this call reach the mutator?" (proves safety). Ownership asks "does this code
have mutation authority?" (proves restriction).

In practice, the difference is:
- Escape analysis is PERMISSIVE by default (any code might reach anything, prove otherwise)
- Ownership is RESTRICTIVE by default (no code has authority unless granted)

For unknown calls, ownership-lite says: "you don't have mutation authority UNLESS
you can show you received it." This inverts the burden of proof, which may enable
simpler analyses for common patterns.

### 10.5 Practical Encoding: `readonly` References

The most practical encoding of ownership-lite in TypeScript is through `Readonly<T>`
where mutators are stripped from the type:

```ts
type ReadonlyResource<T> = Omit<Resource<T>, 'set'>;

function externalCall(r: ReadonlyResource<string>): void {
  r.value();   // OK
  // r.set();  // Property 'set' does not exist
}
```

If `externalCall` takes `ReadonlyResource<T>`, the checker KNOWS it can't call `set`.
This is already expressible. The question is whether the CFA should automatically
infer this for calls that don't have `mutator` in their parameter types.

### 10.6 Soundness: **6/10**

Sound for the simple case (no closures, no aliasing). Breaks with closure capture
and aliasing, which are ubiquitous in JavaScript.

### 10.7 Feasibility: **4/10**

**Pros**: Intuitive model. Inverts burden of proof.
**Cons**: Closures break the model fundamentally. Degenerates to escape analysis
for non-trivial cases. The practical encoding (`Readonly<T>` / `Omit`) already
exists but doesn't help with CFA automatically.

---

## 11. Frozen/Sealed Analysis via `Readonly<T>`

### 11.1 Concept

If a stable container's type doesn't include any mutator methods — either because
the type is `Readonly<T>` or because the interface simply doesn't declare mutators —
then ALL function calls are safe for narrowing. No mutation is possible through
the type system.

```ts
// Explicit: strip mutators via Readonly
type ReadonlyResource<T> = {
  value: stable () => T | undefined;
  // set is absent
};

declare const r: ReadonlyResource<string>;
if (r.value()) {
  anyCallAtAll();                     // Can't reach set() — it doesn't exist
  const x: string = r.value();        // ✅ narrowing preserved, always
}
```

### 11.2 This Already Works!

If the declared type has no mutator methods, the current heuristic system already
handles this: `isUnrelatedCallForStableReference` checks whether the call could
reach a mutator on the receiver. If no mutator exists on the type, the call is
unrelated → narrowing is preserved.

The question is: can we make this MORE automatic?

**Auto-detection**: When all of these hold:
1. The stable reference's type has zero `mutator` methods
2. The receiver is `const`-bound (can't be reassigned)
3. No property writes are possible on the receiver (all properties are `readonly`)

Then the stable reference is in "immutable mode" — ALL uncertainty boundaries are
transparent. This is a special case that the checker could flag for optimized CFA.

### 11.3 Extension: Conditional Immutability

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

// Full type — has mutator
const r1: Resource<string> = createResource();

// Readonly projection — no mutator
const r2: Readonly<Resource<string>> = r1;

if (r2.value()) {
  unknownCall();              // r2 has no set() → safe
  r2.value().toUpperCase();   // ✅ narrowing preserved
}
```

**Challenge**: `Readonly<T>` in TypeScript only makes properties `readonly` — it
doesn't remove methods. `r2.set` would still exist but with type
`(v: string) => void` (unchanged). We'd need `Readonly` to strip mutator methods:

```ts
// Proposed behavior:
type Readonly<Resource<string>> = {
  readonly value: stable () => string | undefined;
  // set is REMOVED because it's marked mutator
};
```

This would require `mutator` to participate in `Readonly<T>` mapped type behavior.

### 11.4 Soundness: **9/10**

If the type genuinely has no mutation interface, narrowing is sound across all
boundaries. The only escape hatch is runtime monkey-patching, which TypeScript
can't prevent regardless.

### 11.5 Feasibility: **7/10**

**Pros**: Leverages existing `Readonly<T>` infrastructure. Sound without
annotation burden (for read-only types). Automatic — no new keywords needed.
Intuitive — "if you can't mutate it, narrowing is safe."
**Cons**: Only helps for immutable/read-only types. Most interesting use cases
involve types that DO have mutators. Requires `Readonly<T>` to strip `mutator`
methods (new semantic, currently doesn't). Doesn't address the general case.

---

## 12. Domain-Specific: Signal/Reactive Narrowing Protocol

### 12.1 Concept

Rather than solving narrowing preservation for ALL types, define a PROTOCOL
specifically for signal/reactive patterns — the use case that motivated `stable`.

```ts
// A "Narrowable Signal" protocol:
interface NarrowableSignal<T> {
  // Read: CFA-trackable, stable
  (): T;                              // stable implied by protocol

  // State transitions: explicitly declared
  transitions: {
    set: (v: T) => void;              // mutator implied by protocol
    update: (fn: (v: T) => T) => void;
  };

  // Narrowing contract: auto-generated from transitions
  preservesNarrowingUnless: keyof this["transitions"];
}
```

The protocol declares:
1. The read interface (implicitly `stable`)
2. The mutation interface (implicitly `mutator`)
3. A narrowing contract derived from the structure

The checker automatically knows: any call that DOESN'T invoke a method from
`transitions` is safe for narrowing. This is a structured, declarative alternative
to per-function `preserves` annotations.

### 12.2 Detailed Design — Protocol-Based CFA

```ts
// Framework declares the protocol:
interface Signal<T> extends NarrowableSignal<T> {
  stable (): T;
  set: mutator (v: T) => void;
  update: mutator (fn: (v: T) => T) => void;
}

// User code:
const count = createSignal<number | undefined>(42);

if (count()) {
  processData();           // Not in Signal.transitions → safe
  console.log(count());    // ✅ narrowed to number

  count.set(undefined);    // In Signal.transitions → invalidates
  console.log(count());    // number | undefined — reset
}
```

**CFA integration**: For references whose type implements `NarrowableSignal<T>`,
the boundary classifier knows the COMPLETE set of mutation operations. Any call
that isn't one of those operations is automatically transparent.

### 12.3 How This Relates to Existing Heuristics

The current heuristic system already does something similar:
- Tier 1 heuristics detect "known writable methods on same declaration symbol"
- The check is structural: does the call target match a mutator on the same receiver?

The protocol approach formalizes this: instead of heuristics guessing which methods
are mutators, the protocol DECLARES the complete mutation surface. The heuristic
becomes deterministic.

### 12.4 Problem: Protocol Adoption

For this to work, every signal/reactive library must adopt the protocol TS provides. This is the
chicken-and-egg problem TypeScript has avoided by preferring structural typing over
nominal protocols.

**Mitigation**: The protocol could be structural:
```ts
// Auto-detected: any type with stable + mutator methods
// qualifies for protocol-based narrowing
type HasNarrowableProtocol<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (SignatureOf<T[K]> extends { flags: SignatureFlagsStable }
        ? "stable"
        : SignatureOf<T[K]> extends { flags: SignatureFlagsMutator }
          ? "mutator"
          : "unknown")
    : "property"
};
```

If a type has at least one `stable` method and at least one `mutator` method,
the checker automatically treats it as implementing the narrowable protocol.
No explicit adoption needed.

### 12.5 Soundness: **8/10**

Sound if the protocol correctly declares all mutation operations. The "closed
mutation surface" assumption is the same as `invalidates` — the developer
declares what mutates, and the checker trusts the declaration.

### 12.6 Feasibility: **7/10**

**Pros**: No new keywords beyond existing `stable`/`mutator`. Automatic for
annotated types. Declarative — the type structure IS the contract. Aligns with
TypeScript's structural typing philosophy (protocol is structural, not nominal).
**Cons**: Requires types to have `stable` AND `mutator` annotations. Doesn't
help for types with only `stable` (no declared mutations). The "closed mutation
surface" assumption may be too strong (external code can mutate via escape).

---

## 13. Comparative Analysis

| # | Approach | Soundness | Feasibility | Annotation Burden | Novelty | Solves General Case? |
|---|---|---|---|---|---|---|
| 1 | `preserves` clause | 8/10 | **8/10** | Per-function | Medium | Yes |
| 2 | Phantom generations | Sound | 2/10 | Per-type | High | Theoretically |
| 3 | Capability-based | 7/10 | 3/10 | Per-function + token | High | No (closures) |
| 4 | `stable.assume` scope | 4/10 | 6/10 | Per-block | Low | Yes (unsound) |
| 5 | Deferred invalidation | 9/10 | 4/10 | None | Medium | Partially (UX) |
| 6 | Module reachability | 8/10 | **7/10** | None | **High** | Partially |
| 7 | Two-phase narrowing | Variable | 5/10 | Config | Low | No |
| 8 | Incremental widening | 3/10 | 2/10 | None | Medium | No |
| 9 | Contract pre/post | 7/10 | 6/10 | Per-function, heavy | Medium | Yes |
| 10 | Ownership-lite | 6/10 | 4/10 | Per-binding | Medium | No (closures) |
| 11 | Frozen/Readonly | 9/10 | 7/10 | None (structural) | Low | Immutable only |
| 12 | Signal protocol | 8/10 | 7/10 | Structural (auto) | Medium | Domain-specific |

---

## 14. The Most Promising Novel Approach: `preserves` Clause + Module Reachability

### 14.1 Why These Two Are Complementary

After analyzing all 12 approaches, two stand out as both novel AND practical:

1. **`preserves` clause** (Approach 1) — the best ANNOTATION-BASED solution
2. **Module reachability** (Approach 6) — the best AUTOMATIC solution

They compose beautifully:

```
Boundary classification algorithm (extended):

1. Is this a known mutator call?  → Invalidate
2. Is the receiver aliased/escaped? → Invalidate (existing behavior)
3. MODULE CHECK: Is the call target from a module that can't reach the mutator type?
   → Preserve (automatic, no annotation needed)
4. PRESERVES CHECK: Does the call target have a `preserves` clause for this reference?
   → Preserve (explicit annotation)
5. EXISTING HEURISTICS: Apply tier 1/2/3 classification
6. Fall through → Conservative invalidation
```

**Step 3 is free** — it requires no annotations and leverages existing module
resolution infrastructure. It handles the MOST COMMON case: calling utility
functions from unrelated modules.

**Step 4 handles the remaining cases** — when the call target IS in a related
module but the developer knows it's safe.

### 14.2 Combined Example

```ts
// --- math.ts (no Resource imports) ---
export function sqrt(x: number): number { return Math.sqrt(x); }

// --- logger.ts (imports Resource for logging, but doesn't mutate) ---
import type { Resource } from "./resource";
export function logResource(r: Resource<unknown>): preserves(r) void {
  console.log(r.value());
}

// --- app.ts ---
import { sqrt } from "./math";
import { logResource } from "./logger";

if (r.value()) {
  sqrt(4);              // Step 3: math.ts can't reach Resource → PRESERVED (auto)
  logResource(r);       // Step 4: logger.ts CAN reach Resource, but has preserves → PRESERVED
  r.set("x");           // Step 1: known mutator → INVALIDATED
  unknownLocalCall();   // Step 6: fall through → conservatively invalidated
}
```

### 14.3 Implementation Roadmap

**Phase A (Module reachability — zero annotation cost)**:
1. Build transitive import closure for call target's declaring module
2. Check if stable reference's mutator-declaring module is in the closure
3. If not reachable → boundary is transparent
4. Conservative fallback for dynamic imports and globals
5. Estimated complexity: ~200 LOC in `flow.go`

**Phase B (`preserves` clause — gradual annotation)**:
1. Add `preserves` as contextual keyword in function type syntax
2. Parse `preserves(paramName)` or `preserves(paramName.method)` after return type
3. In `classifyStableBoundary`, check called function's `preserves` clause
4. Optional: Level 1 body checking (no mutator calls on preserved parameters)
5. Estimated complexity: ~400 LOC total (parser + checker)

### 14.4 Why NOT the Other Approaches

| Approach | Why Not Primary |
|---|---|
| Phantom generations | Requires dependent types — impossible in TS |
| Capabilities | Closures break the model; too foreign for TS users |
| `stable.assume` | Just `as T` with lipstick; doesn't improve type system |
| Deferred invalidation | Same soundness, worse error locations; complex CFA changes |
| Two-phase narrowing | Configurable strictness = confusion; doesn't solve the problem |
| Incremental widening | Unsound for non-trivial narrowing; no principled basis |
| Contracts (full pre/post) | Over-engineered; linked predicates already cover the core use case |
| Ownership-lite | Degenerates to escape analysis for non-trivial cases |
| Frozen/Readonly | Only helps for immutable types; most interesting types have mutators |
| Signal protocol | Subset of what `stable`/`mutator` already provides structurally |

### 14.5 The Key Insight

The uncertainty boundary problem has TWO distinct sub-problems:

1. **Cross-module calls to unrelated code** — the vast majority of cases. Module
   reachability analysis solves this automatically, with no annotation cost.

2. **Same-module calls to related-but-safe code** — less common but still important.
   The `preserves` clause provides a targeted, low-burden annotation for these cases.

No single approach solves both. The combination is greater than the parts.

---

## 15. Open Questions

1. **`preserves` syntax**: Should it be on the return type (`preserves(r) void`) or
   on the parameter (`preserves r: Resource<T>`)? The parameter position aligns with
   `readonly` parameter semantics.

2. **Module reachability granularity**: Module-level is coarse. Could we do
   declaration-level? "This export doesn't reference any mutator" — finer but harder.

3. **`preserves` verification**: Should we enforce `preserves` in function bodies
   (like `readonly` prevents writes), or trust annotations (like `stable`)?

4. **Interaction with `import type`**: `import type { Resource }` doesn't create a
   runtime dependency. Should module reachability analysis treat type-only imports
   as "non-reachable"? Probably yes — type-only imports can't call mutators.

5. **`preserves` composability**: If `f` has `preserves(r)` and calls `g` which
   doesn't, does `f` violate its `preserves` contract? Level 1 body checking
   would flag this; trusted mode would not.

---

## 16. References

- [TypeScript #9998](https://github.com/microsoft/TypeScript/issues/9998) — CFA trade-offs
- [TypeScript #7770](https://github.com/microsoft/TypeScript/issues/7770) — Pure functions
- [Koka language](https://koka-lang.github.io/) — Row-polymorphic effects
- [Scala 3 Capture Checking](https://docs.scala-lang.org/scala3/reference/experimental/cc.html) — Capability-based effects
- [Eiffel Design by Contract](https://www.eiffel.org/doc/eiffel/ET-_Design_by_Contract_and_Assertions) — Pre/post conditions
- [Pony capabilities](https://tutorial.ponylang.io/reference-capabilities/) — Object capability security
- [Flow refinement invalidation](https://flow.org/en/docs/lang/refinements/) — Pessimistic property narrowing
