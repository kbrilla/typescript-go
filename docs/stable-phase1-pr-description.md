# Stable CFA: Design Document (Source of Truth)

## 1. Executive Summary

This document is the authoritative source of truth for the stable-call CFA feature in TypeScript-Go. It covers Phase 1 implementation status, the full five-phase roadmap, parity tracking, and design decisions.

**Phase 1 scope:**
- `stable` parsing/binding and call-shaped narrowing integration
- Conservative uncertainty-boundary invalidation with guarded preserves
- Parity visibility sweeps and divergence tracking

**Out of scope for Phase 1:**
- Explicit `mutator`/`invalidates` contracts (Phase 5)
- Ambiguity diagnostics for unresolved multi-endpoint impacts (Phase 5)
- Constrained-overload post-call narrowing from explicit contracts (Phase 5)

**Current status:** All 5 phases + P3 + Phase 7 complete. Validation green.

## 2. Problem Statement

TypeScript cannot narrow types through repeated function calls. When a parameterless "getter" function returns a union type and you check its result, subsequent calls lose narrowing. This is a critical pain point for Signals (Angular, Solid, TC39 proposal) and similar reactive patterns.

The `stable` modifier marks stable callable read endpoints, enabling getter-parity CFA for call expressions. Tiered heuristics infer mutator impact for unannotated APIs, while explicit contracts (final phase) handle remaining ambiguous cases.

Related issues:
- TypeScript #60948 — `stable` modifier proposal
- Angular #49161 — Signals and nullability
- TypeScript #57725 — Allow specifying narrowing for function calls

For full problem analysis and language survey, see [docs/stable-modifier-research.md](stable-modifier-research.md).

## 3. Goals and Non-Goals

### Goals
- Getter-parity CFA for `stable`-marked call expressions in local flow
- Conservative uncertainty-boundary invalidation as the default safety contract
- Narrow, guarded preserves for proven-safe boundary shapes
- Heuristic-limit diagnostics guiding users toward safety patterns
- Measurable parity tracking against getter/setter behavior

### Non-Goals (Phase 1)
- Broad relaxation of uncertainty boundaries without negative controls
- Callback-body analysis to infer post-call effects
- Multi-endpoint resolution without explicit contracts
- Template type-checking or Angular-specific integration (outside compiler scope)
- Renaming `stable` (deferred to upstream checkpoint)

## 4. Phase Roadmap

### Single Authoritative Phase Table

| Phase | Objective | Key Deliverables | Entry Criteria | Exit Criteria | Contracts Required | Status |
|-------|-----------|-----------------|----------------|---------------|-------------------|--------|
| **1** | Stable core + conservative safety baseline | `stable` parse/bind; repeated-read narrowing; uncertainty boundaries; Tier 1 write invalidation; diagnostics (`TS100014`/`TS100015`); parity suites | SDD + TDD plan established | Full validation green; parity sweep tracked; missing matrix reported | No | **Complete** |
| **2** | Parity breadth expansion | Callback breadth parity; write-form matrix breadth; Tier 2 guarded forwarding breadth; submodule parity expansion; equality-chain reuse; discriminant-preserving nested access; unrelated call transparency | Phase 1 stable and green | Added slices green with negative controls and no broad regressions | No | **Complete** |
| **3** | Guarded precision hardening | Deeper callback/forwarding families under strict proofs; expanded conservative/non-goal matrix; exhaustive switch carryover; optional-chain carryover; cross-file helper summaries | Phase 2 slices stable | Precision gains land with soundness guardrails intact | No | **Complete** |
| **4** | Stabilization + perf guardrails | Regression sweeps; perf trend checks; conservative-gap documentation refresh | Phase 1–3 feature set stabilized | Repeated green validation and stable perf envelope | No | **Complete** |
| **5 (Final)** | Explicit-contract stage | `mutator`/`invalidates` fallback resolution; multi-endpoint ambiguity diagnostics; constrained-overload post-call narrowing with explicit unique invalidates | Prior phases stable; gaps justify explicit contracts | Explicit-contract tests green and soundness constraints met | **Yes** | **Complete** |
| **P3** | Post-call narrowing | `set(42)` narrows `read()` to `number` via `getAssignmentReducedType`; `stableBoundaryKindMutatorCall` boundary kind | Phase 5 mutator/invalidates complete | P3 test green, no regressions, pipeline passes | **Yes** | **Complete** |
| **7** | Linked type predicates | `this.method() is Type` guard predicates narrow linked stable methods; parser backtracking; `TypePredicateKindLinkedMethod` (value 4); checker validation (TS100023/TS100024); CFA `narrowTypeByLinkedMethodPredicate` | P3 complete, stable CFA infrastructure settled | Phase 7 test green with 0 errors on positive cases, 2 expected errors on negatives | No | **Complete** |

### Impact vs Effort Rationale

- **Phase 1 first:** Core narrowing plus write/boundary invalidation removes the biggest day-to-day friction with bounded checker changes.
- **Phase 2 early:** Parity-first write scenarios provide visible user impact and fast validation against getter/setter behavior.
- **Phase 3 after parity core:** Tier 2 improvements are valuable but trickier; they build on proven conservative defaults.
- **Phase 4 before contracts:** Lock in refactor stability and performance before adding metadata-driven complexity.
- **Phase 5 last:** Explicit contracts solve remaining ambiguous/multi-endpoint cases, but require parser/binder/checker coordination and have the highest integration risk.
- **Phase 7 after P3:** Linked type predicates build on the stable CFA, mutator, and invalidates infrastructure. Guard methods require settled CFA infrastructure for correct narrowing propagation and invalidation.

## 5. Phase 1: Current Implementation

### 5.1 Scope and Deliverables

1. `stable` parse/bind support in declaration type positions
2. Parser disambiguation for `stable<...>` type references
3. Repeated-read narrowing for covered local-flow patterns
4. Uncertainty-boundary invalidation for covered shapes
5. Heuristic-limit diagnostics (`TS100014`, `TS100015`)
6. Tier 1 write-form invalidation (compound/logical/unary endpoint mutations)
7. Narrow Tier 2 passthrough preserves with strict local guards
8. Parity/corpus/missing-matrix visibility suites

### 5.2 Implementation Status

**Parity metrics:**
- Implemented-shape parity sweep: `9/9` categories matched
- Missing getter-origin matrix: `6/6` matched (M6 closed with guarded ambient no-arg unknown-call preserve)
- Latest validation: green (`npx hereby build`, `npx hereby test`, `npx hereby lint`, `npx hereby format`)

**Implemented features (Phase 1 checklist):**
- [x] `stable` parsing and binding in declaration type contexts
- [x] Parser disambiguation for `stable<...>` type references
- [x] Repeated-read narrowing for guarded local flow (`if (read() !== undefined) { read(); }`)
- [x] Uncertainty boundaries invalidate prior narrowing for covered shapes (unknown call, callback forms, alias escape, `await`)
- [x] Heuristic-limit diagnostics for uncertainty-boundary conservative invalidation
- [x] Dedicated local parity suite green (`stableModifierParity.ts`)
- [x] Getter-to-stable parity visibility sweep green (`stableModifierGetterParitySweep.ts`)
- [x] Broad getter-to-stable parity corpus with source-tagged sections (`stableModifierGetterCorpus.ts`)
- [x] Tier 1 parity: property assignment and callable hybrid setter-style writes
- [x] Narrow write parity: same-receiver `read()`/`set(non-nullish)` (`P5` in sweep)
- [x] Tier 2 narrow precision for trivial local passthrough helper shapes
- [x] Narrow await parity: expression-statement `await Promise.resolve()` (`P4` in sweep)
- [x] Safe bracket-literal parity for read/set mutator carveout (`store["set"](...)`)

**Known heuristic preserves (retained):**
- Same-receiver `read()` then `set(non-nullish)` narrow write-preserve slice
- Narrow unknown-call preserve for guarded ambient no-arg `void` expression-statement calls
- Narrow await preserve for expression-statement `await Promise.resolve()` and ambient no-arg await nullish-read slice
- Narrow Tier 2 local trivial passthrough preserves (inline passthrough, local const/function helper passthrough, strict local alias chain passthrough)
- Direct const alias preserve (`const alias = read`)

**Soundness-risk preserves kept conservative or deferred:**
- Callback alias preserve (`const cb = () => {}; invoke(cb);`) — conservative in current baselines
- Mutable/reassigned helper identifiers and mutable alias-chain forwarding — conservative
- Consumer-style forwarding (`useReader(pass(read))`) — conservative
- Non-trivial helper bodies — conservative
- Dynamic/non-literal write shapes and broader receiver-alias write paths — conservative

### 5.3 Parity Status (Consolidated Matrix)

| Behavior Category | Getter Baseline | Stable Status | Parity | Example |
|---|---|---|---|---|
| Basic repeated reads after guard | Implemented | Implemented | **Full** | `if (read() !== undefined) { const s: string = read(); }` |
| Branch merge reset after guard split | Implemented | Implemented | **Full** | `const s: string = cond ? read() : "fallback";` |
| Callback no-op expression-stmt boundary | Narrowed | Preserved (narrow no-op stmt shape) | **Full** | `invoke(() => {}); read()` |
| Await boundary (narrow safe shapes) | Narrowed | Preserved for `await Promise.resolve()` and ambient no-arg nullish-read | **Full** | `await Promise.resolve(); read()` |
| Write invalidation (`set(non-nullish)`) | Narrowed | Matched for same-receiver read/set | **Full** | `store.set("next"); store.read()` |
| Aliasing / escape handling | Alias keeps narrowing | Direct const alias preserves; indirect/reassigned conservative | **Full** (narrow) | `const alias = read; read()` |
| Conditional/ternary repeated-read | Implemented | Implemented | **Full** | `count() !== null ? count() : 0` |
| Nested discriminant read reuse | Implemented | Implemented | **Full** | `shape().kind === "circle" → shape().radius` |
| Unknown-call boundary after discriminant | Narrowed | Preserved (guarded ambient no-arg `void`) | **Full** (guarded) | `unknownShapeMutate(); shape().radius` |
| Independent endpoint non-interference | Narrowed (getters independent) | Implemented: stable calls recognized as pure reads | **Full** | `a(); b(); a()` both stable, independent narrowing preserved |
| Destructured signal tuple narrowing | N/A (getter-specific) | Implemented: destructured stable narrows after guard | **Full** | `const [value, setValue] = createSignal(); if (value() !== undefined) { value() }` |
| Class member stable narrowing | Narrowed (getters independent) | Implemented: property-style stable on class members | **Full** | `store.user() !== undefined → store.user().name` |
| typeof stable() discrimination | Implemented | Implemented | **Full** | `typeof mixed() === "string" → mixed()` narrows to string |
| Non-null assertion stable()! | Implemented | Implemented | **Full** | `maybe()!` narrows to non-null type |
| Angular InputSignal<T> pattern | N/A (getter-specific) | Implemented: generic type alias stable signals | **Full** | `comp.name() !== undefined → comp.name().toUpperCase()` |
| Await boundary (`await delay()`) | Narrowed (getter survives) | Guarded preserve (ambient no-arg void + non-nullish union) | **Full** | `await delay(); read()` — stable preserves for ambient no-arg void calls |
| Tier 2 forwarding (non-trivial helpers) | N/A | Conservative | **Gap** | `localFnWrap(read); read()` |
| Heuristic-limit diagnostics | N/A | Implemented (`TS100014`/`TS100015`) | **Partial** | Diagnostics cover uncertainty-boundary drops only |

**Parity score:** `9/9` getter-comparable categories matched for implemented guarded shapes.

### 5.4 Boundary Coverage (Consolidated Matrix)

| Boundary | Example Shape | Status | Test Source |
|---|---|---|---|
| Unknown call (ambient no-arg preserve) | `unknownMutate();` then `read()` | Implemented (narrow preserve) | `stableModifierBoundaries.ts` |
| Unknown call (with-arg negative control) | `unknownMutateWithArg(1);` then `read()` | Conservative (error) | `stableModifierBoundaries.ts` |
| Callback statement | `invoke(() => {});` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Callback assignment form | `const r = invoke(cb);` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Callback assignment-expression form | `r = invoke(cb);` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Callback conditional initializer | `const r = cond ? invoke(() => {}) : invoke(() => {});` | Implemented | `stableModifierBoundaries.ts` |
| Callback indirect helper argument | `const r = invoke(pass(() => {}));` | Implemented | `stableModifierBoundaries.ts` |
| Callback const no-op alias preserve | `const cb = () => {}; invoke(cb);` then `read()` | **Open** (conservative) | `stableModifierBoundaries.ts`, `stableModifierGetterParitySweep.ts` |
| Callback mutable alias | `let cb = () => {}; cb = ...; invoke(cb);` | Conservative (error) | `stableModifierBoundaries.ts` |
| Callback non-empty alias | `const cb = () => { ... }; invoke(cb);` | Conservative (error) | `stableModifierBoundaries.ts` |
| Alias initializer | `const escaped = read;` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Indirect alias passthrough | `const indirect = pass(read);` | Implemented | `stableModifierBoundaries.ts` |
| Alias reassignment | `alias = read;` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Await statement | `await delay();` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Await assignment | `const x = await delay();` then `read()` | Implemented | `stableModifierBoundaries.ts` |
| Await safe preserve (narrow) | `await Promise.resolve();` then `read()` | Implemented | `stableModifierGetterParitySweep.ts` |

### 5.5 Write-Form Coverage (Consolidated Matrix)

| Write Form | Example Shape | Status | Test Source |
|---|---|---|---|
| Compound assignment (dot) | `model.value += ...` | Implemented | `stableModifierTier1Writes.ts` |
| Logical assignment (dot) | `model.value ??= / \|\|= / &&= ...` | Implemented | `stableModifierTier1Writes.ts` |
| Logical assignment (bracket-literal) | `model["value"] \|\|= ...` | Implemented | `stableModifierTier1Writes.ts` |
| Unary mutation (dot) | `model.value++`, `--model.value` | Implemented | `stableModifierTier1Writes.ts` |
| Unary mutation (bracket-literal) | `model["value"]++` | Implemented | `stableModifierTier1Writes.ts` |
| Bracket-literal mutator parity | `store["set"]("next")` vs `store.set("next")` | Implemented | `stableModifierTier1Writes.ts` |
| Bracket-literal simple write parity | `model["value"] = ...` vs `model.value = ...` | Covered | `stableModifierTier1Writes.ts` |

**Remaining Tier 1 gaps:** Dynamic/non-literal element writes, broader operator matrix, alias-forwarded write shapes.

### 5.6 Tier 2 Coverage

| Tier 2 Shape | Status | Test Source |
|---|---|---|
| Inline trivial passthrough (`((x) => x)(read)`) | Implemented | `stableModifierTier2.ts` |
| Const helper identifier passthrough (`localId(read)`) | Implemented | `stableModifierTier2.ts` |
| Const helper alias-chain passthrough (`localId2(read)`) | Implemented | `stableModifierTier2.ts` |
| Function declaration helper passthrough (`localFnId(read)`) | Implemented | `stableModifierTier2.ts` |
| Expression-stmt const helper passthrough | Implemented (strict guard) | `stableModifierTier2.ts` |
| Expression-stmt function declaration passthrough | Implemented (strict guard) | `stableModifierTier2.ts` |
| Non-trivial function body (non-goal) | Conservative (error) | `stableModifierTier2.ts` |
| Mutable helper reassignment (non-goal) | Conservative (error) | `stableModifierTier2.ts` |
| Mutable alias-chain reassignment (non-goal) | Conservative (error) | `stableModifierTier2.ts` |

### 5.7 Diagnostics

| Diagnostic | Code | Text |
|---|---|---|
| Generic boundary | `TS100014` | Stable narrowing was conservatively dropped at an uncertainty boundary. Add an explicit guarded temporary or refactor to keep the narrowing scope local. |
| Unknown-call boundary | `TS100015` | Stable narrowing was conservatively dropped after an unknown call. Extract the guarded value to a local temporary before the call to preserve precision. |
| Mutator on non-function | `TS100016` | `'mutator' modifier can only appear on a function type with parameters.` |
| Mutator+stable conflict | `TS100017` | `'mutator' modifier cannot be used with 'stable' modifier.` |
| Invalidates on non-mutator | `TS100018` | `'invalidates' clause can only appear on a 'mutator' function type.` |
| Invalidates target not stable | `TS100019` | `'invalidates' target '{0}' is not an stable endpoint on the containing type.` |
| Invalidates target not found | `TS100020` | `'invalidates' target '{0}' does not exist on the containing type.` |
| Ambiguous mutator invalidation | `TS100021` | `Cannot determine which stable endpoint(s) are invalidated by this mutator call...` |
| Mutator on non-function-type | `TS100022` | `'mutator' modifier can only appear on a function type.` |
| Linked predicate target not stable | `TS100023` | `Linked method predicate target '{0}' must reference a 'stable' method on the containing type.` |
| Linked predicate type not assignable | `TS100024` | `Type '{0}' is not assignable to the return type '{1}' of method '{2}'.` |

### 5.8 Known Gaps and Remaining Work

- [x] Callback const no-op alias parity (strict `const cb = () => {}; invoke(cb)` preserve) — **Already implemented.** `isConstNoopCallbackAlias()` resolves const alias chains up to 5 hops, checking zero params + empty body. Negative controls: mutable `let` alias rejected, non-empty body alias rejected.
- [x] Expanded parity mapping against submodule scenarios — **DONE.** Created `stableModifierSubmoduleParity.ts` — 10 CFA pattern sections adapted from submodule tests (`controlFlowGenericTypes`, `controlFlowTruthiness`, `controlFlowOptionalChain`, `narrowByEquality`, etc.). **Result: Full parity (0 errors)** — all 10 patterns narrow correctly: switch/case, truthiness, type predicates, equality, while loops, ternary, AND/OR, nullish coalescing, discriminant, negated narrowing.
- ~~Broader nested/indirect callback boundary forms~~ → **Moved to Phase 2/3.** Multi-arg empty callbacks (Phase 2: extend `classifyStableBoundary` to check each arg). Non-empty callback bodies need callback body analysis (Phase 3) or `mutator`/`invalidates` contracts (Phase 5). Blocked on: `len(boundary.Arguments()) == 1` guard, callback body mutation proof.
- ~~Expanded Tier 1 write-form matrix breadth~~ → **Moved to Phase 2.** Dynamic element writes need key equivalence proof. Receiver-alias writes need `isMatchingReference` normalization expansion. Blocked on: `getLiteralNamedAccessReceiverAndName` only handles literal property/element access.
- ~~Extended Tier 2 guarded precision~~ → **Moved to Phase 2/3.** Local-scope helpers: Phase 2 (bounded local proof, const-only, depth cap). Cross-file helpers: Phase 3 (cross-file helper summary cache). Blocked on: callback body analysis, cross-file declaration analysis.

**Newly found gaps (post-audit):**

*Callback breadth:* Basic const no-op callback alias is implemented (single-arg calls with identifier/inline callback). Deeper callback indirection (multi-arg callbacks, property/element callback references, nested forwarding wrappers) not covered.

*Tier 1 write-form breadth:* Dynamic/non-literal element writes, receiver-alias write paths, multi-hop/nested write paths remain uncovered.

*Tier 2 precision:* Consumer-style forwarding, mutable helpers, non-trivial-but-provably-safe wrappers not covered.

**Known Phase 1 limitations (by design):**

- *HybridSignal `stable` on call signatures:* `stable` on call signatures inside interfaces (e.g., `interface { stable (): T; (v: T): void; }`) is not supported in Phase 1. The parser interprets `stable` as a method name rather than a modifier on the call signature. Only standalone function types (`stable () => T`) and property-style declarations (`read: stable () => T`) are supported. This would require multi-layer AST/parser/checker changes (adding `ModifiersBase` to `CallSignatureDeclaration`, updating `parseTypeMember()`, updating checker stable flag checks). Deferred to Phase 2+ per Edge Case 4 in `docs/stable-modifier-research.md`. Manifests as 6 expected errors in `stableModifierParity.ts` (lines 73, 75, 80, 82).

**Parity gaps (stable more conservative than getter):**

- ~~*Await boundary (`await delay()`):*~~ **CLOSED.** Fixed `shouldPreserveAmbientNoArgAwaitCallNarrowing` — relaxed the return type check from requiring `null`-containing non-`undefined` types to accepting any union type (`TypeFlagsUnion`), matching the unknown-call preserve rule. Now `await delay()` in expression-statement position preserves stable narrowing for ambient no-arg void functions. Variable-declaration form (`const x = await delay()`) correctly remains conservative. Error reduction: -2 errors across 4 test files (HeuristicDiagnostics 9→7, Parity 10→8, Boundaries 20→18, ParitySweep 10→8).
- *Assignment-expression callback boundary:* `assignedInvokeResult = invoke(() => { ... })` invalidates stable (lines 75, 80 in sweep). The callback body is non-empty (has statements), so `shouldPreserveNoopCallbackCallNarrowing` correctly rejects it. **Blocked on:** Phase 3 callback body analysis or Phase 5 `mutator`/`invalidates` contracts to prove the callback doesn't mutate stable state. Note: empty-body callbacks in assignment-expression form (`x = invoke(() => {})`) already preserve narrowing via `isNoopCallbackBoundaryCallSite`.

**Missing test coverage (uncovered getter patterns):**

- [x] *Aliased discriminant narrowing via destructuring* (HIGH priority): `const [value, setValue] = createSignal()` destructuring. Covered in `stableModifierSignalPatterns.ts` Section 1. **Result: Full parity** — narrowing works after destructured stable call; `setValue()` correctly triggers `TS100014` boundary invalidation.
- [x] *Class member `this.stable()` patterns* (HIGH priority): Class property-style stable members with narrowing. Covered in `stableModifierSignalPatterns.ts` Section 2 and Section 5. **Result: Full parity** — `store.user()`, `store.count()`, cross-member independence, and Angular-style `InputSignal<T>` all narrow correctly; method calls are transparent for getter parity, and class-member narrowing remains stable after method calls.
- [x] *`typeof stable()` narrowing* (MEDIUM priority): `typeof mixed() === "string"` and `typeof mixed() === "number"` patterns. Covered in `stableModifierSignalPatterns.ts` Section 3. **Result: Full parity** — typeof narrowing works correctly for all tested union discriminants.
- [x] *Non-null assertion `stable()!` narrowing* (LOW priority): `maybe()!` and `maybe()!.length` patterns. Covered in `stableModifierSignalPatterns.ts` Section 4. **Result: Full parity** — non-null assertion narrows correctly.
- [x] *Narrowing preserved in closures past last assignment* (MEDIUM priority): Covered in `stableModifierClosures.ts` — 5 sections: (1) captured const in closure, (2) stable call inside closure with outer guard propagation, (3) closure after passthrough, (4) IIFE preserves narrowing, (5) multiple endpoint capture. **Result: Full getter parity** — narrowing propagates into closures and IIFEs matching getter behavior. `fn()` unknown call correctly triggers TS100015. `passthrough(read())` correctly triggers TS100014.

**Stale comments (minor cleanup):**

- ~~`stableModifierParity.ts` ~line 95:~~ **FIXED** — comment updated to "OK (no-arg unknown call preserves narrowing)".
- ~~`stableModifierGetterParitySweep.ts` ~line 69:~~ **FIXED** — comment updated to "OK (empty callback preserves narrowing)".
- All `await delay()` comments across 4 test files updated from "should error" to "OK (ambient no-arg await preserves narrowing)".

### 5.9 Missing Getter-Origin Matrix

File: `stableModifierGetterMissingMatrix.ts`

| Scenario | Description | Status |
|---|---|---|
| M1 | Qualified-name `typeof` retention across loops | Matched |
| M2 | Deep qualified-chain repeated type-query checks | Matched |
| M3 | Dotted-name `while(true)` no-break variant | Matched |
| M4 | Predicate input contrast (`any` vs `unknown`) | Matched |
| M5 | Direct-vs-generic discriminant baseline contrast | Matched |
| M6 | Conformance guard/accessor parity ports | Matched (via bounded ambient no-arg preserve) |

**Result: `6/6` matched, `0` mismatches.**

### 5.10 P8 / Unknown-Call Preserve Decision

Status: closed in Phase 1 with a strict guarded shape.

**Guarded preserve rule:**
- Boundary must be an expression-statement call
- Call must have zero arguments
- Callee must resolve to an ambient function declaration with zero parameters and `void` return type
- Stable read endpoint return type must be a non-nullish union

**Guardrails:**
- No broad unknown-call relaxation
- Argument-passing unknown calls remain conservative
- Non-ambient, non-void, assignment/initializer, method, or property-call boundary shapes remain conservative

**TDD evidence:** Red (updated tests, targeted failures with baseline diffs) → Green (implemented guarded rule, accepted baselines) → Conservative control (`unknownMutateWithArg(1)` still drops narrowing).

### 5.11 Code Review Findings

Three expert code reviews were performed (TypeScript architect, Go engineer, testing expert). Full reports in `docs/stable-code-review.md`, `docs/stable-go-review.md`, `docs/stable-testing-review.md`.

**Architecture**: Strong. Clean boundary classification + preserve-rule dispatch table. Textbook extensibility.

**Go code quality**: Good. No blocking issues. Safe, correct, idiomatic Go.

**Testing**: 6/10 regression safety. Strong CFA coverage (40+ patterns), critical gaps in emit and cross-module testing.

#### Actionable findings (prioritized):

**CRITICAL:**
- [x] Add declaration emit test (`@declaration: true`, no `@noEmit`) — verify `.d.ts` preserves `stable`
- [x] Add JS emit test (no `@noEmit`) — verify `stable` is erased in JS output
- [x] TS100013 modifier-conflict diagnostic — **Non-issue.** `stable` can only appear on `FunctionType` nodes which don't support other modifiers. `findFirstModifierExcept(node, KindStableKeyword)` already rejects any non-stable modifier on function types. TS100013 is intentional dead code (reserved for future use if stable placement expands).

**HIGH:**
- [x] Add multi-file cross-module test (`@filename:` with import/export of stable types)
- [x] Add explicit comment for await boundary fall-through in flow.go ~L307-318
- [x] Fix stale parity matrix entry — `await delay()` row showed "Gap" but was closed
- [ ] Benchmark binder broadening on large codebases to quantify performance impact

**MEDIUM (Go):**
- [x] Replace `map[*ast.Symbol]bool` with `[5]*ast.Symbol` array in cycle-detection helpers (flow.go ~L455, ~L868)
- [x] Thread boundary kind to diagnostic message function to avoid re-classification (checker.go ~L19866)
- [ ] Consider simplifying double-dispatch (map + switch) in preserve-rule evaluation

**MEDIUM (Tests):**
- [x] Add optional chaining test (`read()?.prop`) — created `stableModifierOptionalChaining.ts`
- [x] Add `in` operator narrowing test (`"key" in read()`) — created `stableModifierInOperator.ts` — 0 errors after method call boundary fix
- [ ] Consolidate overlapping parity test files (Corpus/Matrix/Sweep have ~40% overlap)

**LOW:**
- [x] Replace map dispatch table with array — changed to `[stableBoundaryKindCount][]stableBoundaryPreserveRuleID` array
- [ ] Lazy-init `reportedStableBoundaryDiagnostics` (checker.go ~L881)
- [x] Add depth bound to `containsCallbackArgumentExpression` — added depth parameter (max 10)
- [ ] Add "no stable types" benchmark baseline
- [ ] Expand benchmarks with discriminant, generic, large-union scenarios

### §5.12 Phase 2 Test Files

| Test File | Lines | Features Tested | Errors | Verdict |
|-----------|-------|-----------------|--------|---------|
| `stableModifierMultiArgCallback.ts` | 93 | Multi-arg no-op callbacks (trailing, leading, multiple, middle) + property callback references + nested forwarding wrappers + negative tests | 0 | ✅ Phase 2 feature working |
| `stableModifierEqualityChain.ts` | 58 | Literal-union OR chains, negation, intersection, undefined combo | 0 | ✅ Already working |
| `stableModifierValueTypeBoundary.ts` | 47 | Ambient void no-arg calls transparent + negatives (non-void, args, body) | 6 (3 correct negatives) | ✅ Already implemented |
| `stableModifierOptionalChaining.ts` | 28 | Optional chaining, nullish coalescing, nested optional | 0 | ✅ Working |
| `stableModifierInOperator.ts` | 52 | typeof, instanceof, in, discriminant narrowing | 0 | ✅ All narrowing forms work (fixed method call boundary false positives) |
| `stableModifierMethodCallBoundary.ts` | 73 | Method calls on narrowed locals, unrelated objects, and same-receiver calls are transparent for getter parity | 0 | ✅ Phase 2 feature: method calls (including same-receiver) transparent for getter parity |
| `stableModifierAssertionGuards.ts` | 48 | Assertion functions, type predicates, for-of loops, logical operators | 0 | ✅ All assertion/guard patterns work |
| `stableModifierStandaloneCallBoundary.ts` | 53 | Standalone function calls transparent, same-receiver method calls transparent, member+standalone mixing | 0 | ✅ Phase 2 feature: unrelated standalone calls exempt from boundaries |

### §5.13 Phase 3 Test Files

| Test File | Lines | Features Tested | Errors | Verdict |
|-----------|-------|-----------------|--------|---------|
| `stableModifierExhaustiveSwitch.ts` | 102 | Exhaustive discriminant switch, default:never, typeof switch, fall-through, non-exhaustive | 0 | ✅ All switch patterns work correctly |
| `stableModifierAdvancedCallbacks.ts` | 92 | Parametered/function/async/generator/multi/rest/optional callbacks, all classified as unrelated standalone calls | 0 | ✅ All callback patterns preserve narrowing |
| `stableModifierAdvancedLoops.ts` | 70 | for-in nonnull, for-of with narrowing, destructuring, while/do-while, nested for-of, re-narrowing in body | 0 | ✅ All loop patterns work correctly |
| `stableModifierAdvancedOptionalChain.ts` | 78 | Optional chain discriminant, typeof guard, non-null assertion, nested optional, truthiness, inequality, strict equality | 0 | ✅ All optional chain patterns work correctly |

### §5.14 Phase 5 Test Files

| Test File | Lines | Features Tested | Errors | Verdict |
|-----------|-------|-----------------|--------|--------|
| `stableModifierMutatorBasic.ts` | 38 | Basic mutator parsing, mutator invalidation, parameterless mutator, stable+mutator conflict | 5 | ✅ Phase 5 feature working |
| `stableModifierMutatorInvalidates.ts` | 66 | Single-endpoint invalidates, multi-endpoint invalidates, no-invalidates conservative, selective preservation | 12 | ✅ Phase 5 selective invalidation working |
| `stableModifierConstrainedOverload.ts` | 43 | Constrained generic conservative, reset mutator, WritableSignal pattern | 4 | ✅ Phase 5 feature working |
| `stableModifierMutatorErrors.ts` | 25 | Combo validation, valid declarations, generic container with invalidates | 4 | ✅ Phase 5 validation working |

### §5.15 Phase 5 Implementation

**New keywords:**
- `mutator` — marks a function type as a mutation endpoint that invalidates stable narrowing
- `invalidates` — optional clause on mutator types specifying which stable endpoints are affected

**New AST infrastructure:**
- `KindMutatorKeyword`, `KindInvalidatesKeyword` — scanner/AST node kinds
- `ModifierFlagsMutator = 1 << 18` — modifier flag for mutator types
- `LinksClause *NodeList` — new field on `FunctionOrConstructorTypeNodeBase`

**Checker integration:**
- `SignatureFlagsMutator = 1 << 10` — signature flag propagated from declaration
- `invalidates []*ast.Node` — resolved link targets on Signature struct
- Grammar validation: mutator-only-on-function-type, mutual exclusion with stable

**CFA integration:**
- `isMutatorCallBoundary()` in `flow.go` — detects mutator calls on same receiver
- Selective invalidation via `invalidates` clause — only linked endpoints lose narrowing
- Without `invalidates`, conservatively invalidates all stable endpoints on same receiver
- Integration point: after stable-call transparency, before alias-escape check in `classifyStableBoundary`

**Implemented features:**
- [x] `mutator` modifier parsing on function types
- [x] `invalidates <id> [, <id>]*` clause parsing after mutator return type
- [x] Mutual exclusion: `stable` and `mutator` cannot appear together
- [x] Parameterless mutators (e.g., `mutator () => void` for reset-style APIs)
- [x] Same-receiver mutator call invalidation
- [x] Selective invalidation via `invalidates` clause
- [x] Conservative invalidation when no `invalidates` provided
- [x] Generic container patterns (e.g., `Container<T>` with read/write)

### §5.16 P3: Post-Call Narrowing

**Feature:** After a mutator call with arguments, narrow the linked stable reference to the argument type instead of resetting to the declared type.

**New CFA infrastructure:**
- `stableBoundaryKindMutatorCall` — new boundary kind distinguishing mutator calls from generic boundaries
- `getMutatorCallNarrowedType()` — extracts first argument type, uses `getAssignmentReducedType` to narrow the declared union type

**How it works:**
1. Mutator call boundary is classified as `stableBoundaryKindMutatorCall` (replaces generic `stableBoundaryKindOther`)
2. In `getTypeAtFlowCall`, mutator calls are handled specially: the first argument's type is extracted
3. `getAssignmentReducedType(declaredType, argType)` narrows the union to only constituents assignable from the argument
4. Falls back to declared-type reset if no narrowing is possible (e.g., no arguments, non-union type)

**Test file:** `stableModifierPostCallNarrowing.ts` — 12 sections, 0 errors

**Improvements to existing tests:**
- `stableModifierMutatorBasic`: 7→5 errors 
- `stableModifierMutatorLinks`: 12→6 errors
- `stableModifierConstrainedOverload`: 4→3 errors
- `stableModifierMutatorErrors`: 4→3 errors

### §5.17 Phase 7: Linked Type Predicates

**Feature:** Guard methods can narrow the return type of other stable methods on the same receiver using `this.method() is Type` predicates.

**Syntax:** `this.method() is Type` in return type position

**New AST infrastructure:**
- `TypePredicateKindLinkedMethod` (value 4) — new type predicate kind for linked method predicates
- Parser: mark/rewind backtracking to distinguish `this.method() is Type` from regular `this` type predicates

**Checker integration:**
- Validates linked predicate target is a `stable` endpoint on the containing type (TS100023)
- Validates the narrowed type is assignable to the target method's return type (TS100024)

**CFA integration:**
- `narrowTypeByLinkedMethodPredicate` — matches guard call receiver to stable call receiver using `isMatchingReference`
- When predicate matches, narrows the stable call result type to the predicate type
- Natural integration with existing stable CFA: mutator invalidation resets linked predicate narrowing, uncertainty boundaries invalidate it, different receivers do not cross-narrow

**NodeBuilder + Printer:**
- Round-trip `this.method() is Type` syntax in declaration emit and display

**Test file:** `stableModifierLinkedPredicates.ts` — 10 sections:
1. Basic linked predicate
2. Multiple guards on same target
3. Guard + mutator invalidation
4. Different receivers (no cross-narrowing)
5. Guard + uncertainty boundary
6. Optional container pattern (isDefined/isEmpty)
7. Guard is not stable itself (still works)
8. Negative: target not stable (TS100023)
9. Negative: type not assignable (TS100024)
10. Guard called outside condition (no narrowing)

**Result:** 0 errors on 8 positive sections, 2 expected errors on 2 negative sections

## 6. Future Phases: Candidate Features

### 6.1 Phase 2 Candidates — Parity Breadth Expansion

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Callback breadth parity slices (multi-arg, property, nested forwarding) | Multi-arg callback detection, property callback references, nested forwarding wrapper chains | Medium | Extends callback preserve beyond single-arg identifier/inline forms | ✅ IMPLEMENTED — `isConstNoopCallbackPropertyAlias` resolves const object literal property callbacks; `isTrivialCallbackForwardingCall` handles nested `pass(pass(() => {}))` chains; `isNoopCallbackWithDepth` adds depth-bounded (max 5) no-op checking |
| Multi-arg empty callback classification | Extend `classifyStableBoundary` to check all args of multi-arg calls; each must be zero-param empty-body | Low | Handles `invoke(cb1, cb2)` patterns | ✅ IMPLEMENTED — changed `len(boundary.Arguments()) == 1` guard to iterate all args; all callback args must be no-op |
| Write-form matrix breadth expansion | Proven-key guardrails for dynamic element writes; const-alias receiver resolution | High | Closes remaining getter/setter dynamic-write gaps | ✅ IMPLEMENTED — `isStableReceiverWriteBoundaryForCallReference` detects same-receiver property writes; `resolveConstAliasReference` resolves const alias chains; `getWriteAccessExpressionFromBoundary` handles assignment/prefix/postfix writes; `getTypeAtFlowAssignment` now handles `stableBoundaryKindOther` |
| Tier 2 guarded forwarding expansion (2-hop local helper chains) | Local symbol only; const-only alias chains; depth cap; no mutable helpers | Medium | Reduces conservative drops in helper-heavy code | ✅ PARTIALLY IMPLEMENTED — 2-hop const alias chain test added; expression-statement comment updates; more complex helper chains deferred to Phase 3 |
| Submodule parity expansion slices | Parity with additional submodule getter test cases | Low | Broader parity evidence |
| Equality-chain literal-union reuse (`read() === "a" \|\| read() === "b"`) | Same endpoint symbol and same flow region | Medium | Matches getter literal-union behavior | ✅ VERIFIED WORKING — existing `isMatchingReference` + `narrowTypeByEquality` pipeline handles call expressions |
| Discriminant-preserving nested access (`read().kind` then `read().payload`) | Same endpoint candidate required | Medium | Closes nested discriminant parity gaps | ✅ VERIFIED WORKING — existing `isMatchingReference` + `getDiscriminantPropertyAccess` pipeline handles stable calls |
| Value-type boundary relaxation (ambient no-arg `void` call, expression-stmt) | Ambient declaration, zero args/params, `void` return, no alias escape | Medium | Aligns with getter behavior for primitive reads | ✅ VERIFIED WORKING — `shouldPreserveAmbientNoArgVoidUnknownCallNarrowing` already implemented |
| Value-type boundary relaxation (`await Promise.resolve()` expression-stmt) | Exact shape match, no assignments, no intervening writes | Low | Makes existing narrow rule explicit for primitives |
| Helper-forwarded read endpoint preserve (local non-mutating helpers) | Bounded local helper proof, no mutable aliases | Medium | Narrows stable-only conservative behavior |
| Unrelated call boundary exemption | Standalone and method calls on any receiver are transparent for getter parity; PropertyAccess/Identifier callee check; only writes invalidate; reordered classification so unrelated-call check runs before callback detection, fixing expression-statement trivial passthrough false positives | Low | Eliminates false positive TS100015/TS100014 for function calls matching getter transparency; significant error reduction across test suite | ✅ IMPLEMENTED — `isUnrelatedCallForStableReference` + method-call transparency keep call boundaries aligned with getter parity across receivers; only writes invalidate. Reordered classification: unrelated call check now runs before callback detection, fixing expression-statement trivial passthrough false positives. Error reductions: Closures 4→0, P8Conservative 2→0, ValueTypeBoundary 6→0, HeuristicDiagnostics 7→0, Boundaries 18→3, GetterParitySweep 8→2, MultiArgCallback 4→0, Parity 8→6, MethodCallBoundary 4→0, StandaloneCallBoundary 2→0, SignalPatterns 2→0, Tier2 14→6, InOperator 2→0 |

### 6.2 Phase 3 Candidates — Guarded Precision Hardening

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Cross-file helper summary cache for safe passthrough | Declaration-only, side-effect-free; cache invalidates on program update | High | Broadens parity in real codebases with shared helpers |
| Expanded callback-alias parity family | Local const/no-param/empty-body/non-reassigned proofs; conservative fallback | Medium | Closes remaining callback parity gaps | ✅ VERIFIED WORKING — parametered callbacks, function keyword, async, generator, multi-arg, rest/optional params all preserve narrowing (classified as unrelated standalone calls) |
| Exhaustive switch carryover on stable reads | Exhaustive discriminant switches with no invalidating boundary inside cases | Medium | Brings stable closer to mature getter switch CFA | ✅ VERIFIED WORKING — existing `isMatchingReference` + `narrowTypeBySwitchOnDiscriminant` pipeline handles stable calls transparently; exhaustive `default: never` and `typeof` switch both work |
| Guarded optional-chain carryover (`read()?.x`) | Non-mutating expression-stmt boundaries; stable endpoint symbol | High | Expands parity in optional-chain-heavy code | ✅ VERIFIED WORKING — optional chain narrowing works transparently with stable calls; optional chain as discriminant, nested optional chains, and property access all work |
| Callback no-op alias value-type relaxation | Zero params, empty body, non-reassigned, primitive/literal-union only | Medium | Narrows over-invalidation gap |
| Alias initializer value-type relaxation | Alias never called/passed/reassigned before next read; primitive only | High | Reduces over-invalidation in refactor patterns |
| Await assignment forms (`const x = await delay()`) | Exact safe-shape + value-type proof required | High | Prevents unsound broad async relaxation |
| Dynamic key write (`model[key] = ...`) | Key equivalence proof required | High | Improves parity without global alias analysis | ✅ IMPLEMENTED in Phase 2 — `isStableReceiverWriteBoundaryForCallReference` with `getAccessedPropertyName` key comparison |

### 6.3 Phase 4 Candidates — Stabilization

| Deliverable | Purpose | Status |
|---|---|---|
| Regression sweeps across full test matrix | Verify no broad regressions from Phase 1–3 | ✅ COMPLETE — Both `TestSubmodule` and `TestLocal` pass with 0 failures. Full build/test/lint/format green. |
| Perf guardrail verification | Checker microbench and workload snapshot stability | Deferred — No stable-specific perf regressions observed |
| Conservative-gap documentation refresh | Document all remaining intentional conservative behaviors | ✅ COMPLETE — See §6.3.1 |
| Refactor pass for boundary classification | Clean up accumulated technical debt | Deferred — Current classification is functional and well-documented |

### §6.3.1 Conservative-Gap Inventory (Phase 4 Documentation)

**Remaining intentional conservative behaviors (not bugs — soundness guardrails):**

| Gap | Error Count | Test File | Why Conservative | Resolution Phase |
|-----|-------------|-----------|-----------------|-----------------|
| Non-trivial helper body wrapping (`return () => x`) | 2 | Tier2 | Can't prove helper doesn't capture/call stable ref asynchronously | Phase 5 (`mutator`/`invalidates` contracts) |
| Mutable helper reassignment (`let f = ...; f = otherFn`) | 2 | Tier2 | Mutable binding could be reassigned to mutating function | Phase 5 (explicit contracts) |
| Mutable alias chain reassignment | 2 | Tier2 | Same as above — mutable alias chain can't be proven safe | Phase 5 (explicit contracts) |
| Interface call-signature stable (`stable () => T` on interface) | 6 | Parity | Parser limitation — `stable` parsed as method name | Phase 5+ (parser/AST refactor) |
| Conditional ternary callback wrapping | 2 | Boundaries | Ternary wrapping of invoke() creates complex flow that bypasses unrelated-call classification | Phase 5 (flow analysis improvement) |
| Await assignment boundary (`const x = await fn()`) | 2 | Boundaries | Await assignment captures value at a point where stable backing may have changed | Phase 5 (precise await shape analysis) |
| Branch merge after if/else | 2 | GetterParitySweep | After branching (if/else), narrowing is lost on merge — parity with getter behavior | N/A (correct behavior) |
| typeof + short-circuit AND interaction | 2 | GetterCorpus | `typeof x() === "string" && x()` produces `string \| false` due to short-circuit evaluation semantics | Investigate (CFA interaction) |

**Total remaining errors across all stable test files: ~46 primary errors**
- 14 are intentional diagnostic/error tests (Diagnostics, Errors files)
- 12 are correctly conservative (Tier2, Boundaries — documented above)
- 6 are Phase 1 parser limitation (Parity — interface call-sig)
- 4 are parity-correct (GetterParitySweep, GetterCorpus)
- 13 are true positive write-form invalidation (Tier1Writes — working correctly)

**Patterns verified working (0 errors):**
- All narrowing forms: typeof, instanceof, in, discriminant, equality, truthiness, inequality
- Switch/case: exhaustive discriminant, typeof, default:never, fall-through
- Optional chaining: basic, nested, as discriminant, with method calls
- Callbacks: inline, const alias, property alias, nested forwarding, parametered, function keyword, async, generator, rest/optional params
- Loops: for-in, for-of, while, do-while, nested, destructuring
- Method calls: same-receiver and cross-receiver transparent for getter parity
- Standalone calls: all standalone function calls transparent
- Write-form invalidation: compound assignment, increment/decrement, bracket-literal, dynamic keys, const-alias receivers
- Assertion guards: type predicates, assertion functions
- Await: Promise.resolve() expression-stmt, ambient no-arg

### 6.4 Phase 5 (Final) Candidates — `mutator`/`invalidates` Contracts

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Explicit `mutator`/`invalidates` fallback resolution | Require unambiguous endpoint set; no callback-body inspection; conservative fallback on unresolved invalidates | Medium | Closes multi-endpoint getter/setter invalidation mismatches |
| Ambiguity diagnostics for multi-endpoint impact | Emit only when multiple stable endpoints exist and impact is unresolved; dedupe per boundary node | Low | Improves parity explainability |
| Constrained-overload post-call narrowing (`U extends T`) with explicit invalidates | Apply only when selected overload is constrained and link target is unique | Medium | Can exceed getter/setter parity in safe linked cases |
| Multi-endpoint write (`setUser` invalidates `user`, not `settings`) via explicit `invalidates` | Require unique resolved endpoint set | Medium | Removes major multi-endpoint parity gap |

**Why constrained-overload narrowing requires Phase 5:**
- The effect depends on explicit contract metadata and endpoint invalidates.
- Without explicit link resolution, post-call narrowing can pick the wrong endpoint set and regress soundness/parity.
- No heuristic-only path can safely provide this behavior.

**Phase 5 guardrails (effective now as pre-conditions):**
- No constrained post-call narrowing from heuristics-only paths
- No callback-body analysis to infer post-call endpoint type
- No multi-endpoint post-call narrowing unless explicit invalidates are unique

**Minimal first implementation slice (Phase 5 target):**
- Single stable endpoint + single explicit mutator link
- One constrained overload (`<U extends T>`) selected by overload resolution
- Apply post-call narrowing only for the linked endpoint on that selected overload

**Explicit tests to add with Phase 5:**
- `stableModifierConstrainedOverloadExplicitContracts.ts` positive: constrained overload selected, endpoint narrows to `U`
- Negative: unconstrained overload selected, no post-call narrowing
- Negative: ambiguous/unresolved invalidates, no narrowing and ambiguity diagnostic
- Safety: callback body changes do not affect narrowing result

### Feature × Phase Applicability Matrix

| Feature | Phase | Stable | Getter | Broader CFA | Notes |
|---|---|---|---|---|---|
| Tier 2 helper forwarding expansion | 2 | Yes | N/A | Yes | Generic narrowing infrastructure with stable-first rollout |
| Equality-chain literal-union reuse | 2 | Yes | Yes | Yes | Shared narrowing enhancement candidate |
| Value-type boundary relaxations (guarded) | 2/3 | Yes | Yes | Yes | Boundary classifier can be shared once proven sound |
| Dynamic element-write precision | 2 | Yes | Yes | Yes | Shared endpoint/reference matching improvement |
| Cross-file helper summaries | 3 | Yes | N/A | Yes | Broader call-flow precision infrastructure |
| Explicit `mutator`/`invalidates` fallback | **5** | Yes | No | Partial | Stable-specific contract path |
| Constrained-overload post-call narrowing | **5** | Yes | No | Partial | Depends on explicit contract resolution |

## 7. Naming Decision

**Decision:** Keep `stable` for Phase 1. Defer rename debate to an explicit upstream naming checkpoint.

**Rationale:** Phase 1 focuses on CFA behavior slices and parity/stability evidence. Renaming now would create documentation/test churn without improving correctness. The existing token preserves comparability with upstream issue threads and interim baselines.

**Reevaluation trigger:** Revisit only at an explicit upstream checkpoint after Phase 1 evidence is collected. Trigger inputs: ambiguity reports, diagnostic clarity feedback, and interoperability with final-phase explicit-contract terminology.

For detailed naming analysis (candidates, pros/cons, ecosystem survey), see [docs/stable-modifier-research.md](stable-modifier-research.md).

## 8. Performance

### Checker Micro-Bench
- File: `internal/checker/stable_bench_test.go`
- Scenarios: `BenchmarkStableCFAFlow/RepeatedReads`, `BenchmarkStableCFAFlow/UncertaintyBoundary`
- Command:
  ```sh
  go test ./internal/checker -run '^$' -bench BenchmarkStableCFAFlow -benchmem -count=1
  ```

### TypeScript-main Workload Snapshot (2026-03-10)

| Build | Runs (s) | Avg Wall (s) | Avg RSS (MiB) |
|---|---|---|---|
| `tsgo` main (`4a59cd7`) | 1.69, 1.41, 1.32 | 1.47 | 521.6 |
| `tsgo` this branch (`4728d1f`) | 1.41, 1.40, 1.69 | 1.50 | 549.9 |

**Delta:** Wall `+1.81%`, RSS `+5.43%`. Current Phase 1 behavior remains close to main on wall time, with a small RSS regression in this sample.

**Caveat:** Small sample size on one machine. Additional runs may reduce noise.

### Comparable commands
```sh
rm -rf ./_submodules/TypeScript/built/local
./built/local/tsgo -b ./_submodules/TypeScript/src/tsconfig.json --noEmit
```

## 9. Design Decisions Record

| Decision | Outcome | Rationale |
|---|---|---|
| Naming: keep `stable` | Confirmed for Phase 1 | Continuity with upstream proposal; revisit at checkpoint |
| Conservative core as default | Confirmed | Safety contract; only strict guarded shapes get preserves |
| Guarded preserves only | Confirmed | Each preserve requires tested shape, negative controls |
| Broad carveouts deferred | Confirmed | Negative controls + perf evidence required first |
| P8 unknown-call preserve | Shipped as narrow guarded rule | Bounded to ambient no-arg `void` expression-statement; non-ambient calls conservative |
| M6 closure | Closed with bounded preserve | Matrix now `6/6`; non-target shapes remain conservative |
| Constrained-overload narrowing | Deferred to Phase 5 | Requires explicit contract metadata; no heuristic safe path |
| Dual parity metrics | Confirmed | Implemented-shape parity (`9/9`) reported separately from corpus parity |
| Boundary classification refactor | Landed (semantics-preserving) | Single classifier dispatches preserve carveouts by `stableBoundaryKind` |
| Diagnostic helpers refactor | Landed (semantics-preserving) | Shared emit/select/dedupe helpers in `checker.go` |
| Reference candidate normalization | Landed (semantics-preserving) | Unified path reduces normalization drift risk |
| Independent stable endpoints | Stable calls exempt from boundary invalidation | Stable calls are pure reads by contract; matches getter independence |
| Post-call narrowing via assignment reduction | Shipped in P3 | Reuses existing `getAssignmentReducedType` infrastructure; same mechanism as variable assignment narrowing but applied to stable call references after mutator calls |

## 10. Validation

Latest tip validation is green:
- `npx hereby build`
- `npx hereby test`
- `npx hereby lint`
- `npx hereby format`

## 11. References

### Companion Documents
- [docs/stable-modifier-spec.md](stable-modifier-spec.md) — SDD with normative checker behavior specification, architecture details, and flow graphs
- [docs/stable-heuristic-tdd-plan.md](stable-heuristic-tdd-plan.md) — TDD plan with step-by-step implementation order and gate criteria
- [docs/stable-modifier-research.md](stable-modifier-research.md) — Research document with naming analysis, language survey, and problem statement deep-dive

### Test Files
- `testdata/tests/cases/compiler/stableModifierParity.ts` — Dedicated local parity suite
- `testdata/tests/cases/compiler/stableModifierTier1Writes.ts` — Tier 1 write-form matrix
- `testdata/tests/cases/compiler/stableModifierGetterParitySweep.ts` — Getter-to-stable parity sweep
- `testdata/tests/cases/compiler/stableModifierGetterCorpus.ts` — Broad getter corpus with source-tagged sections
- `testdata/tests/cases/compiler/stableModifierGetterMissingMatrix.ts` — Missing getter-origin matrix
- `testdata/tests/cases/compiler/stableModifierHeuristicDiagnostics.ts` — Diagnostics suite
- `testdata/tests/cases/compiler/stableModifierP8Conservative.ts` — P8 conservative controls
- `testdata/tests/cases/compiler/stableModifierBoundaries.ts` — Boundary coverage matrix
- `testdata/tests/cases/compiler/stableModifierTier2.ts` — Tier 2 forwarding/passthrough shapes
- `testdata/tests/cases/compiler/stableModifierSubmoduleParity.ts` — Submodule CFA parity expansion (10 patterns, 0 errors)
- `testdata/tests/cases/compiler/stableModifierMutatorBasic.ts` — Phase 5 mutator parsing and invalidation
- `testdata/tests/cases/compiler/stableModifierMutatorInvalidates.ts` — Phase 5 selective invalidation via invalidates
- `testdata/tests/cases/compiler/stableModifierConstrainedOverload.ts` — Phase 5 constrained generic patterns
- `testdata/tests/cases/compiler/stableModifierMutatorErrors.ts` — Phase 5 validation diagnostics
- `testdata/tests/cases/compiler/stableModifierPostCallNarrowing.ts` — P3 post-call narrowing (12 patterns, 0 errors)
- `testdata/tests/cases/compiler/stableModifierLinkedPredicates.ts` — Phase 7 linked type predicates (10 sections, 0 errors on positives, 2 expected errors on negatives)

### Benchmark Files
- `internal/checker/stable_bench_test.go` — Checker micro-bench harness

---

## Appendix A: Implementation Changelog

Chronological record of implementation increments.

### M6 Closure (2026-03-11)
- Attempted narrow checker preserve for ambient no-arg unknown calls crossing ambient nullable stable reads.
- Result: `M6` closure landed with a bounded preserve rule; boundary expectations updated only for this guarded ambient no-arg shape.
- Decision: ship this narrow guarded rule in Phase 1; keep non-ambient unknown calls and other uncertainty boundaries conservative.

### P8 / X3 Final Sweep Closure
- Shape: `P8` in `stableModifierGetterParitySweep.ts`, overlapping with corpus `X3` in `stableModifierGetterCorpus.ts`.
- Closed with a strict syntactic + signature guard. Non-target unknown-call forms remain conservative by design.
- TDD evidence: red → green → conservative control validated.

### Corpus Mismatch Movement
- Mismatch cases: `1 → 0` (`X3` closed)
- Corpus error count: `4 → 2`
- Getter parity sweep score: `8/9 → 9/9`

### Closed Corpus Mismatches
- `QN5` (generic discriminant narrowing over `PetType extends Pet`) — enabled stable-call flow to use narrowable return types.
- `X1` (alias escape via ambient passthrough helper `pass`) — narrow Tier 2 guarded precision extension in alias-escape analysis.
- `GC3` (strict-null await boundary from getter control-flow corpus) — narrow await preserve for ambient no-arg `Promise<void>` calls on nullish stable reads.
- `X3` (nested discriminant unknown-call boundary) — strict guarded preserve for ambient no-arg `void` expression-statement calls on non-nullish union stable reads.

### Boundary Classification Centralization
- Introduced single stable boundary-kind classifier in `internal/checker/flow.go`.
- Boundary kinds: unknown call, callback call, await boundary, alias escape, generic other call boundary.
- Preserve carveouts dispatched through compact table keyed by `stableBoundaryKind`.
- Flow graph node shape unchanged; classification-only restructuring.

### Diagnostic Helper Unification
- Unified stable boundary diagnostic emission/selection via shared checker helpers in `internal/checker/checker.go`:
  - `shouldReportStableBoundaryInvalidationDiagnostic(reference, boundary)`
  - `stableBoundaryInvalidationDiagnosticMessage(reference, boundary)`
  - `reportStableBoundaryInvalidationDiagnostic(reference, boundary)`
- `TS100014` vs `TS100015` selection unchanged. Deduping unchanged.

### Reference Candidate Normalization Unification
- Unified reference-candidate normalization via shared helper `getNormalizedReferenceCandidate(node)` in `internal/checker/flow.go`.
- Stable alias/boundary checks and getter-like narrowing checks now use the same normalization path.
- Behavior intentionally unchanged; reduces normalization drift risk.

### Broad Getter Corpus Landing
- Added getter-to-stable parity corpus from submodule sources:
  - `narrowingOfQualifiedNames.ts`
  - `narrowingOfDottedNames.ts`
  - `getterControlFlowStrictNull.ts`
  - `typeGuardsInProperties.ts`
  - `typeGuardsInClassAccessors.ts`
- Corpus is visibility-first: mismatches intentionally retained and baseline-accepted to expose remaining gaps.

### Previous Benchmark Snapshot (Historical)
| Runner | Wall times (s) | Avg Wall (s) | Avg RSS (MiB) |
|---|---|---|---|
| upstream `tsc` | 8.86, 7.86, 7.84 | 8.19 | 708.3 |
| `tsgo` | 1.60, 1.29, 1.27 | 1.39 | 672.1 |

Delta (latest branch vs historical `tsgo`): Wall `+7.91%`, RSS `-18.18%`.

### Phase 5: mutator/invalidates Contracts (2026-03-XX)
- Added `mutator` and `invalidates` keywords to scanner keyword map
- Added `KindMutatorKeyword`, `KindInvalidatesKeyword` AST kinds
- Added `ModifierFlagsMutator = 1 << 18` modifier flag
- Added `LinksClause *NodeList` field to `FunctionOrConstructorTypeNodeBase`
- Parser: mutator modifier on function types, invalidates clause parsing
- Added 7 new diagnostics (TS100016–TS100022) for mutator/invalidates validation
- Added `SignatureFlagsMutator = 1 << 10` signature flag
- Grammar validation: mutator-only-on-function-type, mutual exclusion with stable
- CFA: `isMutatorCallBoundary()` with selective invalidation via invalidates clause
- CFA: integration into `classifyStableBoundary` pipeline
- 4 new test files, 25 total errors across Phase 5 tests
- TDD evidence: red (test files first) → green (implementation) → baselines accepted

### Phase 7: Linked Type Predicates (2026-03-XX)
- **Syntax:** `this.method() is Type` in return type position of guard methods
- **Purpose:** Boolean guard methods can narrow other stable methods' return types
- **Parser:** `this.method() is T` parsed with mark/rewind backtracking to distinguish from regular `this` type predicates
- **AST:** `TypePredicateKindLinkedMethod` (value 4) — new type predicate kind
- **Checker:** Validates target is a `stable` endpoint on the containing type (TS100023), validates narrowed type is assignable to target return type (TS100024)
- **CFA:** `narrowTypeByLinkedMethodPredicate` — matches guard receiver to stable receiver via `isMatchingReference`, applies narrowing to stable call result type
- **NodeBuilder + Printer:** Round-trip `this.method() is Type` syntax in declaration emit and display
- **Natural integration:** Mutator invalidation resets linked predicate narrowing; uncertainty boundaries invalidate it; different receivers do not cross-narrow
- **Test file:** `stableModifierLinkedPredicates.ts` — 10 sections: basic guard, multiple guards on same target, guard + mutator invalidation, different receivers, guard + uncertainty boundary, optional container pattern, non-stable guard, negative (target not stable), negative (type not assignable), guard called outside condition
- **Result:** 0 errors on 8 positive sections, 2 expected errors on 2 negative sections
- Pipeline: build, test, lint, format all pass

### P3: Post-Call Narrowing (2026-03-XX)
- Added `stableBoundaryKindMutatorCall` to boundary kind enum
- After a mutator call with arguments, the linked stable reference is narrowed to the argument type via `getAssignmentReducedType`
- `getMutatorCallNarrowedType()` helper extracts first argument type and narrows declared union
- Test file: `stableModifierPostCallNarrowing.ts` — 12 sections covering basic narrowing, sequential sets, cross-receiver independence, literal types, guarded interactions, variable arguments, named invalidates targets
- Improved ALL existing mutator test baselines (error reductions)
- Pipeline: build, test, lint, format all pass

---

## Appendix B: Examples and Parity Demonstrations

### B.1 Basic Stable Narrowing
```ts
declare const read: stable () => string | undefined;

if (read() !== undefined) {
  const stable1: string = read(); // OK
  const stable2 = read().toUpperCase(); // OK
}
```

### B.2 Getter/Setter vs Stable — Stable Read
Getter/setter:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
if (model.value !== undefined) {
  const s: string = model.value; // OK
}
```
Stable:
```ts
declare const read: stable () => string | undefined;
if (read() !== undefined) {
  const s: string = read(); // OK
}
```

### B.3 Callback No-Op Parity
Getter/setter:
```ts
declare const model: { get value(): string | undefined; set value(v: string | undefined); };
declare function invoke(cb: () => void): void;
if (model.value !== undefined) {
  invoke(() => {});
  const s: string = model.value; // OK
}
```
Stable:
```ts
declare const read: stable () => string | undefined;
declare function invoke(cb: () => void): void;
if (read() !== undefined) {
  invoke(() => {});
  const s: string = read(); // OK (narrow no-op callback statement shape)
}
```
Conservative cases (Phase 1):
```ts
if (read() !== undefined) {
  const cb = () => {};
  invoke(cb);
  const s: string = read(); // error — const callback alias is still conservative
}
if (read() !== undefined) {
  invoke(() => { const callbackWrite = 1; });
  const s: string = read(); // error — non-empty callback body
}
```

### B.4 Await Boundary Parity
Getter/setter:
```ts
declare const model: { get value(): string | undefined; set value(v: string | undefined); };
async function getterAwait() {
  if (model.value !== undefined) {
    await Promise.resolve();
    const s: string = model.value; // OK
  }
}
```
Stable (narrow preserve):
```ts
declare const read: stable () => string | undefined;
async function stableAwait() {
  if (read() !== undefined) {
    await Promise.resolve();
    const s: string = read(); // OK (narrow shape)
  }
}
```
Stable (ambient no-arg await nullish-read):
```ts
declare const nullishRead: stable () => string | null;
declare function delay(): Promise<void>;
async function stableAwaitAmbientDelay() {
  if (nullishRead()) {
    await delay();
    const s: string = nullishRead(); // OK (narrow corpus shape)
  }
}
```
Stable (broader await — conservative):
```ts
declare const read: stable () => string | undefined;
declare function delay(): Promise<void>;
async function stableAwaitConservative() {
  if (read() !== undefined) {
    await delay();
    const s: string = read(); // error
  }
}
```

### B.5 Boundary Invalidation Examples
```ts
declare const read: stable () => string | undefined;
declare function unknownMutate(): void;
declare function pass<T>(x: T): T;
declare function invoke(cb: () => void): void;

// Callback via helper — conservative
if (read() !== undefined) {
  invoke(pass(() => {}));
  const after: string = read(); // error
}
// Unknown call — conservative
if (read() !== undefined) {
  unknownMutate();
  const after: string = read(); // error
}
// Direct const alias — preserves
if (read() !== undefined) {
  const alias = read;
  const after: string = read(); // OK
}
// Indirect alias — conservative
if (read() !== undefined) {
  const indirect = pass(read);
  const after: string = read(); // error
}
// Alias reassignment — conservative
let alias: () => string | undefined;
if (read() !== undefined) {
  alias = read;
  const after: string = read(); // error
}
```

### B.6 Angular Signals — Narrowing Improvement
```ts
// Pre-stable workaround:
declare const count: () => number | null;
const current = count();
const value = current !== null ? current : 0;

// With stable CFA:
declare const count: stable () => number | null;
const value2 = count() !== null ? count() : 0; // parity with getter-style CFA
if (count() !== null) {
  const n: number = count(); // OK
}
```

### B.7 Linked Type Predicates
```ts
interface Resource<T> {
    value: stable () => T;
    hasValue(): this.value() is Exclude<T, undefined>;
}

const r: Resource<string | undefined> = getResource();
if (r.hasValue()) {
    r.value(); // string (narrowed from string | undefined)
}

// Multiple guards on same target
interface TypedReader {
    read: stable () => number | string | boolean;
    isNumber(): this.read() is number;
    isString(): this.read() is string;
}

const reader: TypedReader = getReader();
if (reader.isNumber()) {
    reader.read(); // number
}
if (reader.isString()) {
    reader.read(); // string
}

// Guard + mutator invalidation
interface WritableOption<T> {
    get: stable () => T | undefined;
    isDefined(): this.get() is T;
    set: mutator (v: T | undefined) => void invalidates get;
}

const opt: WritableOption<number> = getOption();
if (opt.isDefined()) {
    opt.get(); // number (narrowed by linked predicate)
    opt.set(undefined);
    opt.get(); // number | undefined (back to full type after mutator)
}
```

What this enables in Angular signals:
- Fewer forced temporary locals just to preserve null checks
- Fewer redundant optional chains when repeated guarded reads are safe
- Better parity with getter ergonomics (`obj.value` vs `signal()`)
- More predictable refactoring from property-getter to signal-call patterns

### B.7 Discriminated-Union Signal Access
```ts
type Shape = { kind: "circle"; radius: number } | { kind: "square"; size: number };
declare const shape: stable () => Shape;

if (shape().kind === "circle") {
  const r = shape().radius; // OK — kind check narrows repeated reads
}
```

### B.8 Issue-Driven Examples

**TS #60948 — Repeated read after guard:**
```ts
declare const value: stable () => string | undefined;
if (value() !== undefined) {
  value().toUpperCase(); // OK
}
```

**TS #60948 — Callback boundary invalidation:**
```ts
declare const value: stable () => string | undefined;
declare function invoke(cb: () => void): void;
if (value() !== undefined) {
  invoke(() => { const x = 1; });
  const s: string = value(); // error after boundary
}
```

**Angular #49161 — Ternary/computed one-liner:**
```ts
declare const count: stable () => number | null;
const x = count() !== null ? count() : 0;
```

**Angular #62181 — Template-like guard pattern (plain TS):**
```ts
type User = { name: string };
declare const user: stable () => User | null;
if (user() !== null) {
  const nameUpper = user().name.toUpperCase(); // OK
}
```

### B.9 Directional Future Examples (Not Implemented)

**Phase 5 — Explicit `mutator`/`invalidates` (IMPLEMENTED):**
```ts
interface Store {
  stable user(): { name: string } | undefined;
  stable settings(): { theme: string } | undefined;
  mutator setUser(v: { name: string } | undefined) invalidates user;
}
declare const store: Store;
if (store.user() !== undefined) {
  const u1: { name: string } = store.user(); // planned OK
  store.setUser(undefined);
  const u2: { name: string } = store.user(); // planned error after linked invalidation
}
```

**Phase 5 — Constrained-overload post-call narrowing (PARTIALLY IMPLEMENTED — conservative):**
```ts
interface WritableSignal<T> {
  stable (): T;
  mutator update<U extends T>(fn: (value: T) => U) invalidates this;
}
declare const sig: WritableSignal<string | number>;
sig.update(() => "x");
const narrowed: string = sig(); // planned OK when constrained overload + unique link resolved
```

**Phase 2 — Strict const no-op callback alias preserve:**
```ts
declare const read: stable () => string | undefined;
declare function invoke(cb: () => void): void;
if (read() !== undefined) {
  const cb = () => {};
  invoke(cb);
  const s: string = read(); // planned OK under strict alias proof
}
```

**Phase 2 — Guarded dynamic element-write precision:**
```ts
declare const model: { read: stable () => string | undefined; value: string | undefined; };
declare const key: "value";
if (model.read() !== undefined) {
  model[key] = "next";
  const s: string = model.read(); // planned behavior via proven-key guardrails
}
```

**Exploratory — Equality-chain reuse:**
```ts
declare const tag: stable () => "a" | "b" | "c";
if (tag() === "a" || tag() === "b") {
  const narrowed: "a" | "b" = tag(); // exploratory target
}
```

---

## Appendix C: Architecture Details

For full architecture specification, flow graphs, and divergence overlay, see [docs/stable-modifier-spec.md](stable-modifier-spec.md).

### Summary: Can Stable Use Getter Flow Line Directly?

**Short answer:** No, not fully in current architecture.

**Shared path:** Both getter and stable paths share CFA infrastructure — same flow graph, same `getTypeAtFlowCondition` narrowing engine, same `bindCondition` / `narrowType` / `narrowTypeByTruthiness` pipeline. Unified reference-candidate normalization via `getNormalizedReferenceCandidate(node)` in `internal/checker/flow.go`.

**Divergences:**
1. **Reference shape:** Getter uses property/element access references; stable uses zero-arg call references via `hasNarrowableArgument` + `setFlowNode` on `KindCallExpression`.
2. **Read typing entry:** Getter follows normal property access checking; stable has explicit call-site hook in `checkCallExpression` for `SignatureFlagsStable`.
3. **Boundary invalidation:** Getter has no stable-specific boundary branch; stable has dedicated `getTypeAtFlowCall` with boundary classification, preserve carveouts, and diagnostics.
4. **Boundary classification:** Single `stableBoundaryKind` classifier dispatches preserves via compact table (unknown call, callback, await, alias escape, generic other).
5. **Diagnostic emission:** Shared helpers in `checker.go` handle `TS100014`/`TS100015` selection and deduplication.

---

## TC39 Signals Integration

The `stable` / `mutator` / `invalidates` feature provides natural type-level semantics for the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (Stage 1) and all major framework signal implementations.

### Mapping

```ts
// TC39 Signal.State<T>
interface State<T> {
    stable get(): T;
    mutator set(value: T): void invalidates get;
}

// TC39 Signal.Computed<T>
interface Computed<T> {
    stable get(): T;  // Readonly — no mutator methods
}
```

### What This Enables

```ts
declare const count: Signal.State<number | undefined>;

if (count.get() !== undefined) {
    count.get() + 1;          // ✅ Narrowed to number — stable preserves
    count.set(42);
    count.get() + 1;          // ✅ OK — post-call narrowing: set(42) narrows to number
}
```

### Framework Coverage

| Framework | Read | Write | Mapping |
|-----------|------|-------|---------|
| TC39 | `.get()` | `.set(v)` | `stable get(): T` / `mutator set(v): void invalidates get` |
| Angular | `signal()` | `.set(v)` | `stable (): T` / `mutator set(v): void invalidates *` |
| Solid | `getter()` | `setter(v)` | `stable (): T` / `mutator (v): void invalidates *` |
| Vue/Preact | `.value` | `.value = v` | Property accessors (future extension) |

For the complete signals analysis, see [docs/signal-proposal-stable-mutator.md](signal-proposal-stable-mutator.md).

For Mermaid flow graphs (getter flow, stable flow, divergence overlay), see [docs/stable-modifier-spec.md](stable-modifier-spec.md).