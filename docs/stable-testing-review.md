# Stable Modifier PR — Testing Review

**Reviewer**: Senior QA/Testing Engineer  
**Scope**: All test files for stable CFA modifier feature  
**Files reviewed**: 16 snapshot test files + 1 Go benchmark test  
**Total test lines**: ~1,979

---

## Executive Summary

The test strategy is **parity-driven** — most tests establish a getter baseline then verify that stable function types achieve the same CFA narrowing. This is sound for a feature designed to provide getter-like narrowing for callable types. Coverage of CFA semantics is excellent (40+ patterns, 9/10), but there are critical blind spots in emit testing, cross-module behavior, and modifier-conflict diagnostics.

**Overall Regression Safety: 6/10** — Strong on CFA semantics, critical gaps in emit and cross-module.

### Severity Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 3 | TS100013 untested, no declaration emit, no JS emit |
| HIGH | 3 | No multi-file tests, no checkJs tests, getter parity anchor weakness |
| MEDIUM | 12 | Missing patterns (optional chaining, mapped types, etc.), test overlap, misleading comments |
| LOW | 5 | Minor dedup, benchmark gaps, target settings |

---

## 1. Test Strategy Assessment

**[INFO] Sound Philosophy**: Parity-driven testing (getter baseline + stable match) is correct for this feature.

**[INFO] Clean Test Pyramid**: 4 clean-pass tests, 12 with expected errors. No diff baselines (good hygiene).

**[HIGH] No Emit Tests**: All 16 tests use `// @noEmit: true`. Zero `.d.ts` or `.js` baselines. How stable appears in declarations and emitted JS is completely untested.

**[MEDIUM] Single-File Only**: Zero tests use `// @filename:` for multi-file scenarios. Cross-module stable behavior is untested.

---

## 2. Coverage Matrix

### Covered (40+ patterns)

| CFA Pattern | Files | Status |
|---|---|---|
| Basic undefined guard | Narrowing, Parity, Boundaries | Clean |
| Truthiness guard | Narrowing, SubmoduleParity | Clean |
| Ternary/conditional | Parity, SubmoduleParity, Sweep | Clean |
| typeof narrowing | SignalPatterns, SubmoduleParity | Clean |
| Equality narrowing | SubmoduleParity | Clean |
| Nullish coalescing | SubmoduleParity | Clean |
| Logical AND/OR | SubmoduleParity | Clean |
| Switch/case discriminant | SubmoduleParity | Clean |
| Type predicate | SubmoduleParity | Clean |
| Generic discriminant | GenericDiscriminant, Corpus | Clean |
| While-loop narrowing | SubmoduleParity | Clean |
| Negated narrowing | SubmoduleParity | Clean |
| Deep qualified-name chain | Corpus, MissingMatrix | Clean |
| Callback boundary | Parity, Boundaries, Sweep | Errors |
| Unknown-call boundary | Boundaries, HeuristicDiags, P8Conservative | Errors |
| Await boundary | Boundaries, Sweep | Mixed |
| Alias escape | Boundaries, Sweep | Mixed |
| Non-null assertion | SignalPatterns | Clean |
| Closure captures | Closures | Mixed |
| IIFE | Closures | Clean |
| Class member stable | SignalPatterns | Clean |
| Destructured tuple signal | SignalPatterns | Clean |
| Discriminated unions | Parity, Corpus, SubmoduleParity | Clean |
| Write invalidation | Tier1Writes | Errors |
| Diagnostic dedup | HeuristicDiagnostics | Verified |
| Contextual keyword | Errors | Clean |
| Parse errors (params, dup, constructor) | Diagnostics, Errors | Verified |
| Tier 2 passthrough helpers | Tier2 | Mixed |

### Missing

| Missing Pattern | Severity |
|---|---|
| Declaration emit (.d.ts output) | CRITICAL |
| JS emit | CRITICAL |
| TS100013 modifier conflicts | CRITICAL |
| Cross-module import/export | HIGH |
| checkJs / .js files | HIGH |
| Optional chaining (?.) | MEDIUM |
| Intersection types | MEDIUM |
| Mapped types | MEDIUM |
| Conditional types | MEDIUM |
| Index signatures | MEDIUM |
| Computed property names | MEDIUM |
| Private # fields | MEDIUM |
| Generic constraints | MEDIUM |
| satisfies operator | LOW |
| Error recovery (malformed syntax) | LOW |
| isolatedModules | LOW |
| Multiple @target settings | LOW |

---

## 3. Quality Assessment (Per-File)

| File | Lines | Grade | Notes |
|---|---|---|---|
| stableModifierNarrowing | 45 | **A** | Clear, minimal, core feature test |
| stableModifierDiagnostics | 14 | **A** | Concise, 3 distinct error cases |
| stableModifierErrors | 15 | **B+** | Overlaps with Diagnostics; good contextual keyword test |
| stableModifierGenericDiscriminant | 21 | **A** | Clean, focused generic discriminant parity |
| stableModifierGetterCorpus | 383 | **B** | Large corpus, well-sectioned, dense parity annotations |
| stableModifierGetterMissingMatrix | 287 | **B-** | Duplicates Corpus patterns, unclear why variants matter |
| stableModifierGetterParitySweep | 230 | **B-** | Significant overlap with Corpus and Parity |
| stableModifierHeuristicDiagnostics | 46 | **A** | Focused on diagnostic dedup. Good. |
| stableModifierParity | 115 | **B+** | Core parity test. HybridSignal limitation well-documented |
| stableModifierSignalPatterns | 189 | **A-** | Excellent real-world coverage: SolidJS, Angular |
| stableModifierSubmoduleParity | 142 | **A** | Systematic CFA patterns from TS submodule |
| stableModifierBoundaries | 151 | **A-** | Comprehensive boundary testing |
| stableModifierClosures | 70 | **A** | Clean, focused closure-specific behavior |
| stableModifierP8Conservative | 37 | **A** | Focused isolate of conservative behavior |
| stableModifierTier1Writes | 85 | **B+** | Thorough write invalidation; 80% tests getters not stable |
| stableModifierTier2 | 149 | **B+** | Good tier-2 stratification |
| stable_bench_test.go | ~95 | **B** | Basic but functional, only 2 scenarios |

---

## 4. Snapshot/Baseline Concerns

**[INFO]** No diff baselines exist — good hygiene. All baselines are deterministic.

**[MEDIUM] Brittleness Risk**: Type printer representation changes would cascade across all 16 `.types` baselines.

**[MEDIUM] Baseline Rot Risk**: Parity annotations in test comments (e.g., `// getter baseline: OK`) are not enforced by the baseline system. A developer accepting baselines might miss semantic regressions.

**[LOW] Cascade Risk**: A single behavioral change to the uncertainty-boundary heuristic would require updating baselines in 8 of 16 files. Manageable but approaching maintenance-pain threshold.

---

## 5. Parity Testing Methodology

**[INFO]** Sound approach — getter baseline + stable parity in every test.

**[HIGH]** Getter baselines are tested in the same file as stable. If getter behavior changes upstream, both baselines shift together, hiding divergence. Consider standalone getter-only anchor tests.

**[MEDIUM]** Some parity tests test standard TS behavior (logical-and, typeof), not stable-specific behavior. This provides false confidence about stable coverage.

---

## 6. Error/Diagnostic Testing

| Code | Description | Test Coverage |
|------|-------------|---------------|
| TS100012 | stable with parameters | Tested (Diagnostics, Errors) |
| TS100013 | stable with conflicting modifier | **UNTESTED** |
| TS100014 | uncertainty boundary warning | Heavily tested (56 occurrences, 8 files) |
| TS100015 | unknown call boundary | Undertested (4 occurrences, 1 file) |

**[CRITICAL]** TS100013 has zero test coverage. No test verifies that `readonly stable`, `abstract stable`, `static stable`, etc. produce the expected error.

**[MEDIUM]** TS100015 is only tested in stableModifierClosures (4 occurrences). Should have broader coverage.

**[INFO]** Deduplication tested — TS100014 appears once per boundary, not per subsequent read. Good.

---

## 7. Real-World Pattern Coverage

| Pattern | Covered? | File |
|---------|----------|------|
| SolidJS createSignal | Yes | SignalPatterns |
| Angular InputSignal | Yes | SignalPatterns |
| Class member stable | Yes | SignalPatterns |
| RxJS Observable-like | **No** | — |
| React useState-like | **No** | — |
| Zustand/Jotai store | **No** | — |
| Angular computed() | **No** | — |
| Event emitter pattern | **No** | — |

---

## 8. Benchmark Assessment

**[INFO]** Methodology is sound — `b.Loop()` (Go 1.24+), `b.ReportAllocs()`, `b.ResetTimer()`, warm-up run. Good practice.

**[MEDIUM]** Only 2 scenarios benchmarked (repeated reads, uncertainty boundary). Missing: discriminant chains, large unions, generic contexts, many independent narrowings.

**[LOW]** No CI threshold or regression assertion — manual monitoring only.

---

## 9. Redundancy Analysis

**[MEDIUM]** 3 parity files (Corpus, MissingMatrix, Sweep) have ~40% overlap. Same CFA patterns tested in 3-4 files. This is an artifact of iterative development, not intentional design.

**Impact**: A single behavioral change requires updating baselines in multiple files. Consolidation to 1-2 files is recommended.

**[LOW]** stableModifierErrors and stableModifierDiagnostics both test TS100012 (params error). Could merge.

---

## 10. Regression Safety Score

| Aspect | Score | Rationale |
|---|---|---|
| Core narrowing semantics | 9/10 | Excellent CFA pattern coverage |
| Boundary heuristics | 8/10 | Well-tested across files |
| Syntax validation | 6/10 | TS100013 untested |
| Emit representation | 1/10 | No declaration or JS emit tests |
| Cross-module behavior | 1/10 | Zero multi-file tests |
| Framework-pattern realism | 7/10 | SolidJS, Angular covered |
| Diagnostic accuracy | 7/10 | Good dedup, TS100015 undertested |
| Benchmark regression | 4/10 | Exists but narrow |
| **Overall** | **6/10** | |

---

## 11. Specific Findings

| # | Severity | File | Description |
|---|----------|------|-------------|
| F1 | CRITICAL | (missing) | TS100013 defined but never tested. No modifier-conflict tests. |
| F2 | CRITICAL | (missing) | No declaration emit tests. .d.ts representation of stable completely untested. |
| F3 | CRITICAL | (missing) | No JS emit tests. Runtime behavior of stable-typed code untested. |
| F4 | HIGH | (missing) | No multi-file / cross-module tests. |
| F5 | HIGH | (missing) | No @checkJs tests. JSDoc interop untested. |
| F6 | HIGH | Parity tests | Getter baselines co-located with stable — upstream getter changes hide divergence. |
| F7 | MEDIUM | GetterCorpus | Lines 301-305 test standard TS logical-and behavior, not stable. False confidence. |
| F8 | MEDIUM | Parity | HybridSignal section (lines 74-92) tests parser limitation, not stable CFA. |
| F9 | MEDIUM | Tier1Writes | 80% of file tests getter write-invalidation, not stable. |
| F10 | MEDIUM | Closures | Section 2 comments don't fully match actual baseline behavior. |
| F11 | MEDIUM | (missing) | No optional chaining test. |
| F12 | MEDIUM | (missing) | No mapped type, conditional type, intersection type tests. |
| F13 | LOW | MissingMatrix | Section M6 tests standard TS narrowing, not getter or stable. |
| F14 | LOW | Boundaries | Subtle await preserve/invalidate distinction not explained in comments. |
| F15 | LOW | bench_test.go | Only 2 benchmark scenarios, no non-strict benchmark. |

---

## 12. Recommendations

### Priority 1 — Critical (Block shipping)

1. **Add TS100013 modifier-conflict tests**: `readonly stable`, `abstract stable`, `static stable`, `override stable`, `async stable`
2. **Add declaration emit test**: At least one test with `// @declaration: true` (no `@noEmit`) to verify `.d.ts` output preserves `stable`
3. **Add JS emit test**: At least one test without `@noEmit` to verify correct JS output

### Priority 2 — High (Pre-release)

4. **Add multi-file tests**: `// @filename: types.ts` exporting stable type + `// @filename: consumer.ts` importing and narrowing
5. **Add @checkJs test**: `.js` file consuming stable types via JSDoc
6. **Consolidate corpus/matrix/sweep** into 1-2 files organized by CFA pattern

### Priority 3 — Medium (Before v1)

7. Add optional chaining test
8. Add mapped type / conditional type / intersection type tests
9. Expand benchmarks with discriminant, generic, large-union scenarios
10. Clean up misleading comments where baseline behavior differs from comment expectations

### Priority 4 — Low (Ongoing)

11. Dedup TS100012 test across Errors and Diagnostics
12. Add multi-target settings to at least one emit test
13. Consider error recovery test for malformed stable syntax
