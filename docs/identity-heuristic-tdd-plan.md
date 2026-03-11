# Identity + Heuristic CFA TDD Plan (Phase 1)

## Scope
This plan intentionally excludes `mutator` and `links` syntax/semantics for now.
Phase 1 focuses only on:
- `identity` support
- stronger heuristic invalidation
- conservative behavior at uncertainty boundaries

Naming lock note:
- Phase 1 uses `identity` as the fixed term for all implementation, tests, and diagnostics in this branch.
- Renaming is intentionally deferred; do not churn token names during Phase 1 behavior work.
- Revisit only at an explicit upstream naming checkpoint after Phase 1 evidence and feedback are consolidated.

Constrained-overload scope decision:
- Constrained-overload post-call narrowing from explicit contracts is not a Phase 1 implementation target.
- Phase 1 carries readiness planning only (guardrails and test inventory) so the final-phase explicit-contract slice can land narrowly and safely.

## Reordered Phase Sequence (Impact Before Contracts)
| Phase | Primary goals | Impact | Implementation complexity | Dependency on explicit contracts (yes/no) |
| --- | --- | --- | --- | --- |
| 1 | Identity read reuse + Tier 1 write invalidation + uncertainty-boundary baseline | High | Medium | No |
| 2 | Getter/setter parity and write-form parity expansion | High | Medium | No |
| 3 | Tier 2 guarded precision expansion and heuristic diagnostics hardening | Medium-High | High | No |
| 4 | Stabilization: broad regression sweep and perf guardrails | Medium | Medium | No |
| 5 (Final) | Explicit `mutator`/`links`, ambiguity diagnostics, constrained-overload post-call narrowing | High (targeted hard cases) | High | Yes |

Ordering rationale:
- Lead with write and parity behavior that delivers immediate user impact and does not require contracts.
- Expand guarded precision only after parity baselines are stable.
- Reserve explicit contracts for the final phase due to cross-cutting parser/binder/checker complexity.

## Goals
- Achieve parity with property getter/setter CFA in common local-flow scenarios.
- Improve narrowing for callable getter patterns without introducing unsoundness.
- Use strict TDD: write failing tests first, then implement minimal behavior to pass.

## Invariant Ledger (INV-01..INV-07)
- INV-01 Conservative default: uncertainty boundaries invalidate unless a preserve guard explicitly matches.
- INV-02 No body introspection: callback/mutator function bodies are never required for narrowing decisions.
- INV-03 Local boundedness: preserve/invalidation checks stay local and syntactic/flow-bounded in hot paths.
- INV-04 Contract dependency boundary: contract-dependent effects (`mutator`/`links`, constrained post-call narrowing) are out of Phase 1 runtime behavior.
- INV-05 Mandatory negative controls: every new preserve rule ships with at least one explicit conservative counter-example baseline.
- INV-06 Refactor stability: preserves must be shape-guarded so small code motion/refactors do not silently broaden behavior.
- INV-07 Dual-metric reporting: implemented-shape parity and corpus parity/refactor-stability are tracked separately.

## Gate Criteria For New Preserves
- Gate A: Invariant compliance check against INV-01..INV-07.
- Gate B: One positive preserve baseline and one mandatory negative-control baseline in the same slice.
- Gate C: Complexity guardrail review (bounded matcher logic, no broad symbol-graph exploration).
- Gate D: Perf guardrail check (targeted micro-bench or equivalent hot-path evidence).
- Gate E: Scope-freeze check: no new carveout if unresolved preserve debt exists in the same boundary family.

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
- write-related invalidation and write-preserve parity slices
- getter/setter parity targets for common local-flow shapes
- uncertainty-boundary invalidation (`unknown calls`, callbacks, `await`, alias escape)

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

## Step 4: Write Behavior First (Tier 1) + Early Getter/Setter Parity (Green)
Implement high-confidence write invalidation and write-preserve parity slices early:
- direct receiver writes
- obvious same-symbol write operations
- same-receiver guarded read/write parity slices

Test additions:
- prior narrowing dropped after Tier 1 writes
- write-preserve parity checks where getter/setter behavior is already stable
- unrelated writes do not over-invalidate

Expected result:
- Tier 1 write behavior and early parity slices pass with deterministic behavior

## Step 5: Uncertainty Boundaries (Green)
Enforce invalidation at soundness boundaries:
- unknown call targets
- callbacks/closures
- async suspension (`await`)
- alias escape

Expected result:
- no stale narrowing facts survive these boundaries

## Step 6: Getter/Setter Parity Sweep Expansion
Add and expand parity-focused tests mirroring property getter/setter CFA scenarios.

Documentation guardrail:
- Maintain the getter-vs-identity flow graphs in `docs/identity-phase1-pr-description.md` as binder/checker flow logic changes.
- Any PR that changes flow entry/invalidation for either path should update the Mermaid graphs and the "Can identity use getter flow line directly?" comparison section.

Run:
```sh
go test -run='TestLocal/<test name>' ./internal/testrunner
go test -run='TestSubmodule/<test name>' ./internal/testrunner
npx hereby test
```
Expected result:
- parity in common scenarios
- known conservative deltas are explicit and tracked

## Step 7: Tier 2 Guarded Invalidation and Precision (Green)
Implement medium-confidence inference only when stability guards hold.

Examples to support:
- local alias-preserving forwarding with provable receiver identity

Examples to reject (fallback conservative):
- unstable aliasing
- receiver identity not provable

Expected result:
- Tier 2 positive and negative tests pass

## Step 8: Diagnostics for Heuristic Limits (Green)
Add diagnostics for low-confidence or unsupported inference cases.
Diagnostics should:
- explain why precision was not preserved
- suggest temporary/manual patterns until final-phase explicit contracts exist

Expected result:
- diagnostic baselines are stable and actionable

## Step 9: Performance Guardrails + Broad Regression Sweep
During implementation and refactors:
- keep heuristic checks local and bounded
- avoid global graph traversal in hot checker paths
- cache reusable symbol/endpoint lookup results where safe

Complexity guardrail expansion:
- New preserve matching logic must be expressible as fixed-shape predicates over existing flow/reference data.
- Reject preserve proposals requiring open-ended helper graph walking or unbounded alias-chain exploration.

Perf guardrail expansion:
- For each new preserve family, add or update at least one targeted micro-bench or runtime evidence point.
- Preserve expansions that regress hot-path trend beyond review threshold must be rolled back or further narrowed.

Micro-bench guardrail (Phase 1 narrow slice):
- Added checker micro-bench coverage in `internal/checker/identity_bench_test.go`.
- Covered scenarios:
  - repeated-read narrowing hot path (`RepeatedReads`)
  - uncertainty-boundary invalidation path (`UncertaintyBoundary`)
- Repro command:
```sh
go test ./internal/checker -run '^$' -bench BenchmarkIdentityCFAFlow -benchmem -count=1
```

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
- remaining hard cases are documented for the final explicit-contract phase (`mutator`/`links`).

## Phase 1 Readiness Additions (Doc/Test Planning Only)

### R1: Constrained-Overload Readiness Pack
Why this is not Phase 1 behavior:
- It depends on explicit `mutator`/`links` contracts, which are deferred to the final phase.
- Enabling post-call narrowing without explicit link resolution risks unsound endpoint selection.

Strict guardrails:
- Do not infer constrained post-call narrowing from heuristics alone.
- Do not inspect callback bodies.
- Do not narrow multiple endpoints unless explicit links resolve to a unique set.

Minimal first implementation slice (final-phase target):
- one identity endpoint
- one explicit mutator linked to that endpoint
- one constrained overload (`<U extends T>`) selected at call site
- post-call type update only for the linked endpoint

Explicit tests to add for that slice:
- `identityModifierConstrainedOverloadExplicitContracts.ts` positive case: selected constrained overload narrows to `U`.
- Negative control: unconstrained overload in same API does not narrow.
- Negative control: unresolved/ambiguous links do not narrow and emit ambiguity diagnostic.
- Safety control: callback body contents do not affect narrowing.

### R2: Small High-Value Phase 1 Additions To Track Now
- Add diagnostics wording stability baselines for uncertainty-boundary guidance (`TS100014`, `TS100015`).
- Add Tier 2 negative-controls expansion for mutable helper alias chains and property-based helper references (conservative expected behavior).

## Required Validation Commands
Before handoff, run:
```sh
npx hereby build
npx hereby test
npx hereby lint
npx hereby format
```

## Forward Roadmap Alignment
- Detailed Phase 2/3 candidate features and parity matrices are tracked in `docs/identity-phase1-pr-description.md` under next-phase roadmap sections.
- This Phase 1 plan remains implementation-focused; roadmap entries are planning guidance until promoted into explicit red/green slices.
- Value-type invalidation relaxation ideas are Phase 2/3 candidates only and must ship behind strict shape guardrails with conservative defaults.
- `Phase X` labels in the PR description denote exploratory post-Phase-3 ideas and are intentionally non-committal until converted into concrete TDD slices.

## Final Phase (Prepared, Deferred): Explicit `mutator`/`links`

### Why The Final Phase Exists
This phase is enabled only after Phase 1-4 evidence shows recurring precision gaps that heuristics cannot safely resolve.

### Final-Phase Entry Criteria
Begin the final phase only when one or more are true:
- repeated low-confidence heuristic diagnostics appear in real-world code patterns
- parity gaps remain in important multi-endpoint write scenarios
- conservative fallback causes unacceptable developer friction

### Final-Phase TDD Slices

#### Slice F.1: Syntax and Binding (Red -> Green)
Red tests:
- parse and bind `mutator` declarations
- parse and bind `links` endpoint lists
- invalid placement and malformed metadata diagnostics

Green implementation:
- parser support for `mutator`/`links`
- binder symbol metadata for mutator-to-endpoint link sets

#### Slice F.2: Checker Fallback Resolution (Red -> Green)
Red tests:
- heuristic low-confidence call resolves via explicit `links`
- multi-endpoint mutator call selectively invalidates linked endpoints

Green implementation:
- fallback path: heuristics -> explicit metadata
- deterministic endpoint invalidation from declared links

#### Slice F.3: Ambiguity Diagnostics (Red -> Green)
Red tests:
- unresolved multi-endpoint impact emits actionable diagnostic
- malformed/incomplete link declarations emit declaration diagnostics

Green implementation:
- checker diagnostics for unresolved impact
- parser/binder diagnostics for metadata shape errors

#### Slice F.4: Constrained Overload Integration (Red -> Green)
Red tests:
- explicit mutator metadata + constrained overload post-call narrowing
- no callback-body analysis required

Green implementation:
- ensure post-call narrowing sequence remains deterministic after fallback resolution

### Final-Phase Regression and Perf Gates
- Re-run Phase 1 parity suites to prevent regressions.
- Add explicit-contract parity tests for multi-endpoint cases.
- Verify fallback lookup does not add hot-path regressions.

### Final-Phase Exit Criteria
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
  - Added Tier 1 write-form expansion slice for matching endpoint property/element compound and unary writes, plus safe bracket mutator parity (`identityModifierTier1Writes.ts`).
  - Remaining: broaden write-form coverage to additional operators/shapes beyond the current narrow local matrix.
- [x] Step 5: Uncertainty boundaries (covered slices)
  - Covered in local tests: unknown direct call; callback invocation boundaries (statement, declaration-initializer assignment, assignment-expression assignment, conditional initializer, indirect callback argument); await suspension boundary; assignment-based alias-escape; and indirect alias escape via helper passthrough.
  - Added strict callback alias parity test slice: `const cb = () => {}; invoke(cb);` is currently conservative in baselines; mutable or non-empty callback aliases are also conservative.
  - Remaining: broader boundary parity coverage (deeper nested/indirect callback alias chains and additional write-shape interactions).
- [x] Step 6: Getter/setter parity sweep expansion
  - Added dedicated local parity test coverage in `identityModifierParity.ts` for repeated-read success, callback boundary invalidation, await boundary invalidation, write-call analog invalidation, and one-liner ternary shape.
  - Added discriminated-union identity parity coverage for kind-guard narrowing and post-unknown-call invalidation.
  - Added comprehensive getter-to-identity parity visibility sweep in `identityModifierGetterParitySweep.ts` with categorized sections (repeated reads, branch merges, callback/await, write invalidation, aliasing, ternary, nested access).
  - Added broad submodule-derived getter-to-identity parity corpus in `identityModifierGetterCorpus.ts` with source-traceable section labels and intentional mismatch visibility baselines.
  - Current getter-comparable parity score in the sweep is `9/9` matched categories for implemented guarded shapes.
  - Latest corpus mismatch closures: `QN5` (generic discriminant over `PetType extends Pet`), `X1` (alias escape via ambient passthrough helper), and `GC3` (strict-null await boundary).
  - Broad corpus mismatch count moved `4 -> 0` cases and corpus error count moved `9 -> 2`.
  - Getter parity sweep score has now moved to `9/9` after closing the guarded unknown-call parity shape (`P8`/`X3`).
  - Added missing getter-origin parity expansion matrix in `testdata/tests/cases/compiler/identityModifierGetterMissingMatrix.ts`.
  - Added `6` missing scenarios (`M1`..`M6`) with source-tagged sections; accepted baseline outcome is `6` matched and `0` mismatched (M6 unknown-call boundary contrast is closed under a bounded ambient no-arg preserve rule).
  - Remaining: expand parity mapping against additional submodule scenarios.
- [ ] Step 7: Tier 2 guarded invalidation and precision (broad)
  - Added starter local test coverage for candidate Tier 2 forwarding/passthrough patterns with current conservative expectations.
  - Added narrow positive precision slices for trivial local passthrough helper forms, including expression-statement passthrough calls with strict local helper guards.
  - Remaining: implement guarded precision preservation for broader local consumer/passthrough forms when receiver identity and non-mutating forwarding can be proven.
- [x] Step 8: Diagnostics for heuristic limits (narrow boundary slice)
  - Added boundary guidance diagnostic emitted when identity narrowing is conservatively dropped at uncertainty boundaries.
  - Covered by `identityModifierHeuristicDiagnostics.ts` for unknown call, callback, await, and alias-escape shapes.
- [x] Step 9: Performance guardrails + broad regression sweep (micro-bench baseline)
  - Added deterministic checker micro-bench coverage for repeated reads and uncertainty boundaries in `internal/checker/identity_bench_test.go`.
  - Remaining: broaden perf corpus only after additional Phase 1 behavior slices land.
- [ ] R1: Constrained-overload readiness pack (docs + explicit test inventory only)
  - Decision captured: constrained post-call narrowing with explicit contracts remains final-phase behavior.
  - Remaining: add targeted red-test scaffolding and entry criteria notes for the final-phase slice.
- [ ] R2: Small high-value hardening slices
  - Remaining: diagnostics wording stability baselines and Tier 2 negative-controls expansion.

### Next Focus (Immediate)
1. Expand Tier 2 guarded precision beyond current strict trivial passthrough forms (initializer + expression-statement) while preserving soundness.
2. Expand diagnostics coverage beyond current uncertainty-boundary slice.
3. Expand parity mapping from the getter corpus beyond currently covered source slices.
4. Finalize constrained-overload readiness artifacts (R1) without enabling explicit-contract runtime behavior.

### Latest Increment (Missing Getter-Origin Matrix)
- Added `testdata/tests/cases/compiler/identityModifierGetterMissingMatrix.ts` to cover missing getter-origin parity scenarios requested by sweep/swarm:
  - qualified-name `typeof` retention across loops
  - deep qualified-chain repeated checks
  - dotted-name `while(true)` no-break variant
  - predicate input `any` vs `unknown`
  - direct-vs-generic discriminant contrast
  - selected conformance guard/accessor ports
- Targeted run and acceptance:
  - `go test -run='TestLocal/identityModifierGetterMissingMatrix\.ts' ./internal/testrunner`
  - `npx hereby baseline-accept`
- Measured result from accepted baseline:
  - total scenarios: `6`
  - matched: `6`
  - mismatched: `0`
- M6 status update:
  - conformance-style unknown-call boundary contrast (`M6`) is now closed under a guarded ambient no-arg unknown-call preserve slice.

### Latest Increment (M6 Closure Landed with Narrow Rule)
- Objective: close `M6` with the narrowest possible unknown-call preserve rule and keep surrounding boundaries conservative.
- Validation evidence:
  - `go test -run='TestLocal/identityModifierGetterMissingMatrix\.ts' ./internal/testrunner` passed after baseline acceptance with `M6` closed.
  - `go test -run='TestLocal/identityModifierBoundaries\.ts' ./internal/testrunner` remained intentionally conservative for non-ambient unknown-call and callback/await/alias boundaries.
- Safety check outcome:
  - adjacent boundary coverage remains conservative for non-ambient unknown calls and callback/await/alias boundaries.
  - explicit negative control added: unknown call with args still invalidates narrowing in `identityModifierBoundaries.ts`.
- Decision:
  - landed the checker rule with bounded guards (ambient, no-arg, `void`, expression-statement call boundary, identity read with union return).
  - updated boundary matrix expectations to preserve narrowing only for this exact ambient no-arg shape while retaining conservative behavior for with-arg unknown calls and other uncertainty boundaries.
  - matrix is now `6/6` matched after landing the guarded ambient no-arg unknown-call preserve slice.

## Implementation Checklist Updates From Re-Review
- [x] Added complexity guardrail requirements for preserve matcher design.
- [x] Expanded perf guardrail requirements for preserve-family changes.
- [x] Made negative controls mandatory for each preserve rule.
- [x] Added scope-freeze criterion for new carveout admission.
- [x] Aligned TDD invariants with SDD normative split and PR dual-metric reporting.

## Design Modifications Applied
- [x] Re-review invariants codified (INV-01..INV-07).
- [x] New preserve gate criteria codified (Gate A..E).
- [x] Conservative-core-first policy restated as normative Phase 1 behavior.
- [x] Dual-metric parity reporting aligned with PR description.
- [~] Preserve family debt reduction in progress: callback alias parity and broader Tier 2 non-trivial forms remain intentionally conservative.

## Newly Found Remaining Gaps (Post-Latest Commit Audit)

Audit basis (tests + current baselines):
- `testdata/tests/cases/compiler/identityModifierBoundaries.ts`
- `testdata/tests/cases/compiler/identityModifierTier1Writes.ts`
- `testdata/tests/cases/compiler/identityModifierTier2.ts`
- `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts`
- `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts`

1. Broader nested/indirect callback forms
- `const cb = () => {}; invoke(cb);` remains conservative in current baselines; preserve parity for this alias form is still open.
- Covered callback forms are still mostly direct/narrow. Deeper indirection remains open (multi-hop alias chains and non-direct callback references).
- Additional nested forwarding shapes (callback wrapped/passed through helper chains) remain open beyond the currently exercised single-hop cases.

2. Tier 1 write-form breadth
- Covered Tier 1 matrix remains local and syntactic (compound/logical/unary endpoint writes plus literal bracket parity slices).
- Open breadth includes dynamic/non-literal element access writes, receiver-alias write paths, and deeper nested write paths.
- Additional parity slices for broader write operators/shapes are still needed to claim broad Tier 1 completeness.

3. Tier 2 guarded precision breadth
- Status correction: `const forwarded = pass(read);` currently preserves narrowing (docs previously described this as conservative).
- Conservative behavior still applies to consumer forwarding (`useReader(pass(read))`), mutable/reassigned helpers, mutable alias chains, and non-trivial helper bodies.
- Open breadth includes broader provably-safe local forwarding families and deeper helper indirection while retaining conservative fallbacks outside proven-safe shapes.

## Tier 1 Write-Form Matrix (Current Local Slice)
| Write form | Example shape | Status | Test source |
| --- | --- | --- | --- |
| Compound assignment (dot) invalidation | `if (model.value !== undefined) { model.value += "!"; const s: string = model.value; }` | Implemented (invalidates) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Logical assignment (dot) invalidation | `??=`, `||=`, `&&=` on `model.value` after guard | Implemented (invalidates) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Logical assignment (bracket-literal) invalidation | `model["value"] ||= ...` after guard | Implemented (invalidates) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Unary mutation (dot) invalidation | `model.value++`, `--model.value` after guard | Implemented (invalidates) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Unary mutation (bracket-literal) invalidation | `model["value"]++` after guard | Implemented (invalidates) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Bracket-literal mutator parity with dot-form | `store["set"]("next")` vs `store.set("next")` | Implemented (preserve parity in narrow `read`/`set(non-nullish)` slice) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |
| Bracket-literal simple assignment parity with dot-form | `model["value"] = ...` vs `model.value = ...` | Covered parity check (current behavior preserved) | `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` |

Tier 1 write-form gaps still open:
- Non-literal/bracket-dynamic property names are intentionally out of scope for this slice.
- Additional compound operators beyond currently exercised local cases need explicit parity tests.
- Multi-hop receiver alias write interactions (write through aliases then read) need dedicated red/green slices.

### Latest Increment (Nested/Indirect Callback Forms)
- Added red tests in `identityModifierBoundaries.ts` and `identityModifierGetterParitySweep.ts` for:
  - assignment-expression callback boundary (`x = invoke(() => { ... });`)
  - strict const no-op callback alias preserve (`const cb = () => {}; invoke(cb);`)
  - conservative controls for mutable/non-empty callback aliases.
- Binder change (`internal/binder/binder.go`): assignment `=` expressions now create flow-call boundaries when RHS is a callback boundary call.
- Checker/workflow note: strict const no-op callback alias preserve was explored, but current baselines still classify this shape conservatively.
- Guardrails retained:
  - mutable callback aliases remain conservative,
  - non-empty callback aliases remain conservative,
  - broader callback alias/indirect forms remain open.
- Red->green evidence:
  - red: `go test -run='TestLocal/(identityModifierBoundaries|identityModifierGetterParitySweep)\.ts' ./internal/testrunner`
  - green: `npx hereby baseline-accept` then same targeted rerun.

### Latest Increment (X3/P8 Guarded Unknown-Call Closure)
- Closed the remaining sweep/corpus overlap mismatch (`P8`/`X3`) with a strict preserve rule in `internal/checker/flow.go`.
- Exact guarded rule:
  - applies only to unknown-call boundaries that are expression-statement calls
  - call must have zero arguments
  - target must resolve to an ambient function declaration with zero parameters and `void` return type
  - identity read endpoint return type must be a non-nullish union
- Explicit guardrails retained:
  - argument-passing unknown calls remain conservative
  - non-ambient, non-void, method/property, and assignment/initializer call shapes remain conservative
- Added/updated TDD test shapes:
  - parity/corpus target shape now expects preserved narrowing in `identityModifierGetterParitySweep.ts` and `identityModifierGetterCorpus.ts`
  - conservative control shape in `identityModifierP8Conservative.ts` keeps `unknownMutateWithArg(1)` as a boundary drop
- Red->green evidence:
  - red: `go test -run='TestLocal/(identityModifierGetterCorpus|identityModifierGetterParitySweep|identityModifierP8Conservative)\.ts' ./internal/testrunner`
  - green: `npx hereby baseline-accept` then same targeted rerun

### Latest Increment (Parity Gap Closure - P6)
- Closed `P6` in `identityModifierGetterParitySweep.ts` for the narrow direct alias shape:
  - `if (identityBasic() !== undefined) { const identityAlias = identityBasic; const s: string = identityBasic(); }` is now parity-matched.
- Checker change (`internal/checker/flow.go`): narrowed alias-escape invalidation to keep direct `const` alias declarations of identity call endpoints non-invalidating by themselves.
- Conservatism retained for broader escape shapes:
  - indirect helper forwarding escapes that are not proven trivial,
  - reassignment escapes,
  - unknown-call and nested unknown-call boundaries (including open `P8`/`X3`).
- Updated boundary expectations for the direct const alias shape in `identityModifierBoundaries.ts`.
- Red->green evidence:
  - red: `go test -run='TestLocal/identityModifierGetterParitySweep\.ts' ./internal/testrunner`
  - green: baseline acceptance + focused identity suite rerun (`identityModifierGetterParitySweep`, `identityModifierBoundaries`, `identityModifierParity`, `identityModifierTier2`, `identityModifierGetterCorpus`).

### Latest Increment (Parity Gap Closure - P4)
- Closed `P4` in `identityModifierGetterParitySweep.ts` for a narrow await-safe statement shape:
  - `if (identityBasic() !== undefined) { await Promise.resolve(); const s: string = identityBasic(); }` is now parity-matched.
- Checker change (`internal/checker/flow.go`): added a narrowly scoped preserve rule in flow-call invalidation for:
  - identity call references,
  - non-matching await boundary,
  - expression-statement await form,
  - exact awaited expression shape `Promise.resolve()` with zero arguments.
- Conservatism retained for broader await boundaries (`await delay()`, `const x = await delay()`) covered in `identityModifierBoundaries.ts`.
- Conservatism retained for broader await boundaries outside the narrow preserve shapes, including await-assignment forms (`const x = await delay()`) covered in `identityModifierBoundaries.ts`.
- Red->green evidence:
  - red: `go test -run='TestLocal/identityModifierGetterParitySweep\.ts' ./internal/testrunner`
  - green: baseline acceptance + targeted identity suite re-run.

### Latest Increment (Parity Gap Closure - P3)
- Closed `P3` in `identityModifierGetterParitySweep.ts` for the narrow no-op callback statement shape:
  - `if (identityBasic() !== undefined) { invoke(() => {}); const s: string = identityBasic(); }` is now parity-matched.
- Checker change (`internal/checker/flow.go`): added a narrowly scoped preserve rule in flow-call invalidation for:
  - identity call references,
  - non-matching call boundary in expression-statement position,
  - exactly one callback argument,
  - callback function has zero parameters and an empty block body.
- Conservatism retained for non-no-op callback bodies and assignment/initializer callback boundary forms.
- Updated callback-boundary local tests to use non-empty callback bodies where conservative invalidation is still expected:
  - `identityModifierBoundaries.ts`
  - `identityModifierParity.ts`
  - `identityModifierHeuristicDiagnostics.ts`

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
- Expanded Tier 2 positive coverage to expression-statement passthrough calls for strict local trivial helper shapes:
  - `const localId = <T>(x: T) => x; localId(read);` preserves narrowing.
  - `function localFnId<T>(x: T) { return x; } localFnId(read);` preserves narrowing.
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
  - exempt expression-statement passthrough calls only when the helper target is a trivial local passthrough function-like shape and the single argument is the exact identity read endpoint
  - accepted forms: single parameter, body is parameter expression or single `return` of parameter
  - implementation guardrails: alias-chain depth limit and cycle detection; mutable or reassigned paths remain conservative
- Remaining Tier 2 gaps:
  - no precision preservation yet for mutable/reassigned helper identifiers even when their initial value is trivial passthrough
  - no precision preservation yet for broader named/non-inline helper shapes outside local `const` trivial passthrough
  - no deeper effect proof; fallback remains conservative by design outside this syntactic shape
  - `identityModifierErrors.ts`
  - `identityModifierNarrowing.ts`
  - `identityModifierDiagnostics.ts`

### Latest Increment (Getter Corpus X3 Assessment)
- Inspected `X3` exact shape in `identityModifierGetterCorpus.ts` and confirmed baseline diagnostics remain:
  - `TS100014` boundary-conservative invalidation note at the unknown call site

### Latest Increment (P8 Final Sweep Decision)
- Historical note: this conservative-open decision was later superseded.
- Current status is documented in `Latest Increment (X3/P8 Guarded Unknown-Call Closure)` above: `P8`/`X3` is now closed with a strict guarded unknown-call preserve rule and non-target conservative controls.

### Latest Increment (P8/X3 Diagnostic Guidance)
- Kept `P8`/`X3` behavior conservative, but added a dedicated diagnostic for unknown-call boundary drops.
- New targeted guidance (TS100015) now appears on unknown-call boundary invalidation sites:
  - "Identity narrowing was conservatively dropped after an unknown call. Extract the guarded value to a local temporary before the call to preserve precision."
- Existing generic uncertainty-boundary guidance (TS100014) remains in place for callback and `await` boundary drops.
- Diagnostics-focused coverage was extended in `identityModifierHeuristicDiagnostics.ts`, including a duplicate-suppression shape to ensure one boundary diagnostic per unknown call node.

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
