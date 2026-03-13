# Design Decisions Register

## Purpose

This document consolidates all open design decisions for the `stable`/`mutator`/`invalidates` (or `stable`/`mutates`) proposal. Each decision is tracked with its status, impact, alternatives, and recommendation. This is the single reference point for understanding what needs to be decided before each phase ships.

**Legend:**
- **OPEN** — No recommendation; needs TypeScript team input
- **RECOMMENDED** — We have a recommendation but it needs confirmation
- **DEFERRED** — Decision deferred to a later phase with rationale
- **DECIDED** — Decision made and implemented

---

## A. Syntax Decisions

### SYN-1: `mutates` vs `mutator` + `invalidates` (2 keywords vs 3)

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Phase 2 (affects syntax surface area) |
| **Decision** | Should `mutator` + `invalidates` be collapsed into a single `mutates` clause? |
| **Current** | `set: mutator (v: T) => void invalidates get` (3 keywords) |
| **Alternative** | `set(v: T): void mutates get` (2 keywords) |
| **Sub-questions** | 1. Does `mutates` compose with linked predicates? 2. Is it a modifier or a clause? 3. `mutates this` vs bare `mutates` for blanket? |
| **Recommendation** | None — explicitly open for TS team input |
| **Source** | [stable-pr-proposal.md §13](stable-pr-proposal.md) |

### SYN-2: `stable` keyword naming

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | None (cosmetic) |
| **Decision** | Is `stable` the right name? Alternatives: `getter`, `pure`, `cached`, `memo`, `identity` |
| **Recommendation** | Keep `stable` for Phase 1. Revisit at upstream naming checkpoint |
| **Source** | [stable-internal-design-document.md §7](stable-internal-design-document.md), [stable-modifier-spec.md §19](stable-modifier-spec.md) |

### SYN-3: `mutator` (noun) vs `mutating` (adjective)

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Phase 2 (naming convention) |
| **Decision** | TS modifiers are adjectives (`readonly`, `abstract`, `static`). `mutator` is a noun. Should it be `mutating`? |
| **Recommendation** | None — open for TS team preference. Note: if SYN-1 resolves in favor of `mutates`, this question becomes moot |
| **Source** | [stable-pr-proposal.md §17 Q7](stable-pr-proposal.md) |

### SYN-4: `stable` on class method declarations

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Phase 2+ |
| **Decision** | `stable` only works on function type expressions, not `MethodDeclaration`. Should `stable getValue(): T {}` be valid? |
| **Current workaround** | Property syntax: `getValue: stable () => T = () => this._value` |
| **Recommendation** | Defer to Phase 2+. Requires multi-layer AST changes |
| **Resolution** | Implemented. `stable` and `mutator` are allowed as modifiers on method declarations and method signatures (class methods, interface methods, type literal methods). `invalidates` clause on methods is also implemented (Phase 6, commit 61ba366a4). Additionally, `mutator TypeRef invalidates <targets>` syntax on type references is now supported (see SYN-7). |
| **Source** | [stable-pr-proposal.md §11](stable-pr-proposal.md) |

### SYN-5: `stable` on interface call signatures

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | Phase 5+ |
| **Decision** | `interface { stable (): T; }` doesn't work — parser interprets `stable` as a method name |
| **Recommendation** | Defer. Parser refactor needed |
| **Source** | [stable-internal-design-document.md](stable-internal-design-document.md) |

### SYN-6: `preserves` syntax (exclusive invalidation)

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | Phase 3+ |
| **Decision** | Should `invalidates` support an "exclusive" mode? Syntax: `sort: mutator () => void preserves length` |
| **Analysis** | ~5% real-world need. Inclusive `invalidates` covers 95%+ |
| **Recommendation** | Defer to Phase 3+. Re-evaluate based on real-world adoption data |
| **Source** | [stable-phase8-proposal.md §5](stable-phase8-proposal.md) |

### SYN-7: `mutator TypeRef invalidates <targets>` AST representation

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Current (implemented) |
| **Decision** | How should `mutator TypeRef invalidates <targets>` be represented in the AST? Create a new `KindMutatorType` node, or reuse the existing `FunctionTypeNode` with a `WrappedType` field? |
| **Options** | 1. New `KindMutatorType` AST node kind — requires ~19 registration points across 12+ files  2. Reuse `FunctionTypeNode` with `WrappedType` field — simpler, leverages existing modifier/invalidates infrastructure |
| **Recommendation** | Reuse `FunctionTypeNode` with `WrappedType` field |
| **Resolution** | Implemented. `FunctionTypeNode` is reused with a `WrappedType` field rather than creating a new AST node kind. The type resolution simply returns the wrapped type since `mutator`/`invalidates` are CFA annotations, not type-level modifications. This avoids the complexity of registering a new node kind across the codebase while fully supporting `mutator TypeRef invalidates <targets>` syntax on type references. |
| **Source** | SYN-4 (extension) |

---

## B. Semantic Decisions

### SEM-1: Generic interaction with `stable`

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | Phase 2+ (blocking for generic-heavy APIs) |
| **Decision** | How does `stable` propagate through generics, conditional types, mapped types? |
| **Sub-questions** | 1. Is `fn()` narrowable inside `function wrap<T>(fn: stable () => T)`? 2. Does `T extends stable () => infer R` discriminate? 3. Do mapped types preserve `stable`? |
| **Recommendation** | Conservative (no narrowing unless concrete type known). Defer to follow-up proposal |
| **Source** | [stable-pr-proposal.md §11](stable-pr-proposal.md) |

### SEM-2: Destructured method narrowing

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Medium priority |
| **Decision** | When a stable method is destructured from its receiver, should narrowing still apply? Should it be an error? |
| **Recommendation** | None — needs TS team input |
| **Source** | [stable-pr-proposal.md §17 Q1](stable-pr-proposal.md) |

### SEM-3: Interface merging disagreement

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Low |
| **Decision** | When merged interfaces disagree on `stable`, modifier is lost (intersection semantics). Correct? |
| **Recommendation** | Yes — follows intersection semantics (matches `readonly` merging). Needs test codification |
| **Resolution** | Codified via test `stableModifierInterfaceMerging.ts` (10 sections). Behavior: first-declaration-wins for interface merging (stable survives if first decl has it, lost otherwise). For intersections, stable from first constituent survives. For interface extension, derived declaration takes priority. Matches `readonly` merging precedent. |
| **Source** | [stable-pr-proposal.md §11](stable-pr-proposal.md), [stable-phase8-proposal.md §6](stable-phase8-proposal.md) |

### SEM-4: `super` call invalidation

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Medium (hierarchy correctness) |
| **Decision** | Should `super.set(0)` invalidate `this.get()` narrowing? |
| **Recommendation** | Yes — same receiver. Implementation requires receiver normalization in `isMutatorCallBoundary` |
| **Resolution** | Implemented. `super` is normalized to `this` in `isMutatorCallBoundary`, so `super.mutator()` correctly invalidates `this.stable()` narrowing. |
| **Source** | [stable-pr-proposal.md §17 Q9](stable-pr-proposal.md), [stable-phase8-proposal.md §6 Rule H4](stable-phase8-proposal.md) |

### SEM-5: `--strictStable` compiler flag

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Low priority |
| **Decision** | Should there be a flag that treats ALL unmarked calls as potentially invalidating? (Reverses default-transparent) |
| **Recommendation** | Noted as possibility. Too conservative for most codebases |
| **Source** | [stable-pr-proposal.md §17 Q8](stable-pr-proposal.md) |

### SEM-6: Heuristic vs explicit invalidation

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Documentation/adoption — significant |
| **Decision** | Should heuristic tier-based inference be a user-facing feature, or should all invalidation be explicit `mutator` annotations? |
| **Gap** | Internal design document uses heuristics as primary path; proposal focuses on explicit contracts |
| **Recommendation** | None — needs alignment between internal design and external proposal |
| **Source** | [stable-pr-proposal.md §17 Q10](stable-pr-proposal.md) |

### SEM-7: Map `undefined`-value edge case

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | **Blocking Phase 9** (keyed linked predicates) |
| **Decision** | For `Map<K, V \| undefined>`, `has(key)` → `get(key)` narrowing would incorrectly narrow `V \| undefined` to `V` |
| **Recommendation** | None — needs "careful type-level treatment" |
| **Source** | [stable-pr-proposal.md §17 Q11](stable-pr-proposal.md) |

### SEM-8: Conditional type discrimination of `stable`

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | None (theoretical future) |
| **Decision** | Should `T extends stable () => any ? true : false` discriminate stable functions? |
| **Options** | 1. `TypeFlagsStable` bit  2. `IsStable<T>` intrinsic  3. No action |
| **Recommendation** | Do not implement. Monitor for real-world use cases. If needed, `IsStable<T>` intrinsic is safest |
| **Source** | [stable-phase8-proposal.md §8](stable-phase8-proposal.md) |

---

## C. Cross-Binding Invalidation (SolidJS)

### CBI-1: Cross-binding invalidation mechanism

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | **Blocking SolidJS adoption** (Phase 2.5) |
| **Decision** | How should `setCount()` invalidate `count()` when they are separate tuple-destructured bindings? |
| **Approaches** | A: `mutates [0]` (tuple index) — viable fallback B: `links "channel"` (named groups) — rejected, architecturally questionable C: Source interface extraction — rejected, violates structural typing D: `mutates read` (named tuple label) — **RECOMMENDED** E: Heuristic inference — rejected, no annotation precedent F: Object pattern (change SolidJS API) — not a solution |
| **Recommendation** | Approach D (named tuple label reference) with Approach A (index) as fallback. ~300-500 LOC |
| **Resolution** | Implemented. Named tuple label references (`invalidates read`) enable cross-binding invalidation. Parser enhanced with look-ahead to resolve comma ambiguity in tuple contexts. `isCrossBindingMutatorBoundary` in flow.go tracks destructuring provenance and matches invalidation targets against tuple labels. Post-call narrowing works through cross-binding (e.g., `setCount(undefined)` narrows sibling `count()` to `undefined`). |
| **Source** | [research-solidjs-cross-binding.md](research-solidjs-cross-binding.md) |

### CBI-2: Destructuring provenance depth

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Phase 2.5 implementation detail |
| **Decision** | Should `mutates` in tuple position be limited to direct destructuring, or work through any indirection level? |
| **Recommendation** | Direct destructuring only (covers 99% of usage). Limit complexity |
| **Resolution** | Direct destructuring only — already implemented in CBI-1 (`isCrossBindingMutatorBoundary` only checks ArrayBindingPattern) |
| **Source** | [research-solidjs-cross-binding.md §7 Q1](research-solidjs-cross-binding.md) |

### CBI-3: React `useState` annotation

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | None |
| **Decision** | Should React `useState` be annotated with `mutates`? (Getter is a value, not a function) |
| **Recommendation** | No — `stable` applies to callable getters only. Property narrowing already handles values |
| **Resolution** | No — stable only applies to callable getters. React `useState` returns a value, not a function, so property narrowing handles it |
| **Source** | [research-solidjs-cross-binding.md §7 Q2](research-solidjs-cross-binding.md) |

### CBI-4: SolidJS object-based API recommendation

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Framework-level (not a TS feature decision) |
| **Decision** | Should SolidJS ship an object-based API as a "narrowable" alternative? |
| **Recommendation** | Document as simplest path to sound narrowing. Framework decision |
| **Source** | [research-solidjs-cross-binding.md §7 Q3](research-solidjs-cross-binding.md) |

### CBI-5: Multi-target `mutates` composition

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Edge case — Phase 2.5 |
| **Decision** | Can a function mutate both a tuple sibling AND a receiver method? E.g., `mutates read, get` |
| **Recommendation** | None — open |
| **Source** | [research-solidjs-cross-binding.md §7 Q4](research-solidjs-cross-binding.md) |

---

## D. Linked Predicates & Advanced Patterns

### LP-1: Keyed linked predicates (Phase 9)

| Aspect | Detail |
|--------|--------|
| **Status** | DECIDED |
| **Phase Impact** | Phase 9 (Map/Set `has`/`get`) |
| **Decision** | `has(key: K): this.get(key) is V` — how does parameter correlation work? |
| **Risk** | High — parameter correlation + per-key invalidation + `isMatchingReference` interaction |
| **Recommendation** | Ship Phase 8 independently first. Phase 9 builds on proven foundation |
| **Resolution** | Implemented (commit 18f9a1590). Per-key stable tracking via `stable[key]`/`mutator[key]` bracket notation. `invalidates get[key]` for per-key invalidation. Parameter correlation resolved through argument-matched reference tracking. |
| **Source** | [stable-phase8-proposal.md §3](stable-phase8-proposal.md) |

### LP-2: Discriminated method unions (Phase 10)

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | Phase 3+ (stretch) |
| **Decision** | `isResolved(): this.value() is T & this.error() is undefined` — multi-predicate intersection? |
| **Recommendation** | Defer. No existing TS mechanism for method-discriminated object types. Users have workaround (property-based discriminated unions) |
| **Source** | [stable-phase8-proposal.md §4](stable-phase8-proposal.md) |

### LP-3: Getter mutation invalidation

| Aspect | Detail |
|--------|--------|
| **Status** | DEFERRED |
| **Phase Impact** | Phase 3+ |
| **Decision** | Should `invalidates`/`mutates` target getter properties (not just stable methods)? |
| **Recommendation** | Defer. Monitor for real-world hybrid pattern reports |
| **Source** | [stable-phase8-proposal.md §7](stable-phase8-proposal.md) |

---

## E. Adoption & Ecosystem Decisions

### ADO-1: Standard library annotations

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Separate proposal |
| **Decision** | Should builtins (`Map.get`, `WeakRef.deref`, DOM accessors) be annotated `stable`? |
| **Recommendation** | Requires careful API review as separate effort |
| **Source** | [stable-pr-proposal.md §17 Q3](stable-pr-proposal.md) |

### ADO-2: Backward-compatible declarations

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | **Blocking framework adoption** |
| **Decision** | How do frameworks ship `.d.ts` that work with both `stable`-aware and older TS versions? |
| **Options** | Conditional type exports, declaration file versioning, polyfill `.d.ts` |
| **Recommendation** | None — needs exploration. Critical for real-world adoption |
| **Source** | [stable-pr-proposal.md §17 Q4](stable-pr-proposal.md) |

### ADO-3: `this` parameter interaction

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Niche but correctness-relevant |
| **Decision** | Should `stable` be allowed on functions with explicit `this` parameter? Does `this` type serve as receiver for invalidation scoping? |
| **Recommendation** | None — needs TS team input |
| **Source** | [stable-pr-proposal.md §17 Q5](stable-pr-proposal.md) |

### ADO-4: Fundamentally simpler alternatives

| Aspect | Detail |
|--------|--------|
| **Status** | OPEN |
| **Phase Impact** | Could redirect entire feature |
| **Decision** | Are there simpler mechanisms — single modifier, type-level encoding, `readonly` integration — that the team would prefer? |
| **Recommendation** | "Open to fundamentally different approaches" |
| **Source** | [stable-pr-proposal.md §17 Q6](stable-pr-proposal.md) |

---

## Summary Dashboard

### By Status

| Status | Count | IDs |
|--------|-------|-----|
| **OPEN** | 12 | SYN-1, SYN-3, SEM-2, SEM-5, SEM-6, SEM-7, CBI-4, CBI-5, ADO-1, ADO-2, ADO-3, ADO-4 |
| **RECOMMENDED** | 0 | — |
| **DEFERRED** | 7 | SYN-2, SYN-5, SYN-6, SEM-1, SEM-8, LP-2, LP-3 |
| **DECIDED** | 8 | SYN-4, SYN-7, CBI-1, SEM-3, SEM-4, CBI-2, CBI-3, LP-1 |

### By Phase Impact

| Phase | Blocking Decisions | IDs |
|-------|-------------------|-----|
| Phase 1 | 0 | (Phase 1 is complete) |
| Phase 2 | 2 | SYN-1, SYN-4 |
| Phase 2.5 (SolidJS) | 1 | CBI-1 |
| Phase 9 | 1 | SEM-7 |
| Framework adoption | 1 | ADO-2 |
| Could redirect everything | 1 | ADO-4 |

### Needs TypeScript Team Input (Priority)

| Priority | Count | IDs |
|----------|-------|-----|
| **Critical** | 5 | SYN-1, SEM-1, SEM-2, ADO-2, ADO-4 |
| **Important** | 4 | SYN-3, SEM-6, ADO-1, ADO-3 |
| **Informational** | 3 | SEM-5, SEM-8, LP-2 |
