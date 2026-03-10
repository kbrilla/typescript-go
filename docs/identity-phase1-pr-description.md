# Identity CFA Phase 1

## Scope
This PR covers Phase 1 only: `identity` support and heuristic uncertainty-boundary invalidation slices.
It does not include Phase 2 explicit contracts (`mutator`/`links`).

## References
- `docs/identity-modifier-spec.md`
- `docs/identity-heuristic-tdd-plan.md`

## Implemented So Far
- Parser and binder support for `identity` function-type modifier usage in declaration type positions.
- Parser lookahead fix so `identity<...>` type references are not misparsed as identity function-type starts.
- Repeated-read narrowing for covered local-flow identity call patterns.
- Conservative invalidation for currently implemented uncertainty boundaries.

## Boundary Coverage Matrix
| Boundary | Example shape | Status | Test source |
| --- | --- | --- | --- |
| Unknown call | `unknownMutate();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback statement | `invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Callback assignment form | `const r = invoke(() => {});` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias initializer | `const escaped = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Alias reassignment | `alias = read;` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await statement | `await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |
| Await assignment | `const x = await delay();` then `read()` | Implemented | `testdata/tests/cases/compiler/identityModifierBoundaries.ts` |

## Clean Working Examples
```ts
declare const read: identity () => string | undefined;
declare function unknownMutate(): void;
declare function invoke(cb: () => void): void;
declare function delay(): Promise<void>;

if (read() !== undefined) {
  const stable: string = read(); // OK
}

if (read() !== undefined) {
  unknownMutate();
  const afterUnknown: string = read(); // error
}

if (read() !== undefined) {
  invoke(() => {});
  const afterCallbackStmt: string = read(); // error
}

if (read() !== undefined) {
  const callbackResult = invoke(() => {});
  callbackResult;
  const afterCallbackAssign: string = read(); // error
}

if (read() !== undefined) {
  const escapedRead = read;
  escapedRead;
  const afterAliasInit: string = read(); // error
}

let alias: () => string | undefined;
if (read() !== undefined) {
  alias = read;
  alias;
  const afterAliasReassign: string = read(); // error
}

async function testAwaitBoundaries() {
  if (read() !== undefined) {
    await delay();
    const afterAwaitStmt: string = read(); // error
  }

  if (read() !== undefined) {
    const awaited = await delay();
    awaited;
    const afterAwaitAssign: string = read(); // error
  }
}
```

## Not Yet Working (Phase 1)
- Indirect alias escape and helper passthrough cases.
- Broader nested/indirect callback boundary forms.
- Additional Tier 1 write-form invalidation expansion.
- Tier 2 guarded invalidation slices.

```ts
declare const read: identity () => string | undefined;
declare function pass<T>(x: T): T;

if (read() !== undefined) {
  const indirect = pass(read);
  indirect;
  const stillNarrowed: string = read(); // should error after indirect alias escape is implemented
}
```

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
