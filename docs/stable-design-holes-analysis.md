# Design Holes Analysis: `stable` / `mutator` / `invalidates`

## 1. The Core Question

Given this interface:

```ts
interface Store {
    stable name(): string | undefined;
    stable age(): number | undefined;
    mutator setName(n: string): void invalidates name;
    mutator setAge(a: number): void invalidates age;
    someOtherFn(): void; // NOT marked mutator
}
```

If `someOtherFn()` is called on a `Store`, does it invalidate narrowing established
by `name()` or `age()`?

**Answer: No.** `someOtherFn()` does **not** invalidate `name()` or `age()` narrowing.
All method calls on any receiver — including unmarked methods on the same receiver — are
treated as transparent by default. Only calls explicitly marked `mutator` reset narrowing.

This raises the natural follow-up: *"Why have `mutator` and `invalidates` at all?
What do they give us?"*

## 2. Implementation Behavior

### The "Default Transparent" Rule

The control flow analysis in `internal/checker/flow.go` implements a default-transparent
design for stable narrowing:

- **`isUnrelatedCallForStableReference()`** returns `true` for ALL `isAccessExpression(callee)`
  cases — meaning every method call on any receiver (including the same receiver as the
  stable method) is treated as non-invalidating by default.

- **`isMutatorCallBoundary()`** checks for `SignatureFlagsMutator` on the called signature.
  Only calls with this flag reset narrowing.

- **`invalidates` clause processing** further refines reset scope — when a mutator has
  `invalidates name, age`, only those specific stable methods lose their narrowing.

### Concrete Example

```ts
declare const store: Store;

if (store.name() !== undefined) {
    // store.name() is narrowed to `string`

    store.someOtherFn();
    // store.name() is STILL narrowed to `string`
    // someOtherFn is not marked mutator → transparent

    store.setAge(42);
    // store.name() is STILL narrowed to `string`
    // setAge invalidates age, NOT name

    store.setName("alice");
    // store.name() narrowing is RESET
    // setName is mutator and invalidates name
}
```

This mirrors how TypeScript handles property narrowing: method calls on the same object
do not reset property narrowing. The stable system extends this principle to getter methods.

## 3. The Value Chain

Each modifier layer adds correctness guarantees on top of the previous:

### `stable` alone — Narrowing with no reset mechanism

```ts
interface Bare {
    stable value(): string | undefined;
}

declare const b: Bare;
if (b.value() !== undefined) {
    b.value().toUpperCase(); // Narrowed to string — works
    // But nothing can EVER reset this narrowing
    // If any code path mutates the backing state, this is unsound
}
```

`stable` alone enables narrowing but provides no vocabulary for expressing mutation.
The narrowing is correct only if the backing state truly never changes.

### `stable` + `mutator` — Narrowing with explicit reset

```ts
interface WithMutator {
    stable value(): string | undefined;
    mutator clear(): void;
}

declare const w: WithMutator;
if (w.value() !== undefined) {
    w.value().toUpperCase(); // Narrowed to string

    w.clear();
    w.value().toUpperCase(); // ERROR: value() is string | undefined again
    // mutator resets ALL stable narrowing on this receiver
}
```

Adding `mutator` gives the developer a way to declare "this call changes state."
The compiler resets narrowing at mutation points, restoring soundness for correctly
annotated APIs.

### `stable` + `mutator invalidates X` — Narrowing with targeted reset

```ts
interface Precise {
    stable name(): string | undefined;
    stable age(): number | undefined;
    mutator setName(n: string): void invalidates name;
}

declare const p: Precise;
if (p.name() !== undefined && p.age() !== undefined) {
    p.setName("alice");
    p.name(); // RESET — string | undefined
    p.age();  // STILL narrowed — number (invalidates targets name only)
}
```

The `invalidates` clause restricts which stable methods are reset, enabling precision
that a blanket reset cannot provide. For APIs with many stable getters but targeted
mutations, this prevents unnecessary re-checking.

## 4. The Trust Contract

The stable system is built on a **two-sided trust model** between the API author and
the compiler:

**Side 1 — The getter promise (`stable`):**
> "I promise this method returns the same value on consecutive calls,
> as long as no mutation has occurred."

**Side 2 — The mutation promise (`mutator`):**
> "I promise to mark every method that can change the backing state
> of any stable getter."

The compiler's job is mechanical: narrow after stable calls, reset at mutator calls.
The **developer** bears the semantic responsibility of annotating correctly.

This is analogous to TypeScript's existing trust model for type annotations generally —
the developer writes `x: string` and the compiler trusts it. If the developer lies
(`x: string` but `x` is actually a `number`), the type system is unsound. TypeScript
accepts this tradeoff in exchange for expressiveness.

The stable system extends this same philosophy to getter/setter semantics:
- Correct annotations → sound narrowing
- Incorrect annotations → unsound narrowing (developer error, not compiler error)

## 5. Design Holes

### Hole 1: Missing `mutator` Annotation

The most straightforward hole. A developer adds a method that mutates backing state but
forgets (or doesn't know to add) the `mutator` modifier:

```ts
interface Store {
    stable value(): string | undefined;
    clear(): void; // Actually clears the value, but NOT marked mutator
}

declare const store: Store;
if (store.value() !== undefined) {
    store.clear(); // Does NOT invalidate — transparent by default
    store.value().toUpperCase(); // Compiler says OK, but value is undefined → UNSOUND
}
```

**Severity:** High — silent unsoundness.
**Mitigation:** Linting rules could warn when an interface has `stable` methods but methods
with mutation-suggestive names (set*, clear*, reset*, delete*, remove*) lack `mutator`.

### Hole 2: Subclass / Implementation Escape

A class implementing an interface with `stable` getters can add new methods that mutate
backing state without `mutator`:

```ts
class MyStore implements Store {
    private _value: string | undefined;
    stable value(): string | undefined { return this._value; }
    mutator set(v: string | undefined): void { this._value = v; }

    // New method, not in interface, not marked mutator
    clear() { this._value = undefined; }
}

const s = new MyStore();
if (s.value() !== undefined) {
    s.clear(); // NOT a mutator → narrowing preserved → UNSOUND
}
```

**Severity:** Medium — the class author should know about the stable contract, but
nothing enforces it on newly added methods.
**Mitigation:** A lint rule could enforce that all methods in a class with `stable`
members must be either `stable` or `mutator` (or explicitly opted out).

### Hole 3: Cross-Binding Mutation (SolidJS Pattern)

Frameworks like SolidJS separate accessor and setter into different bindings:

```ts
const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    setCount(undefined);
    count(); // Still narrowed? setCount and count are different bindings
}
```

The compiler tracks narrowing per-receiver. Since `count` and `setCount` are independent
function bindings (not method calls on the same object), `setCount()` cannot be recognized
as a mutator of `count()`. The `invalidates` clause has no way to reference a separate
binding.

**Severity:** High for frameworks with this pattern — the stable system cannot express
the relationship.
**Mitigation:** This pattern requires a different mechanism (e.g., branded identity types
or explicit flow annotations). It is out of scope for the receiver-based stable design.

### Hole 4: Prototype Pollution / Dynamic Mutation

JavaScript allows runtime modification of objects through paths invisible to static
analysis:

```ts
declare const store: Store;
if (store.value() !== undefined) {
    Object.assign(store, { _value: undefined }); // Direct property mutation
    (store as any).secretReset(); // Dynamic method call
    Reflect.set(store, '_value', undefined); // Reflect API
    store.value(); // Still narrowed → UNSOUND
}
```

**Severity:** Low — this is adversarial JavaScript. No static type system can protect
against this.
**Mitigation:** None needed. TypeScript's type system does not attempt to defend against
dynamic escape hatches like `any` casts or `Reflect`.

### Hole 5: Aliased Receivers

When the same object is referenced through multiple bindings, mutation through one alias
does not invalidate narrowing on another:

```ts
const a = store;
const b = store; // Same object at runtime

if (a.value() !== undefined) {
    b.set(undefined); // Mutates the shared object
    a.value(); // Still narrowed on `a` → UNSOUND
}
```

The compiler tracks narrowing per syntactic reference. It does not perform alias analysis
to determine that `a` and `b` reference the same object.

**Severity:** Medium — alias situations arise in practice but are relatively uncommon
in idiomatic code.
**Mitigation:** None feasible without alias analysis, which TypeScript does not perform
for property narrowing either.

### Hole 6: Callbacks and Closures

A callback passed to a function could capture and mutate the receiver:

```ts
declare const store: Store;
if (store.value() !== undefined) {
    someArray.forEach(() => {
        store.set(undefined); // Mutation inside callback
    });
    store.value(); // Still narrowed? Depends on callback analysis
}
```

Whether this invalidates narrowing depends on how the CFA handles callbacks. If the
`.forEach()` call is transparent (no `mutator` on `Array.prototype.forEach`), the
narrowing survives — even though the callback demonstrably mutates state.

**Severity:** Medium-High — callbacks that capture and mutate are common patterns.
**Mitigation:** This is the same hole that exists in property narrowing. TypeScript
currently resets narrowing inside closures at assignment sites, but the stable system
operates on method calls rather than assignments. The existing CFA callback heuristics
provide partial coverage.

## 6. Comparison with Property Narrowing Holes

Every hole above has a direct analogue in TypeScript's existing property narrowing:

| Stable System Hole | Property Narrowing Analogue |
|---|---|
| Missing `mutator` | Method mutates `obj.prop` without the compiler knowing |
| Subclass escape | Subclass adds method that mutates inherited property |
| Cross-binding mutation | Separate variable holds ref to same property's storage |
| Dynamic mutation | `Object.assign`, `Reflect.set`, `delete` |
| Aliased receivers | `const a = obj; const b = obj; b.prop = undefined;` |
| Callback mutation | Closure captures `obj` and reassigns `obj.prop` |

Property narrowing is **already unsound** in all these cases. TypeScript accepts the
tradeoff because:

1. The happy path (straightforward sequential code) is correct.
2. The holes require deliberate or unusual patterns to trigger.
3. The ergonomic benefit outweighs the theoretical unsoundness.

The stable system inherits the **exact same class of tradeoffs**. It is no more unsound
than property narrowing — it simply extends the "trust the developer" model from properties
to getter methods.

## 7. Why This Design Is Still Valuable

Despite the holes documented above, the `stable` / `mutator` / `invalidates` system
provides significant value:

### 1. Explicit Vocabulary
There is currently **no way** in TypeScript to express "this method behaves like a
property getter" or "this method mutates observable state." The modifiers add semantic
vocabulary that `.d.ts` declarations can carry, enabling library authors to communicate
intent through the type system rather than documentation.

### 2. Correct Behavior for Correctly Annotated APIs
When APIs are annotated faithfully — stable getters marked `stable`, all mutations marked
`mutator` with appropriate `invalidates` clauses — narrowing is sound. The happy path
works correctly, and the compiler provides the same safety guarantees as property narrowing.

### 3. No Worse Than Property Narrowing
The holes are not new unsoundness — they are the same holes that property narrowing has
lived with since TypeScript 2.0. Developers already reason about aliasing, callbacks,
and dynamic mutation in the context of property narrowing. The stable system adds no new
categories of risk.

### 4. Framework-Level Control
Framework authors (React, SolidJS, MobX, etc.) annotate their APIs once. Every consumer
of those APIs automatically benefits from narrowing without needing to understand the
underlying mechanism. This is high-leverage: one annotation in a `.d.ts` file enables
correct narrowing across thousands of downstream codebases.

### 5. Opt-In Design
No existing code is affected. The modifiers are purely additive. Code without `stable`
or `mutator` annotations behaves exactly as it does today. There is no migration burden
and no backwards compatibility concern.

## 8. Recommendations

### Document the Trust Contract
The proposal should explicitly state the two-sided trust model. Developers need to
understand that `stable` alone does not guarantee soundness — `mutator` annotations
on all mutation points are equally necessary.

### Lint Rules for Common Mistakes
A companion ESLint rule (or built-in suggestion diagnostic) could warn about:
- Interfaces with `stable` methods but zero `mutator` methods
- Methods with mutation-suggestive names (`set*`, `clear*`, `reset*`, `delete*`,
  `remove*`, `update*`) in classes/interfaces that have `stable` methods
- Classes implementing interfaces with `stable` methods that add non-`stable`,
  non-`mutator` methods

### Explicitly State "Default Transparent"
The proposal should make the default-transparent behavior prominent rather than implicit.
Users need to understand that **no method call resets stable narrowing unless explicitly
marked `mutator`**. This is the single most important design decision and the one most
likely to surprise developers.

### Consider a `--strictStable` Flag
A stricter mode could treat ALL unmarked method calls on a receiver with stable methods
as potentially invalidating — reversing the default from transparent to opaque. This
would be overly conservative for most code, but would provide a path for developers who
prioritize soundness over ergonomics.

### Accept the Tradeoffs
The design holes are inherent to any system that tracks getter identity without runtime
enforcement. They are acceptable tradeoffs, consistent with TypeScript's design
philosophy of "pragmatic soundness." The system should be evaluated on the value it
provides for correctly annotated APIs, not on its behavior under adversarial or
incorrectly annotated code.
