# Cross-Binding Invalidation for SolidJS Signal Patterns

> **Update:** Cross-binding invalidation (CBI-1) is now fully implemented via named tuple labels with `invalidates` clause. Post-call argument narrowing also works. The implementation uses `invalidates` syntax (not `mutates`).

## 1. Problem Statement

SolidJS separates read and write into distinct function bindings:

```ts
type Accessor<T> = stable () => T;
type Setter<T> = (value: T) => T;

function createSignal<T>(value: T): [
    read: Accessor<T>,
    write: Setter<T> // ❌ No invalidates clause — setCount can't invalidate count
];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    count() + 1;         // ✅ Narrowed — stable accessor preserves narrowing
    setCount(undefined); // ❌ Should reset narrowing but DOESN'T (no cross-binding)
    count() + 1;         // ⚠️ Still narrowed — UNSOUND without CBI-1
}
```

The current `stable`/`mutator` system tracks narrowing per-receiver. `count` and `setCount` are independent function bindings — `setCount()` cannot invalidate `count()` narrowing because they share no common receiver. The `mutates` clause can only reference methods on `this`, not external bindings.

**Severity**: High. SolidJS should NOT ship `stable` until this is resolved. Publishing `stable` accessor types without cross-binding invalidation would give users narrowing that survives through mutations — the worst kind of type system lie.

## 2. Design Constraints

Any solution must satisfy:

1. **Declaration-site only** — no runtime semantics, fully erasable
2. **Structural compatibility** — works with TypeScript's structural type system
3. **No special compiler knowledge** — the compiler shouldn't hardcode knowledge of `createSignal`
4. **Composable** — works with generic wrappers, re-exports, and derived factories
5. **Sound by default** — if the relationship can't be expressed, narrowing should not apply
6. **Backward compatible** — existing code must continue to work unchanged

## 3. Approaches

### Approach A: Tuple-Element Cross-Reference (`mutates [N]`)

Extend the `mutates` clause to reference sibling tuple elements by index:

```ts
function createSignal<T>(value: T): [
    read: stable () => T,
    write: (value: T) => void mutates [0]  // mutates the element at tuple index 0
];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    setCount(undefined);  // CFA knows: mutates [0] → count (destructured from index 0)
    count();              // ✅ Correctly reset to number | undefined
}
```

**How it works:**
- `mutates [0]` on tuple element 1 means "calling this function invalidates all stable narrowing on the binding destructured from tuple element 0"
- The compiler tracks destructuring provenance: `const [a, b] = expr` → `a` came from index 0, `b` from index 1
- When CFA encounters a call to `b()` (which has `mutates [0]`), it resets narrowing on `a`

**Advantages:**
- Minimal new syntax — just `[N]` index reference in `mutates` clause
- Works with named tuple elements: `mutates read` (referencing the label)
- Natural for factories returning `[getter, setter]` pairs
- The relationship is scoped to the tuple — no global side effects

**Disadvantages:**
- Only works for co-destructured bindings from the same tuple
- Breaks if the tuple isn't destructured: `const sig = createSignal(0); sig[1](undefined);` — narrowing on `sig[0]` must also be reset
- Doesn't generalize to non-tuple patterns (e.g., object destructuring `{ get, set }`)
- Destructuring provenance tracking is a new CFA concept — the compiler must remember which tuple a variable came from

**Implementation complexity:** ~300-500 LOC
- Parser: Accept `[N]` or labels after `mutates` in tuple element position
- Checker: Track destructuring provenance in CFA. When narrowing reset occurs for a `mutates [N]` call, find the sibling binding and reset its narrowing.
- Risk: Medium. Destructuring provenance is novel but bounded.

---

### Approach B: Named Link Groups (`links "channel"`)

Introduce a named link group that multiple function types can subscribe to:

```ts
type Accessor<T> = stable () => T links "signal";
type Setter<T> = (value: T) => void mutates links "signal";

function createSignal<T>(value: T): [Accessor<T>, Setter<T>];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    setCount(undefined);  // CFA: mutates links "signal" → reset all "signal" members
    count();              // ✅ Reset
}
```

**How it works:**
- `links "signal"` on a stable function type joins it to a named channel
- `mutates links "signal"` on a mutator means "calling this invalidates all stable narrowings in the "signal" channel that are in scope"
- The channel name is a string literal (or symbol) — like a branded type but for CFA linkage

**Advantages:**
- Generalizes beyond tuples — works for any API shape (object destructuring, separate factory calls, class members)
- Explicit and readable: "this accessor is linked to channel 'signal', this setter mutates channel 'signal'"
- Could support multiple channels: `links "state", "derived"`

**Disadvantages:**
- String-based channel names risk typos and collisions (e.g., two unrelated libraries both using `links "signal"`)
- Channel identity is nominal in a structural type system — two independently-declared functions with `links "signal"` would be CFA-linked, which may be surprising
- New concept (channels/link groups) adds complexity to the type system
- How do channels interact with generics? Is `links "signal"` preserved through `Partial<T>`?
- Scoping: are channels global, module-scoped, or function-scoped?

**Implementation complexity:** ~600-800 LOC
- Parser: New `links` clause with string literal argument
- Checker: Channel tracking infrastructure in CFA. Map from channel names to sets of active narrowings.
- Risk: High. Global string-based channels in a structural type system is architecturally questionable.

---

### Approach C: Source Interface Extraction

Define the linked API on a single interface, then extract methods:

```ts
interface SignalCore<T> {
    stable get(): T;
    set(value: T): void mutates get;
}

// Type-level extraction preserves the relationship
type Accessor<T> = SignalCore<T>["get"];  // carries: stable, linked to SignalCore
type Setter<T> = SignalCore<T>["set"];    // carries: mutates get on SignalCore

function createSignal<T>(value: T): [Accessor<T>, Setter<T>];
```

**How it works:**
- The `mutates get` relationship is defined on a receiver-scoped interface (existing mechanism)
- When a method type is extracted via indexed access (`SignalCore<T>["set"]`), the compiler preserves the relationship metadata
- When CFA encounters a call to an extracted setter, it traces back to the source interface and invalidates narrowings on extracted getters from the same source

**Advantages:**
- No new syntax — uses existing `stable`/`mutates` on an interface
- The receiver-scoped relationship is defined naturally, then "projected" to separate bindings
- Type-safe — the relationship is checked structurally on the interface

**Disadvantages:**
- Requires the compiler to track "method origin" through indexed access types — a significant new concept
- What happens with `Accessor<T> = (() => T) & SignalCore<T>["get"]`? Intersection types complicate origin tracking
- Doesn't work if the accessor/setter types are defined independently (not extracted from a common interface)
- Implementation requires the type system to attach invisible metadata to function types, which conflicts with structural typing (two structurally identical function types would behave differently based on their origin)

**Implementation complexity:** ~800-1200 LOC
- Checker: Preserve method origin through indexed access, track in CFA
- Risk: Very High. Attaching invisible metadata to structural types undermines TypeScript's type system fundamentals.

**Verdict:** Architecturally unsound. Function types should behave identically regardless of how they were constructed. This approach violates structural equivalence.

---

### Approach D: `mutates` with Binding Path Reference

Allow `mutates` to reference bindings by identifier when used in tuple/object return types:

```ts
function createSignal<T>(value: T): [
    read: stable () => T,
    write: (value: T) => void mutates read  // references sibling by label
];
```

This is a refinement of Approach A using named tuple labels instead of indices.

**How it works:**
- Named tuple labels (`read:`, `write:`) serve as the reference targets
- `mutates read` references the `read` label in the same tuple type
- After destructuring, `const [count, setCount] = createSignal(0)`, the compiler maps: `count` ← label `read`, `setCount` ← label `write`
- Calling `setCount()` → `mutates read` → reset narrowing on `count`

**Advantages:**
- More readable than index-based `mutates [0]`: `mutates read` vs `mutates [0]`
- Labels are already part of TypeScript's named tuple syntax
- Self-documenting — the type declaration explains what's invalidated

**Disadvantages:**
- Requires named tuple labels (not all tuples have them)
- Same destructuring provenance tracking requirement as Approach A
- Labels are optional in TypeScript — unlabeled tuples would fall back to indices
- What if the tuple is used without destructuring? `sig[1](undefined)` must still invalidate `sig[0]` narrowing

**Implementation complexity:** ~300-500 LOC (same as Approach A)

**Verdict:** Best refinement of Approach A. Use labels when available, fall back to indices.

---

### Approach E: Heuristic Inference from Destructuring Origin

Instead of explicit annotations, the compiler detects that two variables came from the same factory call and applies conservative invalidation:

```ts
const [count, setCount] = createSignal<number | undefined>(0);

// Compiler detects: count and setCount are from the same tuple destructuring
// Any call to setCount() conservatively invalidates all narrowing on count
```

**How it works:**
- CFA tracks destructuring provenance: which factory call produced each binding
- When any tuple sibling is called, narrowing on all other siblings from the same tuple is reset
- No annotations needed on the return type — purely flow-based

**Advantages:**
- Zero annotation burden — works automatically for all tuple-destructured APIs
- Backward compatible — existing SolidJS code gets safer narrowing without type changes
- Simple mental model: "variables from the same tuple are linked"

**Disadvantages:**
- Overly conservative: calling ANY sibling function invalidates ALL siblings. In `[a, b, c] = factory()`, calling `b()` would reset narrowing on both `a` and `c`, even if `b` doesn't affect them
- No opt-in/opt-out — the heuristic applies to ALL tuple destructuring, including cases where it's unnecessary
- Not erasure-compatible in spirit — the narrowing behavior depends on runtime variable relationships, not declared types
- Doesn't work for non-destructured usage: `const sig = createSignal(0); sig[1](undefined);`
- Breaks the principle that type annotations are the source of truth for narrowing behavior

**Implementation complexity:** ~200-400 LOC
- Binder: Track destructuring provenance
- Checker/CFA: On any call to a destructured tuple member, reset narrowing on all siblings

**Verdict:** Tempting but wrong. Heuristic narrowing without explicit type annotations has no precedent in TypeScript. The compiler would be "guessing" about side-effect relationships, which violates the explicit-annotations philosophy.

---

### Approach F: Object Pattern with Receiver (`mutates` on Object Methods)

Instead of destructuring into separate bindings, SolidJS could adopt a receiver-scoped API:

```ts
interface Signal<T> {
    stable value(): T;
    set(value: T): void mutates value;
}

function createSignal<T>(value: T): Signal<T>;

const sig = createSignal<number | undefined>(0);
if (sig.value() !== undefined) {
    sig.set(undefined);  // mutates value → resets sig.value() narrowing
    sig.value();         // ✅ Correctly reset
}
```

**How it works:**
- SolidJS ships an alternative API where accessor and setter are methods on the same object
- Existing receiver-scoped `mutates` handles everything — no new mechanism needed

**Advantages:**
- Zero new language features or syntax
- Works with the current implementation today
- Matches Angular Signals' API shape (which already works)

**Disadvantages:**
- Requires SolidJS to change their public API — this is a framework decision, not a TypeScript feature
- Breaks backward compatibility for SolidJS — all existing `const [get, set] = createSignal()` code would need updating
- SolidJS might reject this approach because their separated-binding API is a deliberate design choice (enables fine-grained reactivity tracking)
- Not a solution — it's an avoidance strategy

**Verdict:** Pragmatic workaround but not a solution. SolidJS chose tuple destructuring deliberately. Asking them to change their API is presumptuous. However, SolidJS could ship BOTH patterns:

```ts
// Existing (no stable narrowing):
const [count, setCount] = createSignal(0);

// New alternative (with stable narrowing):
const count = createSignal(0);  // returns Signal<number> with .value() and .set()
```

---

## 4. Recommended Approach: D (Named Tuple Label Reference) with A Fallback

**Primary recommendation: Approach D** — `mutates` with named tuple label reference:

```ts
function createSignal<T>(value: T): [
    read: stable () => T,
    write: (value: T) => void mutates read
];
```

This is the minimal, sound, explicit solution. It:
- Uses the already-proposed `mutates` clause syntax (minimal new surface area)
- Leverages named tuple labels (existing TypeScript feature)
- Requires explicit annotation from the type author (SolidJS maintainers)
- Falls back to index reference for unlabeled tuples: `mutates [0]`
- Works with destructured AND non-destructured access

**Object destructuring extension:**

The same principle extends to object return types:

```ts
function createSignal<T>(value: T): {
    read: stable () => T;
    write: (value: T) => void mutates read;
};

const { read, write } = createSignal(0);
// write() mutates read → invalidates read() narrowing
```

**Implementation roadmap:**

1. **Phase 2.5 (after `mutates` ships):** Add tuple/object label cross-reference support to `mutates` clause
2. Parser: Allow identifiers and `[N]` indices as `mutates` targets when inside a tuple/object type literal
3. Checker/CFA: Track destructuring provenance. When a `mutates label` call occurs, resolve the label to the sibling binding and reset its narrowing
4. Test: SolidJS `createSignal`, React `useState`, and any factory returning `[getter, setter]` pairs

**Estimated complexity:** ~300-500 LOC additional to Phase 2 implementation

## 5. Interaction with Existing Proposals

### 5.1 Keyed Linked Predicates (Phase 9)

Cross-binding invalidation is orthogonal to keyed linked predicates. A SolidJS `createStore` API might need both:

```ts
function createStore<T>(init: T): [
    read: stable (key: keyof T) => T[typeof key],  // keyed accessor
    write: (key: keyof T, value: T[typeof key]) => void mutates read  // keyed setter
];
```

The `mutates read` clause handles cross-binding linkage. Per-key invalidation would be handled by Phase 9's parameter correlation mechanism.

### 5.2 `mutates this` vs `mutates label`

The `mutates` clause gains two reference targets:
- `mutates this` (or bare `mutates`) — receiver-scoped, for Angular/MobX-style objects
- `mutates label` — cross-binding, for SolidJS/React-style tuples

Both use the same `mutates` keyword, keeping the surface area minimal.

### 5.3 React `useState`

React's `useState` hook has the same pattern:

```ts
function useState<T>(initial: T): [
    state: T,        // not a function — property, not stable callable
    setter: (value: T | ((prev: T) => T)) => void
];
```

Note: React's getter is a value, not a function. `stable` doesn't apply to values — it applies to callable getters. React's pattern doesn't benefit from `stable` because `state` is a direct value, not a function call. Narrowing already works on destructured values through existing CFA.

This is important context: the cross-binding problem is specific to **callable getter + callable setter** patterns (SolidJS), not all tuple-destructured APIs.

## 6. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Destructuring provenance is a new CFA concept | Medium | Bounded scope: only tuple/object destructuring, well-defined semantics |
| Label reference syntax novelty | Low | Follows established pattern of `invalidates` referencing identifiers |
| Non-destructured usage (`sig[1]()`) | Medium | Indexed access CFA: `sig[1]` has `mutates [0]`, reset `sig[0]` narrowing |
| Generics interaction | High | `mutates read` inside a generic tuple type needs preservation through instantiation |
| Multiple indirection levels | Medium | `const setter = createSignal(0)[1]; setter()` — how far does provenance track? Limit to direct destructuring |

## 7. Open Questions

1. **Should `mutates` in tuple position be limited to direct destructuring, or should it work through any level of indirection?** Direct destructuring is simpler and covers 99% of real-world usage. Indirect usage (`const list = createSignal(0); list[1]()`) adds significant complexity.

2. **Should React `useState` be annotated with `mutates` even though the getter is a value, not a function?** The cross-binding pattern could theoretically extend to property narrowing: if `setCount(5)` changes `count`, should CFA know? This is a different problem — property narrowing already handles this through assignment detection.

3. **Should SolidJS also ship an object-based API as a "narrowable" alternative?** This is a framework decision, but TypeScript's documentation could recommend it as the simplest path to sound narrowing.

4. **How does `mutates read` compose with `mutates get` in the same type?** If a function mutates both a tuple sibling and a receiver method, can both be listed? E.g., `mutates read, get`?
