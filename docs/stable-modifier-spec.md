# SDD: Stable + Heuristic CFA for Signal-Style APIs

## 1. Document Control
- Status: Draft
- Audience: TypeScript language/design contributors, checker implementers, framework authors
- Scope: Checker behavior for callable getter narrowing and write invalidation

Terminology lock (normative):
- This document uses `stable` as the canonical modifier name for all normative statements in the current phase.
- Alternative names are informative only and do not affect parser/checker requirements in this SDD.
- Rename evaluation is deferred to a dedicated upstream naming checkpoint.

## 2. Executive Summary
Primary path:
- `stable` marks stable callable read endpoints.
- Tiered heuristics infer mutator impact for unannotated APIs.

Additional path:
- Explicit `mutator`/`invalidates` contracts are consulted when heuristic confidence is insufficient for parity-level guarantees.

Guarantee:
- In well-typed declarations, callable CFA must match or improve getter/setter CFA outcomes.
- Ambiguous multi-endpoint impact is diagnosable, not silently degraded.

Phase boundary decision:
- Constrained-overload post-call narrowing that depends on explicit contracts remains out of Phase 1 implementation scope.
- Phase 1 may include readiness-only slices (tests/spec/checklist) that do not require parsing or checking `mutator`/`invalidates` semantics.

Normative phase split:
- Phase 1 conservative core is mandatory and is the default behavior contract.
- Phase 1 heuristic parity preserves are optional, shape-guarded refinements that must not weaken conservative safety boundaries.
- Any preserve that does not satisfy guardrails must fall back to conservative invalidation.

## 3. Problem Statement
```ts
declare const value: () => string | undefined;
if (value() !== undefined) {
  value().toUpperCase(); // error today
}
```

## 4. Goals
- Parity-or-better local-flow narrowing versus getter/setter CFA.
- Predictable invalidation at writes and uncertainty boundaries.
- No callback-body introspection requirement.
- Practical performance on large codebases.

## 5. Non-Goals
- No dependency-graph theorem proving for computed/reactive relationships.
- No full interprocedural effect system prerequisite.
- No runtime/emit semantics changes.

## 6. Architecture

### 6.0 Normative Split: Conservative Core vs Heuristic Preserves
Phase 1 conservative core (normative, required):
- Repeated-read narrowing for stable `stable` reads in local flow.
- Invalidation at uncertainty boundaries (unknown calls, callbacks, async suspension, alias escape) unless a preserve rule explicitly applies.
- No callback-body introspection.
- No contract-dependent behavior (`mutator`/`invalidates`) in Phase 1 runtime checker decisions.

Phase 1 heuristic parity-preserve layer (normative constraints):
- Preserves may be applied only when the shape is fully recognized and guarded.
- Preserves must have mandatory negative controls demonstrating conservative fallback.
- Preserves must be locally bounded; no global dependency tracking or broad interprocedural assumptions.
- When guards do not hold, checker must conservatively invalidate.

### 6.1 Stable Contract (Required)
`stable` is the declaration-site anchor for stable callable read endpoints.

Normative constraints:
- The endpoint must be a parameterless call signature from declaration metadata.
- Repeated reads can reuse facts only when receiver stable is unchanged.
- Stable facts are keyed by endpoint symbol + flow node.

### 6.2 Heuristic Inference (Primary)
Tier 1 (high confidence, parity-guaranteeing by default):
- Direct receiver writes in same lexical scope.
- Known writable methods on same declaration symbol without extraction or aliasing.
- Syntactic writes with concrete receiver stable (`obj.set(v)`, `obj.update(...)`).

Tier 2 (medium confidence, parity-guaranteeing only with guards):
- Local alias-preserving forwarding with provable receiver stable.
- Simple wrappers forwarding to Tier 1 operations.
- Receiver-preserving helper calls where target symbol stable is proven at call site.

Tier 3 (low confidence, non-parity by default):
- Cross-file and dynamic-dispatch inference without explicit contracts.
- Unknown call targets, reassigned function aliases, or escaped receiver references.

Confidence thresholds:
- `high`: always eligible for invalidation action.
- `medium`: eligible only when symbol stable and receiver path are proven stable in the same flow region.
- `low`: not eligible for precision invalidation; must escalate.

Escalation rule:
- If parity cannot be guaranteed from heuristics, checker must consult explicit `mutator`/`invalidates`.
- If ambiguity remains after explicit metadata lookup, checker reports a diagnostic and falls back to conservative non-reuse of narrowed facts.

### 6.3 Explicit Contracts (Additional Functionality)
```ts
interface Store {
  stable user(): User | undefined;
  stable settings(): Settings | undefined;

  mutator setUser(v: User | undefined) invalidates user;
  mutator resetAll() invalidates user, settings;
}
```

Normative behavior:
- `invalidates` is declaration-time invalidation metadata, not a runtime dependency graph.
- One mutator can link to multiple stable endpoints.
- Missing or ambiguous invalidates on multi-endpoint declarations are diagnosable.

## 7. Functional Requirements
- FR1: Allow `stable` on parameterless getter call signatures.
- FR2: Reuse narrowing across repeated `stable` reads in local flow.
- FR3: Invalidate previous narrowing on resolved mutator impacts.
- FR4: Invalidate on uncertainty boundaries (unknown calls, callbacks, alias uncertainty, async boundaries).
- FR5: Keep mutator callback bodies opaque.
- FR6: Support signature-driven post-call narrowing for constrained mutator overloads (final-phase implementation target).
- FR7: Diagnose ambiguous multi-endpoint impact instead of silent precision downgrade.
- FR8: Implement tiered heuristic mutator-impact inference with explicit confidence boundaries.
- FR9: Provide diagnostics guiding authors to explicit contracts when heuristics are insufficient.

Phase 1 readiness requirement:
- FR10: Track constrained-overload explicit-contract behavior in Phase 1 planning artifacts with strict non-goals that prevent accidental broadening.

## 8. Core Semantics

### 8.1 Read Stability
Repeated reads from the same `stable` endpoint may reuse narrowing in stable local flow.

### 8.2 Deterministic Mutator Resolution Order
1. Resolve mutator call target and receiver stable.
2. Attempt Tier 1 inference.
3. If Tier 1 failed, attempt Tier 2 inference with stability guards.
4. If inferred confidence is `low`, query explicit `mutator`/`invalidates` metadata.
5. If no unique impacted endpoint set can be resolved on multi-endpoint declarations, emit ambiguity diagnostic.
6. Invalidate facts for resolved impacted endpoints.
7. Apply constrained-overload post-call narrowing (if selected signature permits).
8. Apply uncertainty-boundary invalidations.

### 8.3 Exact Invalidation Triggers
Checker must invalidate endpoint facts on:
- Resolved mutator calls (`set`, `update`, `reset`-class operations).
- Any unknown call that may write through the same receiver path.
- Callback/closure boundaries where writes may interleave before next read.
- Async suspension points (`await`, task scheduling boundaries) when receiver can be observed externally.
- Alias escape of receiver or mutator function where write capability becomes non-local.

Uncertainty-boundary policy:
- Conservative invalidation is the default at uncertainty boundaries.
- A boundary preserve is permitted only for explicitly listed, shape-guarded cases validated by dedicated positive and negative-control baselines.
- Preserve rules must not be generalized by analogy; unlisted variants remain conservative until separately validated.

### 8.4 Constrained Overload Effects
```ts
interface WritableSignal<T> {
  stable (): T;
  mutator update<U extends T>(fn: (value: T) => U): void;
}
```
If overload resolution selects constrained `U`, post-call endpoint type may narrow to `U`.
No callback-body inspection is required; effect is signature-driven.

Phase boundary:
- This effect requires explicit contract resolution (`mutator`/`invalidates`) and is therefore a final-phase behavior slice.
- Phase 1 can only add readiness artifacts for this effect (tests/checklists/spec detail), not runtime checker behavior.

Contract-dependency boundary:
- Heuristics alone must not synthesize contract-dependent post-call endpoint narrowing.
- Any narrowing effect that requires endpoint linkage provenance is contract-dependent and deferred until explicit `mutator`/`invalidates` resolution is active.

## 9. Parity Contract
Getter/setter baseline:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
```
Callable equivalent:
```ts
declare const model: {
  stable (): string | undefined;
  mutator set(v: string | undefined): void;
};
```
Required outcomes:
- repeated narrowed reads: parity expected
- write invalidation: parity expected
- uncertainty-boundary behavior: parity expected
- constrained-overload post-call narrowing: may exceed property parity

## 10. Diagnostics Contract
Ambiguity diagnostic (multi-endpoint impact unresolved):
- Code: `TSX0001` (placeholder)
- Shape: "Cannot determine which stable endpoint(s) are invalidated by this mutator call. Add explicit `invalidates` metadata or split mutator declarations."

Low-confidence heuristic diagnostic:
- Code: `TSX0002` (placeholder)
- Shape: "Mutator impact inference is low confidence for this call. Add explicit `mutator`/`invalidates` annotations to preserve narrowing precision."

Author guidance requirements:
- Must suggest concrete remediation (`invalidates`, declaration split, explicit mutator annotation).
- Must avoid implying runtime behavior changes.

Constrained-overload scope diagnostic rule:
- If explicit contracts are unavailable in Phase 1, checker behavior must remain conservative and must not synthesize constrained post-call narrowing from heuristics alone.

Conservative fallback diagnostic rule:
- When a preserve candidate fails guards or confidence requirements, checker must fall back conservatively and may emit guidance diagnostics without implying runtime semantics changes.

## 11. Checker Algorithm Sketch
```text
onStableRead(callExpr):
  endpoint = resolveStableEndpoint(callExpr)
  fact = flowFacts.lookup(endpoint, currentFlowNode)
  if fact valid: return fact.narrowedType
  return declaredReturnType(endpoint)

onMutatorCall(callExpr):
  receiver = resolveReceiverStable(callExpr)
  inferred = inferImpactedEndpointsByHeuristics(callExpr, receiver)

  if inferred.confidence == high:
    invalidates = inferred.endpoints
  else if inferred.confidence == medium and inferred.stabilityGuardsHold:
    invalidates = inferred.endpoints
  else:
    invalidates = resolveExplicitInvalidates(callExpr)

  if invalidates unresolved and receiver.hasMultipleStableEndpoints:
    reportAmbiguousImpact(callExpr)
    dropEndpointFacts(receiver)
    return

  invalidate(invalidates)
  applyConstrainedOverloadPostNarrowing(callExpr)
  applyBoundaryInvalidations(callExpr)
```

## 12. Implementation Mapping (tsgo)
Parser and AST:
- Parse new modifiers/metadata forms in parser paths under `internal/parser`.
- Represent `stable`, `mutator`, and `invalidates` metadata in nodes/types under `internal/ast`.

Binder and symbols:
- Bind endpoint/mutator metadata to declaration symbols in `internal/binder`.
- Track endpoint symbol IDs and mutator-to-endpoint link sets for checker lookup.

Checker and flow:
- Implement heuristic tier classifier and resolution order in `internal/checker`.
- Extend flow fact storage for endpoint-keyed narrowed types.
- Integrate invalidation and uncertainty boundaries into existing CFA transitions.

Diagnostics:
- Add dedicated diagnostics in checker diagnostic tables and reporting paths (`internal/diagnostics`, checker emit points).

Performance guardrails:
- Tier 1/Tier 2 checks must be bounded to local declaration/flow neighborhoods.
- Do not introduce global dependency graph walks in hot CFA paths.
- Cache resolved endpoint/link lookups per symbol and invalidate cache on incremental program updates.

## 13. Validation Matrix
| Scenario | Expected Outcome | Test Type |
| --- | --- | --- |
| Repeated `stable` reads after guard | Narrowing reused | Local compiler baseline |
| `mutator` write to single endpoint | Prior narrowing invalidated | Local compiler baseline |
| Multi-endpoint mutator with explicit `invalidates` | Correct selective invalidation | Local compiler baseline |
| Multi-endpoint mutator without resolvable impact | Ambiguity diagnostic + conservative facts | Local compiler baseline |
| Constrained overload `update<U extends T>` | Post-call narrowing to `U` | Local compiler baseline |
| Callback boundary after guard | Narrowing invalidated at boundary | Submodule/local CFA tests |
| Async boundary (`await`) after guard | Narrowing invalidated at boundary | Submodule/local CFA tests |
| Getter/setter equivalence scenarios | Parity with property CFA | Submodule parity tests |
| Heuristic low-confidence call | Diagnostic recommending explicit metadata | Local compiler baseline |
| Independent stable endpoint non-interference | `b()` does not invalidate unrelated `a()` narrowing | Local compiler baseline |
| HybridSignal overload resolution (`stable ()` + `(v): void`) | Stable overload selected on zero-arg call | Local compiler baseline |
| Aliased discriminant destructuring (`const { data, isSuccess } = useQuery()`) | Narrowing via destructured discriminant | Local compiler baseline |
| Class member `this.stable()` pattern | `this.read()` narrows in method body after guard | Local compiler baseline |

## 14. Rollout Plan (Impact Before Contracts)
The single authoritative phase table is maintained in [docs/stable-internal-design-document.md](stable-internal-design-document.md) (Section 4). All phase assignments are governed by that table. Key invariant: `mutator`/`invalidates` contracts appear **only** in Phase 5 (Final).

Ordered rationale:
- Phase 1 first captures largest practical value without new declaration contracts.
- Phase 2 is pulled early to maximize write behavior and getter/setter parity impact.
- Phase 3 follows once conservative defaults and parity baselines are stable.
- Phase 4 reduces integration/perf risk before contract-dependent behavior.
- Phase 5 is last because explicit contracts require the broadest parser/binder/checker coordination.

Final-phase readiness guardrails:
- No `mutator`/`invalidates` semantic activation in earlier phases.
- No constrained post-call narrowing before explicit-link resolution exists.
- No callback-body inspection.
- First final-phase slice should remain narrow:
  - Single-endpoint explicit contract.
  - Single mutator with one constrained generic overload (for example `update<U extends T>`).
  - Post-call narrowing only when constrained overload is selected and link resolution is unambiguous.
- Required final-phase tests before broadening:
  - Positive: constrained overload selected, endpoint narrows to `U`.
  - Negative: unconstrained overload selected, no post-call narrowing.
  - Negative: unresolved or ambiguous invalidates, no post-call narrowing plus ambiguity diagnostic.
  - Safety: callback body does not influence narrowing result.

## 15. Risks
- Heuristic false positives/negatives if tier boundaries are underspecified.
- Performance regressions from unbounded Tier 2 matching.
- Over-diagnostic noise if thresholds are too strict.

## 16. Design Decision Record
DDR-2026-03-10: Multi-perspective Phase 1 re-review.
- Decision: retain strict conservative core as normative baseline and treat parity preserves as guarded overlays.
- Decision: report progress using dual metrics: implemented-shape parity and corpus parity/refactor-stability.
- Decision: freeze broad carveout expansion unless invariant gates, mandatory negative controls, and perf guardrails are satisfied.
- Rationale: maximize soundness and refactor stability while permitting narrowly proven parity wins.
- Consequence: some getter-like shapes intentionally remain conservative in Phase 1 until additional evidence lands.

## 17. Alternatives Considered
- Status quo + temporaries: poor DX.
- Full effect system first: too broad.
- Dependency-graph CFA for computed: out of scope.
- Structural tree-following as sole mechanism: feasible with Go performance, but high complexity and parity risk as primary mechanism; better as heuristic layer reinforced by explicit contracts.

## 18. Related Issues
- https://github.com/microsoft/TypeScript/issues/60948
- https://github.com/microsoft/TypeScript/issues/57725
- https://github.com/microsoft/TypeScript/issues/9998
- https://github.com/microsoft/TypeScript/issues/40562
- https://github.com/microsoft/typescript/issues/49669
- https://github.com/angular/angular/issues/49161
- https://github.com/angular/angular/issues/62181

## 19. References
- docs/stable-modifier-research.md
- docs/stable-internal-design-document.md
- docs/stable-heuristic-tdd-plan.md
- https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- https://flow.org/en/docs/lang/refinements/
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis
- https://github.com/google/closure-compiler/wiki/Annotating-JavaScript-for-the-Closure-Compiler

## 19. Appendix: Naming Rationale (Informative)
Applied decision:
- Keep `stable` for proposal continuity in Phase 1 and current upstream discussion alignment.
- Defer renaming to an explicit upstream checkpoint once Phase 1 evidence is available.

Alternatives reviewed (informative):
- `stable`: intuitive but risks over-reading as global immutability.
- `getter`: approachable, but conflates callable endpoints with property getter semantics.
- `pure`: recognized term, but stronger than required and suggests side-effect guarantees outside this feature.
- `cached`/`memo`: communicate repeated-read behavior but imply runtime strategy not required by the type contract.

Reevaluation trigger:
- Revisit naming only when upstream proposal process explicitly opens naming review (for example at design sign-off/progression gate), informed by implementation evidence, diagnostic clarity feedback, and ecosystem ergonomics.

## 20. Forward Roadmap Alignment
Roadmap source of truth:
- The forward candidate list and parity matrices are maintained in `docs/stable-internal-design-document.md`.

Phase mapping:
- Phase 2 targets: parity breadth expansion — callback breadth parity, write-form matrix breadth, Tier 2 guarded forwarding breadth, submodule parity expansion, equality-chain reuse, discriminant-preserving nested access.
- Phase 3 targets: guarded precision hardening — deeper callback/forwarding families under strict proofs, expanded conservative/non-goal matrix, exhaustive switch carryover, optional-chain carryover, cross-file helper summaries.
- Phase 4 targets: stabilization, regression sweeps, perf trend checks, and conservative-gap documentation refresh.
- Phase 5 (final) targets: explicit `mutator`/`invalidates` fallback resolution, multi-endpoint ambiguity diagnostics, and constrained-overload post-call narrowing with explicit unique invalidates.

Guardrail alignment:
- Value-type invalidation relaxations must stay shape-guarded and conservative by default.
- Any relaxation beyond strict local proofs requires explicit parity tests against getter/setter baselines.
