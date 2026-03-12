# Proposal: `stable`, `mutator`, and `invalidates` Modifiers for TypeScript

**Status:** Draft Proposal  
**Authors:** Community Contributors  
**Target:** TypeScript Language  

---

## 1. Abstract

TypeScript's control flow analysis (CFA) narrows types through property access, variable assignment, and type guards — but it cannot narrow through repeated function calls. When a user calls `value()` twice, the compiler treats each invocation as independent, even when the underlying value cannot have changed between calls. This forces developers into workarounds — extracting temporaries, adding redundant assertions, or suppressing errors — that degrade code quality and, in reactive frameworks, alter program semantics.

This proposal introduces three declaration-site modifiers — `stable`, `mutator`, and `invalidates` — that give TypeScript the vocabulary to reason about function call stability. A `stable` callable promises referential stability: consecutive calls within the same control flow return the same value. A `mutator` callable declares that it may change the state backing a `stable` call. An `invalidates` clause on a mutator targets which specific `stable` methods are affected, enabling precise narrowing reset rather than blanket invalidation.

Together, these modifiers extend CFA to function calls with the same soundness tradeoffs TypeScript already accepts for property narrowing — no runtime cost, no expression-level syntax, full structural compatibility, and zero breaking changes to existing code.

---

## 2. Motivation

### The Problem

TypeScript narrows types through variables and properties but not through function calls:

```ts
declare const value: () => string | undefined;

if (value() !== undefined) {
    console.log(value().toUpperCase());
    //          ~~~~~~~
    // Error: Object is possibly 'undefined'
}
```

The compiler is technically correct — `value()` could return a different result on each invocation. But in practice, a large and growing class of APIs guarantee that consecutive calls within synchronous flow return the same value. TypeScript has no way to express this guarantee.

### Why Temporaries Are Not a Solution

The standard workaround is to extract the call result into a temporary variable:

```ts
const v = value();
if (v !== undefined) {
    console.log(v.toUpperCase()); // OK
}
```

This works for simple cases but fails in the contexts where the problem is most acute:

1. **Reactive tracking is broken.** In signal-based frameworks (Angular, SolidJS, the TC39 Signals proposal), calling a signal registers a reactive dependency. Extracting to a temporary captures a snapshot and severs the reactive subscription. The code compiles, but the component stops updating.

2. **Templates prohibit temporaries.** Angular templates and JSX expressions cannot declare local variables. The call-site *is* the only expression site available.

3. **Semantic drift.** Replacing `count()` with `const c = count()` changes the program's meaning. In reactive systems, the getter *is* the API — it is not an incidental call that can be hoisted.

4. **Ergonomic cost at scale.** Signal-heavy codebases require dozens of temporary extractions per component. The resulting code is verbose, harder to read, and prone to stale-variable bugs when developers forget to re-read after mutations.

### Framework Impact

Angular developers have investigated solving this problem at the language service level — intercepting signal calls and synthesizing narrowing information outside the type checker — and reported it to be infeasible: narrowing depends on control flow analysis that runs deep inside the checker, and a language service plugin cannot reliably replicate or intercept that logic.

The problem affects every framework that uses getter functions as primary API surface: Angular Signals, SolidJS accessors, and the TC39 Signals proposal (Stage 1). These frameworks collectively represent a major and growing segment of the TypeScript ecosystem.

---

## 3. Prior Art and Community Demand

### TypeScript Community

Three major proposals on the TypeScript repository address this space:

- **"Identity modifier for function return types"** — received 105+ positive reactions, with active engagement from TypeScript team members exploring syntax options and soundness tradeoffs.

- **"Pure/impure annotation for narrowing control"** — received 351+ positive reactions, labeled "Suggestion" and "Awaiting More Feedback" by RyanCavanaugh, indicating serious consideration.

- **"Angular signals and nullability"** — received 149+ reactions, with multiple framework teams advocating for a compiler-level solution rather than per-framework workarounds.

RyanCavanaugh raised two design challenges that this proposal directly addresses:

> "Doesn't this imply the need for additional syntax to identify which functions/methods invalidate the narrowing?"

This challenge motivated the need for what became `mutator` and `invalidates` — without explicit invalidation, narrowing through calls would be unsound or uselessly conservative.

> "It seems extremely nearsighted to ship a new CFA feature that is going to immediately run into another feature request before it's considered useful."

This concern motivated designing `stable`, `mutator`, and `invalidates` as a unified system rather than shipping narrowing alone and retrofitting invalidation later.

### Framework Authors

Angular and SolidJS developers have expressed strong support for compiler-level signal narrowing in upstream TypeScript discussions. No userland approach we've found can replicate CFA-level narrowing — the problem requires compiler integration to solve fully.

### Cross-Language Survey

Other typed languages solve the same core need through different mechanisms: Rust's borrow checker prevents aliased mutation at compile time; Kotlin's smart casts narrow through `val` bindings; Swift's value types ensure local narrowing via copy semantics; Dart 3.2 promotes nullable fields with alias analysis.

TypeScript's approach is distinct: rather than enforcing immutability or ownership, it provides opt-in annotations within the existing structural type system. This matches TypeScript's philosophy of gradual typing.

---

## 4. Design Goals Alignment

This proposal was designed to satisfy TypeScript's published design goals:

**Goal 3: "Impose no runtime overhead on emitted programs."**  
All three modifiers are fully erasable. They produce no runtime code, no metadata, no reflection artifacts. The emitted JavaScript is identical with or without the modifiers. This also satisfies the closely related Non-Goal 5 ("Add or rely on run-time type information in programs, or emit different code based on the results of the type system") — our modifiers are purely declarative and never influence emit.

**Goal 8: "Avoid adding expression-level syntax."**  
`stable`, `mutator`, and `invalidates` are declaration-site modifiers — they appear on function signatures, interface methods, and type aliases. No new expression syntax is introduced. Call sites remain unchanged.

**Goal 9: "Use a consistent, fully erasable, structural type system."**  
The modifiers participate in structural type checking. A `stable () => T` is assignable to `() => T` (modifier stripping — dropping the guarantee is safe). A `() => T` is not assignable to `stable () => T` (adding the guarantee requires declaration). This is checked structurally, not nominally.

**Non-Goal 3: "Apply a sound or 'provably correct' type system. Instead, strike a balance between correctness and productivity."**  
`stable` makes the same soundness tradeoff as property narrowing. TypeScript already narrows `obj.prop` through control flow, even though an aliased reference or getter could change the value between reads. The `stable` modifier makes this tradeoff explicit and opt-in for function calls, rather than implicit for properties.

---

## 5. Proposed Syntax — `stable`

### Declaration Forms

The `stable` modifier applies to zero-parameter callables at the declaration site:

```ts
// Interface method
interface Signal<T> {
    stable (): T;
}

// Function type alias
type Getter<T> = stable () => T;

// Class method
class Store<T> {
    private _value: T;
    stable getValue(): T { return this._value; }
}

// Object type literal
type Config = {
    stable getMode(): "dark" | "light";
};
```

### Semantics

A `stable` callable promises that consecutive calls within the same synchronous control flow, on the same receiver, return the same value. The compiler treats the return type as narrowable across calls — identical to how it treats property reads.

Narrowing applies through all existing CFA mechanisms: type guards, `typeof`, equality checks, truthiness, discriminated unions, and exhaustive switches.

### Before and After

```ts
// ── Today ──────────────────────────────────────────
declare const count: () => number | undefined;

if (count() !== undefined) {
    count() + 1;
    //          ❌ Error: Object is possibly 'undefined'
}

// ── With stable ────────────────────────────────────
declare const count: stable () => number | undefined;

if (count() !== undefined) {
    count() + 1;
    //          ✅ Narrowed to number
}
```

### Narrowing Boundaries

Narrowing through `stable` calls is reset at well-defined boundaries inspired by property narrowing, but more permissive — ordinary function calls do not reset `stable` narrowing, only explicitly marked `mutator` calls do:

- Calls to methods on the same receiver that are marked `mutator`
- Any `await` or `yield` expression
- Assignment to a property of the receiver
- Passing the receiver as an argument to any function
- Calls to functions whose parameters accept the receiver type or its alias

This is intentionally more permissive than property narrowing, where any function call resets narrowing. The rationale: since `stable` is opt-in and requires explicit annotation, the companion `mutator` annotation provides a reliable enumeration of mutation points. The compiler does not need to conservatively assume arbitrary calls could mutate state.

Within a single synchronous block — between such boundaries — narrowing is preserved:

```ts
declare const mode: stable () => "dark" | "light" | undefined;

if (mode() !== undefined) {
    if (mode() === "dark") {
        mode(); // "dark"
    } else {
        mode(); // "light"
    }
}
```

---

## 6. Proposed Syntax — `mutator`

### Declaration

```ts
interface Signal<T> {
    stable (): T;
    mutator set(value: T): void;
    mutator update(fn: (current: T) => T): void;
}
```

### Semantics

A `mutator` callable declares that it may change the state backing one or more `stable` calls on the same receiver. When a `mutator` is called, the compiler resets all `stable` narrowing on that receiver.

This is a deliberately conservative default — simple, predictable, and correct by construction. Developers do not need to manually track which mutations affect which getters. The compiler conservatively assumes that any mutator may affect any stable return value on the receiver.

### Example

```ts
declare const count: Signal<number | undefined>;

if (count() !== undefined) {
    count() + 1;       // ✅ Narrowed to number
    count.set(42);     // mutator call → resets all narrowing
    count();           // number | undefined (narrowing was reset)
}
```

### Why `mutator` Is Necessary

Without explicit invalidation, there are two unsound alternatives:

1. **Never reset narrowing.** This is provably wrong — a setter can change the value a getter returns.
2. **Reset on every function call.** This is too conservative — unrelated calls should not destroy narrowing.

RyanCavanaugh identified this gap directly: shipping `stable` without invalidation control would be "extremely nearsighted," producing a feature that immediately generates follow-up requests. `mutator` closes the loop.

### Cross-Receiver Independence

`mutator` calls on one receiver do not affect narrowing on a different receiver:

```ts
declare const a: Signal<string | undefined>;
declare const b: Signal<string | undefined>;

if (a() !== undefined && b() !== undefined) {
    a.set("hello");   // Resets narrowing on `a` only
    b();              // ✅ Still narrowed to string
    a();              // string | undefined (reset)
}
```

---

## 7. Proposed Syntax — `invalidates`

### Declaration

```ts
interface Signal<T> {
    stable get(): T;
    mutator set(value: T): void invalidates get;
}
```

### Semantics

The `invalidates` clause allows a `mutator` to declare exactly which `stable` methods it affects. Without `invalidates`, a mutator resets *all* `stable` narrowing on the receiver. With `invalidates`, only the named methods are reset — other stable narrowing is preserved.

### Multi-Method Example

```ts
interface Store {
    stable name(): string | undefined;
    stable age(): number | undefined;
    mutator setName(n: string): void invalidates name;
    mutator setAge(a: number): void invalidates age;
}

declare const store: Store;

if (store.name() !== undefined && store.age() !== undefined) {
    store.setName("Alice");

    store.age() + 1;    // ✅ Still narrowed — age was not invalidated
    store.name();       // string | undefined — name was invalidated
}
```

### When to Use `invalidates`

- **Omit `invalidates`** when a mutator may affect any or all stable methods. This is the safe default.
- **Use `invalidates`** when an API has clear separation between independent state channels — e.g., a store with named fields, each with its own getter and setter.

The `invalidates` clause is purely a precision tool. Code is correct without it; `invalidates` merely preserves narrowing that would otherwise be conservatively discarded.

---

## 8. Real-World Impact

### Angular Signals

Angular's signal API is the canonical motivating case. Today, Angular developers write:

```ts
@Component({
    template: `
        @if (user()) {
            <h1>{{ user().name }}</h1>  <!-- Error: possibly undefined -->
        }
    `
})
class UserComponent {
    user = signal<User | undefined>(undefined);
}
```

With this proposal, the signal type gains `stable` and `mutator`:

```ts
interface WritableSignal<T> {
    stable (): T;
    mutator set(value: T): void;
    mutator update(fn: (current: T) => T): void;
}

@Component({
    template: `
        @if (user()) {
            <h1>{{ user().name }}</h1>  <!-- ✅ Narrowed -->
        }
    `
})
class UserComponent {
    user = signal<User | undefined>(undefined);
}
```

No changes to component code. The type declaration alone enables narrowing.

Template narrowing depends on Angular's Type Check Block (TCB) generation. The `@if` guard must compile to a control flow structure where the stable CFA can recognize the narrowing pattern. Whether current TCB generation preserves this flow is an implementation detail requiring Angular compiler team coordination.

### SolidJS

SolidJS separates read and write into distinct functions:

```ts
type Accessor<T> = stable () => T;
type Setter<T> = mutator (value: T) => T;

function createSignal<T>(value: T): [Accessor<T>, Setter<T>];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    count() + 1;        // ✅ Narrowed — stable accessor preserves narrowing
    setCount(undefined); // mutator — but on a different binding than count
    count() + 1;        // ⚠️ Still narrowed — setCount does NOT invalidate count()
}
```

**Limitation:** SolidJS's separated accessor/setter pattern does not work with receiver-scoped invalidation. Because `count` and `setCount` are independent bindings (not methods on the same receiver), `mutator` on `setCount` does not invalidate `count()` narrowing. Calling `setCount(undefined)` after a narrowing check will not reset the narrowed type — this is a soundness gap.

SolidJS's API shape requires cross-binding invalidation, which is outside the scope of this proposal. For SolidJS, `stable` enables narrowing on accessors, but `mutator` invalidation cannot prevent unsound narrowing when the setter is a separate binding. Addressing this limitation would likely require API-level coordination with the SolidJS team.

### TC39 Signals (Stage 1)

The TC39 Signals proposal defines `Signal.State` and `Signal.Computed`:

```ts
namespace Signal {
    interface State<T> {
        stable get(): T;
        mutator set(value: T): void invalidates get;
    }

    interface Computed<T> {
        stable get(): T;
    }
}
```

The `invalidates` clause provides precise modeling: `set()` invalidates `get()` on the same state signal, while computed signals are inherently read-only and need only `stable`.

---

## 9. Soundness Analysis

### The Property Narrowing Precedent

TypeScript already narrows property access through control flow:

```ts
declare const obj: { value: string | undefined };

if (obj.value !== undefined) {
    obj.value.toUpperCase(); // ✅ Narrowed — but is it sound?
}
```

This narrowing is unsound in the general case. An aliased reference, a getter with side effects, or a Proxy could change `obj.value` between the check and the use. TypeScript accepts this tradeoff because the alternative — refusing to narrow any property — would make the language impractical.

### How `stable` Compares to Property Narrowing

The `stable` modifier extends property narrowing's tradeoff to function calls, with one important difference: it is *opt-in*. Ordinary function calls remain un-narrowed. Only calls explicitly declared `stable` receive narrowing treatment.

However, the trust models differ in an important way. Property narrowing uses a *one-sided trust model* — the compiler can mechanically observe writes (`obj.prop = x`) and resets narrowing when it sees them. No annotation from the developer is required for reset. `stable` uses a *two-sided trust model* — the compiler trusts annotations for BOTH narrowing (via `stable`) AND reset (via `mutator`). If a developer forgets to mark a mutating function as `mutator`, narrowing is never reset, and the compiler will silently assume narrowed types remain valid.

### `mutator` Restores Soundness at Mutation Points

Without `mutator`, TypeScript would have to either:
- Reset narrowing at *every* function call (too conservative — breaks the feature)
- Never reset narrowing (unsound — ignores mutations)

`mutator` provides the middle ground: narrowing persists through unrelated calls and resets precisely when declared side effects occur. Developers annotate their APIs to match actual behavior, and the compiler trusts those annotations.

### Risk Profile

The total risk profile is comparable to property narrowing: in one direction (opt-in vs default), `stable` is more conservative — properties are narrowed by default, while function calls require explicit `stable` annotation. In another direction (reset enforcement), property narrowing is stronger — the compiler mechanically detects writes, while `stable` relies on developers correctly applying `mutator`. Both accept unsoundness for ergonomic benefit.

A developer who writes `stable` on a non-stable function, or omits `mutator` from a mutating function, gets the same class of error as writing any incorrect type annotation — the compiler trusts the declaration and may narrow incorrectly. The gap is real, but it is the same gap TypeScript has always accepted.

---

## 10. Type System Integration

### Structural Compatibility

The modifiers integrate into TypeScript's structural type system through standard subtyping rules:

| Assignment | Legal? | Rationale |
|------------|--------|-----------|
| `stable () => T` → `() => T` | ✅ | Dropping the stability guarantee is safe |
| `() => T` → `stable () => T` | ❌ | Cannot assume stability without declaration |
| `mutator (x: T) => void` → `(x: T) => void` | ⚠️ | Allowed — dropping the mutator marker means the call won't reset narrowing. This is an accepted soundness gap analogous to method parameter bivariance: the assigned function may mutate state without triggering narrowing reset. Developers should be aware that structural widening can suppress invalidation. |
| `(x: T) => void` → `mutator (x: T) => void` | ✅ | Conservatively marking as mutating is safe — may cause unnecessary narrowing resets but cannot cause unsound narrowing |

### Grammar

- `stable` appears as a modifier before the parameter list in function type syntax, or before the method name in method signatures.
- `mutator` appears as a modifier before the parameter list in function type syntax, or before the method or function name in method/function signatures.
- `invalidates` appears after the return type in a mutator signature, followed by one or more method names.

All three are contextual keywords — they are only treated as keywords in modifier position and remain valid identifiers elsewhere.

---

## 11. Implementation

A working implementation exists in a fork of the TypeScript compiler (typescript-go), spanning scanner/parser (contextual keyword recognition), binder (flow nodes for stable call references), checker (CFA narrowing, modifier consistency, structural assignability), printer (modifier syntax emission), and diagnostics (error messages for invalid placement and incompatible assignments).

All existing compiler tests pass with zero regressions. A dedicated test suite validates: basic narrowing, control flow boundaries, callback interactions, loop narrowing, exhaustive switch patterns, mutator invalidation, targeted invalidates, cross-receiver independence, and linked predicates.

---

## 12. Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **`Identity<T>` utility type** | Cannot integrate with CFA; provides a type-level marker but no narrowing behavior. Less ergonomic than a modifier for method signatures. |
| **Decorator-based (`@stable`)** | Decorators have runtime semantics and emit helper code. Violates Design Goal 3 (no runtime overhead). Not erasable. |
| **Comment pragma (`// @stable`)** | No structural typing participation. Invisible to tooling. Cannot be checked across module boundaries. |
| **Union typing workaround** | RyanCavanaugh proposed this creative encoding (`(() => string) \| (() => undefined)`), which works for simple cases. However, we found it does not generalize to generic types, leads to combinatorial explosion for compound unions, and complicates inference. |
| **Extract to temp variable** | Severs reactive tracking in signal-based frameworks. Impossible in template expressions. Changes program semantics. |
| **Language service plugin** | Angular developers have reported this approach to be infeasible — narrowing depends on CFA internals that cannot be intercepted from a plugin. |
| **`readonly` modifier** | `readonly` prevents writes to properties. `stable` preserves narrowing across reads of function return values. Different axis entirely. |

---

## 13. Future Extensions

The following capabilities are explicitly **not** part of this proposal but are enabled by it:

- **Linked type predicates:** `hasValue(): this.value() is string` — a type predicate that narrows the return type of a different stable method on the same receiver. This enables `has`/`get` patterns on maps and optional containers.

- **Constrained-overload narrowing:** When `set(42)` is called, the compiler could narrow `get()` to `number` based on overload resolution. This would enable "write-then-read" patterns without re-checking.

- **Parameter support:** Extending `stable` to functions with parameters, promising that the same arguments yield the same result (memoization semantics). Significant design questions remain around argument identity.

- **Standard library annotations:** Adding `stable` and `mutator` to built-in types (e.g., `Map.prototype.get` after `Map.prototype.has`, DOM element accessors). This requires careful API review and is a separate proposal.

---

## 14. FAQ

**Q: Isn't this just `readonly`?**

No. `readonly` prevents *writes*. `stable` preserves *narrowing* across repeated *reads* of a function return value. A `stable` getter can be backed by mutable state — the guarantee is that within a single synchronous control flow segment, consecutive calls return the same value. The two modifiers are orthogonal.

**Q: What about thread safety?**

JavaScript is single-threaded. The `stable` contract is about sequential consistency within synchronous control flow blocks — between `await` points, `yield` points, and calls that could trigger re-entrant mutation.

**Q: Can this be done without new keywords?**

A union typing approach (`(() => string) | (() => undefined)`) was explored but does not generalize to generic types, causes combinatorial explosion for compound unions, and breaks type inference. A modifier keyword is the minimal syntax that integrates with CFA, structural typing, and existing declaration forms.

**Q: Does this break existing code?**

No. All three keywords are contextual — they are only recognized as modifiers in specific syntactic positions. Existing code using `stable`, `mutator`, or `invalidates` as identifiers continues to work unchanged. No existing types, assignments, or expressions change meaning.

**Q: What about performance?**

CFA already tracks narrowing state for properties. Extending this to `stable` calls adds one additional category to the existing machinery — same flow graph, same narrowing functions, same type cache. No new algorithmic complexity.

**Q: Why not use a JSDoc annotation instead?**

JSDoc annotations are not part of the structural type system. A JSDoc comment on a function in module A has no effect on the type of that function when imported in module B. `stable` must be part of the type signature to enable cross-module narrowing and structural assignability checking.

**Q: What happens if someone lies — marks a non-stable function as `stable`?**

The same thing that happens with an incorrect type annotation: the compiler trusts the declaration and may narrow incorrectly. See §9 (Soundness Analysis) for a detailed comparison with property narrowing's trust model.

---

## 15. Summary

| Feature | Purpose | Syntax |
|---------|---------|--------|
| `stable` | Marks a callable as returning a referentially stable value | `stable (): T` |
| `mutator` | Marks a callable as potentially changing stable state | `mutator set(v: T): void` |
| `invalidates` | Targets which stable methods a mutator affects | `mutator set(v: T): void invalidates get` |

These three modifiers fill a gap in TypeScript's type system that affects a large and growing number of developers working with signal-based frameworks and getter-function APIs. They follow TypeScript's design philosophy: fully erasable, declaration-site only, structurally typed, and zero breaking changes. The same soundness tradeoffs that TypeScript already accepts for property narrowing extend naturally to `stable` calls, with `mutator` and `invalidates` providing explicit control over invalidation that property narrowing lacks.

We recognize that introducing three new contextual keywords is significant language surface area. We believe the unified design — addressing narrowing, invalidation, and targeted invalidation together — justifies this cost over a piecemeal approach. However, we are open to a phased introduction (e.g., `stable` alone first, with `mutator` and `invalidates` in a follow-up) or a simplified design if the team prefers.

---

## 16. Open Questions

The following design questions remain open and would benefit from TypeScript team input:

1. **Destructured methods.** What should happen when a `stable` method is destructured from its receiver? The narrowing guarantee is scoped to a receiver, but destructuring severs the receiver binding. Should narrowing still apply, or should it be an error to destructure a `stable` method?

2. **Mapped and conditional types.** How do `stable` and `mutator` modifiers interact with mapped types (`{ [K in keyof T]: ... }`) and conditional types? Should there be a `Stable<T>` utility type analogous to `Readonly<T>`?

3. **Standard library annotations.** Should built-in types like `Map.prototype.get` (after `Map.prototype.has`), `WeakRef.prototype.deref`, or DOM element accessors be annotated with `stable`? This requires careful API review as a separate effort.

4. **Backward-compatible declarations.** How do frameworks ship type declarations that work with both TypeScript versions that support `stable` and older versions that do not? Conditional type exports, declaration file versioning, or a polyfill `.d.ts` strategy may be needed.

5. **`this` parameter interaction.** How should `stable` and `mutator` modifiers interact with explicit `this` parameter types? Should `stable` be allowed on functions with a `this` parameter, and if so, does the `this` type serve as the receiver for invalidation scoping?

6. **Alternative approaches.** Are there simpler mechanisms — such as a single-modifier design, a type-level encoding, or integration with an existing feature like `readonly` — that the team would prefer to explore? We are open to fundamentally different approaches if they better fit TypeScript's design trajectory.

7. **Modifier naming.** Existing TypeScript modifiers are adjectives (`readonly`, `abstract`, `static`), while `mutator` is a noun. `mutating` — which follows the adjective pattern and mirrors Swift's `mutating` keyword — may be a better fit. We welcome the team's preference on naming.

---

We welcome feedback on the design tradeoffs and open questions outlined above.
