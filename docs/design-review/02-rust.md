# Design Review: Rust's Ownership Model vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Rust's approach to aliased mutation with TypeScript-Go's identity CFA system

---

## 1. `&` vs `&mut` Borrowing — Shared Reads vs Exclusive Writes

### Rust's Model

Rust's borrow checker enforces a fundamental invariant at compile time:

> **At any point, you can have either one mutable reference (`&mut T`) OR any number of immutable references (`&T`), but not both.**

This is the "aliased XOR mutable" rule. It prevents data races and iterator invalidation at zero runtime cost:

```rust
let mut v = vec![1, 2, 3];
let r = &v;          // shared borrow — can read
println!("{:?}", r); // OK: reading through shared reference
v.push(4);           // ERROR: cannot mutate while shared reference exists
```

The compiler tracks borrow lifetimes and rejects programs where a mutation could invalidate an outstanding read reference.

### TypeScript-Go's Parallel

The `identity`/`mutator` distinction maps directly onto `&`/`&mut`:

| Rust | TypeScript-Go | Semantic |
|------|--------------|----------|
| `&T` (shared reference) | `identity () => T` | Multiple concurrent reads are safe; value is stable |
| `&mut T` (mutable reference) | `mutator (v: T) => void` | Modifies state; invalidates prior read assumptions |
| Borrow checker error | CFA invalidation | Mechanism for enforcing correctness |

```typescript
interface Store {
    read: identity () => string | undefined;   // ~ &Store → &str
    write: mutator (v: string) => void;         // ~ &mut Store
}
```

### Key Difference: Enforcement Timing and Strictness

Rust **rejects** programs statically if the aliasing rule is violated — the program doesn't compile. TypeScript-Go uses a softer approach: it doesn't reject the program but **invalidates narrowing** (widens types back to their declared type). This difference is fundamental:

| Aspect | Rust | TypeScript-Go |
|--------|------|--------------|
| **Enforcement** | Hard reject (compile error) | Soft invalidation (type widens) |
| **When** | Borrow checker, pre-codegen | CFA during type checking |
| **False negatives** | None (sound modulo `unsafe`) | Possible in dynamic/async code |
| **Developer escape hatch** | `unsafe` block | Store in local variable |
| **Cost of violation** | Cannot compile | Loses narrowing precision |

This softness is appropriate for TypeScript's domain: JavaScript is inherently mutable, dynamic, and concurrent (via event loop). A hard borrow checker would reject most idiomatic JavaScript. The `identity`/`mutator` system gives **precision benefits** to code that follows the pattern, without penalizing code that doesn't.

### The XOR Property

Rust strictly enforces: you can have reads OR writes, never both simultaneously. TypeScript-Go does *not* enforce exclusivity — you can call `read()` and `write()` in any order. Instead, it tracks the **sequence**: a `write()` after a narrowed `read()` invalidates that narrowing. This is a temporal sequencing model rather than Rust's spatial exclusivity model.

```typescript
// TypeScript-Go: temporal invalidation
if (store.read() !== undefined) {
    store.read().toUpperCase();  // OK — narrowing preserved
    store.write("new");          // mutator call
    store.read().toUpperCase();  // ERROR — narrowing invalidated
}
```

```rust
// Rust: spatial exclusivity
let r = &store.data;           // shared borrow
println!("{}", r);             // OK
store.data = String::new();    // ERROR: cannot assign while borrowed
```

---

## 2. Interior Mutability — When the Borrow Checker Is Too Restrictive

### Rust's Escape Hatches

The `&`/`&mut` rule is too restrictive for many real-world patterns. Rust provides **interior mutability** types that allow mutation through shared references, deferring the aliasing check to runtime:

| Type | Check | Cost | Use Case |
|------|-------|------|----------|
| `Cell<T>` | No check (Copy types only) | Zero overhead | Simple values, flags, counters |
| `RefCell<T>` | Runtime borrow check | Small overhead | Single-threaded mutable borrows |
| `Mutex<T>` | OS-level lock | Lock overhead | Thread-safe mutation |
| `RwLock<T>` | Read-write lock | Lock overhead | Many readers, few writers |
| `AtomicT` | Hardware atomics | Atomic overhead | Lock-free concurrent access |

```rust
use std::cell::RefCell;

struct Store {
    data: RefCell<Option<String>>,
}

impl Store {
    fn read(&self) -> Option<String> {     // &self — shared reference!
        self.data.borrow().clone()          // runtime borrow check
    }
    fn write(&self, v: String) {           // &self — still shared!
        *self.data.borrow_mut() = Some(v); // runtime borrow check
    }
}
```

### Relevance to TypeScript-Go

Interior mutability is Rust's admission that static aliasing analysis cannot model all valid programs. TypeScript-Go faces an analogous situation:

1. **Signals** are interior-mutable by nature — they present a stable read interface (`identity`) while allowing mutation through a different surface (`mutator`). This is exactly `RefCell` semantics: mutation through a "shared" (non-`mut`) interface.

2. **The `links` clause** is TypeScript-Go's answer to the same problem Rust solves with typed wrappers. Where Rust uses `RefCell` to encapsulate the "which data is actually mutated" question, `links` explicitly declares which identity endpoints a mutator affects.

3. **Runtime vs static**: Rust's `RefCell` panics at runtime if aliasing rules are violated. TypeScript-Go's CFA loses precision. Both are "soft" relative to the fully static `&`/`&mut` — but TypeScript-Go's softness is entirely at the type level with no runtime consequences.

### The `Cell` Parallel

`Cell<T>` is particularly interesting because it allows mutation without any runtime check, for `Copy` types. The trade-off is that you can never get a reference to the inner value — you can only `get()` (copy out) or `set()` (copy in). This is almost exactly the signal pattern:

```rust
use std::cell::Cell;

let signal = Cell::new(42);
let value = signal.get();   // copy out — like identity () => T
signal.set(99);             // copy in — like mutator (v: T) => void
// `value` is still 42 — set didn't affect it
```

The signal pattern naturally avoids aliasing issues because each `get()` returns an independent value, not a reference. TypeScript-Go's `identity` modifier documents this guarantee at the type level.

---

## 3. Lifetime Annotations — `'a` Lifetimes vs `links`

### Rust Lifetimes

Rust lifetime annotations express **how long references remain valid** and **which references are related**:

```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

The `'a` annotation says: "the returned reference lives at least as long as both inputs." The compiler uses this to prevent dangling references.

Lifetimes also express **dependency relationships**:

```rust
struct Parser<'input> {
    source: &'input str,  // Parser borrows from input
}
// Parser cannot outlive its input source
```

### TypeScript-Go `links`

The `links` clause expresses **invalidation relationships** between mutators and identity endpoints:

```typescript
interface Store {
    identity user(): User | undefined;
    identity settings(): Settings | undefined;

    mutator setUser(v: User) links user;
    mutator resetAll() links user, settings;
}
```

### Comparison Table

| Aspect | Rust `'a` | TypeScript-Go `links` |
|--------|-----------|----------------------|
| **What it expresses** | "Reference A lives as long as B" | "Mutator A invalidates identity B" |
| **Direction** | Constrains validity duration | Constrains narrowing scope |
| **Granularity** | Per-reference | Per-endpoint |
| **Default** | Elision rules infer common cases | Heuristic tiers infer common cases |
| **Explicit form** | `fn foo<'a>(x: &'a T) -> &'a U` | `mutator fn() links endpoint1, endpoint2` |
| **Checked at** | Compile time (borrow checker) | Type-check time (CFA) |
| **Failure mode** | Compile error | Narrowing loss |

### Structural Parallel

Both are **relationship declarations** that the compiler uses to propagate invalidation:

- In Rust, when a lifetime `'a` ends, all references tied to `'a` become invalid.
- In TypeScript-Go, when a mutator with `links read` is called, the narrowing on `read()` becomes invalid.

Both also have **inference/elision** for common cases:

```rust
// Rust lifetime elision: compiler infers 'a
fn first_word(s: &str) -> &str { ... }
// Equivalent to: fn first_word<'a>(s: &'a str) -> &'a str
```

```typescript
// TypeScript-Go heuristic inference: compiler infers links
interface Simple {
    identity read(): T;
    set(v: T): void;  // Tier 1 heuristic infers this mutates read
}
```

The key insight: both systems default to inference for simple cases and require explicit annotations for complex relationship graphs. Rust's elision rules handle single-reference functions; TypeScript-Go's Tier 1 heuristics handle single-endpoint declarations. Multi-reference/multi-endpoint cases require explicit annotation in both.

---

## 4. Pattern Matching and Narrowing — `match` + `enum` vs Type Guards

### Rust's Approach

Rust uses algebraic data types (`enum`) with exhaustive pattern matching:

```rust
enum Shape {
    Circle(f64),
    Rectangle(f64, f64),
}

fn area(shape: &Shape) -> f64 {
    match shape {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Rectangle(w, h) => w * h,
        // exhaustive — compiler errors if a variant is missing
    }
}
```

Key properties:
- **Exhaustiveness**: The compiler ensures all variants are handled.
- **Irrefutability**: `match` destructures in-place — no cast needed.
- **No invalidation concern**: Rust's borrow rules prevent the matched value from changing during the match body.

### TypeScript's Narrowing

TypeScript narrows through control flow analysis:

```typescript
type Shape = { kind: "circle"; radius: number } | { kind: "rect"; w: number; h: number };

function area(shape: Shape): number {
    if (shape.kind === "circle") {
        return Math.PI * shape.radius ** 2;  // narrowed to circle
    } else {
        return shape.w * shape.h;            // narrowed to rect
    }
}
```

### The Stability Problem

Rust doesn't have a narrowing stability problem because:
1. **Values are moved or borrowed** — if `shape` is borrowed immutably, no one can change it.
2. **Pattern matching binds values** — `Shape::Circle(r)` extracts `r` by value or reference, not by repeated access.

TypeScript has the stability problem because:
1. **Repeated access** — `shape.kind` is re-evaluated conceptually (though properties are stable, function calls are not).
2. **No ownership** — anyone can mutate `shape` at any time.

The `identity` modifier bridges this gap for function calls. It tells the compiler: "treat this function call like a property access for narrowing purposes — the value is stable between calls in the absence of mutation."

### Discriminated Unions and `identity`

An important use case for `identity` is discriminated unions through function calls:

```typescript
interface QueryResult<T> {
    identity isSuccess(): boolean;
    identity data(): T | undefined;
}

function useQuery(): QueryResult<User>;

const q = useQuery();
if (q.isSuccess()) {
    q.data(); // could be narrowed based on discriminant relationship
}
```

Rust handles this naturally through `enum`:

```rust
enum QueryResult<T> {
    Success(T),
    Error(String),
}

match query_result {
    QueryResult::Success(data) => { /* data is T */ }
    QueryResult::Error(e) => { /* e is String */ }
}
```

The Rust model is more expressive here because the `match` destructures the entire value at once. TypeScript-Go's `identity` allows individual endpoints to be narrowed but doesn't natively link discriminant relationships between endpoints (that would require additional type system work beyond `identity`/`mutator`/`links`).

---

## 5. `Fn`, `FnMut`, `FnOnce` — The Direct Parallel

### Rust's Closure Trait Hierarchy

Rust has three closure traits forming a strict hierarchy:

```
Fn ⊂ FnMut ⊂ FnOnce
```

| Trait | Captures | Can call | Parallel to |
|-------|----------|----------|------------|
| `Fn(&self)` | By shared reference | Multiple times, no mutation | `identity` |
| `FnMut(&mut self)` | By mutable reference | Multiple times, may mutate | `mutator` |
| `FnOnce(self)` | By value (moves) | Exactly once, consumes | (no direct parallel) |

```rust
fn apply_fn(f: &dyn Fn() -> i32) -> i32 {
    // f cannot mutate its captures — safe to call multiple times
    // and reason about return value stability
    f()
}

fn apply_fn_mut(f: &mut dyn FnMut() -> i32) -> i32 {
    // f may mutate its captures — calling changes state
    f()
}
```

### The Exact Parallel

This is the most direct analogy in the entire comparison:

| Rust | TypeScript-Go | Guarantee |
|------|--------------|-----------|
| `Fn` | `identity` | Calling does not mutate observable state; return value is stable |
| `FnMut` | `mutator` | Calling may mutate state; invalidates prior assumptions |
| `FnOnce` | — | Consumes the callable; no TypeScript parallel |

The `Fn`/`FnMut` distinction tells Rust's compiler the same thing `identity`/`mutator` tells TypeScript-Go's checker:

```rust
// Rust: compiler knows f won't change between calls
fn narrow_stable<F: Fn() -> Option<String>>(f: F) {
    if let Some(s) = f() {
        // f() would still return Some — Fn guarantees no mutation
        // (though Rust doesn't actually narrow across calls this way)
    }
}

// Rust: compiler knows f might change between calls
fn narrow_unstable<F: FnMut() -> Option<String>>(mut f: F) {
    if let Some(s) = f() {
        // f() might return None now — FnMut allows state changes
    }
}
```

### Important Nuance: Rust Doesn't Actually Narrow Across `Fn` Calls

Even though `Fn` guarantees no mutation of captures, Rust does *not* narrow return types across calls. Each call to `f()` in Rust produces an independent `Option<String>` that must be matched independently. The `Fn` trait guarantees **no side effects on captured state**, not **deterministic return values**.

TypeScript-Go's `identity` makes a stronger claim: not just "this function doesn't mutate" but "this function returns a stable value." This is closer to Haskell's purity guarantee than Rust's `Fn`.

```typescript
// TypeScript-Go: identity implies return value stability
declare const f: identity () => string | undefined;
if (f() !== undefined) {
    f().toUpperCase(); // OK — identity guarantees stable return
}
```

```rust
// Rust: Fn does NOT imply return value stability
// This is NOT valid Rust reasoning:
let f: Box<dyn Fn() -> Option<String>> = ...;
if let Some(_) = f() {
    f().unwrap(); // NOT guaranteed safe — f could return None
}
```

This is a key design insight: `identity` is *stronger* than `Fn`. It combines `Fn`'s "no mutation" guarantee with a deterministic return guarantee. In Rust terms, `identity` would be something like `Fn + Pure + Deterministic`.

---

## 6. `Pin` and `Unpin` — Stability Guarantees

### Rust's Pin

`Pin<P>` is a wrapper that prevents the pointed-to value from being moved in memory. It was introduced for self-referential types (primarily async futures):

```rust
use std::pin::Pin;
use std::marker::PhantomPinned;

struct SelfRef {
    data: String,
    ptr: *const String,  // points to self.data
    _pin: PhantomPinned,
}

// Once pinned, `data` can never move, so `ptr` remains valid
let pinned: Pin<Box<SelfRef>> = ...;
```

Key properties:
- `Pin` guarantees **positional stability** — the value won't move in memory.
- `Unpin` is an auto-trait; types that are `Unpin` can be freely moved even inside `Pin`.
- `Pin` enables **self-referential structures** that would otherwise be unsound.

### Conceptual Parallel to `identity`

| Rust `Pin` | TypeScript-Go `identity` |
|-----------|------------------------|
| Value stays at same memory address | Function returns same value (in stable flow) |
| Prevents moves that would invalidate pointers | Prevents state changes that would invalidate narrowing |
| `!Unpin` opts into pinning guarantee | `identity` modifier opts into stability guarantee |
| `Pin::new_unchecked` is `unsafe` escape | No escape — `identity` is a typed contract |

The parallel is **conceptual** but illuminating:
- Both are **stability markers** that constrain what can happen to a value.
- Both exist to make **self-referential patterns safe** (Pin: memory refs; identity: type narrowing refs).
- Both distinguish between types that need stability and those that don't (Unpin/non-identity).

### Where the Analogy Breaks Down

`Pin` is about **physical memory location** — a very concrete, low-level guarantee. `identity` is about **semantic value stability** — a higher-level, type-system concept. Rust's `Pin` prevents mem::swap, mem::replace, and moves. TypeScript-Go's `identity` prevents the checker from assuming a function call might return a different type.

The relationship is also inverted in some sense: `Pin` restricts operations on the *container* to protect internal references. `identity` restricts the *interpretation* of call results to enable external narrowing.

---

## 7. What TypeScript-Go Could Learn — A Borrow-Inspired Alternative?

### Could TypeScript Use Rust's Full Model?

No. The fundamental mismatch is:

1. **JavaScript has no ownership**. Values are garbage-collected, freely aliased, and shared by reference. There is no concept of "moving" a value.
2. **JavaScript is single-threaded** (with async). There are no data races in the Rust sense — but there are mutation interleaving issues through the event loop.
3. **JavaScript APIs are mutation-heavy**. The DOM, Node.js APIs, and most libraries freely mutate shared state.

A full borrow checker for TypeScript would reject virtually all existing JavaScript code. This is a non-starter.

### What a Simpler Borrow-Inspired Model Might Look Like

A minimal borrow-inspired model for TypeScript could:

1. **Track "read regions"** — regions of code between an identity read and the next mutation, analogous to borrow regions.
2. **Treat mutator calls as "borrow end"** — when a mutator is called, end all active read regions for linked endpoints.
3. **Use `links` as lifetime constraints** — specify which read regions a mutator terminates.

This is essentially what TypeScript-Go already does. The `identity`/`mutator`/`links` system is a borrow-checker-inspired design adapted for TypeScript's constraints:

| Concept | Rust | TypeScript-Go |
|---------|------|--------------|
| Read region | Shared borrow lifetime `'a` | Flow between identity read and mutator call |
| Write event | Mutable borrow start | Mutator call |
| Region termination | Borrow checker error / lifetime end | CFA invalidation |
| Relationship declaration | Lifetime parameter `'a` | `links` clause |
| Default inference | Lifetime elision | Heuristic tiers |

### Design Trade-offs in Current Approach

**Advantages of TypeScript-Go's approach over Rust-style:**

1. **Gradual adoption**: Existing code works unchanged. `identity`/`mutator` are opt-in annotations that improve precision.
2. **No learning cliff**: Developers don't need to understand lifetimes, ownership, or the borrow checker. The annotations are intuitive: "this reads stably" / "this writes."
3. **Soft failure**: Getting it wrong (missing annotation) means losing narrowing, not failing to compile.
4. **Compatible with JavaScript**: Works with mutation-heavy APIs, closures, and async patterns.

**Disadvantages / things Rust does better:**

1. **No exclusivity guarantee**: TypeScript-Go can't prevent aliased mutation — only track its effects. Rust prevents it entirely.
2. **Heuristic uncertainty**: The tiered heuristic system adds complexity and potential for surprising behavior. Rust's rules are deterministic.
3. **No inter-procedural tracking**: TypeScript-Go's CFA is local. Rust's borrow checker spans the full program. A function that captures an identity accessor and a mutator in a closure — TypeScript-Go may not track the relationship.
4. **Runtime unsoundness**: TypeScript-Go trusts the `identity` annotation. If a function marked `identity` actually has side effects, narrowing will be unsound. Rust's `Fn` trait is structurally enforced — you *cannot* mutate captured state through `Fn`.

### Could `links` Be Inferred More Aggressively?

Rust infers lifetimes through elision rules. TypeScript-Go infers mutator impact through heuristic tiers. Could it go further?

Potential: **Structural link inference** — if a declaration has exactly one `identity` endpoint, all methods with parameters on the same interface are implicitly `mutator links <that endpoint>`. This is analogous to Rust's single-lifetime elision rule (if there's only one input lifetime, output gets it automatically).

Risk: This would be unsound for methods that genuinely don't affect the identity endpoint. The Tier 1 heuristic system already handles this case more conservatively but more safely.

### Recommendations from the Rust Comparison

1. **The `identity`/`mutator` split is well-motivated**: It directly mirrors `Fn`/`FnMut`, the most battle-tested API contract distinction in a systems language. This validates the design direction.

2. **`links` solves a real problem Rust doesn't have**: Rust's ownership model means mutations are structurally scoped — you know exactly what data a `&mut` can reach. TypeScript has no such structural boundaries, so `links` provides explicit scoping that Rust gets for free.

3. **Keep the soft failure model**: Rust's hard errors are appropriate for systems programming. TypeScript's "lose precision, don't reject" model is correct for a gradually-typed language over JavaScript.

4. **Consider soundness documentation**: Rust's `Fn` trait is *structurally* enforced. TypeScript-Go's `identity` is *declaratively* trusted. The spec should explicitly document that `identity` is an unchecked assertion (like type assertions) and violations produce unsound narrowing. This matches how TypeScript handles other trust-the-developer features (`as`, `!`).

5. **The heuristic tiers are the right complexity trade-off**: Rust's determinism comes at the cost of annotation burden (lifetimes are notoriously difficult). TypeScript-Go's heuristics reduce annotation burden at the cost of some unpredictability. For a language that targets JavaScript developers, this is the correct trade-off.

6. **`FnOnce` has no analogue, and that's OK**: JavaScript closures are always reusable. There's no "consume the callable" pattern. The two-level distinction (`identity`/`mutator`) is sufficient.

---

## 8. Summary Comparison Matrix

| Dimension | Rust | TypeScript-Go | Verdict |
|-----------|------|--------------|---------|
| **Read/write distinction** | `&T` / `&mut T` | `identity` / `mutator` | Directly parallel |
| **Exclusivity** | Enforced (aliased XOR mutable) | Not enforced (temporal tracking) | Different domains |
| **Failure mode** | Compile error | Narrowing loss | TypeScript-Go appropriate for JS |
| **Relationship tracking** | Lifetime parameters `'a` | `links` clause | Analogous purpose |
| **Inference** | Lifetime elision | Heuristic tiers | Both avoid annotation burden |
| **Interior mutability** | `Cell`/`RefCell`/`Mutex` | Signals (the primary use case) | Signals *are* interior mutability |
| **Closure contracts** | `Fn`/`FnMut`/`FnOnce` | `identity`/`mutator` | Most direct parallel |
| **Stability guarantee** | `Pin<T>` | `identity` modifier | Conceptual parallel |
| **Narrowing** | `match` exhaustive patterns | CFA type narrowing | Different mechanisms, same goal |
| **Soundness** | Structural (`unsafe` escape) | Declarative (trust developer) | TypeScript-Go consistent with TS philosophy |

## 9. Conclusion

TypeScript-Go's `identity`/`mutator`/`links` system is a well-designed adaptation of Rust's ownership principles for a dynamically-typed, garbage-collected language. The core insight — distinguishing between reads that can be trusted and writes that invalidate trust — is shared between both systems. The key difference is enforcement strictness: Rust prevents aliased mutation; TypeScript-Go tracks its effects on type narrowing.

The most valuable Rust analogy is the `Fn`/`FnMut` trait hierarchy, which provides direct precedent for the `identity`/`mutator` distinction in a mature, widely-used language. The `links` clause addresses a problem unique to TypeScript (lack of structural ownership boundaries) with an approach reminiscent of lifetime annotations but simpler and more targeted.

The design correctly prioritizes gradual adoption and soft failure over Rust-style strictness, consistent with TypeScript's philosophy of being "JavaScript with types" rather than "a safe systems language."
