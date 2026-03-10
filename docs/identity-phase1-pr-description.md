# Identity CFA Phase 1

## Scope
This PR covers Phase 1 only: `identity` support and heuristic uncertainty-boundary invalidation slices.
It does not include Phase 2 explicit contracts (`mutator`/`links`).

## References
- `docs/identity-modifier-spec.md`
- `docs/identity-heuristic-tdd-plan.md`
- `testdata/tests/cases/compiler/identityModifierParity.ts`
- `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts`
- `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts`
- `testdata/tests/cases/compiler/identityModifierHeuristicDiagnostics.ts`

## Implemented So Far
- Parser and binder support for `identity` function-type modifier usage in declaration type positions.
- Parser lookahead fix so `identity<...>` type references are not misparsed as identity function-type starts.
- Repeated-read narrowing for covered local-flow identity call patterns.
- Conservative invalidation for currently implemented uncertainty boundaries.
- Heuristic-limit diagnostic guidance for conservative uncertainty-boundary drops in identity call narrowing.
  - Diagnostic text: `Identity narrowing was conservatively dropped at an uncertainty boundary. Add an explicit guarded temporary or refactor to keep the narrowing scope local.`
- Conditional-expression callback initializer boundary invalidation (`const x = cond ? invoke(() => {}) : invoke(() => {})`).
- Tier 1 write-form parity expansion in local parity tests (property assignment and callable hybrid setter-style calls).
- Tier 2 starter test coverage for candidate forwarding/passthrough shapes with current conservative expectations in `testdata/tests/cases/compiler/identityModifierTier2.ts`.
- Narrow Tier 2 precision slice for inline trivial passthrough forwarding:
  - `const fwd = ((x) => x)(read);` preserves prior narrowing.
- Narrow Tier 2 precision slice for local const helper passthrough identifiers:
  - `const localId = <T>(x: T) => x; const forwarded = localId(read);` preserves prior narrowing.
- Narrow Tier 2 precision slice for local const helper alias-chain passthrough identifiers:
  - `const localId = <T>(x: T) => x; const localId2 = localId; const forwarded = localId2(read);` preserves prior narrowing.
- Narrow Tier 2 precision slice for local function declaration passthrough identifiers:
  - `function localFnId<T>(x: T) { return x; } const forwarded = localFnId(read);` preserves prior narrowing.
  - Non-inline helper passthrough remains conservative (`pass(read)`, `useReader(pass(read))`).
- Narrow await-boundary parity preservation slice:
  - `if (read() !== undefined) { await Promise.resolve(); const s: string = read(); }` preserves narrowing.
  - Broader await boundaries remain conservative (`await delay()`, `const x = await delay()`).
- Mutable/reassigned local helpers remain conservative by design (`let localMaybeId = <T>(x: T) => x; localMaybeId = pass;`).
- Mutable/reassigned helper alias chains remain conservative by design (`let maybeAlias = localId; maybeAlias = pass;`).
- Non-trivial local function helper bodies remain conservative by design (`function localFnWrap<T>(x: T) { return () => x; }`).
- Added broad getter-to-identity parity visibility corpus ported from submodule getter/CFA sources with section labels and source references:
  - `_submodules/TypeScript/tests/cases/compiler/narrowingOfQualifiedNames.ts`
  - `_submodules/TypeScript/tests/cases/compiler/narrowingOfDottedNames.ts`
  - `_submodules/TypeScript/tests/cases/compiler/getterControlFlowStrictNull.ts`
  - `_submodules/TypeScript/tests/cases/conformance/expressions/typeGuards/typeGuardsInProperties.ts`
  - `_submodules/TypeScript/tests/cases/conformance/expressions/typeGuards/typeGuardsInClassAccessors.ts`
- The broad corpus is visibility-first: parity mismatches are intentionally retained and baseline-accepted to expose remaining gaps.

## Phase 1 Checklist

### Working Now
- [x] `identity` parsing and binding in declaration type contexts.
- [x] Repeated-read narrowing for guarded local flow (`if (read() !== undefined) { read(); }`).
- [x] Implemented uncertainty boundaries invalidate prior narrowing for covered shapes (unknown call, callback forms, alias escape, `await`).
- [x] Parser disambiguation for `identity<...>` type references.
- [x] Dedicated local parity suite exists and is green (`identityModifierParity.ts`).
- [x] Getter-to-identity parity visibility sweep is green (`identityModifierGetterParitySweep.ts`).
- [x] Broad getter-to-identity parity corpus landed with source-tagged sections and intentional mismatch visibility (`identityModifierGetterCorpus.ts`).
- [x] Tier 1 parity slice coverage for property assignment and callable hybrid setter-style writes in local tests.
- [x] Narrow write parity slice: same-receiver `read()` then `set(non-nullish)` now preserves narrowing (`P5` in getter parity sweep).
- [x] Tier 2 narrow precision for trivial local passthrough helper shapes.
- [x] Narrow await parity slice: expression-statement `await Promise.resolve()` now preserves narrowing (`P4` in getter parity sweep).

### Left for Phase 1
- [ ] Broaden nested/indirect callback boundary parity beyond currently covered forms (conditional initializer form now covered).
- [ ] Expand Tier 1 write-form matrix breadth beyond current local parity slices.
- [ ] Extend Tier 2 guarded precision beyond trivial syntactic passthrough forms while preserving soundness.
- [x] Add heuristic-limit diagnostics for uncertainty-boundary conservative invalidation (Step 7 narrow slice).
- [ ] Expand parity mapping against submodule scenarios where practical.

## Getter vs Identity Parity Matrix
| Behavior category | Getter | Identity | Parity |
| --- | --- | --- | --- |
| Basic repeated reads after guard | Implemented | Implemented | Full |
| Branch merge reset after guard split | Implemented | Implemented | Full |
| Callback no-op expression-statement boundary (`invoke(() => {})`) | Remains narrowed in sweep scenario | Preserved for narrow no-op callback statement shape | Full |
| Await boundary invalidation | Remains narrowed in sweep scenario | Preserved for narrow expression-statement `await Promise.resolve()` and ambient no-arg `await delay()` nullish-read shapes; broader awaits remain conservative | Full |
| Write invalidation after setter/write call (`set(non-nullish)` sweep slice) | Remains narrowed in sweep scenario | Matches for narrow same-receiver `read`/`set` shape | Full |
| Aliasing / escape handling | Object alias keeps getter narrowing in sweep scenario | Function alias invalidates | Gap |
| Conditional/ternary repeated-read shape | Implemented | Implemented | Full |
| Nested discriminant read reuse | Implemented | Implemented | Full |
| Nested unknown-call boundary after discriminant guard | Remains narrowed in sweep scenario | Invalidates conservatively | Gap |
| Tier 2 forwarding precision (non-trivial helpers) | N/A | Partial | Gap |
| Heuristic-limit diagnostics | N/A | Implemented for uncertainty-boundary conservative invalidation | Partial |

Parity score summary:
- `7/9` getter-comparable CFA categories are fully matched in the sweep (`P1`, `P2`, `P3`, `P4`, `P5`, `P7`, `P8` read-reuse branch).
- `2/9` getter-comparable categories show visible mismatches in the sweep (`P6`, `P8` unknown-call boundary).
- Additional Phase 1 gaps remain: Tier 2 broader forwarding precision and diagnostics for lower-confidence non-boundary Tier 2 cases.

Remaining visible gaps from getter-to-identity sweep:
- Aliasing: object aliasing for getter stays narrowed while identity function aliasing invalidates.
- Nested unknown-call boundary: getter scenario stays narrowed while identity invalidates.

## Boundary Coverage Matrix
| Boundary | Example shape | Status | Test source |
| --- | --- | --- | --- |
| Unknown call | `unknownMutate();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback statement | `invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback assignment form | `const r = invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback conditional initializer form | `const r = cond ? invoke(() => {}) : invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback indirect helper argument | `const r = invoke(pass(() => {}));` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias initializer | `const escaped = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Indirect alias passthrough | `const indirect = pass(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias reassignment | `alias = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await statement | `await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await assignment | `const x = await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await safe preserve (narrow) | `await Promise.resolve();` then `read()` in expression-statement form | Implemented | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Tier 2 starter (alias-preserving forwarding) | `const forwarded = pass(read);` then `read()` | Starter coverage (current conservative) | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 starter (helper passthrough) | `useReader(pass(read));` then `read()` | Starter coverage (current conservative) | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 narrow precision (inline passthrough lambda) | `const fwd = ((x) => x)(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 narrow precision (const helper identifier passthrough) | `const localId = <T>(x: T) => x; localId(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 narrow precision (const helper alias-chain passthrough) | `const localId = <T>(x: T) => x; const localId2 = localId; localId2(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 narrow precision (function declaration helper passthrough) | `function localFnId<T>(x: T) { return x; } localFnId(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 conservative non-goal (non-trivial function declaration helper body) | `function localFnWrap<T>(x: T) { return () => x; } localFnWrap(read);` then `read()` | Intentionally conservative (error) | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 conservative non-goal (mutable helper reassignment) | `let localMaybeId = <T>(x: T) => x; localMaybeId = pass; localMaybeId(read);` then `read()` | Intentionally conservative (error) | `testdata/tests/cases/compiler/identityModifierTier2.ts` |
| Tier 2 conservative non-goal (mutable helper alias-chain reassignment) | `const localId = <T>(x: T) => x; let maybeAlias = localId; maybeAlias = pass; maybeAlias(read);` then `read()` | Intentionally conservative (error) | `testdata/tests/cases/compiler/identityModifierTier2.ts` |

## Parity Coverage Matrix (New Local Slice)
| Parity pattern | Example shape | Status | Test source |
| --- | --- | --- | --- |
| Basic repeated read parity | getter `model.value` vs identity `read()` | Matched | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Branch merge parity | post-merge `string` assignment | Matched | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Callback no-op statement parity | `invoke(() => {})` then read | Matched (narrow shape) | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Await boundary parity (narrow safe shapes) | `await Promise.resolve()` then read; ambient no-arg `await delay()` with nullish identity read | Matched (narrow shapes) | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts`, `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts` |
| Write invalidation parity (`set(non-nullish)` slice) | setter/write call then read | Matched | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Aliasing parity | alias/escape then read | Mismatch (identity more conservative) | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Conditional/ternary parity | guarded ternary read fallback | Matched | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Nested discriminant reuse parity | kind guard then nested field read | Matched | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Nested unknown-call boundary parity | kind guard + unknown call + nested read | Mismatch (identity more conservative) | `testdata/tests/cases/compiler/identityModifierGetterParitySweep.ts` |
| Existing hybrid/write-call slices | callable hybrid + setter-call analog | Additional visibility | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Broad getter corpus (submodule-derived) | qualified names, dotted names, strict-null getter flow, type-guard member patterns | Visibility-first, includes intentional mismatches | `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts` |

## Broad Getter Corpus Status
- New corpus file: `testdata/tests/cases/compiler/identityModifierGetterCorpus.ts`
- Corpus intent: maximize parity visibility, not immediate all-green parity.
- Remaining identity-side parity gaps are intentionally baseline-accepted where conservative invalidation still differs from getter behavior.
- This corpus is now part of local parity evidence and should be used to track gap closure slices in subsequent PRs.
- Closed mismatch `QN5` (generic discriminant narrowing over `PetType extends Pet`) by enabling identity-call flow to use narrowable return types.
- Closed mismatch `X1` (alias escape via ambient passthrough helper `pass`) with a narrow Tier 2 guarded precision extension in alias-escape analysis.
- Closed mismatch `GC3` (strict-null await boundary from getter control-flow corpus) with a narrow await preserve rule for ambient no-arg `Promise<void>` calls on nullish identity reads.
- Corpus mismatch movement in this slice:
  - mismatch cases: `2 -> 1` (`GC3`, `X3` -> `X3`)
  - corpus error count: `6 -> 4`
  - getter parity sweep score movement: no change (`7/9`, `2` remaining sweep gaps)
- Final X3 safety assessment (this update):
  - attempted to define a minimal unknown-call preserve carveout for `X3`
  - rejected as not safely provable without broadening unsound behavior at uncertainty boundaries
  - corpus remains at `1` broad getter mismatch (`X3`) and `4` total corpus errors

## Examples and Parity

### Works: identity narrowing after guard (before boundaries)
```ts
declare const read: identity () => string | undefined;

if (read() !== undefined) {
  const stable1: string = read(); // OK
  const stable2 = read().toUpperCase(); // OK
  stable1;
  stable2;
}
```

### Parity 1: stable read (getter/setter vs identity)
Getter/setter style:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};

if (model.value !== undefined) {
  const s: string = model.value; // OK
  s;
}
```

Identity style:
```ts
declare const read: identity () => string | undefined;

if (read() !== undefined) {
  const s: string = read(); // OK
  s;
}
```

### Parity 2: callback no-op parity (getter/setter vs identity)
Getter/setter style:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
declare function invoke(cb: () => void): void;

if (model.value !== undefined) {
  invoke(() => {});
  const s: string = model.value; // getter sweep observation: OK
  s;
}
```

Identity style:
```ts
declare const read: identity () => string | undefined;
declare function invoke(cb: () => void): void;

if (read() !== undefined) {
  invoke(() => {});
  const s: string = read(); // OK in this narrow no-op statement shape
  s;
}
```

Non-no-op callback bodies remain conservative in current Phase 1:
```ts
declare const read: identity () => string | undefined;
declare function invoke(cb: () => void): void;

if (read() !== undefined) {
  invoke(() => { const callbackWrite = 1; callbackWrite; });
  const s: string = read(); // error
  s;
}
```

### Parity 3: await boundary narrow parity (getter/setter vs identity)
Getter/setter style:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
async function getterAwaitBoundary() {
  if (model.value !== undefined) {
    await Promise.resolve();
    const s: string = model.value; // getter sweep observation: OK
    s;
  }
}
```

Identity style:
```ts
declare const read: identity () => string | undefined;
async function identityAwaitBoundary() {
  if (read() !== undefined) {
    await Promise.resolve();
    const s: string = read(); // OK in this narrow shape
    s;
  }
}

declare const nullishRead: identity () => string | null;
declare function delay(): Promise<void>;
async function identityAwaitAmbientDelayBoundary() {
  if (nullishRead()) {
    await delay();
    const s: string = nullishRead(); // OK in this narrow corpus shape
    s;
  }
}
```

Broader await forms remain conservative in current Phase 1:
```ts
declare const read: identity () => string | undefined;
declare function delay(): Promise<void>;

async function identityAwaitConservative() {
  if (read() !== undefined) {
    await delay();
    const s: string = read(); // error
    s;
  }
}
```

### Additional implemented boundary examples (identity)
```ts
declare const read: identity () => string | undefined;
declare function unknownMutate(): void;
declare function pass<T>(x: T): T;
declare function invoke(cb: () => void): void;

if (read() !== undefined) {
  const viaHelper = invoke(pass(() => {}));
  viaHelper;
  const afterCallbackViaHelper: string = read(); // error
  afterCallbackViaHelper;
}

if (read() !== undefined) {
  unknownMutate();
  const afterUnknown: string = read(); // error
  afterUnknown;
}

if (read() !== undefined) {
  const escapedRead = read;
  escapedRead;
  const afterAliasInit: string = read(); // error
  afterAliasInit;
}

if (read() !== undefined) {
  const indirect = pass(read);
  indirect;
  const afterIndirectAlias: string = read(); // error
  afterIndirectAlias;
}

let alias: () => string | undefined;
if (read() !== undefined) {
  alias = read;
  alias;
  const afterAliasReassign: string = read(); // error
  afterAliasReassign;
}
```

## Issue-Driven Example Matrix

Where narrowing works today in this PR:
- Repeated `identity` reads narrow in the same guarded local-flow region.
- Narrowing is intentionally invalidated at implemented uncertainty boundaries (unknown calls, callback invocation shapes covered in tests, alias escape, `await`).

### TS #60948: repeated read after guard (main case)
Status: implemented in this PR

```ts
declare const value: identity () => string | undefined;

if (value() !== undefined) {
  value().toUpperCase(); // OK in this PR
}
```

Getter/setter parity:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};

if (model.value !== undefined) {
  model.value.toUpperCase(); // OK
}
```

### TS #60948: callback boundary invalidation (`setTimeout` / `invoke`)
Status: partially implemented in this PR

```ts
declare const value: identity () => string | undefined;
declare function invoke(cb: () => void): void;

if (value() !== undefined) {
  invoke(() => { const callbackWrite = 1; callbackWrite; });
  const s: string = value(); // error after boundary
  s;
}
```

`setTimeout` shape:
```ts
declare const value: identity () => string | undefined;

if (value() !== undefined) {
  setTimeout(() => {});
  const s: string = value(); // expected error by same boundary intent
  s;
}
```

Getter/setter parity:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};

if (model.value !== undefined) {
  setTimeout(() => {});
  const s: string = model.value; // getter sweep observation: still OK
  s;
}
```

### Angular #49161: ternary/computed one-liner (`count() !== null ? count() : 0`)
Status: partially covered

```ts
declare const count: identity () => number | null;

const x = count() !== null ? count() : 0; // parity target: second count() narrows to number
x;
```

Getter/setter parity:
```ts
declare const model: {
  get count(): number | null;
  set count(v: number | null);
};

const x = model.count !== null ? model.count : 0; // property-style baseline
x;
```

## Angular Signals: Nullability and Narrowing

Context: `angular/angular#49161` highlights a common signal call-site pain point in plain TypeScript: repeated calls (in ternary/if/discriminant checks) do not consistently preserve narrowing like property getters do.

### Current pain shape (repeated signal calls)
```ts
declare const count: () => number | null;

const value = count() !== null ? count() : 0;
// Today this often requires extra ceremony because the second count()
// may not reuse the first check's narrowing in all patterns.
value;
```

### Identity-enabled equivalent (narrowing reuse)
```ts
declare const count: identity () => number | null;

const value = count() !== null ? count() : 0; // parity target with getter-style CFA
value;

if (count() !== null) {
  const n: number = count(); // intended plain-TS ergonomics improvement in this PR
  n;
}
```

### Workaround with local variable (pre-identity pattern)
```ts
declare const count: () => number | null;

const current = count();
const value = current !== null ? current : 0;
value;
```

With `identity` CFA, the local-temp workaround is still valid, but many repeated-read guard patterns no longer require introducing a temporary only to keep narrowing.

### Discriminated-union signal access shape
```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; size: number };

declare const shape: identity () => Shape;

if (shape().kind === "circle") {
  const r = shape().radius; // parity target: kind check narrows repeated identity reads
  r;
}
```

### What this enables in Angular signals
- Fewer forced temporary locals (for example `const v = signal()`) just to preserve null checks in plain TypeScript code.
- Fewer redundant optional chains and fallback reshaping when repeated guarded reads are already safe.
- Better parity with getter ergonomics in plain TypeScript code (`obj.value` flow behavior vs `signal()` flow behavior).
- More predictable behavior when refactoring from property-getter access patterns to signal-call access patterns in component/service logic.

Scope note:
- This PR improves plain TypeScript checker behavior for covered `identity` call patterns.
- Angular template type-checking behavior is outside this compiler PR and is not claimed as changed here.

### Angular #49161: discriminated-union shape-kind narrowing style
Status: implemented in covered local parity shape

```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; size: number };

declare const shape: identity () => Shape;

if (shape().kind === "circle") {
  shape().radius; // parity target: OK
}
```

Boundary invalidation still applies after uncertainty calls:
```ts
declare function unknownShapeMutate(): void;

if (shape().kind === "circle") {
  unknownShapeMutate();
  const r: number = shape().radius; // error after boundary
  r;
}
```

Getter/setter parity:
```ts
declare const model: {
  get shape(): Shape;
  set shape(v: Shape);
};

if (model.shape.kind === "circle") {
  model.shape.radius; // property-style baseline
}
```

### Angular #62181: template-like guard pattern translated to TS
Status: implemented in this PR for plain TypeScript guard shape (template integration remains outside this compiler PR)

```ts
type User = { name: string };
declare const user: identity () => User | null;

if (user() !== null) {
  const nameUpper = user().name.toUpperCase(); // template-like repeated access shape
  nameUpper;
}
```

Getter/setter parity:
```ts
declare const model: {
  get user(): User | null;
  set user(v: User | null);
};

if (model.user !== null) {
  const nameUpper = model.user.name.toUpperCase();
  nameUpper;
}
```

## Detailed Remaining Scope (Phase 1)
- Broader nested/indirect callback boundary forms.
- Additional Tier 1 write-form invalidation expansion beyond currently covered property/method/callable-hybrid local shapes.
- Tier 2 guarded precision behavior itself (today's Tier 2 starter scenarios intentionally keep conservative invalidation expectations).
- Remaining broad getter corpus mismatches: `X3`.

## Phase 2 Out of Scope
- Explicit `mutator`/`links` fallback resolution.
- Ambiguity diagnostics for unresolved multi-endpoint impact.
- Constrained-overload post-call narrowing from explicit contracts.

## Validation
Latest tip validation is green:
- `npx hereby build`
- `npx hereby test`
- `npx hereby lint`
- `npx hereby format`

## TypeScript-main Benchmark Snapshot

### Setup
- Date: 2026-03-10
- Workload: TypeScript-main compile workload on one local macOS host
- Measurement set: 3 wall-time runs each, plus max RSS sampling

### Comparable commands
```sh
node ./_submodules/TypeScript/built/local/tsc.js -p ./_submodules/TypeScript/src/tsconfig.json --noEmit
./tsgo -p ./_submodules/TypeScript/src/tsconfig.json --noEmit
```

### Results
| Runner | Wall times (s) | Avg wall (s) | Avg max RSS (MB) |
| --- | --- | --- | --- |
| upstream `tsc` | 8.86, 7.86, 7.84 | 8.19 | 708.3 |
| `tsgo` | 1.60, 1.29, 1.27 | 1.39 | 672.1 |

- Throughput snapshot: `~5.9x` faster wall time for `tsgo` on this workload.
- Memory snapshot: `~5%` lower max RSS for `tsgo`.

## Benchmark: tsgo main vs this branch

### Setup
- Date: 2026-03-10
- Workload baseline commit: TypeScript main `c9e7428bb76f0543a3555d0af87777e7db3a41e6`
- Compared tsgo commits:
  - main: `4a59cd78390d5789f547db8af35b43be2f829719`
  - feature: `0bb576a859097252b54e1165bb88b84cf073f06d`
- Measurement set: 3 wall-time runs per commit and average RSS comparison

### Results
| Build | Runs (s) | Avg wall (s) | Avg RSS (MiB) |
| --- | --- | --- | --- |
| tsgo main (`4a59cd7`) | 1.34, 1.33, 1.32 | 1.33 | 650.8 |
| this branch (`0bb576a`) | 1.37, 1.31, 1.49 | 1.39 | 636.2 |

### Interpretation
- Wall time delta: `+4.51%` (this branch is slower).
- RSS delta: `-2.24%` (this branch uses less memory).
- Net: current Phase 1 behavior trades a small wall-time regression for a modest RSS improvement on this workload.

### Caveat
- This is a small sample size on one machine. Additional runs may reduce noise and tighten the wall-time delta estimate.
