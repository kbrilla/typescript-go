# SDD: Identity + Heuristic CFA for Signal-Style APIs

## 1. Document Control
- Status: Draft
- Audience: TypeScript language/design contributors, checker implementers, framework authors
- Scope: Checker behavior for callable getter narrowing and write invalidation

## 2. Executive Summary
Primary path:
- `identity` marks stable callable read endpoints.
- Tiered heuristics infer mutator impact for unannotated APIs.

Additional path:
- Explicit `mutator`/`links` contracts are consulted when heuristic confidence is insufficient for parity-level guarantees.

Guarantee:
- In well-typed declarations, callable CFA must match or improve getter/setter CFA outcomes.
- Ambiguous multi-endpoint impact is diagnosable, not silently degraded.

Phase boundary decision:
- Constrained-overload post-call narrowing that depends on explicit contracts remains out of Phase 1 implementation scope.
- Phase 1 may include readiness-only slices (tests/spec/checklist) that do not require parsing or checking `mutator`/`links` semantics.

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

### 6.1 Identity Contract (Required)
`identity` is the declaration-site anchor for stable callable read endpoints.

Normative constraints:
- The endpoint must be a parameterless call signature from declaration metadata.
- Repeated reads can reuse facts only when receiver identity is unchanged.
- Identity facts are keyed by endpoint symbol + flow node.

### 6.2 Heuristic Inference (Primary)
Tier 1 (high confidence, parity-guaranteeing by default):
- Direct receiver writes in same lexical scope.
- Known writable methods on same declaration symbol without extraction or aliasing.
- Syntactic writes with concrete receiver identity (`obj.set(v)`, `obj.update(...)`).

Tier 2 (medium confidence, parity-guaranteeing only with guards):
- Local alias-preserving forwarding with provable receiver identity.
- Simple wrappers forwarding to Tier 1 operations.
- Receiver-preserving helper calls where target symbol identity is proven at call site.

Tier 3 (low confidence, non-parity by default):
- Cross-file and dynamic-dispatch inference without explicit contracts.
- Unknown call targets, reassigned function aliases, or escaped receiver references.

Confidence thresholds:
- `high`: always eligible for invalidation action.
- `medium`: eligible only when symbol identity and receiver path are proven stable in the same flow region.
- `low`: not eligible for precision invalidation; must escalate.

Escalation rule:
- If parity cannot be guaranteed from heuristics, checker must consult explicit `mutator`/`links`.
- If ambiguity remains after explicit metadata lookup, checker reports a diagnostic and falls back to conservative non-reuse of narrowed facts.

### 6.3 Explicit Contracts (Additional Functionality)
```ts
interface Store {
  identity user(): User | undefined;
  identity settings(): Settings | undefined;

  mutator setUser(v: User | undefined) links user;
  mutator resetAll() links user, settings;
}
```

Normative behavior:
- `links` is declaration-time invalidation metadata, not a runtime dependency graph.
- One mutator can link to multiple identity endpoints.
- Missing or ambiguous links on multi-endpoint declarations are diagnosable.

## 7. Functional Requirements
- FR1: Allow `identity` on parameterless getter call signatures.
- FR2: Reuse narrowing across repeated `identity` reads in local flow.
- FR3: Invalidate previous narrowing on resolved mutator impacts.
- FR4: Invalidate on uncertainty boundaries (unknown calls, callbacks, alias uncertainty, async boundaries).
- FR5: Keep mutator callback bodies opaque.
- FR6: Support signature-driven post-call narrowing for constrained mutator overloads (Phase 2 implementation target).
- FR7: Diagnose ambiguous multi-endpoint impact instead of silent precision downgrade.
- FR8: Implement tiered heuristic mutator-impact inference with explicit confidence boundaries.
- FR9: Provide diagnostics guiding authors to explicit contracts when heuristics are insufficient.

Phase 1 readiness requirement:
- FR10: Track constrained-overload explicit-contract behavior in Phase 1 planning artifacts with strict non-goals that prevent accidental broadening.

## 8. Core Semantics

### 8.1 Read Stability
Repeated reads from the same `identity` endpoint may reuse narrowing in stable local flow.

### 8.2 Deterministic Mutator Resolution Order
1. Resolve mutator call target and receiver identity.
2. Attempt Tier 1 inference.
3. If Tier 1 failed, attempt Tier 2 inference with stability guards.
4. If inferred confidence is `low`, query explicit `mutator`/`links` metadata.
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

### 8.4 Constrained Overload Effects
```ts
interface WritableSignal<T> {
  identity (): T;
  mutator update<U extends T>(fn: (value: T) => U): void;
}
```
If overload resolution selects constrained `U`, post-call endpoint type may narrow to `U`.
No callback-body inspection is required; effect is signature-driven.

Phase boundary:
- This effect requires explicit contract resolution (`mutator`/`links`) and is therefore a Phase 2 behavior slice.
- Phase 1 can only add readiness artifacts for this effect (tests/checklists/spec detail), not runtime checker behavior.

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
  identity (): string | undefined;
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
- Shape: "Cannot determine which identity endpoint(s) are invalidated by this mutator call. Add explicit `links` metadata or split mutator declarations."

Low-confidence heuristic diagnostic:
- Code: `TSX0002` (placeholder)
- Shape: "Mutator impact inference is low confidence for this call. Add explicit `mutator`/`links` annotations to preserve narrowing precision."

Author guidance requirements:
- Must suggest concrete remediation (`links`, declaration split, explicit mutator annotation).
- Must avoid implying runtime behavior changes.

Constrained-overload scope diagnostic rule:
- If explicit contracts are unavailable in Phase 1, checker behavior must remain conservative and must not synthesize constrained post-call narrowing from heuristics alone.

## 11. Checker Algorithm Sketch
```text
onIdentityRead(callExpr):
  endpoint = resolveIdentityEndpoint(callExpr)
  fact = flowFacts.lookup(endpoint, currentFlowNode)
  if fact valid: return fact.narrowedType
  return declaredReturnType(endpoint)

onMutatorCall(callExpr):
  receiver = resolveReceiverIdentity(callExpr)
  inferred = inferImpactedEndpointsByHeuristics(callExpr, receiver)

  if inferred.confidence == high:
    links = inferred.endpoints
  else if inferred.confidence == medium and inferred.stabilityGuardsHold:
    links = inferred.endpoints
  else:
    links = resolveExplicitLinks(callExpr)

  if links unresolved and receiver.hasMultipleIdentityEndpoints:
    reportAmbiguousImpact(callExpr)
    dropEndpointFacts(receiver)
    return

  invalidate(links)
  applyConstrainedOverloadPostNarrowing(callExpr)
  applyBoundaryInvalidations(callExpr)
```

## 12. Implementation Mapping (tsgo)
Parser and AST:
- Parse new modifiers/metadata forms in parser paths under `internal/parser`.
- Represent `identity`, `mutator`, and `links` metadata in nodes/types under `internal/ast`.

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
| Repeated `identity` reads after guard | Narrowing reused | Local compiler baseline |
| `mutator` write to single endpoint | Prior narrowing invalidated | Local compiler baseline |
| Multi-endpoint mutator with explicit `links` | Correct selective invalidation | Local compiler baseline |
| Multi-endpoint mutator without resolvable impact | Ambiguity diagnostic + conservative facts | Local compiler baseline |
| Constrained overload `update<U extends T>` | Post-call narrowing to `U` | Local compiler baseline |
| Callback boundary after guard | Narrowing invalidated at boundary | Submodule/local CFA tests |
| Async boundary (`await`) after guard | Narrowing invalidated at boundary | Submodule/local CFA tests |
| Getter/setter equivalence scenarios | Parity with property CFA | Submodule parity tests |
| Heuristic low-confidence call | Diagnostic recommending explicit metadata | Local compiler baseline |

## 14. Rollout Plan
- Stage 1: Parse + bind metadata; no behavior changes.
- Stage 2: Identity read reuse + Tier 1 invalidation.
- Stage 3: Tier 2 guarded inference + diagnostics.
- Stage 4: Explicit `mutator`/`links` fallback resolution + ambiguity diagnostics.
- Stage 5: Constrained-overload post-call narrowing.
- Stage 6: Parity sweep and perf validation on submodule suites.

Phase 1 addition (planning only):
- Stage 1.5: Constrained-overload readiness pack (docs + targeted red-test inventory only; no parser/checker behavior changes).
  - Guardrails:
    - No `mutator`/`links` semantic activation in checker.
    - No constrained post-call narrowing unless Stage 4 explicit links resolution is present.
    - No callback-body inspection.
  - Minimal first implementation slice (for Stage 5):
    - Single-endpoint explicit contract only.
    - Single mutator with one constrained generic overload (for example `update<U extends T>`).
    - Apply post-call narrowing only when that constrained overload is selected and link resolution is unambiguous.
  - Explicit tests to add before Stage 5 implementation:
    - Positive: constrained overload selected, endpoint narrows to `U`.
    - Negative: unconstrained overload selected, no post-call narrowing.
    - Negative: unresolved or ambiguous links, no post-call narrowing plus ambiguity diagnostic.
    - Safety: callback body does not influence narrowing result.

## 15. Risks
- Heuristic false positives/negatives if tier boundaries are underspecified.
- Performance regressions from unbounded Tier 2 matching.
- Over-diagnostic noise if thresholds are too strict.

## 16. Alternatives Considered
- Status quo + temporaries: poor DX.
- Full effect system first: too broad.
- Dependency-graph CFA for computed: out of scope.
- Structural tree-following as sole mechanism: feasible with Go performance, but high complexity and parity risk as primary mechanism; better as heuristic layer reinforced by explicit contracts.

## 17. Related Issues
- https://github.com/microsoft/TypeScript/issues/60948
- https://github.com/microsoft/TypeScript/issues/57725
- https://github.com/microsoft/TypeScript/issues/9998
- https://github.com/microsoft/TypeScript/issues/40562
- https://github.com/microsoft/typescript/issues/49669
- https://github.com/angular/angular/issues/49161
- https://github.com/angular/angular/issues/62181

## 18. References
- docs/identity-modifier-research.md
- docs/identity-phase1-pr-description.md
- docs/identity-heuristic-tdd-plan.md
- https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- https://flow.org/en/docs/lang/refinements/
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis
- https://github.com/google/closure-compiler/wiki/Annotating-JavaScript-for-the-Closure-Compiler

## 19. Forward Roadmap Alignment
Roadmap source of truth:
- The forward candidate list and parity matrices are maintained in `docs/identity-phase1-pr-description.md`.

Phase mapping:
- Phase 2 targets: explicit `mutator`/`links` fallback, ambiguity diagnostics, constrained-overload post-call narrowing, and narrow Tier 2 guarded expansion.
- Phase 3 targets: broader dynamic-write precision, deeper callback/alias relaxations, and larger-scope helper-summary precision.

Guardrail alignment:
- Value-type invalidation relaxations must stay shape-guarded and conservative by default.
- Any relaxation beyond strict local proofs requires explicit parity tests against getter/setter baselines.
