# Research: `invalidates` Naming & Dual Semantics Analysis

**Status:** For review  
**Date:** 2025  
**Context:** Evaluating whether `invalidates` is the right keyword for the clause that both resets and narrows stable endpoint types

---

## 1. The Dual Nature of `invalidates`

The `invalidates` clause does NOT just invalidate. It has a **two-phase behavior**:

### Phase 1: Attempt Post-Call Narrowing (via argument type)
When a mutator call has arguments AND the declared type is a union, the system calls `getAssignmentReducedType(declaredType, argType)` to filter the declared union to constituents assignable from the argument type. This is **narrowing**, not invalidation.

```ts
interface Signal<T> {
    read: stable () => T;
    set: mutator (value: T) => void invalidates read;
}

declare const count: Signal<number | undefined>;
count.set(42);
const n: number = count.read();  // ← NARROWED to number, not "invalidated"!
```

### Phase 2: Fallback to Invalidation (reset to declared type)
Only if narrowing is not possible (no arguments, non-union declared type, or argument type is same width as declared type) does it fall back to resetting narrowing:

```ts
interface Store {
    stable getValue(): string | undefined;
    mutator reset(): void invalidates getValue;
}

store.reset();  // ← No args → falls back to true invalidation (reset to string | undefined)
```

### Decision Tree

```
Has arguments?
├── NO → INVALIDATE (reset to declared type)
└── YES
    ├── Is declared type a union?
    │   ├── NO → INVALIDATE
    │   └── YES
    │       ├── Is getAssignmentReducedType(declared, argType) ≠ declared?
    │       │   ├── YES → NARROW to reduced type
    │       │   └── NO → INVALIDATE (arg is same width)
```

### Concrete Behavior Examples

| Call | Declared Type | Behavior | Result |
|------|--------------|----------|--------|
| `count.set(42)` | `number \| undefined` | **NARROWS** | `number` |
| `mixed.set("hello")` | `string \| number \| undefined` | **NARROWS** | `string` |
| `lit.set("a")` | `"a" \| "b" \| "c"` | **NARROWS** | `"a"` |
| `setValue("world")` | `string \| undefined` | **NARROWS** (cross-binding) | `string` |
| `store.reset()` | `string \| undefined` | **INVALIDATES** (no args) | `string \| undefined` |
| `clearVal()` | `string \| undefined` | **INVALIDATES** (no args) | `string \| undefined` |

The name `invalidates` accurately describes only ~50% of its behavior.

---

## 2. Full Syntax Inventory Where `invalidates` Appears

| Syntax | Location | Semantics |
|--------|----------|-----------|
| `invalidates targetName` | Function type, method sig/decl | Single target invalidation/narrowing |
| `invalidates t1, t2` | Function type, method sig/decl | Multi-target |
| `invalidates get[key]` | Function type, method sig/decl | Per-key: only matching key arguments affected |
| Without `invalidates` | `mutator` without clause | Conservative: invalidates ALL stable endpoints on receiver |

### Per-Key Detail
`invalidates get[key]` is exclusively an `invalidates`-clause feature. The `[key]` references a MUTATOR parameter name, resolved to a positional index for argument comparison. This means per-key semantics are syntactically tied to `invalidates`, not to `mutator`.

### Cross-Binding Detail
In tuple types like SolidJS `createSignal`, the `invalidates read` clause references the tuple LABEL name, enabling cross-binding between destructured variables:
```ts
type Signal<T> = [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read  // ← targets tuple label
];
```

---

## 3. `mutator` + `invalidates` vs Hypothetical `mutates`

### Current Approach: Two Keywords

```ts
interface Store {
    stable user(): User | undefined;
    mutator setUser(v: User): void invalidates user;
}
```

- `mutator` = modifier on the function ("I am a mutator")
- `invalidates` = clause naming targets ("I affect these specific endpoints")

### Hypothetical `mutates` Approach: Single Keyword

```ts
interface Store {
    stable user(): User | undefined;
    setUser(v: User): void mutates user;
}
```

- No function-level modifier
- `mutates` = combined "I am a mutator AND I affect these targets"

### Comparison Table

| Aspect | `mutator` + `invalidates` | `mutates` only |
|--------|--------------------------|----------------|
| **Mutator without targets** | `mutator reset(): void` — conservatively invalidates all | `reset(): void mutates ???` — needs syntax for "all" (wildcard?) |
| **Standalone mutator marker** | ✅ `SignatureFlagsMutator` propagates through type system | ❌ No function-level flag unless derived from `mutates` presence |
| **Per-key** | `invalidates get[key]` | `mutates get[key]` — works similarly |
| **Cross-binding tuples** | `mutator (v: T) => void invalidates read` | `(v: T) => void mutates read` — loses explicit mutator marker |
| **Heuristic detection** | `SignatureFlagsMutator` enables CFA boundary detection | Would need to infer mutator status from `mutates` clause |
| **Keyword count** | 2 keywords (more verbose) | 1 keyword (simpler) |
| **Tautology** | No — modifier and clause are independent | No — single combined meaning |
| **"I am a mutator" without specifying targets** | ✅ Natural: `mutator reset(): void` | ❌ Awkward: `reset(): void mutates` (no targets?) |

### Critical Issue: Mutators Without Explicit Targets

The current `mutator` modifier has standalone value:
```ts
// This is valid and useful — conservatively invalidates ALL stable endpoints
mutator function clearCache(): void { ... }
```

With `mutates` only:
```ts
// What does this mean? Which targets?
function clearCache(): void mutates { ... }  // ❌ No target — grammatically incomplete
function clearCache(): void mutates *        // ❌ Needs wildcard syntax
function clearCache(): void mutates all      // ❌ New keyword
```

### Verdict on `mutates` vs `mutator` + `invalidates`

The `mutator` modifier has **independent semantic value** beyond the `invalidates` clause:
1. It marks functions as mutation boundaries for CFA
2. It enables conservate invalidation without explicit targets
3. It propagates through `SignatureFlagsPropagatingFlags`
4. It participates in heuristic boundary classification

Replacing both with `mutates` would lose the independent mutator marker. The two-keyword approach is more expressive.

---

## 4. Naming Alternatives for `invalidates`

Since `invalidates` both invalidates AND narrows, is there a better name?

### Candidates

| Keyword | Reads as... | Invalidation ✓ | Narrowing ✓ | Per-key ✓ | Tautology with `mutator`? |
|---------|-------------|----------------|-------------|-----------|--------------------------|
| `invalidates` | "invalidates user" | ✅ Accurate | ❌ Misleading | ✅ `invalidates get[key]` | No |
| `updates` | "updates user" | ✅ Neutral | ✅ "updates type info" | ✅ `updates get[key]` | No |
| `affects` | "affects user" | ✅ General | ✅ General | ✅ `affects get[key]` | No |
| `links` | "links user" | ⚠️ Passive | ⚠️ Passive | ⚠️ `links get[key]` | No |
| `modifies` | "modifies user" | ✅ State change | ✅ State change | ✅ `modifies get[key]` | ⚠️ Slight |
| `mutates` (clause)| "mutates user" | ✅ Mutation | ✅ Mutation | ✅ `mutates get[key]` | ❌ `mutator ... mutates` is tautological |
| `targets` | "targets user" | ✅ Directional | ✅ Directional | ✅ `targets get[key]` | No |
| `resets` | "resets user" | ✅ Accurate | ❌ Inaccurate | ✅ `resets get[key]` | No |
| `changes` | "changes user" | ✅ Neutral | ✅ Neutral | ✅ `changes get[key]` | No |

### Read-In-Context Test

```ts
// Current
mutator setUser(v: User): void invalidates user;

// Alternatives
mutator setUser(v: User): void updates user;       // ← Best: neutral, covers both behaviors
mutator setUser(v: User): void affects user;        // ← Too vague
mutator setUser(v: User): void targets user;        // ← Directional, but "targets" sounds aggressive
mutator setUser(v: User): void modifies user;       // ← Good, slightly redundant with mutator
mutator setUser(v: User): void changes user;        // ← Neutral, casual
mutator setUser(v: User): void links user;          // ← Passive, doesn't convey action
```

With per-key:
```ts
mutator set(key: K, value: V): void invalidates get[key];
mutator set(key: K, value: V): void updates get[key];      // ← Reads naturally
mutator set(key: K, value: V): void affects get[key];       // ← OK
```

With multi-target:
```ts
mutator reset(): void invalidates getValue, getLabel;
mutator reset(): void updates getValue, getLabel;           // ← "updates getValue and getLabel" ✅
```

### Recommendation

**`updates`** is the strongest alternative:
- Neutral enough to cover both invalidation and narrowing
- No tautology with `mutator`
- Reads naturally: "mutator setUser updates user"
- Per-key: "updates get[key]" reads naturally
- Multi-target: "updates getValue, getLabel" reads naturally

**However**, `invalidates` has a **specific advantage**: it communicates that **existing narrowing is lost**, which is the primary mental model users need. The narrowing behavior is a refinement that doesn't need to be communicated by the keyword name — it's a "bonus" optimization.

---

## 5. Open Questions for TS Team Review

1. **Is the dual behavior (invalidation + narrowing) desirable?** The post-call narrowing via argument types is powerful but may be surprising. Should it be opt-in?

2. **Should we rename `invalidates` to `updates`?** The dual semantics make `invalidates` technically misleading, but its primacy in communicating "narrowing is lost" may outweigh precision.

3. **Is the `mutator` modifier independently valuable enough to justify two keywords?** If we only had `mutates`, would the standalone mutator marker be missed?

4. **Per-key syntax: is `invalidates get[key]` clear enough?** The `[key]` referencing a mutator parameter name (not the stable's key parameter) may be confusing.

5. **Should `invalidates` and `updates` be aliases?** Accept both, with one being canonical?

---

## 6. Summary

| Aspect | Finding |
|--------|---------|
| **`invalidates` accuracy** | ~50% — accurate for reset, misleading for narrowing |
| **Best alternative name** | `updates` — neutral, covers both behaviors |
| **`mutator` + `invalidates` vs `mutates`** | Two keywords preferred — `mutator` has independent value |
| **Per-key tied to `invalidates`** | Yes — `[key]` is exclusively an invalidates-clause feature |
| **Recommendation** | Keep `mutator` + consider renaming `invalidates` to `updates` |
