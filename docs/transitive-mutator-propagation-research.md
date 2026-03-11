# Transitive Mutator Propagation: Research & Feasibility Analysis

> Research document investigating whether functions that transitively invoke `mutator`
> methods could automatically propagate mutator semantics up the call chain.

**Status**: Research (informational)  
**Context**: Phase 1 `stable`/`mutator`/`invalidates` system in TypeScript-Go  
**Related**:
- [stable-modifier-spec.md](stable-modifier-spec.md) — Phase 1 SDD
- [escape-analysis-research.md](escape-analysis-research.md) — Escape analysis research
- [ts-cfa-tradeoffs-research.md](ts-cfa-tradeoffs-research.md) — CFA trade-offs
- [stable-phase2-proposal.md](stable-phase2-proposal.md) — Phase 2 linked predicates

---

## 1. Problem Statement

The `stable`/`mutator` system currently handles **direct** mutation precisely:

```ts
interface Resource<T> {
  stable value(): T | undefined;
  mutator set(v: T): void;
}

declare const r: Resource<string>;

if (r.value()) {
  const x: string = r.value();  // ✅ narrowed
  r.set("new");                  // mutator — explicitly invalidates
  const y = r.value();           // string | undefined — correctly reset
}
```

But real-world code wraps mutations in helper functions:

```ts
function wrapper(r: Resource<string>) {
  r.set("new value");  // calls mutator internally
}

if (r.value()) {
  const x: string = r.value();   // ✅ narrowed
  wrapper(r);                     // NOT marked mutator — but calls one internally!
  const y = r.value();            // Should narrowing be invalidated?
}
```

The question: **could `wrapper` automatically become a mutator by virtue of transitively
calling `r.set()`?** If so, how would this propagation work, what are the soundness
implications, and is it feasible for TypeScript?

### 1.1 Current Behavior

Today, `wrapper(r)` is classified as an **uncertainty boundary** by `classifyStableBoundary`.
The call passes through `isUnrelatedCallForStableReference` / `isUnknownCallBoundaryForStableReference`
heuristics. If `r` is passed as an argument to `wrapper`, the system sees the receiver
flowing into the call and **conservatively invalidates** narrowing — which is correct but imprecise.

The current behavior is:
- **Sound**: Narrowing IS invalidated (safe for correctness)
- **Imprecise**: No way to distinguish "wrapper definitely mutates" from "wrapper might mutate"
- **No post-call narrowing**: Unlike direct `r.set("new")` calls, `wrapper(r)` can't narrow
  `r.value()` to the argument type

So the system already does the safe thing. The research question is whether we could do
something **more precise** — or whether explicit annotation is the right path.

---

## 2. The Concept: Transitive Mutator Propagation

### 2.1 Basic Model

If a function's body calls a `mutator` on one of its parameters, the function itself
would be implicitly treated as "mutating" that parameter:

```ts
// Level 0: explicit mutator
interface Resource<T> {
  mutator set(v: T): void;
}

// Level 1: directly calls mutator on parameter
function wrapper(r: Resource<string>) {
  r.set("value");  // calls mutator → wrapper implicitly mutates 'r'
}

// Level 2: calls a Level 1 function
function outerWrapper(r: Resource<string>) {
  wrapper(r);  // calls wrapper which mutates 'r' → outerWrapper implicitly mutates 'r'
}

// Level N: arbitrary depth
function deepWrapper(r: Resource<string>) {
  outerWrapper(r);  // transitively mutates 'r'
}
```

### 2.2 What Would Change

With transitive propagation, the checker could:

1. **Classify `wrapper(r)` as `stableBoundaryKindMutatorCall`** instead of a generic
   uncertainty boundary
2. **Apply post-call narrowing**: `wrapper(r)` with argument `"value"` could narrow
   `r.value()` to `string` (non-undefined) via `getAssignmentReducedType`
3. **Selective invalidation**: Only invalidate the stable endpoints linked via `invalidates`,
   not all narrowing on `r`

### 2.3 Conditional Mutation

Functions don't always unconditionally mutate:

```ts
function maybeSet(r: Resource<string>, condition: boolean) {
  if (condition) {
    r.set("value");  // conditionally calls mutator
  }
}
```

This is analogous to Java's checked exception problem — `maybeSet` **may** throw, so
it must declare `throws Exception` regardless of the condition. Similarly, `maybeSet`
**may** mutate, so it would need to be treated as a mutator even if mutation is conditional.

This is the only sound approach without path-sensitive interprocedural analysis.

---

## 3. Explicit `mutator` Propagation

### 3.1 Direct Body Analysis (Level 1)

The simplest case: scan a function's body for `mutator` calls on its parameters.

```ts
function setAndLog(r: Resource<string>, v: string) {
  console.log("Setting value");
  r.set(v);   // ← r.set is mutator; r is a parameter → flag function as "mutates r"
  console.log("Done");
}
```

**Analysis requirements**:
- Resolve parameter `r` to its type → `Resource<string>`
- Find calls on `r` → `r.set(v)`
- Check `set`'s signature → has `SignatureFlagsMutator` → yes
- Conclude: `setAndLog` mutates parameter 0 (`r`)

**Complexity**: Low for direct calls. Requires walking function body AST once.

**Soundness**: Sound. If `r.set()` is in the body, the mutation definitely exists on that
code path.

### 3.2 N-Level Deep Propagation

At depth > 1, things get harder:

```ts
function a(r: Resource<string>) {
  b(r);    // a → b → c → r.set()
}

function b(r: Resource<string>) {
  c(r);
}

function c(r: Resource<string>) {
  r.set("x");
}
```

To determine that `a` mutates `r`, the checker must:
1. See that `a` calls `b(r)` where `r` is parameter 0
2. Determine that `b` mutates its parameter 0
3. Which requires determining that `c` mutates its parameter 0
4. Which requires seeing the direct `r.set("x")` call

This is a **call graph reachability problem** requiring:

- Building a call graph (at least for the relevant parameters)
- Handling recursive functions (fixed-point iteration)
- Caching results to avoid exponential re-analysis

### 3.3 The Halting Problem Barrier

N-level propagation is **undecidable** in general for higher-order languages:

```ts
function apply(fn: (r: Resource<string>) => void, r: Resource<string>) {
  fn(r);  // Does fn mutate r? Unknown — depends on what fn is at each call site
}

// Call site 1
apply(r => r.set("x"), resource);  // mutates

// Call site 2
apply(r => console.log(r.value()), resource);  // doesn't mutate
```

`apply` is **sometimes** a mutator and sometimes not. Static analysis can't resolve this
without call-site-specific specialization (which TypeScript explicitly avoids — no
flow-sensitive type specialization of function bodies).

### 3.4 Inference vs. Annotation

| Approach | Level 1 | Level N | Higher-Order | Performance |
|----------|---------|---------|--------------|-------------|
| **Infer from body** | ✅ Feasible | ⚠️ Expensive | ❌ Undecidable | O(body size × call depth) |
| **Explicit annotation** | ✅ Trivial | ✅ Trivial | ✅ Composable | O(1) per call |

Explicit annotation wins decisively for N > 1 and for higher-order functions.

---

## 4. Implicit Tracking Mechanisms

### 4.1 Java's Checked Exceptions: A Cautionary Tale

Java's checked exceptions are the closest real-world precedent for mandatory
effect propagation:

```java
// Level 0: throws IOException
void read() throws IOException { /* ... */ }

// Level 1: must declare because it calls read()
void process() throws IOException {
    read();
}

// Level N: must propagate
void main() throws IOException {
    process();
}
```

**Lessons for mutator propagation**:

| Java checked exceptions | Analogous mutator issue |
|------------------------|------------------------|
| Every caller must declare `throws` | Every wrapper must declare `mutates` |
| `RuntimeException` escape hatch | No equivalent — all mutations are "checked" |
| Community hated the verbosity | TypeScript community would hate parameter-level mutation annotations |
| Catch-and-swallow antipattern | `// @ts-ignore` antipattern |
| Functional interfaces (lambdas) don't compose | Higher-order functions lose mutation tracking |

Java's experience is instructive: **mandatory effect propagation at the expression level
creates enormous annotation burden and is widely considered a design mistake.** The Java
community's response was to expand `RuntimeException` usage, defeating the system.

### 4.2 Rust's `&mut` Propagation

Rust's approach is the gold standard for mutation tracking:

```rust
fn wrapper(r: &mut Resource) {
    r.set("value");  // requires &mut — propagated by the type system automatically
}

fn caller() {
    let mut r = Resource::new();
    if r.value().is_some() {
        wrapper(&mut r);     // &mut visible at call site
        // r.value() narrowing is invalidated — obvious from signature
    }
}
```

**Key insight**: Rust doesn't "propagate" — it **requires** `&mut` at every level.
Mutation is visible in the type signature, not inferred. The borrow checker
enforces it.

**Why TypeScript can't adopt this**: JavaScript has no concept of mutable vs immutable
references. All object references are inherently mutable. Adding `&mut`-like semantics
would require a paradigm shift incompatible with JavaScript.

### 4.3 Effect Systems (Koka, Eff)

Effect systems make side effects explicit in function types:

```koka
// Koka — effects in the type
fun wrapper(r : resource<string>) : <mutate> ()
  r.set("value")

// Effect propagates automatically
fun caller(r : resource<string>) : <mutate> ()
  wrapper(r)

// Pure function — no mutate effect
fun pure-read(r : resource<string>) : string
  r.value()
```

**Properties**:
- Effects are part of the type and compose naturally
- Higher-order functions propagate effects through type parameters
- Effect polymorphism handles generic wrappers: `fun apply<e>(f : () -> e ()) : e () { f() }`
- No annotation burden at call sites — the type system infers

**Why TypeScript can't adopt this directly**:
- Requires pervasive type system changes
- Every function type would need effect annotations
- Breaks backward compatibility with all existing code
- TypeScript Design Goal #5: "Avoid adding expression-level syntax"
- JavaScript functions are inherently effectful — the default would be `<everything>`

### 4.4 Haskell's IO Monad

Haskell separates pure and impure code via monads:

```haskell
-- Pure function — no IO
readValue :: Resource -> Maybe String
readValue r = value r

-- Impure — must be in IO
wrapper :: IORef Resource -> IO ()
wrapper ref = do
  r <- readIORef ref
  writeIORef ref (set r "new value")
```

**Relevance**: The IO monad gives **absolute separation** between pure and impure code.
But it requires the entire language to be designed around this — impossible to retrofit
onto JavaScript.

---

## 5. Type System Implications

### 5.1 Would This Require a New Type Annotation?

Yes. There are three possible designs:

#### Design A: Parameter-Level `mutates` Modifier

```ts
function wrapper(mutates r: Resource<string>): void {
  r.set("new");
}
```

Here `mutates` on a parameter means "this function may call mutator methods on this
parameter." The checker would treat `wrapper(r)` the same as a direct mutator call
for CFA purposes.

**Pros**:
- Explicit, composable, no inference needed
- Natural extension of TypeScript's modifier syntax
- Works at any call depth — each level declares its effects independently

**Cons**:
- New keyword in parameter position (TypeScript Design Goal #5 tension)
- Verbose for deeply nested wrappers
- Doesn't specify WHICH mutator(s) are called (no `invalidates` equivalent)

#### Design B: Function-Level `mutator` with Parameter Reference

```ts
mutator(r) function wrapper(r: Resource<string>): void {
  r.set("new");
}
```

Or as a return-type-position annotation:

```ts
function wrapper(r: Resource<string>): mutates(r) void {
  r.set("new");
}
```

**Pros**:
- Clearly separates the mutation effect from the parameter type
- Could specify which stable endpoints are affected: `mutates(r.value) void`

**Cons**:
- Novel syntax with no TypeScript precedent
- The `mutates(paramName)` syntax is expression-level (violates Design Goal #5)
- Complex grammar interaction

#### Design C: Type-Level Effect on the Function Type

```ts
type Wrapper = (r: Resource<string>) => void & { mutates: [0] };

// Or with a utility type:
type MutatingFn<T> = ((r: T) => void) & Mutates<0>;
```

**Pros**:
- No new keywords — uses existing type system machinery
- Could be a library-level solution (no parser changes)

**Cons**:
- Ugly, unergonomic syntax
- No precedent for encoding parameter-level effects in intersection types
- Hard to read and write

### 5.2 Could This Be Inferred Without Annotation?

**For Level 1**: Partially yes, within limits.

The checker could scan function bodies for mutator calls on parameters:

```ts
function wrapper(r: Resource<string>) {
  r.set("new");  // mutator call on parameter 'r' → infer mutates(r)
}
```

But inference breaks down quickly:

**Problem 1: Separate compilation**

```ts
// module-a.ts
export function wrapper(r: Resource<string>) {
  r.set("new");
}

// module-b.ts
import { wrapper } from './module-a';

if (r.value()) {
  wrapper(r);  // checker would need module-a's body to infer mutation
  r.value();   // can't determine without cross-module analysis
}
```

TypeScript does NOT analyze function bodies across module boundaries for type inference
(with narrow exceptions like return type inference for contextual typing). Adding
cross-module body analysis for mutation inference would be a fundamental change.

**Problem 2: Declaration files**

```ts
// from @types/my-lib
declare function wrapper(r: Resource<string>): void;
// No body available — no inference possible
```

Declaration files have no function bodies. Inference is impossible for any
library code shipped as `.d.ts`.

**Problem 3: Higher-order functions**

```ts
function apply(fn: (r: Resource<string>) => void, r: Resource<string>) {
  fn(r);  // fn might or might not mutate — depends on call site
}
```

The function type `(r: Resource<string>) => void` carries no mutation information.
Without effect types, `apply` can't be classified.

### 5.3 Higher-Order Function Interaction

This is the hardest problem. Consider:

```ts
// Higher-order function that applies a callback
function applyToResource<T>(
  r: Resource<T>,
  fn: (r: Resource<T>) => void
): void {
  fn(r);
}

// Sometimes called with a mutator
applyToResource(r, res => res.set("new"));

// Sometimes called with a reader
applyToResource(r, res => console.log(res.value()));
```

For `applyToResource` to propagate mutation information, the function type
`(r: Resource<T>) => void` would need to encode whether it mutates `r`.
This requires **effect types on function parameters**:

```ts
// Hypothetical — NOT proposed
function applyToResource<T>(
  r: Resource<T>,
  fn: mutates(r) (r: Resource<T>) => void  // fn mutates its r parameter
): void {
  fn(r);
}
```

This is essentially reinventing effect polymorphism — a solved problem in academic
type theory (Koka, Frank, Eff) but never successfully adopted in a mainstream language.

### 5.4 Interface Compatibility & Structural Typing

If a function carries mutation info, assignment to a plain function type loses it:

```ts
function mutatingWrapper(mutates r: Resource<string>): void {
  r.set("new");
}

// Assignment to plain function type — mutation info erased
const fn: (r: Resource<string>) => void = mutatingWrapper;

if (r.value()) {
  fn(r);        // fn's type doesn't say it mutates — narrowing incorrectly preserved?
  r.value();    // BUG: still narrowed, but fn actually mutated r
}
```

This is the **covariant function problem**: a function with more effects can be
assigned to a type that declares fewer effects. For soundness, the assignment
should be an error (contravariance of effects) or the caller should assume worst-case.

**Structural typing makes this worse**:

```ts
interface Worker {
  process(r: Resource<string>): void;  // no mutation annotation
}

class MutatingWorker implements Worker {
  // This implementation mutates r, but the interface doesn't say so
  process(mutates r: Resource<string>): void {
    r.set("updated");
  }
}

function doWork(w: Worker, r: Resource<string>) {
  if (r.value()) {
    w.process(r);  // Worker.process doesn't declare mutation
    r.value();     // BUG: MutatingWorker.process actually mutated
  }
}
```

**Lesson**: Without effect types in interfaces, mutation information is lost
at abstraction boundaries. This is a fundamental limitation, not solvable
by inference alone.

### 5.5 Generics

```ts
function processGeneric<T>(r: Resource<T>): void {
  // The generic function body might or might not mutate r
  // Type T provides no mutation information
}
```

Generics compound the inference problem: the type parameter `T` doesn't carry
mutation capability information. A `Resource<string>` and a `Resource<number>`
have the same mutation surface, but generic constraints can't express "T is a
type whose Resource has its mutator called."

---

## 6. Soundness Analysis

### 6.1 Comprehensive Soundness Holes

#### Aliasing

```ts
const r1: Resource<string> = createResource();
const r2 = r1;  // alias

function mutateR2(r: Resource<string>) {
  r.set("new");
}

if (r1.value()) {
  mutateR2(r2);     // mutates r2, but r2 IS r1
  r1.value();       // UNSOUND if narrowing preserved on r1
}
```

Even with transitive propagation, the checker can't know that `r2 === r1`
unless it tracks alias relationships. The existing `isMatchingReference`
in `classifyStableBoundary` handles direct aliases, but not arbitrary
aliasing through function parameters.

**Severity**: High. Aliasing is common in real code.

#### Asynchronous Mutation

```ts
if (r.value()) {
  setTimeout(() => r.set("async"), 0);  // schedules mutation
  r.value();  // mutation hasn't happened yet — narrowing is correct... for now
  
  await delay(100);
  r.value();  // mutation HAS happened — narrowing should be gone
}
```

Async mutation creates a temporal dimension that static analysis can't capture.
The `setTimeout` callback is a mutator, but it runs later. Transitive propagation
would need to understand JavaScript's event loop semantics.

**Current handling**: `await` boundaries already invalidate narrowing
(`stableBoundaryKindAwaitBoundary`). This is the right approach — don't try
to reason about async timing; invalidate at suspension points.

#### Conditional Mutation

```ts
function maybeSet(r: Resource<string>, shouldSet: boolean) {
  if (shouldSet) r.set("x");
}

if (r.value()) {
  maybeSet(r, false);   // doesn't actually mutate
  r.value();            // narrowing is correct, but checker can't know that
}
```

With transitive propagation, `maybeSet` would be marked as "mutates r" because
`r.set()` appears in its body (on some path). This is **overly conservative**
for the `false` case but **sound**.

Path sensitivity (knowing `shouldSet` is `false`) would require inlining the
function body's control flow into the caller — which is interprocedural CFA,
a fundamentally different (and much harder) problem.

#### Object Mutation Without Method Call

```ts
interface MutableResource<T> {
  stable value(): T | undefined;
  mutator set(v: T): void;
  backing: T | undefined;  // exposed backing field
}

function sneakyMutate(r: MutableResource<string>) {
  r.backing = "new";  // mutates backing store without calling set()
}
```

Mutation doesn't have to go through the declared `mutator` method.
This is a fundamental soundness hole in any system that tracks mutation through
method annotations — the underlying state can always be modified through other means.

**Mitigation**: This is a design-level concern. If `backing` is exposed, the
interface design is broken. Well-designed interfaces hide mutable state behind
`mutator` methods.

#### Prototype/Dynamic Dispatch

```ts
function mutateViaPrototype(r: Resource<string>) {
  Object.getPrototypeOf(r).set.call(r, "hacked");
}
```

Dynamic property access, `Reflect`, `Object.getPrototypeOf`, etc. all defeat
static analysis. TypeScript already doesn't reason about these for CFA.

### 6.2 Soundness Rating

| Scenario | Transitive propagation helps? | Remaining hole? |
|----------|-------------------------------|-----------------|
| Direct `r.set()` call | Already handled by `mutator` | None |
| `wrapper(r)` that calls `r.set()` | ✅ Yes (Level 1) | None if body available |
| Deep `a(r)→b(r)→c(r)→r.set()` | ⚠️ Partially (expensive) | Call depth limits |
| `apply(fn, r)` where `fn` mutates | ❌ No (higher-order) | Effect types needed |
| Aliased reference `r2 = r` | ❌ No | Alias analysis needed |
| Async mutation via callback | ❌ No | Temporal analysis needed |
| Conditional mutation | Overly conservative | Path sensitivity needed |
|`.d.ts` declarations | ❌ No body to analyze | Explicit annotation needed |
| Structural type erasure | ❌ No | Effect types needed |

---

## 7. Comparison with Other Type Systems

### 7.1 Rust: `&mut` Borrow Checker

**Mechanism**: Mutation requires explicit `&mut` references. The borrow checker ensures
exclusive access — you can't have `&mut` and `&` simultaneously.

```rust
struct Resource<T> {
    value: Option<T>,
}

impl<T> Resource<T> {
    fn value(&self) -> &Option<T> { &self.value }  // immutable borrow
    fn set(&mut self, v: T) { self.value = Some(v); }  // requires &mut
}

fn wrapper(r: &mut Resource<String>) {
    r.set("new".to_string());  // &mut propagates automatically through the type
}

fn main() {
    let mut r = Resource { value: Some("hello".to_string()) };
    if r.value().is_some() {
        wrapper(&mut r);  // Mutation is visible: &mut in signature
        // Borrow checker prevents reading r.value() while &mut is active
    }
}
```

**Key properties**:
- ✅ Mutation propagation is automatic via `&mut` types
- ✅ Soundness guaranteed by exclusive access rule
- ✅ Works at any depth and through generic functions
- ❌ Requires a fundamentally different programming model
- ❌ Lifetime annotations for cross-scope references
- ❌ Can't retrofit onto JavaScript — no ownership, no borrows

**Relevance to TypeScript**: Conceptually perfect, practically impossible. Rust's key
insight — mutation requires exclusive access — can't be enforced in JavaScript where
every object reference is shared by default.

### 7.2 D: `pure` Functions

```d
// D — pure function can't access global mutable state
pure int square(int x) { return x * x; }

// Impure function — can access globals
int counter = 0;
int increment() { return counter++; }  // not pure
```

D's `pure` is a weaker constraint than Rust's `&mut` — it only prevents access to
mutable global state, not mutation of parameters. A `pure` function CAN mutate its
mutable-reference parameters.

**Relevance**: Moderate. D shows that `pure` alone doesn't solve the mutation tracking
problem — you also need the parameter-level tracking.

### 7.3 Java: Checked Exceptions

```java
class Resource<T> {
    T value() { return backing; }
    void set(T v) throws MutationException { this.backing = v; }
}

// Must propagate the "throws MutationException"
void wrapper(Resource<String> r) throws MutationException {
    r.set("new");
}

// All callers must handle
void caller(Resource<String> r) throws MutationException {
    wrapper(r);
}
```

**Key lessons**:
- ✅ Explicit propagation works for any depth
- ❌ Enormous annotation burden (every function in the chain)
- ❌ Java community widely considers checked exceptions a design mistake
- ❌ Functional interfaces (lambdas) can't throw checked exceptions without wrappers
- ❌ Led to catch-and-swallow antipatterns that are WORSE than no tracking

**Relevance**: High as a **cautionary tale**. Mandatory effect annotation at every
level is painful. TypeScript should learn from Java's mistake and not require
verbose propagation syntax.

### 7.4 Effect Systems (Koka, Eff)

```koka
// Koka — effects are part of the type, inferred automatically
fun wrapper(r : resource<string>) : <mutate> ()
  r.set("value")

// Effect propagates through higher-order functions via effect polymorphism
fun apply(f : () -> e (), g : () -> e ()) : e ()
  f()
  g()

// Effect inference computes: apply(wrapper(r), pureRead(r)) : <mutate> ()
```

**Key properties**:
- ✅ Effects compose and propagate automatically
- ✅ Higher-order functions work via effect polymorphism
- ✅ No annotation burden — effects are inferred
- ❌ Requires a from-scratch type system design
- ❌ No mainstream language has adopted effect systems
- ❌ JavaScript's `() => void` type carries no effect information
- ❌ Every existing TypeScript function type would need retroactive effect annotation

**Relevance**: Elegant solution in theory. The "right answer" from a PL research
perspective. But impossible to retrofit onto TypeScript without breaking every
existing function type.

### 7.5 Haskell: IO Monad

```haskell
-- Pure function — no IO
readValue :: Resource -> Maybe String
readValue = value

-- IO function — mutation tracked in the type
wrapper :: IORef (Resource String) -> IO ()
wrapper ref = modifyIORef ref (\r -> set r "new")
```

**Key properties**:
- ✅ Complete separation of pure and impure code
- ✅ Mutation is impossible to hide — it's in the type
- ❌ Requires function coloring (pure vs IO)
- ❌ Can't retrofit onto JavaScript (everything is IO by default)
- ❌ Monadic composition is unfamiliar to most developers

### 7.6 Summary Comparison

| System | Propagation | Soundness | Annotation Burden | Higher-Order | Retrofit-able? |
|--------|-------------|-----------|-------------------|-------------|----------------|
| **Rust `&mut`** | Automatic via type | Complete | Low (built-in) | ✅ | ❌ |
| **D `pure`** | Manual | Partial | Low | ⚠️ | ❌ |
| **Java checked** | Manual | Complete | Very High | ❌ | — |
| **Koka effects** | Automatic (inferred) | Complete | None (inferred) | ✅ | ❌ |
| **Haskell IO** | Via monad type | Complete | Medium | ✅ | ❌ |
| **TypeScript (proposed)** | Manual annotation | Partial | Low-Medium | ⚠️ | ✅ |

The lesson across all systems: **automatic propagation requires deep language-level support
that can't be retrofitted.** Every successful system was designed from scratch with effect
tracking in mind.

---

## 8. Feasibility for TypeScript: Rating & Analysis

### Overall Feasibility: 3/10

#### Breakdown by Dimension

| Dimension | Rating | Reasoning |
|-----------|--------|-----------|
| **TypeScript Design Goals** | 2/10 | Design Goal #5 ("Avoid adding expression-level syntax") directly conflicts. Design Goal #3 ("Impose no runtime overhead") is satisfied but Goal #8 ("Avoid gratuitous language features") argues against a complex effect system. |
| **Backward Compatibility** | 4/10 | Inference could be opt-in (only when `stable`/`mutator` are used), but any parameter-level `mutates` keyword changes function type compatibility rules. |
| **Incremental Adoption** | 5/10 | Could work alongside existing code. Un-annotated functions would remain uncertainty boundaries (current behavior). But the value proposition is limited if most library code can't participate. |
| **Checker Performance** | 3/10 | Level 1 inference (scan function body for mutator calls) is cheap. Level N requires call graph construction and fixed-point iteration — expensive for hot checker paths. |
| **Developer Experience** | 4/10 | Explicit `mutates` on parameters is clear but verbose. Inference is magical and unpredictable. Neither is ideal. |
| **Soundness** | 3/10 | Too many holes: aliasing, structural erasure, `.d.ts` files, higher-order functions. The system can't be made sound without Rust-level changes. |
| **Complexity/Maintenance** | 2/10 | Adds a new analysis dimension to the checker. Every new language feature would need to consider interaction with mutation tracking. Long-term maintenance burden is high. |
| **Ecosystem Impact** | 4/10 | Would require DefinitelyTyped annotations, framework adoption, tooling support. Slow rollout, low initial coverage. |

### 8.1 TypeScript Design Goals Analysis

**Goal #1**: "Align with ECMAScript" — No conflict; this is a type-level feature.

**Goal #3**: "Impose no runtime overhead" — Satisfied; no emit changes.

**Goal #5**: "Avoid adding expression-level syntax" — **DIRECT CONFLICT**. A `mutates`
parameter modifier or `mutator(param)` function annotation is expression-level syntax
in function declarations. The TypeScript team has historically been very reluctant to
add new keywords in these positions.

**Goal #6**: "Be a language with a single type system" — Compatible, but the interaction
matrix (effects × types × generics × structural compatibility) is complex.

**Goal #8**: "Avoid gratuitous language features" — An effect system for mutation tracking
is powerful but arguably "gratuitous" for the narrow use case of signal CFA.

### 8.2 Why the Current System Is Actually Good Enough

The current `stable`/`mutator`/`invalidates` system handles the common cases well:

1. **Direct mutation**: `r.set("x")` → precisely handled by `mutator`
2. **Receiver writes**: `r.backing = x` → handled by Tier 1 heuristics
3. **Unknown calls passing receiver**: `wrapper(r)` → conservatively invalidated
4. **Unrelated calls**: `console.log("hi")` → preserved via unrelated-call transparency
5. **Ambient no-arg calls**: `somethingElse()` → preserved via ambient heuristics

The "wrapper(r)" case (conservative invalidation) is **sound** and matches existing
TypeScript behavior for property narrowing through function calls. It's not
maximally precise, but it's safe and predictable.

---

## 9. Alternative: Explicit `mutates(paramName)` Annotation

Instead of automatic propagation, a minimal explicit annotation system:

### 9.1 Proposed Syntax

```ts
// Option A: Parameter modifier
function wrapper(mutates r: Resource<string>): void {
  r.set("new");
}

// Option B: JSDoc annotation (no parser changes)
/** @mutates r */
function wrapper(r: Resource<string>): void {
  r.set("new");
}

// Option C: Function modifier with parameter reference
function wrapper(r: Resource<string>): void mutates(r) {
  r.set("new");
}
```

### 9.2 Design Analysis: Option A — Parameter Modifier

```ts
function wrapper(mutates r: Resource<string>): void {
  r.set("new");
}
```

**Checker behavior**: When the checker encounters `wrapper(r)` at a call site:
1. Resolve `wrapper`'s signature → parameter 0 has `mutates` modifier
2. Argument 0 is `r` — check if `r` is a stable container
3. Treat the call as equivalent to a direct mutator call on `r`
4. If `wrapper` also specifies `invalidates`, use targeted invalidation
5. Otherwise, invalidate all stable endpoints on `r`

**Type compatibility**: A function with `mutates` parameter is assignable to
a function without it (the callee does "more" — covariant effects are safe
for the callee, but the caller loses information):

```ts
// Type erasure on assignment — caller loses mutation info
const fn: (r: Resource<string>) => void = wrapper;  // OK — safe for caller
fn(r);  // But caller can't know fn mutates r — treated as uncertainty boundary
```

This is acceptable: the information loss is **at the abstraction boundary**,
which is exactly where TypeScript currently becomes conservative anyway.

**In interfaces / method signatures**:

```ts
interface ResourceProcessor<T> {
  process(mutates r: Resource<T>): void;
}

class MyProcessor implements ResourceProcessor<string> {
  process(mutates r: Resource<string>): void {
    r.set("processed");
  }
}
```

### 9.3 Design Analysis: Option B — JSDoc Annotation

```ts
/** @mutates r */
function wrapper(r: Resource<string>): void {
  r.set("new");
}
```

**Advantages**:
- Zero parser changes
- Works in `.d.ts` files
- Backward compatible with all existing TypeScript
- Can be processed by the checker as metadata

**Disadvantages**:
- Inconsistent with the `stable`/`mutator` system which uses keywords
- Fragile — JSDoc is stringly-typed, no parser validation
- Doesn't compose with function type expressions: `type Fn = (r: Resource<string>) => void` — where does the JSDoc go?
- TypeScript is moving AWAY from JSDoc-only features, not toward them

### 9.4 Design Analysis: Option C — Return-Type Position

```ts
function wrapper(r: Resource<string>): void mutates(r) {
  r.set("new");
}
```

**Advantages**:
- Keeps parameter list clean
- Groups effect information separately from parameter types
- Could support multiple parameters: `mutates(r, s)`

**Disadvantages**:
- Novel syntax position (after return type) with no precedent
- Doesn't compose with arrow functions: `(r: Resource<string>) => void mutates(r)` is confusing
- Grammar ambiguity potential

### 9.5 Recommendation

**Option A (parameter modifier)** is the most natural for TypeScript and the most
consistent with existing `stable`/`mutator` keywords. However, it should be considered
a **Phase 5+ feature** at earliest — the current system's conservative invalidation
at uncertainty boundaries is sound and handles most cases correctly.

The practical value of explicit mutation propagation is **limited to precision at
abstraction boundaries** — places where wrapper functions pass `stable` containers
to `mutator` methods. Most of these can be refactored to call the `mutator` directly
or to use inline mutations.

---

## 10. Conclusions & Recommendations

### 10.1 Key Findings

1. **Transitive mutator inference from function bodies** is feasible for Level 1 (direct calls)
   but quickly becomes undecidable for higher-order functions and expensive for deep call chains.

2. **Every successful mutation tracking system** (Rust, Koka, Haskell) was designed into the
   language from the start. Retrofitting is impractical without fundamental type system changes.

3. **Java's checked exceptions** are the best analogy for mandatory effect propagation in
   a mainstream language — and they are widely considered a design mistake due to annotation burden.

4. **The current system is sound**. Conservative invalidation at uncertainty boundaries
   (where stable references flow through function calls) is the correct default behavior.
   It matches TypeScript's existing property narrowing philosophy (optimistic for properties,
   cautious for function calls that receive the reference).

5. **The precision gap is narrow**. The cases where transitive propagation would improve over
   conservative invalidation are:
   - Wrapper functions that call a single mutator and pass through its argument
   - Pipeline functions that thread a resource through multiple steps
   - These can be addressed by explicit annotation or refactoring to direct mutation

### 10.2 Recommendations

| Recommendation | Priority | Effort | Impact |
|---------------|----------|--------|--------|
| **Keep conservative invalidation as default** | Immediate | None | Maintains soundness |
| **Consider `mutates` parameter modifier for Phase 5+** | Low | Medium | Narrow precision gain |
| **Do NOT pursue automatic transitive inference** | — | High | Poor ROI |
| **Do NOT pursue effect types / effect polymorphism** | — | Very High | Infeasible for TS |
| **Document the design rationale** | Medium | Low | Prevents re-litigation |

### 10.3 What to Tell Users

If users ask "why does `wrapper(r)` invalidate my narrowing?":

> **Functions that receive a stable container as an argument are treated as uncertainty
> boundaries because they could call mutator methods on it. This is sound and intentional.**
>
> To preserve narrowing, either:
> 1. Call the mutator directly instead of through a wrapper
> 2. Re-check with another `stable` call after the wrapper returns
> 3. Store the narrowed value in a local variable before the call
>
> ```ts
> if (r.value()) {
>   const cached = r.value();  // store narrowed value
>   wrapper(r);                 // might mutate, but cached is safe
>   console.log(cached);        // ✅ still string
>   // r.value() must be re-checked after wrapper
> }
> ```

### 10.4 Future Directions

If the community demonstrates strong demand for explicit mutation propagation
(beyond what the heuristic tier system handles), the most pragmatic path would be:

1. **JSDoc-based experimentation** (`@mutates r`) to prove the value proposition
   without parser changes
2. **Keyword upgrade** (`mutates` parameter modifier) if JSDoc proves valuable
3. **Targeted inference** (Level 1 only, function bodies in same file) as an
   optimization, not a required annotation
4. **Never full effect types** — TypeScript's design goals and JavaScript's
   fundamental mutability model make this infeasible

---

## Appendix A: Full Code Example Walkthrough

### A.1 The Ideal (Impossible) World

```ts
// Hypothetical full effect system — NOT PROPOSED
interface Resource<T> {
  stable value(): T | undefined;
  mutator set(v: T): void invalidates value;
}

// Automatic effect inference (like Koka)
function wrapper(r: Resource<string>): void {
  r.set("new");  // inferred: wrapper has effect mutate(r.value)
}

function pipeline(r: Resource<string>): void {
  wrapper(r);    // inferred: pipeline has effect mutate(r.value)
}

// At call site — full precision
if (r.value()) {
  const x: string = r.value();  // narrowed
  pipeline(r);                    // checker knows: invalidates r.value()
  const y = r.value();           // string | undefined — precise invalidation
}

// Higher-order — effect polymorphism
function apply<E>(fn: () => E void, r: Resource<string>): E void {
  fn();
}
apply(() => r.set("x"), r);  // inferred: E = mutate(r.value)
```

### A.2 The Practical (Proposed) World

```ts
// Current system — works today
interface Resource<T> {
  stable value(): T | undefined;
  mutator set(v: T): void invalidates value;
}

// Unannotated wrapper — conservative invalidation (SOUND)
function wrapper(r: Resource<string>): void {
  r.set("new");
}

if (r.value()) {
  const x: string = r.value();  // narrowed
  wrapper(r);                    // r passed as argument → uncertainty boundary → invalidated
  const y = r.value();           // string | undefined (conservative, sound)
}

// Direct mutation — precise invalidation + post-call narrowing
if (r.value()) {
  const x: string = r.value();  // narrowed
  r.set("hello");                // mutator → targeted invalidation via invalidates
  const afterSet = r.value();    // string — post-call narrowing via assignment reduction
}
```

### A.3 The Potential Phase 5+ World

```ts
// With explicit `mutates` parameter modifier
interface Resource<T> {
  stable value(): T | undefined;
  mutator set(v: T): void invalidates value;
}

function wrapper(mutates r: Resource<string>): void {
  r.set("new");
}

if (r.value()) {
  const x: string = r.value();  // narrowed
  wrapper(r);                    // `mutates r` → treated as mutator call → precise invalidation
  const y = r.value();           // string | undefined — precise invalidation (not just conservative)
}
```

---

## Appendix B: Decision Matrix

| Question | Answer | Confidence |
|----------|--------|------------|
| Should transitive propagation be automatic? | **No** | High |
| Should Level 1 (body scan) be implemented? | **Not yet** — defer to Phase 5+ if needed | Medium |
| Should a `mutates` keyword be added? | **Maybe** — Phase 5+ after evidence of demand | Medium |
| Is conservative invalidation sound? | **Yes** | High |
| Is conservative invalidation too conservative? | **Rarely** — most code calls mutators directly | High |
| Would effect types solve the problem? | **Yes, but infeasible** for TypeScript | High |
| Does Rust's approach apply? | **Conceptually yes, practically no** | High |
| Is the Java checked-exception model good? | **No** — cautionary tale | High |
