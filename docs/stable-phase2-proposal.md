# Phase 2 Proposal: Linked Predicates & Advanced Patterns

## Document Control
- **Status**: Proposal (Draft)
- **Audience**: TypeScript language/design contributors, checker implementers, framework authors
- **Scope**: Phase 2 features building on Phase 1 `stable`/`mutator`/`invalidates` CFA infrastructure
- **Prerequisites**: Phase 1 complete and stable (all validation green)
- **Related documents**:
  - [stable-modifier-spec.md](stable-modifier-spec.md) — Phase 1 SDD
  - [stable-phase1-pr-description.md](stable-phase1-pr-description.md) — Phase 1 status & roadmap
  - [cross-method-type-guards-research.md](cross-method-type-guards-research.md) — Linked predicates research
  - [stable-inheritance-research.md](stable-inheritance-research.md) — Hierarchy/override rules
  - [research-map-has-get-narrowing.md](research-map-has-get-narrowing.md) — Map/Set analysis

---

## 1. Executive Summary

Phase 1 established `stable`/`mutator`/`invalidates` as CFA primitives for method-based access patterns:
- `stable` marks parameterless functions whose return type is CFA-trackable
- `mutator` marks functions that change underlying state
- `invalidates` links mutators to the stable endpoints they affect
- Post-call narrowing (`set(42)` narrows `read()`) via `getAssignmentReducedType`

Phase 2 introduces **linked type predicates** — the ability for one method's boolean result to narrow another method's return type. This addresses a 10+ year gap in TypeScript's type system (issues #9619, #13086, #30581, #57725 — 500+ combined upvotes) that no mainstream language has solved.

**Core syntax**: `this.method() is Type` — a natural extension of existing `param is T` / `this is T` type predicates.

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
}
```

Phase 2 is split into three sub-phases:
- **2a (MVP)**: Simple linked predicates — `hasValue(): this.value() is T` (~400 LOC)
- **2b**: Keyed linked predicates — `has(key): this.get(key) is V` (~600 LOC additional)
- **2c**: Discriminated method unions — multi-predicate intersection (~1000 LOC additional)

This document also catalogues deferred items (exclusive invalidates, hierarchy formalization, getter mutation invalidation) with analysis justifying deferral.

---

## 2. Phase 2a: Linked Type Predicates (MVP)

### 2.1 Problem Statement

JavaScript APIs and modern frameworks expose correlated state through separate methods. A boolean "check" method determines whether a "read" method's return type can be narrowed:

**Angular Resource pattern** (production API):
```ts
interface Resource<T> {
  readonly value: Signal<T>;
  readonly status: Signal<ResourceStatus>;
  hasValue(): boolean;
}

// Today: no narrowing after hasValue()
const r: Resource<string | undefined> = getResource();
if (r.hasValue()) {
  r.value();  // Still string | undefined — no CFA connection
}
```

Angular currently works around this with a `this is` type predicate hack:
```ts
hasValue(this: T extends undefined ? this : never): this is Resource<Exclude<T, undefined>>;
```
This narrows the *entire object type* — imprecise, fragile, and doesn't compose when multiple independent fields exist.

**Signal `isNumber`/`get` pattern**:
```ts
interface Counter {
  stable get(): number | string;
  isNumber(): boolean;
}

const c: Counter = ...;
if (c.isNumber()) {
  c.get(); // Want: narrowed to number, currently: number | string
}
```

**Optional container pattern** (Maybe, Option-like):
```ts
interface Maybe<T> {
  stable get(): T | undefined;
  isDefined(): boolean;  // when true, get() returns T
}
```

These all share the same structure: a boolean guard method that provides evidence about what a stable endpoint returns.

### 2.2 Proposed Syntax

Extend type predicate syntax to support `this.method() is Type`:

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
}

interface Counter {
  stable get(): number | string;
  isNumber(): this.get() is number;
}

interface Maybe<T> {
  stable get(): T | undefined;
  isDefined(): this.get() is T;
}
```

**Syntax grammar extension** (in return type position):
```
TypePredicate:
  Identifier 'is' Type                    // existing: param is T
  'this' 'is' Type                        // existing: this is T
  'this' '.' Identifier '(' ')' 'is' Type // NEW: this.method() is T
```

The `this.` prefix is required to eliminate ambiguity with local variable references. The `()` is required to distinguish from property access (properties use `this is T` with whole-object narrowing).

### 2.3 Semantic Rules

#### Rule 1: Target must be `stable`

The target method referenced in the predicate **must** have a `stable` function type. Without `stable`, repeated calls are not CFA-tracked, and narrowing cannot be applied.

```ts
interface Valid {
  stable value(): string | undefined;
  hasValue(): this.value() is string;  // ✅ value() is stable
}

interface Invalid {
  value(): string | undefined;          // not stable!
  hasValue(): this.value() is string;  // ❌ Error: target of linked predicate must be stable
}
```

#### Rule 2: Guard method need NOT be `stable`

The guard method is invoked once as a boolean check. Its own return type does not need CFA tracking.

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;  // hasValue itself is not stable — that's fine
}
```

#### Rule 3: Narrowing applies only in truthy branch

Like existing type predicates, the narrowing applies in the truthy branch of a conditional:

```ts
if (r.hasValue()) {
  r.value();  // narrowed to Exclude<T, undefined>
} else {
  r.value();  // still T (no narrowing in false branch)
}
```

#### Rule 4: Receiver identity must match

The narrowing applies only when the guard call's receiver and the target call's receiver are the same reference (per `isMatchingReference`):

```ts
const r1: Resource<string | undefined> = ...;
const r2: Resource<string | undefined> = ...;

if (r1.hasValue()) {
  r1.value();  // ✅ narrowed — same receiver
  r2.value();  // ❌ NOT narrowed — different receiver
}
```

#### Rule 5: Mutator invalidation applies naturally

When a `mutator` call invalidates a `stable` endpoint, any linked-predicate narrowing on that endpoint is also invalidated — because the narrowing is stored on the same flow node:

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
  set: mutator (v: T) => void invalidates value;
}

const r: Resource<string | undefined> = ...;
if (r.hasValue()) {
  r.value();        // narrowed to string
  r.set(undefined); // mutator invalidates value's flow node
  r.value();        // back to string | undefined
}
```

#### Rule 6: Uncertainty boundaries invalidate linked predicates

All existing uncertainty boundary invalidation rules (unknown calls, callbacks, await, alias escape) apply to linked-predicate narrowing identically:

```ts
if (r.hasValue()) {
  r.value();         // narrowed
  unknownCall();     // uncertainty boundary
  r.value();         // narrowing lost (unless guarded preserve applies)
}
```

#### Rule 7: Narrowed type must be assignable to target return type

The `is Type` in the predicate must be assignable to the target method's declared return type:

```ts
interface Valid {
  stable get(): number | string;
  isNumber(): this.get() is number;  // ✅ number is assignable to number | string
}

interface Invalid {
  stable get(): number | string;
  isNumber(): this.get() is boolean;  // ❌ Error: boolean is not assignable to number | string
}
```

### 2.4 Examples

#### Example 1: Angular Resource

```ts
interface Resource<T> {
  stable value(): T;
  readonly status: Signal<ResourceStatus>;
  hasValue(): this.value() is Exclude<T, undefined>;
}

function displayResource(r: Resource<string | undefined>) {
  if (r.hasValue()) {
    // r.value() narrowed to string
    console.log(r.value().toUpperCase());  // ✅ no error
  }

  // Outside guard: r.value() is string | undefined
  const v = r.value();  // string | undefined
}
```

**Improvement over Angular's current `this is` approach**:
- Narrows only `value()`, not the entire `Resource` type
- Works regardless of whether `T` is a generic parameter
- Composes with multiple independent stable endpoints

#### Example 2: Signal `isNumber`/`get`

```ts
interface TypedSignal {
  stable get(): number | string | boolean;
  isNumber(): this.get() is number;
  isString(): this.get() is string;
}

function process(sig: TypedSignal) {
  if (sig.isNumber()) {
    const n: number = sig.get();  // ✅ narrowed
    return n * 2;
  }
  if (sig.isString()) {
    const s: string = sig.get();  // ✅ narrowed
    return s.toUpperCase();
  }
  // sig.get() is boolean here (narrowed by exclusion)
  return sig.get() ? "yes" : "no";
}
```

#### Example 3: Optional container

```ts
interface Option<T> {
  stable get(): T | undefined;
  isDefined(): this.get() is T;
  isEmpty(): this.get() is undefined;
}

function unwrap<T>(opt: Option<T>): T {
  if (opt.isDefined()) {
    return opt.get();  // ✅ narrowed to T
  }
  throw new Error("empty");
}
```

#### Example 4: Interaction with `mutator`/`invalidates`

```ts
interface WritableOption<T> {
  stable get(): T | undefined;
  isDefined(): this.get() is T;
  set: mutator (v: T | undefined) => void invalidates get;
  clear: mutator () => void invalidates get;
}

function example(opt: WritableOption<number>) {
  if (opt.isDefined()) {
    opt.get();  // number (narrowed by linked predicate)
    opt.set(42);
    opt.get();  // number | undefined (mutator invalidated the flow node)
  }
}
```

#### Example 5: Guard is the inverse of invalidates

The modifier system forms a complete lattice:

```
guard (evidence: narrows)        → e.g., hasValue(): this.value() is T
       ↓
stable endpoint (CFA-tracked)    → e.g., stable value(): T
       ↑
mutator + invalidates (resets)   → e.g., mutator set(v) invalidates value
```

Guards and invalidates are complementary:
- **Guards narrow** — `hasValue()` returning true tightens `value()`'s type
- **Invalidates widen** — `set()` resets `value()`'s type to its declared type
- Both operate on the same CFA flow node tracked by `stable`

### 2.5 Implementation Plan

#### Parser Changes (~200 LOC)

1. **Extend `parseTypePredicatePrefix`**: Recognize `this.identifier()` as a valid predicate target in return type position. After parsing `this`, check for `.` followed by an identifier and `()`.

2. **New AST representation**: Add `TypePredicateKindMethod` to the `TypePredicateKind` enum. The `TypePredicateNode` gains an optional `methodName` field and the receiver is implicitly `this`.

3. **Disambiguation**: `this.value() is T` vs `this.value()` as a return type expression — the presence of `is` after the closing `)` disambiguates. Without `is`, it's a regular call expression type.

#### Binder Changes (minimal)

No significant changes. Flow nodes for guard calls already produce `FlowCondition` nodes. The binder doesn't need to know about the specific predicate kind — it creates the same flow structure for all boolean type guards.

#### Checker Changes (~500 LOC)

1. **`getTypePredicateOfSignature`**: Extend to return a method-typed predicate when the return type annotation uses `this.method() is Type` syntax. Parse the predicate target to identify the method name and verify it resolves to a `stable` endpoint on the receiver type.

2. **`narrowTypeByTypePredicate`**: For `TypePredicateKindMethod`:
   - Resolve the target method on `this` (the receiver type)
   - Verify the target's signature has `SignatureFlagsStable`
   - Apply the narrowing to the target method's return type in the current flow
   - Store the narrowed type fact using the same endpoint-keyed flow storage that `stable` already uses

3. **`getTypeAtFlowCondition`**: When a flow condition involves a linked predicate, propagate the narrowing to the target method's flow node (not the guard method's). This is the key integration point with existing `stable` CFA.

4. **Validation**: At declaration check time, verify:
   - The target method exists on the containing type
   - The target method is `stable`
   - The `is Type` is assignable to the target's declared return type

#### CFA Flow Integration

**Key insight**: Linked predicate narrowing piggybacks on existing `stable` CFA tracking. No new flow node types are needed.

When the checker encounters `if (obj.hasValue())`:
1. Resolve `hasValue()`'s type predicate → `TypePredicateKindMethod`, target = `value`, type = `Exclude<T, undefined>`
2. In the true branch, when `obj.value()` is encountered:
   - Existing `stable` CFA walks the flow to find narrowing facts
   - The `FlowCondition` from the `hasValue()` call provides the narrowing fact
   - `narrowTypeByTypePredicate` applies `Exclude<T, undefined>` to the target
3. Mutator invalidation and uncertainty boundaries naturally reset the flow node

#### File-Level Implementation Map

| Component | Files | Changes |
|-----------|-------|---------|
| AST types | `internal/ast/types.go` | New `TypePredicateKindMethod` enum value |
| Parser | `internal/parser/parser.go` | Extend type predicate parsing |
| Checker (predicate) | `internal/checker/checker.go` | `getTypePredicateOfSignature` extension |
| Checker (narrowing) | `internal/checker/narrowing.go` | `narrowTypeByTypePredicate` extension |
| Checker (validation) | `internal/checker/checker.go` | Declaration validation for linked predicates |
| Diagnostics | `internal/diagnostics/` | New diagnostic for non-stable target |

### 2.6 Test Cases

#### Positive Tests

```ts
// @strict: true

// Basic linked predicate
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r: Resource<string | undefined>;
if (r.hasValue()) {
  const s: string = r.value();  // ✅ narrowed to string
}
const v: string | undefined = r.value();  // ✅ outside guard, full type

// Multiple guards on same target
interface TypedReader {
  stable read(): number | string | boolean;
  isNumber(): this.read() is number;
  isString(): this.read() is string;
}

declare const reader: TypedReader;
if (reader.isNumber()) {
  const n: number = reader.read();  // ✅ narrowed to number
}
if (reader.isString()) {
  const s: string = reader.read();  // ✅ narrowed to string
}

// Guard + mutator invalidation
interface WritableOption<T> {
  stable get(): T | undefined;
  isDefined(): this.get() is T;
  set: mutator (v: T | undefined) => void invalidates get;
}

declare const opt: WritableOption<number>;
if (opt.isDefined()) {
  const n1: number = opt.get();  // ✅ narrowed
  opt.set(undefined);
  const n2: number | undefined = opt.get();  // ✅ widened by mutator
}

// Guard + post-call narrowing interaction
interface Store<T> {
  stable read(): T;
  hasValue(): this.read() is Exclude<T, undefined>;
  set: mutator (v: T) => void invalidates read;
}

declare const store: Store<string | undefined>;
store.set("hello");
const after: string = store.read();  // ✅ narrowed by post-call narrowing (P3)
```

#### Negative Tests

```ts
// @strict: true

// Error: target not stable
interface BadTarget {
  value(): string | undefined;          // NOT stable
  hasValue(): this.value() is string;   // ❌ Error
}

// Error: narrowed type not assignable to target return type
interface BadNarrowing {
  stable get(): number | string;
  check(): this.get() is boolean;       // ❌ boolean not assignable to number | string
}

// Different receiver — no narrowing
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r1: Resource<string | undefined>;
declare const r2: Resource<string | undefined>;
if (r1.hasValue()) {
  r1.value();  // ✅ narrowed
  r2.value();  // ❌ NOT narrowed — different receiver
}

// Uncertainty boundary invalidation
declare const r: Resource<string | undefined>;
if (r.hasValue()) {
  r.value();       // narrowed
  unknownCall();
  r.value();       // ❌ NOT narrowed — uncertainty boundary
}
```

---

## 3. Phase 2b: Keyed Linked Predicates

### 3.1 Problem Statement

The Map/Set `has(key)` → `get(key)` pattern is one of TypeScript's most-requested features (issues #9619, #13086 — 370+ combined upvotes). After `map.has("foo")`, `map.get("foo")` should return `V`, not `V | undefined`.

```ts
const map = new Map<string, number>();
map.set("x", 42);

if (map.has("x")) {
  const val = map.get("x");  // Currently: number | undefined. Want: number
}
```

This is fundamentally harder than Phase 2a because of **parameter correlation**: the system must track that the same key was used in both `has()` and `get()`.

### 3.2 Proposed Syntax

Extend the linked predicate syntax to support parameter forwarding:

```ts
interface TypedMap<K, V> {
  stable get(key: K): V | undefined;
  has<K2 extends K>(key: K2): this.get(key) is V;
}
```

**Syntax grammar extension**:
```
TypePredicate:
  ...existing...
  'this' '.' Identifier '(' ParameterRefList ')' 'is' Type  // NEW: this.method(param) is T

ParameterRefList:
  Identifier (',' Identifier)*
```

The `key` in `this.get(key) is V` references the parameter named `key` from the guard method's signature. This creates an explicit correlation: "when `has(key)` returns true, calling `get` with the same value as `key` returns `V`."

### 3.3 Semantic Rules (Additional to Phase 2a)

#### Rule K1: Parameter identity via `isMatchingReference`

The narrowing applies only when the argument to `get()` is provably the same reference as the argument used in `has()`:

```ts
const map: TypedMap<string, number> = ...;
const key = "foo";

if (map.has(key)) {
  map.get(key);    // ✅ narrowed — same reference
  map.get("foo");  // ❌ NOT narrowed — different expression (even if same value)
}
```

For string literals, identical literal values could be considered matching (implementation detail — `isMatchingReference` may need extension for literal identity).

#### Rule K2: Key reassignment invalidates narrowing

If the key variable is reassigned between `has()` and `get()`, the narrowing is lost:

```ts
let key = "foo";
if (map.has(key)) {
  key = "bar";     // reassignment!
  map.get(key);    // ❌ NOT narrowed — key changed
}
```

This is handled by CFA's existing reference tracking for narrow variables.

#### Rule K3: Key-specific mutation tracking

Mutations that don't affect the checked key should NOT invalidate narrowing:

```ts
if (map.has("foo")) {
  map.set("bar", 99);  // mutation on different key
  map.get("foo");       // Should remain narrowed

  map.delete("foo");    // mutation on same key!
  map.get("foo");       // NOT narrowed
}
```

**Implementation complexity**: This requires per-key invalidation tracking, which is significantly more complex than Phase 2a. The `invalidates` clause would need key-correlation awareness. This is the primary reason for separating this into a distinct sub-phase.

### 3.4 Implementation Plan

#### Parser Changes (~100 LOC additional)

Extend the Phase 2a parser to accept parameter references inside the method call in the predicate: `this.get(key) is V`. The parameter reference `key` must resolve to a parameter of the containing signature.

#### Checker Changes (~500 LOC additional)

1. **Parameter binding**: Resolve parameter references in the predicate to the guard method's parameter declarations. Validate that referenced parameters exist and are simple identifiers.

2. **Argument correlation**: When narrowing at a `get(expr)` call site, check that `expr` is the same reference as the argument that was passed to `has(param)` in the guard call. Use `isMatchingReference` infrastructure.

3. **Key-specific invalidation** (stretch): For `mutator delete(key) invalidates get`, the invalidation should ideally be scoped to the specific key. This requires the invalidation system to understand parameter correlation — significantly more complex than endpoint-level invalidation.

#### Risks

- **Parameter correlation complexity**: The checker must prove argument identity across two different call sites. This is a novel CFA challenge.
- **Mutation scoping**: Per-key invalidation tracking may require new flow node types or extensions to the existing endpoint-keyed flow storage.
- **TypeScript team precedent**: RyanCavanaugh labeled map `has`/`get` narrowing "Too Complex" (#18781). This sub-phase should be approached with caution.

### 3.5 Test Cases

```ts
// @strict: true

// Basic keyed predicate
interface TypedMap<K, V> {
  stable get(key: K): V | undefined;
  has<K2 extends K>(key: K2): this.get(key) is V;
  set: mutator (key: K, value: V) => void invalidates get;
  delete: mutator (key: K) => boolean invalidates get;
}

declare const map: TypedMap<string, number>;

// Positive: same key reference
const k = "foo";
if (map.has(k)) {
  const v: number = map.get(k);  // ✅ narrowed
}

// Negative: different key reference
if (map.has("foo")) {
  const v: number | undefined = map.get("bar");  // ❌ not narrowed
}

// Negative: key reassigned
let key = "foo";
if (map.has(key)) {
  key = "bar";
  const v: number | undefined = map.get(key);  // ❌ not narrowed
}

// Positive: mutation on different key preserves narrowing (stretch)
if (map.has("foo")) {
  map.set("bar", 99);  // different key
  // Ideal: map.get("foo") still narrowed
  // Conservative: map.get("foo") not narrowed (acceptable for MVP)
}
```

---

## 4. Phase 2c: Discriminated Method Unions (Stretch)

### 4.1 Problem Statement

Some patterns correlate multiple stable methods through a discriminant:

```ts
interface AsyncResult<T> {
  stable status(): 'pending' | 'resolved' | 'rejected';
  stable value(): T | undefined;
  stable error(): Error | undefined;
}

// Want: if status() === 'resolved', then value() is T and error() is undefined
```

This is the method-based analogue of discriminated unions on properties. TypeScript already narrows discriminated unions via property access; the question is whether method calls can participate.

### 4.2 Proposed Syntax

Multi-predicate intersection in return type position:

```ts
interface AsyncResult<T> {
  stable status(): 'pending' | 'resolved' | 'rejected';
  stable value(): T | undefined;
  stable error(): Error | undefined;

  isResolved(): this.value() is T & this.error() is undefined;
  isRejected(): this.value() is undefined & this.error() is Error;
}
```

Or, with discriminant-based narrowing (more powerful but more complex):

```ts
// When status() narrows, value() and error() narrow accordingly
// This requires "method-discriminated object types" — a new concept
```

### 4.3 Why This Is Deferred

1. **Multi-method correlation** requires the type system to understand a table of correlations: `status() = 'resolved'` ↔ `value() is T` ↔ `error() is undefined`. No existing mechanism supports this.

2. **No existing TypeScript mechanism** for method-discriminated object types. Property-based discriminated unions work because discriminants and narrowed members are properties on the same object type. Methods have return types as part of signatures, not the object type.

3. **Users have a direct workaround**: use discriminated unions with properties instead of methods. The method pattern is convenient but not essential.

4. **Estimated complexity**: ~1000 LOC additional in the checker, plus new type relationship infrastructure. Risk of scope creep is high.

### 4.4 Recommendation

Defer to Phase 3+. The multi-predicate intersection syntax (`this.value() is T & this.error() is undefined`) is implementable as syntactic sugar over multiple independent linked predicates from Phase 2a. The more complex discriminant-based correlation is a research problem.

---

## 5. Deferred: Exclusive Invalidates

### 5.1 Analysis Summary

The question: should `invalidates` support an "exclusive" mode where unlisted stable endpoints are preserved?

```ts
interface Store {
  stable user(): User | undefined;
  stable settings(): Settings;

  // Current (inclusive): invalidates listed endpoints, others preserved by default
  setUser: mutator (v: User) => void invalidates user;

  // Hypothetical exclusive: preserves listed, invalidates everything else
  sort: mutator () => void preserves settings;  // user() invalidated, settings() preserved
}
```

### 5.2 Why NOT Now

1. **~5% real-world need**: Analysis of real-world APIs shows that inclusive `invalidates` (listing what's affected) covers 95%+ of cases. The "invalidate everything except X" pattern is rare.

2. **Current behavior is already correct for the common case**:
   - `mutator` with `invalidates X` → invalidates X, preserves unlisted
   - `mutator` without `invalidates` → conservative invalidation of all stable endpoints on the receiver

3. **Ambiguity risk**: Two different defaults (inclusive vs exclusive) would confuse users. The current "list what you affect" model is simpler and more intuitive.

### 5.3 Future `preserves` Syntax (If Ever Needed)

If real-world evidence shows the exclusive pattern is common enough:

```ts
interface OrderedStore<T> {
  stable items(): T[];
  stable length(): number;

  // "Reorders items but doesn't change which items exist"
  sort: mutator () => void preserves length;
  // Equivalent to: invalidates items (but NOT length)
}
```

**Syntax**: `preserves` clause in the same position as `invalidates`, with opposite semantics. Mutually exclusive — a mutator uses either `invalidates` (list what's affected) or `preserves` (list what's NOT affected), never both.

**Decision**: Defer to Phase 3+ and re-evaluate based on real-world adoption data from Phase 2.

---

## 6. Deferred: Hierarchy/Overrides Formalization

### 6.1 Current Behavior (Structural)

`stable`/`mutator`/`invalidates` are **signature-level flags** (`SignatureFlagsStable`, `SignatureFlagsMutator`), not symbol-level modifiers. They propagate through `SignatureFlagsPropagatingFlags` during signature instantiation. This makes them inherently **structural**:

- They live on function types, not on property declarations
- They are checked during type compatibility, not inherited
- They follow the same pattern as other signature flags (e.g., `SignatureFlagsAbstract` on construct signatures)

### 6.2 Rules to Formalize

The following rules are established by research but should be codified in tests and documentation:

#### Rule H1: Structural, not inherited

```ts
interface Readable<T> {
  read: stable () => T;
}

class Store<T> implements Readable<T> {
  // Method syntax — no stable flag on the class member itself
  read(): T { return this.value; }
}

declare const s1: Readable<string | undefined>;  // CFA tracks read() as stable
declare const s2: Store<string | undefined>;      // CFA does NOT track read() — no stable on class method

// To get stable CFA through class type, use property syntax:
class StableStore<T> implements Readable<T> {
  read: stable () => T = () => this.value;  // ✅ explicit stable
}
```

#### Rule H2: Assignability direction

| Source | Target | Compatible? | Reason |
|--------|--------|-------------|--------|
| `stable () => T` | `() => T` | ✅ | Stronger → weaker (stable provides extra guarantee) |
| `() => T` | `stable () => T` | ❌ | Cannot claim stability without declaring it |
| `mutator (T) => void` | `(T) => void` | ✅ | Mutator is callable as regular function |
| `(T) => void` | `mutator (T) => void` | ❌ | Cannot claim mutation semantics undeclared |

This follows Liskov Substitution: a `stable` function is a *stronger subtype* — it provides more guarantees (CFA trackability), so it can substitute for a regular function.

#### Rule H3: Variance unaffected

`stable`/`mutator` do not change variance:
- `stable` returns are covariant (as usual for return types)
- `mutator` parameters are contravariant (as usual for function parameters, under `strictFunctionTypes`)
- Method declarations remain bivariant (existing TypeScript behavior)

#### Rule H4: `super.mutator()` = `this.mutator()` for invalidation

`super` changes method dispatch, not the receiver object. `super.set(0)` mutates `this`, so `this.get()` narrowing must be invalidated:

```ts
class Derived extends Base {
  doSomething() {
    if (this.isDefined()) {
      this.get();     // narrowed
      super.set(0);   // mutator via super — still mutates this
      this.get();     // NOT narrowed — invalidated
    }
  }
}
```

#### Rule H5: Interface merging

When multiple interface declarations merge:
- If ALL constituents agree on the modifier → merged type has it
- If ANY constituent omits the modifier → merged type loses it
- Follows intersection semantics: `stable () => T & () => T` → `stable` is lost

#### Rule H6: `invalidates` sets in overrides

Both narrowing and widening the invalidation set are sound:
- Narrowing (`invalidates a, b` → `invalidates a`) = "less destructive" = preserves more info = sound
- Widening (`invalidates a` → `invalidates a, b`) = "more destructive" = conservative = sound
- Referenced endpoints must exist on the type (error if not)

### 6.3 Test Cases Needed

```ts
// @strict: true

// H1: Structural inheritance
interface Readable<T> {
  read: stable () => T;
}

class ImplicitStore implements Readable<string | undefined> {
  read() { return "hello" as string | undefined; }
}

class ExplicitStore implements Readable<string | undefined> {
  read: stable () => string | undefined = () => "hello";
}

declare const implicit: ImplicitStore;
declare const explicit: ExplicitStore;
declare const viaInterface: Readable<string | undefined>;

// Only viaInterface and explicit should get stable CFA
if (viaInterface.read() !== undefined) { viaInterface.read().toUpperCase(); }  // ✅
if (explicit.read() !== undefined) { explicit.read().toUpperCase(); }          // ✅
if (implicit.read() !== undefined) { implicit.read().toUpperCase(); }          // ❌ not stable

// H2: Assignability
declare const stableRead: stable () => string;
declare const normalRead: () => string;
const a: () => string = stableRead;         // ✅ stable → regular
const b: stable () => string = normalRead;  // ❌ regular → stable

// H4: super invalidation
class Base {
  get: stable () => number | undefined;
  set: mutator (v: number) => void invalidates get;
}

class Derived extends Base {
  test() {
    if (this.get() !== undefined) {
      this.get();       // narrowed to number
      super.set(42);    // super call — still invalidates this
      this.get();       // number | undefined
    }
  }
}

// H5: Interface merging
interface A { read: stable () => string; }
interface B { read: () => string; }  // no stable!
interface C extends A, B {}  // read is NOT stable (disagreement)
```

---

## 7. Deferred: Getter Mutation Invalidation

### 7.1 Gap Analysis

Currently, two parallel narrowing systems exist:
- **Getter/setter narrowing**: property access expressions tracked via dotted-name CFA (`obj.value`)
- **`stable`/`mutator` narrowing**: method call expressions tracked via endpoint-keyed CFA (`obj.read()`)

These systems are independent. A `mutator` method does NOT invalidate getter narrowing:

```ts
interface HybridStore {
  get value(): string | undefined;           // getter — dotted-name CFA
  stable read(): string | undefined;         // stable — endpoint CFA
  set: mutator (v: string) => void invalidates read;
}

declare const store: HybridStore;
if (store.value !== undefined) {
  store.value;    // narrowed via getter CFA
  store.set("x"); // mutator — invalidates read(), but NOT value getter
  store.value;    // STILL narrowed via getter CFA ← potential unsoundness gap
}
```

### 7.2 `mutator` on Methods Invalidating Getters

If the method and getter access the same underlying state, a `mutator` call should ideally invalidate getter narrowing too.

**Proposed future extension** (Phase 3+):

```ts
interface HybridStore {
  get value(): string | undefined;
  stable read(): string | undefined;
  set: mutator (v: string) => void invalidates read, value;  // invalidates getter too
}
```

This would require `invalidates` to accept getter property names in addition to stable method names. The invalidation system would need to create a flow boundary node that resets both endpoint-keyed facts AND dotted-name facts.

### 7.3 Why Defer

1. **Low practical impact**: Most APIs use either getters OR methods, not both. The hybrid pattern is rare.
2. **Implementation complexity**: Bridging endpoint-keyed CFA and dotted-name CFA requires new infrastructure.
3. **Current behavior is sound in practice**: If `value` and `read()` truly share state, a well-typed API should define them consistently, and users typically use one access pattern.
4. **Risk**: Touching dotted-name CFA for method calls could introduce regressions in existing narrowing behavior.

### 7.4 Recommendation

Defer to Phase 3+. Monitor for real-world reports of the hybrid pattern causing false narrowing. If evidence appears, implement with strict guarding.


## 8. To Consider: Conditional Type Discrimination of `stable`

### 8.1 Observation

The `stable` modifier parses correctly in conditional type positions:

```ts
type StableReader<T> = stable () => T;

type ExtractReturn<T> = T extends stable () => infer R ? R : never;
type Result = ExtractReturn<StableReader<string>>; // string ✓
```

However, `stable` does NOT discriminate between stable and non-stable function types in conditional checks:

```ts
type IsStable<T> = T extends stable () => any ? true : false;

type A = IsStable<stable () => string>;   // true ✓
type B = IsStable<() => string>;          // also true — not discriminated!
```

This happens because `stable` is a CFA modifier, not a structural type feature. The `extends` check uses structural compatibility, and `stable () => T` is structurally identical to `() => T`.

### 8.2 Why This Is Fine for Phase 1-2

CFA narrowing — the primary value of `stable` — does not require conditional type discrimination. The narrowing operates through flow analysis, not through the type system's structural comparisons.

### 8.3 Potential Future Options

If conditional type discrimination is ever needed:

1. **`TypeFlags` bit**: Add a `TypeFlagsStable` flag and check it in conditional type resolution. Allows `T extends stable () => R ? R : never` to only match stable function types.
2. **`IsStable<T>` intrinsic**: Similar to `ReturnType<T>` — a built-in type-level predicate. Lower risk than modifying conditional type resolution.
3. **No action**: If CFA narrowing remains the only use case, conditional type discrimination adds complexity with no practical benefit.

### 8.4 Recommendation

Do not implement in Phase 1 or Phase 2. Monitor for real-world use cases where users need to distinguish `stable () => T` from `() => T` at the type level. If evidence appears, option 2 (`IsStable<T>` intrinsic) is the safest path.

---

## 9. Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Parser ambiguity with `this.method() is T` | Low | Medium | `is` keyword after `)` disambiguates cleanly |
| Performance regression from additional predicate checking | Low | High | Predicate resolution is per-signature, not per-call; cache results |
| Interaction with existing `this is T` predicates | Medium | Medium | Both coexist; method-specific is strictly more precise |
| Phase 2b key correlation complexity | High | High | Separate sub-phase; can ship 2a independently |
| Phase 2c scope creep (discriminated method unions) | High | Medium | Strict deferral to Phase 3+; MVP covers most use cases |

### Compatibility Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| New syntax breaks existing `.d.ts` consumers | Low | High | New syntax is declaration-only; old compilers ignore unknown return types |
| `typePredicateKindMethod` breaks emit compatibility | Low | Medium | Type predicates are erased; no emit changes |
| Existing `this is` patterns in Angular | None | N/A | Coexists; Angular can migrate gradually |

### User-Facing Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Confusion between `this is T` and `this.method() is T` | Medium | Low | Documentation; compiler suggestions |
| Users expect keyed predicates in Phase 2a | Medium | Low | Clear messaging; Phase 2b timeline visibility |
| Guard lies (unsound predicate) | Same as existing | Same as existing | Same trust model as `param is T` |

---

## 10. Timeline & Dependencies

### Phase Dependencies

```
Phase 1 (complete)
  └── stable/mutator/invalidates CFA foundation
        │
        ├── Phase 2a: Linked predicates (MVP)
        │     ├── Parser: this.method() is T
        │     ├── Checker: TypePredicateKindMethod
        │     └── CFA: piggyback on stable flow nodes
        │
        ├── Phase 2b: Keyed linked predicates
        │     ├── Depends on: Phase 2a
        │     ├── Parser: this.method(param) is T
        │     └── Checker: parameter correlation via isMatchingReference
        │
        └── Phase 2c: Discriminated method unions (stretch)
              ├── Depends on: Phase 2a
              └── Research: method-discriminated object types

Deferred (Phase 3+):
  ├── Exclusive invalidates (preserves syntax)
  ├── Hierarchy formalization tests
  └── Getter mutation invalidation
```

### Estimated Scope

| Sub-phase | Parser | Checker | Tests | Total LOC | Risk |
|-----------|--------|---------|-------|-----------|------|
| **2a (MVP)** | ~200 | ~500 | ~300 | **~1000** | Low |
| **2b (Keyed)** | ~100 | ~500 | ~200 | **~800** | Medium-High |
| **2c (Discriminated)** | ~100 | ~700 | ~300 | **~1100** | High |
| **Total** | ~400 | ~1700 | ~800 | **~2900** | — |

### Recommended Implementation Order

1. **Phase 2a first**: Simple linked predicates. Addresses Angular Resource, optional containers, and typed signals. No parameter correlation — clean CFA integration with existing infrastructure.

2. **Phase 2b after 2a stabilizes**: Keyed predicates. Addresses Map/Set `has`/`get`. Higher risk due to parameter correlation. Can be shipped independently or deferred if 2a already provides sufficient value.

3. **Phase 2c as research**: Discriminated method unions. Only if community demand justifies the complexity. Most users can work around this with property-based discriminated unions.

4. **Deferred items**: Formalize hierarchy rules via test suites (low effort, can happen alongside any phase). Exclusive invalidation and getter mutation invalidation wait for real-world evidence from Phase 2 adoption.

### Entry Criteria for Phase 2a

- Phase 1 validation green (build, test, lint, format)
- No outstanding Phase 1 regressions or soundness issues
- SDD approved (this document)

### Exit Criteria for Phase 2a

- Parser handles `this.method() is Type` in return type position
- Checker validates linked predicates (target is stable, type is assignable)
- CFA narrows target method's return type in truthy branch
- Mutator invalidation and uncertainty boundaries reset linked-predicate narrowing
- Test suite covers all positive and negative cases from §2.6
- Build, test, lint, format all green

---

## Appendix A: Language Survey

No mainstream language has cross-method type guards:

| Language | Cross-method narrowing | Mechanism | Limitation |
|----------|----------------------|-----------|------------|
| TypeScript | No (workarounds only) | `this is T` type predicates | Narrows whole object, not individual methods |
| Kotlin | No | `contract` system | Narrows `this` type, not return types |
| Rust | N/A | Pattern matching + ADTs | No methods to cross-narrow |
| Swift | N/A | Enums + associated values | No methods to cross-narrow |
| C# | No | Pattern matching (C# 7+) | Same as Rust/Swift |

TypeScript is uniquely positioned to pioneer this because JavaScript APIs (Map, DOM, Angular, Solid, TC39 Signals) expose correlated state through separate methods.

## Appendix B: Related TypeScript Issues

| Issue | Title | Reactions | Relevance |
|-------|-------|-----------|-----------|
| [#9619](https://github.com/microsoft/TypeScript/issues/9619) | Strict null checks for Map members | 179 👍 | Direct — keyed cross-method guard |
| [#13086](https://github.com/microsoft/TypeScript/issues/13086) | Flow analysis doesn't work with `has` | 189 👍 | Direct — same pattern |
| [#18781](https://github.com/microsoft/TypeScript/issues/18781) | Set and Map `.has` as type guard | Closed (Too Complex) | Context — TS team position |
| [#30581](https://github.com/microsoft/TypeScript/issues/30581) | Correlated union types | 159 👍 | Related — discriminated methods |
| [#31376](https://github.com/microsoft/TypeScript/issues/31376) | Functions returning value + type guard | 7 👍 | Related — guard return values |
| [#57725](https://github.com/microsoft/TypeScript/issues/57725) | Narrowing specified on function calls | 351 👍 | Motivation — signals |
| [#60948](https://github.com/microsoft/TypeScript/issues/60948) | `identity`/`stable` modifier proposal | 105 👍 | Foundation — Phase 1 |

## Appendix C: Full Syntax Reference

```ts
// Phase 1 (implemented):
stable () => T                                          // stable function type
mutator (v: T) => void                                  // mutator function type
mutator (v: T) => void invalidates endpoint             // mutator with explicit invalidation
mutator (v: T) => void invalidates a, b                 // mutator invalidating multiple endpoints

// Phase 2a (proposed):
hasValue(): this.value() is T                           // linked type predicate (boolean guard)
isDefined(): this.get() is Exclude<T, undefined>        // linked type predicate (generic)

// Phase 2b (proposed):
has(key: K): this.get(key) is V                         // keyed linked type predicate

// Phase 2c (stretch):
isResolved(): this.value() is T & this.error() is undefined  // multi-predicate intersection

// Deferred:
mutator () => void preserves endpoint                   // exclusive invalidation (preserves)
mutator () => void invalidates read, value              // getter mutation invalidation
```
