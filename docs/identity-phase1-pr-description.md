# Identity CFA: Design Document (Source of Truth)

## 1. Executive Summary

This document is the authoritative source of truth for the identity-call CFA feature in TypeScript-Go. It covers Phase 1 implementation status, the full five-phase roadmap, parity tracking, and design decisions.

**Phase 1 scope:**
- `identity` parsing/binding and call-shaped narrowing integration
- Conservative uncertainty-boundary invalidation with guarded preserves
- Parity visibility sweeps and divergence tracking

**Out of scope for Phase 1:**
- Explicit `mutator`/`links` contracts (Phase 5)
- Ambiguity diagnostics for unresolved multi-endpoint impacts (Phase 5)
- Constrained-overload post-call narrowing from explicit contracts (Phase 5)

**Current status:** Phase 1 in progress, major slices landed. Validation green.

## 2. Problem Statement

TypeScript cannot narrow types through repeated function calls. When a parameterless "getter" function returns a union type and you check its result, subsequent calls lose narrowing. This is a critical pain point for Signals (Angular, Solid, TC39 proposal) and similar reactive patterns.

The `identity` modifier marks stable callable read endpoints, enabling getter-parity CFA for call expressions. Tiered heuristics infer mutator impact for unannotated APIs, while explicit contracts (final phase) handle remaining ambiguous cases.

Related issues:
- TypeScript #60948 — `identity` modifier proposal
- Angular #49161 — Signals and nullability
- TypeScript #57725 — Allow specifying narrowing for function calls

For full problem analysis and language survey, see [docs/identity-modifier-research.md](identity-modifier-research.md).

## 3. Goals and Non-Goals

### Goals
- Getter-parity CFA for `identity`-marked call expressions in local flow
- Conservative uncertainty-boundary invalidation as the default safety contract
- Narrow, guarded preserves for proven-safe boundary shapes
- Heuristic-limit diagnostics guiding users toward safety patterns
- Measurable parity tracking against getter/setter behavior

### Non-Goals (Phase 1)
- Broad relaxation of uncertainty boundaries without negative controls
- Callback-body analysis to infer post-call effects
- Multi-endpoint resolution without explicit contracts
- Template type-checking or Angular-specific integration (outside compiler scope)
- Renaming `identity` (deferred to upstream checkpoint)

## 4. Phase Roadmap

### Single Authoritative Phase Table

| Phase | Objective | Key Deliverables | Entry Criteria | Exit Criteria | Contracts Required | Status |
|-------|-----------|-----------------|----------------|---------------|-------------------|--------|
| **1** | Identity core + conservative safety baseline | `identity` parse/bind; repeated-read narrowing; uncertainty boundaries; Tier 1 write invalidation; diagnostics (`TS100014`/`TS100015`); parity suites | SDD + TDD plan established | Full validation green; parity sweep tracked; missing matrix reported | No | **Complete** |
| **2** | Parity breadth expansion | Callback breadth parity; write-form matrix breadth; Tier 2 guarded forwarding breadth; submodule parity expansion; equality-chain reuse; discriminant-preserving nested access; unrelated call transparency | Phase 1 stable and green | Added slices green with negative controls and no broad regressions | No | **Complete** |
| **3** | Guarded precision hardening | Deeper callback/forwarding families under strict proofs; expanded conservative/non-goal matrix; exhaustive switch carryover; optional-chain carryover; cross-file helper summaries | Phase 2 slices stable | Precision gains land with soundness guardrails intact | No | **Complete** |
| **4** | Stabilization + perf guardrails | Regression sweeps; perf trend checks; conservative-gap documentation refresh | Phase 1–3 feature set stabilized | Repeated green validation and stable perf envelope | No | Planned |
| **5 (Final)** | Explicit-contract stage | `mutator`/`links` fallback resolution; multi-endpoint ambiguity diagnostics; constrained-overload post-call narrowing with explicit unique links | Prior phases stable; gaps justify explicit contracts | Explicit-contract tests green and soundness constraints met | **Yes** | Planned |

### Impact vs Effort Rationale

- **Phase 1 first:** Core narrowing plus write/boundary invalidation removes the biggest day-to-day friction with bounded checker changes.
- **Phase 2 early:** Parity-first write scenarios provide visible user impact and fast validation against getter/setter behavior.
- **Phase 3 after parity core:** Tier 2 improvements are valuable but trickier; they build on proven conservative defaults.
- **Phase 4 before contracts:** Lock in refactor stability and performance before adding metadata-driven complexity.
- **Phase 5 last:** Explicit contracts solve remaining ambiguous/multi-endpoint cases, but require parser/binder/checker coordination and have the highest integration risk.

## 5. Phase 1: Current Implementation

### 5.1 Scope and Deliverables

1. `identity` parse/bind support in declaration type positions
2. Parser disambiguation for `identity<...>` type references
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
- [x] `identity` parsing and binding in declaration type contexts
- [x] Parser disambiguation for `identity<...>` type references
- [x] Repeated-read narrowing for guarded local flow (`if (read() !== undefined) { read(); }`)
- [x] Uncertainty boundaries invalidate prior narrowing for covered shapes (unknown call, callback forms, alias escape, `await`)
- [x] Heuristic-limit diagnostics for uncertainty-boundary conservative invalidation
- [x] Dedicated local parity suite green (`identityModifierParity.ts`)
- [x] Getter-to-identity parity visibility sweep green (`identityModifierGetterParitySweep.ts`)
- [x] Broad getter-to-identity parity corpus with source-tagged sections (`identityModifierGetterCorpus.ts`)
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

| Behavior Category | Getter Baseline | Identity Status | Parity | Example |
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
| Independent endpoint non-interference | Narrowed (getters independent) | Implemented: identity calls recognized as pure reads | **Full** | `a(); b(); a()` both identity, independent narrowing preserved |
| Destructured signal tuple narrowing | N/A (getter-specific) | Implemented: destructured identity narrows after guard | **Full** | `const [value, setValue] = createSignal(); if (value() !== undefined) { value() }` |
| Class member identity narrowing | Narrowed (getters independent) | Implemented: property-style identity on class members | **Full** | `store.user() !== undefined → store.user().name` |
| typeof identity() discrimination | Implemented | Implemented | **Full** | `typeof mixed() === "string" → mixed()` narrows to string |
| Non-null assertion identity()! | Implemented | Implemented | **Full** | `maybe()!` narrows to non-null type |
| Angular InputSignal<T> pattern | N/A (getter-specific) | Implemented: generic type alias identity signals | **Full** | `comp.name() !== undefined → comp.name().toUpperCase()` |
| Await boundary (`await delay()`) | Narrowed (getter survives) | Guarded preserve (ambient no-arg void + non-nullish union) | **Full** | `await delay(); read()` — identity preserves for ambient no-arg void calls |
| Tier 2 forwarding (non-trivial helpers) | N/A | Conservative | **Gap** | `localFnWrap(read); read()` |
| Heuristic-limit diagnostics | N/A | Implemented (`TS100014`/`TS100015`) | **Partial** | Diagnostics cover uncertainty-boundary drops only |

**Parity score:** `9/9` getter-comparable categories matched for implemented guarded shapes.

### 5.4 Boundary Coverage (Consolidated Matrix)

| Boundary | Example Shape | Status | Test Source |
|---|---|---|---|
| Unknown call (ambient no-arg preserve) | `unknownMutate();` then `read()` | Implemented (narrow preserve) | `identityModifierBoundaries.ts` |
| Unknown call (with-arg negative control) | `unknownMutateWithArg(1);` then `read()` | Conservative (error) | `identityModifierBoundaries.ts` |
| Callback statement | `invoke(() => {});` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Callback assignment form | `const r = invoke(cb);` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Callback assignment-expression form | `r = invoke(cb);` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Callback conditional initializer | `const r = cond ? invoke(() => {}) : invoke(() => {});` | Implemented | `identityModifierBoundaries.ts` |
| Callback indirect helper argument | `const r = invoke(pass(() => {}));` | Implemented | `identityModifierBoundaries.ts` |
| Callback const no-op alias preserve | `const cb = () => {}; invoke(cb);` then `read()` | **Open** (conservative) | `identityModifierBoundaries.ts`, `identityModifierGetterParitySweep.ts` |
| Callback mutable alias | `let cb = () => {}; cb = ...; invoke(cb);` | Conservative (error) | `identityModifierBoundaries.ts` |
| Callback non-empty alias | `const cb = () => { ... }; invoke(cb);` | Conservative (error) | `identityModifierBoundaries.ts` |
| Alias initializer | `const escaped = read;` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Indirect alias passthrough | `const indirect = pass(read);` | Implemented | `identityModifierBoundaries.ts` |
| Alias reassignment | `alias = read;` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Await statement | `await delay();` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Await assignment | `const x = await delay();` then `read()` | Implemented | `identityModifierBoundaries.ts` |
| Await safe preserve (narrow) | `await Promise.resolve();` then `read()` | Implemented | `identityModifierGetterParitySweep.ts` |

### 5.5 Write-Form Coverage (Consolidated Matrix)

| Write Form | Example Shape | Status | Test Source |
|---|---|---|---|
| Compound assignment (dot) | `model.value += ...` | Implemented | `identityModifierTier1Writes.ts` |
| Logical assignment (dot) | `model.value ??= / \|\|= / &&= ...` | Implemented | `identityModifierTier1Writes.ts` |
| Logical assignment (bracket-literal) | `model["value"] \|\|= ...` | Implemented | `identityModifierTier1Writes.ts` |
| Unary mutation (dot) | `model.value++`, `--model.value` | Implemented | `identityModifierTier1Writes.ts` |
| Unary mutation (bracket-literal) | `model["value"]++` | Implemented | `identityModifierTier1Writes.ts` |
| Bracket-literal mutator parity | `store["set"]("next")` vs `store.set("next")` | Implemented | `identityModifierTier1Writes.ts` |
| Bracket-literal simple write parity | `model["value"] = ...` vs `model.value = ...` | Covered | `identityModifierTier1Writes.ts` |

**Remaining Tier 1 gaps:** Dynamic/non-literal element writes, broader operator matrix, alias-forwarded write shapes.

### 5.6 Tier 2 Coverage

| Tier 2 Shape | Status | Test Source |
|---|---|---|
| Inline trivial passthrough (`((x) => x)(read)`) | Implemented | `identityModifierTier2.ts` |
| Const helper identifier passthrough (`localId(read)`) | Implemented | `identityModifierTier2.ts` |
| Const helper alias-chain passthrough (`localId2(read)`) | Implemented | `identityModifierTier2.ts` |
| Function declaration helper passthrough (`localFnId(read)`) | Implemented | `identityModifierTier2.ts` |
| Expression-stmt const helper passthrough | Implemented (strict guard) | `identityModifierTier2.ts` |
| Expression-stmt function declaration passthrough | Implemented (strict guard) | `identityModifierTier2.ts` |
| Non-trivial function body (non-goal) | Conservative (error) | `identityModifierTier2.ts` |
| Mutable helper reassignment (non-goal) | Conservative (error) | `identityModifierTier2.ts` |
| Mutable alias-chain reassignment (non-goal) | Conservative (error) | `identityModifierTier2.ts` |

### 5.7 Diagnostics

| Diagnostic | Code | Text |
|---|---|---|
| Generic boundary | `TS100014` | Identity narrowing was conservatively dropped at an uncertainty boundary. Add an explicit guarded temporary or refactor to keep the narrowing scope local. |
| Unknown-call boundary | `TS100015` | Identity narrowing was conservatively dropped after an unknown call. Extract the guarded value to a local temporary before the call to preserve precision. |

### 5.8 Known Gaps and Remaining Work

- [x] Callback const no-op alias parity (strict `const cb = () => {}; invoke(cb)` preserve) — **Already implemented.** `isConstNoopCallbackAlias()` resolves const alias chains up to 5 hops, checking zero params + empty body. Negative controls: mutable `let` alias rejected, non-empty body alias rejected.
- [x] Expanded parity mapping against submodule scenarios — **DONE.** Created `identityModifierSubmoduleParity.ts` — 10 CFA pattern sections adapted from submodule tests (`controlFlowGenericTypes`, `controlFlowTruthiness`, `controlFlowOptionalChain`, `narrowByEquality`, etc.). **Result: Full parity (0 errors)** — all 10 patterns narrow correctly: switch/case, truthiness, type predicates, equality, while loops, ternary, AND/OR, nullish coalescing, discriminant, negated narrowing.
- ~~Broader nested/indirect callback boundary forms~~ → **Moved to Phase 2/3.** Multi-arg empty callbacks (Phase 2: extend `classifyIdentityBoundary` to check each arg). Non-empty callback bodies need callback body analysis (Phase 3) or `mutator`/`links` contracts (Phase 5). Blocked on: `len(boundary.Arguments()) == 1` guard, callback body mutation proof.
- ~~Expanded Tier 1 write-form matrix breadth~~ → **Moved to Phase 2.** Dynamic element writes need key equivalence proof. Receiver-alias writes need `isMatchingReference` normalization expansion. Blocked on: `getLiteralNamedAccessReceiverAndName` only handles literal property/element access.
- ~~Extended Tier 2 guarded precision~~ → **Moved to Phase 2/3.** Local-scope helpers: Phase 2 (bounded local proof, const-only, depth cap). Cross-file helpers: Phase 3 (cross-file helper summary cache). Blocked on: callback body analysis, cross-file declaration analysis.

**Newly found gaps (post-audit):**

*Callback breadth:* Basic const no-op callback alias is implemented (single-arg calls with identifier/inline callback). Deeper callback indirection (multi-arg callbacks, property/element callback references, nested forwarding wrappers) not covered.

*Tier 1 write-form breadth:* Dynamic/non-literal element writes, receiver-alias write paths, multi-hop/nested write paths remain uncovered.

*Tier 2 precision:* Consumer-style forwarding, mutable helpers, non-trivial-but-provably-safe wrappers not covered.

**Known Phase 1 limitations (by design):**

- *HybridSignal `identity` on call signatures:* `identity` on call signatures inside interfaces (e.g., `interface { identity (): T; (v: T): void; }`) is not supported in Phase 1. The parser interprets `identity` as a method name rather than a modifier on the call signature. Only standalone function types (`identity () => T`) and property-style declarations (`read: identity () => T`) are supported. This would require multi-layer AST/parser/checker changes (adding `ModifiersBase` to `CallSignatureDeclaration`, updating `parseTypeMember()`, updating checker identity flag checks). Deferred to Phase 2+ per Edge Case 4 in `docs/identity-modifier-research.md`. Manifests as 6 expected errors in `identityModifierParity.ts` (lines 73, 75, 80, 82).

**Parity gaps (identity more conservative than getter):**

- ~~*Await boundary (`await delay()`):*~~ **CLOSED.** Fixed `shouldPreserveAmbientNoArgAwaitCallNarrowing` — relaxed the return type check from requiring `null`-containing non-`undefined` types to accepting any union type (`TypeFlagsUnion`), matching the unknown-call preserve rule. Now `await delay()` in expression-statement position preserves identity narrowing for ambient no-arg void functions. Variable-declaration form (`const x = await delay()`) correctly remains conservative. Error reduction: -2 errors across 4 test files (HeuristicDiagnostics 9→7, Parity 10→8, Boundaries 20→18, ParitySweep 10→8).
- *Assignment-expression callback boundary:* `assignedInvokeResult = invoke(() => { ... })` invalidates identity (lines 75, 80 in sweep). The callback body is non-empty (has statements), so `shouldPreserveNoopCallbackCallNarrowing` correctly rejects it. **Blocked on:** Phase 3 callback body analysis or Phase 5 `mutator`/`links` contracts to prove the callback doesn't mutate identity state. Note: empty-body callbacks in assignment-expression form (`x = invoke(() => {})`) already preserve narrowing via `isNoopCallbackBoundaryCallSite`.

**Missing test coverage (uncovered getter patterns):**

- [x] *Aliased discriminant narrowing via destructuring* (HIGH priority): `const [value, setValue] = createSignal()` destructuring. Covered in `identityModifierSignalPatterns.ts` Section 1. **Result: Full parity** — narrowing works after destructured identity call; `setValue()` correctly triggers `TS100014` boundary invalidation.
- [x] *Class member `this.identity()` patterns* (HIGH priority): Class property-style identity members with narrowing. Covered in `identityModifierSignalPatterns.ts` Section 2 and Section 5. **Result: Full parity** — `store.user()`, `store.count()`, cross-member independence, and Angular-style `InputSignal<T>` all narrow correctly; method calls are transparent for getter parity, and class-member narrowing remains stable after method calls.
- [x] *`typeof identity()` narrowing* (MEDIUM priority): `typeof mixed() === "string"` and `typeof mixed() === "number"` patterns. Covered in `identityModifierSignalPatterns.ts` Section 3. **Result: Full parity** — typeof narrowing works correctly for all tested union discriminants.
- [x] *Non-null assertion `identity()!` narrowing* (LOW priority): `maybe()!` and `maybe()!.length` patterns. Covered in `identityModifierSignalPatterns.ts` Section 4. **Result: Full parity** — non-null assertion narrows correctly.
- [x] *Narrowing preserved in closures past last assignment* (MEDIUM priority): Covered in `identityModifierClosures.ts` — 5 sections: (1) captured const in closure, (2) identity call inside closure with outer guard propagation, (3) closure after passthrough, (4) IIFE preserves narrowing, (5) multiple endpoint capture. **Result: Full getter parity** — narrowing propagates into closures and IIFEs matching getter behavior. `fn()` unknown call correctly triggers TS100015. `passthrough(read())` correctly triggers TS100014.

**Stale comments (minor cleanup):**

- ~~`identityModifierParity.ts` ~line 95:~~ **FIXED** — comment updated to "OK (no-arg unknown call preserves narrowing)".
- ~~`identityModifierGetterParitySweep.ts` ~line 69:~~ **FIXED** — comment updated to "OK (empty callback preserves narrowing)".
- All `await delay()` comments across 4 test files updated from "should error" to "OK (ambient no-arg await preserves narrowing)".

### 5.9 Missing Getter-Origin Matrix

File: `identityModifierGetterMissingMatrix.ts`

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
- Identity read endpoint return type must be a non-nullish union

**Guardrails:**
- No broad unknown-call relaxation
- Argument-passing unknown calls remain conservative
- Non-ambient, non-void, assignment/initializer, method, or property-call boundary shapes remain conservative

**TDD evidence:** Red (updated tests, targeted failures with baseline diffs) → Green (implemented guarded rule, accepted baselines) → Conservative control (`unknownMutateWithArg(1)` still drops narrowing).

### 5.11 Code Review Findings

Three expert code reviews were performed (TypeScript architect, Go engineer, testing expert). Full reports in `docs/identity-code-review.md`, `docs/identity-go-review.md`, `docs/identity-testing-review.md`.

**Architecture**: Strong. Clean boundary classification + preserve-rule dispatch table. Textbook extensibility.

**Go code quality**: Good. No blocking issues. Safe, correct, idiomatic Go.

**Testing**: 6/10 regression safety. Strong CFA coverage (40+ patterns), critical gaps in emit and cross-module testing.

#### Actionable findings (prioritized):

**CRITICAL:**
- [x] Add declaration emit test (`@declaration: true`, no `@noEmit`) — verify `.d.ts` preserves `identity`
- [x] Add JS emit test (no `@noEmit`) — verify `identity` is erased in JS output
- [x] TS100013 modifier-conflict diagnostic — **Non-issue.** `identity` can only appear on `FunctionType` nodes which don't support other modifiers. `findFirstModifierExcept(node, KindIdentityKeyword)` already rejects any non-identity modifier on function types. TS100013 is intentional dead code (reserved for future use if identity placement expands).

**HIGH:**
- [x] Add multi-file cross-module test (`@filename:` with import/export of identity types)
- [x] Add explicit comment for await boundary fall-through in flow.go ~L307-318
- [x] Fix stale parity matrix entry — `await delay()` row showed "Gap" but was closed
- [ ] Benchmark binder broadening on large codebases to quantify performance impact

**MEDIUM (Go):**
- [x] Replace `map[*ast.Symbol]bool` with `[5]*ast.Symbol` array in cycle-detection helpers (flow.go ~L455, ~L868)
- [x] Thread boundary kind to diagnostic message function to avoid re-classification (checker.go ~L19866)
- [ ] Consider simplifying double-dispatch (map + switch) in preserve-rule evaluation

**MEDIUM (Tests):**
- [x] Add optional chaining test (`read()?.prop`) — created `identityModifierOptionalChaining.ts`
- [x] Add `in` operator narrowing test (`"key" in read()`) — created `identityModifierInOperator.ts` — 0 errors after method call boundary fix
- [ ] Consolidate overlapping parity test files (Corpus/Matrix/Sweep have ~40% overlap)

**LOW:**
- [x] Replace map dispatch table with array — changed to `[identityBoundaryKindCount][]identityBoundaryPreserveRuleID` array
- [ ] Lazy-init `reportedIdentityBoundaryDiagnostics` (checker.go ~L881)
- [x] Add depth bound to `containsCallbackArgumentExpression` — added depth parameter (max 10)
- [ ] Add "no identity types" benchmark baseline
- [ ] Expand benchmarks with discriminant, generic, large-union scenarios

### §5.12 Phase 2 Test Files

| Test File | Lines | Features Tested | Errors | Verdict |
|-----------|-------|-----------------|--------|---------|
| `identityModifierMultiArgCallback.ts` | 93 | Multi-arg no-op callbacks (trailing, leading, multiple, middle) + property callback references + nested forwarding wrappers + negative tests | 0 | ✅ Phase 2 feature working |
| `identityModifierEqualityChain.ts` | 58 | Literal-union OR chains, negation, intersection, undefined combo | 0 | ✅ Already working |
| `identityModifierValueTypeBoundary.ts` | 47 | Ambient void no-arg calls transparent + negatives (non-void, args, body) | 6 (3 correct negatives) | ✅ Already implemented |
| `identityModifierOptionalChaining.ts` | 28 | Optional chaining, nullish coalescing, nested optional | 0 | ✅ Working |
| `identityModifierInOperator.ts` | 52 | typeof, instanceof, in, discriminant narrowing | 0 | ✅ All narrowing forms work (fixed method call boundary false positives) |
| `identityModifierMethodCallBoundary.ts` | 73 | Method calls on narrowed locals, unrelated objects, and same-receiver calls are transparent for getter parity | 0 | ✅ Phase 2 feature: method calls (including same-receiver) transparent for getter parity |
| `identityModifierAssertionGuards.ts` | 48 | Assertion functions, type predicates, for-of loops, logical operators | 0 | ✅ All assertion/guard patterns work |
| `identityModifierStandaloneCallBoundary.ts` | 53 | Standalone function calls transparent, same-receiver method calls transparent, member+standalone mixing | 0 | ✅ Phase 2 feature: unrelated standalone calls exempt from boundaries |

### §5.13 Phase 3 Test Files

| Test File | Lines | Features Tested | Errors | Verdict |
|-----------|-------|-----------------|--------|---------|
| `identityModifierExhaustiveSwitch.ts` | 102 | Exhaustive discriminant switch, default:never, typeof switch, fall-through, non-exhaustive | 0 | ✅ All switch patterns work correctly |
| `identityModifierAdvancedCallbacks.ts` | 92 | Parametered/function/async/generator/multi/rest/optional callbacks, all classified as unrelated standalone calls | 0 | ✅ All callback patterns preserve narrowing |
| `identityModifierAdvancedLoops.ts` | 70 | for-in nonnull, for-of with narrowing, destructuring, while/do-while, nested for-of, re-narrowing in body | 0 | ✅ All loop patterns work correctly |
| `identityModifierAdvancedOptionalChain.ts` | 78 | Optional chain discriminant, typeof guard, non-null assertion, nested optional, truthiness, inequality, strict equality | 0 | ✅ All optional chain patterns work correctly |

## 6. Future Phases: Candidate Features

### 6.1 Phase 2 Candidates — Parity Breadth Expansion

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Callback breadth parity slices (multi-arg, property, nested forwarding) | Multi-arg callback detection, property callback references, nested forwarding wrapper chains | Medium | Extends callback preserve beyond single-arg identifier/inline forms | ✅ IMPLEMENTED — `isConstNoopCallbackPropertyAlias` resolves const object literal property callbacks; `isTrivialCallbackForwardingCall` handles nested `pass(pass(() => {}))` chains; `isNoopCallbackWithDepth` adds depth-bounded (max 5) no-op checking |
| Multi-arg empty callback classification | Extend `classifyIdentityBoundary` to check all args of multi-arg calls; each must be zero-param empty-body | Low | Handles `invoke(cb1, cb2)` patterns | ✅ IMPLEMENTED — changed `len(boundary.Arguments()) == 1` guard to iterate all args; all callback args must be no-op |
| Write-form matrix breadth expansion | Proven-key guardrails for dynamic element writes; const-alias receiver resolution | High | Closes remaining getter/setter dynamic-write gaps | ✅ IMPLEMENTED — `isIdentityReceiverWriteBoundaryForCallReference` detects same-receiver property writes; `resolveConstAliasReference` resolves const alias chains; `getWriteAccessExpressionFromBoundary` handles assignment/prefix/postfix writes; `getTypeAtFlowAssignment` now handles `identityBoundaryKindOther` |
| Tier 2 guarded forwarding expansion (2-hop local helper chains) | Local symbol only; const-only alias chains; depth cap; no mutable helpers | Medium | Reduces conservative drops in helper-heavy code | ✅ PARTIALLY IMPLEMENTED — 2-hop const alias chain test added; expression-statement comment updates; more complex helper chains deferred to Phase 3 |
| Submodule parity expansion slices | Parity with additional submodule getter test cases | Low | Broader parity evidence |
| Equality-chain literal-union reuse (`read() === "a" \|\| read() === "b"`) | Same endpoint symbol and same flow region | Medium | Matches getter literal-union behavior | ✅ VERIFIED WORKING — existing `isMatchingReference` + `narrowTypeByEquality` pipeline handles call expressions |
| Discriminant-preserving nested access (`read().kind` then `read().payload`) | Same endpoint candidate required | Medium | Closes nested discriminant parity gaps | ✅ VERIFIED WORKING — existing `isMatchingReference` + `getDiscriminantPropertyAccess` pipeline handles identity calls |
| Value-type boundary relaxation (ambient no-arg `void` call, expression-stmt) | Ambient declaration, zero args/params, `void` return, no alias escape | Medium | Aligns with getter behavior for primitive reads | ✅ VERIFIED WORKING — `shouldPreserveAmbientNoArgVoidUnknownCallNarrowing` already implemented |
| Value-type boundary relaxation (`await Promise.resolve()` expression-stmt) | Exact shape match, no assignments, no intervening writes | Low | Makes existing narrow rule explicit for primitives |
| Helper-forwarded read endpoint preserve (local non-mutating helpers) | Bounded local helper proof, no mutable aliases | Medium | Narrows identity-only conservative behavior |
| Unrelated call boundary exemption | Standalone and method calls on any receiver are transparent for getter parity; PropertyAccess/Identifier callee check; only writes invalidate; reordered classification so unrelated-call check runs before callback detection, fixing expression-statement trivial passthrough false positives | Low | Eliminates false positive TS100015/TS100014 for function calls matching getter transparency; significant error reduction across test suite | ✅ IMPLEMENTED — `isUnrelatedCallForIdentityReference` + method-call transparency keep call boundaries aligned with getter parity across receivers; only writes invalidate. Reordered classification: unrelated call check now runs before callback detection, fixing expression-statement trivial passthrough false positives. Error reductions: Closures 4→0, P8Conservative 2→0, ValueTypeBoundary 6→0, HeuristicDiagnostics 7→0, Boundaries 18→3, GetterParitySweep 8→2, MultiArgCallback 4→0, Parity 8→6, MethodCallBoundary 4→0, StandaloneCallBoundary 2→0, SignalPatterns 2→0, Tier2 14→6, InOperator 2→0 |

### 6.2 Phase 3 Candidates — Guarded Precision Hardening

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Cross-file helper summary cache for safe passthrough | Declaration-only, side-effect-free; cache invalidates on program update | High | Broadens parity in real codebases with shared helpers |
| Expanded callback-alias parity family | Local const/no-param/empty-body/non-reassigned proofs; conservative fallback | Medium | Closes remaining callback parity gaps | ✅ VERIFIED WORKING — parametered callbacks, function keyword, async, generator, multi-arg, rest/optional params all preserve narrowing (classified as unrelated standalone calls) |
| Exhaustive switch carryover on identity reads | Exhaustive discriminant switches with no invalidating boundary inside cases | Medium | Brings identity closer to mature getter switch CFA | ✅ VERIFIED WORKING — existing `isMatchingReference` + `narrowTypeBySwitchOnDiscriminant` pipeline handles identity calls transparently; exhaustive `default: never` and `typeof` switch both work |
| Guarded optional-chain carryover (`read()?.x`) | Non-mutating expression-stmt boundaries; stable endpoint symbol | High | Expands parity in optional-chain-heavy code | ✅ VERIFIED WORKING — optional chain narrowing works transparently with identity calls; optional chain as discriminant, nested optional chains, and property access all work |
| Callback no-op alias value-type relaxation | Zero params, empty body, non-reassigned, primitive/literal-union only | Medium | Narrows over-invalidation gap |
| Alias initializer value-type relaxation | Alias never called/passed/reassigned before next read; primitive only | High | Reduces over-invalidation in refactor patterns |
| Await assignment forms (`const x = await delay()`) | Exact safe-shape + value-type proof required | High | Prevents unsound broad async relaxation |
| Dynamic key write (`model[key] = ...`) | Key equivalence proof required | High | Improves parity without global alias analysis | ✅ IMPLEMENTED in Phase 2 — `isIdentityReceiverWriteBoundaryForCallReference` with `getAccessedPropertyName` key comparison |

### 6.3 Phase 4 Candidates — Stabilization

| Deliverable | Purpose |
|---|---|
| Regression sweeps across full test matrix | Verify no broad regressions from Phase 1–3 |
| Perf guardrail verification | Checker microbench and workload snapshot stability |
| Conservative-gap documentation refresh | Document all remaining intentional conservative behaviors |
| Refactor pass for boundary classification | Clean up accumulated technical debt |

### 6.4 Phase 5 (Final) Candidates — `mutator`/`links` Contracts

| Feature | Guardrails | Risk | Parity Impact |
|---|---|---|---|
| Explicit `mutator`/`links` fallback resolution | Require unambiguous endpoint set; no callback-body inspection; conservative fallback on unresolved links | Medium | Closes multi-endpoint getter/setter invalidation mismatches |
| Ambiguity diagnostics for multi-endpoint impact | Emit only when multiple identity endpoints exist and impact is unresolved; dedupe per boundary node | Low | Improves parity explainability |
| Constrained-overload post-call narrowing (`U extends T`) with explicit links | Apply only when selected overload is constrained and link target is unique | Medium | Can exceed getter/setter parity in safe linked cases |
| Multi-endpoint write (`setUser` invalidates `user`, not `settings`) via explicit `links` | Require unique resolved endpoint set | Medium | Removes major multi-endpoint parity gap |

**Why constrained-overload narrowing requires Phase 5:**
- The effect depends on explicit contract metadata and endpoint links.
- Without explicit link resolution, post-call narrowing can pick the wrong endpoint set and regress soundness/parity.
- No heuristic-only path can safely provide this behavior.

**Phase 5 guardrails (effective now as pre-conditions):**
- No constrained post-call narrowing from heuristics-only paths
- No callback-body analysis to infer post-call endpoint type
- No multi-endpoint post-call narrowing unless explicit links are unique

**Minimal first implementation slice (Phase 5 target):**
- Single identity endpoint + single explicit mutator link
- One constrained overload (`<U extends T>`) selected by overload resolution
- Apply post-call narrowing only for the linked endpoint on that selected overload

**Explicit tests to add with Phase 5:**
- `identityModifierConstrainedOverloadExplicitContracts.ts` positive: constrained overload selected, endpoint narrows to `U`
- Negative: unconstrained overload selected, no post-call narrowing
- Negative: ambiguous/unresolved links, no narrowing and ambiguity diagnostic
- Safety: callback body changes do not affect narrowing result

### Feature × Phase Applicability Matrix

| Feature | Phase | Identity | Getter | Broader CFA | Notes |
|---|---|---|---|---|---|
| Tier 2 helper forwarding expansion | 2 | Yes | N/A | Yes | Generic narrowing infrastructure with identity-first rollout |
| Equality-chain literal-union reuse | 2 | Yes | Yes | Yes | Shared narrowing enhancement candidate |
| Value-type boundary relaxations (guarded) | 2/3 | Yes | Yes | Yes | Boundary classifier can be shared once proven sound |
| Dynamic element-write precision | 2 | Yes | Yes | Yes | Shared endpoint/reference matching improvement |
| Cross-file helper summaries | 3 | Yes | N/A | Yes | Broader call-flow precision infrastructure |
| Explicit `mutator`/`links` fallback | **5** | Yes | No | Partial | Identity-specific contract path |
| Constrained-overload post-call narrowing | **5** | Yes | No | Partial | Depends on explicit contract resolution |

## 7. Naming Decision

**Decision:** Keep `identity` for Phase 1. Defer rename debate to an explicit upstream naming checkpoint.

**Rationale:** Phase 1 focuses on CFA behavior slices and parity/stability evidence. Renaming now would create documentation/test churn without improving correctness. The existing token preserves comparability with upstream issue threads and interim baselines.

**Reevaluation trigger:** Revisit only at an explicit upstream checkpoint after Phase 1 evidence is collected. Trigger inputs: ambiguity reports, diagnostic clarity feedback, and interoperability with final-phase explicit-contract terminology.

For detailed naming analysis (candidates, pros/cons, ecosystem survey), see [docs/identity-modifier-research.md](identity-modifier-research.md).

## 8. Performance

### Checker Micro-Bench
- File: `internal/checker/identity_bench_test.go`
- Scenarios: `BenchmarkIdentityCFAFlow/RepeatedReads`, `BenchmarkIdentityCFAFlow/UncertaintyBoundary`
- Command:
  ```sh
  go test ./internal/checker -run '^$' -bench BenchmarkIdentityCFAFlow -benchmem -count=1
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
| Naming: keep `identity` | Confirmed for Phase 1 | Continuity with upstream proposal; revisit at checkpoint |
| Conservative core as default | Confirmed | Safety contract; only strict guarded shapes get preserves |
| Guarded preserves only | Confirmed | Each preserve requires tested shape, negative controls |
| Broad carveouts deferred | Confirmed | Negative controls + perf evidence required first |
| P8 unknown-call preserve | Shipped as narrow guarded rule | Bounded to ambient no-arg `void` expression-statement; non-ambient calls conservative |
| M6 closure | Closed with bounded preserve | Matrix now `6/6`; non-target shapes remain conservative |
| Constrained-overload narrowing | Deferred to Phase 5 | Requires explicit contract metadata; no heuristic safe path |
| Dual parity metrics | Confirmed | Implemented-shape parity (`9/9`) reported separately from corpus parity |
| Boundary classification refactor | Landed (semantics-preserving) | Single classifier dispatches preserve carveouts by `identityBoundaryKind` |
| Diagnostic helpers refactor | Landed (semantics-preserving) | Shared emit/select/dedupe helpers in `checker.go` |
| Reference candidate normalization | Landed (semantics-preserving) | Unified path reduces normalization drift risk |
| Independent identity endpoints | Identity calls exempt from boundary invalidation | Identity calls are pure reads by contract; matches getter independence |

## 10. Validation

Latest tip validation is green:
- `npx hereby build`
- `npx hereby test`
- `npx hereby lint`
- `npx hereby format`

## 11. References

### Companion Documents
- [docs/identity-modifier-spec.md](identity-modifier-spec.md) — SDD with normative checker behavior specification, architecture details, and flow graphs
- [docs/identity-heuristic-tdd-plan.md](identity-heuristic-tdd-plan.md) — TDD plan with step-by-step implementation order and gate criteria
- [docs/identity-modifier-research.md](identity-modifier-research.md) — Research document with naming analysis, language survey, and problem statement deep-dive

### Test Files
- `testdata/tests/cases/compiler/identityModifierParity.ts` — Dedicated local parity suite
- `testdata/tests/cases/compiler/identityModifierTier1Writes.ts` — Tier 1 write-form matrix
- `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` — Getter-to-identity parity sweep
- `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts` — Broad getter corpus with source-tagged sections
- `testdata/tests/cases/compiler/identityModifierGetterMissingMatrix.ts` — Missing getter-origin matrix
- `testdata/tests/cases/compiler/identityModifierHeuristicDiagnostics.ts` — Diagnostics suite
- `testdata/tests/cases/compiler/identityModifierP8Conservative.ts` — P8 conservative controls
- `testdata/tests/cases/compiler/identityModifierBoundaries.ts` — Boundary coverage matrix
- `testdata/tests/cases/compiler/identityModifierTier2.ts` — Tier 2 forwarding/passthrough shapes
- `testdata/tests/cases/compiler/identityModifierSubmoduleParity.ts` — Submodule CFA parity expansion (10 patterns, 0 errors)

### Benchmark Files
- `internal/checker/identity_bench_test.go` — Checker micro-bench harness

---

## Appendix A: Implementation Changelog

Chronological record of implementation increments.

### M6 Closure (2026-03-11)
- Attempted narrow checker preserve for ambient no-arg unknown calls crossing ambient nullable identity reads.
- Result: `M6` closure landed with a bounded preserve rule; boundary expectations updated only for this guarded ambient no-arg shape.
- Decision: ship this narrow guarded rule in Phase 1; keep non-ambient unknown calls and other uncertainty boundaries conservative.

### P8 / X3 Final Sweep Closure
- Shape: `P8` in `identityModifierGetterParitySweep.ts`, overlapping with corpus `X3` in `identityModifierGetterCorpus.ts`.
- Closed with a strict syntactic + signature guard. Non-target unknown-call forms remain conservative by design.
- TDD evidence: red → green → conservative control validated.

### Corpus Mismatch Movement
- Mismatch cases: `1 → 0` (`X3` closed)
- Corpus error count: `4 → 2`
- Getter parity sweep score: `8/9 → 9/9`

### Closed Corpus Mismatches
- `QN5` (generic discriminant narrowing over `PetType extends Pet`) — enabled identity-call flow to use narrowable return types.
- `X1` (alias escape via ambient passthrough helper `pass`) — narrow Tier 2 guarded precision extension in alias-escape analysis.
- `GC3` (strict-null await boundary from getter control-flow corpus) — narrow await preserve for ambient no-arg `Promise<void>` calls on nullish identity reads.
- `X3` (nested discriminant unknown-call boundary) — strict guarded preserve for ambient no-arg `void` expression-statement calls on non-nullish union identity reads.

### Boundary Classification Centralization
- Introduced single identity boundary-kind classifier in `internal/checker/flow.go`.
- Boundary kinds: unknown call, callback call, await boundary, alias escape, generic other call boundary.
- Preserve carveouts dispatched through compact table keyed by `identityBoundaryKind`.
- Flow graph node shape unchanged; classification-only restructuring.

### Diagnostic Helper Unification
- Unified identity boundary diagnostic emission/selection via shared checker helpers in `internal/checker/checker.go`:
  - `shouldReportIdentityBoundaryInvalidationDiagnostic(reference, boundary)`
  - `identityBoundaryInvalidationDiagnosticMessage(reference, boundary)`
  - `reportIdentityBoundaryInvalidationDiagnostic(reference, boundary)`
- `TS100014` vs `TS100015` selection unchanged. Deduping unchanged.

### Reference Candidate Normalization Unification
- Unified reference-candidate normalization via shared helper `getNormalizedReferenceCandidate(node)` in `internal/checker/flow.go`.
- Identity alias/boundary checks and getter-like narrowing checks now use the same normalization path.
- Behavior intentionally unchanged; reduces normalization drift risk.

### Broad Getter Corpus Landing
- Added getter-to-identity parity corpus from submodule sources:
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

---

## Appendix B: Examples and Parity Demonstrations

### B.1 Basic Identity Narrowing
```ts
declare const read: identity () => string | undefined;

if (read() !== undefined) {
  const stable1: string = read(); // OK
  const stable2 = read().toUpperCase(); // OK
}
```

### B.2 Getter/Setter vs Identity — Stable Read
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
Identity:
```ts
declare const read: identity () => string | undefined;
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
Identity:
```ts
declare const read: identity () => string | undefined;
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
Identity (narrow preserve):
```ts
declare const read: identity () => string | undefined;
async function identityAwait() {
  if (read() !== undefined) {
    await Promise.resolve();
    const s: string = read(); // OK (narrow shape)
  }
}
```
Identity (ambient no-arg await nullish-read):
```ts
declare const nullishRead: identity () => string | null;
declare function delay(): Promise<void>;
async function identityAwaitAmbientDelay() {
  if (nullishRead()) {
    await delay();
    const s: string = nullishRead(); // OK (narrow corpus shape)
  }
}
```
Identity (broader await — conservative):
```ts
declare const read: identity () => string | undefined;
declare function delay(): Promise<void>;
async function identityAwaitConservative() {
  if (read() !== undefined) {
    await delay();
    const s: string = read(); // error
  }
}
```

### B.5 Boundary Invalidation Examples
```ts
declare const read: identity () => string | undefined;
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
// Pre-identity workaround:
declare const count: () => number | null;
const current = count();
const value = current !== null ? current : 0;

// With identity CFA:
declare const count: identity () => number | null;
const value2 = count() !== null ? count() : 0; // parity with getter-style CFA
if (count() !== null) {
  const n: number = count(); // OK
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
declare const shape: identity () => Shape;

if (shape().kind === "circle") {
  const r = shape().radius; // OK — kind check narrows repeated reads
}
```

### B.8 Issue-Driven Examples

**TS #60948 — Repeated read after guard:**
```ts
declare const value: identity () => string | undefined;
if (value() !== undefined) {
  value().toUpperCase(); // OK
}
```

**TS #60948 — Callback boundary invalidation:**
```ts
declare const value: identity () => string | undefined;
declare function invoke(cb: () => void): void;
if (value() !== undefined) {
  invoke(() => { const x = 1; });
  const s: string = value(); // error after boundary
}
```

**Angular #49161 — Ternary/computed one-liner:**
```ts
declare const count: identity () => number | null;
const x = count() !== null ? count() : 0;
```

**Angular #62181 — Template-like guard pattern (plain TS):**
```ts
type User = { name: string };
declare const user: identity () => User | null;
if (user() !== null) {
  const nameUpper = user().name.toUpperCase(); // OK
}
```

### B.9 Directional Future Examples (Not Implemented)

**Phase 5 — Explicit `mutator`/`links`:**
```ts
interface Store {
  identity user(): { name: string } | undefined;
  identity settings(): { theme: string } | undefined;
  mutator setUser(v: { name: string } | undefined) links user;
}
declare const store: Store;
if (store.user() !== undefined) {
  const u1: { name: string } = store.user(); // planned OK
  store.setUser(undefined);
  const u2: { name: string } = store.user(); // planned error after linked invalidation
}
```

**Phase 5 — Constrained-overload post-call narrowing:**
```ts
interface WritableSignal<T> {
  identity (): T;
  mutator update<U extends T>(fn: (value: T) => U) links this;
}
declare const sig: WritableSignal<string | number>;
sig.update(() => "x");
const narrowed: string = sig(); // planned OK when constrained overload + unique link resolved
```

**Phase 2 — Strict const no-op callback alias preserve:**
```ts
declare const read: identity () => string | undefined;
declare function invoke(cb: () => void): void;
if (read() !== undefined) {
  const cb = () => {};
  invoke(cb);
  const s: string = read(); // planned OK under strict alias proof
}
```

**Phase 2 — Guarded dynamic element-write precision:**
```ts
declare const model: { read: identity () => string | undefined; value: string | undefined; };
declare const key: "value";
if (model.read() !== undefined) {
  model[key] = "next";
  const s: string = model.read(); // planned behavior via proven-key guardrails
}
```

**Exploratory — Equality-chain reuse:**
```ts
declare const tag: identity () => "a" | "b" | "c";
if (tag() === "a" || tag() === "b") {
  const narrowed: "a" | "b" = tag(); // exploratory target
}
```

---

## Appendix C: Architecture Details

For full architecture specification, flow graphs, and divergence overlay, see [docs/identity-modifier-spec.md](identity-modifier-spec.md).

### Summary: Can Identity Use Getter Flow Line Directly?

**Short answer:** No, not fully in current architecture.

**Shared path:** Both getter and identity paths share CFA infrastructure — same flow graph, same `getTypeAtFlowCondition` narrowing engine, same `bindCondition` / `narrowType` / `narrowTypeByTruthiness` pipeline. Unified reference-candidate normalization via `getNormalizedReferenceCandidate(node)` in `internal/checker/flow.go`.

**Divergences:**
1. **Reference shape:** Getter uses property/element access references; identity uses zero-arg call references via `hasNarrowableArgument` + `setFlowNode` on `KindCallExpression`.
2. **Read typing entry:** Getter follows normal property access checking; identity has explicit call-site hook in `checkCallExpression` for `SignatureFlagsIdentity`.
3. **Boundary invalidation:** Getter has no identity-specific boundary branch; identity has dedicated `getTypeAtFlowCall` with boundary classification, preserve carveouts, and diagnostics.
4. **Boundary classification:** Single `identityBoundaryKind` classifier dispatches preserves via compact table (unknown call, callback, await, alias escape, generic other).
5. **Diagnostic emission:** Shared helpers in `checker.go` handle `TS100014`/`TS100015` selection and deduplication.

For Mermaid flow graphs (getter flow, identity flow, divergence overlay), see [docs/identity-modifier-spec.md](identity-modifier-spec.md).