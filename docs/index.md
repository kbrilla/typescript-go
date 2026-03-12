# Documentation Index

Documentation for the `stable` / `mutator` / `invalidates` modifier feature — a proposed extension to TypeScript's type system for identity-aware narrowing preservation.

---

## Core Specification & Design

- [stable-modifier-spec.md](stable-modifier-spec.md) — Main SDD (Software Design Document) for the stable/mutator/invalidates feature
- [stable-modifier-research.md](stable-modifier-research.md) — Initial research on the identity/stable modifier concept
- [signal-proposal-stable-mutator.md](signal-proposal-stable-mutator.md) — TC39 Signals integration proposal
- [stable-phase1-pr-description.md](stable-phase1-pr-description.md) — PR description for Phase 1 implementation
- [stable-phase8-proposal.md](stable-phase8-proposal.md) — Phase 8 proposal (linked predicates, advanced patterns)

## Design Review (Cross-Language Survey)

- [design-review/00-synthesis.md](design-review/00-synthesis.md) — Synthesis of all language reviews

| # | Language / Topic | Link |
|---|-----------------|------|
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

## Uncertainty Boundary Research

- [better_narrowing_after_uncertainty_boundry.md](better_narrowing_after_uncertainty_boundry.md) — Main synthesis document for uncertainty boundary research
- [escape-analysis-research.md](escape-analysis-research.md) — Escape analysis approaches for narrowing preservation
- [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) — Transitive mutator propagation semantics
- [purity-effects-research.md](purity-effects-research.md) — Purity/effect annotations with cross-language survey (9 languages)
- [stable-heuristic-uncertainty-boundaries-research.md](stable-heuristic-uncertainty-boundaries-research.md) — Heuristic-based scope analysis for uncertainty boundaries
- [novel-narrowing-preservation-research.md](novel-narrowing-preservation-research.md) — Novel/creative approaches to narrowing preservation

## Related Research

- [stable-lib-impact-research.md](stable-lib-impact-research.md) — Impact analysis: `stable`/`mutator` on JS/DOM built-in types
- [cross-method-type-guards-research.md](cross-method-type-guards-research.md) — Cross-method type guard patterns
- [research-map-has-get-narrowing.md](research-map-has-get-narrowing.md) — `Map.has()` → `Map.get()` narrowing pattern
- [stable-inheritance-research.md](stable-inheritance-research.md) — How `stable` interacts with class inheritance
- [ts-cfa-tradeoffs-research.md](ts-cfa-tradeoffs-research.md) — TypeScript CFA design trade-offs (issues #9998 / #7770)
- [lying-setter-mutator-soundness-research.md](lying-setter-mutator-soundness-research.md) — "Lying setter/mutator" soundness analysis: getter/setter and stable/mutator CFA unsoundness
- [lying-setter-prevention-research.md](lying-setter-prevention-research.md) — Prevention strategies for lying setter/mutator patterns
- [pre_post_validation.md](pre_post_validation.md) — Pre/post validation: whole-proposal impact assessment on existing codebases

## Risk & Feasibility Analysis

- [ts-rejection-risk-assessment.md](ts-rejection-risk-assessment.md) — TS team rejection risk assessment for the stable/mutator/invalidates proposal

## Implementation Notes & Reviews

- [stable-code-review.md](stable-code-review.md) — Code review notes
- [stable-go-review.md](stable-go-review.md) — Go-specific review notes
- [stable-testing-review.md](stable-testing-review.md) — Testing review notes
- [stable-heuristic-tdd-plan.md](stable-heuristic-tdd-plan.md) — TDD plan for heuristic implementation
