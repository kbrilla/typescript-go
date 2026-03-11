# Design Review #24: Java and C++ — Mature Approaches to Immutability, Narrowing, and Mutation Tracking

## Document Control
- Status: Research Analysis
- Date: 2026-03-11
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Java and C++'s immutability, type narrowing, and mutation models with TypeScript-Go's `identity`/`mutator`/`links` CFA system

---

## Background

Java (1995) and C++ (1985) are two of the most widely deployed languages in history. Together they have accumulated over 60 years of real-world experience with immutability, const-correctness, and type narrowing. Their approaches represent deeply explored, battle-tested design points:

- **Java** — Reference semantics everywhere, `final` for initialization-time immutability, pattern matching added in recent versions, records for immutable data carriers.
- **C++** — Value semantics by default, `const`-correctness as a core type system feature, `mutable` for const-exception fields, tagged unions via `std::variant`.

Both languages are relevant because they have confronted — at industrial scale — the same fundamental tension TypeScript-Go's `identity`/`mutator`/`links` addresses: how does a compiler know when a previously-read value is still valid after intervening code executes?

---

## 1. Java: `final` Fields — Initialization-Time Immutability

### Java's Model

Java's `final` keyword provides initialization-time immutability. A `final` field must be assigned exactly once — during construction — and cannot be reassigned afterward:

```java
public class Config {
    private final String name;
    private final int timeout;
    private int retries;  // mutable

    public Config(String name, int timeout) {
        this.name = name;        // assigned once
        this.timeout = timeout;  // assigned once
        this.retries = 3;
    }

    public String getName() { return name; }       // always stable
    public int getTimeout() { return timeout; }    // always stable
    public int getRetries() { return retries; }    // may change

    public void setRetries(int n) { this.retries = n; }
}
```

`final` has key properties:
- **Shallow freeze:** `final List<String> items` means the reference cannot be reassigned, but the list contents are still mutable.
- **Thread safety guarantee:** The JMM (Java Memory Model) guarantees that `final` fields are visible to all threads after construction completes, without explicit synchronization.
- **No transitive immutability:** `final` does not make referenced objects immutable. A `final Map<K, V>` can still have entries added/removed.

### Comparison to identity/mutator

| Java `final` | TypeScript-Go Analog | Semantic |
|--------------|---------------------|----------|
| `final` field | `identity` endpoint (partially) | Value is stable after initialization |
| Non-`final` field | Regular mutable property | May change; no narrowing guarantees |
| `final` + getter | `identity () => T` | Stable read method |
| Setter method | `mutator (v: T) => void` | Mutates state |
| Shallow freeze (`final List<T>`) | `identity` (also shallow) | Reference stable, contents may change |

**Key difference: granularity of "stable."** Java's `final` makes one claim: "this field cannot be reassigned after construction." It says nothing about what the field's getter returns in terms of derived or computed values. TypeScript-Go's `identity` is richer because it applies to callable return values — the compiler can narrow `identity () => string | undefined` based on control flow, not just based on assignment patterns.

**Another difference: invalidation model.** Java has no concept of "a setter call invalidates previous `final`-based assumptions" because `final` fields *have* no setters. The Java developer must choose: either a field is `final` (totally immutable) or it's mutable (no compiler assistance for caching read results). TypeScript-Go occupies the middle ground — values *can* change, but the compiler knows *when*.

```typescript
// TypeScript-Go: the middle ground Java lacks
interface Config {
    name: identity () => string;          // stable — like Java final
    retries: identity () => number;       // stable between mutations
    setRetries: mutator (n: number) => void links retries;  // targeted invalidation
}
```

After `setRetries()`, the compiler invalidates narrowing on `retries()` but leaves `name()` untouched. Java has no equivalent — `final` gives absolute stability, non-`final` gives no compiler-assisted reasoning.

---

## 2. Java: Pattern Matching (Java 17+) — instanceof Patterns, Record Patterns, Switch Patterns

### Pattern Matching for instanceof (Java 16)

Java 16 introduced pattern matching for `instanceof`, which combines a type test with a binding in a single expression:

```java
// Before Java 16
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}

// Java 16+: pattern variable
if (obj instanceof String s) {
    System.out.println(s.length());  // s is already String
}
```

The pattern variable `s` is a new binding scoped to the `true` branch. This is a form of type narrowing, but it creates a **separate variable** rather than narrowing the original `obj`.

### Record Patterns (Java 21)

Record patterns allow destructuring record components directly in pattern matching contexts:

```java
record Point(double x, double y) {}
record Circle(Point center, double radius) {}

static String describe(Object shape) {
    return switch (shape) {
        case Circle(Point(var x, var y), var r)
            -> "Circle at (" + x + "," + y + ") with radius " + r;
        case Point(var x, var y)
            -> "Point at (" + x + "," + y + ")";
        default -> "Unknown";
    };
}
```

Record patterns enable **deep narrowing** — the compiler knows that after matching `Circle(Point(var x, var y), var r)`, the variables `x`, `y`, and `r` are exactly typed.

### Switch Patterns (Java 21)

Pattern matching in `switch` enables exhaustive, flow-sensitive type discrimination:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double w, double h) implements Shape {}
record Triangle(double a, double b, double c) implements Shape {}

static double area(Shape s) {
    return switch (s) {
        case Circle c     -> Math.PI * c.radius() * c.radius();
        case Rectangle r  -> r.w() * r.h();
        case Triangle t   -> {
            double sp = (t.a() + t.b() + t.c()) / 2;
            yield Math.sqrt(sp * (sp - t.a()) * (sp - t.b()) * (sp - t.c()));
        }
    };  // exhaustive — no default needed with sealed type
}
```

### Comparison to identity Narrowing

| Java Pattern Matching | TypeScript-Go CFA | Semantic |
|----------------------|-------------------|----------|
| `instanceof String s` | `if (typeof x === "string")` | Type narrowing after type test |
| Pattern variable (new binding) | In-place narrowing (same variable) | Java extracts; TS narrows in place |
| `case Circle c → ...` | `case "circle": ...` (discriminated union) | Exhaustive type discrimination |
| Record patterns (deep) | Nested `if`/`switch` | Java destructures; TS chains |
| Sealed types (exhaustive switch) | Discriminated unions (exhaustive switch) | Both enable exhaustiveness checking |

**Critical insight: invalidation immunity.** Java's pattern variables are immune to invalidation because they are **new bindings extracted from the matched value**. Once `String s` is bound, calling methods that modify `obj` cannot change `s`. This is the "capture to local" pattern built into the language syntax.

TypeScript-Go's `identity` achieves a similar effect but without introducing new variables:

```typescript
function process(store: { read: identity () => string | number }) {
    if (typeof store.read() === "string") {
        // store.read() is narrowed to string — no new variable needed
        store.read().toUpperCase();  // OK
    }
}
```

Java forces the capture; TypeScript-Go makes it optional via `identity`. Both guarantee that the narrowed value is stable within the branch, but through different mechanisms.

**Where Java falls short:** Java's pattern matching creates a snapshot of the value at match time. If the underlying data changes and the developer re-reads `obj`, the pattern variable `s` is stale. There is no mechanism to express "this getter always returns the same type" — the developer must either (a) use the pattern variable consistently or (b) manually re-check. TypeScript-Go's `identity` makes the stronger claim: "re-reading returns the same value, so re-checking is unnecessary."

---

## 3. Java: Records (Java 16+) — Immutable Data Carriers

### Java's Records

Records are transparent, immutable data carriers with automatically generated accessors, `equals`, `hashCode`, and `toString`:

```java
record Person(String name, int age) {}

var person = new Person("Alice", 30);
person.name();   // "Alice" — accessor, not a field
person.age();    // 30
// No setters — records are immutable
```

Records have key properties:
- **All components are `final`** — values are set at construction and cannot change.
- **Accessor methods are auto-generated** — `name()` always returns the same value for the same instance.
- **Structural equality** — `equals` compares component values, not reference identity.
- **Shallow immutability** — A `record Config(List<String> items)` still allows `config.items().add("x")`.

### Records as "Total Identity" Objects

From TypeScript-Go's perspective, a Java record is an object where **every accessor is `identity`**:

```typescript
// TypeScript-Go equivalent of Java's record Person(String name, int age)
interface Person {
    name: identity () => string;
    age: identity () => number;
    // No mutators — fully immutable
}
```

Because all fields are final, every getter on a record is guaranteed stable. There are no mutators, so there is nothing to trigger invalidation. The compiler can freely narrow any record accessor return value.

### Comparison to identity/mutator

| Java Records | TypeScript-Go Analog | Semantic |
|-------------|---------------------|----------|
| All components `final` | All members `identity` | Everything is stable |
| No setters exist | No `mutator` members | No invalidation possible |
| Shallow immutability | Identity is also shallow | Inner mutability still possible |
| Structural equality | No analog (reference equality) | Records enable value comparison |
| Pattern decomposition | Destructuring + narrowing | Both enable access to inner types |

**What records teach:** Java records demonstrate that "everything is an identity endpoint" is a viable design for immutable data. TypeScript-Go's system is more flexible because it allows mixing `identity` and `mutator` on the same interface — but when a structure happens to be fully immutable, the effect is equivalent to a Java record.

**The Java ecosystem's challenge:** Before records, Java developers built immutability through convention — private fields, only getters, no setters. But the compiler couldn't leverage this convention for optimization or narrowing because the pattern wasn't expressed in the type system. Records made immutability a first-class type-system concept. Similarly, TypeScript-Go's `identity` makes "this read is stable" a first-class concept rather than a convention.

---

## 4. Java: Reactive Streams — Publisher, Subscriber, Processor

### The Reactive Streams Model

Java 9 introduced `java.util.concurrent.Flow` with four core interfaces defining the reactive contract:

```java
@FunctionalInterface
public interface Publisher<T> {
    void subscribe(Subscriber<? super T> subscriber);
}

public interface Subscriber<T> {
    void onSubscribe(Subscription subscription);
    void onNext(T item);        // receives emitted values
    void onError(Throwable t);  // terminal error
    void onComplete();          // terminal completion
}

public interface Subscription {
    void request(long n);  // backpressure — request N items
    void cancel();
}

public interface Processor<T, R> extends Subscriber<T>, Publisher<R> {}
```

### Mutation Semantics in Reactive Streams

Reactive streams have an inherent read/write duality:
- **Publishers** are read endpoints — they emit values that subscribers observe.
- **Subscribers** are write endpoints — they receive values and update state.
- **Processors** are both — they consume upstream values and produce downstream values.

The crucial invariant is **temporal ordering**: `onNext` calls are serialized. A subscriber will never receive concurrent `onNext` calls from the same publisher. This means that within an `onNext` handler, the item value is stable — no concurrent mutation can change it.

### Comparison to identity/mutator

| Reactive Streams | TypeScript-Go Analog | Semantic |
|-----------------|---------------------|----------|
| `Publisher<T>` | `identity () => T` | Read endpoint; emits stable values |
| `Subscriber.onNext(T)` | `mutator (v: T) => void` | Write endpoint; receives new values |
| `Subscription.cancel()` | `mutator () => void` | Invalidating operation |
| Sequential `onNext` guarantee | CFA flow ordering | Temporal ordering ensures stability |
| `Processor<T, R>` | Interface with both identity + mutator | Dual read/write role |

**The parallel is structural.** In reactive systems, the type of a Publisher's emission (e.g., `Publisher<String | null>`) could be narrowed after an `onNext` that provides a non-null value. But Java's type system does not perform this narrowing — the subscriber's type parameter remains `T` regardless of what value was received.

TypeScript-Go's identity system enables exactly this kind of reasoning:

```typescript
interface ReactiveStore<T> {
    current: identity () => T | undefined;       // ~ Publisher<T?>
    update: mutator (value: T) => void;          // ~ Subscriber.onNext(T)
}

function observe(store: ReactiveStore<string>) {
    if (store.current() !== undefined) {
        // current() is narrowed to string — identity guarantees stability
        console.log(store.current().toUpperCase());  // OK
    }
    store.update("new");
    // current() narrowing invalidated — must re-check
}
```

**What reactive streams teach:** The Publisher/Subscriber separation is precisely the read/write separation that `identity`/`mutator` formalizes. Java's reactive streams prove that this duality is fundamental in event-driven programming — which is exactly TypeScript's domain (DOM events, framework signals, state management).

---

## 5. Java: Project Valhalla — Future Value Types

### Valhalla's Vision

Project Valhalla is Java's ongoing effort to add **value types** — inline classes that behave like primitives:

```java
// Proposed syntax (JEP 401 / preview)
value class Complex {
    double re;
    double im;

    Complex(double re, double im) {
        this.re = re;
        this.im = im;
    }
}
```

Value types differ from regular objects:
- **No identity** — Two value objects with the same component values are indistinguishable (no reference identity, no `==` on identity).
- **Inline storage** — Flattened into the enclosing object or array, no heap allocation or header overhead.
- **Immutable by default** — Components cannot be reassigned after construction.
- **No synchronization** — Cannot use `synchronized` on a value type instance (no identity to lock on).

### The "No Identity" Paradox

Valhalla's "no identity" is a different concept from TypeScript-Go's `identity` modifier, but they are philosophically related:

- **Valhalla's "no identity"** means the object has no reference identity — it is purely its value. Two `Complex(1.0, 2.0)` instances are the same object. This enables compiler optimizations (inlining, scalarization).
- **TypeScript-Go's `identity`** means the read endpoint has a **stable identity from the CFA perspective** — re-reading returns the same value. This enables type narrowing optimizations.

Both use the concept of "stability" to unlock compiler reasoning, but at different levels:

| Valhalla Value Types | TypeScript-Go Identity | Level |
|---------------------|----------------------|-------|
| No reference identity | Stable read value | Object identity vs value identity |
| Immutable components | Stable between mutations | Absolute vs conditional |
| Compiler can inline/flatten | Compiler can narrow/cache | Codegen optimization vs type precision |
| Cannot synchronize on | Cannot invalidate (until mutator) | Side-effect constraints |

**What Valhalla teaches:** When objects have no mutable identity, the compiler can make powerful assumptions. TypeScript-Go's `identity` modifier achieves a targeted version of this: instead of requiring full value-type immutability, it marks specific endpoints as stable — enough for the CFA to narrow through but without requiring the entire object to be immutable.

---

## 6. C++: `const` and `mutable` — Const-Correctness

### C++'s Const System

C++ has the most mature const-correctness system of any mainstream language. `const` can qualify:
- Local variables and parameters
- Pointers and references (at multiple levels)
- Member functions
- Return types

```cpp
class Sensor {
    int raw_value_;
    mutable int cached_filtered_;   // mutable — can change even in const context
    mutable bool cache_valid_;

public:
    // const method: promises not to modify observable state
    int filtered() const {
        if (!cache_valid_) {
            cached_filtered_ = expensiveFilter(raw_value_);
            cache_valid_ = true;  // OK — mutable fields can change in const methods
        }
        return cached_filtered_;
    }

    // non-const method: may modify state
    void setRaw(int v) {
        raw_value_ = v;
        cache_valid_ = false;  // invalidate cache
    }
};
```

### const Methods and mutable Fields

The `const` on a method is a contract: "calling this method does not change the observable state of the object." But `mutable` fields provide an escape hatch — they can be modified even in `const` contexts. This enables:
- **Lazy initialization:** Compute on first access, cache the result.
- **Reference counting:** `shared_ptr` uses `mutable` for the reference count.
- **Logging/instrumentation:** A `const` method can log that it was called.

### Comparison to identity/mutator

| C++ Concept | TypeScript-Go Analog | Semantic |
|-------------|---------------------|----------|
| `const` method | `identity` endpoint | "This call does not change observable state" |
| Non-`const` method | `mutator` endpoint | "This call may change state" |
| `mutable` field | Internal implementation detail | State that changes without observable effect |
| `const T&` parameter | No direct analog | "I promise not to modify this argument" |
| `const_cast` | No analog (no escape hatch) | Explicitly remove const — unsafe |

**Direct parallel:** C++'s `const` methods and TypeScript-Go's `identity` endpoints serve the same purpose — telling the compiler (and the developer) that a call is a pure read with no observable side effects. The key parallels:

```cpp
// C++: const method contract
class Store {
public:
    std::optional<std::string> read() const;  // const → no state change
    void write(std::string v);                // non-const → may change state
};
```

```typescript
// TypeScript-Go: identity/mutator contract
interface Store {
    read: identity () => string | undefined;   // identity → no state change
    write: mutator (v: string) => void;        // mutator → may change state
}
```

**Key difference: enforcement.** In C++, the compiler enforces `const`-correctness — a `const` method cannot modify non-`mutable` members. TypeScript-Go's `identity` is a declaration that the compiler trusts for CFA purposes but does not enforce at the implementation level. The developer is responsible for ensuring that `identity` methods are actually side-effect-free.

**The `mutable` lesson:** C++'s `mutable` keyword acknowledges a real-world truth — some internal state changes (caching, logging, reference counting) are not observable mutations. TypeScript-Go's system implicitly allows this: an `identity` method can maintain internal caches or counters as long as the observable return value is consistent. C++ had to add `mutable` as an explicit escape hatch from `const`; TypeScript-Go avoids this by operating at the observable-behavior level rather than the field-access level.

---

## 7. C++: Smart Pointers — `shared_ptr`, `unique_ptr`, and Const Propagation

### Ownership and Constness

C++ smart pointers combine ownership semantics with const-propagation:

```cpp
// unique_ptr: exclusive ownership
std::unique_ptr<Widget> exclusive = std::make_unique<Widget>();
exclusive->mutate();  // OK — mutable access through unique_ptr

const std::unique_ptr<Widget> frozen = std::make_unique<Widget>();
frozen->mutate();     // Still OK — const applies to the pointer, not the pointee
frozen = nullptr;     // ERROR — cannot reassign const unique_ptr
```

The critical subtlety: `const unique_ptr<Widget>` makes the **pointer** const (cannot reassign), but the `Widget` is still mutable. For deep constness:

```cpp
// Deep const: both pointer and pointee are const
const std::unique_ptr<const Widget> deep_frozen = std::make_unique<Widget>();
deep_frozen->mutate();    // ERROR — Widget is const
deep_frozen = nullptr;    // ERROR — pointer is const
```

### shared_ptr and Aliased Mutation

`shared_ptr` introduces shared ownership — multiple owners can read and write through the same object:

```cpp
auto a = std::make_shared<Widget>();
auto b = a;             // shared ownership — a and b point to same Widget
b->mutate();            // mutates the Widget that a also sees
a->getValue();          // may return different value than before b->mutate()
```

This is the aliased-mutation problem: a read through `a` can be invalidated by a write through `b`. The compiler cannot reason about the stability of `a->getValue()` across a `b->mutate()` call because it doesn't know whether `a` and `b` alias.

### Comparison to identity/mutator

| C++ Smart Ptr | TypeScript-Go Analog | Semantic |
|--------------|---------------------|----------|
| `unique_ptr<T>` | Unique identity endpoint | Exclusive access; reads are stable |
| `shared_ptr<T>` | Shared identity endpoint | Multiple readers; invalidation possible |
| `const shared_ptr<const T>` | Fully `identity` interface | Deep read-only; no mutations possible |
| Aliased mutation problem | The core problem `identity` solves | Reads invalidated by writes through aliases |
| No compiler help for aliased reads | `identity` enables CFA narrowing | TypeScript-Go adds what C++ lacks |

**The fundamental lesson:** C++ has had smart pointers since C++11 (2011), and even after 15+ years the compiler **still** cannot narrow the return type of a method call on a `shared_ptr` based on control flow. The aliased-mutation problem is considered intractable in C++ because the language's pointer/reference semantics are too permissive.

TypeScript-Go sidesteps this by making the developer declare the aliasing contract explicitly. `identity` says: "regardless of aliasing, this endpoint returns stable values between identified mutation points." This is a pragmatic solution that C++ never attempted — it requires developer cooperation rather than compiler proof.

---

## 8. C++: Concepts (C++20) — Constrained Templates

### Concepts Overview

Concepts constrain template parameters, specifying what operations a type must support:

```cpp
template<typename T>
concept Readable = requires(T t) {
    { t.read() } -> std::convertible_to<std::optional<std::string>>;
};

template<typename T>
concept Writable = requires(T t, std::string s) {
    { t.write(s) } -> std::same_as<void>;
};

template<typename T>
concept ReadWriteStore = Readable<T> && Writable<T>;
```

Concepts replace SFINAE and enable better error messages, but they operate at the **structural** level — they check whether operations exist, not whether they have specific mutation semantics.

### The Missing Piece: Const-Awareness in Concepts

Concepts can require const-qualified methods:

```cpp
template<typename T>
concept StableReadable = requires(const T ct) {
    { ct.read() } -> std::convertible_to<std::optional<std::string>>;
};

// This concept requires that read() is a const method
template<StableReadable T>
void process(const T& store) {
    auto val = store.read();  // guaranteed to be const-correct
}
```

The `const T ct` in the requires clause ensures that `read()` must be callable on a const reference — which implies it is a `const` method. This is the closest C++ gets to requiring `identity`-like semantics at the generic constraint level.

### Comparison to identity at Interface Boundaries

| C++ Concepts | TypeScript-Go Interfaces | Semantic |
|-------------|------------------------|----------|
| `concept Readable` | `interface { read: () => T }` | Structural read requirement |
| `concept StableReadable` (const) | `interface { read: identity () => T }` | Read + stability contract |
| `concept Writable` | `interface { write: mutator (v: T) => void }` | Structural write requirement |
| Constraint satisfaction check | Structural type compatibility | Both are structurally typed |
| No narrowing implications | Identity enables CFA narrowing | TS-Go goes further |

**Key insight:** C++ concepts can express "this type has a const `read()` method," but the compiler does not use that information for flow-based narrowing. The `const` guarantee helps with compilation (ensuring the method exists and is const-correct) but does not improve type precision in control flow. TypeScript-Go's `identity` modifier carries the same information (stable read) but additionally feeds into the CFA, enabling narrowing that C++ concepts cannot.

---

## 9. C++: `std::variant` and `std::visit` — Tagged Union Types

### The Variant Model

`std::variant` is C++'s type-safe discriminated union, introduced in C++17:

```cpp
using Shape = std::variant<Circle, Rectangle, Triangle>;

double area(const Shape& shape) {
    return std::visit(overloaded{
        [](const Circle& c)    { return 3.14159 * c.radius * c.radius; },
        [](const Rectangle& r) { return r.width * r.height; },
        [](const Triangle& t)  {
            double s = (t.a + t.b + t.c) / 2;
            return std::sqrt(s * (s-t.a) * (s-t.b) * (s-t.c));
        }
    }, shape);
}
```

### Narrowing and Mutation

`std::variant` has a critical mutation issue: the active alternative can change at any time:

```cpp
Shape s = Circle{5.0};
auto* c = std::get_if<Circle>(&s);  // c points to Circle IF s holds Circle
// c is now a Circle* — but what if s changes?
s = Rectangle{3.0, 4.0};           // s now holds Rectangle
// c is DANGLING — the Circle no longer exists
```

`std::get_if` returns a pointer to the active alternative, but that pointer is invalidated if the variant is reassigned to a different alternative. The compiler does not track this invalidation — it is up to the developer to avoid using stale pointers.

With `std::visit`, this problem is avoided because the visitor is applied immediately and the callback receives a reference scoped to the visit:

```cpp
std::visit([](auto& val) {
    // val is narrowed to the active alternative type
    // safe — lifetime is scoped to this lambda
}, shape);
// val does not escape — no invalidation risk
```

### Comparison to identity-aware Narrowing

| C++ std::variant | TypeScript Union Narrowing | Semantic |
|-----------------|--------------------------|----------|
| `std::get_if<T>(&v)` | `if (typeof v === "string")` | Type test + access |
| Pointer to active alternative | In-place narrowing of variable | C++ extracts pointer; TS narrows type |
| Pointer invalidated on reassignment | Narrowing invalidated on assignment | Both track when narrowing is stale |
| `std::visit` (scoped access) | `identity` (stable access) | Both guarantee type stability within scope |
| Compiler does NOT track invalidation | CFA tracks invalidation for `identity` | TS-Go is more precise here |

**The variant lesson:** `std::variant` demonstrates that type-safe unions *need* invalidation tracking. C++ chose not to provide it (developers must manually ensure `get_if` pointers aren't stale), leading to a common source of UB (undefined behavior). TypeScript-Go's CFA does track invalidation, and `identity` extends this tracking to callable return types — preventing the analog of the dangling `get_if` pointer.

```typescript
// TypeScript-Go prevents the C++ variant problem
interface ShapeStore {
    current: identity () => Circle | Rectangle | Triangle;
    replace: mutator (s: Circle | Rectangle | Triangle) => void;
}

function process(store: ShapeStore) {
    const shape = store.current();
    if (shape instanceof Circle) {
        // shape is narrowed to Circle
        console.log(shape.radius);
    }
    store.replace(new Rectangle(3, 4));
    // If using store.current() instead of local `shape`:
    // identity narrowing would be invalidated by replace() mutator
}
```

---

## 10. C++: Ranges — Read-Only Views vs Mutable Ranges

### The Ranges Model (C++20)

C++20 ranges provide a composable abstraction over sequences of elements. The key distinction is between **views** (non-owning, lazy, potentially const) and **mutable ranges** (owning, eager):

```cpp
#include <ranges>
#include <vector>

std::vector<int> data = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};

// View: read-only, lazy, non-owning
auto evens = data | std::views::filter([](int n) { return n % 2 == 0; });
// evens is a view — does not copy data, does not modify data

// Mutable access through the original container
data.push_back(12);
// evens now includes 12 in its result — it is a LIVE view
```

### View Stability

Views present a challenging mutation story:
- A view does not own its data — it references an underlying container.
- Modifying the container can invalidate iterators obtained from the view.
- The view itself may cache state (e.g., `views::filter` may cache the `begin()` iterator).

```cpp
auto v = data | std::views::take(3);
auto it = v.begin();   // iterator to first element
data.insert(data.begin(), 0);  // INVALIDATES it — data has been mutated
*it;  // UNDEFINED BEHAVIOR — iterator is invalidated
```

### Comparison to identity/mutator

| C++ Ranges | TypeScript-Go Analog | Semantic |
|-----------|---------------------|----------|
| `std::views::*` (read-only view) | `identity () => T` | Read endpoint; value derived from underlying data |
| Container mutation (`.push_back`, `.insert`) | `mutator` call | Invalidates outstanding read assumptions |
| Iterator invalidation | CFA narrowing invalidation | Both track when reads become stale |
| `std::ranges::borrowed_range` | No analog | Lifetime-aware range that can outlive temporary |
| No compiler tracking of iterator validity | CFA tracks identity validity | TS-Go is more precise |

**The ranges lesson:** C++20 ranges are one of the most sophisticated lazy-read abstractions in any language, yet the compiler **does not track** whether a view's iterators are valid after container mutation. Iterator invalidation is documented in prose, enforced by convention, and diagnosed by sanitizers (ASan) — not by the type system.

TypeScript-Go's `identity` + `mutator` system does what C++ ranges cannot: it encodes the read/write contract in the type system so the compiler can automatically invalidate narrowing when a mutation occurs. This is a significant precision advantage.

---

## 11. Synthesis: What These Mature Languages Teach

### Lesson 1: Const-Correctness is Worth the Investment

C++ is the only mainstream language with deep, systematic const-correctness, and it has been vindicated over 40 years:
- Large C++ codebases treat const-correctness as a critical quality signal.
- The `const` annotation enables compiler optimizations, thread-safety reasoning, and API contracts.
- Despite its complexity (const references, const pointers, const methods, const return types), the C++ community considers it an essential feature.

**Application to TypeScript-Go:** `identity`/`mutator` is TypeScript's const-correctness. It is simpler than C++'s system (two modifiers vs. a multi-dimensional const matrix), more ergonomic (per-callable rather than per-pointer-level), and more targeted (CFA narrowing rather than memory-access enforcement). The C++ experience validates that "marking reads as stable" is worth the syntax cost.

### Lesson 2: Shallow vs Deep Immutability is a Real Divide

Both Java (`final`) and C++ (`const`) struggle with **shallow** immutability:
- Java's `final List<String>` prevents reassignment but not `list.add()`.
- C++'s `const vector<string>&` prevents `.push_back()` but allows mutation of elements via iterators (depending on const propagation).

TypeScript-Go's `identity` is explicitly shallow — it says "this callable returns the same value" without making claims about the value's internal mutability. This is the right default for TypeScript's domain:

```typescript
interface Store {
    items: identity () => readonly string[];  // shallow: same array reference
    // items()[0] might change if someone has a mutable reference to the array
}
```

If deep immutability is needed, TypeScript already has `readonly` arrays and `Readonly<T>` types. `identity` complements these existing tools rather than replacing them.

### Lesson 3: Binary const/mutable is Insufficient for Real APIs

Java's `final`/non-`final` and C++'s `const`/non-`const` are **binary** — a field or method is either fully immutable or fully mutable. Real-world APIs need more nuance:

```typescript
// A media player with multiple independent state channels
interface Player {
    track: identity () => Track | null;         // what's playing
    volume: identity () => number;              // current volume
    setTrack: mutator (t: Track) => void links track;    // changes track only
    setVolume: mutator (v: number) => void links volume;  // changes volume only
}
```

After `setTrack()`, the compiler knows:
- `track()` narrowing is invalidated — must re-check.
- `volume()` narrowing is preserved — setTrack doesn't affect volume.

Neither Java nor C++ can express this. Java has no selective invalidation mechanism. C++ could theoretically encode it through multiple const-qualified overloads, but the complexity would be impractical:

```cpp
// C++ attempt at selective const — impractical
class Player {
    Track* track_;
    int volume_;
public:
    const Track* track() const;  // const method — but ALL const methods share one "const"
    int volume() const;          // also const — compiler cannot distinguish from track()
    void setTrack(Track*);       // non-const — invalidates ALL const assumptions
    void setVolume(int);         // non-const — also invalidates ALL const assumptions
};
```

In C++, calling `setTrack()` or `setVolume()` on a non-const `Player` invalidates **all** const-method assumptions equally. There is no way to say "setTrack only invalidates track(), not volume()." TypeScript-Go's `links` clause is a genuine advance over C++'s 40-year-old const system.

### Lesson 4: Pattern Matching Solves a Subset of the Problem

Java's pattern matching (switchable `instanceof`, record patterns) and C++'s `std::visit` both handle the "type narrowing within a scope" problem elegantly. But they solve a **static subset**:

| Pattern Matching Solves | identity/mutator Adds |
|------------------------|----------------------|
| Narrowing within a match arm | Narrowing across statements |
| Narrowing of values (data) | Narrowing of callables (behavior) |
| Snapshot semantics (value at match time) | Live semantics (re-read is safe) |
| Exhaustiveness checking | Targeted invalidation |

TypeScript already has discriminated union narrowing and `switch` exhaustiveness. `identity` extends narrowing to callable return types — a domain that pattern matching does not address because pattern matching operates on values, not on functions that produce values.

### Lesson 5: Smart Pointers and Reactive Streams Confirm the Read/Write Duality

C++ smart pointers (`shared_ptr` vs `unique_ptr`) and Java reactive streams (`Publisher` vs `Subscriber`) independently arrived at the same conclusion: **separating read and write concerns is fundamental.**

| Concept | C++ | Java | TypeScript-Go |
|---------|-----|------|--------------|
| Read endpoint | `const shared_ptr<const T>` | `Publisher<T>` | `identity () => T` |
| Write endpoint | `shared_ptr<T>` (mutable) | `Subscriber<T>` | `mutator (v: T) => void` |
| Read invalidation | Iterator invalidation (UB) | No tracking | CFA narrowing invalidation |
| Selective invalidation | Not possible | Not possible | `links` clause |

Both mature languages confirm the pattern but fail to provide compiler-tracked invalidation. TypeScript-Go fills this gap.

### Summary Table

| Feature | Java | C++ | TypeScript-Go |
|---------|------|-----|--------------|
| **Immutability marker** | `final` (field) | `const` (method/ptr/ref) | `identity` (callable) |
| **Mutation marker** | Setter convention | Non-`const` method | `mutator` (callable) |
| **Selective invalidation** | Not possible | Not possible | `links` clause |
| **Type narrowing** | Pattern matching (Java 17+) | `std::visit` (scoped) | CFA flow narrowing + identity |
| **Narrowing invalidation tracking** | None | None (UB on stale access) | CFA-tracked, mutator-triggered |
| **Granularity** | Per-field (`final`) | Per-method (`const`) | Per-endpoint (modifier) |
| **Depth** | Shallow | Shallow (unless `const const`) | Shallow |
| **Enforcement** | Compile error (final) | Compile error (const) | Soft (CFA narrowing loss) |
| **Escape hatch** | Reflection | `const_cast`, `mutable` | None needed (soft enforcement) |
| **Tagged unions** | Sealed classes + patterns | `std::variant` + `std::visit` | Discriminated unions + switch |
| **Exhaustiveness** | Sealed switch (Java 21) | `std::visit` (compile error) | Discriminated union switch |
| **Aliased mutation** | No tracking | No tracking (UB risk) | `identity`/`mutator` tracking |

### What These Mature Languages Validate

1. **Const-correctness pays off long-term.** C++ has proven over four decades that annotating read/write intent at the declaration site is worth the effort. `identity`/`mutator` follows this principle while avoiding C++'s complexity pitfalls.

2. **Selective invalidation is an unmet need.** Neither Java nor C++ — despite their enormous ecosystems and decades of evolution — have developed a way to say "this mutation affects endpoint A but not endpoint B." TypeScript-Go's `links` clause is genuinely novel in the design space.

3. **Soft enforcement is right for TypeScript.** Java uses hard compile errors for `final` violations. C++ uses hard compile errors for `const` violations (plus `const_cast` as an escape hatch). TypeScript-Go's softer "you lose narrowing" approach fits a gradually-typed language where soundness is not a goal and developer experience matters more than proof rigor.

4. **The "capture to local" pattern is a workaround, not a solution.** Java's pattern matching, C++'s `std::visit`, and C++'s `std::get_if` all require capturing values into local scopes for safe access. `identity` eliminates this ceremony by telling the compiler the read is inherently stable.

5. **Read/write duality is a universal pattern.** C++ smart pointers, Java reactive streams, and Java records all encode read/write separation — confirming that `identity`/`mutator` captures a fundamental programming concept, not a niche TypeScript-specific need.
