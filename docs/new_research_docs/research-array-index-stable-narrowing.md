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
