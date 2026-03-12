# `stable`, `mutator`, `invalidates`, and Linked Type Predicates

**CFA narrowing through function calls — four cooperative mechanisms**

---

## Problem

TypeScript cannot narrow through repeated function calls. If `value()` returns `string | undefined` and you check `value() !== undefined`, the compiler forgets this on the next `value()` call. This is a major pain point for signal-based frameworks (Angular Signals, Preact Signals, MobX) where state is accessed through getter functions rather than properties. Property narrowing has worked for years — callable getter narrowing has not, despite being the dominant pattern in modern reactive frameworks.

## Real-World Issues Addressed

This proposal addresses a family of long-standing TypeScript issues with **1,350+ combined upvotes**:

### Repeated function call narrowing (TS-60948 — 105 👍, TS-57725 — 351 👍)

```ts
// TODAY: narrowing lost on second call
declare const value: () => string | undefined;
if (value() !== undefined) {
    value().toUpperCase();  // ❌ Error: 'string | undefined' has no method 'toUpperCase'
}

// WITH STABLE: narrowing preserved
declare const value: stable () => string | undefined;
if (value() !== undefined) {
    value().toUpperCase();  // ✅ OK — narrowed to string
}
```

### Angular Signal narrowing (TS-49161 — 149 👍)

```ts
// TODAY: Signal narrowing fails in computed expressions
const count = signal(null as null | number);
const total: number = count() !== null ? count() : 0;  // ❌ Error: number | null

// WITH STABLE: Signal narrowing works
const count: stable () => number | null = signal(null as null | number);
if (count() !== null) {
    count() + 1;  // ✅ narrowed to number
}
```

### Map has/get narrowing (TS-9619 — 179 👍, TS-13086 — 189 👍)

```ts
// TODAY: has() provides no evidence about get()
const map = new Map<string, number>();
if (map.has("x")) {
    const val = map.get("x");  // ❌ number | undefined — no connection
}

// WITH LINKED PREDICATES (Phase 9):
interface TypedMap<K, V> {
    stable get(key: K): V | undefined;
    has<K2 extends K>(key: K2): this.get(key) is V;
}
declare const map: TypedMap<string, number>;
if (map.has("x")) {
    const val = map.get("x");  // ✅ number — linked predicate narrows
}
```

### CFA trade-offs formalized (TS-9998 — 130 👍, 598 comments)

ahejlsberg's 2016 design question — "When a function is invoked, what should we assume its side effects are?" — remained unanswered for 9 years. `stable`/`mutator` is the first practical answer: functions can declare their relationship to narrowing explicitly.

### Correlated method types (TS-30581 — 159 👍)

```ts
// TODAY: no method-to-method type correlation
interface Resource<T> {
    value(): T | undefined;
    hasValue(): boolean;
}
if (resource.hasValue()) {
    resource.value();  // ❌ still T | undefined
}

// WITH LINKED PREDICATES (Phase 3):
interface Resource<T> {
    stable value(): T | undefined;
    hasValue(): this.value() is Exclude<T, undefined>;
}
if (resource.hasValue()) {
    resource.value();  // ✅ narrowed to T (without undefined)
}
```

### Method Declaration Syntax (NEW — SYN-4)

`stable` and `mutator` now work as method modifiers on method declarations and method signatures — not just function type annotations. This enables natural usage in classes, interfaces, and type literals:

```ts
// stable/mutator as method modifiers (class declarations)
class Store<T> {
    stable get(): T { return this._value; }
    mutator set(value: T): void { this._value = value; }
    mutator reset(): void { this._value = undefined as any; }
}

// Also works on interfaces and type literals
interface ReadableStore<T> {
    stable get(): T;
}

interface WritableStore<T> extends ReadableStore<T> {
    mutator set(value: T): void;
    mutator reset(): void;
}
```

### Super Call Invalidation (NEW — SEM-4)

In class hierarchies, `super.mutator()` correctly invalidates `this.stable()` narrowing. Since `super` and `this` refer to the same object instance, a super call to a mutator method must reset narrowing:

```ts
class Derived extends Base {
    test(): void {
        if (this.get() !== undefined) {
            super.reset(); // ✅ super.mutator() invalidates this.stable()
            this.get();    // back to T | undefined
        }
    }
}
```

---

## What This PR Implements

Four declaration-site type modifiers that enable CFA narrowing through function calls:

- **`stable`** — marks a callable getter as returning the same value on consecutive calls (absent mutation)
- **`mutator`** — marks a function as mutating backing state, resetting narrowing
- **`invalidates`** — refines `mutator` to target specific stable endpoints
- **Linked type predicates** — `this.value() is T` syntax for guard methods that narrow stable call results

All four are fully erasable (zero runtime overhead), declaration-site only, and structurally checked. The implementation includes a full test suite (40 test files) with zero regressions against the existing test baseline.

**Implementation milestones:**
- **SYN-4** ✅ — `stable`/`mutator` modifiers on method declarations and method signatures (class methods, interface methods, type literal methods)
- **SEM-4** ✅ — Super call invalidation: `super.mutator()` correctly invalidates `this.stable()` narrowing in class hierarchies
- **CBI-1** ✅ — Cross-binding invalidation via named tuple label references: `invalidates read` on a destructured setter targets the sibling `read` accessor, with full post-call narrowing and selective invalidation

---

## Recommended Phased Introduction

### Phase 1: `stable` alone (conservative reset)

Introduce `stable` with a conservative invalidation policy: any method call on the same receiver resets all stable narrowing on that receiver.

```ts
interface Signal<T> {
    value: stable () => T;
}

declare const sig: Signal<string | undefined>;
if (sig.value() !== undefined) {
    sig.value().toUpperCase(); // OK — narrowed to string
}
```

Conservative reset means that even non-mutating calls like `sig.toString()` would reset narrowing. This is safe by default — it's the same approach TypeScript uses for property narrowing (any call might invalidate).

**Scope:** Parser + checker changes for `stable` modifier, conservative flow analysis.

### Phase 2: `mutator` and `invalidates` for precise invalidation

Replace conservative reset with explicit mutation marking. Only calls to `mutator`-annotated methods reset narrowing.

```ts
interface Signal<T> {
    value: stable () => T;
    set: mutator (v: T) => void invalidates value;
}

declare const sig: Signal<string | undefined>;
if (sig.value() !== undefined) {
    sig.toString();              // does NOT reset — not a mutator
    sig.value().toUpperCase();   // still narrowed
    sig.set(undefined);          // resets — mutator targeting value
    sig.value();                 // back to string | undefined
}
```

**Scope:** Parser + checker for `mutator`/`invalidates`, targeted invalidation lists, multi-endpoint stores.

> **Alternative syntax under consideration:** A single `mutates` clause could replace both `mutator` and `invalidates` — e.g., `set(v: T): void mutates value`. See the full proposal (§13) for details.

### Phase 3: Linked type predicates (independent extension)

Guard methods that narrow the return type of a stable method on the same receiver.

```ts
interface Resource<T> {
    value: stable () => T;
    hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r: Resource<string | undefined>;
if (r.hasValue()) {
    r.value(); // narrowed to string
}
```

**Scope:** Parser for `this.method() is T` return type syntax, checker predicate linking, guard invalidation rules.

---

## ⚠️ Key Soundness Disclosures

These are the design's known weaknesses. They should be evaluated openly.

### 1. Inverted Default — Optimistic vs. Pessimistic

Property narrowing is **pessimistic**: any function call resets narrowing on properties. The `stable` system (with `mutator`) is **optimistic**: narrowing persists unless a method is explicitly marked `mutator`. This inverted default means forgetting `mutator` silently preserves narrowing that should be reset — a type hole. The property narrowing default is safer because it errs on the side of over-resetting.

In practice, "I forgot to add `mutator` to a state-changing method" is a more likely developer error than "a Proxy changed the value behind my back." The optimistic default makes the common mistake silent.

### 2. Two-Sided Trust Model

Both `stable` AND `mutator` must be correctly annotated for soundness. The compiler trusts the developer's annotations mechanically. If a method mutates backing state but isn't marked `mutator`, narrowing survives incorrectly. This is analogous to TypeScript's general trust model for type annotations (`x: string` when `x` is actually a `number`), but the blast radius of a missing `mutator` is larger because it affects all stable narrowing on that receiver.

### 3. SolidJS Cannot Safely Adopt

SolidJS separates accessor and setter into different bindings:

```ts
const [count, setCount] = createSignal<number | undefined>(0);
```

**Cross-binding invalidation is now implemented.** Using named tuple label references in the `invalidates` clause, SolidJS-style APIs can express the read/write relationship:

```ts
function createSignal<T>(value: T): [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read
];

const [count, setCount] = createSignal<number | undefined>(0);
if (count() !== undefined) {
    setCount(undefined); // invalidates read → resets count() narrowing
    count();             // post-call narrowed to undefined
}
```

This uses destructuring provenance tracking — the checker maps `count` to tuple label `read` and `setCount` to label `write`, so `invalidates read` on `write` correctly targets `count`. See the Companion Documents section for the full research on 6 approaches evaluated.

### 4. Structural Assignability Gap

`mutator` markers can be lost through structural widening. A structurally compatible assignment strips the mutation contract:

```ts
interface Signal<T> {
    value: stable () => T;
    set: mutator (v: T) => void;
}

declare const sig: Signal<string | undefined>;
const setter: (v: string | undefined) => void = sig.set.bind(sig);
// setter() is no longer a mutator — structural type lost the modifier
// Calling setter(undefined) does NOT reset narrowing on sig.value()
```

This is the same category of issue as `readonly` being lost through structural compatibility, but with soundness implications for CFA.

### 5. Generic Interaction Unresolved

How `stable` propagates through generics, conditional types, and mapped types is an open question. For example:

- Does `Partial<Signal<T>>` preserve `stable` on `value`?
- Does `Pick<Signal<T>, 'value'>` preserve `stable`?
- Does `ReturnType<Signal<T>['value']>` understand stable call semantics?

The current implementation handles direct usage correctly but does not define behavior for all type-level operations on stable types.

---

## Framework Coverage

| Framework | Pattern | `stable` Works? | Notes |
|-----------|---------|-----------------|-------|
| **Angular Signals** | `signal<T>()` returns object with `.set()` | ✅ Yes | Receiver-scoped, natural fit |
| **Preact Signals** | `.value` property + `.peek()` | ✅ Yes | Works for `.peek()` callable getter |
| **MobX** | Computed/observable with getter methods | ✅ Yes | Receiver-scoped |
| **SolidJS** | `const [get, set] = createSignal()` | ✅ **Yes** | Cross-binding invalidation via named tuple labels |
| **Vue `ref()`** | `.value` property access | N/A | Property, not callable — existing narrowing works |

---

## Angular Template Caveat

Angular template narrowing depends on the Angular compiler's Template Type Check Block (TCB) generation. The TCB translates template expressions into TypeScript-checkable code. For stable narrowing to work in Angular templates (e.g., `@if (sig()) { {{ sig() }} }`), the TCB must generate code that the checker can narrow through stable calls. This may require coordination with the Angular compiler team and is not guaranteed to work out-of-the-box.

---

## Future Extensions (Not In This PR)

The following are explicitly **not** part of this proposal but are documented as future work:

- **Keyed linked predicates** (Phase 9): `has(key: K): this.get(key) is V` — Map/Set `has()`/`get()` narrowing with per-key invalidation tracking
- **Discriminated method unions** (Phase 10): `isResolved(): this.value() is T & this.error() is undefined` — multi-predicate guards for async result patterns
- **Exclusive invalidation (`preserves`):** Inverse of `invalidates` for APIs where listing exceptions is more concise
- **`mutates` alternative syntax:** Collapsing `mutator` + `invalidates` into a single clause (see full proposal §13)
- **Conditional type discrimination (`IsStable<T>`):** Type-level stable detection

---

## Companion Documents

All companion documents are located in the `docs/` directory of this repository.

### `docs/stable-pr-proposal.md` — Full External Proposal
The primary proposal document (~2000 lines). Covers motivation from 5 real-world TypeScript issues (1,350+ combined upvotes), the three-modifier design (`stable`, `mutator`, `invalidates`), linked type predicates, phased introduction plan (10 phases), soundness analysis, framework compatibility matrix, and 17 open design questions for the TypeScript team. This is the document intended for upstream submission.

### `docs/stable-design-holes-analysis.md` — Design Holes & Trust Model
Analyzes the "default transparent" rule — why unmarked methods do NOT invalidate stable narrowing, the soundness implications of this optimistic default, and what `mutator`/`invalidates` actually provide beyond `stable` alone. Covers the lying-setter problem, structural assignability gaps, and the two-sided trust model.

### `docs/stable-internal-design-document.md` — Internal Technical SDD
The authoritative internal design document covering all 5+ implementation phases, parity tracking against TypeScript's property narrowing, conservative uncertainty-boundary invalidation, and tiered heuristic inference. This guided the actual Go implementation in `internal/checker/flow.go` and `internal/checker/checker.go`.

### `docs/stable-modifier-spec.md` — Formal SDD Specification
Formal specification in SDD format with normative statements, phase boundary decisions, and checker behavior requirements. Defines exactly when narrowing is preserved, when it resets, how linked predicates interact with stable endpoints, and the constraint-overload post-call narrowing rules.

### `docs/ts-rejection-risk-assessment.md` — Rejection Risk Assessment
Risk analysis of each proposal component against TypeScript Design Goals, TS team member quotes, and precedent from accepted features. Assesses `stable` core narrowing as low-risk (RyanCavanaugh actively engaged with upstream identity modifier proposal), with advanced features (linked predicates, constrained-overload) carrying higher risk.

### `docs/research-solidjs-cross-binding.md` — SolidJS Cross-Binding Invalidation Research
Deep analysis of why SolidJS's `const [count, setCount] = createSignal()` pattern cannot safely adopt `stable` — the read and write functions are separate bindings with no shared receiver. Evaluates 6 approaches: tuple index (`mutates [0]`), named channels, source interface extraction, **named tuple label reference (`mutates read`)** (recommended), heuristic inference, and object pattern. Estimates ~300-500 LOC for the recommended approach.

### `docs/stable-design-decisions.md` — Design Decisions Register
Consolidated register of 30 open design decisions across 5 categories (Syntax, Semantics, Cross-Binding, Linked Predicates, Adoption). Each decision tracked with status (OPEN/RECOMMENDED/DEFERRED/DECIDED), phase impact, alternatives, and recommendation. Two decisions (SYN-4: method declarations, SEM-4: super call invalidation) are now DECIDED and implemented.

### Other Research Documents (in `docs/`)
- `stable-phase8-proposal.md` — Phase 8+ proposal covering keyed linked predicates, discriminated method unions, exclusive invalidation (`preserves`), and conditional type discrimination
- `stable-modifier-research.md` — Initial research: cross-language survey (Rust, Kotlin, Swift, C++), prior art analysis, and modifier naming alternatives
- `stable-inheritance-research.md` — Class hierarchy behavior: virtual dispatch, override narrowing, covariant/contravariant method overrides
- `research-map-has-get-narrowing.md` — Map `has()`/`get()` narrowing analysis for Phase 9 keyed predicates
- `stable-heuristic-uncertainty-boundaries-research.md` — Uncertainty boundary classification: which constructs reset stable narrowing and why

---

## Key Test Files

40 test files in `testdata/tests/cases/compiler/`:

**Core narrowing:**
- `stableModifierNarrowing.ts` — basic stable narrowing and reset
- `stableModifierBoundaries.ts` — uncertainty boundaries and reset points
- `stableModifierSignalPatterns.ts` — real-world signal API patterns
- `stableModifierParity.ts` / `stableModifierSubmoduleParity.ts` — getter/setter parity

**Equality and control flow:**
- `stableModifierEqualityChain.ts` — discriminant-style narrowing
- `stableModifierExhaustiveSwitch.ts` — exhaustive switch on stable calls
- `stableModifierAdvancedLoops.ts` — loop narrowing behavior

**Mutator and invalidation:**
- `stableModifierMutatorBasic.ts` — basic mutator reset
- `stableModifierMutatorLinks.ts` — `invalidates` clause with targeted reset
- `stableModifierMutatorErrors.ts` — validation diagnostics
- `stableModifierPostCallNarrowing.ts` — post-call narrowing after constrained writes
- `stableModifierCrossBinding.ts` — cross-binding invalidation via named tuple labels (SolidJS pattern)

**Linked predicates:**
- `stableModifierLinkedPredicates.ts` — `this.value() is T` linked type predicates
- `stableModifierAssertionGuards.ts` — assertion-style guards

**Method declarations and super calls:**
- `stableModifierMethodDeclarations.ts` — stable/mutator on method declarations and method signatures
- `stableModifierSuperCalls.ts` — super call invalidation in class hierarchies

**Edge cases:**
- `stableModifierClosures.ts` — closure capture behavior
- `stableModifierOptionalChaining.ts` / `stableModifierAdvancedOptionalChain.ts`
- `stableModifierCrossModule.ts` — cross-module stable references
- `stableModifierErrors.ts` / `stableModifierDiagnostics.ts` — error reporting
- `stableModifierEmit.ts` — erasure correctness

---

## Pipeline Status

All pass:
- ✅ `npx hereby build`
- ✅ `npx hereby test`
- ✅ `npx hereby lint`
- ✅ `npx hereby format`
