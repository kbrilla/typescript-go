# Identity + Heuristic CFA TDD Plan (Phase 1)

## Scope
This plan intentionally excludes `mutator` and `links` syntax/semantics for now.
Phase 1 focuses only on:
- `identity` support
- stronger heuristic invalidation
- conservative behavior at uncertainty boundaries

## Goals
- Achieve parity with property getter/setter CFA in common local-flow scenarios.
- Improve narrowing for callable getter patterns without introducing unsoundness.
- Use strict TDD: write failing tests first, then implement minimal behavior to pass.

## TDD Workflow Rules
- For each feature slice: Red -> Green -> Refactor.
- Keep commits small and reviewable:
  - commit A: failing tests only
  - commit B: minimal implementation to pass
  - commit C: cleanup/refactor while keeping tests green
- Prefer targeted test runs while iterating; run broader suites at phase boundaries.

## Step 1: Baseline Failure Capture (Red)
Add minimal failing tests in `testdata/tests/cases/compiler/`:
- repeated `identity` reads should narrow after guard
- narrowing should invalidate after heuristic-detected writes
- narrowing should invalidate across uncertainty boundaries:
  - unknown calls
  - callbacks
  - `await`
  - alias escape

Run:
```sh
go test -run='TestLocal/<test name>' ./internal/testrunner
```
Expected: tests fail with clear baseline diffs representing current behavior.

## Step 2: Identity Parse + Bind (Green for metadata)
Implement parser and binder support for `identity` only.

Test additions:
- valid placement on parameterless callable getter declarations
- invalid placement diagnostics for unsupported contexts

Expected result:
- parser/binder tests pass
- CFA behavior tests from Step 1 still fail (by design)

## Step 3: Identity Read Reuse in Checker (Green)
Implement endpoint-keyed flow facts for repeated reads.

Test additions:
- guard then repeated read in same branch should reuse narrowing
- merge points should drop facts when not proven on all incoming paths

Expected result:
- narrowing reuse tests pass
- invalidation boundary tests may still fail

## Step 4: Tier 1 Heuristic Invalidation (Green)
Implement high-confidence invalidation rules:
- direct receiver writes
- obvious same-symbol write operations

Test additions:
- prior narrowing dropped after Tier 1 write
- unrelated writes do not over-invalidate

Expected result:
- Tier 1 invalidation tests pass with deterministic behavior

## Step 5: Tier 2 Guarded Invalidation (Green)
Implement medium-confidence inference only when stability guards hold.

Examples to support:
- local alias-preserving forwarding with provable receiver identity

Examples to reject (fallback conservative):
- unstable aliasing
- receiver identity not provable

Expected result:
- Tier 2 positive and negative tests pass

## Step 6: Uncertainty Boundaries (Green)
Enforce invalidation at soundness boundaries:
- unknown call targets
- callbacks/closures
- async suspension (`await`)
- alias escape

Expected result:
- no stale narrowing facts survive these boundaries

## Step 7: Diagnostics for Heuristic Limits (Green)
Add diagnostics for low-confidence or unsupported inference cases.
Diagnostics should:
- explain why precision was not preserved
- suggest temporary/manual patterns until Phase 2 explicit contracts exist

Expected result:
- diagnostic baselines are stable and actionable

## Step 8: Parity and Regression Sweep
Add parity-focused tests mirroring property getter/setter CFA scenarios.

Run:
```sh
go test -run='TestLocal/<test name>' ./internal/testrunner
go test -run='TestSubmodule/<test name>' ./internal/testrunner
npx hereby test
```
Expected result:
- parity in common scenarios
- no broad regressions in impacted suites

## Step 9: Performance Guardrails
During implementation and refactors:
- keep heuristic checks local and bounded
- avoid global graph traversal in hot checker paths
- cache reusable symbol/endpoint lookup results where safe

Verification:
- compare test runtime before/after each major step
- inspect hot paths if checker regressions appear

## Exit Criteria (Phase 1 Done)
- `identity` narrowing works in targeted local-flow scenarios.
- Tier 1 and guarded Tier 2 invalidation are test-backed.
- uncertainty boundaries invalidate correctly.
- diagnostics for heuristic limits are in place.
- remaining hard cases are documented for Phase 2 (`mutator`/`links`).

## Required Validation Commands
Before handoff, run:
```sh
npx hereby build
npx hereby test
npx hereby lint
npx hereby format
```

## Phase 2 (Prepared, Deferred): Explicit `mutator`/`links`

### Why Phase 2 Exists
Phase 2 is enabled only after Phase 1 evidence shows recurring precision gaps that heuristics cannot safely resolve.

### Phase 2 Entry Criteria
Begin Phase 2 only when one or more are true:
- repeated low-confidence heuristic diagnostics appear in real-world code patterns
- parity gaps remain in important multi-endpoint write scenarios
- conservative fallback causes unacceptable developer friction

### Phase 2 TDD Slices

#### Slice 2.1: Syntax and Binding (Red -> Green)
Red tests:
- parse and bind `mutator` declarations
- parse and bind `links` endpoint lists
- invalid placement and malformed metadata diagnostics

Green implementation:
- parser support for `mutator`/`links`
- binder symbol metadata for mutator-to-endpoint link sets

#### Slice 2.2: Checker Fallback Resolution (Red -> Green)
Red tests:
- heuristic low-confidence call resolves via explicit `links`
- multi-endpoint mutator call selectively invalidates linked endpoints

Green implementation:
- fallback path: heuristics -> explicit metadata
- deterministic endpoint invalidation from declared links

#### Slice 2.3: Ambiguity Diagnostics (Red -> Green)
Red tests:
- unresolved multi-endpoint impact emits actionable diagnostic
- malformed/incomplete link declarations emit declaration diagnostics

Green implementation:
- checker diagnostics for unresolved impact
- parser/binder diagnostics for metadata shape errors

#### Slice 2.4: Constrained Overload Integration (Red -> Green)
Red tests:
- explicit mutator metadata + constrained overload post-call narrowing
- no callback-body analysis required

Green implementation:
- ensure post-call narrowing sequence remains deterministic after fallback resolution

### Phase 2 Regression and Perf Gates
- Re-run Phase 1 parity suites to prevent regressions.
- Add explicit-contract parity tests for multi-endpoint cases.
- Verify fallback lookup does not add hot-path regressions.

### Phase 2 Exit Criteria
- explicit contracts close remaining precision gaps identified after Phase 1
- diagnostics are stable and actionable
- no soundness regressions at uncertainty boundaries
- no unacceptable checker performance regressions

## Phase 1 Progress Checklist (Live)

Status legend:
- [x] done
- [~] in progress / partial
- [ ] not started

Current status:
- [x] Step 1: Baseline failure capture (red)
  - Added and ran local identity tests to establish failing behavior first.
- [~] Step 2: Identity parse + bind
  - Parser/binder support for `identity` is active.
  - Function-type modifier parsing was improved to consume multiple modifiers.
  - Remaining: finalize diagnostic expectations for all invalid placements.
- [~] Step 3: Identity read reuse in checker
  - Repeated-read narrowing now works for core direct identity call patterns.
  - Remaining: complete broader alias/generic-return coverage.
- [~] Step 4: Tier 1 heuristic invalidation
  - Call expressions now participate in flow tracking and narrowing conditions.
  - Remaining: add explicit write-invalidation tests and verify all Tier 1 write forms.
- [ ] Step 5: Tier 2 guarded invalidation
- [~] Step 6: Uncertainty boundaries
  - Covered in local tests: unknown direct call, callback invocation boundary, and await suspension boundary.
  - Remaining: alias-escape boundary matrix and broader parity coverage.
- [ ] Step 7: Diagnostics for heuristic limits
- [ ] Step 8: Parity and regression sweep
- [ ] Step 9: Performance guardrails/perf checks

### Next Focus (Immediate)
1. Expand Phase 1 tests for explicit write invalidation and boundary invalidation matrix.
2. Re-introduce advanced cases incrementally (generic return/alias-heavy patterns) as red tests.
3. Implement minimal checker changes per failing slice before moving to Tier 2.

### Latest Increment
- Advanced boundary invalidation experiment was prototyped and tested, but reverted due broad submodule baseline regressions.
- Kept stable Phase 1 improvements that remain green without regressions:
  - parser: multi-modifier parsing for function type modifiers
  - binder: call-expression participation in narrowing references/flow attachment for identity usage
  - checker: call-expression truthiness narrowing fallback when no type predicate applies
- Stable targeted local test set:
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
- Boundary matrix remains planned work under Step 6 and will be reintroduced in smaller slices.

### Latest Increment (Diagnostics)
- Added `testdata/tests/cases/compiler/identityModifierDiagnostics.ts` with stable grammar/placement checks:
  - parameterized identity function type (TS100012)
  - duplicate identity modifier (TS1030)
  - identity modifier on constructor type position (TS1184)
- Parser lookahead now recognizes identity-modifier trails for function/constructor type starts in declaration type positions.
- Identity-focused local suite now green:
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
  - `identityModifierDiagnostics.ts`

### Latest Increment (Boundaries - Narrow Slice)
- Added `testdata/tests/cases/compiler/identityModifierBoundaries.ts` for expression-statement call boundaries.
- Binder change (`internal/binder/binder.go`): expression-statement calls now create flow-call nodes (`maybeBindExpressionFlowIfCall`).
- Checker change (`internal/checker/flow.go`): conservative invalidation of identity-call narrowing across non-matching flow-call boundaries.
- This narrow boundary slice is green in local tests and remains green in full `hereby` validation.

### Latest Increment (Parser Disambiguation Stability)
- Fixed a parser ambiguity where `identity<...>` in type-reference positions was being misclassified as the start of an identity function type.
- Parser change (`internal/parser/parser.go`): `nextTokenStartsIdentityFunctionOrConstructorType` now requires an unambiguous function-type parameter list before accepting `identity` + `<...>` as function-type syntax.
- This removes the submodule regression in `declarationEmitMappedTypePreservesTypeParameterConstraint.ts` while preserving Phase 1 identity tests.
- Validation after this fix is green for required commands:
  - `npx hereby build`
  - `npx hereby test`
  - `npx hereby lint`
  - `npx hereby format`

### Latest Increment (Boundaries - Await Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with an `await` uncertainty-boundary scenario.
- Red phase: targeted local test failed before implementation due missing post-`await` invalidation.
- Green phase binder change (`internal/binder/binder.go`): `maybeBindExpressionFlowIfCall` now also emits a flow-call boundary for `AwaitExpression` statement forms.
- Checker behavior reused existing conservative call-boundary invalidation logic in `getTypeAtFlowCall` (`internal/checker/flow.go`), producing the expected post-`await` widening.
- Accepted only relevant baselines for this slice:
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.errors.txt`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.symbols`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.types`
