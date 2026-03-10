# Identity Modifier for Function Types - Research & Design Document

## Problem Statement

TypeScript cannot narrow types through repeated function calls. When a parameterless "getter" function returns a union type and you check its result, subsequent calls to the same function lose the narrowing:

```typescript
declare const value: () => string | undefined;

if (value() !== undefined) {
  console.log(value().toUpperCase());
  //          ~~~~~~~ Error: Object is possibly 'undefined'.
}
```

This is a critical pain point for **Signals** (Angular, Solid, TC39 proposal) and similar reactive patterns where values are accessed through getter functions.

### Related Issues
- [TypeScript #60948](https://github.com/microsoft/TypeScript/issues/60948) - `identity` modifier proposal
- [Angular #49161](https://github.com/angular/angular/issues/49161) - Signals and nullability
- [TypeScript #57725](https://github.com/microsoft/TypeScript/issues/57725) - Allow specifying narrowing for function calls
- [Solid #1575](https://github.com/solidjs/solid/discussions/1575) - Signals are troublesome with TypeScript

---

## Research: How Other Languages Handle This

### Kotlin - Smart Casts & Contracts
- **Smart casts** automatically narrow after `is` or null checks, but only for **stable** references
- **Stability**: Only `val` local variables and parameters are "stable". `var`, custom getters, and function calls are NOT stable
- **Contracts** (experimental since 1.3): Allow functions to declare guarantees, e.g., `returns(true) implies (param is Type)`. This is the closest to what we need — Kotlin contracts let user-defined functions participate in smart casting
- **No purity keyword**: Kotlin does not have a `@Pure` or `@Stable` annotation for general function narrowing

### Kotlin/Jetpack Compose - @Stable and @Immutable
- `@Stable`: Marks classes where changes are tracked through observable state (Compose-specific)
- `@Immutable`: Marks classes that never change after construction
- These are **annotations** (not keywords) and affect recomposition, not type narrowing
- Important precedent: uses the word **"Stable"** for the concept

### Swift
- Flow-sensitive typing for optionals (`if let`, `guard let`)
- No function purity annotations affecting type narrowing
- No smart casts for function return values

### Rust
- Pattern matching and borrow checker handle type narrowing
- No function purity annotations — all functions assumed pure unless using `mut`/`unsafe`
- No smart casts across function calls

### C#
- Pattern matching (C# 7+) for narrowing
- No `[Pure]` annotation that affects type narrowing (only used for static analysis tools like Code Contracts)
- No smart casts for function return values

### Flow (JavaScript type checker)
- Has refinement invalidation: any function call invalidates refinements (conservative for soundness)
- No `@pure` annotation that preserves refinements across calls
- Workaround: store in local variable

### Summary Table

| Language | Smart Cast for Fn Calls | Keyword/Annotation | Mechanism |
|----------|------------------------|--------------------|-----------| 
| **Kotlin** | Via Contracts (experimental) | `contract { }` block | Compiler-trusted declarations |
| **Compose** | N/A (recomposition) | `@Stable`, `@Immutable` | Annotations on classes |
| **Swift** | No | None | N/A |
| **Rust** | No | None | N/A |
| **C#** | No | `[Pure]` (analysis only) | N/A |
| **Flow** | No | None | Refinement always invalidated |
| **TypeScript** | No (proposed) | `identity` (proposed) | Proposed for #60948 |

---

## Can This Be Achieved Without New Syntax?

### Approach 1: Pure Control Flow Analysis
**Verdict: Not feasible without annotations**

TypeScript cannot determine function purity from control flow alone because:
1. Functions can have arbitrary side effects
2. Even parameterless functions can return different values each call (e.g., `Date.now()`, `Math.random()`)
3. The compiler can't analyze function bodies across modules
4. JavaScript's dynamic nature makes static purity analysis unsound

### Approach 2: Heuristic-based (e.g., "narrow if function is const and has no params")
**Verdict: Unsound and would break existing code**

```typescript
// This would break under a heuristic approach:
let counter = 0;
const getValue = () => counter++;
if (getValue() === 0) {
  getValue(); // Would be incorrectly narrowed to 0
}
```

### Approach 3: User-Defined Type Guards (`is`)
**Verdict: Partially solves, but verbose and doesn't help signals**

```typescript
function isDefined(v: unknown): v is NonNullable<typeof v> { return v !== undefined; }
```
This doesn't help with repeated calls — `value()` is still re-evaluated.

### Approach 4: Intrinsic/Built-in Type (e.g., `StableGetter<T>`)
**Verdict: Possible but less ergonomic than a keyword**

Could use something like `type Signal<T> = StableGetter<() => T>` but this is less readable and doesn't compose naturally with function type syntax.

### Conclusion
**A new syntax feature (keyword or modifier) is necessary** to express the semantic guarantee that a function returns a stable value. This is consistent with Kotlin's approach (contracts) and Compose's approach (annotations).

---

## Keyword Choice Analysis

### Candidates

| Keyword | Pros | Cons |
|---------|------|------|
| `identity` | Matches mathematical identity property; clearly states the function call "is" its value | Could be confused with identity function `x => x`; not immediately clear to non-math users |
| `stable` | Used in Kotlin/Compose ecosystem; intuitive meaning "value doesn't change between calls" | Could imply the value never changes at all (too strong) |
| `pure` | Well-known FP concept; widely understood | Too broad — implies no side effects, which is stronger than what we need |
| `cached` | Clear technical meaning | Implies implementation detail (caching), not semantics |
| `memo` | Short, familiar from React | Framework-specific connotation |
| `readonly` | Already exists in TS | Already means something else (property immutability) |
| `const` | Already exists in TS | Already means something else |
| `deterministic` | Precise meaning | Too long and technical |

### Recommendation: `stable`

We recommend **`stable`** over `identity` for these reasons:

1. **Precedent**: Kotlin/Compose uses `@Stable` for a very similar concept (stable references that can be trusted for optimization)
2. **Intuitive**: "stable" naturally conveys "the value is stable between calls" which is exactly the semantic we need
3. **Less confusion**: `identity` could be confused with the identity function pattern (`x => x`), while `stable` has no such ambiguity
4. **Concise**: Short, clear, and reads well in code: `stable () => string | undefined`
5. **Scope-appropriate**: Unlike `pure` (which implies no side effects at all), `stable` only claims the return value is consistent

However, following the original proposal's terminology and avoiding bikeshedding, we'll use **`identity`** as proposed in the issue, since that's what the community is discussing.

### Adjudicated Outcome (Current)
Final decision for this proposal stage:
- Keep `identity` now for proposal continuity and implementation/docs alignment.
- Defer any rename decision to an explicit upstream naming checkpoint.

Why this was adjudicated:
- Upstream continuity: active issue/proposal discussion currently uses `identity`.
- Delivery focus: Phase 1 goal is behavior parity and soundness evidence, not renaming churn.
- Change-cost control: renaming now would create broad baseline/docs/tooling churn with limited immediate value.

Reevaluation trigger:
- Open naming reconsideration only when upstream process explicitly requests naming review (for example at design advancement/sign-off), informed by implementation feedback, diagnostics clarity, and ecosystem ergonomics.

---

## Edge Cases & Mutation Handling

### Edge Case 1: Identity function called with arguments
```typescript
// Should produce a type error — identity is only for parameterless calls
declare const fn: identity (x: string) => number; // ERROR
```
**Decision**: Error when `identity` is on a function type with parameters.

### Edge Case 2: Narrowing cleared in closures
```typescript
declare const value: identity () => string | undefined;
if (value() !== undefined) {
  setTimeout(() => {
    value(); // string | undefined — narrowing lost (correct!)
  });
}
```
**Decision**: This is handled naturally by TypeScript's existing closure narrowing rules.

### Edge Case 3: Assignment to callee variable
```typescript
declare let value: identity () => string | undefined;
if (value() !== undefined) {
  value = someOtherFn; // Mutation!
  value(); // string | undefined — narrowing must be cleared
}
```
**Decision**: Handle through `containsMatchingReference` — assignment to callee clears narrowing.

### Edge Case 4: Overloaded call signatures
```typescript
declare const value: {
  identity (): string | undefined;
  (newValue: string): void;
};
if (value() !== undefined) {
  value("new"); // Should clear narrowing
  value(); // string | undefined
}
```
**Decision**: For initial implementation, this is not supported. Only standalone function types.

### Edge Case 5: Method calls on the return value
```typescript
declare const value: identity () => string | undefined;
if (value() !== undefined) {
  value().toUpperCase(); // Should work — string
}
```
**Decision**: Works naturally through flow analysis.

### Edge Case 6: Typeof narrowing
```typescript
declare const value: identity () => string | number;
if (typeof value() === "string") {
  value(); // should be string
}
```
**Decision**: Works naturally through the flow analysis system.

### Edge Case 7: Identity on class methods
```typescript
class Signal<T> {
  identity getValue(): T { ... } // Not supported initially
}
```
**Decision**: For initial implementation, only support on function type syntax (`identity () => T`).

### Edge Case 8: Identity with generic types
```typescript
type Signal<T> = identity () => T;
```
**Decision**: Should work — generics compose naturally.

---

## Implementation Design

### Syntax
```typescript
// Function type with identity modifier
type Getter<T> = identity () => T;

// In declaration
declare const value: identity () => string | undefined;

// With generic
declare function createSignal<T>(initial: T): identity () => T;
```

### Semantics
1. The `identity` modifier can only appear on function types with **no parameters**
2. Calls to identity functions are treated as **stable references** for type narrowing
3. Narrowing follows the same rules as variable narrowing (cleared in closures, cleared on assignment to callee)
4. The modifier is erased at runtime (type-level only)

### Implementation Changes
1. **AST**: Add `KindIdentityKeyword` as contextual keyword, `ModifierFlagsIdentity` flag
2. **Scanner**: Map `"identity"` to `KindIdentityKeyword`
3. **Parser**: Allow `identity` modifier on function types
4. **Checker**: Add `SignatureFlagsIdentity`, implement flow analysis for identity calls
5. **Flow Analysis**: Update `isMatchingReference` for call expressions, update cache key generation
6. **Grammar Checks**: Validate identity modifier placement and constraints
7. **Printer**: Emit `identity` modifier on function types
