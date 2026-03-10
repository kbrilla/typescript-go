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

Benchmark evidence note:
- See `docs/identity-phase1-pr-description.md` section `Benchmark: tsgo main vs this branch`.
- Current snapshot on the TypeScript-main workload shows this branch at `+4.51%` wall time and `-2.24%` RSS versus tsgo main.
- Treat this as directional only until additional runs are collected to reduce measurement noise.

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
- [ ] not started

Current status:
- [x] Step 1: Baseline failure capture (red)
  - Added and ran local identity tests to establish failing behavior first.
- [x] Step 2: Identity parse + bind (core)
  - Parser/binder support for `identity` is active.
  - Function-type modifier parsing was improved to consume multiple modifiers.
  - Remaining: finalize diagnostic expectations for all invalid placements.
- [x] Step 3: Identity read reuse in checker (core)
  - Repeated-read narrowing now works for core direct identity call patterns.
  - Remaining: complete broader alias/generic-return coverage.
- [x] Step 4: Tier 1 heuristic invalidation (covered slices)
  - Call expressions now participate in flow tracking and narrowing conditions.
  - Added parity write-form coverage: property assignment write, method setter-call write, and callable hybrid setter-style write.
  - Closed the P5 getter-vs-identity write parity slice for same-receiver `read()` then `set(non-nullish)` shape.
  - Remaining: expand additional Tier 1 write-shape matrix breadth.
- [ ] Step 5: Tier 2 guarded invalidation (broad)
  - Added starter local test coverage for candidate Tier 2 forwarding/passthrough patterns with current conservative expectations.
  - Added narrow positive precision slices for trivial local passthrough helper forms.
  - Remaining: implement guarded precision preservation when receiver identity and non-mutating forwarding can be proven.
- [x] Step 6: Uncertainty boundaries (covered slices)
  - Covered in local tests: unknown direct call, callback invocation boundary (statement + assignment-form), await suspension boundary, assignment-based alias-escape, and indirect alias escape via helper passthrough.
  - Remaining: broader boundary parity coverage (more nested callback/escape forms and additional write-shape interactions).
- [ ] Step 7: Diagnostics for heuristic limits
- [x] Step 8: Parity and regression sweep (local parity suite)
  - Added dedicated local parity test coverage in `identityModifierParity.ts` for repeated-read success, callback boundary invalidation, await boundary invalidation, write-call analog invalidation, and one-liner ternary shape.
  - Added discriminated-union identity parity coverage for kind-guard narrowing and post-unknown-call invalidation.
  - Added comprehensive getter-to-identity parity visibility sweep in `identityModifierGetterParitySweep.ts` with categorized sections (repeated reads, branch merges, callback/await, write invalidation, aliasing, ternary, nested access).
  - Current getter-comparable parity score in the sweep is `5/9` matched categories, with `4/9` conservative mismatches.
  - Remaining: expand parity mapping against additional submodule scenarios.
- [ ] Step 9: Performance guardrails/perf checks

### Next Focus (Immediate)
1. Expand Tier 2 guarded precision beyond trivial local passthrough forms while preserving soundness.
2. Add diagnostics for heuristic-limit and low-confidence cases (Step 7).
3. Continue parity-gap reductions from the sweep (`P3`, `P4`, `P6`, nested unknown-call in `P8`) in narrow red/green slices.

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

### Latest Increment (Tier 2 Narrow Precision)
- Added a Tier 2 positive case in `testdata/tests/cases/compiler/identityModifierTier2.ts` for inline trivial passthrough forwarding:
  - `const fwd = ((x) => x)(read);` does not invalidate prior `identity` narrowing.
- Extended Tier 2 positive coverage to local const helper identifiers with trivial passthrough bodies:
  - `const localId = <T>(x: T) => x; const forwarded = localId(read);` preserves narrowing.
- Extended Tier 2 positive coverage to a small `const` helper alias chain:
  - `const localId = <T>(x: T) => x; const localId2 = localId; const forwarded = localId2(read);` preserves narrowing.
- Extended Tier 2 positive coverage to local function declaration helpers with trivial passthrough bodies:
  - `function localFnId<T>(x: T) { return x; } const forwarded = localFnId(read);` preserves narrowing.
- Kept conservative invalidation for non-inline helper passthrough patterns:
  - `const forwarded = pass(read);`
  - `useReader(pass(read));`
- Kept mutable/reassigned local helpers conservative by design:
  - `let localMaybeId = <T>(x: T) => x; localMaybeId = pass; localMaybeId(read);` invalidates prior narrowing.
  - `const localId = <T>(x: T) => x; let maybeAlias = localId; maybeAlias = pass; maybeAlias(read);` invalidates prior narrowing.
- Kept non-trivial local function helper bodies conservative by design:
  - `function localFnWrap<T>(x: T) { return () => x; } localFnWrap(read);` invalidates prior narrowing.
- Checker change is intentionally narrow and syntactic in `internal/checker/flow.go`:
  - exempt only call initializers that are inline trivial passthrough function values, identifier callees that resolve to trivial local function declarations, or identifier callees that resolve through a small `const` alias chain to trivial passthrough function-like values
  - accepted forms: single parameter, body is parameter expression or single `return` of parameter
  - implementation guardrails: alias-chain depth limit and cycle detection; mutable or reassigned paths remain conservative
- Remaining Tier 2 gaps:
  - no precision preservation yet for mutable/reassigned helper identifiers even when their initial value is trivial passthrough
  - no precision preservation yet for broader named/non-inline helper shapes outside local `const` trivial passthrough
  - no deeper effect proof; fallback remains conservative by design outside this syntactic shape
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
  - `identityModifierDiagnostics.ts`

### Latest Increment (Boundaries - Narrow Slice)
- Added `testdata/tests/cases/compiler/identityModifierBoundaries.ts` for expression-statement call boundaries.
- Binder change (`internal/binder/binder.go`): expression-statement calls now create flow-call nodes (`maybeBindExpressionFlowIfCall`).
- Checker change (`internal/checker/flow.go`): conservative invalidation of identity-call narrowing across non-matching flow-call boundaries.
- This narrow boundary slice is green in local tests and remains green in full `hereby` validation.

### Latest Increment (Boundaries - Conditional Initializer Callback Form)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with a conditional initializer callback-boundary case:
  - `const conditionalCallbackResult = true ? invoke(() => {}) : invoke(() => {});`
  - post-boundary read now widens as expected (`const afterConditionalCallbackCall: string = read();` reports error)
- Binder change (`internal/binder/binder.go`): `bindConditionalExpressionFlow` now invokes `maybeBindExpressionFlowIfCall` on both `whenTrue` and `whenFalse` branches, ensuring branch call boundaries participate in flow.
- `maybeBindInitializerFlowIfCallbackCall` remains conservative and call-expression scoped; conditional branch coverage is handled in conditional flow binding.
- Targeted red/green evidence:
  - red: `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner`
  - green: `npx hereby baseline-accept` then re-run targeted identity local suite

### Latest Increment (Parser Disambiguation Stability)
- Fixed a parser ambiguity where `identity<...>` in type-reference positions was being misclassified as the start of an identity function type.
- Parser change (`internal/parser/parser.go`): `nextTokenStartsIdentityFunctionOrConstructorType` now requires an unambiguous function-type parameter list before accepting `identity` + `<...>` as function-type syntax.
- This removes the submodule regression in `declarationEmitMappedTypePreservesTypeParameterConstraint.ts` while preserving Phase 1 identity tests.
- Validation after this fix is green for required commands:
  - `npx hereby build`
  - `npx hereby test`
  - `npx hereby lint`
  - `npx hereby format`

### Latest Increment (Parity Test Slice)
- Added `testdata/tests/cases/compiler/identityModifierParity.ts` as a dedicated local parity test for issue-family patterns.
- Covered scenarios in a single focused test:
  - repeated-read stable narrowing success
  - callback uncertainty-boundary invalidation
  - await uncertainty-boundary invalidation
  - setter/write-call analog invalidation (`store.read()` + `store.set(...)`)
  - one-liner ternary shape (`read() !== undefined ? read() : fallback`)
- Red/green completed with targeted run:
  - red: `go test -run='TestLocal/identityModifierParity\.ts' ./internal/testrunner`
  - green: accepted only `identityModifierParity` baselines and re-ran targeted identity suite

### Latest Increment (Discriminated-Union Identity Parity)
- Extended `testdata/tests/cases/compiler/identityModifierParity.ts` with a discriminated-union shape:
  - positive narrowing: `if (shape().kind === "circle") { const r: number = shape().radius; }`
  - boundary invalidation: unknown call between guard and repeated read reports expected error
- Red phase was run first:
  - `go test -run='TestLocal/identityModifierParity\.ts' ./internal/testrunner`
- Implementation result:
  - no checker/binder/parser code changes were needed for this slice; existing Phase 1 behavior already satisfies the covered discriminant scenario.
- Baseline + validation:
  - accepted relevant parity baselines (`identityModifierParity.errors.txt`, `identityModifierParity.symbols`, `identityModifierParity.types`)
  - re-ran targeted identity suite and required full `hereby` validation (`build`, `test`, `lint`, `format`)

### Latest Increment (Boundaries - Await Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with an `await` uncertainty-boundary scenario.
- Red phase: targeted local test failed before implementation due missing post-`await` invalidation.
- Green phase binder change (`internal/binder/binder.go`): `maybeBindExpressionFlowIfCall` now also emits a flow-call boundary for `AwaitExpression` statement forms.
- Checker behavior reused existing conservative call-boundary invalidation logic in `getTypeAtFlowCall` (`internal/checker/flow.go`), producing the expected post-`await` widening.
- Accepted only relevant baselines for this slice:
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.errors.txt`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.symbols`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.types`

### Latest Increment (Boundaries - Alias Escape Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with a minimal alias-escape scenario (`const escapedRead = read`).
- Red phase: `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner` failed with boundary baseline mismatch before checker updates.
- Green phase checker change (`internal/checker/flow.go`): `getTypeAtFlowAssignment` now invalidates parameterless call-reference narrowing when the callee is assigned/aliased (variable declaration or assignment RHS).
- Added helper: `isAliasEscapeAssignmentForCallReference` for narrow assignment-based alias-escape detection.
- Accepted only relevant boundary baselines and revalidated the targeted identity suite.

### Latest Increment (Boundaries - Alias Escape Reassignment Case)
- Extended `identityModifierBoundaries.ts` with a second alias-escape form using binary assignment (`reassignedRead = read`).

### Latest Increment (Tier 1 Write-Form Parity Expansion)
- Extended `testdata/tests/cases/compiler/identityModifierParity.ts` with small write-form parity scenarios:
  - property setter assignment invalidation (`propertyModel.value = ...`)
  - callable setter-style invalidation on same callable symbol (`hybrid("next")`)
  - callable direct `undefined` write invalidation (`hybrid(undefined)`)
- Red phase executed first via:
  - `go test -run='TestLocal/identityModifierParity\.ts' ./internal/testrunner`
- Green result required baseline updates only; no parser/binder/checker code changes were needed for this narrow slice.
- Accepted only relevant parity baselines:
  - `testdata/baselines/reference/compiler/identityModifierParity.errors.txt`
  - `testdata/baselines/reference/compiler/identityModifierParity.symbols`
  - `testdata/baselines/reference/compiler/identityModifierParity.types`
- Existing alias-escape invalidation logic in `getTypeAtFlowAssignment` correctly widens `read()` after reassignment escape, so no additional checker changes were required for this slice.
- Accepted updated boundary baselines and re-verified the focused identity local suite:
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
  - `identityModifierDiagnostics.ts`
  - `identityModifierBoundaries.ts`

### Latest Increment (Boundaries - Await Assignment Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with `const x = await delay()` and a post-await read assertion.
- Red phase confirmed mismatch with targeted run:
  - `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner`
- Green phase binder change (`internal/binder/binder.go`): `bindVariableDeclarationFlow` now emits a flow-call boundary when a declaration initializer is an `AwaitExpression`.
- Checker behavior remained unchanged in this slice and reused existing conservative call-boundary invalidation in `getTypeAtFlowCall` (`internal/checker/flow.go`).
- Accepted only relevant boundary baselines:
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.errors.txt`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.symbols`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.types`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.types`

### Latest Increment (Boundaries - Callback Assignment-Form Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with `const result = invoke(() => {})` and a post-call read assertion.
- Red phase confirmed mismatch with targeted run:
  - `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner`
- Green phase binder change (`internal/binder/binder.go`): `bindVariableDeclarationFlow` now emits a flow-call boundary for declaration initializers that are callback-argument call expressions.
- Checker behavior remained unchanged in this slice and reused existing conservative call-boundary invalidation in `getTypeAtFlowCall` (`internal/checker/flow.go`).
- Accepted only relevant boundary baselines:
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.errors.txt`

### Latest Increment (Boundaries - Indirect Callback Argument Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with an indirect helper callback argument form:
  - `const indirectCallbackResult = invoke(pass(() => {}));`
- Red phase confirmed missing invalidation for this shape in targeted boundary tests.
- Green phase binder change (`internal/binder/binder.go`): assignment-form callback boundary detection now recognizes helper-wrapped callback argument expressions, not only direct inline arrow/function arguments.
- Checker behavior remained unchanged in this slice and reused existing conservative flow-call invalidation in `getTypeAtFlowCall` (`internal/checker/flow.go`).
- Accepted only relevant boundary baselines:
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.errors.txt`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.symbols`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.types`
  - `testdata/baselines/reference/compiler/identityModifierBoundaries.symbols`

### Latest Increment (Boundaries - Indirect Alias Passthrough Slice)
- Extended `testdata/tests/cases/compiler/identityModifierBoundaries.ts` with helper passthrough alias escape:
  - `const indirect = pass(read);`
  - post-passthrough `read()` assignment to `string` now expected to error.
- Red phase confirmed mismatch with targeted run:
  - `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner`
- Green phase checker change (`internal/checker/flow.go`): alias-escape assignment detection now also treats initializer/assignment RHS call expressions that receive the endpoint reference as argument as escape boundaries.
- Targeted identity suite is green after baseline acceptance:
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
  - `identityModifierDiagnostics.ts`
  - `identityModifierBoundaries.ts`

### Latest Increment (Tier 2 Guarded Invalidation Starter Coverage)
- Added `testdata/tests/cases/compiler/identityModifierTier2.ts` as a narrow starter test for candidate Tier 2 shapes:
  - local alias-preserving forwarding (`const forwarded = pass(read)`)
  - helper passthrough argument form (`useReader(pass(read))`)
- Scenarios are explicitly labeled as:
  - `current conservative`: narrowing is dropped and post-boundary reads are expected errors today
  - `Tier 2 target`: future guarded precision preservation when forwarding is provably stable/non-mutating
- TDD flow for this increment:
  - red first: `go test -run='TestLocal/identityModifierTier2\.ts' ./internal/testrunner`
  - accepted only `identityModifierTier2` baselines
  - green rerun of the same test and targeted identity suite including the new file
- No production parser/binder/checker changes were required for this starter coverage slice.

### Latest Increment (Getter Parity Sweep - P5 Write Slice)
- Chosen low-risk mismatch: `P5` write parity in `identityModifierGetterParitySweep.ts`.
- Rationale: unlike callback/await/unknown-call boundaries, this slice can be addressed with a narrow same-receiver call-shape rule and no broad control-flow refactor.
- Red phase (tests first):
  - Updated expectations in:
    - `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts`
    - `testdata/tests/cases/compiler/identityModifierParity.ts`
  - Targeted run failed as expected:
    - `go test -run='TestLocal/(identityModifierGetterParitySweep|identityModifierParity)\.ts' ./internal/testrunner`
- Green phase (minimal implementation):
  - Checker-only narrow change in `internal/checker/flow.go`:
    - `getTypeAtFlowCall` now consults `shouldPreserveReadSetCallNarrowing` before conservative call-boundary reset.
    - Preservation is limited to: zero-arg `read()` reference, same-receiver `.set(...)` call, single argument, and argument type excluding `null | undefined`.
- Baseline + targeted verification:
  - `npx hereby baseline-accept`
  - `go test -run='TestLocal/(identityModifierGetterParitySweep|identityModifierParity)\.ts' ./internal/testrunner`
  - Result: green.
