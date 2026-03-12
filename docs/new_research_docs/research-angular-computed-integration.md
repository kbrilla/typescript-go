# Research: Angular `computed()` Integration with `stable`/`mutator`/`invalidates` CFA

> **Status**: Research (informational)
> **Context**: `stable`/`mutator`/`invalidates` CFA system in TypeScript-Go
> **Related**:
> - [stable-modifier-spec.md](../stable-modifier-spec.md) — Phase 1 SDD
> - [transitive-mutator-propagation-research.md](../transitive-mutator-propagation-research.md) — Transitive propagation
> - [research-solidjs-cross-binding.md](../research-solidjs-cross-binding.md) — Cross-binding invalidation
> - [stable-internal-design-document.md](../stable-internal-design-document.md) — Design doc
> - [stable-design-decisions.md](../stable-design-decisions.md) — Open decisions

---

## 1. Executive Summary

This document researches whether Angular's `computed()` signals can integrate with the `stable`/`mutator`/`invalidates` TypeScript CFA system. The core question: when a writable signal is mutated, should computed signals that depend on it also be invalidated in the type system's narrowing?

**Key findings:**

1. **Angular's type system already naturally supports basic `stable` CFA** for computed signals — `Signal<T>` is callable and read-only, making it a natural `stable` candidate.
2. **Transitive invalidation (computed depends on writable) is fundamentally unsolvable** at the type level without callback-body introspection, which violates the system's core design principle.
3. **Explicit dependency declaration is feasible but imposes unacceptable DX burden** — none of the proposed syntaxes are ergonomic enough for Angular's API.
4. **The practical impact is low** — Angular's synchronous reactive model means computed signals are always consistent with their sources within a single synchronous block. The dangerous scenario (narrowing a computed, then mutating its source, then re-reading the computed with stale narrowing) is rare in practice.
5. **The recommended path is conservative invalidation** — which the system already does correctly. Any `set()`/`update()` call is an uncertainty boundary that conservatively invalidates *all* stable narrowings in scope, including computeds.

---

## 2. Angular's Signal Type Architecture

### 2.1 Type Signatures

From Angular's source (`packages/core/src/render3/reactivity/`):

```ts
// Read-only Signal — returned by computed()
type Signal<T> = (() => T) & {
  [SIGNAL]: unknown;
};

// Writable Signal — returned by signal()
interface WritableSignal<T> extends Signal<T> {
  set(value: T): void;
  update(updateFn: (value: T) => T): void;
  asReadonly(): Signal<T>;
}

// computed() signature
function computed<T>(
  computation: () => T,
  options?: CreateComputedOptions<T>
): Signal<T>;

// signal() signature
function signal<T>(
  initialValue: T,
  options?: CreateSignalOptions<T>
): WritableSignal<T>;
```

### 2.2 Key Architectural Facts

| Property | `Signal<T>` (readonly) | `WritableSignal<T>` |
|----------|----------------------|---------------------|
| Callable | Yes — `signal()` reads | Yes — `signal()` reads |
| `set()` | No | Yes |
| `update()` | No | Yes |
| `asReadonly()` | No | Yes |
| `stable` candidate | Yes — read-only, parameterless | Yes — for the read path |
| `mutator` candidate | No — never mutated | Yes — `set()` and `update()` |
| `computed()` return | `Signal<T>` | Never |
| `signal()` return | Never | `WritableSignal<T>` |

### 2.3 How `computed()` Tracks Dependencies at Runtime

Angular's `computed()` uses a **push-pull reactive graph** powered by the `ReactiveNode` infrastructure (`packages/core/primitives/signals/src/graph.ts`):

1. **During derivation execution**, calling any signal's getter (`count()`) registers the computed as a *consumer* of that signal's *producer* node via `producerAccessed()`.
2. **Dependencies are dynamic** — they change with each re-execution. A conditional `if (show()) { return count(); }` only tracks `count` when `show()` is true.
3. **Dirty propagation** — when a producer (writable signal) changes via `set()`/`update()`, it marks all consumer nodes dirty via `consumerMarkDirty()`.
4. **Lazy evaluation** — the computed only re-computes when read (`producerUpdateValueVersion()`), not when dependencies change.
5. **Memoization** — if the recomputed value equals the previous (via `equal`), downstream consumers are not notified.

This is entirely a runtime mechanism. **No static analysis is involved.** The TypeScript compiler has zero visibility into the dependency graph.

### 2.4 `linkedSignal()` — A Hybrid

Angular also has `linkedSignal()`, which is writable but auto-resets when source signals change:

```ts
const count = signal(0);
const doubled = linkedSignal({
  source: () => count(),
  computation: (c) => c * 2,
});
// doubled() returns count() * 2, but can be manually overridden via doubled.set()
// When count() changes, doubled resets to count() * 2
```

`linkedSignal` returns `WritableSignal<T>`, not `Signal<T>`. Its source dependency IS explicit in the API (`source: () => count()`), but the dependency is runtime-tracked, not type-tracked.

---

## 3. Mapping Angular Signals to `stable`/`mutator`/`invalidates`

### 3.1 Natural Fit: Individual Signals

A single writable signal maps perfectly to the existing system:

```ts
// Angular's existing types:
interface WritableSignal<T> extends Signal<T> {
  set(value: T): void;
  update(updateFn: (value: T) => T): void;
}

// With stable/mutator annotations:
interface WritableSignal<T> extends Signal<T> {
  stable (): T;
  mutator set(value: T): void invalidates this;
  mutator update(updateFn: (value: T) => T): void invalidates this;
}

// Usage:
const count = signal<number | undefined>(0);
if (count() !== undefined) {
  count().toFixed(2);     // narrowed to number — stable call
  count.set(undefined);   // mutator — invalidates count()
  count();                // number | undefined — correctly reset
}
```

This is **already fully supported** by the current implementation (Tier 1 write invalidation, same-receiver heuristic).

### 3.2 The Hard Problem: Computed Dependencies

```ts
const count = signal<number | undefined>(0);
const doubled = computed(() => {
  const c = count();
  return c !== undefined ? c * 2 : undefined;
});

if (doubled() !== undefined) {
  doubled().toFixed(2);   // narrowed to number — stable call on computed
  count.set(undefined);   // mutator on count — but does it invalidate doubled()?
  doubled();              // SHOULD be number | undefined, but count.set() doesn't
                          // know about doubled
}
```

The problem: `count.set()` has `invalidates this` (invalidates `count()`), but there is no declared relationship between `count` and `doubled` at the type level. The narrowing on `doubled()` survives the `count.set()` call.

### 3.3 Current Behavior: Already Safe

Under the current system, `count.set(undefined)` is classified by the uncertainty boundary heuristics. Since `count.set()` is on a different symbol than `doubled`, the key question is whether it's classified as an "unknown call" or a "known mutator on unrelated receiver."

**In practice, this is already handled:** `count.set()` is a method call on a different binding. The system classifies it based on heuristic tiers:

- If `count` is a `WritableSignal<T>` with `mutator set()`, the call is resolved as a Tier 1 mutator on the `count` receiver. It invalidates `count()`'s narrowing.
- For `doubled()`, the `count.set()` call is an **unrelated call boundary** — it's a call on a different receiver/binding.

Under conservative mode (no `invalidates doubled` declared), the system checks whether the call *could* affect `doubled`. Without explicit contracts linking `count` to `doubled`, the system treats `count.set()` as a potential uncertainty boundary for `doubled`.

**However:** The current heuristic for "unrelated calls" may or may not invalidate `doubled()` depending on the exact boundary classification. If `count.set()` is a known Tier 1 mutator on `count` with explicit `invalidates` targeting only `count`'s read, then `doubled()`'s narrowing would **survive** — which is unsound.

This is the precise danger the research identifies.

---

## 4. Callback Body Introspection: Feasibility Analysis

### 4.1 The Question

Could the type checker analyze `() => count() * 2` (the computation passed to `computed()`) and discover that it calls `count()` (a stable signal)?

### 4.2 Level 1: Direct Call Inspection

For trivial cases:

```ts
const doubled = computed(() => count() * 2);
```

The checker could:
1. Parse the callback body
2. Find call expressions: `count()`
3. Resolve `count` to a binding with `stable` metadata
4. Record: `doubled` depends on `count`

**Complexity**: Low for this case. It's a single function body scan.

### 4.3 Level 2: Intermediate Variables and Functions

```ts
const doubled = computed(() => {
  const c = count();
  const helper = (x: number | undefined) => x !== undefined ? x * 2 : undefined;
  return helper(c);
});
```

Now the checker needs to:
1. Track data flow within the callback
2. Follow assignment through `c = count()`
3. Trace `c` into `helper(c)`

This requires **intraprocedural data flow analysis** of the callback body — more complex but still bounded.

### 4.4 Level 3: Nested Computeds

```ts
const a = computed(() => count() + 1);
const b = computed(() => a() * 2);
const c = computed(() => b() + a());
```

Now `c` depends on `b` which depends on `a` which depends on `count`. To discover that `count.set()` invalidates `c`, the checker must transitively follow:

`count` → `a` → `b` → `c`

This requires building a **dependency DAG** across multiple `computed()` calls — essentially a global dataflow analysis.

### 4.5 Level 4: Conditional and Dynamic Dependencies

```ts
const show = signal(true);
const value = signal<number | undefined>(42);

const display = computed(() => {
  if (show()) {
    return value();
  }
  return "hidden";
});
```

Dependencies are **condition-dependent**. `display` depends on `value` only when `show()` is truthy. The type checker would need path-sensitive analysis to determine this — and Angular explicitly documents that "computed signal dependencies are dynamic."

### 4.6 Level 5: Higher-Order Computed Factories

```ts
function createDerived<T, U>(source: Signal<T>, fn: (v: T) => U): Signal<U> {
  return computed(() => fn(source()));
}
```

The dependency is through a generic parameter. The checker cannot know which signal `source` refers to until the call site is resolved — requiring call-site-specific specialization.

### 4.7 Verdict: Callback Inspection is Infeasible

| Depth | Feasible? | Complexity | Violates Principles? |
|-------|-----------|------------|---------------------|
| Level 1 (direct) | Technically yes | Low | **Yes** — "no callback-body introspection" |
| Level 2 (variables) | Technically yes | Medium | **Yes** |
| Level 3 (transitive) | Barely | High — requires DAG | **Yes** — "no dependency-graph theorem proving" |
| Level 4 (conditional) | No | Requires path-sensitive IPA | **Yes** |
| Level 5 (higher-order) | No | Undecidable | **Yes** |

The spec explicitly states:
- **Non-goal**: "No callback-body introspection requirement" (§4)
- **Non-goal**: "No dependency-graph theorem proving for computed/reactive relationships" (§5)
- **Non-goal**: "No full interprocedural effect system prerequisite" (§5)

Even Level 1 inspection violates these principles. The principles exist for good reason — the complexity escalation from Level 1 to Level 5 is exponential, and any "just do the simple case" approach would create a cliff where trivially different code suddenly loses type safety.

### 4.8 Does Angular's Own Compiler (ngtsc) Do Dependency Analysis?

Angular's compiler (`ngtsc`) performs **template type-checking** but does NOT perform signal dependency analysis. Specifically:

1. **Template type-checking (TCB)** — ngtsc generates TypeScript code from Angular templates for type checking. It checks binding types, event handler types, and directive inputs. But it doesn't analyze signal dependency graphs.

2. **No signal flow analysis** — ngtsc doesn't understand that `@if (doubled() !== undefined)` means `doubled()` was narrowed. Template type-checking operates at the individual binding level, not across template bindings.

3. **Runtime-only dependency tracking** — Angular's dependency tracking (`ReactiveNode`, `producerAccessed`, `consumerMarkDirty`) is entirely runtime. The compiler generates code that runs the reactive graph, but doesn't statically analyze it.

4. **Debug signal graph** — Angular has `DebugSignalGraph` (`render3/util/signal_debug.ts`) which can inspect the runtime dependency graph. This is a **debugging tool**, not a static analysis tool. It has `DebugSignalGraphEdge` with `consumer` and `producer` indices that represent runtime edges.

So no — ngtsc does not do anything analogous to the callback-body introspection that would be needed for computed dependency tracking in CFA.

---

## 5. Alternative: Explicit Dependency Declaration

### 5.1 Option A: Dependency Array Parameter

```ts
// New overload of computed:
function computed<T, Deps extends Signal<any>[]>(
  deps: [...Deps],
  computation: () => T,
  options?: CreateComputedOptions<T>
): Signal<T> & { [DEPENDS_ON]: Deps };

// Usage:
const doubled = computed([count], () => count() * 2);
// typeof doubled has metadata linking it to count
```

**Analysis:**

| Criterion | Assessment |
|-----------|-----------|
| Soundness | Partial. Deps could be wrong (extra or missing deps). Not verified against callback body |
| DX impact | Bad. Users must manually list dependencies — React `useEffect` dep-list fatigue all over again |
| Runtime cost | Deps array is unused at runtime (pure metadata) — wasteful allocation |
| Framework buy-in | Very unlikely. Angular specifically moved AWAY from explicit dependency lists toward automatic tracking |
| Breaking change | Yes — changes `computed()` signature |

**Verdict**: Rejected. Angular intentionally chose automatic dependency tracking to avoid the `useEffect` dependency-list antipattern. Adding an explicit dep list for type-system purposes would undermine a core design philosophy.

### 5.2 Option B: Generic Type Parameter

```ts
// Type-level dependency link
function computed<T, Source extends Signal<any> = never>(
  computation: () => T,
  options?: CreateComputedOptions<T> & { source?: Source }
): DependentSignal<T, Source>;

type DependentSignal<T, Source> = Signal<T> & {
  readonly [DEPENDS_ON]: Source;
};

// Usage:
const doubled = computed<number | undefined, typeof count>(
  () => count() !== undefined ? count()! * 2 : undefined
);
```

**Analysis:**

| Criterion | Assessment |
|-----------|-----------|
| Soundness | Unsound. Generic parameter not verified against callback body |
| DX impact | Terrible. Users must specify full generic type parameters |
| Breaking change | No — optional generic with default `never` |
| Complexity | High — `DependentSignal` is a new branded type that CFA must understand |

**Verdict**: Rejected. DX is unacceptable. Nobody will write `computed<number | undefined, typeof count>()`.

### 5.3 Option C: `invalidates` on `set()` Targeting External Bindings

Instead of annotating `computed()`, annotate the mutator to declare what it invalidates:

```ts
// Hypothetical:
interface WritableSignal<T> extends Signal<T> {
  stable (): T;
  mutator set(value: T): void invalidates this, ...derived;
  mutator update(updateFn: (value: T) => T): void invalidates this, ...derived;
}
```

But `...derived` is unknowable at the declaration site of `WritableSignal`. The set of derived computeds is determined at use sites, not at declaration sites. This is fundamentally the wrong direction — the declaration of `set()` cannot enumerate all possible computeds that may depend on this signal.

**Verdict**: Rejected. Invalidation targets must be known at declaration time; derived computeds are created at arbitrary use sites.

### 5.4 Option D: Registration-Based `invalidates`

```ts
const count = signal<number | undefined>(0);
const doubled = computed(() => count() !== undefined ? count()! * 2 : undefined);

// Hypothetical registration:
declare function registerDependency<S, T>(
  source: WritableSignal<S>,
  dependent: Signal<T>
): void;

registerDependency(count, doubled);
// Now count.set() knows to invalidate doubled() narrowing
```

**Analysis:**

This is essentially "imperative CFA annotation" — a new concept with no precedent in TypeScript.

| Criterion | Assessment |
|-----------|-----------|
| Soundness | Could be sound if registration is mandatory |
| DX impact | Extremely bad. Manual registration for every dependency is a maintenance nightmare |
| Verification | Cannot verify at compile time that all dependencies are registered |
| Precedent | None in TypeScript |

**Verdict**: Rejected. Imperative CFA annotation is a non-starter.

### 5.5 Option E: "Blanket Invalidation" via `mutator` Without `invalidates`

The simplest approach: when `count.set()` is called and it's a `mutator` on a `WritableSignal`, invalidate ALL stable narrowings in scope — not just `count()`'s narrowing. This is the **conservative** approach.

```ts
const count = signal<number | undefined>(0);
const doubled = computed(() => count() !== undefined ? count()! * 2 : undefined);

if (doubled() !== undefined) {
  doubled().toFixed(2);   // narrowed
  count.set(42);          // mutator call → invalidate ALL stable narrowings
  doubled();              // number | undefined — safe!
  count();                // number | undefined — safe!
}
```

**Analysis:**

| Criterion | Assessment |
|-----------|-----------|
| Soundness | Sound. Over-invalidation is always safe |
| DX impact | Minor precision loss. Some narrowings reset unnecessarily |
| Complexity | None — this is already the default conservative behavior |
| Framework buy-in | Not needed — no API changes |

**Verdict**: **Recommended.** This is the pragmatic choice. The system already does this as the default conservative behavior when `invalidates` clauses are not specific enough.

---

## 6. Framework Comparison

### 6.1 SolidJS: `createSignal()` + `createMemo()`

```ts
// SolidJS types
type Accessor<T> = () => T;
type Setter<T> = {
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};
type Signal<T> = [get: Accessor<T>, set: Setter<T>];

function createSignal<T>(value: T, options?: SignalOptions<T>): Signal<T>;
function createMemo<T>(fn: (v: T) => T, value?: T, options?: { equals?: false | ((prev: T, next: T) => boolean) }): () => T;
```

**Dependency tracking**: Runtime. `createMemo` tracks which signals are read during its computation function execution — same as Angular. Dynamic, lazy, push-pull.

**Type-level dependency tracking**: None. `createMemo` returns `() => T` — a plain accessor. No type-level metadata links it to its sources.

**CBI-1 status**: SolidJS's `[Accessor<T>, Setter<T>]` tuple is already handled by the cross-binding invalidation (CBI-1) system via named tuple labels with `invalidates`. But that's for the read/write pair of a *single* signal, not for computed→source dependencies.

**Computed+source invalidation**: Same problem as Angular. `setCount(undefined)` mutates `count`, but `createMemo` tracking is runtime-only. No way for the type checker to know `filteredNames()` depends on `query()`.

### 6.2 Vue: `computed()` + `ref()`

```ts
// Vue types (simplified)
interface Ref<T> {
  value: T;
  [RefSymbol]: true;
}

interface ComputedRef<T> extends WritableComputedRef<T> {
  readonly value: T;
}

function ref<T>(value: T): Ref<T>;
function computed<T>(getter: () => T): ComputedRef<T>;
```

**Dependency tracking**: Runtime. Vue's reactivity system uses `Proxy`-based dependency tracking (`track`/`trigger` on property access). When computed's getter reads `count.value`, Vue records the dependency.

**Key difference from Angular**: Vue uses property access (`count.value`) instead of function calls (`count()`). This means Vue's computed dependencies are property-read-based, not call-based. TypeScript's existing getter/setter CFA can handle single `ref` narrowing BUT NOT computed→ref dependencies.

**Computed+source invalidation**: Same problem. `count.value = undefined` invalidates `count.value` narrowing, but `doubled.value` (which depends on `count.value`) has no type-level link.

**Type-level dependency tracking**: None proposed.

### 6.3 Preact Signals: `computed()` + `signal()`

```ts
// Preact Signals types
interface Signal<T> {
  value: T;
  peek(): T;
  subscribe(fn: (value: T) => void): () => void;
}

interface ReadonlySignal<T> extends Signal<T> {
  readonly value: T;
}

function signal<T>(value: T): Signal<T>;
function computed<T>(fn: () => T): ReadonlySignal<T>;
```

**Dependency tracking**: Runtime. Preact Signals uses a similar reactive graph with producer/consumer nodes.

**Key architectural note**: Preact Signals uses `.value` property access, similar to Vue. `computed(() => count.value * 2)` tracks `count` as a dependency at runtime.

**Type-level dependency tracking**: None. Same situation as Angular/Vue/Solid.

### 6.4 MobX: `computed` Decorator

```ts
// MobX patterns
class Store {
  @observable count = 0;
  
  @computed get doubled() {
    return this.count * 2;
  }
}
```

**Dependency tracking**: Runtime proxy-based tracking via `@observable` decorator.

**Key difference**: MobX uses class properties and decorators, not standalone functions. The `this` receiver naturally groups related observables and computeds on the same object.

**Advantage for CFA**: Because `count` and `doubled` are on the same `this` receiver, a `mutator` annotation on a setter method could potentially invalidate all properties on `this`. MobX's class-based API is actually *more* amenable to the `stable`/`mutator` system than standalone signal functions.

### 6.5 Summary: No Framework Has Type-Level Dependency Tracking

| Framework | Signal Read | Computed API | Dep Tracking | Type-Level Deps? | Proposed? |
|-----------|-----------|-------------|-------------|-----------------|-----------|
| Angular | `count()` | `computed(() => ...)` → `Signal<T>` | Runtime pull-push | No | No |
| SolidJS | `count()` | `createMemo(() => ...)` → `() => T` | Runtime pull-push | No | No |
| Vue | `count.value` | `computed(() => ...)` → `ComputedRef<T>` | Runtime proxy | No | No |
| Preact | `count.value` | `computed(() => ...)` → `ReadonlySignal<T>` | Runtime pull-push | No | No |
| MobX | `this.count` | `@computed get` | Runtime proxy | No | No |
| TC39 Signals | `sig.get()` | `Signal.Computed(() => ...)` | Runtime | No | No |

No reactive framework — in production or proposed — has type-level dependency tracking between computed and source signals. This is a universal blind spot across the entire ecosystem.

---

## 7. Transitive Invalidation: Soundness and Feasibility

### 7.1 Is Transitive Invalidation Sound?

**Yes, trivially.** If `count` changes, any `computed` that depends on `count` WILL change (or at least will re-evaluate). Therefore, invalidating a computed when its source is mutated is **always sound** — it can never produce a false negative.

The question is not soundness but **feasibility** — can the type checker know which computeds depend on which sources?

### 7.2 Without a Global Dependency Graph: Infeasible

The spec explicitly states: "No dependency-graph theorem proving for computed/reactive relationships" (§5 Non-goals).

Reasons:
1. **Dependencies are determined at runtime** — conditional branches change which signals are read.
2. **Dependencies span multiple files** — a service creates signals, a component creates computeds. Cross-file analysis is out of scope.
3. **Dependencies can be dynamically constructed** — higher-order patterns make static resolution undecidable.
4. **Performance** — building and maintaining a global dependency graph would be prohibitively expensive for the checker.

### 7.3 Limited Version: Same-Scope Declarations

Could we handle the simplest case — declarations in the same function body?

```ts
function component() {
  const count = signal<number | undefined>(0);
  const doubled = computed(() => count() * 2);
  
  // count and doubled are in the same scope
  // Could CFA infer that doubled depends on count?
}
```

This would require:
1. Identifying that `computed(() => count() * 2)` calls `count` in its callback body (callback-body introspection — **violates design principle**)
2. Building a local dependency map within the function scope
3. Adding `count` mutation → `doubled` invalidation edges to the CFA

Even this "limited" version requires callback-body introspection, which is explicitly a non-goal. The escalation problem is immediate: what about `computed(() => helper(count))`? What about `computed(() => otherComputed())`?

### 7.4 Circular Dependencies

```ts
const a = signal(1);
const b: WritableSignal<number> = linkedSignal(() => a() + 1);
const c = computed(() => b() + a());

// Mutation: a.set(2)
// Dependencies: a → b, a → c, b → c
// Invalidation order: a first, then b and c
```

Angular handles circular computed dependencies by throwing at runtime (glitch-free via topological ordering in the reactive graph). The type checker would need to handle cycles in the dependency DAG — another complexity dimension.

**With `linkedSignal()` specifically**: `linkedSignal` is a `WritableSignal`, meaning it can be both a dependency target AND a mutator. This creates bidirectional edges that make static analysis even harder.

### 7.5 Verdict

Transitive invalidation is **sound but infeasible** without callback-body introspection, which is a non-goal. The recommended approach is conservative (blanket) invalidation, which is already the default behavior.

---

## 8. Design Proposals

### 8.1 Proposal 1: Conservative Blanket Invalidation (Recommended)

**Syntax**: No new syntax. Use existing `mutator`/`invalidates` on `WritableSignal`.

**How it works**: When a `mutator` call occurs, ALL stable narrowings in the flow region are invalidated — not just the specific target. This is the existing conservative default.

```ts
interface WritableSignal<T> extends Signal<T> {
  stable (): T;
  mutator set(value: T): void;   // no invalidates clause
  mutator update(updateFn: (value: T) => T): void;
}

const count = signal<number | undefined>(0);
const doubled = computed(() => count() !== undefined ? count()! * 2 : undefined);

if (doubled() !== undefined) {
  doubled().toFixed(2);   // narrowed
  count.set(42);          // mutator → blanket invalidation of ALL stable facts
  doubled();              // number | undefined — correctly reset
  count();                // number | undefined — correctly reset
}
```

| Criterion | Assessment |
|-----------|-----------|
| **Soundness** | Sound — over-invalidation is always safe |
| **Implementation complexity** | Zero — already the default behavior |
| **DX** | Minor precision loss. `count.set(42)` invalidates unrelated `doubled()` even when the type didn't change |
| **Limitations** | No post-call narrowing on unrelated computeds. `count.set(42)` → `count()` is `number`, but `doubled()` is `number | undefined` (cannot infer derived narrowing) |
| **Framework buy-in** | None needed — no API changes |

**Important subtlety**: The current system uses `invalidates` clauses to enable *selective* invalidation (only invalidate named targets). If `WritableSignal.set()` has `invalidates this` (targeting only the writable signal's own getter), then computed signal narrowings would **survive** the mutation — which is unsound. The fix is to either:

(a) NOT use `invalidates this` on `WritableSignal.set()`, letting the system use blanket invalidation, OR
(b) Use `invalidates this` but ensure that "unrelated stable bindings" in the same flow region are also invalidated as an uncertainty boundary.

Option (a) is simpler and recommended.

### 8.2 Proposal 2: `computed()` Returns "Volatile Signal" Type

**Syntax**: New branded type for "inherently unstable" signals.

```ts
// Framework declaration:
type VolatileSignal<T> = Signal<T> & { readonly [VOLATILE]: true };

function computed<T>(computation: () => T): VolatileSignal<T>;

// CFA rule: VolatileSignal<T> can NEVER be narrowed via stable CFA.
// It's always treated as its full declared type.
```

**How it works**: By branding computed signals as "volatile," the type checker refuses to narrow them at all. Only `WritableSignal<T>` (or explicitly `stable`-annotated signals) get narrowing.

```ts
const count = signal<number | undefined>(0);  // WritableSignal — narrowable
const doubled = computed(() => ...);          // VolatileSignal — NOT narrowable

if (count() !== undefined) {
  count().toFixed(2);    // narrowed — WritableSignal is stable
}

if (doubled() !== undefined) {
  doubled().toFixed(2);  // ERROR — VolatileSignal is never narrowed
}
```

| Criterion | Assessment |
|-----------|-----------|
| **Soundness** | Sound — never narrowing is always safe |
| **Implementation complexity** | Low — add a brand check to `isStableCallExpression` |
| **DX** | Terrible. Users lose ALL narrowing on computed signals, even when no mutation is possible |
| **Limitations** | Destroys the value proposition for computed signals |
| **Framework buy-in** | Angular team would resist — computed signals are commonly used with nullable types |

**Verdict**: Rejected. This throws the baby out with the bathwater. Computed signals need narrowing too.

### 8.3 Proposal 3: `dependsOn` Type Brand (Explicit Type-Level Link)

**Syntax**: New type-level metadata for dependency declaration.

```ts
// New type utility:
type DependsOn<T, Sources extends Signal<any>[]> = Signal<T> & {
  readonly [DEPENDS_ON]: Sources;
};

// Framework would use:
function computed<T>(computation: () => T): Signal<T>;
// With explicit deps:
function computed<T, D extends Signal<any>[]>(
  computation: () => T,
  options: { dependsOn: [...D] }
): DependsOn<T, D>;

// Usage:
const count = signal<number | undefined>(0);
const doubled = computed(() => count()! * 2, { dependsOn: [count] });
// typeof doubled = DependsOn<number | undefined, [WritableSignal<number | undefined>]>

// CFA rule: When a mutator on any signal in D fires, invalidate narrowings on signals
// with DependsOn<T, D> where D contains the mutated signal.
```

| Criterion | Assessment |
|-----------|-----------|
| **Soundness** | Unsound unless deps are complete and correct (unverifiable statically) |
| **Implementation complexity** | High — new type brand, CFA must resolve branded `DEPENDS_ON` metadata |
| **DX** | Bad — explicit `dependsOn: [count]` is the exact "explicit dep list" that Angular rejected |
| **Limitations** | Deps can be wrong; no verification. Dynamic deps impossible to express |
| **Framework buy-in** | Very unlikely — Angular explicitly avoids explicit dep lists |

**Verdict**: Rejected. Fails the DX test and soundness can't be verified.

### 8.4 Proposal 4: Same-Receiver Computed Grouping

**Syntax**: Group related signals on a single object so `invalidates` can target them together.

```ts
// Instead of standalone signals:
class CounterStore {
  private readonly _count = signal<number | undefined>(0);
  
  stable count = this._count.asReadonly();
  stable doubled = computed(() => {
    const c = this._count();
    return c !== undefined ? c * 2 : undefined;
  });
  
  mutator setCount(v: number | undefined): void {
    this._count.set(v);
  }
  // setCount invalidates ALL stable members on `this` (blanket invalidation)
}
```

**How it works**: By placing signals on a class/object, the `mutator` method naturally invalidates all `stable` members on the same receiver. This is the MobX-style pattern.

```ts
const store = new CounterStore();

if (store.doubled() !== undefined) {
  store.doubled().toFixed(2);   // narrowed
  store.setCount(undefined);    // mutator on `this` → invalidates all stable on `this`
  store.doubled();              // number | undefined — correctly reset
}
```

| Criterion | Assessment |
|-----------|-----------|
| **Soundness** | Sound — receiver-scoped blanket invalidation covers all stables on `this` |
| **Implementation complexity** | Zero — already supported by the existing system |
| **DX** | Good for service/store patterns. Doesn't work for component-local signals |
| **Limitations** | Requires wrapping signals in a class. Not ergonomic for simple component-local use |
| **Framework buy-in** | Aligns with Angular's `@Injectable` service pattern |

**Verdict**: Viable for store/service patterns. Not a complete solution — component-local standalone signals are the common case.

### 8.5 Proposal 5: `invalidates *` (Wildcard Invalidation)

**Syntax**: New `invalidates *` clause meaning "invalidates ALL stable narrowings in scope."

```ts
interface WritableSignal<T> extends Signal<T> {
  stable (): T;
  mutator set(value: T): void invalidates *;
  mutator update(updateFn: (value: T) => T): void invalidates *;
}
```

**How it works**: `invalidates *` is syntactic sugar for "don't use selective invalidation; always use blanket invalidation." It's documentation-level intent.

| Criterion | Assessment |
|-----------|-----------|
| **Soundness** | Sound — equivalent to no `invalidates` clause (blanket invalidation) |
| **Implementation complexity** | Minimal — parse `*` as "blanket" |
| **DX** | Good — communicates intent. Framework authors explicitly say "this mutator affects everything" |
| **Limitations** | Semantically identical to omitting `invalidates` clause entirely |

**Verdict**: Nice-to-have syntax sugar, but functionally equivalent to Proposal 1.

---

## 9. Practical Impact Assessment

### 9.1 How Common Is the Dangerous Pattern?

The dangerous pattern is:
1. Narrow a computed signal
2. Mutate its source signal
3. Read the computed signal expecting the old narrowing to survive

```ts
if (doubled() !== undefined) {
  // ... use doubled() as number ...
  count.set(undefined);  // source mutation
  doubled();             // ← stale narrowing if not invalidated
}
```

**In Angular applications**, this is rare for several reasons:

1. **Synchronous consistency**: Angular's reactive system is synchronous. Within a single synchronous block, if you mutate `count`, `doubled()` will reflect the change immediately on next read (lazy recomputation). The *runtime value* is always correct. The only issue is the *type system's narrowing*.

2. **Template vs imperative code**: Most Angular signal reads happen in templates (`{{ doubled() }}`), not in imperative TypeScript code. Template type-checking doesn't do CFA narrowing across multiple bindings.

3. **Mutation patterns**: In Angular, mutations typically happen in event handlers or effects, which are separate from the code that reads computed signals. The interleaving pattern (narrow → mutate → re-read) is uncommon.

4. **Nullable signal usage**: Nullable signals (`Signal<T | undefined>`) with narrowing are the primary use case. But computed signals that wrap nullable sources tend to either:
   - Return `undefined` when the source is `undefined` (same nullability, same narrowing need)
   - Transform to a non-nullable value (e.g., `computed(() => count() ?? 0)`) — no narrowing needed

### 9.2 Severity Assessment

| Scenario | Likelihood | Impact | Real Risk? |
|----------|-----------|--------|-----------|
| Narrow computed, mutate source, re-read | Low | Medium — unsound type | Yes, but rare |
| Narrow writable signal, mutate, re-read | Medium | High — unsound type | Yes — already handled |
| Narrow signal in template | High | None — templates don't CFA-narrow | No |
| Narrow signal across async boundary | High | None — async invalidates anyway | No |

### 9.3 Conclusion

The real-world impact is **low to moderate**. The pattern exists in theory but is uncommon in practice. The existing conservative behavior (blanket invalidation on any mutator call) is sufficient for soundness without requiring new mechanisms.

---

## 10. Recommendations

### 10.1 Primary Recommendation: Conservative Blanket Invalidation

**Do not add explicit `invalidates this` to `WritableSignal.set()`/`update()`.** Instead, let the heuristic tier system handle it:

- `count.set()` is a Tier 1 mutator (known writable method on same receiver)
- Without explicit `invalidates` clause, the system falls back to **blanket invalidation** — all stable narrowings in the flow region are reset
- This naturally covers computed signals: `doubled()` narrowing is reset when `count.set()` fires

### 10.2 If Selective Invalidation Is Used

If `WritableSignal` gets an explicit `invalidates` clause:

```ts
interface WritableSignal<T> extends Signal<T> {
  stable (): T;
  mutator set(value: T): void invalidates this;
}
```

Then the system MUST ensure that `invalidates this` also creates an **uncertainty boundary** for other stable narrowings in scope. Otherwise, computed signal narrowings would survive source mutations.

The existing uncertainty-boundary classification should already handle this — a Tier 1 mutator call is a known mutation site, and the system should treat other stable narrowings as potentially affected unless proven unrelated.

### 10.3 Documentation Guidance for Angular

When `stable` ships, Angular's type definitions should follow these guidelines:

1. **`Signal<T>` should be `stable`**: `type Signal<T> = stable (() => T) & { [SIGNAL]: unknown }`
2. **`WritableSignal.set()` should be `mutator` WITHOUT specific `invalidates`**: Let blanket invalidation handle it
3. **Document the limitation**: Computed signal dependencies are runtime-only and cannot be reflected in the type system
4. **Recommend class-based grouping** for cases where computed+source invalidation precision matters

### 10.4 Future Work (Not Recommended for Near-Term)

If the ecosystem demands finer-grained computed invalidation:

1. **TC39 Signals proposal integration** — if TC39 Signals ships with a specific type signature, that could define canonical `stable`/`mutator` annotations
2. **TypeScript plugin API** — a framework-specific plugin could inject CFA hints based on framework-specific analysis (Angular's compiler already has the infrastructure)
3. **Type-level effect system** — a future TypeScript feature (type-level purity/effect annotations) could enable verified dependency tracking. This is a multi-year research project.

None of these are practical for the current `stable`/`mutator` system.

---

## 11. Appendix: Angular API Coverage Matrix

| Angular API | Type | `stable` compatible? | `mutator` compatible? | Computed dependency concern? |
|-------------|------|---------------------|----------------------|---------------------------|
| `signal()` | `WritableSignal<T>` | Yes — `stable ()` | Yes — `set()`, `update()` | No — source signal |
| `computed()` | `Signal<T>` | Yes — `stable ()` | No — read-only | Yes — depends on sources |
| `linkedSignal()` | `WritableSignal<T>` | Yes — `stable ()` | Yes — `set()`, `update()` | Yes — auto-resets from source |
| `input()` | `InputSignal<T>` | Yes — `stable ()` | Partial — set by framework | No — framework-managed |
| `model()` | `ModelSignal<T>` | Yes — `stable ()` | Yes — `set()`, `update()` | No — two-way binding |
| `viewChild()` | `Signal<T>` | Yes — `stable ()` | No — read-only | No — framework-managed |
| `contentChild()` | `Signal<T>` | Yes — `stable ()` | No — read-only | No — framework-managed |
| `.asReadonly()` | `Signal<T>` | Yes — `stable ()` | No — read-only | Shares impl with source |
| `toSignal()` (RxJS) | `Signal<T \| undefined>` | Yes — `stable ()` | No — read-only | Async source — always uncertain |
| `resource()` | `ResourceRef<T>` | Yes — `.value()` | Yes — `.set()` | Async — always uncertain |

---

## 12. Appendix: Cross-Framework Computed Type Comparison

```ts
// Angular
const doubled: Signal<number> = computed(() => count() * 2);
// Type: Signal<number> = (() => number) & { [SIGNAL]: unknown }

// SolidJS
const doubled: () => number = createMemo(() => count() * 2);
// Type: () => number (plain function)

// Vue
const doubled: ComputedRef<number> = computed(() => count.value * 2);
// Type: ComputedRef<number> = { readonly value: number, [RefSymbol]: true }

// Preact Signals
const doubled: ReadonlySignal<number> = computed(() => count.value * 2);
// Type: ReadonlySignal<number> = Signal<number> & { readonly value: number }

// MobX
@computed get doubled(): number { return this.count * 2; }
// Type: number (getter return type)

// TC39 Signals (proposed)
const doubled = new Signal.Computed(() => count.get() * 2);
// Type: Signal.Computed<number>
```

None of these types encode dependency information. All dependency tracking is runtime-only.
