# Design Review #19: Alternative Syntax for Identity/Mutator/Links

**Status:** Proposal  
**Date:** 2026-03-11  
**Scope:** Evaluate alternative keyword/syntax designs for the `identity`/`mutator`/`links` system

---

## Current System (Baseline)

```typescript
interface Store {
    read: identity () => string | undefined;
    write: mutator (v: string) => void links read;
    reset: mutator () => void;
}
```

**Keywords:** `identity` (stable read), `mutator` (invalidating write), `links` (explicit invalidation targets).

**Known concerns:**
- `identity` is overloaded (mathematical identity, identity function, object identity) — not self-documenting for "stable read"
- `mutator` is clear but verbose
- `links` is ambiguous — could mean "relates to" rather than "invalidates"
- Three keywords to learn for a single concept pair

---

## Alternative #1: `stable` / `invalidates`

```typescript
interface Store {
    read: stable () => string | undefined;
    write: invalidates read (v: string) => void;
    reset: invalidates () => void;
}
```

**Pros:**
- `stable` immediately communicates "this won't change" — the primary intent
- `invalidates` is precise and unambiguous about what the mutator does
- No separate `links` clause needed — `invalidates X` absorbs it
- Low learning curve; reads like English prose

**Cons:**
- `invalidates` is long (11 chars) and could feel heavy for simple cases
- `invalidates () => void` (no targets) reads awkwardly — "invalidates what?"
- Grammatically, `invalidates read` could parse as "this function invalidates the `read` property" or "this is an invalidates-read function" (two readings)

**Verdict:** Strong contender. The clarity of `stable` alone is a significant upgrade. The main weakness is the no-target `invalidates` case.

---

## Alternative #2: `pure` / `impure`

```typescript
interface Store {
    read: pure () => string | undefined;
    write: impure (v: string) => void links read;
    reset: impure () => void;
}
```

**Pros:**
- Familiar to FP-oriented developers
- `pure` is concise and well-understood
- Clear semantic opposition — pure/impure is a well-established dichotomy

**Cons:**
- `pure` in FP means "no side effects at all" — but a property read may still access mutable state; it's only stable *identity-wise*, not truly pure
- `impure` carries negative connotations ("dirty", "bad") — but mutation is perfectly valid
- Still needs `links` (or equivalent) for explicit targets — `impure` alone doesn't express *what* is invalidated
- Misleading for developers who know FP purity semantics

**Verdict:** Weak. The semantic mismatch with established FP terminology would cause more confusion than it solves.

---

## Alternative #3: `get` / `set` Modifiers on Function Types

```typescript
interface Store {
    read: get () => string | undefined;
    write: set (v: string) => void links read;
    reset: set () => void;
}
```

**Pros:**
- Leverages existing `get`/`set` mental model from accessors
- Very concise
- Developers already associate `get` with "read" and `set` with "write/mutate"

**Cons:**
- `get`/`set` already have specific meaning in TypeScript (accessor declarations) — reusing them on function *types* is confusing
- `get () => T` looks like a getter returning a function, not a function type modifier
- `set () => void` (no-arg reset) doesn't make semantic sense — "set" implies setting *something*
- Doesn't naturally accommodate the `links` clause — `set (v) => void links read` reads as "set... links read?"
- Parser ambiguity with existing accessor syntax in interfaces

**Verdict:** Reject. Too much collision with existing `get`/`set` accessor semantics.

---

## Alternative #4: `readonly` on Function Types

```typescript
interface Store {
    read: readonly () => string | undefined;
    write: (v: string) => void links read;
    reset: () => void;
}
```

**Pros:**
- `readonly` is already in TypeScript — zero new keywords
- Conceptually apt: "this function type is read-only / non-mutating"
- Asymmetric: only mark the special case (reads), mutations are the unmarked default+

**Cons:**
- `readonly` on a function type is a novel usage — currently `readonly` applies to properties and arrays, not function signatures
- Confusingly close to `readonly read: () => string` (readonly property) vs `read: readonly () => string` (readonly function type) — very subtle positional difference
- Doesn't help with the `links` clause at all
- Default-mutating is dangerous: an unmarked function silently invalidates everything? That inverts the safety expectation

**Verdict:** Weak. The positional ambiguity with existing `readonly` on properties is too high-risk.

---

## Alternative #5: `@stable` / `@mutates` Decorators

```typescript
interface Store {
    @stable
    read: () => string | undefined;
    
    @mutates("read")
    write: (v: string) => void;
    
    @mutates()
    reset: () => void;
}
```

**Pros:**
- Decorators are already in TypeScript (stage 3) — users understand the pattern
- Clean separation: the annotation is visually distinct from the type signature
- `@mutates("read")` naturally encodes the link target as an argument
- Extensible — could add more decorator options later

**Cons:**
- Decorators are *runtime* constructs in TC39 — using them as *type-level* annotations is a semantic mismatch
- Interface members cannot have decorators in current TypeScript — this would require a spec extension
- Decorator arguments are expressions, not identifier references — `"read"` is a string, not a checked symbol reference (loses type safety)
- Adds runtime metadata weight if decorators are actually emitted
- Doesn't work in type aliases: `type Fn = @stable () => T` is not valid syntax

**Verdict:** Reject. Decorators are fundamentally runtime-oriented; using them for compile-time type annotations fights the existing semantics.

---

## Alternative #6: Tagged Return Types

```typescript
interface Store {
    read: () => stable string | undefined;
    write: (v: string) => mutable void links read;
    reset: () => mutable void;
}
```

**Pros:**
- Reads naturally: "returns a stable string"
- Keeps the function signature structure familiar — modifier is near the return type

**Cons:**
- `stable string | undefined` — does `stable` apply to `string`, to `string | undefined`, or to the function? Ambiguous precedence
- `mutable void` is semantically odd — void isn't mutable, the *call* is mutating
- Modifier placement after `=>` is unprecedented in TypeScript
- Parser complexity: the return type position already has complex grammar (unions, intersections, conditionals)
- The modifier describes the *function's behavior*, not the *return type's nature* — putting it on the return type is categorically wrong

**Verdict:** Reject. Misplaces the semantic annotation (function behavior vs. return type quality).

---

## Alternative #7: Single Keyword (`stable` Only)

```typescript
interface Store {
    read: stable () => string | undefined;
    write: (v: string) => void links read;
    reset: () => void;
}
```

Rules: `stable` marks non-mutating reads. Any non-`stable` function is implicitly a mutator. `links` is optional to restrict invalidation scope.

**Pros:**
- Minimal keyword surface — only one new keyword
- Asymmetric design: the uncommon case (stable identity) is marked, the common case (mutation) is default
- Less syntax to learn

**Cons:**
- Unmarked functions are silently treated as mutators — is that safe? A forgotten `stable` causes false invalidations
- No visual signal that a function *is* a mutator — makes code review harder ("is this intentionally unmarked, or did they forget `stable`?")
- The "mutation is default" assumption may not match real-world interfaces where reads outnumber writes
- `links` clause floats without a corresponding keyword — `(v: string) => void links read` has no keyword anchor

**Verdict:** Interesting but risky. The "mutation by default" assumption needs validation against real-world interface shapes. If reads dominate, marking every read is noisy.

---

## Alternative #8: `reads` / `writes` Effect Style

```typescript
interface Store {
    read: () => reads string | undefined;
    write: (v: string) => writes void targets read;
    reset: () => writes void;
}
```

**Pros:**
- Effect-system terminology is well-established in PL research (Koka, Eff, etc.)
- `reads`/`writes` are intuitive verbs
- `targets read` is clearer than `links read` for expressing invalidation
- Consistent verbal style: reads, writes, targets

**Cons:**
- Same return-type-position problem as Alternative #6 — `reads string` is ambiguous
- `writes void` is semantically wrong — the function writes to *state*, not to void
- Effect systems are niche knowledge — most TypeScript developers won't connect to the PL theory
- Three keywords (reads, writes, targets) is the same count as the current system

**Verdict:** Weak. Inherits the return-type-position problem and doesn't reduce complexity.

---

## Alternative #9: Branded/Nominal Types

```typescript
type StableRead<T> = () => T;
type Mutator<Args extends any[], Targets extends string = never> = (...args: Args) => void;

interface Store {
    read: StableRead<string | undefined>;
    write: Mutator<[string], "read">;
    reset: Mutator<[]>;
}
```

**Pros:**
- No new syntax — uses existing TypeScript type system
- Fully expressible in current TypeScript (in theory)
- Library-level solution — no compiler changes needed

**Cons:**
- Loses the function-type syntax entirely — `StableRead<string | undefined>` doesn't look like a callable
- `Mutator<[string], "read">` encodes link targets as string literals — no type-checked references
- Not ergonomic for complex signatures (multiple params, overloads, generics)
- Requires importing utility types everywhere
- Doesn't integrate with the compiler's identity tracking — it's just cosmetic types without semantic backing

**Verdict:** Reject. This is a workaround, not a language feature. No compiler-level semantics.

---

## Alternative #10: `signal` / `action`

```typescript
interface Store {
    read: signal () => string | undefined;
    write: action (v: string) => void links read;
    reset: action () => void;
}
```

**Pros:**
- Familiar to developers using Solid, MobX, Vuex, Redux — "signal" and "action" are well-known in reactivity
- `signal` communicates "observable, trackable value"
- `action` communicates "something that causes change"
- Short, memorable keywords

**Cons:**
- Overloaded with framework-specific meaning — Solid's `signal` is a getter/setter pair, MobX's `action` wraps a function, Redux's `action` is a plain object. None match this usage exactly.
- `signal` implies push-based reactivity, but `identity` is about reference stability, not reactivity
- Ties the language feature to a specific paradigm (reactivity) when the feature is more general (identity stability)
- `signal () => T` looks like you're declaring a signal, not annotating a function type

**Verdict:** Weak. Too tied to specific framework semantics that don't precisely match. Would confuse users of those frameworks.

---

## Alternative #11: `observe` / `mutate`

```typescript
interface Store {
    read: observe () => string | undefined;
    write: mutate (v: string) => void links read;
    reset: mutate () => void;
}
```

**Pros:**
- Action-oriented verbs describe *what the caller does*: "when you call this, you observe" / "when you call this, you mutate"
- `mutate` is shorter than `mutator` (6 vs 7 chars) and is a verb (consistent with `observe`)
- Clear semantic pairing

**Cons:**
- `observe` implies watching for changes over time (like an Observable) — but this is a one-shot read
- `observe () => string` reads as "observe a function returning string" — grammatically awkward
- `mutate` vs `mutator` — very close to the current system, marginal improvement
- Still needs `links` clause separately

**Verdict:** Marginal. `observe` is misleading (implies subscription semantics). `mutate` is only a minor improvement over `mutator`.

---

## Alternative #12: `const` on Function Types

```typescript
interface Store {
    read: const () => string | undefined;
    write: (v: string) => void links read;
    reset: () => void;
}
```

Inspired by C++ `const` member functions.

**Pros:**
- `const` is already a TypeScript keyword — no new reserved word
- C++ developers immediately understand: "this function doesn't modify state"
- Concise, single-keyword design (like Alternative #7)
- `const` already has "immutability" connotations in JS/TS (`const x = 5`)

**Cons:**
- `const` in JS/TS means "binding immutability", not "function purity" — semantic stretch
- `const () => T` could be confused with `const` assertions or `as const`
- Parser ambiguity: `const` already starts declarations — `const () =>` could look like the beginning of `const fn = () =>`
- Same "mutation by default" issue as Alternative #7
- Doesn't address the `links` clause

**Verdict:** Tempting but problematic. The parser ambiguity and semantic overload of `const` make this risky despite the appeal.

---

## Alternative #13: Inversion — Only Mark Mutators

```typescript
interface Store {
    read: () => string | undefined;
    write: mutator (v: string) => void links read;
    reset: mutator () => void;
}
```

Rules: Unmarked functions are assumed stable (identity-preserving). Only `mutator` is needed.

**Pros:**
- Minimal new syntax — one keyword (`mutator`)
- The common case (reads) requires no annotation
- "Stable by default" is the safe default — you opt *in* to mutation
- Less visual noise for read-heavy interfaces

**Cons:**
- Forgetting `mutator` silently makes a writing function appear stable — dangerous false safety
- No way to *explicitly* mark a function as stable (for documentation/clarity)
- Breaks the principle of explicit annotation for important semantic properties
- In practice, many functions are neither purely stable nor purely mutating — the binary is too coarse without an explicit opt-in for both sides

**Verdict:** Interesting. "Stable by default" is arguably the right safety posture. But the lack of explicit `stable` marking reduces self-documentation. Could be improved by allowing an optional `stable` annotation for clarity.

---

## Alternative #14: `affects` / `targets` for Link Clauses

This isn't a full alternative but evaluates different syntax for the `links` clause specifically:

```typescript
// Option A: affects
write: mutator (v: string) => void affects read;

// Option B: targets  
write: mutator (v: string) => void targets read;

// Option C: invalidates (clause, not keyword)
write: mutator (v: string) => void invalidates read;

// Option D: updates
write: mutator (v: string) => void updates read;

// Option E: changes
write: mutator (v: string) => void changes read;

// Option F: touches
write: mutator (v: string) => void touches read;
```

**Evaluation:**

| Clause | Clarity | Precision | Readability | Verdict |
|--------|---------|-----------|-------------|---------|
| `links` (current) | Low — "links to" is vague | Low | Medium | Weak |
| `affects` | Medium — implies influence | Medium | High | Good |
| `targets` | Medium — implies aim | Medium | High | Good |
| `invalidates` | High — exact meaning | High | Medium (long) | Best semantically |
| `updates` | Medium — implies value change | Medium | High | Good |
| `changes` | Medium — general | Low | High | OK |
| `touches` | Low — informal | Low | Medium | Weak |

**Verdict:** `invalidates` is the most precise. `affects` is the best balance of clarity and brevity. Either is a clear improvement over `links`.

---

## Comparative Rankings

### Scoring Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Clarity | 30% | Is the intent immediately obvious to a TypeScript developer? |
| Conciseness | 15% | Minimal syntactic overhead |
| Consistency | 15% | Fits with existing TypeScript conventions |
| Safety | 20% | Does the default behavior prevent bugs? |
| Parsability | 20% | Can the parser handle it without ambiguity? |

### Scores (1-10)

| # | Alternative | Clarity | Conciseness | Consistency | Safety | Parsability | **Weighted** |
|---|-------------|---------|-------------|-------------|--------|-------------|--------------|
| 1 | `stable`/`invalidates` | 9 | 6 | 8 | 8 | 8 | **8.0** |
| 13 | Only mark mutators | 7 | 9 | 8 | 6 | 9 | **7.5** |
| 7 | Single keyword `stable` | 7 | 9 | 8 | 5 | 9 | **7.2** |
| 12 | `const` on fn types | 7 | 9 | 6 | 5 | 5 | **6.2** |
| 3 | `get`/`set` modifiers | 6 | 9 | 4 | 6 | 4 | **5.7** |
| 11 | `observe`/`mutate` | 5 | 7 | 7 | 7 | 8 | **6.6** |
| 10 | `signal`/`action` | 5 | 8 | 5 | 7 | 8 | **6.3** |
| 2 | `pure`/`impure` | 4 | 8 | 5 | 7 | 8 | **6.0** |
| 4 | `readonly` on fn types | 6 | 8 | 5 | 5 | 4 | **5.5** |
| 8 | `reads`/`writes` effects | 5 | 6 | 5 | 7 | 5 | **5.5** |
| 6 | Tagged return types | 4 | 7 | 4 | 6 | 3 | **4.6** |
| 5 | `@stable`/`@mutates` | 6 | 7 | 3 | 7 | 3 | **5.1** |
| 9 | Branded types | 3 | 4 | 7 | 5 | 9 | **5.3** |

---

## Final Recommendation

### Top Pick: `stable` / `mutator` / `invalidates` (Hybrid of #1 + current)

```typescript
interface Store {
    read: stable () => string | undefined;
    write: mutator (v: string) => void invalidates read;
    reset: mutator () => void;
}
```

**Rationale:**
1. **`stable`** replaces `identity` — dramatically clearer. "This function returns a stable result" is immediately understood. No confusion with mathematical identity or identity functions.
2. **`mutator`** is retained — it's already clear and well-understood. `mutate` (verb form) is also acceptable.
3. **`invalidates`** replaces `links` — precise about what actually happens. The current `links` is the weakest keyword because it doesn't convey directionality or consequence.

### Runner-Up: Minimal approach (#13 + optional `stable`)

```typescript
interface Store {
    read: stable () => string | undefined;      // explicitly stable (optional annotation)
    write: mutator (v: string) => void invalidates read;
    reset: mutator () => void;
}

// Or with stability inferred (no keyword needed):
interface SimpleStore {
    get: () => string;                           // implicitly stable (no mutator keyword)
    set: mutator (v: string) => void;            // explicitly mutating
}
```

This makes `stable` optional-but-recommended, with `mutator` as the required annotation. Stability is inferred by absence of `mutator`. This is the safest default (stable by default) with the lowest annotation burden for read-heavy interfaces.

### Summary of Key Changes from Current System

| Current | Recommended | Reason |
|---------|-------------|--------|
| `identity` | `stable` | Clearer intent, no semantic overloading |
| `links` | `invalidates` | Precise about the effect on targets |
| `mutator` | `mutator` (keep) | Already clear and appropriate |

The single most impactful change is `identity` → `stable`. If only one keyword could be changed, this is it.
