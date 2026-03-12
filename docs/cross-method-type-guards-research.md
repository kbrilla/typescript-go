# Cross-Method Type Guards: Comprehensive Research

## 1. Problem Definition

A **cross-method type guard** is a pattern where calling one method on an object narrows the return type of a *different* method on the same object. This is fundamentally unlike existing TypeScript type guards, which narrow:
- A variable's type (`x is T`)
- The `this` type (`this is T`)
- A parameter's type (`param is T`)

Cross-method guards require the type system to understand that **calling method A** provides evidence about **what method B will return**.

```ts
interface Counter {
  get(): number | string;
  isNumber(): boolean; // when true, get() returns number
}
```

---

## 2. Pattern Catalog

### 2.1 Pattern: Boolean Guard → Accessor (Simple)

**Motivating example:**
```ts
interface Counter {
  stable get(): number | string;
  isNumber(): boolean;
}

const c: Counter = ...;
if (c.isNumber()) {
  const n: number = c.get(); // want: narrowed to number
}
```

**Characteristics:**
- Guard is boolean — only narrows in truthy branch
- Guard and target share a receiver (`c`)
- No parameter correlation — guard takes no args
- Semantically: `isNumber()` asserts a property of the *state* that also determines `get()`'s return type

**Real-world instances:**
- Angular `Resource.hasValue()` → `Resource.value()`
- DOM `element.hasAttribute("x")` → `element.getAttribute("x")`
- Optional containers: `maybe.isDefined()` → `maybe.get()`

### 2.2 Pattern: Angular Resource (`hasValue()` → `value()`)

**Angular's actual API:**
```ts
export interface Resource<T> {
  readonly value: Signal<T>;
  readonly status: Signal<ResourceStatus>;

  // Current approach: this-type narrowing
  hasValue(this: T extends undefined ? this : never): this is Resource<Exclude<T, undefined>>;
  hasValue(): boolean;
}
```

**How it works:** Angular uses a `this` type predicate to narrow the *entire object type*. When `hasValue()` returns true, the whole `Resource<T>` becomes `Resource<Exclude<T, undefined>>`, which changes `value: Signal<T>` to `value: Signal<Exclude<T, undefined>>`.

**Limitations of Angular's approach:**

1. **Narrows the whole object, not just `value()`:** The `this is Resource<Exclude<T, undefined>>` trick substitutes the generic parameter `T` globally. This means *all* methods that use `T` are narrowed, even those where narrowing doesn't make sense.

2. **Conditional `this` type hack:** The `this: T extends undefined ? this : never` overload is a clever workaround to prevent the overload from matching when `T` doesn't include `undefined`. This is fragile and non-obvious.

3. **Doesn't compose well:** If `Resource<T>` had two independent optional fields (`value: T | undefined` and `metadata: M | undefined`), you can't independently narrow one without affecting the other — the `this` narrowing is all-or-nothing on the generic parameter.

4. **Only works with generic type parameters:** If the return type isn't parameterized by a generic on the interface (e.g., a fixed union type), this trick doesn't work at all.

5. **Signal indirection breaks it:** Because `value` is a `Signal<T>` (a function), the narrowing applies to the Signal's type parameter, which only works because Angular controls the full type hierarchy. Third-party types can't easily adopt this pattern.

**What cross-method guards would enable:**
```ts
interface Resource<T> {
  stable value(): T;           // when T includes undefined, returns T
  hasValue(): value() is Exclude<T, undefined>;  // narrows just value()'s return
}
```

### 2.3 Pattern: Map `has(key)` → `get(key)` (Keyed Cross-Method Guard)

**Motivating example:**
```ts
const map = new Map<string, number>();
map.set("x", 42);

if (map.has("x")) {
  const val: number = map.get("x"); // currently: number | undefined
}
```

**Key TypeScript Issues:**

| Issue | Title | Status | 👍 |
|-------|-------|--------|-----|
| [#9619](https://github.com/microsoft/TypeScript/issues/9619) | Strict null checks for Map members | Open, `Needs Proposal` | 179 |
| [#13086](https://github.com/microsoft/TypeScript/issues/13086) | Flow analysis doesn't work with `has` method | Open, `Awaiting More Feedback` | 189 |
| [#18781](https://github.com/microsoft/TypeScript/issues/18781) | Set and Map `.has` method as type guard | Closed (dup of #13086) | — |

**Why this is harder than Pattern 2.1:**

1. **Parameter correlation:** The `has("x")` and `get("x")` calls are linked by a shared key *value*. The type system must track that the same literal `"x"` was used in both calls. If a variable `key` is used, it must be the same binding.

2. **Mutation between calls:** `map.delete("x")` between `has` and `get` invalidates the guard. This is exactly the `mutator`/`invalidates` problem.

3. **Non-literal keys:** For `const k = getKey(); if (map.has(k)) { map.get(k) }`, the narrowing must track that the same binding `k` was passed to both calls.

**DanielRosenwasser's workaround (2016):**
```ts
interface Map<K, V> {
  has<CheckedString extends string>(
    this: Map<string, V>, key: CheckedString
  ): this is MapWith<K, V, CheckedString>;
}

interface MapWith<K, V, DefiniteKey extends K> extends Map<K, V> {
  get(k: DefiniteKey): V;
  get(k: K): V | undefined;
}
```
This uses `this` type narrowing to rewrite the entire Map type — same limitations as Angular's approach, plus it doesn't stack well with multiple keys.

### 2.4 Pattern: Discriminated Method Unions (Status → Value)

**Motivating example:**
```ts
interface AsyncResult<T> {
  stable status(): 'pending' | 'resolved' | 'rejected';
  stable value(): T | undefined;
  stable error(): Error | undefined;
}

const result: AsyncResult<number> = ...;
if (result.status() === 'resolved') {
  const v: number = result.value();       // want: narrowed to number (no undefined)
  const e: undefined = result.error();    // want: narrowed to undefined
}
```

**Relationship to discriminated unions:** This is the method-based analogue of:
```ts
type AsyncResult<T> =
  | { status: 'pending'; value: undefined; error: undefined }
  | { status: 'resolved'; value: T; error: undefined }
  | { status: 'rejected'; value: undefined; error: Error };
```
TypeScript already narrows discriminated unions via property access. The question is whether method calls can participate in the same narrowing.

**Key TypeScript Issue:**

| Issue | Title | Status | 👍 |
|-------|-------|--------|-----|
| [#30581](https://github.com/microsoft/TypeScript/issues/30581) | Correlated union types | Partially fixed via [#47109](https://github.com/microsoft/TypeScript/pull/47109) | 159 |

**Why this is the hardest variant:**

1. **Multi-method correlation:** Narrowing `status()` must simultaneously affect `value()` and `error()`. This requires the type system to understand a table of correlations.

2. **No existing mechanism:** TypeScript's discriminated unions work because the discriminant and the narrowed members are *properties on the same object type*. With methods, the return types are part of *signatures*, not the object type itself.

3. **Would require "method-discriminated object types":** A fundamentally new kind of type relationship where an object's methods form a discriminated union *across their return types*.

---

## 3. Existing TypeScript Issues & Prior Art

### 3.1 Issue Landscape

| Issue | Core Problem | Status | Relevance |
|-------|-------------|--------|-----------|
| [#9619](https://github.com/microsoft/TypeScript/issues/9619) | `Map.get` returns `T \| undefined` after `has` | Open, `Needs Proposal`, `Suggestion` | Direct — keyed cross-method guard |
| [#13086](https://github.com/microsoft/TypeScript/issues/13086) | Flow analysis doesn't track `has`/`get` correlation | Open, `Awaiting More Feedback` | Direct — same pattern |
| [#30581](https://github.com/microsoft/TypeScript/issues/30581) | Correlated union types (e.g., `record.f(record.v)`) | Partially closed via #47109 | Related — correlating properties/methods on same object |
| [#31376](https://github.com/microsoft/TypeScript/issues/31376) | Functions that return a value AND serve as type guard | Open, `Awaiting More Feedback` | Related — `pop()` returning value AND narrowing array type |
| [#46650](https://github.com/microsoft/TypeScript/issues/46650) | Custom guards with non-boolean return values | Open | Related — conditional type results from guard functions |
| [#16148](https://github.com/microsoft/TypeScript/issues/16148) | Affine/linear types for TypeScript | Closed | Inspirational — ownership transfer narrows types |

### 3.2 Key Insights from Issue Discussion

**mhegazy (TS team, 2016) on #9619:**
> "The issue is not type guards, since the type of the map does not change between the `has` and the `get` calls. The issue is relating two calls."

This precisely identifies the problem: TypeScript's current narrowing operates on *references* (variables, property accesses), not on *return types of method calls on shared objects*.

**RyanCavanaugh (TS team, 2019) on #30581:**
> "We'd need some entirely new concept here."

Confirming that correlated method types require a fundamentally new mechanism, not just extensions of existing narrowing.

**DanielRosenwasser (TS team, 2016) on #13086:**
Demonstrated a `this` type predicate workaround for Map, but acknowledged it "doesn't stack perfectly."

### 3.3 Related PRs in typescript-go

| PR | Description | Relevance |
|----|-------------|-----------|
| [#2434](https://github.com/microsoft/typescript-go/pull/2434) | Experiment: Quantified Types | Existential types could solve correlated unions |
| [#2629](https://github.com/microsoft/typescript-go/pull/2629) | Experiment: Distribute Control Flow | Distributed narrowing could handle correlated properties across methods |

---

## 4. How Other Languages Handle This

### 4.1 Kotlin: Smart Casts

Kotlin's smart casts narrow types after `is` checks:
```kotlin
val x: Any = "hello"
if (x is String) {
    println(x.length) // x smart-cast to String
}
```

**Cross-method limitation:** Kotlin does NOT support cross-method smart casts. If `container.hasValue()` returns true, `container.getValue()` is not automatically narrowed. Kotlin users typically use:
- Sealed classes (discriminated unions) with `when` expressions
- `?.let { }` safe-call chaining
- Contract functions (`contract { returns(true) implies (this@hasValue is ValueContainer) }`)

Kotlin's `contract` system is the closest analogue:
```kotlin
fun Resource<T>.hasValue(): Boolean {
    contract { returns(true) implies (this@hasValue is ResolvedResource<T>) }
    return status == ResourceStatus.RESOLVED
}
```
But this narrows the *entire object type*, same limitation as Angular's `this is` approach.

### 4.2 Rust: Pattern Matching & Enums

Rust handles this through algebraic data types and pattern matching:
```rust
enum AsyncResult<T> {
    Pending,
    Resolved(T),
    Error(Box<dyn Error>),
}

match result {
    AsyncResult::Resolved(value) => {
        // value is T, not Option<T>
    }
    _ => {}
}
```

**Key difference:** Rust doesn't *have* the problem because:
- Data and access are unified through pattern matching (no separate `status()` and `value()` methods)
- Ownership/borrowing prevents the mutation-between-calls issue
- Every access destructures the enum variant, inherently correlating the discriminant and payload

### 4.3 Swift: Associated Values + Pattern Matching

```swift
enum Result<T> {
    case success(T)
    case failure(Error)
}

if case .success(let value) = result {
    // value is T
}
```

Same approach as Rust — unified access via pattern matching.

### 4.4 Summary: Language Comparison

| Language | Cross-method narrowing | Mechanism | Limitation |
|----------|----------------------|-----------|------------|
| TypeScript | No (workarounds only) | `this is T` type predicates | Narrows whole object, not individual methods |
| Kotlin | No (contracts are per-function) | `contract` system | Narrows `this` type, not return types |
| Rust | N/A (pattern matching) | Algebraic data types | No methods to cross-narrow |
| Swift | N/A (pattern matching) | Enums + associated values | No methods to cross-narrow |
| C# | No | Pattern matching (C# 7+) | Same as Rust/Swift |

**Conclusion:** No mainstream language has cross-method type guards. Every language that solves the underlying problem does so by avoiding separate methods entirely (pattern matching). TypeScript is unique in needing this because JavaScript APIs (Map, DOM, frameworks like Angular) expose correlated state through separate methods.

---

## 5. Proposed Syntax Options

### 5.1 Option A: Linked Type Predicate

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): value() is Exclude<T, undefined>;
}

interface Map<K, V> {
  stable get(key: K): V | undefined;
  has<K2 extends K>(key: K2): get(key) is V;
}
```

**Syntax:** The return type position uses `methodName() is Type` instead of `param is Type`.

**Semantics:**
- `hasValue(): value() is Exclude<T, undefined>` means "when this returns true, subsequent calls to `this.value()` return `Exclude<T, undefined>`"
- For keyed variant: `has(key): get(key) is V` means "when this returns true with argument `key`, subsequent calls to `this.get(key)` with the same `key` return `V`"

**Pros:**
- Natural extension of existing `param is Type` / `this is Type` syntax
- Clear what method is being narrowed and to what type
- Supports both boolean guards (truthy narrowing) and assertion guards
- Parameter forwarding (`get(key)`) makes keyed correlation explicit

**Cons:**
- New syntactic form in return type position
- Parameter forwarding syntax needs careful specification (what does `get(key)` mean when `key` is a complex expression?)
- Doesn't naturally express multi-method narrowing (`status() === 'resolved'` narrowing both `value()` and `error()`)

**Feasibility: ★★★★☆ (High)**
- Minimal new concepts — extends existing type predicate syntax
- Parser changes: moderate (new production in return type position)
- Checker changes: significant but localized (extend `narrowTypeByTypePredicate` to handle method targets)
- CFA integration: straightforward — treat the target method as a narrowing reference

### 5.2 Option B: Method-Scoped Narrowing Annotation

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): narrows value() to Exclude<T, undefined>;
}
```

**Semantics:** `narrows method() to Type` is a modifier that declares the method's effect on another method.

**Pros:**
- Very explicit — reads clearly as "this method narrows that method to that type"
- Could support `narrows value(), error() to ...` for multi-method narrowing

**Cons:**
- New keyword (`narrows`) and entirely new syntactic construct
- Verbose and unlike any existing TypeScript syntax
- The `to` keyword is not currently reserved

**Feasibility: ★★☆☆☆ (Low)**
- Requires new contextual keywords, new AST node types
- High parser complexity for little benefit over Option A

### 5.3 Option C: Guard Clause on Return Type

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): boolean guards value(): Exclude<T, undefined>;
}

interface Counter {
  stable get(): number | string;
  isNumber(): boolean guards get(): number;
}
```

**Semantics:** `boolean guards method(): Type` means the method returns boolean, and when truthy, the target method's return type is narrowed.

**Pros:**
- Separates the actual return type (`boolean`) from the guard effect
- Could support assertion variant: `void asserts value(): T`

**Cons:**
- Awkward syntax — two colons in the same signature
- `guards` is a new keyword
- Ambiguous parsing with existing conditional/mapped types

**Feasibility: ★★☆☆☆ (Low)**
- Two return-type-like positions in one signature is confusing
- Parser ambiguity with `guards` as identifier vs keyword

### 5.4 Option D: Extend `stable`/`invalidates` Infrastructure

```ts
interface Resource<T> {
  stable value(): T;
  // "guards" is like inverse of "invalidates": 
  //   invalidates = "this call WIDENS the target" (resets narrowing)
  //   guards      = "this call NARROWS the target" (adds narrowing)
  stable hasValue(): boolean guards value is Exclude<T, undefined>;
}
```

**This reuses the existing `invalidates` pattern** but with opposite polarity:
- `invalidates` = method call *widens* (resets) the target method's narrowed type
- `guards` = method call *narrows* the target method's return type

**Pros:**
- Natural extension of existing modifier infrastructure
- Both `stable` and the guard are declared on the guard method
- `guards` clause mirrors `invalidates` clause position

**Cons:**
- Requires `hasValue` to also be `stable` (which may not be semantically correct — `hasValue()` isn't itself narrowed, it *does* the narrowing)
- `guards value is Type` mixes a reference name with an `is` type predicate

**Feasibility: ★★★☆☆ (Medium)**
- Leverages existing modifier parsing infrastructure
- But the semantics of making a guard method `stable` is questionable

### 5.5 Option E: Cross-Method Type Predicate (Recommended)

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
}

interface Counter {
  stable get(): number | string;
  isNumber(): this.get() is number;
}

interface Map<K, V> {
  stable get(key: K): V | undefined;
  has<K2 extends K>(key: K2): this.get(key) is V;
}

interface AsyncResult<T> {
  stable status(): 'pending' | 'resolved' | 'rejected';
  stable value(): T | undefined;
  stable error(): Error | undefined;

  // Multi-narrowing via intersection of predicates
  isResolved(): this.status() is 'resolved' & this.value() is T & this.error() is undefined;
}
```

**Semantics:** `this.method() is Type` in return type position means "when this returns truthy, `this.method()` is narrowed to `Type`."

**Pros:**
- `this.method()` clearly identifies the receiver and method — unambiguous
- Mirrors existing `this is Type` pattern naturally
- `this.get(key)` naturally handles parameter forwarding
- Multi-predicate intersection handles discriminated method unions
- Works with existing `stable` — the narrowed target should be `stable` already

**Cons:**
- `this.value() is T & this.error() is undefined` is verbose for multi-narrowing
- Parser needs to handle `this.method()` as a type predicate target
- Intersection of predicates is a new semantic concept

**Feasibility: ★★★★★ (Highest)**
- Most natural extension of existing syntax
- `this.` prefix eliminates ambiguity with local variables
- Parameter forwarding is syntactically clear
- Works with boolean, assertion, and discriminant narrowing

---

## 6. Syntax Options Ranked by Feasibility

| Rank | Option | Syntax Example | Feasibility | Notes |
|------|--------|---------------|-------------|-------|
| 1 | **E: Cross-method predicate** | `this.value() is T` | ★★★★★ | Natural extension, handles all patterns |
| 2 | A: Linked predicate | `value() is T` | ★★★★☆ | Simpler but ambiguous without `this.` |
| 3 | D: Extend stable/invalidates | `guards value is T` | ★★★☆☆ | Leverages existing infra, semantic questions |
| 4 | C: Guard clause | `boolean guards value(): T` | ★★☆☆☆ | Awkward two-return-type syntax |
| 5 | B: Method-scoped narrows | `narrows value() to T` | ★★☆☆☆ | New keywords, verbose |

---

## 7. Interaction with `stable`/`mutator`/`invalidates`

### 7.1 Prerequisite: Target Must Be `stable`

Cross-method type guards only make sense when the **target method** (the one being narrowed) is `stable`. Without `stable`, repeated calls to the method aren't narrowable by CFA at all.

```ts
interface Resource<T> {
  stable value(): T;           // ← must be stable for narrowing to apply
  hasValue(): this.value() is Exclude<T, undefined>;  // guard method need not be stable
}
```

The **guard method** does NOT need to be `stable` — it's invoked once as a boolean check. (Though it could be stable if you want to narrow its own return type too.)

### 7.2 Mutator Invalidation of Cross-Method Guards

When a `mutator` call invalidates a `stable` endpoint, any cross-method narrowing established via a guard is also invalidated:

```ts
interface Resource<T> {
  stable value(): T;
  hasValue(): this.value() is Exclude<T, undefined>;
  set: mutator (v: T) => void invalidates value;
}

const r: Resource<string | undefined> = ...;
if (r.hasValue()) {
  r.value();  // narrowed to string via cross-method guard
  r.set(undefined);  // mutator invalidates value → post-call narrowing from argument
  r.value();  // narrowed to undefined (argument type propagated)
}
```

This works naturally with the existing system because cross-method guard narrowing is applied to the *same flow node* that `stable` already tracks. The mutator invalidation resets the flow type, which invalidates both direct narrowing and guard-established narrowing.

### 7.3 Interaction Table

| Scenario | Behavior |
|----------|----------|
| `hasValue()` → `value()` (no mutator) | Narrowing preserved in same flow |
| `hasValue()` → mutator → `value()` | Narrowing invalidated by mutator |
| `hasValue()` → unknown call → `value()` | Narrowing invalidated by uncertainty boundary |
| Two guards, same target | Both narrowings intersect |
| Guard on non-stable method | Error: target must be `stable` for cross-method narrowing |

### 7.4 Complementary Roles

The modifiers serve complementary purposes:
- **`stable`**: "This method's return type can be tracked by CFA" (read endpoint)
- **`mutator`**: "This method changes state that CFA should account for" (write endpoint)
- **`invalidates`**: "This mutator specifically affects these stable endpoints" (precision link)
- **cross-method guard**: "This method's truthiness constrains what a stable endpoint returns" (evidence link)

Together, they form a complete lattice:
```
  guard (evidence: narrows)
       ↓
  stable endpoint (CFA-trackable read)
       ↑
  mutator + invalidates (evidence: widens/resets)
```

---

## 8. Implementation Complexity Assessment

### 8.1 Option E Implementation Plan (Recommended)

#### Parser Changes
- **Extend type predicate parsing** to recognize `this.identifier()` and `this.identifier(paramRef)` as valid predicate targets
- **New AST node**: `MethodTypePredicate` with `receiverThis: true`, `methodName: string`, `parameterRefs: Identifier[]`
- **Parser complexity**: Moderate — new production rule in `parseTypePredicatePrefix`

#### Binder Changes
- **No significant changes** — flow nodes are already created for all call expressions
- Cross-method guard calls generate `FlowCondition` nodes as they do today for boolean type guards

#### Checker Changes

1. **`getTypePredicateOfSignature`**: Extend to return `MethodTypePredicate` when the return type annotation uses `this.method() is Type` syntax. New `TypePredicateKind`: `TypePredicateKindMethod`.

2. **`narrowTypeByTypePredicate`**: For `TypePredicateKindMethod`, instead of narrowing a parameter or `this`, narrow the *flow type of the target method call*. Must:
   - Resolve the target method on the receiver
   - Verify the target is `stable`
   - Apply narrowing to the target method's return type in the current flow
   - For keyed guards: verify parameter identity between guard call and target call

3. **`getTypeAtFlowCondition`**: When processing a condition that involves a cross-method guard, must propagate the narrowing to the *target method's flow node*, not the guard method's flow node.

4. **Parameter correlation** (for keyed guards like Map): Must verify that the argument passed to `get(key)` is the same reference as the argument passed to `has(key)`. This uses existing `isMatchingReference` infrastructure.

**Estimated complexity:**
- Parser: ~200 LOC
- Checker: ~500 LOC (new predicate kind + narrowing logic)
- Tests: ~300 LOC
- Total: ~1000 LOC

#### CFA Flow Integration

The key insight: **cross-method guard narrowing piggybacks on existing `stable` CFA tracking**.

When the checker encounters `if (obj.hasValue())`:
1. Resolve `hasValue()`'s type predicate → `this.value() is Exclude<T, undefined>`
2. In the true branch, when `obj.value()` is encountered:
   - Existing `stable` CFA walks the flow to find narrowing
   - The `FlowCondition` from the `hasValue()` call provides the narrowing fact
   - `narrowTypeByTypePredicate` applies `Exclude<T, undefined>` to the target

This means cross-method guards require **no new flow node types** — they use the same `FlowCondition` nodes that existing type guards produce.

### 8.2 Complexity by Pattern

| Pattern | Parser | Checker | CFA | Tests | Total |
|---------|--------|---------|-----|-------|-------|
| Simple guard (hasValue → value) | Low | Medium | Low | Low | ~400 LOC |
| Keyed guard (has(k) → get(k)) | Medium | High | Medium | Medium | ~600 LOC |
| Discriminated methods (status → value, error) | Medium | Very High | High | High | ~1000 LOC |
| **Total (all patterns)** | | | | | **~2000 LOC** |

### 8.3 Recommended Phasing

**Phase 1 (MVP):** Simple boolean guard → stable accessor
- `hasValue(): this.value() is T` syntax
- No parameter correlation
- No multi-method narrowing
- Integrates with existing `stable` tracking and `mutator`/`invalidates` invalidation

**Phase 2:** Keyed guards
- `has(key): this.get(key) is V` syntax
- Parameter identity tracking via `isMatchingReference`
- Enables Map/Set narrowing

**Phase 3:** Discriminated method unions
- Multi-predicate intersection syntax
- Requires method-discriminated object type infrastructure
- Most complex, least immediately useful (users can use discriminated unions directly)

---

## 9. Key Design Decisions

### 9.1 Should the guard method be `stable`?

**No.** The guard method is a boolean check — it doesn't need CFA tracking itself. Only the *target* method needs to be `stable`.

### 9.2 What happens with `this is T` overlap?

Angular's current `this is Resource<Exclude<T, undefined>>` is a whole-object narrowing. Cross-method guards would be a more precise alternative. Both could coexist:

```ts
// Whole-object narrowing (existing)
hasValue(): this is Resource<Exclude<T, undefined>>;

// Method-specific narrowing (proposed)  
hasValue(): this.value() is Exclude<T, undefined>;
```

The method-specific version is strictly more precise and should be preferred when only one method needs narrowing.

### 9.3 Soundness: What if the guard lies?

Same as existing type predicates — the guard is trusted at the type level. If `hasValue()` returns `true` but `value()` actually returns `undefined`, that's a bug in the implementation, not a type system failure. TypeScript type predicates have always been "trust the developer" annotations.

### 9.4 What about non-boolean guards? (Discriminant methods)

For `status() === 'resolved'` narrowing, we'd need equality narrowing on method return types, which is harder than boolean guards. This should be deferred — it requires the checker to understand that `status()` returning `'resolved'` is a discriminant that correlates with `value()`'s type.

However, this is partially addressable once `stable` is in place: `status()` being `stable` means its return type is CFA-tracked, so `status() === 'resolved'` narrows `status()`'s type. The missing piece is correlating that narrowing with `value()`'s type — which requires discriminated method unions (Phase 3).

---

## 10. Summary

Cross-method type guards address a long-standing gap in TypeScript's type system, manifested in 10+ year-old issues with 500+ combined upvotes. No mainstream language has solved this problem — most avoid it through pattern matching. TypeScript is uniquely positioned to pioneer this because:

1. JavaScript APIs inherently expose correlated state through separate methods
2. The `stable`/`mutator`/`invalidates` infrastructure provides the CFA foundation
3. Existing type predicate syntax (`param is T`, `this is Type`) provides a natural extension point

**Recommended approach:** Option E (`this.method() is Type` syntax), phased implementation starting with simple boolean guards, building on existing `stable` CFA tracking.
