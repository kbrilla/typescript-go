# Identity CFA Phase 1

## Scope
This PR covers Phase 1 only: `identity` support and heuristic uncertainty-boundary invalidation slices.
It does not include Phase 2 explicit contracts (`mutator`/`links`).

## References
- `docs/identity-modifier-spec.md`
- `docs/identity-heuristic-tdd-plan.md`
- `testdata/tests/cases/compiler/identityModifierParity.ts`

## Implemented So Far
- Parser and binder support for `identity` function-type modifier usage in declaration type positions.
- Parser lookahead fix so `identity<...>` type references are not misparsed as identity function-type starts.
- Repeated-read narrowing for covered local-flow identity call patterns.
- Conservative invalidation for currently implemented uncertainty boundaries.
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
- Mutable/reassigned local helpers remain conservative by design (`let localMaybeId = <T>(x: T) => x; localMaybeId = pass;`).
- Mutable/reassigned helper alias chains remain conservative by design (`let maybeAlias = localId; maybeAlias = pass;`).
- Non-trivial local function helper bodies remain conservative by design (`function localFnWrap<T>(x: T) { return () => x; }`).

## Boundary Coverage Matrix
| Boundary | Example shape | Status | Test source |
| --- | --- | --- | --- |
| Unknown call | `unknownMutate();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback statement | `invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback assignment form | `const r = invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback indirect helper argument | `const r = invoke(pass(() => {}));` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias initializer | `const escaped = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Indirect alias passthrough | `const indirect = pass(read);` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias reassignment | `alias = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await statement | `await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await assignment | `const x = await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
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
| Stable repeated read | `if (read() !== undefined) { read(); }` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Discriminant-kind parity | `if (shape().kind === "circle") { shape().radius }` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Discriminant unknown-call boundary | `if (shape().kind === "circle") { unknownShapeMutate(); shape().radius }` | Implemented (error after boundary) | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Callback invalidation | `invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Await invalidation | `await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Write-call analog invalidation | `store.set(...)` then `store.read()` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Property setter assignment invalidation | `model.value = ...` then `model.value` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Callable hybrid setter-style invalidation | `hybrid("next")` then `hybrid()` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| Callable hybrid undefined-write invalidation | `hybrid(undefined)` then `hybrid()` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |
| One-liner ternary | `read() !== undefined ? read() : "fallback"` | Implemented | `testdata/tests/cases/compiler/identityModifierParity.ts` |

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

### Parity 2: callback boundary invalidation (getter/setter vs identity)
Getter/setter style:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
declare function invoke(cb: () => void): void;

if (model.value !== undefined) {
  invoke(() => {});
  const s: string = model.value; // error
  s;
}
```

Identity style:
```ts
declare const read: identity () => string | undefined;
declare function invoke(cb: () => void): void;

if (read() !== undefined) {
  invoke(() => {});
  const s: string = read(); // error
  s;
}
```

### Parity 3: await boundary invalidation (getter/setter vs identity)
Getter/setter style:
```ts
declare const model: {
  get value(): string | undefined;
  set value(v: string | undefined);
};
declare function delay(): Promise<void>;

async function getterAwaitBoundary() {
  if (model.value !== undefined) {
    await delay();
    const s: string = model.value; // error
    s;
  }
}
```

Identity style:
```ts
declare const read: identity () => string | undefined;
declare function delay(): Promise<void>;

async function identityAwaitBoundary() {
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
Status: implemented in this PR (for covered callback call shapes)

```ts
declare const value: identity () => string | undefined;
declare function invoke(cb: () => void): void;

if (value() !== undefined) {
  invoke(() => {});
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
  const s: string = model.value; // error
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

## Not Yet Working (Phase 1)
- Broader nested/indirect callback boundary forms.
- Additional Tier 1 write-form invalidation expansion beyond currently covered property/method/callable-hybrid local shapes.
- Tier 2 guarded precision behavior itself (today's Tier 2 starter scenarios intentionally keep conservative invalidation expectations).

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

### Environment and workload
- Date: 2026-03-10
- Workload: TypeScript-main compile workload, same checkout and same input set for both runners
- Host: local macOS machine
- Measurement set: 3 wall-time runs each, plus max RSS sampling

### Comparable commands
```sh
# Upstream tsc (TypeScript main)
node ./_submodules/TypeScript/built/local/tsc.js -p ./_submodules/TypeScript/src/tsconfig.json --noEmit

# tsgo (same project/workload)
./tsgo -p ./_submodules/TypeScript/src/tsconfig.json --noEmit
```

### Results
| Runner | Wall times (s) | Avg wall (s) | Avg max RSS (MB) |
| --- | --- | --- | --- |
| upstream `tsc` | 8.86, 7.86, 7.84 | 8.19 | 708.3 |
| `tsgo` | 1.60, 1.29, 1.27 | 1.39 | 672.1 |

- Speedup: `8.19 / 1.39 ~= 5.9x`
- Memory: `672.1 MB` vs `708.3 MB` (`~5%` lower max RSS for `tsgo`)

### Caveats
- This is a single-machine snapshot, not a cross-hardware benchmark campaign.
- Results are for this TypeScript-main workload shape and current checkout state.
- Wall time and max RSS are coarse indicators; they do not isolate all phase-level costs.

### Phase 1 implication
These numbers support continuing Phase 1 with conservative boundary invalidation while iterating on correctness and parity slices, with less pressure to prematurely relax soundness guards for performance.
