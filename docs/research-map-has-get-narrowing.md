# Research: Map/Set `has(key)` → `get(key)` Narrowing

## 1. TypeScript Issues Summary

### Primary Issues

| Issue | Title | Status | Labels | Reactions |
|-------|-------|--------|--------|-----------|
| [#13086](https://github.com/microsoft/TypeScript/issues/13086) | Flow analysis doesn't work with ES6 collections `has` method | Open | Awaiting More Feedback, Suggestion | 👍189 ❤️22 |
| [#18781](https://github.com/microsoft/TypeScript/issues/18781) | SUGGESTION: Set and Map `.has` method as type guard | Closed | Too Complex, Suggestion | 👍18 |
| [#31376](https://github.com/microsoft/TypeScript/issues/31376) | Permit functions that return a value to also serve as a type guard | Open | Awaiting More Feedback, Suggestion | 👍7 |

### Related Issues

| Issue | Relevance |
|-------|-----------|
| [#9998](https://github.com/microsoft/TypeScript/issues/9998) | Trade-offs in CFA — foundational design document on optimistic vs pessimistic function call narrowing |
| [#57725](https://github.com/microsoft/TypeScript/issues/57725) | Allow type narrowing to be specified as always-on or always-off (351 👍) — signals motivation |
| [#60948](https://github.com/microsoft/TypeScript/issues/60948) | `identity` modifier proposal (105 👍) — stable/narrowable function calls |
| [#22238](https://github.com/microsoft/TypeScript/issues/22238) | Type narrowing for `hasAttribute` and `getAttribute` — same correlated-method pattern |
| [#46650](https://github.com/microsoft/TypeScript/issues/46650) | Allow custom guards to return non-boolean values, with conditional type results |

### TypeScript Team Position

1. **RyanCavanaugh** (2018): Labeled #18781 "Too Complex" — `Set.has` as a type guard is not a good solution because `set.has(value)` returning `false` doesn't mean `value` is *not* of type `T`; it breaks the else branch.

2. **DanielRosenwasser** (2016): Proposed a workaround using `this` type guards + `MapWith<K, V, DefiniteKey>` — works for string literal keys but doesn't compose well for multiple `.has()` checks.

3. **ahejlsberg** (2016 on #9998): TypeScript deliberately chose **optimistic CFA** — function calls don't reset narrowing. This trade-off decision explains why `has()` → `get()` could theoretically work with the same optimistic assumptions, but the cross-method correlation is the novel challenge.

4. **RyanCavanaugh** (2025 on #60948): Asked "doesn't this imply the need for additional syntax to identify which functions/methods invalidate the narrowing?" — acknowledging the same mutation-tracking problem that applies to Map.

### Key Community Arguments

- **jeysal** (2019): "quite hard to get right. The entry might be `delete`d from the map between `has` and `get`."
- **paulius-valiunas** (2023): "I don't see how a map should be different from an object. Internally, they're both hash maps" — argued CFA should handle this like property narrowing.
- **GabenGar** (2023): Pointed out that when `V` doesn't include `undefined`, `has()` returning `true` *must* mean `get()` returns `V`, not `V | undefined`.
- **avin-kavish** (2023): Counter-argument — `Map<string, undefined>` means `has("foo")` can be true while `get("foo")` returns `undefined`.

---

## 2. Why This Is Fundamentally Different From Signal Narrowing

### Signal Pattern (What We've Implemented)
```ts
declare const value: stable () => string | undefined;

if (value() !== undefined) {
    value(); // narrowed to string — same call, same result
}
```

**Properties:**
- Same function called repeatedly
- Parameterless — no "key" to track
- Single endpoint identity: `value === value`
- Narrowing is on the *return value* of the *same call*

### Map `has()`/`get()` Pattern
```ts
const map = new Map<string, number>();
if (map.has("foo")) {
    map.get("foo"); // should be narrowed to number
}
```

**Properties:**
- Two *different* methods called (`has` and `get`)
- Both take a *parameter* (key) that creates a correlation
- Narrowing is *cross-method*: one method's result constrains another method's return type
- The correlation is *key-specific*: `has("foo")` only tells you about `get("foo")`, not `get("bar")`

### The Gap

Our `stable` system handles: **"repeated calls to the same parameterless function return the same value"**

Map needs: **"the boolean result of `has(k)` constrains the return type of `get(k)` for the same key `k`"**

These are categorically different CFA problems:

| Dimension | `stable` (signals) | Map `has`→`get` |
|-----------|-------------------|-----------------|
| Methods involved | 1 (self-repeat) | 2 (cross-method) |
| Parameters | 0 | 1+ (key) |
| Correlation | Identity (same call = same result) | Parametric (same key across methods) |
| Invalidation | Same-receiver mutation | Same-receiver, same-key mutation |
| Type change direction | Narrowing existing type | Removing `undefined` from result |

---

## 3. Why This Is Hard — Technical Analysis

### 3.1 No Syntactic Connection Between `has()` and `get()`

CFA operates on flow nodes. `has("foo")` produces a flow condition node, and `get("foo")` produces a call expression node. There is no AST-level linkage connecting these — unlike `x !== undefined` where the reference `x` appears directly in both the guard and the use site.

For property narrowing, CFA tracks the *reference* (e.g., `obj.value`). After `obj.value !== undefined`, subsequent reads of `obj.value` reuse the narrowed fact keyed by the same reference. But `map.has("foo")` and `map.get("foo")` are entirely different expressions.

### 3.2 Key Parameter Correlation

For this to work, CFA would need to:
1. Recognize that `map.has(key)` is a "key-conditional existence assertion"
2. Correlate it with `map.get(key)` where `key` resolves to the same runtime value
3. Handle all key forms:
   ```ts
   map.has("foo")           // string literal — easy
   map.has(key)             // variable — need reference tracking
   map.has(getKey())        // function call — impossible in general
   map.has(obj.prop)        // property access — need stability validation
   map.has(arr[i])          // element access — need stability validation
   ```

For variable keys, the checker would need to prove the key hasn't been reassigned between `has()` and `get()`:
```ts
let key = "foo";
if (map.has(key)) {
    key = "bar";       // Reassignment!
    map.get(key);      // This is get("bar"), not get("foo")!
}
```

### 3.3 Mutation Window

Between `has(key)` and `get(key)`, the map can be mutated:
```ts
if (map.has("foo")) {
    map.delete("foo");    // Mutation!
    map.get("foo");       // Now returns undefined
}
```

This is analogous to the signal mutation problem, but scoped to *specific keys*:
```ts
if (map.has("foo")) {
    map.set("bar", 99);  // This should NOT invalidate has("foo") narrowing
    map.delete("foo");    // This SHOULD invalidate has("foo") narrowing
    map.clear();          // This SHOULD invalidate ALL narrowings
}
```

### 3.4 Reference Aliasing

```ts
const map = new Map<string, number>();
const alias = map;

if (map.has("foo")) {
    alias.delete("foo");
    map.get("foo");       // Actually undefined now!
}
```

The checker would need to track alias relationships to know that `alias.delete("foo")` affects `map.get("foo")`.

### 3.5 The `undefined` Value Problem

```ts
const map = new Map<string, number | undefined>();
map.set("foo", undefined);

map.has("foo");  // true
map.get("foo");  // undefined

// has(key) being true does NOT mean get(key) is non-undefined!
// It only means get(key) is V, not V | undefined
// But if V already contains undefined, has() tells us nothing about get()'s value.
```

For `Map<K, V>`:
- `has(key) === true` → `get(key)` returns `V` (removes the ` | undefined` added by get's return type)
- `has(key) === true` does NOT mean `get(key) !== undefined` when `V` includes `undefined`

This is subtle but correct. The narrowing is from `V | undefined` to `V`, which is a no-op when `V = number | undefined`.

---

## 4. Could `stable/mutator/invalidates` Solve This?

### What We Have Now

```ts
interface Store {
    stable get(): T;                              // parameterless, narrowable
    mutator set(v: T): void invalidates get;      // resets get() narrowing
}
```

Key constraints of the current system:
1. `stable` only applies to **parameterless** call signatures
2. Narrowing is on the **return value** of a **single endpoint**
3. `invalidates` links mutators to stable endpoints on the **same receiver**

### Direct Application — Doesn't Work

```ts
interface Map<K, V> {
    stable get(key: K): V | undefined;    // ❌ Can't — has a parameter!
    stable has(key: K): boolean;          // ❌ Can't — has a parameter!
    mutator set(key: K, value: V): this invalidates get, has;
    mutator delete(key: K): boolean invalidates get, has;
    mutator clear(): void invalidates get, has;
}
```

Problems:
1. **`stable` requires parameterless signatures.** `get(key)` has a parameter. The whole point of `stable` is that "repeated calls to the same function return the same value" — but `get()` returns different values for different keys.
2. **No cross-method narrowing.** `stable` enables narrowing of a function's own return type through self-repetition. It doesn't provide "if `has(key)` returns true, then `get(key)` returns `V`."
3. **Over-broad invalidation.** `invalidates get, has` would invalidate *all* get/has narrowings, not just for the affected key. `map.set("bar", 1)` should not invalidate `map.get("foo")`.

### The Core Mismatch

`stable/mutator/invalidates` is designed for **identity narrowing** — "this function returns the same value as before." Map needs **cross-method type-predicate narrowing** — "this function's boolean result constrains that function's return type."

These are orthogonal concerns:
- Identity narrowing: `f()` then `f()` → same type
- Cross-method predicate: `has(k)` true → `get(k)` narrows

---

## 5. Keyed Stable — Analysis

### Proposed Syntax

```ts
interface Map<K, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    mutator[key] set(key: K, value: V): this invalidates get[key], has[key];
    mutator[key] delete(key: K): boolean invalidates get[key], has[key];
    mutator clear(): void invalidates get, has;  // no key — invalidates ALL
}
```

### What This Means

- `stable[key]`: The function's return value is stable *per key*. `get("foo")` always returns the same value (until mutated), but `get("foo")` and `get("bar")` are independent.
- `mutator[key]`: The mutation is scoped to the specified key. `set("foo", 1)` only invalidates narrowings for key `"foo"`.
- `invalidates get[key]`: Only invalidate the `get` narrowing for the mutated key, not all keys.
- Unkeyed `invalidates get, has` (on `clear`): Invalidate ALL keys.

### Why This Still Doesn't Solve `has()` → `get()`

Even with keyed stable, we have:
- `get("foo")` can be narrowed through self-repetition (two calls to `get("foo")` yield the same type)
- `has("foo")` can be narrowed through self-repetition (two calls to `has("foo")` yield the same boolean)

But we still don't have:
- **"if `has("foo")` returns `true`, then `get("foo")` returns `V` instead of `V | undefined`"**

This is a **cross-method type predicate**, not identity narrowing. Keyed stable helps with:
```ts
const val = map.get("foo");
if (val !== undefined) {
    map.get("foo");  // keyed stable → narrowed to typeof val (non-undefined)
}
```

But it doesn't help with:
```ts
if (map.has("foo")) {
    map.get("foo");  // ??? How does CFA connect has's boolean to get's return type?
}
```

### What's Needed Beyond Keyed Stable

A **cross-method type predicate** mechanism:

```ts
interface Map<K, V> {
    has(key: K): key narrows get(key) from (V | undefined) to V;
}
```

This is an entirely new concept: "a boolean-returning method that, when true, modifies the return type of a *different* method on the same receiver, when called with the same arguments."

---

## 6. Cross-Method Type Guard — Design Exploration

### Strawman Syntax Options

**Option A: narrows clause on has()**
```ts
interface Map<K, V> {
    has(key: K): boolean narrows get(key) to V;
    // When has(key) returns true, get(key) returns V instead of V | undefined
}
```

**Option B: conditional return type on get()**
```ts
interface Map<K, V> {
    get(key: K): V | undefined;
    get(key: K): V when this.has(key);  // Overload active when has(key) is true
}
```

**Option C: Type predicate pattern (this-type mutation)**
```ts
interface Map<K, V> {
    has<Key extends K>(key: Key): this is MapWith<K, V, Key>;
}
interface MapWith<K, V, DefiniteKey extends K> extends Map<K, V> {
    get(key: DefiniteKey): V;  // Overload for the specific key
    get(key: K): V | undefined;
}
```

Option C is DanielRosenwasser's 2016 workaround. It actually works for string literal keys but:
- Only works for literal types (not variables)
- Doesn't compose well (`has("a") && has("b")`)
- Changes the type of `this` (the Map object) rather than narrowing the result

### CFA Requirements for Any Solution

1. **Flow node for `has(key)` condition**: Create a conditional flow fact saying "for receiver `R` and key `K`, `has` returned true"
2. **Cross-method fact lookup**: When encountering `map.get(key)`, check if there's an active flow fact from `map.has(key)` for the same receiver and key
3. **Key equivalence**: Prove that the key in `get(key)` is the same value as the key in `has(key)` — trivial for literals, needs reference tracking for variables
4. **Invalidation**: `map.delete(key)`, `map.set(key, v)`, or `map.clear()` must invalidate the cross-method fact

### What getFlowTypeOfReference Would Need

Currently, `getFlowTypeOfReference` tracks a **single reference** through flow. For Map `has()` → `get()`:

```text
reference = map.get("foo")   // What we're trying to narrow
```

At a `FlowCondition` node for `map.has("foo")`:
- Current: No match — `map.get("foo")` is not `map.has("foo")`, so the condition is irrelevant
- Needed: Recognize `map.has("foo")` as a cross-method predicate for `map.get("foo")` and narrow `V | undefined` → `V`

This requires:
1. A new concept of "cross-method matching references" — `map.has(key)` matches `map.get(key)` if they share receiver and key
2. A way to encode the type transformation — `has` returning true means `get`'s `| undefined` is removed
3. All of this needs to be encoded in the type declarations, not hardcoded

---

## 7. Comparison with Other Languages

| Language | `has()`→`get()` Narrowing | Pattern |
|----------|---------------------------|---------|
| **Kotlin** | No — `containsKey(key)` doesn't narrow `map[key]` | Smart casts only for stable val references |
| **Rust** | No — `contains_key(&key)` doesn't narrow | `if let Some(val) = map.get(&key)` preferred |
| **Swift** | No — but `if let val = dict[key]` (optional binding) | Language-level optional unwrap |
| **C#** | `map.TryGetValue(key, out var val)` — one call, two outputs | Out parameter pattern |
| **Python** | No — `key in dict` doesn't narrow `dict[key]` | `val = dict.get(key, default)` or direct access |
| **Java** | No — `containsKey` doesn't narrow | Check-then-get or `getOrDefault` |
| **Go** | `val, ok := m[key]` — one expression, two outputs | Multi-return pattern |

### Universal Insight

**No mainstream language implements cross-method narrowing.** Every language that handles this pattern well does so through **single-expression access**:
- Rust: `if let Some(val) = map.get(&key)`
- Swift: `if let val = dict[key]`
- Go: `val, ok := m[key]`
- C#: `TryGetValue(key, out var val)`

The pattern is always: **retrieve + check in one operation**, not "check existence, then retrieve separately."

### Implication for TypeScript

The "right" solution in TypeScript isn't cross-method narrowing — it's using the existing single-call pattern:
```ts
const val = map.get("foo");
if (val !== undefined) {
    // val is narrowed to V
}
```

This is already perfectly supported. The `has()`→`get()` pattern is an ergonomic desire, not a soundness gap.

---

## 8. Implementation Complexity Assessment

### Keyed Stable (self-repeat narrowing per key)

| Component | Complexity | Notes |
|-----------|------------|-------|
| Parser | Low | Extend `stable` to accept `[paramName]` |
| Binder | Low | Track keyed vs unkeyed stable |
| CFA flow facts | Medium | Key flow facts by (receiver, method, key-value) instead of just (receiver, method) |
| Key equivalence | Medium | For literal keys, exact match. For variables, reference-identity check. |
| Keyed invalidation | Medium | `mutator[key]` only invalidates same-key facts |
| Total | **Medium** | Extension of existing `stable` infrastructure |

### Cross-Method Narrowing (`has()` → `get()`)

| Component | Complexity | Notes |
|-----------|------------|-------|
| New concept in type system | Very High | No precedent in TS for "method A constrains method B's return type" |
| Declaration syntax | High | Needs entirely new syntax for cross-method predicates |
| CFA cross-reference matching | Very High | `getFlowTypeOfReference` needs to match across different method names |
| Key parameter correlation | High | Must prove key identity across two different call sites |
| Type transformation encoding | High | Must encode "if has returns true, get removes `| undefined`" in declarations |
| Interaction with generics | Very High | `Map<K, V>` — the narrowing is generic in both K and V |
| Interaction with overloads | High | Map already has overloads; cross-method predicates must compose |
| Lib.d.ts changes | Medium | Breaking change to Map/Set type declarations |
| Total | **Very High** | Novel type system concept with broad implications |

### Estimated Effort

- **Keyed stable alone**: 2-4 weeks (extends existing infrastructure)
- **Cross-method narrowing**: 3-6 months minimum (novel research + implementation + testing)
- **Combined**: The cross-method narrowing dominates

---

## 9. Recommendation

### Should We Pursue This Now?

**No. Defer cross-method Map narrowing.**

Reasons:

1. **No language precedent.** No mainstream language implements cross-method narrowing. Every language that handles this well uses single-expression access (`TryGetValue`, `if let`, multi-return).

2. **The workaround is trivial and idiomatic.**
   ```ts
   const val = map.get("foo");
   if (val !== undefined) { /* val is narrowed */ }
   ```
   This is one line of code. It's also more efficient at runtime (one lookup instead of two).

3. **Orthogonal to stable/mutator.** The Map pattern is fundamentally different from signal narrowing. Trying to extend `stable` to cover it would distort the clean semantics of the current system.

4. **Enormous implementation complexity.** Cross-method type predicates are a novel type system concept requiring months of research and implementation, with unclear composability guarantees.

5. **The keyed stable extension, while feasible, doesn't solve the actual problem.** Keyed stable enables `get("foo")` self-repeat narrowing (which is useful!), but doesn't enable the `has()` → `get()` cross-method predicate that users are requesting.

6. **Low signal-to-noise ratio.** #13086 has 189 reactions over 9+ years, compared to #57725 (351 reactions in 2 years) and #60948 (105 reactions in months). The demand exists but is slower-growing and has a straightforward workaround.

### What To Do Instead

1. **Complete stable/mutator for signals** — the current priority. This serves a much larger user base (Angular, Solid, Vue, Preact) with no good workaround.

2. **Consider keyed stable as a Phase 6+ extension** — enables per-key self-repeat narrowing for `get()`, which partially addresses the ergonomic complaint.

3. **Monitor TC39 pattern matching** — if JS gets `match` or `if let` syntax, it may solve this at the language level (one-expression access patterns).

4. **If cross-method narrowing is ever pursued**, design it as a general feature, not Map-specific:
   ```ts
   // General cross-method predicate syntax (future research)
   interface Map<K, V> {
       has(key: K): boolean narrows { get(key): V };
   }
   ```
   This would also cover `hasAttribute()`/`getAttribute()` on DOM elements (#22238).

### Potential Future Keyed Stable Design (Phase 6+)

If keyed stable is pursued later, a minimal design:

```ts
interface Map<K, V> {
    // Self-repeat narrowing per key
    stable[key] get(key: K): V | undefined;
    
    // Key-scoped invalidation
    mutator[key] set(key: K, value: V): this invalidates get[key];
    mutator[key] delete(key: K): boolean invalidates get[key];
    mutator clear(): void invalidates get;  // all keys
}
```

This enables:
```ts
const val = map.get("foo");
if (val !== undefined) {
    map.set("bar", 1);    // Doesn't invalidate get("foo") narrowing
    map.get("foo");       // Still narrowed — keyed stable + no same-key mutation
    
    map.set("foo", 2);    // Invalidates get("foo") narrowing
    map.get("foo");       // Back to V | undefined
}
```

This is useful but **does not cover** `has()` → `get()`. The cross-method predicate remains a separate, much harder problem.

---

## 10. Summary Table

| Question | Answer |
|----------|--------|
| Is this a commonly requested feature? | Yes — #13086 has 189 reactions |
| Does any language do cross-method narrowing? | No |
| Can `stable/mutator/invalidates` solve it? | No — fundamentally different pattern |
| Could keyed stable help? | Partially — enables self-repeat narrowing per key, not cross-method |
| Is the workaround acceptable? | Yes — `const val = map.get(key); if (val !== undefined)` |
| Implementation complexity | Very High (novel type system concept) |
| Should we pursue now? | No — defer. Focus on stable/mutator for signals |
| When to revisit? | After stable/mutator ships and stabilizes; if TC39 pattern matching doesn't resolve it |
