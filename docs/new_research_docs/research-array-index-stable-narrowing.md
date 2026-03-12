# Research: Array Index Narrowing, `.at()`, and `stable[key]` Compatibility

## Document Control
- Status: Research Draft
- Scope: Interaction of `stable[key]` keyed narrowing with Array element access and `.at()` method
- Related: Phase 9 (Keyed Linked Predicates), Phase 12 (Standard Library Annotations)

## 1. Executive Summary

TypeScript already supports per-index narrowing for array element access (`arr[0]`), but **`.at()`** method calls are never narrowed. The `stable[key]` system could bring narrowing to `.at()`, but Array's index-shifting mutations make keyed narrowing **partially unsound**. This document analyzes the current behavior, identifies the soundness gaps, and explores whether `stable[key]` is appropriate for Arrays.

## 2. Current TypeScript Behavior (Empirically Verified)

### 2.1 Test Results

The following behavior was verified empirically with the tsgo compiler:

```ts
// @strict: true
const c: (number | undefined)[] = [];
c[0] = 1;
if (c[0] === 1) {
    const d = c[0];     // d: 1               ← narrowed to literal type
    c[0] = 2;
    const e = c[0];     // e: number           ← narrowed to assignment type
}
```

| Expression | Type | Narrowed? | Notes |
|-----------|------|-----------|-------|
| `d = c[0]` (after `=== 1` guard) | `1` (literal) | Yes | Element access narrowing works |
| `e = c[0]` (after `c[0] = 2`) | `number` | Yes | Assignment narrows to assigned type |
| `arr.at(0)` (after `at(0) !== undefined`) | `string \| undefined` | **No** | `.at()` is a fresh call — CFA doesn't link calls |
| `nums[0]` (after `!== undefined`) | `number` | Yes | Element access is narrowable |
| `nums.at(0)` (after `at(0) !== undefined`) | `number \| undefined` | **No** | Method call not tracked |
| `items[0]` after `items[1] = undefined` | `string` | Yes (preserved) | Cross-index write does NOT invalidate |
| `list[0]` after `list.push(4)` | `number` | Yes (preserved) | `push()` does NOT invalidate index narrowing |
| `list[0]` after `list.splice(0, 1)` | `number` | Yes (preserved) | `splice(0,1)` does NOT invalidate — **UNSOUND** |
| `data.at(-1)` after guard | `string \| undefined` | **No** | `.at()` never narrows |
| `tuple[0]` after `tuple[1] = undefined` | `number` | Yes (preserved) | Tuple: independent index narrowing |

### 2.2 Key Findings

1. **Element access (`arr[0]`) IS narrowable** — TypeScript treats `arr[0]` as a property-like access expression and applies CFA narrowing normally.

2. **`.at()` is NEVER narrowable** — It's a method call returning a fresh value. `.at(0) !== undefined` narrows the return value into a local variable, but re-calling `.at(0)` is a new invocation with no CFA linkage.

3. **Cross-index writes do NOT invalidate** — Writing to `arr[1]` does not reset narrowing of `arr[0]`. CFA tracks each literal-index access independently.

4. **Index-shifting methods do NOT invalidate** — Even `splice(0, 1)`, which removes the element at index 0 and shifts all other elements down, does NOT reset `arr[0]` narrowing. This is **unsound** — after `splice(0, 1)`, `arr[0]` is a completely different element than before.

5. **`push()` does NOT invalidate** — Adding elements to the end doesn't change existing indices, so preserving narrowing is actually **sound** for positive literal indices. But TypeScript doesn't distinguish — it preserves ALL index narrowing regardless.

## 3. The Soundness Problem with Array Index Narrowing

### 3.1 Current Unsound Behaviors

```ts
const arr: (string | undefined)[] = ["hello", undefined, "world"];

// Scenario A: splice shifts indices
if (arr[0] !== undefined) {
    arr.splice(0, 1);     // Removes "hello" at index 0
    const x = arr[0];      // Type: string (narrowed) — WRONG! arr[0] is now undefined
    x.toUpperCase();       // Runtime error: Cannot read property of undefined
}

// Scenario B: unshift shifts indices
if (arr[0] !== undefined) {
    arr.unshift(undefined); // Inserts undefined at index 0, shifts everything right
    const x = arr[0];       // Type: string (narrowed) — WRONG! arr[0] is now undefined
    x.toUpperCase();        // Runtime error
}

// Scenario C: reverse changes all indices
if (arr[0] !== undefined) {
    arr.reverse();          // "hello" moves from index 0 → index 2
    const x = arr[0];       // Type: string (narrowed) — WRONG! arr[0] is now "world" or undefined
}

// Scenario D: sort changes all indices
if (arr[0] !== undefined) {
    arr.sort();             // Reorganizes all elements
    const x = arr[0];       // Type: string (narrowed) — ACTUALLY correct by coincidence (sort doesn't add undefined)
    // But the narrowed VALUE is different from what was guarded
}
```

### 3.2 Why TypeScript Tolerates This

TypeScript's property narrowing has always been optimistic about method calls. The rule is:

> **Property narrowing survives method calls on the same object.**

This is the same reason `obj.value` stays narrowed after `obj.toString()` — TypeScript assumes method calls don't change property values. For array methods like `splice()`, `unshift()`, `reverse()`, this assumption is wrong. But TypeScript accepts this unsoundness as a practical trade-off:

- The alternative (resetting all property narrowing after any method call) would make TypeScript nearly unusable for real code
- Most code doesn't narrow an array index and then splice/unshift in the same flow
- The `noUncheckedIndexedAccess` flag already addresses the read-side by making all index access `T | undefined`

## 4. How `stable[key]` Would Apply to Arrays

### 4.1 The .at() Opportunity

`.at()` is a method call, so it's never narrowed today. With `stable[key]`:

```ts
interface Array<T> {
    stable[index] at(index: number): T | undefined;
}

const arr: (string | undefined)[] = ["hello", undefined, "world"];
if (arr.at(0) !== undefined) {
    arr.at(0).toUpperCase(); // With stable[key]: narrowed to string!
}
```

This would bring `.at()` to parity with element access for narrowing.

### 4.2 Negative Indices: The `.at(-1)` Problem

`.at(-1)` is the last element. But the "last element" is a **dynamic concept** — it changes when the array length changes:

```ts
const data: (string | undefined)[] = ["a", "b", "c"];
if (data.at(-1) !== undefined) {
    // data.at(-1) is "c" — narrowed to string
    data.push("d");
    // data.at(-1) is now "d" — a DIFFERENT element!
    // But -1 is the same literal key... narrowing is wrong
    data.at(-1);  // Still narrowed to string? But value changed!
}
```

**Negative indices are unsound with keyed stable narrowing** because the physical element changes when the array length changes, even though the key (`-1`) stays the same.

**Positive literal indices are more sound** — `arr.at(0)` always refers to the same physical slot (assuming no index-shifting mutations like `splice`, `unshift`). But they share the same unsoundness as element access when index-shifting methods are called.

### 4.3 Proposed Array Annotation

```ts
interface Array<T> {
    // .at() could be stable[index] — but see caveats below
    stable[index] at(index: number): T | undefined;

    // Index-shifting mutators — should invalidate ALL indices
    mutator push(...items: T[]): number;           // Doesn't shift, but changes at(-1)
    mutator pop(): T | undefined;                   // Doesn't shift [0], but changes at(-1)
    mutator unshift(...items: T[]): number;         // Shifts ALL positive indices
    mutator shift(): T | undefined;                 // Shifts ALL positive indices
    mutator splice(start: number, deleteCount?: number, ...items: T[]): T[];  // Shifts indices >= start
    mutator reverse(): this;                        // Changes ALL indices
    mutator sort(compareFn?: (a: T, b: T) => number): this; // Changes ALL indices
    mutator fill(value: T, start?: number, end?: number): this; // Changes specific indices
    mutator copyWithin(target: number, start: number, end?: number): this; // Changes specific indices

    // Non-mutating methods — should NOT invalidate
    // slice, concat, map, filter, reduce, find, etc. — all return new arrays
    includes(searchElement: T, fromIndex?: number): boolean;  // Read-only scan
    indexOf(searchElement: T, fromIndex?: number): number;    // Read-only scan
}
```

### 4.4 What Would Change vs Current Behavior?

| Scenario | Current TS | With `stable[key]` on `.at()` | Better? |
|----------|-----------|-------------------------------|---------|
| `at(0)` after `at(0) !== undefined` | Not narrowed | Narrowed to `T` | **Yes** — new capability |
| `at(-1)` after `at(-1) !== undefined` | Not narrowed | Narrowed to `T` | **Partially** — unsound if length changes |
| `at(0)` after `push()` | N/A (never narrowed) | Preserved (push doesn't shift positive indices) | **Sound for positive, unsound for negative** |
| `at(0)` after `splice(0,1)` | N/A (never narrowed) | Invalidated (splice is mutator) | **Better** — catches real bug |
| `arr[0]` after `splice(0,1)` | Preserved (UNSOUND) | No change (element access not affected by stable system) | **Same unsoundness** |

## 5. Can `.at()` Match `[0]` Behavior?

### 5.1 The Question

Should `at(index)` and `[index]` be linked — i.e., should `at(0)` narrowing also narrow `arr[0]`, and vice versa?

**Answer: No.** These are fundamentally different access mechanisms:
- `arr[0]` is a property access expression — CFA tracks it as a syntactic pattern
- `arr.at(0)` is a method call — CFA tracks it through the stable system

Linking them would require CFA to understand that `at(0)` is semantically equivalent to `[0]` for non-negative indices, which is:
- Not generally true (`.at()` handles negative indices differently)
- Requires special-casing in the checker
- A maintenance burden for a marginal benefit

### 5.2 Could `[0]` Access Go Through `.at()` Semantics?

Theoretically, `arr[0]` could be desugared to `arr.at(0)` for narrowing purposes. But this would:
- Change the narrowing behavior of element access (currently property-based, not call-based)
- Break existing code that depends on index narrowing surviving method calls
- Be a massive breaking change

**Verdict: `.at()` and `[index]` remain independent narrowing tracks.** The `stable[key]` system only affects `.at()`.

## 6. Negative Index Design Options

### Option A: Disallow Negative Indices in `stable[key]`

```ts
// Only positive literal indices participate in keyed narrowing
// Negative indices are treated as default (not narrowed)
if (data.at(-1) !== undefined) {
    data.at(-1); // Still string | undefined — negative index not keyed
}
if (data.at(0) !== undefined) {
    data.at(0);  // string — positive index keyed and narrowed
}
```

**Implementation**: In `isMatchingKeyArgument`, reject negative numeric literals.

**Pros**: Sound. Simple.
**Cons**: `.at(-1)` is the #1 use case for `.at()`. Excluding it removes much of the value.

### Option B: Allow Negative Indices But Invalidate on Length-Changing Operations

```ts
if (data.at(-1) !== undefined) {
    data.at(-1);     // string — narrowed
    data.push("d");  // push changes length → invalidates at(-1)
    data.at(-1);     // string | undefined — invalidated
}
```

**Implementation**: Mark `push`, `pop`, `unshift`, `shift`, `splice` as mutators. For negative keys, any length-changing operation invalidates. For positive keys, only index-shifting operations invalidate.

**Pros**: Practical. Handles the common case correctly.
**Cons**: Complex — different invalidation rules for positive vs negative indices.

### Option C: Treat All `.at()` Calls as One Key

```ts
// All .at() calls share a single narrowing scope — any mutator invalidates all
if (data.at(0) !== undefined && data.at(1) !== undefined) {
    data.splice(5, 1); // Invalidates ALL at() narrowings
    data.at(0);  // Back to T | undefined
    data.at(1);  // Back to T | undefined
}
```

**Implementation**: Ignore the index argument for invalidation — treat `at` as unkeyed.

**Pros**: Simple. Conservative and sound.
**Cons**: Overly conservative — `push()` would invalidate `at(0)` even though index 0 doesn't change.

### Recommendation

**Option A (disallow negative indices) for the initial implementation.** It's sound and simple. If the community requests negative index support, Option B can be added later as a refinement. The key insight: `.at()` with positive literal indices is semantically identical to element access, so the soundness properties match.

## 7. Comparison: Array vs Map Keyed Narrowing

| Property | Map `get(key)` | Array `.at(index)` |
|----------|---------------|-------------------|
| Key type | Any (usually string/number) | number (integer) |
| Key stability | Keys don't shift | Indices shift on splice/unshift/shift |
| Negative keys | N/A | `.at(-1)` = last element (dynamic) |
| Length changes | N/A — size change doesn't affect keys | Length change affects negative indices |
| Mutating method count | 3 (set, delete, clear) | 10+ (push, pop, splice, shift, unshift, reverse, sort, fill, copyWithin, ...) |
| Soundness of keyed narrowing | Very high | Moderate (positive) / Low (negative) |
| Practical value of narrowing | Very high (Map has/get pattern) | Moderate (.at() narrowing) |

**Key difference**: Map keys are **stable** — `map.get("x")` always refers to the same logical entry. Array indices are **positional** — `arr.at(0)` refers to whatever element happens to be at position 0, which changes when elements are inserted/removed before it.

This makes Map a natural fit for `stable[key]` and Array a cautious fit.

## 8. Existing Property Narrowing vs `stable[key]` for Arrays

### 8.1 What Property Narrowing Already Does Right

```ts
const arr: (number | undefined)[] = [1, 2, 3];
if (arr[0] !== undefined) {
    arr[0].toFixed(2); // ✅ narrowed — element access IS property narrowing
}
```

This **already works**. Adding `stable[key]` on `.at()` doesn't replace this — it supplements it.

### 8.2 What Property Narrowing Gets Wrong

```ts
if (arr[0] !== undefined) {
    arr.splice(0, 1);   // Removes element at index 0
    arr[0].toFixed(2);  // ✅ Still "narrowed" — WRONG! arr[0] is now a different element
}
```

TypeScript's property narrowing doesn't distinguish between index-preserving and index-shifting operations. The `stable[key]` system with mutator annotations on `splice` would catch this:

```ts
interface Array<T> {
    stable[index] at(index: number): T | undefined;
    mutator splice(start: number, deleteCount?: number, ...items: T[]): T[];
}

if (arr.at(0) !== undefined) {
    arr.splice(0, 1);   // mutator → invalidates at[0]
    arr.at(0);           // ❌ Back to T | undefined — correctly invalidated
}
```

This is actually **better** than current property narrowing behavior — `stable[key]` with mutator annotations catches the splice bug that property CFA misses.

## 9. `includes()` / `indexOf()` — Whole-Array Queries

These methods scan the entire array, not a specific index:

```ts
const arr: number[] = [1, 2, 3];
arr.includes(2); // boolean — scans whole array
arr.indexOf(2);  // number — scans whole array
```

These are NOT keyed operations — they search by value, not by index. They can't be `stable[key]` because the "key" is the search value, not a positional index.

However, `includes` could be a linked predicate:

```ts
// Could Array.includes be a type guard?
interface Array<T> {
    includes<U extends T>(searchElement: U): this is Array<T> & { [index: number]: U };
    // This doesn't actually work — includes checks membership, not index type
}
```

**Verdict**: `includes()` and `indexOf()` are not candidates for `stable[key]`. They're value-based queries, not key-based accessors.

## 10. TypedArray Consideration

TypedArrays (`Int32Array`, `Float64Array`, etc.) have `.at()` too:

```ts
const fa = new Float64Array([1.0, 2.0, 3.0]);
fa.at(0); // number | undefined
```

TypedArrays are interesting because:
- They have **fixed length** — no `push`, `pop`, `splice`, `unshift`, `shift`
- Individual elements are always `number` (never `undefined`)
- `.at()` returns `number | undefined` only because the index might be out of bounds

For TypedArrays, `stable[key]` on `.at()` would be **completely sound** — the array never changes length and individual elements are only changed by direct index assignment (`fa[0] = 42`).

```ts
interface TypedArray {
    stable[index] at(index: number): number | undefined;
    // No index-shifting mutators exist!
    // Only direct assignment: fa[0] = 42
}
```

## 11. Practical Value Assessment

| Feature | Value | Notes |
|---------|-------|-------|
| `at(0)` narrowing (positive literals) | **Medium** | Parity with element access narrowing |
| `at(-1)` narrowing (negative literals) | **Low** | Unsound when length changes; common use case |
| Mutator annotations on splice/unshift | **Medium-High** | Catches real bugs that property CFA misses |
| TypedArray `.at()` narrowing | **High** | Perfectly sound — fixed length, no shifting |
| `includes()` as type guard | **Out of scope** | Not a keyed operation |

## 12. Recommendations

1. **Do NOT make Array a primary `stable[key]` target for Phase 12.** Map is the natural fit — Array has too many unsoundness edge cases with index shifting.

2. **TypedArray `.at()` is a strong candidate.** Fixed-length arrays with stable indices are ideal for `stable[key]`.

3. **If Array `.at()` is annotated**:
   - Only allow narrowing for positive literal indices initially (Option A)
   - Mark all index-shifting methods as mutators
   - This actually **improves** on current property narrowing by catching splice/unshift bugs

4. **Current property narrowing for `arr[0]` is unchanged.** The `stable[key]` system is additive and doesn't affect existing element access CFA.

5. **Array should be Phase 14+ at earliest**, after Map (Phase 12) and post-call narrowing extension (Phase 13) are stable.

## 13. Open Questions

1. Should `.at()` narrowing be linked with element access narrowing? (If `arr.at(0)` is narrowed, should `arr[0]` also be considered narrowed? Probably not — they're independent CFA mechanisms.)

2. For TypedArrays, `.at()` always returns `number | undefined` (or `bigint | undefined` for BigInt64Array). The `| undefined` comes from potential out-of-bounds access. Should `stable[key]` narrowing remove the `| undefined` and narrow to `number`? This would match the behavior of `x = fa[0]; if (x !== undefined) { ... }`.

3. Could the `noUncheckedIndexedAccess` compiler flag interact with `stable[key]`? When enabled, all element access returns `T | undefined`. With `stable[key]` on `.at()`, the narrowing would then have a more meaningful effect (removing the `| undefined`).

4. Should `ReadonlyArray<T>` inherit the stable annotations? Since ReadonlyArray has no mutating methods, ALL `.at()` narrowings would be preserved (no invalidation possible). This is completely sound.

## 14. CFA Implementation Details: How `arr[0]` Narrowing Works Internally

Understanding the implementation helps evaluate whether `.at()` and `[]` can be linked.

### 14.1 `isMatchingReference` — Identity Matching

Element access (`arr[0]`) is treated identically to property access in CFA. In `flow.go`, `isMatchingReference` handles both `PropertyAccessExpression` and `ElementAccessExpression` in the same case:

```go
case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
    if sourcePropertyName, ok := c.getAccessedPropertyName(source); ok {
        if ast.IsAccessExpression(target) {
            if targetPropertyName, ok := c.getAccessedPropertyName(target); ok {
                return targetPropertyName == sourcePropertyName &&
                    c.isMatchingReference(source.Expression(), target.Expression())
            }
        }
    }
```

`getAccessedPropertyName` delegates to `tryGetElementAccessExpressionName`, which extracts literal names from numeric/string literal indices. So `arr[0]` gets property name `"0"`, making it equivalent to `arr.0` for CFA purposes.

### 14.2 CFA Cache Keys

Both property and element access produce identical cache keys:

```go
case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
    if propName, ok := c.getAccessedPropertyName(node); ok {
        b.writeByte('.')
        b.writeString(propName) // arr[0] → "symbol.0", arr.foo → "symbol.foo"
        return true
    }
```

Meanwhile, `stable[key]` call references produce different cache keys:

```go
case ast.KindCallExpression:
    b.writeByte('(')
    if argCount == 1 {
        c.writeFlowCacheKey(b, node.Arguments()[0], ...)
    }
    b.writeByte(')') // arr.at(0) → "symbol.at(0)"
```

So `arr[0]` → key `"symbol.0"` and `arr.at(0)` → key `"symbol.at(0)"`. These are **completely separate cache entries** and **completely separate references** in CFA.

### 14.3 Why Linking `.at()` and `[]` Is Architecturally Expensive

To link them, we would need:

1. **Cross-type matching in `isMatchingReference`**: Add a case where `source` is `CallExpression` (`.at(0)`) and `target` is `ElementAccessExpression` (`[0]`), check if the call is to a `stable[key]` method named `at` on the same receiver, and the key argument matches the element access index. And vice versa.

2. **Cache key unification or aliasing**: Either generate the same cache key for both (losing distinguishability), or maintain a cache alias map (complexity).

3. **Different declared types**: `arr[0]` on `[string, number]` returns `string`, while `arr.at(0)` returns `string | number | undefined`. Cross-narrowing would need type-level awareness that these access the same slot — a fundamentally different semantic layer.

4. **No `[]` equivalent for negative indices**: `arr[-1]` doesn't access the last element in JavaScript (it accesses property `"-1"`), so `.at(-1)` has no corresponding element access.

**Verdict: Not recommended.** The CFA mechanisms are fundamentally different (property-based vs call-based) and unifying them would introduce significant complexity for marginal benefit.

## 15. Tuple-Specific Analysis

### 15.1 Tuple Element Access Precision

For tuples, `getTupleElementType` returns the precise element type:

```ts
type Pair = [string, number];
const p: Pair = ["hello", 42];
p[0];    // string (precise tuple element type)
p[1];    // number (precise tuple element type)
p.at(0); // string | number | undefined (union of ALL elements + undefined)
```

The precision loss happens at the `.at()` signature level — `.at(index: number): T | undefined` where `T` is the union of all element types.

### 15.2 Can `stable[key]` Recover Tuple Precision for `.at()`?

**No.** `stable[key]` preserves narrowing of method return values through CFA, but it doesn't change the **initial return type**. The type checker resolves `arr.at(0)` as `string | number | undefined` before CFA even begins.

To recover per-index precision, the checker itself would need to special-case `.at()` on tuple types, returning the precise element type for literal index arguments. This is a **type-checking feature** independent of CFA/narrowing:

```ts
// Hypothetical checker special-case:
// When calling .at(N) on Tuple where N is a numeric literal:
//   - Return Tuple[N] | undefined instead of Tuple[number] | undefined
type Pair = [string, number];
const p: Pair = ["hello", 42];
p.at(0); // Would return: string | undefined (instead of string | number | undefined)
p.at(1); // Would return: number | undefined
p.at(2); // Would return: undefined (out of bounds)
```

This would be a valuable feature but is orthogonal to `stable[key]`. It could be proposed as a separate TypeScript enhancement.

### 15.3 Tuple Narrowing with `stable[key]` — What Would Actually Help?

Even without per-index precision, `stable[key]` on `.at()` still helps tuples:

```ts
type MaybePair = [string | undefined, number | undefined];
const p: MaybePair = ["hello", undefined];

// Today: .at() narrows nothing — fresh call each time
if (p.at(0) !== undefined) {
    p.at(0); // string | number | undefined — not narrowed
}

// With stable[key] on .at():
if (p.at(0) !== undefined) {
    p.at(0); // string | number — narrowed (removed undefined)
    // Not as precise as p[0] (which would be string), but still useful
}
```

The narrowing removes `undefined` from the union, which is the primary use case for undefined-checking.

## 16. Negative Indices: Complete Soundness Analysis with Full Mutator Coverage

The user asks: "Can't we annotate ALL mutating methods so we will know when length and array itself changes?"

### 16.1 Method-Based Mutations (Coverable by `mutator`)

All Array mutation methods can be annotated as `mutator`, which would invalidate `.at(-1)` narrowing:

| Method | Effect on `.at(-1)` | Covered by `mutator`? |
|--------|--------------------|-----------------------|
| `push(x)` | Changes last element | ✅ Yes |
| `pop()` | Changes last element | ✅ Yes |
| `splice(...)` | May change last element | ✅ Yes |
| `unshift(x)` | Shifts all, changes last | ✅ Yes |
| `shift()` | Shifts all, changes last | ✅ Yes |
| `reverse()` | Changes all indices | ✅ Yes |
| `sort()` | Changes all indices | ✅ Yes |
| `fill(...)` | May change elements | ✅ Yes |
| `copyWithin(...)` | May change elements | ✅ Yes |

### 16.2 Non-Method Mutations (NOT Coverable by `mutator`)

These are the **soundness gaps** that mutator annotations cannot close:

| Mutation Vector | Effect | Why Not Covered |
|----------------|--------|-----------------|
| `arr[i] = x` | Changes element at index i | Direct property assignment, not a method call. CFA generates a `FlowAssignment` node but `isStableReceiverWriteBoundaryForCallReference` only handles no-arg calls — keyed stable references (`.at(-1)`) are not invalidated by element assignments on the same array. |
| `arr.length = 0` | Empties entire array | Property assignment to `.length`, not a method call. CFA does not link `.length` assignment to `.at()` invalidation. |
| `delete arr[i]` | Creates sparse hole | `delete` is a `DeleteExpression` — CFA generates **no flow nodes** for delete. Completely invisible. |
| `someFunc(arr)` | External mutation via alias | The function could `push`, `splice`, or modify `arr` internally. Alias escape detection covers some cases but not all. |
| `Object.assign(arr, {...})` | Overwrites elements | Static method call on `Object`, not on `arr`. Not detected as mutation of `arr`. |
| `arr2 = arr; arr2.push(x)` | Alias mutation | CFA doesn't track alias relationships between array bindings. |

### 16.3 How Bad Are These Gaps?

**`arr[i] = x`** — This is the most important gap. Setting `arr[arr.length - 1] = undefined` directly changes what `.at(-1)` returns without any method call. However, this pattern is relatively uncommon — most developers use `arr[i]` for known-index writes and `.at(-1)` for "get the last element" reads, rarely mixing them in the same flow.

**`arr.length = 0`** — A common pattern for clearing arrays. After `arr.length = 0`, `.at(-1)` returns `undefined`. If narrowing survives this, it's unsound. But `arr.length = 0` is typically not used in code that also narrows `.at(-1)` — the patterns don't naturally co-occur.

**`delete arr[i]`** — Already unsound for existing property narrowing (`arr[0]` stays narrowed after `delete arr[0]`). Adding `.at()` narrowing doesn't make this worse.

### 16.4 Revised Assessment

With full mutator annotations on all Array methods, the remaining soundness gaps for negative indices are:

1. **Direct element assignment** (`arr[i] = x`) — not caught
2. **Length property assignment** (`arr.length = N`) — not caught
3. **`delete`** — not caught (same unsoundness as existing property narrowing)
4. **Alias mutations** — partially caught by alias escape detection

These are the **same gaps** that already exist for positive index narrowing via `arr[0]` property CFA. The `stable[key]` system with mutator annotations would be **no less sound** than existing `arr[0]` narrowing for positive indices, and **strictly better** for method-based mutations (splice, unshift, etc. would correctly invalidate).

For negative indices specifically, the additional unsoundness from length changes via `arr.length = N` is a real concern. However, the pattern `guard .at(-1) → mutate length → use .at(-1)` is rare in practice.

### 16.5 Updated Recommendation

Given this deeper analysis, the recommendation shifts:

**Option B (allow negative indices, invalidate on mutator calls) is viable** if we accept the same level of unsoundness as existing property narrowing for `arr[0]`. The `direct element assignment` and `length assignment` gaps exist for ALL array narrowing today, not just `.at(-1)`.

However, **Option A (positive-only) remains the safer initial choice** for a shipping implementation. Option B can be enabled as a follow-up after validating the soundness in practice.

## 17. Angular `computed()` dependsOn — Reconfirmed Rejection

### 17.1 Context

Proposal 2 (explicit `dependsOn` declaration on `computed`) was previously rejected in the Angular computed research document. The user asked whether this maps to something concrete in Angular ("soa exactly as in ngextension?").

### 17.2 Angular's Actual Architecture

**`DependsOnSlotContextOpTrait`** — The only `dependsOn` in Angular's codebase is in the compiler IR, and it's about **template rendering slot management** (which DOM slot to `advance()` to), not signal reactive dependencies.

**`linkedSignal()`** — The closest to explicit dependency declaration, with a `source: () => S` parameter. But the source is a runtime function, not a type-level reference. The type system only sees `LinkedSignalGetter<S, D>` — no dependency metadata in the type.

**Angular DevTools** — Angular CAN extract the full dependency graph at runtime via `getSignalGraph()`, walking `ReactiveNode.producers` linked lists. But this is runtime-only, dev-mode-only, and has zero type-level visibility.

**Angular Language Service** — Has no signal dependency tracking. Treats `count()` and `doubled()` as ordinary function calls.

### 17.3 Why Rejection Stands

The `dependsOn` rejection stands for three reasons:

1. **Cross-binding problem**: `stable[key]` tracks narrowing within a single object's properties. `computed()` dependencies are cross-binding (`count` → `doubled`), which `stable[key]` cannot express.

2. **Dynamic dependencies**: `computed(() => cond ? a() : b())` changes deps per-run — impossible to represent statically.

3. **Same result, more complexity**: Blanket invalidation (when any `mutator` is called, invalidate all `stable` narrowings in scope) already handles the `count.set() → doubled invalidated` case correctly, without requiring explicit dependency declarations.

The `dependsOn` pattern adds DX burden and unsoundness risk for zero additional narrowing benefit over conservative blanket invalidation.

## 18. Updated Open Questions

In addition to the open questions from Section 13:

5. Should `arr[i] = x` (direct element assignment) invalidate the corresponding `.at(i)` stable narrowing? This would require detecting that `arr` is the same receiver as the `.at()` callee and that `i` matches the key argument. Currently, element assignments only invalidate element access narrowing (not call-based narrowing).

6. Should we propose a TypeScript checker enhancement for tuple `.at()` precision separately from the `stable[key]` proposal? Having `.at(0)` return `Tuple[0] | undefined` instead of `Tuple[number] | undefined` would be valuable independently.

7. For `ReadonlyArray<T>`, all mutation vectors (methods, element assignment, length assignment) are blocked by the type system. Should `ReadonlyArray.at()` be annotated as `stable[key]` with no corresponding mutators? This would give **completely sound** persistent narrowing.

---

## 19. Tuple Deep Dive: A Near-Perfect `stable[key]` Candidate

### 19.1 Why Tuples Are More Stable Than Arrays

Tuples differ from arrays in critical ways that affect soundness:

| Property | Array | Tuple | Impact on `stable[key]` |
|----------|-------|-------|------------------------|
| Length | Dynamic (can push/pop) | Fixed at type level | Negative indices are **sound** for tuples (length can't change) |
| Element types | Uniform (`T[]`) | Per-index (`[T1, T2, ...]`) | Higher value from per-index narrowing |
| Index shifting | splice/unshift/shift change indices | Not applicable (no splice on tuples) | No index instability |
| `.at()` return type | `T \| undefined` | `T1 \| T2 \| ... \| undefined` (union of all elements) | `.at()` loses per-index precision |
| `.push()` | Allowed (extends array) | Allowed by TypeScript (surprisingly!) but type is fixed | Tuple mutation is possible but uncommon |
| `readonly` variant | `readonly T[]` — blocks mutation | `readonly [T1, T2]` — blocks mutation | Readonly tuples perfectly sound |
| `as const` | Produces `readonly [literal...]` | Already fixed-length with literal types | Full stability |

**Key insight**: Tuples have **fixed-length semantics at the type level**. Even though JavaScript allows `tuple.push()` at runtime, TypeScript's type system treats tuple length as known. This makes negative indices **sound** for tuples — `.at(-1)` always refers to the last element, and the last element's position can't change (the type system won't let you `push()` a value that changes the tuple's type).

### 19.2 Empirical Verification: Tuple Behavior

Tested with tsgo (strict mode, noUncheckedIndexedAccess enabled):

```ts
// === Element access vs .at() on tuples ===
const pair: [string, number] = ["hello", 42];
pair[0];      // string           ← precise element type
pair[1];      // number           ← precise element type
pair.at(0);   // string | number | undefined  ← LOST precision!
pair.at(1);   // string | number | undefined  ← LOST precision!
pair.at(-1);  // string | number | undefined  ← LOST precision!

// === Const assertion tuples ===
const constArr = [1, 2, 3] as const;  // readonly [1, 2, 3]
constArr[0];     // 1                       ← literal type!
constArr.at(0);  // 1 | 2 | 3 | undefined  ← lost literal precision

// === Optional tuple elements ===
type OptTuple = [string, number?, boolean?];
// t[0] → string
// t[1] → number | undefined
// t[2] → boolean | undefined
// t.at(0) → string | number | boolean | undefined  ← full union!
// t.length → 1 | 2 | 3

// === Rest element tuples ===
type RestTuple = [string, ...number[]];
// t[0] → string
// t[1] → number | undefined (with noUncheckedIndexedAccess)
// t.at(0) → string | number | undefined
// t.length → number (unknown — has rest)

// === Tuple narrowing ===
function testTupleNarrow(t: [string | undefined, number]) {
    if (t[0] !== undefined) {
        t[0];   // string — NARROWED ✅
    }
    if (t.at(0) !== undefined) {
        t.at(0); // string | number | undefined — NOT narrowed ❌
    }
}
```

### 19.3 What `stable[key]` Would Add for Tuples

#### Scenario A: `.at()` narrowing on tuples

```ts
// With stable[key] on tuple .at():
const pair: [string | undefined, number | undefined] = ["hello", undefined];
if (pair.at(0) !== undefined) {
    pair.at(0); // Today: string | number | undefined (not narrowed)
                // With stable[key]: string | number (narrowed — removed undefined)
}
```

This narrows the UNION type — removing `undefined` from `string | number | undefined`. It doesn't recover per-index precision (still `string | number`), but the undefined removal is the primary use case.

#### Scenario B: `.at()` on readonly tuples — perfect stability

```ts
const ro: readonly [string | undefined, number] = ["hello", 42];
// Readonly tuple has NO mutating methods
// stable[key] on .at() with no mutators → narrowing NEVER invalidated
if (ro.at(0) !== undefined) {
    doSomething();
    ro.at(0); // string | number — narrowing persists through ANY function call
    // Because there are no mutators to invalidate it!
}
```

This is **completely sound** — readonly tuples can't be mutated, so `.at()` narrowing is permanent within the guard scope.

#### Scenario C: `as const` tuples — already stable

```ts
const t = [1, "two", true] as const; // readonly [1, 2, 3]
t[0]; // 1 (literal type — already maximally precise)
t.at(0); // 1 | "two" | true | undefined (lost precision)

// With stable[key]:
if (t.at(0) !== undefined) {
    t.at(0); // 1 | "two" | true (removed undefined)
    // Still not as precise as t[0] (which is 1), but still useful
}
```

### 19.4 The `.at()` Precision Gap: Should the Checker Special-Case Tuples?

The biggest gap is NOT about CFA narrowing — it's about the **initial return type** of `.at()` on tuples.

Currently, `.at(N)` on `[string, number]` returns `string | number | undefined` regardless of `N`. For literal `N`, the checker COULD return the precise element type:

```ts
// Hypothetical: .at() tuple overload resolution
interface ReadonlyArray<T> {
    // When called on a tuple [A, B, C] with literal index:
    //   .at(0) → A | undefined
    //   .at(1) → B | undefined
    //   .at(2) → C | undefined
    //   .at(-1) → C | undefined
    //   .at(-2) → B | undefined
    at(index: number): T | undefined;
}
```

This would require the checker to:
1. Detect that the receiver is a tuple type
2. Check if the argument is a numeric literal
3. Resolve the corresponding tuple element type
4. For negative indices, compute `length + index`
5. Return `TupleElement[resolvedIndex] | undefined` instead of `T | undefined`

**This is independent of `stable[key]`** — it's a type inference enhancement. It would combine beautifully with `stable[key]` to give tuples the full narrowing experience:

```ts
const pair: [string | undefined, number] = [undefined, 42];
// With BOTH enhancements:
if (pair.at(0) !== undefined) {
    pair.at(0); // string (precise element type, undefined removed by narrowing)
}
```

## 20. Stability Matrix: Array vs Tuple vs ReadonlyArray vs ReadonlyTuple

### 20.1 Soundness Matrix

| Criterion | `T[]` | `[T1, T2]` | `readonly T[]` | `readonly [T1, T2]` | `as const [...]` |
|-----------|-------|-----------|----------------|---------------------|------------------|
| Length changes | Yes | Limited (push works at runtime) | No | No | No |
| Index shifting (splice/unshift) | Yes | Possible but uncommon | No | No | No |
| Element assignment (`arr[i] = x`) | Yes | Yes | **No** | **No** | **No** |
| `.at()` return type precision | Low (`T \| undefined`) | Low (union of all elements) | Low | Low | Low (union of literals) |
| `[i]` return type precision | Low (`T`) | **High** (per-index type) | Low | **High** | **Very High** (literal) |
| Method mutation | 10+ mutating methods | 10+ (inherited from Array) | **0** | **0** | **0** |
| Negative index soundness | Low | Medium (length mostly stable) | **High** (no Length changes) | **Perfect** | **Perfect** |
| Positive index soundness | Medium (splice shifts) | Medium-High | **High** (no mutations) | **Perfect** | **Perfect** |
| `stable[key]` value for `.at()` | Medium | Medium-High | **Very High** | **Very High** | **Very High** |
| CFA narrowing for `[i]` today | Works | Works | Works (survives calls) | Works (survives calls) | Trivial (literal types) |
| CFA narrowing for `.at()` today | None | None | None | None | None |

### 20.2 `stable[key]` Candidate Ranking

| Rank | Type | Soundness | Practical Value | Complexity | Recommendation |
|------|------|-----------|----------------|------------|----------------|
| **1** | `readonly [T1, T2, ...]` | Perfect — no mutations possible | High — `.at()` narrowing would be permanently preserved | Very Low — no mutators needed | **Phase 12 candidate** |
| **2** | `readonly T[]` | Very High — no mutations | High — `.at()` narrowing permanent | Very Low — no mutators needed | **Phase 12 candidate** |
| **3** | `[T1, T2, ...]` (mutable tuple) | Medium-High — length stable at type level, but mutations possible | Medium-High — `.at()` narrowing with mutator invalidation | Medium — need to annotate push/pop etc. as mutators | **Phase 14 candidate** |
| **4** | TypedArray (`Int32Array` etc.) | Very High — fixed length, numeric elements only | Medium — `.at()` always returns `number \| undefined` | Low — few mutating methods (`set()`, `fill()`, `copyWithin()`) | **Phase 12 candidate** |
| **5** | `T[]` (mutable array) | Low-Medium — index shifting, length changes | Medium — `.at()` narrowing with mutator invalidation | High — 10+ mutators, non-method mutations | **Phase 14+ candidate** |

### 20.3 Readonly Types: Already Implicitly "Stable"?

A key observation: **readonly types in TypeScript already behave like `stable` for property narrowing**:

```ts
function example(obj: { readonly x: string | number }) {
    if (typeof obj.x === "string") {
        someFunc();
        obj.x; // string — narrowing survives function calls!
    }
}
```

TypeScript already preserves narrowing across function calls for `readonly` properties and `const` locals because it knows they can't be reassigned.

**What `stable[key]` adds for readonly types is METHOD CALL narrowing** — `.at()`, `.get()`, etc. The property-based narrowing already works; the method-based narrowing is the gap.

For readonly arrays/tuples, adding `stable[key]` on `.at()` with NO mutators creates a **zero-invalidation scenario** — narrowing persists indefinitely. This is both:
- **Sound**: no mutations can occur
- **Maximally useful**: the narrowing is never lost

### 20.4 What About `as const`?

`as const` produces `readonly` tuples with **literal types**:

```ts
const config = { endpoint: "api", port: 3000, debug: true } as const;
// Type: { readonly endpoint: "api"; readonly port: 3000; readonly debug: true }
```

For literal types, narrowing is less needed because the types are already maximally precise. However, `as const` objects can still have union-typed properties in certain scenarios:

```ts
function getConfig() {
    return Math.random() > 0.5
        ? { status: "ok", data: "hello" } as const
        : { status: "error", message: "fail" } as const;
}
// Return type: { readonly status: "ok"; readonly data: "hello" } | { readonly status: "error"; readonly message: "fail" }
```

Here, discriminated union narrowing works on `result.status` to determine which variant. This already works with property CFA. `stable[key]` doesn't add value here because there are no method-based accessors.

## 21. TypeScript's Existing `const`/`readonly` CFA Behavior (Empirically Verified)

### 21.1 Test Results

| Scenario | Narrowed? | Survives `someFunc()` call? | Notes |
|----------|-----------|----------------------------|-------|
| `const x` (local binding) | Yes | Yes (always) | const can never be reassigned |
| `let y` (local binding) | Yes | Yes (when not captured) | TS tracks closure capture |
| `const obj.a` (const local object) | Yes | Yes | Object is const, property narrowed |
| `readonly obj.a` (readonly property) | Yes | Yes | Readonly properties preserve across calls |
| `readonly arr[0]` (readonly array) | Yes | Yes | Index access on readonly preserves |
| `Object.freeze(obj).x` | Yes | Yes | Freeze → Readonly → preserved |
| Discriminated `readonly` unions | Yes | Yes | Discrimination + readonly = stable |
| `map.get("x")` (method call) | **No** | N/A | Method call re-evaluates every time |
| `arr.at(0)` (method call) | **No** | N/A | Method call re-evaluates every time |

### 21.2 The One Gap: Method Returns

TypeScript handles `const`/`readonly` narrowing **perfectly** for:
- Local variable bindings
- Property access expressions
- Element access expressions
- Discriminated unions

The ONLY gap is **method call returns** — `.get()`, `.at()`, `.has()`, etc. This is EXACTLY what `stable[key]` addresses. The proposal fills the one remaining hole in TypeScript's const/readonly CFA story.

### 21.3 Visualization

```
                          Already Narrowable          Needs stable[key]
                          ─────────────────          ─────────────────
Property access (obj.x)        ✅                         ─
Element access (arr[0])        ✅                         ─
Local const binding            ✅                         ─
Readonly property              ✅                         ─
Method call (.get())           ❌                         ✅
Method call (.at())            ❌                         ✅
Method call (.has())           ❌                         ✅
```

## 22. Could Tuples Be "Automatically Stable"?

### 22.1 The Question

The user asks: "maybe in tuples everything is stable as it is const?"

Could tuples (or readonly tuples) automatically get `stable` narrowing on `.at()` without explicit annotations?

### 22.2 Analysis

**For `readonly` tuples/arrays**: Yes, this would be sound and require zero configuration. Since there are no mutating methods, `.at()` on readonly types could implicitly behave as `stable[key]`:

```ts
// Hypothetical: implicit stable on readonly types
// No annotation needed — readonly implies stable
const ro: readonly [string | undefined, number] = [undefined, 42];
if (ro.at(0) !== undefined) {
    ro.at(0); // string | number — automatically preserved (no mutators exist)
}
```

**Implementation approach**: The checker could detect that the receiver type is `readonly` and automatically treat `.at()` calls as stable — no `stable` keyword annotation required.

**For mutable tuples**: No, automatic stability would be unsound. Even though tuples have fixed-length types, mutable tuples allow element assignment and inherited Array methods:

```ts
const t: [string | undefined, number] = [undefined, 42];
t[0] = "hello";  // Legal — mutable element assignment
t.push("extra"); // Legal at runtime! TypeScript allows it (though type doesn't change)
```

### 22.3 Proposal: Implicit `stable` for Readonly Types

A potential enhancement proposal extending beyond explicit annotations:

```
For any type T:
  - If T is readonly (readonly property, readonly array, readonly tuple):
    - Method calls returning property-like values (get, at, etc.) could be
      implicitly treated as stable when:
      1. The receiver type has no mutating methods available
      2. The method is a "pure accessor" (deterministic for same arguments)
    - This would require a way to identify "pure accessor" methods
      (which is essentially what the `stable` keyword does)
```

**Verdict**: Implicit stability for readonly types is **theoretically sound but practically complex**. The compiler would need to determine which methods are "pure accessors" without explicit annotations. The `stable` keyword exists precisely to provide this information explicitly. However, for well-known stdlib types like `ReadonlyArray.at()` and `ReadonlyMap.get()`, the compiler could hard-code implicit stability.

### 22.4 Hard-Coded Implicit Stability for Stdlib Types

A pragmatic middle ground: instead of a general "readonly implies stable" rule, hard-code specific stdlib methods as implicitly stable:

```
// Implicit stable methods (no annotation needed):
ReadonlyArray<T>.at(index)     → stable[index]
ReadonlyMap<K,V>.get(key)      → stable[key]
ReadonlyMap<K,V>.has(key)      → stable[key]  (linked predicate)
ReadonlySet<T>.has(value)      → stable[value] (linked predicate)
```

This avoids the general inference problem while covering the highest-value use cases. Mutable variants (`Array`, `Map`, `Set`) would still need explicit annotations with corresponding `mutator` declarations.

## 23. Summary: What `stable[key]` Adds to TypeScript's Const/Readonly Story

| Feature | Without `stable[key]` | With `stable[key]` | Gain |
|---------|----------------------|---------------------|------|
| `const obj.x` narrowing | Works | Works | None |
| `readonly prop` narrowing | Works, survives calls | Works, survives calls | None |
| `arr[0]` narrowing | Works | Works | None |
| `readonly arr[0]` narrowing | Works, survives calls | Works, survives calls | None |
| `arr.at(0)` narrowing | **Doesn't work** | **Works** | **New capability** |
| `readonly arr.at(0)` narrowing | **Doesn't work** | **Works, never invalidated** | **New capability** |
| `map.get(key)` narrowing | **Doesn't work** | **Works** | **New capability** |
| `readonly map.get(key)` narrowing | **Doesn't work** | **Works, never invalidated** | **New capability** |
| Tuple `[i]` precision | Per-index types | Per-index types | None |
| Tuple `.at(i)` precision | Union of all + undefined | Union of all (narrow removes undefined) | **Partial gain** |
| Tuple `.at(i)` + checker fix | Union of all + undefined | Per-index type + undefined, then narrowed | **Full gain** |

**Bottom line**: `stable[key]` fills the **method call gap** in TypeScript's const/readonly narrowing. For readonly types specifically, it provides **zero-cost permanent narrowing** because no mutators exist to invalidate it.
