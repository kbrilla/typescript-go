# Design Review: Swift's Value Semantics, Mutating Methods, and Property Wrappers vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Swift's approach to mutation tracking, value stability, and reactive state management with TypeScript-Go's identity CFA system

---

## 1. `mutating` Keyword — Swift's Mutation Contract on Value Types

### Swift's Model

Swift enforces a structural distinction between mutating and non-mutating methods on value types (structs and enums). Methods that modify `self` must be explicitly marked `mutating`:

```swift
struct Counter {
    var count: Int = 0

    func currentCount() -> Int {   // non-mutating: cannot modify self
        return count
    }

    mutating func increment() {    // mutating: allowed to modify self
        count += 1
    }
}
```

The compiler enforces this at multiple levels:

1. **Calling site**: You cannot call a `mutating` method on a `let` constant:

```swift
let c = Counter()
c.increment()  // ERROR: cannot use mutating member on immutable value
```

2. **Within the method body**: A non-mutating method cannot assign to `self` or its properties:

```swift
struct Pair {
    var x: Int
    var y: Int

    func broken() {
        x = 10  // ERROR: cannot assign to property: 'self' is immutable
    }
}
```

3. **Protocol conformance**: Protocols can declare methods as `mutating`. Non-mutating protocol requirements are a *stronger* contract — conforming types can satisfy them with either a mutating or non-mutating implementation, but a `mutating` protocol requirement must be implemented as `mutating` by value types:

```swift
protocol Resettable {
    mutating func reset()       // value types must mark this mutating
    func currentValue() -> Int  // guaranteed non-mutating
}

struct State: Resettable {
    var value: Int = 0

    mutating func reset() { value = 0 }      // mutating — OK
    func currentValue() -> Int { return value } // non-mutating — OK
}

class RefState: Resettable {
    var value: Int = 0

    func reset() { value = 0 }            // class: no `mutating` needed
    func currentValue() -> Int { return value }
}
```

Classes do not need `mutating` because they are reference types — mutation through a reference doesn't change the reference itself. This is a crucial distinction that maps directly to TypeScript-Go's domain.

### Direct Comparison with `mutator`

| Aspect | Swift `mutating` | TypeScript-Go `mutator` |
|--------|-----------------|------------------------|
| **Applies to** | Methods on value types (struct/enum) | Function types (callable signatures) |
| **Semantic meaning** | "This method modifies self" | "This call invalidates identity narrowing" |
| **Enforcement** | Structural — compiler checks body | Declarative — trusted annotation |
| **Default** | Non-mutating (cannot modify self) | Non-mutating (identity calls pass through) |
| **Protocol/interface** | Protocol declares `mutating` requirement | Interface declares `mutator` on callable type |
| **Reverse direction** | Non-mutating guaranteed by absence | `identity` explicitly marks stable reads |

The critical difference is enforcement depth:

- Swift's `mutating` is **structurally verified**: the compiler checks that non-mutating methods don't write to `self`. If you try to modify a stored property in a non-mutating method, the compiler emits an error.

- TypeScript-Go's `mutator` is **declaratively trusted**: the annotation informs CFA but the checker does not verify that the function body actually performs mutation (or that non-`mutator` functions don't mutate). This follows TypeScript's general philosophy — `as`, `!`, and type assertions are similarly trusted.

### The `var` vs `let` Gate

Swift's `let`/`var` distinction at the call site acts as a secondary gate that TypeScript-Go doesn't have:

```swift
let counter = Counter()     // immutable binding
counter.increment()         // ERROR — can't mutate through let

var counter2 = Counter()    // mutable binding
counter2.increment()        // OK
```

In TypeScript-Go, there's no `let`/`var` distinction for objects (both `let` and `const` allow property mutation). The `mutator` annotation operates entirely at the type level, not at the binding level. A TypeScript-Go equivalent would require `readonly` to propagate deeply — which TypeScript's structural type system doesn't enforce transitively.

### Protocols and the Non-Mutating Contract

Swift protocol methods without `mutating` carry a **guarantee**: no conforming value type can modify `self` through that method. This is meaningful because:

1. Generic code parameterized by a protocol can reason about which calls are safe.
2. The guarantee is structural, not heuristic.

```swift
func readTwice<T: Resettable>(item: T) -> Int {
    let a = item.currentValue()   // non-mutating — guaranteed safe
    let b = item.currentValue()   // still safe — nothing could have mutated
    return a + b                  // a == b is guaranteed for pure value types
}
```

TypeScript-Go's `identity` provides the same guarantee at a different level — not "this function doesn't modify self" but "this function returns a stable value." The guarantee is stronger in one sense (return value stability, not just non-mutation) but weaker in another (declarative, not structural).

---

## 2. Value Types vs Reference Types — The Aliasing Problem

### Swift's Value Semantics

Swift draws a hard line between value types (struct, enum, tuple) and reference types (class). Value types have **independent copies** — assigning or passing a struct creates a new copy:

```swift
struct Point {
    var x: Double
    var y: Double
}

var a = Point(x: 1, y: 2)
var b = a           // b is an independent copy
b.x = 99           // doesn't affect a
print(a.x)         // 1 — a is unchanged
```

This eliminates aliasing by design. When you narrow or reason about a value type, you know no other code path can modify it behind your back.

### Reference Types and Aliasing

Classes in Swift are reference types — assignment and parameter passing share the same instance:

```swift
class PointRef {
    var x: Double
    var y: Double
    init(x: Double, y: Double) { self.x = x; self.y = y }
}

var a = PointRef(x: 1, y: 2)
var b = a           // b points to the same instance
b.x = 99           // also modifies a!
print(a.x)         // 99 — aliased mutation
```

Classes reintroduce the same aliasing problems that TypeScript-Go faces — any reference to the object could mutate it, invalidating prior reads.

### Why TypeScript Lives in "Reference Type" Territory

JavaScript objects are always reference types (like Swift classes, not structs). This means TypeScript-Go faces the aliasing problem everywhere:

```typescript
interface Point {
    x: number;
    y: number;
}

const a: Point = { x: 1, y: 2 };
const b = a;        // b aliases a
b.x = 99;           // also modifies a!
```

Swift's solution — make things value types by default — isn't available to TypeScript because JavaScript's object model is fundamentally reference-based. The `identity`/`mutator`/`links` system is TypeScript-Go's way of getting *some* of the reasoning benefits of value semantics without changing the runtime model:

| Property | Swift Structs | TypeScript-Go `identity` |
|----------|--------------|-------------------------|
| **Guarantees no aliased mutation** | Yes — independent copies | No — only tracks narrowing effects |
| **Enables local reasoning** | Yes — value can't change externally | Partially — within a flow region |
| **Mechanism** | Copy semantics | CFA fact preservation |
| **Cost** | Copies (optimized by COW) | None (type-level only) |
| **Scope** | All operations on the value | Only identity-annotated call results |

### The Hybrid: Swift's `Sendable` Protocol

Swift 5.5+ introduced `Sendable` to mark types safe to share across concurrency boundaries. `Sendable` structs (value types) are trivially safe. `Sendable` classes must be `final` with only immutable stored properties. This progressive annotation model is similar to TypeScript-Go's approach: existing code works, but adding annotations enables stronger reasoning.

---

## 3. Property Wrappers — `@Published`, `@State`, `@Binding`, `@ObservedObject`

### Swift's Property Wrapper Mechanism

Swift property wrappers (`@propertyWrapper`) allow custom logic for getting and setting property values — providing computed behavior behind a stored-property syntax:

```swift
@propertyWrapper
struct Clamped {
    var wrappedValue: Int {
        didSet { wrappedValue = min(max(wrappedValue, 0), 100) }
    }
    init(wrappedValue: Int) {
        self.wrappedValue = min(max(wrappedValue, 0), 100)
    }
}

struct Settings {
    @Clamped var volume: Int = 50
}

var s = Settings()
s.volume = 200      // clamped to 100
print(s.volume)     // 100
```

The `wrappedValue` accessor is the read/write endpoint. Property wrappers also expose a `projectedValue` (accessed via `$property`), enabling dual interfaces — one for the value (read/write) and one for metadata (stream, binding, publisher).

### SwiftUI's Reactive Property Wrappers

SwiftUI's property wrappers implement the **reactive state management** pattern that TypeScript-Go's `identity`/`mutator` system aims to support:

| Wrapper | Role | Read | Write | Parallel |
|---------|------|------|-------|----------|
| `@State` | Owns local mutable state | `value` | `value = x` | Signal `read()` / `set()` |
| `@Binding` | Two-way reference to parent state | `value` | `value = x` | Derived signal |
| `@Published` | Observable property on class | `value` | `value = x` (triggers notifications) | Signal with subscribers |
| `@ObservedObject` | Observe external `ObservableObject` | properties | property assignment | Computed signal |
| `@StateObject` | Own + observe class instance | properties | property assignment | Signal store |
| `@Environment` | Read-only injected value | `value` | — (read only) | `identity` without `mutator` |

```swift
struct CounterView: View {
    @State private var count = 0    // owned mutable state

    var body: some View {
        VStack {
            Text("Count: \(count)")  // read — stable within render
            Button("Increment") {
                count += 1           // write — triggers re-render
            }
        }
    }
}
```

### The `@State` / Signal Parallel

`@State` in SwiftUI provides semantics remarkably similar to the signal pattern:

```swift
// SwiftUI
@State var count = 0
// read:  count       (property access)
// write: count = 5   (triggers re-render)
```

```typescript
// TypeScript Signals (conceptual)
interface Signal<T> {
    identity (): T;                    // read — stable within CFA scope
    mutator set(value: T): void;       // write — invalidates narrowing
}

const count = signal(0);
// read:  count()
// write: count.set(5)
```

Key difference: SwiftUI's `@State` uses **property syntax** for both read and write, while signals use **call syntax** for read and method syntax for write. This matters for TypeScript-Go because:

1. TypeScript already supports narrowing through property access (getters). The `identity` modifier extends this to call expressions.
2. Swift doesn't need `identity` because `@State` reads are already property accesses — the compiler knows they're stable within a render.
3. Swift's invalidation is **automatic** (the framework re-renders when `@State` changes). TypeScript-Go's invalidation is **CFA-driven** (the type checker widens types after `mutator` calls).

### `@Published` and Change Propagation

`@Published` on `ObservableObject` classes creates a publisher that emits before the value changes:

```swift
class UserModel: ObservableObject {
    @Published var name: String = ""
    @Published var age: Int = 0
}
```

The `@Published` wrapper:
1. **Read**: Returns the current value (like `identity`).
2. **Write**: Sets the new value AND publishes a change notification.
3. **$property**: Exposes a `Publisher` stream (like a signal's subscription API).

In TypeScript-Go terms, `@Published` is a property where reads are `identity` and writes are `mutator links <self>`:

```typescript
// Conceptual TypeScript parallel to @Published
interface ObservableObject {
    identity name(): string;
    mutator setName(v: string): void links name;
}
```

The `links` clause in TypeScript-Go provides the same "which writes affect which reads" information that SwiftUI derives automatically from the `@Published` wrapper's scope (each `@Published` property is independent).

### The `projectedValue` / `$` Pattern

Swift's projected value (`$property`) provides a second access path to the wrapper's internal state:

```swift
struct FormView: View {
    @State var text = ""

    var body: some View {
        // $text is a Binding<String> — two-way reference
        TextField("Enter text", text: $text)
    }
}
```

In TypeScript-Go, the `links` clause serves a different but related purpose — it's metadata about relationships, not a secondary access path. However, the pattern of having both a "value surface" and a "meta surface" is analogous to how `identity` provides the value contract and `links` provides the relationship metadata.

---

## 4. Optional Chaining and Narrowing — `if let`, `guard let`, Optional Binding

### Swift's Optional Handling

Swift's optional type `T?` is an `enum` with two cases: `.some(T)` and `.none`. The language provides multiple unwrapping mechanisms:

```swift
// Optional binding with if let
func greet(_ name: String?) {
    if let n = name {
        print("Hello, \(n)")   // n is String (non-optional)
    }
}

// guard let — early exit pattern
func process(_ data: String?) -> String {
    guard let d = data else {
        return "no data"       // must exit scope
    }
    // d is String for the rest of the function
    return d.uppercased()
}

// Optional chaining
let length = name?.count       // Int? — nil if name is nil

// Nil coalescing
let safe = name ?? "Unknown"   // String — never nil
```

### The Re-Unwrapping Problem

Swift's optional binding creates a **local constant** that captures the unwrapped value at a point in time:

```swift
var value: String? = "hello"

if let v = value {
    print(v)         // "hello" — v is a snapshot
    value = nil      // mutation doesn't affect v
    print(v)         // still "hello" — v is independent
}
```

This works because `if let` creates a new binding, not a narrowing of the original. Swift doesn't narrow `value` itself — it binds the unwrapped result to `v`. The original `value` remains `String?` throughout.

### Compare: TypeScript Narrowing vs Swift Optional Binding

```typescript
// TypeScript: narrows the original variable
let value: string | undefined = "hello";
if (value !== undefined) {
    value.toUpperCase();  // value narrowed to string
    value = undefined;    // re-widens to string | undefined
    value.toUpperCase();  // ERROR: value might be undefined
}
```

```swift
// Swift: creates a separate binding
var value: String? = "hello"
if let v = value {
    v.uppercased()        // OK: v is String
    value = nil           // doesn't affect v
    v.uppercased()        // still OK: v is independent
}
```

TypeScript narrows **in-place** (the variable itself changes type through control flow). Swift creates a **new constant** (the original is unaffected). Both achieve type safety, but through different mechanisms.

### How This Applies to `identity`

The `identity` modifier creates a pattern similar to Swift's optional binding but for function calls:

```typescript
interface Store {
    identity read(): string | undefined;
    mutator write(v: string): void;
}

declare const s: Store;
if (s.read() !== undefined) {
    // TypeScript-Go narrows s.read() in-place — like a stable binding
    s.read().toUpperCase();   // OK — narrowing preserved by identity
    s.write("new");           // mutator invalidates
    s.read().toUpperCase();   // ERROR — narrowing cleared
}
```

In Swift terms, an `identity` call behaves like an implicit `if let` — it creates a "virtual binding" that the type checker treats as stable until a mutation invalidates it.

| Mechanism | What it binds | Invalidated by | Scope |
|-----------|--------------|----------------|-------|
| Swift `if let v = x` | Local constant `v` | Nothing — `v` is independent | Block scope |
| TypeScript narrowing | Variable `x` itself | Reassignment, function calls | Control flow scope |
| TypeScript-Go `identity` | Return type of `f()` | `mutator` calls, receiver writes | CFA flow scope |

### Swift's `guard let` and Early-Exit Narrowing

Swift's `guard let` narrows for the **remainder** of the function, not just a block:

```swift
func process(_ input: String?) -> String {
    guard let value = input else { return "" }
    // value is String for all code below — across the rest of the function
    return value.uppercased()
}
```

TypeScript achieves the same pattern with early returns:

```typescript
function process(input: string | undefined): string {
    if (input === undefined) return "";
    // input is string for all code below
    return input.toUpperCase();
}
```

TypeScript-Go extends this to identity calls:

```typescript
function process(store: Store): string {
    if (store.read() === undefined) return "";
    // store.read() is narrowed to string for remaining flow
    return store.read().toUpperCase();
}
```

The `guard let` parallel shows that TypeScript-Go's identity narrowing is least surprising when used with early-exit patterns — the narrowing flows naturally through the remaining code, just as Swift developers expect.

---

## 5. Combine Framework — Reactive State Management

### Combine's Publisher/Subscriber Model

Apple's Combine framework (a predecessor/companion to SwiftUI's state management) provides reactive streams:

```swift
import Combine

class UserService {
    let nameSubject = CurrentValueSubject<String?, Never>(nil)

    var name: AnyPublisher<String?, Never> {
        nameSubject.eraseToTypePublisher()
    }

    func setName(_ n: String) {
        nameSubject.send(n)      // publish new value
    }
}
```

`CurrentValueSubject<T, E>`:
- **Read**: `.value` property returns current value (synchronous).
- **Write**: `.send(newValue)` updates and publishes.
- **Subscribe**: `.sink { }` receives future values asynchronously.

### Parallel to Signal + `identity`/`mutator`

| Combine | TypeScript-Go | Semantic |
|---------|--------------|----------|
| `subject.value` (read) | `identity read(): T` | Stable current value access |
| `subject.send(v)` (write) | `mutator set(v: T): void` | Mutation that triggers subscribers |
| `.sink { }` (subscribe) | Effect/subscription | Async reaction to changes |
| `CurrentValueSubject<T?, Never>` | `Signal<T \| undefined>` | Nullable reactive value |

```swift
// Combine pattern
let subject = CurrentValueSubject<String?, Never>(nil)
if let name = subject.value {
    // name is String — unwrapped
    print(name.uppercased())
}
subject.send("Alice")
// previous binding 'name' unaffected (value semantics)
// but subject.value is now "Alice"
```

```typescript
// TypeScript-Go parallel
interface Subject<T> {
    identity value(): T;
    mutator send(v: T): void links value;
}

declare const subject: Subject<string | undefined>;
if (subject.value() !== undefined) {
    subject.value().toUpperCase();   // narrowed via identity
}
subject.send("Alice");               // mutator links value — invalidates
```

### `@Published` vs Signal: Invalidation Scope

A crucial design parallel: Combine's `@Published` provides **per-property** publisher semantics. Setting `name` doesn't trigger `age` subscribers:

```swift
class Model: ObservableObject {
    @Published var name: String = ""   // independent publisher
    @Published var age: Int = 0        // independent publisher
}
```

TypeScript-Go's `links` clause provides the same per-endpoint granularity:

```typescript
interface Model {
    identity name(): string;
    identity age(): number;
    mutator setName(v: string): void links name;     // only invalidates name
    mutator setAge(v: number): void links age;        // only invalidates age
    mutator resetAll(): void links name, age;         // invalidates both
}
```

Without `links`, TypeScript-Go conservatively invalidates all identity endpoints on the receiver — equivalent to Combine's `objectWillChange` publisher that fires for *any* change on the `ObservableObject`. The `links` clause is the fine-grained equivalent of having independent `@Published` properties.

### Combine Operators and the Invalidation Graph

Combine allows operators to transform and combine publishers:

```swift
let fullName = Publishers.CombineLatest(firstName, lastName)
    .map { "\($0) \($1)" }
```

This creates a dependency graph: `fullName` depends on both `firstName` and `lastName`. In TypeScript-Go terms, a mutator that links `firstName` should also implicitly invalidate any computed/derived value built from it — but CFA currently doesn't model transitive dependencies. This is an area where Combine's explicit dependency graph is more expressive than `links`, which is strictly one-level.

---

## 6. Protocol Witnesses and Type Erasure — Read/Write Contracts

### Protocol-Based Contracts

Swift protocols define behavioral contracts. The mutating/non-mutating distinction in protocols creates a formal read/write API:

```swift
protocol ReadableStore {
    associatedtype Value
    func read() -> Value         // non-mutating: read contract
}

protocol WritableStore: ReadableStore {
    mutating func write(_ v: Value)  // mutating: write contract
}
```

This protocol hierarchy directly mirrors the `identity`/`mutator` distinction:

```typescript
// TypeScript-Go equivalent
interface ReadableStore<T> {
    identity read(): T;
}

interface WritableStore<T> extends ReadableStore<T> {
    mutator write(v: T): void links read;
}
```

### Type Erasure: `AnyPublisher`, `any` Protocol Types

Swift's `any` protocol type (existential) and type erasure wrappers (`AnyPublisher`, `AnySequence`) hide concrete types behind protocol interfaces:

```swift
func makePublisher() -> AnyPublisher<String, Never> {
    // concrete type is erased — callers only know the protocol interface
    Just("hello").eraseToAnyPublisher()
}
```

When a concrete type is erased to a protocol, the `mutating`/non-mutating contract is **preserved**:

```swift
protocol Toggleable {
    mutating func toggle()
    func isOn() -> Bool
}

// Using as existential: let t: any Toggleable
// t.isOn() — OK (non-mutating)
// t.toggle() — ERROR unless t is var, because mutating through existential
```

This maps to TypeScript-Go: when an interface declares `identity read()` and `mutator write()`, any expression typed as that interface carries the read/write contract regardless of the concrete implementation. The modifier is part of the interface contract, not just the implementation.

### Witness Tables and Method Dispatch

Swift's protocol witness tables are the compiled representation of protocol conformance — a vtable mapping protocol methods to concrete implementations. The mutating/non-mutating distinction affects witness table layout because mutating methods need to pass `self` by mutable pointer (inout) while non-mutating methods pass by immutable reference.

TypeScript-Go's `identity`/`mutator` modifiers don't affect runtime dispatch (they're erased), but they do affect the type checker's method dispatch for CFA purposes. The conceptual parallel holds: both systems use the mutating/non-mutating distinction to determine what operations are safe at a given call site.

---

## 7. Copy-on-Write — Swift's COW Optimization and Identity Stability

### How COW Works

Swift uses copy-on-write for standard library collections (`Array`, `Dictionary`, `Set`, `String`). The value appears to be copied on assignment, but the actual memory is shared until mutation:

```swift
var a = [1, 2, 3]
var b = a           // shares underlying storage (reference count = 2)
// No copy yet — both point to same buffer

b.append(4)         // NOW a copy happens — b gets its own buffer
// a = [1, 2, 3], b = [1, 2, 3, 4]
```

The `isKnownUniquelyReferenced` function enables custom COW implementations:

```swift
final class Storage<T> {
    var value: T
    init(_ v: T) { value = v }
}

struct COWBox<T> {
    private var storage: Storage<T>

    var value: T {
        get { storage.value }
        set {
            if !isKnownUniquelyReferenced(&storage) {
                storage = Storage(newValue)  // copy on write
            } else {
                storage.value = newValue     // mutate in place
            }
        }
    }
}
```

### COW and Identity Stability

COW has an interesting relationship with "identity" in the physical sense:

1. **Before mutation**: Multiple variables share the same underlying storage. They have **shared identity** — the same bits in memory.
2. **After mutation**: The mutating copy gets its own storage. The identities **diverge**.

This parallels TypeScript-Go's `identity` narrowing:

1. **Before mutator call**: An `identity` function's narrowed type is stable across multiple reads. The type system treats successive calls as returning "the same value."
2. **After mutator call**: The narrowing is invalidated. The type system treats the next read as potentially different.

| Phase | Swift COW | TypeScript-Go `identity` |
|-------|-----------|-------------------------|
| **Before mutation** | Shared storage; reads return same data | Narrowing preserved; reads return narrowed type |
| **Mutation event** | Copy triggered; new storage allocated | `mutator` call; narrowing invalidated |
| **After mutation** | Independent copies; original unchanged | Fresh read required; type widened to declared type |

### The "Identity" of a Value

Swift developers sometimes use `===` (identity comparison for reference types) to check whether COW has triggered a copy:

```swift
var a = NSMutableArray(array: [1, 2, 3])
var b = a
print(a === b)     // true — same reference

b = a.mutableCopy() as! NSMutableArray
print(a === b)     // false — different references
```

TypeScript-Go's `identity` modifier is about a different kind of identity — **semantic identity** (the return value is conceptually the same) rather than **referential identity** (the same object in memory). But both use the word "identity" to mean "this thing stays the same until something explicitly changes it."

### COW as Implementation Strategy for Signals

An interesting observation: signals could internally use COW-like strategies. A signal's backing store could be shared across subscribers until a write occurs, then copy for pending reads. This is how some reactive systems optimize multi-subscriber scenarios. The `identity`/`mutator` annotations would map perfectly:

- `identity read()` — access shared COW storage (no copy needed).
- `mutator set(v)` — trigger COW copy-and-update cycle.

The type system doesn't need to model this internal optimization, but the conceptual alignment shows that `identity` and COW address the same fundamental concern: making reads cheap and stable until writes force divergence.

---

## 8. Syntax Ideas — Could TypeScript Use Swift's `mutating`/Non-Mutating Pattern?

### Swift's Syntax Applied to TypeScript

What if TypeScript used a Swift-like syntax where non-mutating is the default and `mutating` is the explicit marker?

```typescript
// Hypothetical: Swift-style syntax for TypeScript
interface Store<T> {
    (): T;                              // non-mutating (default) — like identity
    mutating set(value: T): void;       // explicitly mutating

    mutating reset(): void;             // all writes explicitly marked
}
```

This is simpler than the three-keyword `identity`/`mutator`/`links` system:
- No `identity` keyword needed — absence of `mutating` implies stability.
- `mutating` maps 1:1 to Swift's familiar keyword.
- No `links` — all mutating methods invalidate all non-mutating reads on the same receiver.

### Why This Doesn't Quite Work for TypeScript

**1. TypeScript functions are already "mutating by default"**

In Swift, struct methods default to non-mutating because value semantics guarantee it. In TypeScript, any function can mutate anything through closures and references:

```typescript
function innocentLooking(): number {
    globalState.counter++;   // side effect!
    return globalState.counter;
}
```

Making non-mutating the default in TypeScript would be misleading — most functions *can* mutate shared state. Swift's guarantee is backed by the value type system; TypeScript has no such backing.

**2. The `links` clause solves a real problem**

Swift doesn't need `links` because `mutating` on structs means "this method modifies *this specific instance*." Each `@Published` property has its own publisher. There's no ambiguity about what a mutation affects.

TypeScript-Go interfaces can have multiple `identity` endpoints on the same object, and a mutator might affect some but not others:

```typescript
interface Dashboard {
    identity user(): User | undefined;
    identity theme(): Theme;
    identity notifications(): Notification[];

    mutator setUser(v: User): void links user;            // only user
    mutator setTheme(t: Theme): void links theme;          // only theme
    mutator clearAll(): void links user, notifications;    // two of three
}
```

Without `links`, a call to `setTheme()` would conservatively invalidate the narrowing on `user()` — losing precision that the developer knows is safe. The `links` clause is necessary precisely because TypeScript objects are reference-typed with multiple independently-varying endpoints.

**3. The explicit `identity` marker has value**

Swift's non-mutating default works because the struct method body is checked. TypeScript can't structurally verify that a function doesn't mutate:

```typescript
interface Store {
    read(): string | undefined;  // Is this stable? Who knows?
}
```

Without an explicit `identity` marker, the type checker would need heuristics (which TypeScript-Go already has as fallback tiers) or would have to assume everything is unstable (losing all narrowing benefits). The explicit `identity` keyword signals developer intent clearly.

### A Hybrid Syntax Approach

A compromise could combine Swift's simplicity with TypeScript-Go's precision:

```typescript
// Option A: Swift-style with links
interface Store<T> {
    read(): T;                                    // stable by default?
    mutating set(value: T): void links read;      // mutating + links
}

// Option B: Current TypeScript-Go (chosen approach)
interface Store<T> {
    identity read(): T;                           // explicitly stable
    mutator set(value: T): void links read;       // explicitly mutating
}

// Option C: Attribute-style (like Swift property wrappers)
interface Store<T> {
    @identity read(): T;
    @mutator(links: [read]) set(value: T): void;
}
```

**Option B (current approach) is the strongest choice** because:
- It makes both sides explicit, reducing ambiguity.
- It doesn't overload existing JavaScript semantics (`mutating` could conflict with other uses).
- It's symmetrical — both the read contract and write contract are visible in the type.
- It follows TypeScript's precedent of explicit modifiers (`readonly`, `abstract`, `override`).

Swift can afford implicit non-mutating because it has structural enforcement. TypeScript needs explicit `identity` because it has declarative trust.

---

## 9. Summary Comparison Matrix

| Dimension | Swift | TypeScript-Go | Verdict |
|-----------|-------|--------------|---------|
| **Mutation annotation** | `mutating` keyword on methods | `mutator` modifier on function types | Direct parallel; Swift is structural, TS-Go is declarative |
| **Read stability** | Implicit (non-mutating default) | Explicit `identity` modifier | TS-Go needs explicit because no structural enforcement |
| **Selective invalidation** | Implicit per `@Published` property | `links` clause | `links` solves multi-endpoint aliased objects |
| **Value semantics** | Struct copies prevent aliasing | N/A — JS is reference-only | Swift solves aliasing at language level; TS-Go at type level |
| **Reactive state** | `@State`, `@Published`, Combine | Signals + `identity`/`mutator` | Same pattern; Swift is framework-level, TS-Go is type-level |
| **Optional narrowing** | `if let` creates new binding | CFA narrows in-place | Both achieve safety; different mechanisms |
| **Protocol contracts** | `mutating` in protocol declarations | `mutator` in interface declarations | Direct parallel |
| **COW optimization** | Copy-on-write for value types | Conceptual parallel in narrowing lifecycle | Both share "stable until mutation" semantics |
| **Type erasure** | `any Protocol` preserves contracts | Interface typing preserves modifiers | Both propagate read/write contracts through abstraction |
| **Enforcement** | Structural (compiler checks body) | Declarative (trusted annotation) | Swift is sound; TS-Go follows TS philosophy |

## 10. Conclusion

Swift's `mutating`/non-mutating distinction is the closest prior art to TypeScript-Go's `mutator`/`identity` system among mainstream languages. Both encode the same fundamental insight: **distinguishing between operations that observe state and operations that modify state enables stronger static reasoning**.

Three key lessons from the Swift comparison:

1. **Explicit > implicit for TypeScript's domain**: Swift's non-mutating default works because value semantics provide structural backing. TypeScript-Go correctly chose explicit `identity` annotation because JavaScript's reference semantics can't structurally verify non-mutation. The keyword signals intent, not proof.

2. **`links` fills a gap Swift doesn't have**: Swift's value types have natural copy boundaries — mutating a struct can only affect that copy. JavaScript objects have no such boundaries, so TypeScript-Go's `links` clause provides the fine-grained "what affects what" information that Swift gets for free from value semantics and per-property `@Published` wrappers.

3. **The reactive pattern validation is strong**: SwiftUI's `@State`/`@Published`/Combine ecosystem is a production-proven model for "stable reads + invalidating writes." TypeScript-Go's signal support via `identity`/`mutator` targets the same pattern with the same semantic decomposition. This cross-validation with a major platform strengthens confidence in the design direction.

The most significant design divergence is enforcement: Swift's `mutating` is a hard compiler contract that affects code generation (inout parameter passing), while TypeScript-Go's `mutator` is a soft annotation that affects type narrowing. This is the correct trade-off for each language's domain — systems programming demands structural guarantees; gradual typing over JavaScript demands annotation-guided precision.
