# Design Review: Reactive Framework State Management — Signals, Observables, and TypeScript-Go's `identity`/`mutator`/`links`

## Overview

Modern reactive frameworks share a common pattern: encapsulated state accessed through
callable or property-based read endpoints, mutated through dedicated write endpoints,
and propagated through derived computations. TypeScript-Go's `identity`/`mutator`/`links`
system was directly motivated by this pattern — specifically, Angular Signals — but the
same read/write separation appears across SolidJS, Vue, MobX, Svelte, Preact Signals,
RxJS, and the emerging TC39 Signals proposal. This document examines each framework's
reactivity model, maps it to TypeScript-Go's type-level contracts, and identifies
cross-cutting patterns and alternative syntax possibilities.

---

## 1. Angular Signals — The Primary Motivation

### 1.1 Core API Shape

Angular Signals (introduced in Angular 16) use callable-style read access and method-based
mutation:

```typescript
import { signal, computed, effect } from '@angular/core';

const count = signal(0);          // WritableSignal<number>
const doubled = computed(() => count() * 2);  // Signal<number>

count();        // read: 0
count.set(5);   // write: replaces value
count.update(v => v + 1);  // write: derives from current value

effect(() => {
  console.log(`Count is: ${count()}`);  // re-runs when count changes
});
```

### 1.2 Type Signatures

```typescript
interface Signal<T> {
  (): T;                                    // callable read
}

interface WritableSignal<T> extends Signal<T> {
  set(value: T): void;                     // replace value
  update(updateFn: (value: T) => T): void; // derive new value
}
```

The central challenge for TypeScript's type system: `count()` is a **function call**,
not a property access. Traditional CFA (control flow analysis) narrows properties and
variables but not repeated return values of the same callable. A developer cannot write:

```typescript
const name = signal<string | undefined>(undefined);

if (name() !== undefined) {
  name().toUpperCase();  // ERROR today: name() may return undefined
}
```

With `identity`/`mutator`, this becomes expressible:

```typescript
interface Signal<T> {
  identity (): T;
}

interface WritableSignal<T> extends Signal<T> {
  mutator set(value: T): void links ();
  mutator update(updateFn: (value: T) => T): void links ();
}
```

### 1.3 Mapping to `identity`/`mutator`/`links`

| Angular Concept            | TypeScript-Go Analog          | Semantics                               |
|----------------------------|-------------------------------|-----------------------------------------|
| `signal()` read (call)     | `identity` read endpoint      | Stable callable read, narrowable        |
| `signal.set(v)`            | `mutator` with `links ()`     | Invalidates the read endpoint           |
| `signal.update(fn)`        | `mutator` with `links ()`     | Invalidates the read endpoint           |
| `computed()` read (call)   | `identity` read endpoint      | Derived, read-only, narrowable          |
| `effect()`                 | Uncertainty boundary          | Callback body: opaque to CFA           |

### 1.4 WritableSignal.update and Constrained Overloads

`update`'s signature offers a special opportunity for **post-call narrowing**:

```typescript
interface WritableSignal<T> {
  identity (): T;
  mutator update<U extends T>(fn: (value: T) => U): void links ();
}

const name = signal<string | undefined>(undefined);
name.update(() => "Alice");
// After update: name() is narrowed to string (U = string extends string | undefined)
```

This constrained-overload post-call narrowing is a Phase 2 feature that goes beyond
getter/setter parity — it provides **write-driven narrowing** that property assignments
cannot express.

### 1.5 `effect()` as Uncertainty Boundary

Effect callbacks execute asynchronously in response to signal changes. From CFA's
perspective, any signal read inside an `effect` callback crosses an uncertainty boundary:

```typescript
effect(() => {
  if (name() !== undefined) {
    // Cannot assume name() is still defined here — effect re-runs
    // asynchronously and other code may call name.set(undefined)
    name().toUpperCase();
  }
});
```

Within a single synchronous flow, however, `identity` narrowing applies normally.
The uncertainty boundary is at the effect scheduling boundary, not within the callback body.

---

## 2. SolidJS — Tuple Return [get, set]

### 2.1 Core API Shape

SolidJS separates read and write into distinct functions via tuple destructuring:

```typescript
import { createSignal, createEffect, createMemo } from 'solid-js';

const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);

count();       // read: 0
setCount(5);   // write: replace
setCount(v => v + 1);  // write: derive

createEffect(() => {
  console.log(`Count is: ${count()}`);
});
```

### 2.2 Type Signatures

```typescript
type Accessor<T> = () => T;
type Setter<T> = (value: T | ((prev: T) => T)) => T;

function createSignal<T>(value: T): [Accessor<T>, Setter<T>];
```

### 2.3 Structural Advantage for `identity`/`mutator`

SolidJS's tuple return cleanly separates read and write into independent symbols:

```typescript
// With identity/mutator:
type Accessor<T> = identity () => T;
type Setter<T> = mutator (value: T | ((prev: T) => T)) => T;
```

Because the getter and setter are separate variables, CFA already has natural
invalidation boundaries:

```typescript
const [name, setName] = createSignal<string | undefined>(undefined);

if (name() !== undefined) {
  // name is a separate symbol from setName
  // Calling setName() invalidates name() facts
  name().toUpperCase();  // valid with identity on Accessor
}

setName(undefined);

if (name() !== undefined) {
  name().toUpperCase();  // re-narrowed after invalidation
}
```

### 2.4 Challenge: `links` Across Tuple Members

The key challenge is expressing that `setName` invalidates `name` when they are separate
variables from the same `createSignal` call. Two approaches:

**Approach A: Factory-level contract** — The `createSignal` return type inherently pairs
the accessor and setter:

```typescript
// The [Accessor, Setter] tuple is the linkage mechanism
function createSignal<T>(value: T): [identity () => T, mutator (v: T) => T links [0]];
```

**Approach B: Heuristic inference** — When `setName` is called and CFA knows it was
destructured from the same `createSignal` call as `name`, Tier 1 heuristics can
invalidate. This avoids explicit cross-variable `links`.

### 2.5 Mapping

| SolidJS Concept            | TypeScript-Go Analog          | Notes                                |
|----------------------------|-------------------------------|--------------------------------------|
| `Accessor<T>` (getter fn)  | `identity` endpoint           | Pure read, narrowable                |
| `Setter<T>` (setter fn)    | `mutator`                     | Invalidates paired accessor          |
| `createMemo` result        | `identity` endpoint           | Derived, read-only                   |
| `createEffect` callback    | Uncertainty boundary          | Opaque to CFA                        |
| Tuple destructuring        | Independent symbol tracking   | Linkage via factory return type      |

---

## 3. Vue Composition API — `.value` Property Access

### 3.1 Core API Shape

Vue's Composition API uses property-based reactivity through `ref()` and `computed()`:

```typescript
import { ref, computed, watch } from 'vue';

const count = ref(0);          // Ref<number>
const doubled = computed(() => count.value * 2);  // ComputedRef<number>

count.value;        // read: property access
count.value = 5;    // write: property assignment

watch(count, (newVal) => {
  console.log(`Count changed to: ${newVal}`);
});
```

### 3.2 Type Signatures

```typescript
interface Ref<T> {
  value: T;           // read AND write through the same property
}

interface ComputedRef<T> {
  readonly value: T;  // read-only
}
```

### 3.3 Property Access — Already Handled by Traditional CFA

Vue's `.value` property access is the pattern that TypeScript's existing getter/setter
CFA already handles:

```typescript
const name = ref<string | undefined>(undefined);

if (name.value !== undefined) {
  name.value.toUpperCase();  // already works with getter/setter CFA
}
```

Vue **does not need `identity`/`mutator`** for basic narrowing — property access CFA
already provides it. The modifiers become relevant only for Vue APIs that use callable
access patterns:

```typescript
// Some Vue patterns use function-style reads:
const route = useRoute();      // returns reactive object
const id = computed(() => route.params.id);

// Accessing id.value is property CFA, but id() is not standard Vue
```

### 3.4 Where `identity` Would Help Vue

Vue's `toRef()` and custom composables sometimes return callable accessors:

```typescript
// Custom composable with callable pattern:
function useCounter() {
  const count = ref(0);
  return {
    count: () => count.value,     // callable read — needs identity
    increment: () => count.value++,  // callable write — needs mutator
  };
}
```

Vue 3.5's `useTemplateRef` and similar APIs also adopt callable patterns where
`identity` would enable narrowing.

### 3.5 Mapping

| Vue Concept                | TypeScript-Go Analog          | Notes                                |
|----------------------------|-------------------------------|--------------------------------------|
| `ref.value` read           | Getter CFA (existing)         | Property access, already narrowable  |
| `ref.value =` write        | Setter CFA (existing)         | Property assignment invalidation     |
| `computed.value`           | `readonly` getter (existing)  | Read-only, always narrowable         |
| Callable composable read   | `identity`                    | Needed for function-style reads      |
| `watch` callback           | Uncertainty boundary          | Async re-execution                   |

### 3.6 Design Tension: Property vs Callable

Vue's `.value` approach demonstrates a design trade-off:

- **Property access** (.value): works with existing TypeScript CFA, no new modifiers needed.
- **Callable access** (signal()): more ergonomic (no `.value`), requires `identity` for narrowing.

Angular chose callable access specifically for ergonomics and to avoid the `.value`
ceremony. This choice is what created the need for `identity` — a modifier that would
be unnecessary if Angular Signals used property access.

---

## 4. MobX — Decorator-Based Mutation Tracking

### 4.1 Core API Shape

MobX uses decorators and observable objects with transparent reactivity:

```typescript
import { makeAutoObservable, computed, action, autorun } from 'mobx';

class Store {
  count = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get doubled() { return this.count * 2; }   // computed via getter

  increment() { this.count++; }               // action: mutation
  setCount(v: number) { this.count = v; }     // action: mutation
}
```

### 4.2 Decorator Syntax

```typescript
class Store {
  @observable count = 0;
  @computed get doubled() { return this.count * 2; }
  @action increment() { this.count++; }
}
```

### 4.3 Structural Parallel to `identity`/`mutator`

MobX's decorator annotations map directly to TypeScript-Go's modifier system:

| MobX Decorator     | TypeScript-Go Modifier | Semantics                                |
|---------------------|------------------------|------------------------------------------|
| `@observable`       | (state container)      | Declares mutable state                   |
| `@computed` getter  | `identity` getter      | Derived read endpoint, stable            |
| `@action`           | `mutator`              | Function that modifies observable state  |
| `@action.bound`     | `mutator` (bound)      | Bound mutation method                    |

### 4.4 MobX's Runtime Enforcement vs Compile-Time Contracts

MobX enforces `@action` boundaries **at runtime** — modifying an observable outside an
action throws in strict mode. TypeScript-Go's `mutator` provides **compile-time**
guarantees through CFA without runtime enforcement:

```typescript
// MobX: runtime error if strict mode enabled
store.count = 5;  // Error: [MobX] changing observed state outside actions

// TypeScript-Go: compile-time CFA invalidation
interface Store {
  identity count(): number;
  mutator setCount(v: number): void links count;
}
// Compiler knows setCount invalidates count() narrowing
```

### 4.5 `autorun`/`reaction` as Uncertainty Boundaries

MobX's `autorun` and `reaction` re-execute reactively, creating the same uncertainty
boundaries as Angular's `effect()`:

```typescript
autorun(() => {
  const val = store.count;  // tracked read
  // val narrowing is valid within this synchronous execution
  // but the autorun re-runs asynchronously
});
```

---

## 5. Svelte — Compiler-Magic Reactivity

### 5.1 Svelte 5 Runes

Svelte 5 introduced "runes" — compiler directives that look like function calls:

```typescript
let count = $state(0);             // reactive state
let doubled = $derived(count * 2); // derived state
$effect(() => {
  console.log(`Count is: ${count}`);
});

count = 5;      // direct assignment — compiler tracks this
count++;        // mutation — compiler tracks this too
```

### 5.2 The Compiler-Magic Difference

Svelte's reactivity is **not** a library pattern — it is a compiler transformation.
`$state(0)` does not return a signal object. The variable `count` holds `0` directly.
Svelte's compiler rewrites reads and writes to the variable into reactive subscribe/
notify calls:

```typescript
// What the developer writes:
let count = $state(0);
count = 5;

// What the compiler generates (conceptual):
let $$count = createSignal(0);
$$count.set(5);
```

### 5.3 Implications for `identity`/`mutator`

Svelte's compiler magic bypasses the need for `identity`/`mutator` entirely within
`.svelte` files — variables declared with `$state` look like normal variables to
TypeScript's CFA:

```typescript
let name = $state<string | undefined>(undefined);

if (name !== undefined) {
  name.toUpperCase();  // works: name is a plain variable, standard CFA applies
}
```

However, Svelte's **exported state** and **store contracts** for `.ts` files use
callable patterns:

```typescript
// In a .ts file without compiler magic:
import { writable } from 'svelte/store';

const name = writable<string | undefined>(undefined);
// name.subscribe() — callable read (needs identity for narrowing)
// name.set() — callable write (natural mutator candidate)
// name.update() — callable write (natural mutator candidate)
```

### 5.4 Svelte Store Protocol

```typescript
interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(updater: (value: T) => T): void;
}
```

The `subscribe` pattern is push-based (callback), not callable-read. This does not map
cleanly to `identity` because there is no repeated callable read to narrow. Svelte 5
runes solve this by making the compiler handle it. In store-based code, `$` auto-subscription
syntax (`$name`) provides the callable-read equivalent.

### 5.5 Mapping

| Svelte Concept           | TypeScript-Go Analog          | Notes                                |
|--------------------------|-------------------------------|--------------------------------------|
| `$state` variable        | Standard CFA (variable)       | Compiler handles reactivity          |
| `$derived` variable      | Standard CFA (variable)       | Compiler handles derivation          |
| `$effect` callback       | Uncertainty boundary          | Re-runs asynchronously               |
| `writable.set()`         | `mutator`                     | In .ts files without compiler magic  |
| `writable.subscribe()`   | Push-based (different model)  | Not a callable read to narrow        |
| `$` auto-sub syntax      | Compiler-synthesized read     | Svelte-specific, not general TS      |

---

## 6. Preact Signals — `.value` Property with Callable Overload

### 6.1 Core API Shape

Preact Signals combine property access (`.value`) with an emerging callable pattern:

```typescript
import { signal, computed, effect } from '@preact/signals';

const count = signal(0);
const doubled = computed(() => count.value * 2);

count.value;        // read: property access
count.value = 5;    // write: property assignment

effect(() => {
  console.log(`Count is: ${count.value}`);
});
```

### 6.2 Type Signatures

```typescript
interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;           // read without tracking
  toJSON(): T;
  valueOf(): T;
}

interface Signal<T> extends ReadonlySignal<T> {
  value: T;            // read + write through same property
}
```

### 6.3 Property vs Callable

Like Vue, Preact Signals primarily use `.value` property access, so existing getter/setter
CFA handles narrowing:

```typescript
const name = signal<string | undefined>(undefined);

if (name.value !== undefined) {
  name.value.toUpperCase();  // already works with property CFA
}
```

### 6.4 Integration with TC39 Signals

Preact Signals has been influential in the TC39 Signals proposal (Section 8). The TC39
proposal adopts a `.get()` callable pattern for read access, which would require `identity`:

```typescript
// TC39 proposal style:
const count = new Signal.State(0);
count.get();      // read: callable — needs identity
count.set(5);     // write: callable — natural mutator
```

### 6.5 Mapping

| Preact Concept           | TypeScript-Go Analog          | Notes                                |
|--------------------------|-------------------------------|--------------------------------------|
| `signal.value` read      | Getter CFA (existing)         | Property access, already narrowable  |
| `signal.value =` write   | Setter CFA (existing)         | Property invalidation                |
| `signal.peek()`          | Non-tracking read             | Would use `identity` if primary read |
| `computed.value`         | `readonly` getter (existing)  | Read-only property                   |
| `effect` callback        | Uncertainty boundary          | Async re-execution                   |

---

## 7. RxJS — Push-Based Observables

### 7.1 Core API Shape

RxJS uses a fundamentally different reactivity model — push-based streams:

```typescript
import { BehaviorSubject, map, filter } from 'rxjs';

const count$ = new BehaviorSubject<number>(0);
const doubled$ = count$.pipe(map(v => v * 2));

count$.getValue();    // synchronous read (discouraged)
count$.next(5);       // push new value
count$.subscribe(v => console.log(v));  // reactive subscription
```

### 7.2 Type Signatures

```typescript
class BehaviorSubject<T> extends Subject<T> {
  getValue(): T;                          // synchronous read
  next(value: T): void;                   // push value
  subscribe(observer: Observer<T>): Subscription;
}

class Observable<T> {
  pipe(...operators: OperatorFunction[]): Observable<any>;
  subscribe(observer: Observer<T>): Subscription;
}
```

### 7.3 Push vs Pull — Fundamental Model Difference

RxJS observables are push-based: values are **pushed** to subscribers through callbacks.
Signals (Angular, SolidJS, etc.) are pull-based: values are **pulled** by calling the
read endpoint.

This distinction matters for `identity`/`mutator`:

- **Pull-based (Signals):** Repeated calls to the same read function — `identity` directly applies.
- **Push-based (RxJS):** Values arrive via callback — `identity` does not naturally apply because there is no repeated callable read.

### 7.4 Where `identity` Would Apply in RxJS

`BehaviorSubject.getValue()` is the one synchronous pull-based read in RxJS:

```typescript
interface BehaviorSubject<T> {
  identity getValue(): T;        // synchronous read — narrowable
  mutator next(value: T): void links getValue;  // push invalidates read
}

const name$ = new BehaviorSubject<string | undefined>(undefined);

if (name$.getValue() !== undefined) {
  name$.getValue().toUpperCase();  // valid with identity
}

name$.next(undefined);  // invalidates getValue() narrowing
```

However, this pattern is considered an anti-pattern in RxJS — idiomatic RxJS avoids
`getValue()` in favor of stream composition. The primary reactivity model (subscribe)
does not benefit from `identity`.

### 7.5 `pipe` Operators and Narrowing

RxJS operators like `filter` perform narrowing within stream pipelines:

```typescript
const name$ = new BehaviorSubject<string | undefined>(undefined);

name$.pipe(
  filter((v): v is string => v !== undefined),
  map(v => v.toUpperCase())  // v is narrowed to string by filter's type guard
);
```

This narrowing happens through type predicates in the operator chain, not through CFA.
`identity`/`mutator` does not interact with this mechanism.

### 7.6 Mapping

| RxJS Concept               | TypeScript-Go Analog          | Notes                                |
|----------------------------|-------------------------------|--------------------------------------|
| `getValue()` read          | `identity` (if used)          | Synchronous read, but anti-pattern   |
| `next(value)` push         | `mutator`                     | Invalidates synchronous read         |
| `subscribe` callback       | Push-based (different model)  | Not a callable read to narrow        |
| `pipe(filter(...))` narrow | Type predicate narrowing      | Existing TS mechanism, not identity  |
| Observable composition     | N/A                           | Stream-level, not CFA-level          |

---

## 8. TC39 Signals Proposal — Standardized Signals for JavaScript

### 8.1 Proposal Status

The TC39 Signals proposal (Stage 1 as of 2024) aims to standardize signals as a
JavaScript language primitive. Key contributors include representatives from Angular,
Solid, Preact, and other frameworks.

### 8.2 Proposed API Surface

```typescript
// State signal — writable
const counter = new Signal.State(0);
counter.get();     // read: 0
counter.set(5);    // write: replaces value

// Computed signal — derived, read-only
const doubled = new Signal.Computed(() => counter.get() * 2);
doubled.get();     // read: 10

// Watcher — effect scheduling
const watcher = new Signal.subtle.Watcher(() => {
  // Notification that a dependency changed
});
```

### 8.3 Type Signatures (Proposed)

```typescript
namespace Signal {
  class State<T> {
    constructor(initialValue: T, options?: SignalOptions<T>);
    get(): T;
    set(value: T): void;
  }

  class Computed<T> {
    constructor(computation: () => T, options?: SignalOptions<T>);
    get(): T;
  }
}
```

### 8.4 Direct Alignment with `identity`/`mutator`

The TC39 proposal uses **callable `.get()` and `.set()`** rather than property `.value`
access. This makes it the clearest case for `identity`/`mutator`:

```typescript
namespace Signal {
  class State<T> {
    identity get(): T;
    mutator set(value: T): void links get;
  }

  class Computed<T> {
    identity get(): T;  // read-only, no mutator needed
  }
}
```

### 8.5 If TC39 Signals Land

If signals become a JavaScript standard:
- Every TypeScript user writing signal code will encounter the callable-read narrowing gap.
- `identity`/`mutator`/`links` would need to be available (or inferred) for the standard API.
- The standard library `.d.ts` files would need these annotations.
- This transitions `identity` from "framework ergonomic" to "language-level necessity."

### 8.6 Mapping

| TC39 Proposal Concept      | TypeScript-Go Analog          | Notes                                 |
|----------------------------|-------------------------------|---------------------------------------|
| `Signal.State.get()`       | `identity` endpoint           | Callable read, directly applicable    |
| `Signal.State.set()`       | `mutator` with `links get`    | Callable write, invalidates read      |
| `Signal.Computed.get()`    | `identity` endpoint           | Read-only derived value               |
| `Signal.subtle.Watcher`    | Uncertainty boundary          | Async notification scheduling         |
| `Signal.subtle.untrack()`  | Non-tracking read context     | Read without dependency registration  |

---

## 9. Cross-Framework Patterns

### 9.1 Universal Read/Write Separation

Every framework examined separates read from write at the API level:

| Framework       | Read Endpoint       | Write Endpoint           | Read Style    |
|-----------------|---------------------|--------------------------|---------------|
| Angular Signals | `signal()`          | `signal.set(v)`          | Callable      |
| SolidJS         | `accessor()`        | `setter(v)`              | Callable      |
| Vue             | `ref.value`         | `ref.value = v`          | Property      |
| MobX            | `@computed` getter  | `@action` method         | Property      |
| Svelte Runes    | `$state` variable   | `$state =` assignment    | Variable      |
| Preact Signals  | `signal.value`      | `signal.value = v`       | Property      |
| RxJS            | `subject.getValue()`| `subject.next(v)`        | Callable      |
| TC39 Proposal   | `signal.get()`      | `signal.set(v)`          | Callable      |

**Observation:** Frameworks that use **callable** read access (Angular, SolidJS, TC39)
are the ones that need `identity`. Frameworks using **property** access (Vue, MobX,
Preact) are already served by existing getter/setter CFA.

### 9.2 The Callable Read Gap

The `identity` modifier exists because TypeScript treats function return values as
ephemeral — each call produces a fresh value. For property access, CFA already assumes
stability between mutations. The callable read pattern breaks this assumption:

```typescript
// Property: CFA assumes stability ✓
if (obj.value !== undefined) {
  obj.value.toUpperCase();  // OK — same property, CFA narrows
}

// Callable: CFA assumes no stability ✗
if (obj.get() !== undefined) {
  obj.get().toUpperCase();  // ERROR — different call, no reuse of narrowing
}
```

`identity` bridges this gap: it tells CFA that `obj.get()` behaves like `obj.value` —
repeated reads return the same value until explicitly mutated.

### 9.3 Mutation Patterns

Three mutation patterns emerge across frameworks:

**Pattern A: Same-object method mutation** (Angular, Preact, TC39)
```typescript
signal.set(value);     // method on the same object
signal.update(fn);     // method on the same object
```
`links` naturally points to the read method on the same interface.

**Pattern B: Separate-variable mutation** (SolidJS)
```typescript
const [get, set] = createSignal(value);
set(newValue);         // separate variable, linked by destructuring origin
```
`links` requires cross-variable awareness or factory return type annotation.

**Pattern C: Property assignment mutation** (Vue, Preact)
```typescript
ref.value = newValue;  // property assignment — existing CFA handles this
```
No `mutator`/`links` needed — this is already modeled by setter CFA.

### 9.4 What Each Framework Wants from `identity`/`mutator`/`links`

| Framework        | Needs `identity`? | Needs `mutator`? | Needs `links`? | Why                                    |
|------------------|-------------------|-------------------|----------------|----------------------------------------|
| Angular Signals  | **Yes (critical)** | **Yes**           | **Yes**        | Callable reads, method-based writes    |
| SolidJS          | **Yes**            | **Yes**           | **Desirable**  | Callable reads, separate-var writes    |
| Vue              | Rarely             | Rarely            | Rarely         | Property access for primary API        |
| MobX             | Sometimes          | Sometimes         | Sometimes      | Computed getters are properties        |
| Svelte           | Rarely             | Rarely            | Rarely         | Compiler handles reactivity            |
| Preact Signals   | Rarely             | Rarely            | Rarely         | Property access for primary API        |
| RxJS             | Rarely             | Rarely            | Rarely         | Push-based model, getValue() is rare   |
| TC39 Proposal    | **Yes (critical)** | **Yes**           | **Yes**        | Callable reads, method-based writes    |

### 9.5 The Property-vs-Callable Split

The reactive framework ecosystem reveals a clear split:

- **Property-access frameworks** (Vue, MobX, Svelte, Preact): TypeScript already
  provides adequate narrowing. These frameworks are not primary beneficiaries of
  `identity`/`mutator`.

- **Callable-access frameworks** (Angular, SolidJS, TC39): TypeScript cannot express
  read stability today. These frameworks are the primary motivation and primary
  beneficiaries.

This validates `identity`/`mutator`/`links` as a **targeted** solution for a specific
gap, not an overly broad mechanism. It solves exactly the problem that callable-read
frameworks have, without imposing ceremony on property-based frameworks that do not
need it.

### 9.6 Derived/Computed as Read-Only Identity

All frameworks have a concept of derived/computed state that is read-only:

```typescript
// Angular:   computed(() => ...)    : Signal<T>     (no set/update)
// SolidJS:   createMemo(() => ...)  : Accessor<T>   (no setter returned)
// Vue:       computed(() => ...)    : ComputedRef<T> (readonly value)
// MobX:      @computed getter                        (no setter)
// Preact:    computed(() => ...)    : ReadonlySignal<T>
// TC39:      Signal.Computed(...)   : { get(): T }  (no set)
```

For these, `identity` applies without `mutator` or `links` — the endpoint is
inherently stable because no writes exist. The only invalidation comes from
**upstream** state changes, which are handled by the framework's dependency graph,
not TypeScript's CFA.

---

## 10. Alternative Syntax Ideas

### 10.1 Lessons from Framework Patterns

Framework terminology varies substantially — `signal`, `ref`, `observable`, `store`,
`atom`, `state` — but the underlying read/write contracts are universal. This suggests
the modifier syntax should be abstract enough to map to any framework's vocabulary.

### 10.2 Modifier Spellings Considered

The current `identity`/`mutator`/`links` spelling was chosen for precision but several
alternatives could be influenced by framework conventions:

**Current spelling:**
```typescript
interface WritableSignal<T> {
  identity (): T;
  mutator set(value: T): void links ();
}
```

**Alternative: `stable`/`invalidates`**
```typescript
interface WritableSignal<T> {
  stable (): T;
  set(value: T): void invalidates ();
}
```
Pro: `stable` mirrors "stable reference identity." `invalidates` is a verb that reads
naturally.
Con: `stable` could be confused with stable sorting. `invalidates` is long.

**Alternative: `pure`/`impure`**
```typescript
interface WritableSignal<T> {
  pure (): T;
  impure set(value: T): void;
}
```
Pro: Familiar from functional programming.
Con: `pure` implies no side effects at all (not just read stability). Misleading for
functions that perform I/O or logging through the read.

**Alternative: `readonly`/`writeonly` (overloading existing keywords)**
```typescript
interface WritableSignal<T> {
  readonly (): T;           // callable read endpoint
  writeonly set(value: T): void;
}
```
Pro: Reuses existing TypeScript keyword.
Con: `readonly` on a method is confusing — it means the method is read-only, not that
it returns a `readonly` type. `writeonly` does not exist in TypeScript.

**Alternative: `@identity`/`@mutator` (decorator-style)**
```typescript
interface WritableSignal<T> {
  @identity (): T;
  @mutator set(value: T): void;
}
```
Pro: MobX developers would find this familiar.
Con: Decorators are runtime constructs. Using them for compile-time contracts is misleading.
Interfaces cannot have decorators.

### 10.3 Framework-Inspired `links` Syntax

Several alternatives for the `links` clause draw from framework patterns:

**Current:**
```typescript
mutator set(value: T): void links ();
```

**Alternative: `affects`**
```typescript
mutator set(value: T): void affects ();
```
Pro: Active verb. MobX-like mental model.

**Alternative: `invalidates`**
```typescript
mutator set(value: T): void invalidates ();
```
Pro: Precise about what happens at the CFA level.
Con: Long keyword. Implementation detail leaking into API surface.

**Alternative: `updates`**
```typescript
mutator set(value: T): void updates ();
```
Pro: Framework authors use "update" universally. Short.
Con: Could be confused with the `update()` method that many frameworks provide.

### 10.4 Could Frameworks Reduce Annotation Burden?

If heuristic inference (Tier 1/Tier 2) works well enough, many framework patterns would
require no explicit annotations at all:

```typescript
// Framework authors annotate the interface once:
interface WritableSignal<T> {
  identity (): T;
  mutator set(value: T): void links ();
  mutator update(fn: (value: T) => T): void links ();
}

// Application developers write normal code — no annotations needed:
const count = signal(0);
if (count() !== undefined) {
  count().toUpperCase();  // identity flows from WritableSignal type
}
count.set(undefined);     // mutator flows from WritableSignal type
```

The annotation surface is limited to **library .d.ts files**, not application code.
This is the same burden model as `readonly`, `override`, and other TypeScript modifiers —
framework authors annotate, application developers benefit silently.

---

## 11. Summary Matrix

| Dimension               | Angular | Solid | Vue  | MobX | Svelte | Preact | RxJS | TC39 |
|--------------------------|---------|-------|------|------|--------|--------|------|------|
| Read style               | Call    | Call  | Prop | Prop | Var    | Prop   | Call | Call |
| Write style              | Method  | Fn    | Prop | Method| Assign | Prop  | Method| Method|
| Needs `identity`?        | ★★★    | ★★★  | ★    | ★★   | ★      | ★      | ★    | ★★★ |
| Needs `mutator`?         | ★★★    | ★★★  | ★    | ★★   | ★      | ★      | ★    | ★★★ |
| Needs `links`?           | ★★★    | ★★   | ★    | ★★   | ★      | ★      | ★    | ★★★ |
| Heuristics sufficient?   | Mostly  | Mostly| Yes  | Partially | Yes | Yes   | Yes  | Mostly|
| Post-call narrowing?     | Yes     | Yes   | N/A  | N/A  | N/A    | N/A    | N/A  | Yes  |

★ = low need, ★★ = moderate need, ★★★ = critical need

---

## 12. Conclusions

### 12.1 The Feature is Well-Targeted

TypeScript-Go's `identity`/`mutator`/`links` system solves a real gap in the type
system that affects the most ergonomic reactive API pattern — callable read access.
Frameworks that use this pattern (Angular, SolidJS, TC39 proposal) cannot achieve
type narrowing parity with property-based alternatives without these modifiers.

### 12.2 Framework Convergence Validates the Design

The remarkable consistency across all frameworks — every one separates read from write,
every one has derived/computed read-only endpoints, every one has effect/watcher
uncertainty boundaries — confirms that `identity`/`mutator`/`links` maps to a universal
pattern, not Angular-specific behavior.

### 12.3 TC39 Signals Amplify Urgency

If the TC39 Signals proposal advances, callable-read narrowing becomes a **language-level**
concern, not just a framework concern. `identity` would need to be available for the
standard library types, making it a core TypeScript feature rather than a framework
accommodation.

### 12.4 Heuristic Inference Reduces Real-World Annotation Cost

For most framework patterns (same-object method mutation, single-endpoint declarations),
Tier 1 heuristics can infer the `mutator`/`links` relationship without explicit
annotation. Explicit contracts become necessary only for multi-endpoint declarations
and cross-variable linkage — a minority of real-world reactive code.

### 12.5 Naming Remains Open

The current `identity`/`mutator`/`links` spelling is precise but draws from type theory
rather than framework vocabulary. Alternatives like `stable`/`invalidates` or
`pure`/`impure` could improve readability for framework authors, though at the cost of
precision. The naming decision should be made with framework stakeholder input.
