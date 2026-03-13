# Research: Post-Call Narrowing Beyond Simple Invalidation

## Document Control
- Status: Research Draft
- Scope: Extension of `invalidates` clause to support post-call type narrowing
- Related: Phase 12 (Standard Library Annotations), Phase 9 (Keyed Linked Predicates)

## 1. Problem Statement

The current `invalidates` clause resets stable narrowing to the **declared type**. For `Map<K, V>`:

```ts
interface Map<K, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    mutator delete(key: K): boolean invalidates get[key], has[key];
    mutator set(key: K, value: V): this invalidates get[key], has[key];
}
```

After `map.delete("x")`, `get("x")` resets to `V | undefined`. But we **know** the key was removed — the correct type is `undefined`, not `V | undefined`. Similarly, after `map.set("x", 42)`, `get("x")` should be `V` (not `V | undefined`), because we know the key exists.

**Key question**: Should `invalidates` be extended with a post-narrowing target, so that the stable endpoint is narrowed to a *specific type* after the mutator call, rather than just reset to the declared type?

## 2. Current Post-Call Narrowing Mechanism

The existing `getMutatorCallNarrowedType` in `flow.go` narrows using argument-type propagation:

1. After a mutator call, extract the first argument's type
2. Use `getAssignmentReducedType(declaredType, argType)` to narrow
3. If narrower than declared, apply as post-call type

This works for `set(42)` → `read()` narrowed from `number | undefined` to `number` (for non-keyed signals). But it has limitations:

- For `delete(key)`: The argument is the **key** (`K`), not `undefined`. Can't use it.
- For `set(key, value)`: The value is `Arguments()[1]`, not `[0]`. Hardcoded index wrong.
- For `clear()`: No arguments at all—post-state is fixed (`undefined` for all keys).

## 3. Semantic Correctness Analysis

### 3.1 Post-Delete Narrowing

After `map.delete("x")` in single-threaded synchronous flow:
- `map.get("x")` returns `undefined` — guaranteed by ECMA-262 §24.1.3.3
- `map.has("x")` returns `false` — guaranteed by spec

**Soundness**: Yes, under the same conditions that make `stable` sound:
- No concurrent mutation (JS is single-threaded)
- No mutation through aliases (CFA's existing alias-escape analysis applies)
- Not a Proxy (same caveat as all stable narrowing)

### 3.2 Post-Set Narrowing

After `map.set("x", 42)`:
- `map.get("x")` returns `42` — guaranteed by ECMA-262 §24.1.3.9
- `map.has("x")` returns `true` — entry now exists

**Soundness**: Yes. The entry is guaranteed to exist after `set()` completes.

### 3.3 Post-Clear Narrowing

After `map.clear()`:
- ALL `map.get(anyKey)` return `undefined`
- ALL `map.has(anyKey)` return `false`

**Soundness**: Yes. All entries removed.

### 3.4 WeakMap: Still Sound

WeakMap entries can be GC'd, but:
- After `weakMap.delete(key)` — deterministic removal, same as Map
- After `weakMap.set(key, value)` — `key` is still reachable (was just passed), so GC can't collect it between `set` and the next read
- `stable[key]` already handles uncertainty boundaries (await, callbacks) where GC could intervene

### 3.5 Proxy/Subclass Concern

A `Map` subclass could override `delete()` to not actually delete. This is the same trust model as `stable` generally — TypeScript trusts type annotations. A lying implementation is a user error, same as `x: string` being actually a `number`.

## 4. Design Approaches

### Approach A: `invalidates ... = <type-or-param>` (Recommended)

Extend the existing `invalidates` clause with a post-narrowing target:

```ts
interface Map<K, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    mutator set(key: K, value: V): this 
        invalidates get[key] = value, has[key] = true;
    mutator delete(key: K): boolean 
        invalidates get[key] = undefined, has[key] = false;
    mutator clear(): void;  // unkeyed → resets ALL to declared type
}
```

Where `= <expr>` is either:
- A **parameter name** (e.g., `= value`) — narrows to that parameter's type
- A **type keyword** (`= undefined`, `= null`, `= true`, `= false`, `= never`) — narrows to that literal type

**Pros**: Minimal syntax extension. Builds on existing `invalidates`. Parameter references subsume current argument-type propagation. General-purpose.

**Cons**: Introduces mini-expression in type position. Parameter references need resolution.

### Approach B: Semantic Verbs (`removes` / `ensures`)

```ts
mutator delete(key: K): boolean removes get[key], has[key];
mutator set(key: K, value: V): this ensures get[key], has[key];
```

Where:
- `removes` = invalidates + narrows get to `undefined` + narrows has to `false`
- `ensures` = invalidates + narrows get to `V` (removes `| undefined`) + narrows has to `true`

**Pros**: Intuitive, reads naturally. Simple for the common case.

**Cons**: Not generalizable — semantics hardcoded per-shape. What does `removes` mean for a non-Map type?

### Approach C: Explicit `narrows` Clause

```ts
mutator delete(key: K): boolean 
    invalidates get[key] narrows undefined,
    invalidates has[key] narrows false;
```

**Pros**: Maximum expressiveness.

**Cons**: Verbose. `narrows` is a new keyword. Complex syntax.

### Approach D: No New Syntax — Just Invalidation

Keep `invalidates` as-is. Accept the imprecision.

**Pros**: Zero additional complexity.

**Cons**: Misses a real opportunity—especially for `set` → `get` (eliminates `!` assertions).

### Recommendation

**Approach A** is the most principled. It's the smallest syntax extension that provides the most value, and it cleanly subsumes the existing first-argument post-call narrowing mechanism.

## 5. `delete` Return Value: Should It Narrow?

`Map.delete()` returns `boolean`:
- `true` → the key existed before deletion
- `false` → the key wasn't there

This is a "past-tense" narrowing — it tells you about state *before* the call, not after. In **both** branches (existed or not), the post-state is "key absent":
- `get("x")` → `undefined` regardless
- `has("x")` → `false` regardless

The return value **does not add narrowing value** for the stable system. It could theoretically be modeled as a conditional narrowing of the pre-call state, but TypeScript generally doesn't track "state before this call."

However, there is one subtle point: if `delete` returns `false`, the `get("x")` was *already* `undefined` before the call. Combined with a linked predicate (`has(key): this.get(key) is V`), this means the pre-delete type was already `undefined`. But this is captured by whether narrowing was active before the delete, not by the return value itself.

## 6. `if (map.has("x"))` After Delete: Dead Code Detection

```ts
map.delete("x");
if (map.has("x")) {
    // If has("x") is narrowed to literal false, this is dead code
    // TypeScript's unreachable code detection would flag this
}
```

**Concern**: False-positive unreachable code warnings if the narrowing persists incorrectly. For example, if un-annotated code re-adds the key between delete and has, narrowing would incorrectly flag the `if` as dead.

**Mitigation**: The keyed invalidation system already handles this — any `set("x", ...)` between delete and has would reset the key's narrowing. Un-annotated mutations that bypass the `mutator` system are the general trust-model gap (same as forgetting `mutator` on any state-changing method).

## 7. Standard Library Annotation Catalog

### 7.1 Map<K, V> — Full Annotation

```ts
interface Map<K, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    has<K2 extends K>(key: K2): this.get(key) is V;  // linked predicate
    mutator set(key: K, value: V): this 
        invalidates get[key] = value, has[key] = true;
    mutator delete(key: K): boolean 
        invalidates get[key] = undefined, has[key] = false;
    mutator clear(): void;  // unkeyed → resets ALL
}
```

### 7.2 Set<T>

```ts
interface Set<T> {
    stable[value] has(value: T): boolean;
    mutator add(value: T): this invalidates has[value] = true;
    mutator delete(value: T): boolean invalidates has[value] = false;
    mutator clear(): void;
}
```

### 7.3 WeakMap<K, V>

```ts
interface WeakMap<K extends WeakKey, V> {
    stable[key] get(key: K): V | undefined;
    stable[key] has(key: K): boolean;
    mutator set(key: K, value: V): this 
        invalidates get[key] = value, has[key] = true;
    mutator delete(key: K): boolean 
        invalidates get[key] = undefined, has[key] = false;
}
```

### 7.4 WeakSet<T>

```ts
interface WeakSet<T extends WeakKey> {
    stable[value] has(value: T): boolean;
    mutator add(value: T): this invalidates has[value] = true;
    mutator delete(value: T): boolean invalidates has[value] = false;
}
```

### 7.5 WeakRef<T>

```ts
interface WeakRef<T extends WeakKey> {
    stable deref(): T | undefined;
    // No mutator methods — only GC can invalidate
    // GC is an uncertainty boundary, not a mutator call
}
```

### 7.6 DOM: Element Attributes

```ts
interface Element {
    stable[qualifiedName] getAttribute(qualifiedName: string): string | null;
    stable[qualifiedName] hasAttribute(qualifiedName: string): boolean;
    hasAttribute(name: string): this.getAttribute(name) is string;  // linked predicate
    mutator setAttribute(qualifiedName: string, value: string): void 
        invalidates getAttribute[qualifiedName] = string, hasAttribute[qualifiedName] = true;
    mutator removeAttribute(qualifiedName: string): void 
        invalidates getAttribute[qualifiedName] = null, hasAttribute[qualifiedName] = false;
}
```

### 7.7 DOM: DOMTokenList (classList)

```ts
interface DOMTokenList {
    stable[token] contains(token: string): boolean;
    mutator add(...tokens: string[]): void;   
        // Challenge: variadic keyed invalidation
        // invalidates contains[each token] = true — not expressible with current syntax
    mutator remove(...tokens: string[]): void;
        // invalidates contains[each token] = false
    mutator toggle(token: string, force?: boolean): boolean;
        // toggle with force=true → contains = true
        // toggle with force=false → contains = false
        // toggle without force → just invalidates (direction unknown)
    mutator replace(oldToken: string, newToken: string): boolean 
        invalidates contains[oldToken] = false, contains[newToken] = true;
}
```

**Note**: Variadic methods (`add(...tokens)`) would need the `invalidates` clause to apply per-argument, which is a syntax extension beyond current design.

### 7.8 URLSearchParams

```ts
interface URLSearchParams {
    stable[name] get(name: string): string | null;
    stable[name] has(name: string): boolean;
    mutator set(name: string, value: string): void 
        invalidates get[name], has[name] = true;
    mutator append(name: string, value: string): void 
        invalidates has[name] = true;
    mutator delete(name: string): void 
        invalidates get[name] = null, has[name] = false;
}
```

### 7.9 Storage (localStorage/sessionStorage)

```ts
interface Storage {
    stable[key] getItem(key: string): string | null;
    mutator setItem(key: string, value: string): void 
        invalidates getItem[key] = string;
    mutator removeItem(key: string): void 
        invalidates getItem[key] = null;
    mutator clear(): void;  // unkeyed → all keys reset
}
```

### 7.10 Headers (Fetch API)

```ts
interface Headers {
    stable[name] get(name: string): string | null;
    stable[name] has(name: string): boolean;
    mutator set(name: string, value: string): void 
        invalidates get[name], has[name] = true;
    mutator delete(name: string): void 
        invalidates get[name] = null, has[name] = false;
}
```

### 7.11 FormData

```ts
interface FormData {
    stable[name] get(name: string): FormDataEntryValue | null;
    stable[name] has(name: string): boolean;
    mutator set(name: string, value: string | Blob): void 
        invalidates get[name], has[name] = true;
    mutator delete(name: string): void 
        invalidates get[name] = null, has[name] = false;
}
```

### 7.12 Array<T> — NOT a Good Candidate

Arrays are **not suitable** for keyed stable narrowing because:
- Indices shift on mutation (`splice`, `unshift`, `shift`)
- `push`/`pop` change length—no single key correlation
- `includes(x)` and `indexOf(x)` scan the whole array, not keyed
- Per-index keyed stable is **unsound** because mutations rearrange indices

The only useful Array pattern would be `push(42); includes(42)` → `true`, which is trivial.

## 8. TypeScript Precedent Analysis

| Mechanism | What It Does | Analogy |
|-----------|-------------|---------|
| **Type predicates** (`x is T`) | Conditional narrowing | `has(key)` → `get(key) is V` (linked predicates) |
| **Assertion functions** (`asserts x is T`) | Unconditional post-call narrowing | `delete(key)` → `get(key) is undefined` |
| **Assignment narrowing** | `x = "hello"` narrows `x` | `set(key, value)` narrows `get(key)` |
| **`delete` operator** | TypeScript does NOT narrow after `delete obj.x` | **Precedent gap** — TS misses this narrowing |
| **Discriminated unions** | One value constrains another | `has(key) === true` constrains `get(key)` type |

**Closest precedent**: Assertion functions. `delete(key)` is like `asserts get(key) is undefined` — an unconditional post-call narrowing to a specific type.

## 9. Practical Value Assessment

| Operation | Value | Frequency | Pain Point |
|-----------|-------|-----------|------------|
| `set` → `get` narrows to `V` | **High** | Very common | Eliminates `!` assertions |
| `delete` → `get` narrows to `undefined` | **Medium** | Moderate | Informational |
| `delete` → `has` narrows to `false` | **Low** | Rare | Dead code detection |
| `clear` → everything reset | **Low** | Rare | Edge case |
| `add` → `has` narrows to `true` (Set) | **Medium** | Moderate | Similar to set→get |

**The high-value target is `set` → `get` narrowing.** This eliminates the common `map.get(key)!` pattern (non-null assertion after a known `set`).

## 10. Implementation Complexity Estimate

### With `invalidates ... = ...` syntax (Approach A):

**Parser**: ~20 LOC — parse `= <TypeOrParamRef>` after each invalidates target
**Checker**: ~50 LOC — resolve parameter references to argument types, resolve type keywords to literal types, apply as post-call narrowed type instead of argument-type reduction
**Flow**: ~30 LOC — extend `getMutatorCallNarrowedType` to check invalidates clause targets for post-narrowing annotations

**Total**: ~100 LOC, low complexity.

### Dependencies:
- Requires Phase 9 keyed invalidation (already implemented)
- Requires argument-index resolution for `= paramName` references (new)

## 11. Open Questions

1. **Syntax bikeshed**: `invalidates get[key] = value` vs `invalidates get[key] to value` vs `invalidates get[key] as value`?
2. **Should `clear()` narrowing be unkeyed?**: `clear()` affects ALL keys, so `invalidates get = undefined` would need to be the syntax. But does unkeyed + post-narrowing make sense?
3. **Variadic keyed invalidation**: How to express `add(...tokens)` invalidating `contains[each token]`? This is a new concept.
4. **Type vs parameter reference ambiguity**: In `invalidates get[key] = value`, is `value` a parameter name or the literal type? Need resolution rules (parameter names take priority?).
5. **Should this be Phase 12 or a separate Phase 13?**: Post-call narrowing extension is orthogonal to stdlib annotation — could be a separate phase.

## 12. Conclusion

**Simple invalidation is good enough for Phase 12's initial stdlib annotations.** The `invalidates` clause already provides significant value by enabling keyed narrowing through `has()`/`get()` patterns.

**Post-call narrowing extension (`invalidates ... = ...`) should be a separate, later phase.** It's a clean, minimal syntax extension with high practical value for `set` → `get` narrowing (eliminates `!` assertions). The `delete` → `get` narrowing to `undefined` is sound and useful but lower priority.

**Recommended phasing:**
1. Phase 12: Stdlib annotations with simple `invalidates` (keyed)  
2. Phase 13 (new): `invalidates ... = <type-or-param>` post-call narrowing extension
3. Phase 14 (new): Variadic keyed invalidation for `DOMTokenList.add(...tokens)`
