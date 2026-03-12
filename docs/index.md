# Documentation Index

Documentation for the `stable` / `mutator` / `invalidates` modifier feature — a proposed extension to TypeScript's type system for narrowing preservation through function calls.

---

## Implementation Status Summary

| Category | Count | Description |
|----------|-------|-------------|
| ✅ Implemented | 13 features | Shipped in this PR |
| 🔮 Future (Not Implemented) | 5 extensions | Designed but deferred |
| ❓ Open Questions | 12 | Require design decisions |
| ✅ Decided | 6 | Design decisions made |
| ⏸️ Deferred | 8 | Postponed to future phases |

---

## 📋 PR & Implementation

These are the most up-to-date documents reflecting the current state:

| Document | Purpose |
|----------|---------|
| [stable-pr-description.md](stable-pr-description.md) | **PR body** — Complete syntax reference, implementation status, phase roadmap, open questions |
| [stable-design-decisions.md](stable-design-decisions.md) | **Decision register** — 6 DECIDED, 12 OPEN, 8 DEFERRED decisions |
| [stable-internal-design-document.md](stable-internal-design-document.md) | **Internal design doc** — Phase completion status, parity matrices, implementation details |

---

## ✅ Already Implemented Features

All of these features are functional in this PR:

1. **`stable` modifier** — Preserves narrowing through no-arg calls (methods, functions, arrows, getters)
2. **`mutator` modifier** — Marks methods that invalidate narrowing (methods, functions, arrows, setters)
3. **`invalidates` clause** — Selective invalidation targeting specific stable endpoints (on function types)
4. **Conservative invalidation** — Any call resets stable narrowing when no `mutator` annotations exist
5. **Targeted invalidation** — Only `mutator`-marked calls reset narrowing when annotations exist
6. **Linked type predicates** — `hasValue(): this.value() is Exclude<T, undefined>` narrows stable endpoints
7. **Post-call argument narrowing** — `set(42)` narrows `get()` to `number` via assignment reduction
8. **Cross-binding invalidation (CBI-1)** — Named tuple labels with `invalidates read` for destructured APIs
9. **Super call invalidation (SEM-4)** — `super.mutator()` invalidates `this.stable()` narrowing
10. **Full declaration parity** — All function-like declarations accept stable/mutator
11. **Interface method merging (SEM-3)** — Stable/mutator respected across merged interface declarations
12. **`invalidates` on method declarations (SYN-4b)** — Selective invalidation directly on method declarations/signatures
13. **Keyed linked predicates (LP-1)** — `has(key: K): this.get(key) is V` with per-key stable tracking and invalidation

---

## 🔮 Future Extensions (Not Implemented)

Designed and documented but NOT in this PR:

| Phase | Feature | Blocking Reason | Reference |
|-------|---------|----------------|-----------|
| 7 | `mutates` unified clause | Alternative syntax decision | [PR desc §Phase 7](stable-pr-description.md) |
| 8 | `--strictStable` compiler flag | Compiler flag infrastructure | [PR desc §Phase 8](stable-pr-description.md) |

| 10 | Discriminated method unions (multi-predicate) | Multi-target predicate infrastructure | [PR desc §Phase 10](stable-pr-description.md) |
| 11 | Getter property invalidation | `invalidates` targeting properties | [PR desc §Phase 11](stable-pr-description.md) |
| 12 | Standard library annotations | TC39/TS team buy-in | [PR desc §Phase 12](stable-pr-description.md), [stable-lib-impact-research.md](stable-lib-impact-research.md) |

---

## ❓ Open Questions & Decisions

| Document | Purpose |
|----------|---------|
| [stable-design-decisions.md](stable-design-decisions.md) | Full decision register with 12 OPEN questions and 9 DEFERRED items |
| [stable-design-holes-analysis.md](stable-design-holes-analysis.md) | Design holes analysis — some holes now resolved (marked with update notes) |

---

## 📐 Specifications & Proposals (Design Input)

These served as design specifications. Some sections are now stale (marked with update notes):

| Document | Purpose | Status |
|----------|---------|--------|
| [stable-modifier-spec.md](stable-modifier-spec.md) | Main SDD — grammar, semantics, phase scope | ⚠️ Phase 1 scope notes are stale |
| [stable-pr-proposal.md](stable-pr-proposal.md) | Research-grade PR proposal | ⚠️ Multiple sections stale (update notes added) |
| [stable-phase8-proposal.md](stable-phase8-proposal.md) | Linked predicates proposal | ✅ Implemented — status updated |
| [signal-proposal-stable-mutator.md](signal-proposal-stable-mutator.md) | TC39 Signals integration proposal | 📋 Reference |
| [stable-modifier-research.md](stable-modifier-research.md) | Initial research on stable modifier concept | 📋 Historical |

---

## 🔬 Research (Historical Reference)

These are research documents that explored design space. They may contain outdated information about implementation status:

### Uncertainty Boundaries & Narrowing Preservation
| Document | Topic |
|----------|-------|
| [better_narrowing_after_uncertainty_boundry.md](better_narrowing_after_uncertainty_boundry.md) | Main synthesis: uncertainty boundary analysis |
| [escape-analysis-research.md](escape-analysis-research.md) | Escape analysis approaches |
| [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) | Transitive mutator propagation semantics |
| [purity-effects-research.md](purity-effects-research.md) | Purity/effect annotations (9-language survey) |
| [stable-heuristic-uncertainty-boundaries-research.md](stable-heuristic-uncertainty-boundaries-research.md) | Heuristic-based scope analysis |
| [novel-narrowing-preservation-research.md](novel-narrowing-preservation-research.md) | Novel/creative approaches |

### Type System Patterns
| Document | Topic |
|----------|-------|
| [cross-method-type-guards-research.md](cross-method-type-guards-research.md) | Cross-method type guard patterns |
| [research-map-has-get-narrowing.md](research-map-has-get-narrowing.md) | `Map.has()` → `Map.get()` narrowing, per-key syntax |
| [stable-inheritance-research.md](stable-inheritance-research.md) | Stable + class inheritance |
| [ts-cfa-tradeoffs-research.md](ts-cfa-tradeoffs-research.md) | TypeScript CFA design trade-offs |

### Soundness & Safety
| Document | Topic |
|----------|-------|
| [lying-setter-mutator-soundness-research.md](lying-setter-mutator-soundness-research.md) | "Lying setter/mutator" soundness analysis |
| [lying-setter-prevention-research.md](lying-setter-prevention-research.md) | Prevention strategies for lying patterns |

### Framework & Library Impact
| Document | Topic |
|----------|-------|
| [research-solidjs-cross-binding.md](research-solidjs-cross-binding.md) | SolidJS cross-binding analysis — ⚠️ CBI-1 now implemented |
| [stable-lib-impact-research.md](stable-lib-impact-research.md) | Impact on JS/DOM built-in types |
| [pre_post_validation.md](pre_post_validation.md) | Whole-proposal impact assessment on codebases |

---

## 🔍 Implementation Reviews

| Document | Purpose |
|----------|---------|
| [stable-code-review.md](stable-code-review.md) | Code review notes |
| [stable-go-review.md](stable-go-review.md) | Go-specific review notes |
| [stable-testing-review.md](stable-testing-review.md) | Testing review notes |
| [stable-heuristic-tdd-plan.md](stable-heuristic-tdd-plan.md) | TDD plan for heuristic implementation |

---

## ⚖️ Risk Assessment

| Document | Purpose |
|----------|---------|
| [ts-rejection-risk-assessment.md](ts-rejection-risk-assessment.md) | TS team rejection risk assessment |

---

## 🌐 Design Review (Cross-Language Survey)

24-language survey exploring how other ecosystems handle narrowing, effects, and mutation tracking:

| Document | Purpose |
|----------|---------|
| [design-review/00-synthesis.md](design-review/00-synthesis.md) | **Synthesis** — Key patterns across all languages |

| # | Language / Topic | Link |
|---|------------------|------|
| 01 | Python | [01-python.md](design-review/01-python.md) |
| 02 | Rust | [02-rust.md](design-review/02-rust.md) |
| 03 | Kotlin | [03-kotlin.md](design-review/03-kotlin.md) |
| 04 | Swift | [04-swift.md](design-review/04-swift.md) |
| 05 | C# | [05-csharp.md](design-review/05-csharp.md) |
| 06 | Ruby | [06-ruby.md](design-review/06-ruby.md) |
| 07 | Scala | [07-scala.md](design-review/07-scala.md) |
| 08 | Haskell | [08-haskell.md](design-review/08-haskell.md) |
| 09 | Elixir | [09-elixir.md](design-review/09-elixir.md) |
| 10 | Clojure | [10-clojure.md](design-review/10-clojure.md) |
| 11 | Dart | [11-dart.md](design-review/11-dart.md) |
| 12 | F# | [12-fsharp.md](design-review/12-fsharp.md) |
| 13 | OCaml | [13-ocaml.md](design-review/13-ocaml.md) |
| 14 | Effect Systems | [14-effect-systems.md](design-review/14-effect-systems.md) |
| 15 | Reactive Frameworks | [15-reactive-frameworks.md](design-review/15-reactive-frameworks.md) |
| 16 | PHP | [16-php.md](design-review/16-php.md) |
| 17 | Groovy & Perl | [17-groovy-perl.md](design-review/17-groovy-perl.md) |
| 18 | Lua & R | [18-lua-r.md](design-review/18-lua-r.md) |
| 19 | Alternative Syntax | [19-alternative-syntax.md](design-review/19-alternative-syntax.md) |
| 20 | Academic Research | [20-academic-research.md](design-review/20-academic-research.md) |
| 21 | Go | [21-go.md](design-review/21-go.md) |
| 22 | TypeScript (Existing) | [22-typescript-existing.md](design-review/22-typescript-existing.md) |
| 23 | Zig, Nim & Crystal | [23-zig-nim-crystal.md](design-review/23-zig-nim-crystal.md) |
| 24 | Java & C++ | [24-java-cpp.md](design-review/24-java-cpp.md) |
