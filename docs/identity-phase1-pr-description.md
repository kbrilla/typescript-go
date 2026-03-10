# PR Description Draft: Identity CFA Phase 1

## Summary
Implements Phase 1 of `identity`-based callable CFA in small TDD slices, aligned to:
- `docs/identity-modifier-spec.md`
- `docs/identity-heuristic-tdd-plan.md`

This PR intentionally excludes explicit `mutator`/`links` contract behavior (Phase 2).

## Spec Alignment

### Done
- FR1 (`identity` declaration parsing/binding):
  - Parser support for identity function-type modifier forms in declaration type contexts.
  - Binder/AST plumbing for call-expression flow participation.
- FR2 (repeated read reuse):
  - Identity call expressions participate in narrowing and repeated reads reuse narrowing in covered local-flow cases.
- FR4 (uncertainty boundaries, partial):
  - Unknown call boundary invalidation (narrow slice).
  - Callback invocation boundary invalidation (narrow slice).
  - Await suspension boundary invalidation for both statement-form `await` and assignment-form `const x = await ...` (latest slice).
  - Assignment-based alias-escape invalidation (narrow slice), including variable initializer and binary reassignment forms.
- Diagnostics slice (partial FR9 groundwork):
  - Stable grammar/placement diagnostics for identity modifier misuse.
- Parser stability fix:
  - Disambiguated `identity<...>` type references from identity function-type starts to avoid submodule regression.

### In Progress
- FR4 uncertainty matrix completion:
  - Broader alias-escape parity matrix (non-trivial escapes/indirect forms) and wider callback parity coverage still pending.
- Step 4 Tier 1 invalidation hardening:
  - Additional explicit write-form invalidation tests pending.

### Not Started (Phase 1/2 split)
- FR3 full mutator-impact invalidation coverage.
- FR5 callback-body opacity invariants (explicitly test-backed).
- FR6 constrained-overload post-call narrowing.
- FR7 ambiguity diagnostics for unresolved multi-endpoint invalidation.
- FR8 tiered heuristic confidence pipeline.
- FR9 low-confidence heuristic guidance diagnostics.
- Phase 2 explicit `mutator`/`links` fallback path.

## Tests Added
- `testdata/tests/cases/compiler/identityModifierErrors.ts`
- `testdata/tests/cases/compiler/identityModifierNarrowing.ts`
- `testdata/tests/cases/compiler/identityModifierDiagnostics.ts`
- `testdata/tests/cases/compiler/identityModifierBoundaries.ts`

## Key Implementation Files
- `internal/parser/parser.go`
- `internal/binder/binder.go`
- `internal/checker/flow.go`
- `internal/ast/ast.go`

## Validation
Most recent full required run is green:
- `npx hereby build`
- `npx hereby test`
- `npx hereby lint`
- `npx hereby format`

## Remaining Work (Next Slices)
1. Expand Step 6 with alias-escape and wider callback boundary coverage.
2. Expand alias-escape coverage beyond direct assignment forms while preserving narrow blast radius.
3. Start Tier 2 guarded invalidation tests as red-first slices.

## Update Protocol
This file is the PR description source-of-truth for this branch.
After each commit-level slice, update these sections:
- `Spec Alignment` (`Done`, `In Progress`, `Not Started`)
- `Tests Added`
- `Validation`
- `Remaining Work`
