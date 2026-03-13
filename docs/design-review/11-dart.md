# Design Review: Dart — Final Fields, Type Promotion, Streams, and Flutter State

## Overview

Dart occupies a unique position among statically-typed languages: it has **sound null
safety**, **flow-based type promotion** (smart casts) with explicit invalidation rules,
and a rich reactive ecosystem through Streams and Flutter state management. Dart's type
promotion invalidation semantics are the closest existing analog to TypeScript-Go's
`identity`/`mutator`/`links` system among mainstream languages.

---

## 1. `final` vs `var` vs `const` — Dart's Mutability Spectrum

### The Three Levels

Dart provides three mutability levels for variable declarations:

```dart
var x = 42;           // mutable — can be reassigned
final y = 42;         // runtime-immutable — assigned once, never reassigned
const z = 42;         // compile-time constant — value known at compile time

final list = [1, 2, 3];  // the binding is final, but the list contents are mutable
const list2 = [1, 2, 3]; // deeply immutable — cannot add/remove elements
```

### `final` Fields and Type Promotion

Dart 3.0 introduced **field promotion** — `final` private fields can be promoted
(narrowed) after a type check:

```dart
class Box {
  final Object? _value;  // private final field
  Box(this._value);

  String describe() {
    if (_value is String) {
      // _value is promoted to String — safe because it's final and private
      return _value.toUpperCase();
    }
    return 'not a string';
  }
}
```

Non-final fields **cannot** be promoted:

```dart
class MutableBox {
  Object? value;  // not final — no promotion
  MutableBox(this.value);

  String describe() {
    if (value is String) {
      // ERROR: value could have changed between the check and the use
      // Another thread or a getter override could mutate it
      return value.toUpperCase(); // Not promoted!
    }
    return 'not a string';
  }
}
```

### Comparison to identity/mutator

| Dart Concept    | TypeScript-Go Analog          | Effect on Narrowing             |
|-----------------|-------------------------------|---------------------------------|
| `final` field   | `identity` property           | Enables promotion/narrowing     |
| `var` field      | Regular property              | Blocks promotion                |
| `const`         | `as const` (partial analog)   | Compile-time immutable          |
| Private `final` | `identity` on private member  | Full promotion support          |
| Public `final`  | N/A (subclass could override) | Limited promotion (Dart 3.2+)   |

**Key insight:** Dart requires `final` + private to guarantee promotion — the field
must be (a) unsettable after construction and (b) not overridable by subclasses. This
is structurally identical to the guarantee `identity` provides: the read endpoint is
stable and not subject to external mutation.

### Why `final` Alone Is Insufficient

A public `final` field in Dart can be overridden by a getter in a subclass:

```dart
class Base {
  final Object? value;  // looks final...
  Base(this.value);
}

class Sneaky extends Base {
  int _count = 0;
  @override
  Object? get value => _count++ > 0 ? null : 'surprise';  // getter override!
  Sneaky() : super(null);
}
```

This is why Dart restricts field promotion to **private** final fields — a private field
cannot be overridden. TypeScript-Go's `identity` modifier explicitly declares the
stability guarantee, avoiding this visibility-based heuristic.

---

## 2. Null Safety — Sound Null Safety (Dart 2.12+)

### Sound by Default

Unlike TypeScript's `--strictNullChecks` (which is unsound in several edge cases),
Dart's null safety is **sound**:

```dart
String definitelyNotNull = 'hello';
String? maybeNull = null;

// Compile error: can't assign nullable to non-nullable
definitelyNotNull = maybeNull; // ERROR

// Must narrow first
if (maybeNull != null) {
  definitelyNotNull = maybeNull; // OK — promoted to String
}
```

### Flow Analysis Integration

Dart's null safety is enforced through flow analysis — the same mechanism used for
type promotion. The analyzer tracks definite assignment and null checks:

```dart
int? findIndex(List<String> items, String target) {
  for (var i = 0; i < items.length; i++) {
    if (items[i] == target) return i;
  }
  return null;
}

void example() {
  int? index = findIndex(['a', 'b'], 'b');
  if (index == null) return;

  // index is promoted to int (non-nullable) here
  print('Found at position ${index + 1}');
}
```

### Soundness Comparison

| Aspect                  | Dart                            | TypeScript                       |
|-------------------------|---------------------------------|----------------------------------|
| Null safety soundness   | Sound                           | Unsound (various holes)          |
| Narrowing mechanism     | Flow analysis (type promotion)  | CFA (control flow analysis)      |
| Invalidation tracking   | Built-in (final/var distinction)| Needs identity/mutator           |
| Unchecked escape hatch  | `!` operator (bang)             | `!` operator (non-null assert)   |
| Migration aid           | `late` keyword                  | No direct analog                 |

### The `late` Keyword

Dart's `late` allows deferred initialization of non-nullable variables:

```dart
late String name;  // non-nullable, but initialized later

void init() {
  name = 'Alice';  // must be assigned before first read
}
```

`late final` combines deferred init with finality — the variable can be assigned once,
but not at declaration time. This has no direct analog in TypeScript-Go's system, but it
demonstrates Dart's fine-grained control over initialization timing and mutability.

---

## 3. Type Promotion — Smart Casts with Explicit Invalidation

### How Type Promotion Works

Dart's type promotion is the closest production equivalent to TypeScript-Go's CFA
narrowing. When a type test succeeds, the variable is "promoted" to the narrower type
for subsequent code:

```dart
void process(Object value) {
  if (value is String) {
    // value is promoted to String
    print(value.length);          // OK
    print(value.toUpperCase());   // OK
  }
}
```

### Invalidation Rules — When Promotion Is Lost

Dart specifies **exactly when promotion is invalidated**. This is the most relevant
comparison to `identity`/`mutator`:

#### Rule 1: Assignment Invalidates Promotion

```dart
void example(Object value) {
  if (value is String) {
    print(value.length);  // promoted
    value = 42;           // assignment — promotion invalidated!
    // value is back to Object
  }
}
```

**TypeScript-Go analog:** Direct writes to the variable invalidate narrowing (Tier 1
heuristic — high confidence).

#### Rule 2: Non-final Fields Cannot Be Promoted

```dart
class C {
  Object? field;  // non-final

  void test() {
    if (field is String) {
      // NOT promoted — field could be changed by another reference
      field.length;  // ERROR
    }
  }
}
```

**TypeScript-Go analog:** Without `identity`, property narrowing is not preserved
across potential mutation points.

#### Rule 3: Closures Can Invalidate Local Promotion

```dart
void example() {
  Object value = 'hello';
  if (value is String) {
    // value is promoted to String
    void closure() {
      value = 42;  // closure can reassign value
    }
    // Dart does NOT invalidate here — closure hasn't been called yet
    // But if value is written in a closure that COULD have been called:
    print(value.length);  // Still promoted (closure not yet invoked)
  }
}
```

Dart's flow analysis is smart about closures: it tracks whether a closure that writes
to a variable has been **potentially executed** at a given point.

**TypeScript-Go analog:** Callback write analysis — Tier 2 heuristic. TypeScript-Go
conservatively invalidates at unknown callback invocations unless the callback is
proven not to write to the narrowed endpoint.

#### Rule 4: Functions Returning Never Can Refine Flow

```dart
Never throwError(String msg) => throw Exception(msg);

void example(Object? value) {
  if (value == null) throwError('null!');
  // value is promoted to Object (non-nullable) — throwError returns Never
  print(value.hashCode);
}
```

### Promotion in Pattern Matching (Dart 3)

Dart 3 introduced exhaustive pattern matching with promotion:

```dart
sealed class Shape {}
class Circle extends Shape { final double radius; Circle(this.radius); }
class Rect extends Shape { final double w, h; Rect(this.w, this.h); }

double area(Shape shape) => switch (shape) {
  Circle(radius: var r) => 3.14159 * r * r,
  Rect(w: var w, h: var h) => w * h,
};
```

Pattern-matched bindings are `final` by default — they cannot be invalidated. This is
analogous to destructured `const` bindings in TypeScript preserving narrowing.

### Complete Invalidation Comparison

| Invalidation Trigger     | Dart                         | TypeScript-Go                  |
|--------------------------|------------------------------|--------------------------------|
| Direct assignment        | Invalidates promotion        | Tier 1: invalidates narrowing  |
| Non-final field access   | Blocks promotion entirely    | Needs `identity` to preserve   |
| Method call on object    | Does not invalidate locals   | Tier 1-2: depends on receiver  |
| Unknown function call    | Does not invalidate locals   | Tier 3: conservative reset     |
| Closure write (potential)| Tracks closure execution     | Conservative invalidation      |
| Async gap (`await`)      | Invalidates for non-locals   | Invalidates at suspension      |

---

## 4. Streams and StreamController — Async Reactive Patterns

### The Stream Model

Dart's `Stream<T>` is the primary async reactive primitive — a sequence of asynchronous
events:

```dart
Stream<int> countUp(int max) async* {
  for (var i = 0; i < max; i++) {
    yield i;
    await Future.delayed(Duration(seconds: 1));
  }
}

void main() async {
  await for (var n in countUp(5)) {
    print(n);  // 0, 1, 2, 3, 4
  }
}
```

### StreamController — Imperative Push

`StreamController<T>` is the imperative counterpart — push values into a stream:

```dart
final controller = StreamController<String>();

controller.stream.listen((data) {
  print('Received: $data');
});

controller.add('hello');
controller.add('world');
await controller.close();
```

### Comparison to Signals

| Concept              | Dart Stream                    | Signal (Angular/Solid)         |
|----------------------|--------------------------------|--------------------------------|
| Creation             | `StreamController<T>()`        | `signal<T>(initial)`           |
| Push value           | `controller.add(value)`        | `signal.set(value)`            |
| Read current value   | N/A (streams are event-based)  | `signal()`                     |
| Subscribe            | `stream.listen(callback)`      | `effect(() => signal())`       |
| Transform            | `stream.map/where/expand`      | `computed(() => f(signal()))`  |
| Cleanup              | `controller.close()`           | Auto-disposed (framework)      |
| Backpressure         | Pause/resume subscription      | N/A (synchronous pull)         |

### Key Difference: Push vs Pull

Streams are **push-based** — producers push events to consumers. Signals are
**pull-based with notification** — consumers pull the current value when notified of a
change.

This distinction matters for type narrowing:

```dart
// Stream: each event is independent — no narrowing across events
stream.listen((event) {
  if (event is String) {
    // narrowed here, but only for THIS event
    // next event could be anything
  }
});
```

```typescript
// Signal: value persists — narrowing can be preserved across reads
const sig = signal<string | number>('hello');
if (typeof sig() === 'string') {
  // With identity: narrowing is preserved until a mutator invalidates
  sig().toUpperCase();  // valid if sig has identity
}
```

### StreamTransformer and Reactive Pipelines

Dart streams support typed transformation pipelines:

```dart
Stream<int> evenSquares(Stream<int> input) {
  return input
    .where((n) => n.isEven)
    .map((n) => n * n);
}
```

The type flows through each transformation stage automatically. This is analogous to
how `computed` signals derive their types from dependencies, but streams lack a concept
of "current value" — they only have "next event."

**TypeScript-Go relevance:** Stream transformations don't need `identity` because each
transformation stage produces a new stream. The original stream is not mutated. This
mirrors Elixir's immutable pipeline pattern — transformation creates new values rather
than mutating existing ones.

---

## 5. ValueNotifier/ChangeNotifier — Flutter's Observable State

### ValueNotifier

`ValueNotifier<T>` is Flutter's simplest observable state container:

```dart
final counter = ValueNotifier<int>(0);

// Read
print(counter.value);  // 0

// Write (notifies listeners)
counter.value = 1;

// Listen
counter.addListener(() {
  print('Changed to: ${counter.value}');
});
```

### ChangeNotifier

`ChangeNotifier` is the base class for custom observable models:

```dart
class CartModel extends ChangeNotifier {
  final List<String> _items = [];

  List<String> get items => List.unmodifiable(_items);

  void addItem(String item) {
    _items.add(item);
    notifyListeners();  // explicit notification
  }
}
```

### Mapping to identity/mutator

```dart
// Dart ChangeNotifier pattern
class UserModel extends ChangeNotifier {
  String? _name;           // private mutable state
  String? get name => _name;  // read endpoint — analogous to identity

  void setName(String n) {    // write operation — analogous to mutator
    _name = n;
    notifyListeners();         // explicit invalidation signal
  }
}
```

| ChangeNotifier Concept  | TypeScript-Go Analog           |
|-------------------------|--------------------------------|
| `get name`              | `identity get name()`          |
| `setName(n)`            | `mutator setName(n: string)`   |
| `notifyListeners()`     | Implicit via `links` clause    |
| `addListener(callback)` | Framework subscription (effect)|
| Private `_field`        | Internal state behind identity |
| `List.unmodifiable()`   | Defensive copy / readonly view |

### Key Pattern: Explicit Read/Write Separation

ChangeNotifier enforces a convention that TypeScript-Go formalizes at the type level:

1. **Reads** go through getters (stable, pure)
2. **Writes** go through methods that call `notifyListeners()` (explicit mutation)
3. **Listeners** are notified only when writes happen (invalidation propagation)

This is exactly the `identity`/`mutator` contract:
- `identity` = the getter is a stable read endpoint
- `mutator` = the method invalidates dependent narrowings
- `links` = the explicit connection between a mutator and the identities it invalidates

### ValueNotifier vs Signal

```dart
// Dart ValueNotifier
final count = ValueNotifier<int>(0);
count.value;        // read
count.value = 5;    // write + notify

// TypeScript-Go Signal (conceptual)
const count = signal<number>(0);
count();            // identity read
count.set(5);       // mutator write
```

The key difference: `ValueNotifier.value` collapses read and write into a single
property (`.value`), while signals separate them (`count()` vs `count.set()`). The
`identity`/`mutator` system requires this separation to be explicit — a single property
that is both read and written cannot be an `identity` endpoint.

---

## 6. Riverpod/Provider — Typed State Management

### Provider Architecture

Riverpod (the evolution of Flutter's Provider package) uses typed providers with
automatic dependency tracking:

```dart
// Define a provider
final counterProvider = StateNotifierProvider<CounterNotifier, int>(
  (ref) => CounterNotifier(),
);

class CounterNotifier extends StateNotifier<int> {
  CounterNotifier() : super(0);

  void increment() => state++;  // mutator
}

// Consume in a widget
class CounterPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);  // identity-like read
    return Text('$count');
  }
}
```

### Riverpod's Invalidation Model

Riverpod tracks dependencies automatically and invalidates when state changes:

```dart
final userProvider = FutureProvider<User>((ref) async {
  final id = ref.watch(userIdProvider);  // dependency
  return fetchUser(id);                   // re-fetches when userIdProvider changes
});
```

| Riverpod Concept         | TypeScript-Go Analog              |
|--------------------------|-----------------------------------|
| `ref.watch(provider)`    | `identity` read (subscribes)      |
| `ref.read(provider)`     | One-time read (no subscription)   |
| `state = newValue`       | `mutator` operation               |
| Provider dependency      | `links` (selective invalidation)  |
| `ref.invalidate(prov)`   | Explicit invalidation             |
| Auto-dispose             | No analog (manual cleanup)        |

### `ref.watch` vs `ref.read`

This distinction is critical:

```dart
// ref.watch — rebuilds widget when value changes (reactive)
final count = ref.watch(counterProvider);

// ref.read — reads once, no subscription (non-reactive)
final count = ref.read(counterProvider);
```

`ref.watch` is the `identity` analog — it declares "I depend on this value, and my
state is derived from it." `ref.read` is a one-shot read with no ongoing guarantee.

### Riverpod's Typed Provider Graph

Riverpod enforces a typed dependency graph:

```dart
// Provider A depends on Provider B
final greetingProvider = Provider<String>((ref) {
  final name = ref.watch(nameProvider);  // typed dependency
  return 'Hello, $name!';
});
```

This is analogous to a `links` clause applied at the provider level:

```typescript
// Hypothetical TypeScript-Go equivalent
class GreetingStore {
  identity get greeting(): string {
    return `Hello, ${nameStore.name}!`;
  }

  // greeting is invalidated when nameStore.name changes
  // In Riverpod, this is tracked automatically
  // In TypeScript-Go, links would declare this explicitly
}
```

**Key insight:** Riverpod's automatic dependency tracking achieves what `links` must
declare manually. Riverpod can do this because providers are a framework construct —
the framework owns the evaluation model. TypeScript-Go's `links` operates at the type
system level, where automatic tracking would require interprocedural analysis that
violates the non-goal of "no dependency-graph theorem proving."

---

## 7. Extension Types — Zero-Cost Abstractions (Dart 3.3)

### What Are Extension Types?

Dart 3.3 introduced **extension types** — a way to create a new type that wraps an
existing type with zero runtime cost:

```dart
extension type UserId(int id) {
  bool get isValid => id > 0;

  // Can define methods, getters, operators
  UserId operator +(int offset) => UserId(id + offset);
}

void main() {
  var userId = UserId(42);
  print(userId.id);       // 42
  print(userId.isValid);  // true

  // At runtime, userId is just an int — no wrapper object
  // Type safety is purely compile-time
}
```

### Extension Types and Identity

Extension types create an interesting scenario for `identity`:

```dart
extension type Signal<T>(T Function() read) {
  T call() => read();  // zero-cost wrapper around a function call
}

// Usage
Signal<int> count = Signal(() => someState.count);
if (count() > 0) {
  // Is count() still > 0 here? Depends on whether read() is stable
}
```

Extension types **erase at runtime** — there is no object identity, no vtable, no
runtime overhead. The narrowing question then becomes: is the **underlying
representation** stable?

### Comparison to TypeScript's Branded Types

| Concept              | Dart Extension Type            | TypeScript Branded Type          |
|----------------------|--------------------------------|----------------------------------|
| Runtime cost         | Zero (erased)                  | Zero (type-level only)           |
| Type safety          | Compile-time only              | Compile-time only                |
| Subtyping            | Explicitly controlled          | No subtyping (opaque)            |
| Method definition    | Yes (extension methods)        | No (use module functions)        |
| Identity guarantee   | Inherits from representation   | N/A                              |

### Relevance to identity/mutator

Extension types suggest an approach where `identity` could be defined for zero-cost
wrapper types. If a signal is just a branded function type, the `identity` modifier
applies to the call signature itself:

```typescript
// TypeScript-Go: branded signal type with identity
type Signal<T> = { (): T } & { __brand: 'Signal' };

// The call signature itself is the identity endpoint
declare function createSignal<T>(initial: T): [
  identity Signal<T>,                     // read
  mutator (value: T) => void              // write
];
```

This mirrors Dart's extension type pattern: the Signal is just a function call with
no runtime overhead, but the type system tracks stability guarantees.

---

## 8. Alternative Syntax Ideas — Dart's Invalidation Rules for TypeScript?

### Dart's Approach: Structural Promotion Rules

Dart's type promotion does not use explicit annotations — instead, it derives promotion
eligibility from structural properties of the declaration:

1. **Local variables:** Always promotable (unless written in a closure)
2. **Final private fields:** Promotable (cannot be overridden or reassigned)
3. **Everything else:** Not promotable

### Could TypeScript Adopt This?

#### Option A: `final`-based Promotion (Dart-like)

```typescript
// Hypothetical: final keyword as identity signal
class Store {
  final value: string | null;  // promotable — cannot be reassigned

  check() {
    if (this.value !== null) {
      this.value.toUpperCase();  // promoted — final guarantees stability
    }
  }
}
```

**Pros:**
- Familiar keyword (exists in many languages)
- Implies immutability after construction
- No need for separate `identity` annotation on reads

**Cons:**
- `final` prevents reassignment but not internal mutation (`final arr = []` — arr is
  still mutable)
- Conflates declaration-site immutability with read-site stability
- Doesn't handle computed/derived values (getters that compute but are stable)

#### Option B: Visibility-based Promotion (Dart's Private Rule)

```typescript
// Hypothetical: private + readonly = auto-identity
class Store {
  private readonly _value: string | null;

  check() {
    if (this._value !== null) {
      this._value.toUpperCase();  // auto-promoted — private readonly
    }
  }
}
```

**Pros:**
- Uses existing TypeScript constructs
- No new syntax required
- `private readonly` already implies the correct semantics

**Cons:**
- `private` is erased at runtime in TypeScript (not enforced like Dart)
- `#private` (true private fields) would work better but has ergonomic issues
- Doesn't extend to public APIs or interface contracts
- Doesn't handle callable getters (the primary `identity` use case)

#### Option C: Explicit Annotation (TypeScript-Go's Current Approach)

```typescript
class Store {
  identity get value(): string | null { return this._value; }
  mutator setValue(v: string | null): void { this._value = v; }
}
```

**Pros:**
- Works for all endpoint shapes (properties, getters, methods)
- Decoupled from visibility — public APIs can be identity
- Supports callable read endpoints (the `signal()` pattern)
- `links` enables selective invalidation

**Cons:**
- New keyword/modifier — cognitive overhead
- Must be manually applied (no inference from structure)
- Extra annotation burden compared to Dart's structural inference

### Dart-Inspired Hybrid Approach

A possible middle ground combines Dart's structural inference with explicit annotation
for edge cases:

```typescript
// Rule 1: readonly properties on classes with no setter — auto-identity
class Store {
  readonly value: string | null;  // auto-identity (like Dart's final private field)
}

// Rule 2: private #fields — auto-identity
class Counter {
  #count: number = 0;

  get value() { return this.#count; }  // auto-identity (reads private field)
  increment() { this.#count++; }       // auto-mutator (writes private field)
}

// Rule 3: explicit annotation for complex cases
class SignalStore {
  identity get derived(): string { return compute(this.dep); }
  mutator links(derived) reset(): void { this.dep = null; }
}
```

### Dart's Lesson for TypeScript-Go

Dart's type promotion system demonstrates that **structural inference can handle the
common case** (local variables, final private fields) while **explicit annotation
handles the rest**. TypeScript-Go's current approach starts with explicit annotation
(`identity`/`mutator`), with heuristic inference (Tier 1-3) serving as the structural
inference layer.

The crucial difference: Dart can rely on `final` because Dart has sound `final` semantics
— a `final` field genuinely cannot be reassigned. TypeScript's `readonly` is not sound
in the same way (it can be circumvented via type assertions, index signatures, and
mapped types). This unsoundness is precisely why TypeScript-Go needs an explicit
`identity` contract rather than inferring stability from `readonly`.

---

## Summary: Lessons from Dart

| Lesson                          | Dart Approach                  | TypeScript-Go Approach           |
|---------------------------------|--------------------------------|----------------------------------|
| Narrowing stability source      | `final` + private (structural) | `identity` (explicit)            |
| Invalidation trigger            | Assignment, non-final access   | `mutator` + heuristic tiers      |
| Selective invalidation          | N/A (all-or-nothing promotion) | `links` clause                   |
| Null safety soundness           | Sound                          | Unsound (pragmatic)              |
| Reactive state                  | ChangeNotifier / Riverpod      | Signals + identity               |
| Async reactivity                | Streams (push-based)           | Signals (pull + notify)          |
| Zero-cost wrappers              | Extension types                | Branded types (type-level)       |
| Dependency tracking             | Riverpod (automatic)           | `links` (manual declaration)     |
| Closure invalidation            | Tracks closure execution flow  | Conservative invalidation        |

### Core Takeaway

Dart is the closest mainstream language to TypeScript-Go's `identity`/`mutator` design
in terms of **the problem being solved** — both need narrowing stability for mutable
objects with potential aliasing. Dart's solution (structural inference from `final` +
private) works because Dart has sound `final` semantics and runtime-enforced privacy.
TypeScript cannot rely on these structural signals because `readonly` is unsound and
`private` is erased.

TypeScript-Go's explicit `identity`/`mutator`/`links` system is the pragmatic adaptation:
declare stability contracts explicitly rather than inferring them from structural
properties that TypeScript cannot soundly enforce. The heuristic tier system provides
inference where structural confidence is high (Tier 1-2), while explicit contracts handle
complex cross-cutting relationships that Dart's structural approach cannot express at all
(selective invalidation via `links`).

Flutter's ChangeNotifier/Riverpod ecosystem validates the read/write separation pattern
(`identity`/`mutator`) as the natural architecture for observable state. The convergence
is notable: Dart frameworks independently arrived at the same get/set/notify contract
that `identity`/`mutator`/`links` formalizes at the type system level.
