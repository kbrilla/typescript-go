# Design Review: Kotlin's Smart Casts and Property Delegates vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Kotlin's approach to flow-sensitive typing and mutable state invalidation with TypeScript-Go's identity CFA system

---

## 1. Smart Casts — Automatic Narrowing After Type Checks

### Kotlin's Model

Kotlin's "smart casts" perform automatic type narrowing after `is`/`!is` checks, null checks, and boolean conditions — without requiring explicit casts:

```kotlin
fun process(x: Any) {
    if (x is String) {
        println(x.length)  // x is automatically cast to String
    }
}

fun greet(name: String?) {
    if (name != null) {
        println(name.length)  // name is automatically cast to String (non-null)
    }
}
```

Smart casts also work with `when` (Kotlin's exhaustive match), `&&`/`||` chains, and negated conditions:

```kotlin
fun describe(x: Any): String = when (x) {
    is Int    -> "Integer: ${x + 1}"       // x narrowed to Int
    is String -> "String: ${x.uppercase()}" // x narrowed to String
    is List<*> -> "List of ${x.size}"       // x narrowed to List<*>
    else      -> "Unknown"
}
```

### When Smart Casts Are Invalidated

Kotlin invalidates smart casts when the compiler cannot prove the value remains stable:

1. **Mutable local variables (`var`) reassigned between check and use:**

```kotlin
var x: Any = "hello"
if (x is String) {
    x = 42          // reassignment
    x.length        // ERROR: smart cast impossible — x was reassigned
}
```

2. **Mutable properties (`var` on classes) — always rejected:**

```kotlin
class Holder {
    var value: Any = "hello"
}

fun test(h: Holder) {
    if (h.value is String) {
        h.value.length  // ERROR: smart cast impossible — 'value' is mutable property
    }
}
```

Even if nothing visibly mutates `h.value`, the compiler rejects the smart cast because *any* code path could mutate it, including another thread or a custom setter.

3. **Lambda captures of mutable variables:**

```kotlin
var x: Any = "hello"
val lambda = { x = 42 }
if (x is String) {
    x.length  // ERROR: smart cast impossible — x is captured and modified by lambda
}
```

4. **Open (non-final) properties with custom getters:**

```kotlin
open class Base {
    open val value: Any get() = "hello"  // could be overridden
}

fun test(b: Base) {
    if (b.value is String) {
        b.value.length  // ERROR: smart cast impossible — open property with getter
    }
}
```

### Comparison with TypeScript-Go

| Aspect | Kotlin Smart Casts | TypeScript-Go `identity` |
|--------|-------------------|------------------------|
| **Trigger** | `is`/`!is`, null checks, boolean guards | Narrowing of `identity` function return values |
| **Scope** | Local variables, `val` properties, parameters | `identity`-marked callable endpoints |
| **Invalidation** | Mutable var, open getter, lambda capture, reassignment | `mutator` call, unknown call, async boundary |
| **Default assumption** | `var` = unstable, `val` = stable | Unannotated = unstable, `identity` = stable |
| **Failure mode** | Compile error (won't narrow) | Narrowing loss (type widens) |
| **Opt-in vs opt-out** | `val`/`var` is mandatory on every declaration | `identity` is opt-in annotation |

The most important asymmetry: **Kotlin's stability guarantee is structural** (built into the `val`/`var` declaration system), while TypeScript-Go's is **declarative** (the `identity` modifier is a developer assertion). Kotlin's approach prevents unsound smart casts by construction; TypeScript-Go trusts the developer, consistent with TypeScript's philosophy.

---

## 2. `val` vs `var` — The Immutability Foundation

### Kotlin's Model

Every property and local variable in Kotlin must be declared as either `val` (read-only) or `var` (mutable):

```kotlin
val name = "Alice"   // immutable — cannot be reassigned
var age = 30         // mutable — can be reassigned

name = "Bob"         // ERROR: val cannot be reassigned
age = 31             // OK
```

This distinction is the **foundation** of smart casts. The compiler can prove `val` values don't change between a type check and subsequent use:

```kotlin
val x: Any = computeSomething()
if (x is String) {
    x.length    // OK: x is val, so smart cast is safe
}

var y: Any = computeSomething()
if (y is String) {
    // y.length  — would be OK only if y is not reassigned after the check
    // compiler performs flow analysis to determine if y escapes or is reassigned
}
```

### `val` Is Shallow Immutability

Crucially, `val` only prevents **reassignment** — it does not prevent mutation of the *contents*:

```kotlin
val list = mutableListOf(1, 2, 3)
list.add(4)           // OK: the list itself is mutated
// list = mutableListOf()  // ERROR: val cannot be reassigned
```

This means `val` is closer to JavaScript's `const` than to deep immutability. A `val` property with a custom getter can return different values each time:

```kotlin
val currentTime: Long
    get() = System.currentTimeMillis()  // returns different value each call!
```

Smart casts do **not** apply through such computed `val` properties, because the compiler detects the custom getter.

### val/var vs identity/mutator — Granularity Difference

| Kotlin `val`/`var` | TypeScript-Go `identity`/`mutator` |
|--------------------|------------------------------------|
| Property-level marker: "this binding is (im)mutable" | Method-level marker: "this callable is a stable read / a state mutation" |
| Binary choice on every declaration | Optional annotation on specific endpoints |
| Prevents reassignment structurally | Documents return-value stability semantically |
| Compiler enforces (hard guarantee) | Compiler trusts (soft assertion) |
| Affects smart cast eligibility automatically | Explicitly opts into CFA narrowing |

The key insight: Kotlin solves the "is this value stable?" question at the **declaration site** with a language-level `val`/`var` split. TypeScript-Go solves it at the **type-level** with an `identity` annotation on callable types. Kotlin's approach is more pervasive (every declaration participates), while TypeScript-Go's is more targeted (only annotated endpoints participate).

### `val` With Backing Fields vs Computed Properties

Kotlin distinguishes between `val` with a backing field (stable) and `val` with a custom getter (potentially unstable):

```kotlin
class User(val name: String)        // backing field — smart cast works
class Clock {
    val time get() = System.nanoTime()  // no backing field — smart cast blocked
}
```

This is directly analogous to the problem `identity` solves: how do you tell the compiler "this getter-like thing returns a stable value"? In Kotlin, stability is inferred from the presence of a backing field. In TypeScript-Go, it's explicitly declared with `identity`.

---

## 3. Property Delegates — `by lazy`, `by observable`, Custom Delegates

### Kotlin Delegation Model

Kotlin's `by` keyword delegates property access to another object implementing `getValue()` (and optionally `setValue()`):

```kotlin
class Example {
    val lazyValue: String by lazy {
        println("computed!")
        "Hello"
    }

    var observed: String by Delegates.observable("initial") { prop, old, new ->
        println("$old -> $new")
    }
}
```

Standard library delegates:

| Delegate | Type | Smart Cast? | Behavior |
|----------|------|-------------|----------|
| `by lazy` | `val` | No* | Computed once, cached thereafter |
| `by observable` | `var` | No | Mutable, fires callback on change |
| `by vetoable` | `var` | No | Mutable, can reject changes |
| `by map` | `val`/`var` | No | Backed by a `Map<String, Any?>` |
| Custom `ReadOnlyProperty` | `val` | No | Developer-defined `getValue()` |
| Custom `ReadWriteProperty` | `var` | No | Developer-defined `getValue()`/`setValue()` |

*`by lazy` is `val` and returns a stable value after initialization, but smart casts still don't work through it because the compiler treats all delegated properties as having custom getters.

### Why Delegated Properties Block Smart Casts

The compiler cannot inspect the delegate's `getValue()` implementation. From the compiler's perspective, `by lazy` and `by observable` are equally opaque — both route through a `getValue()` call that could return anything:

```kotlin
val x: Any by lazy { "hello" }
if (x is String) {
    x.length  // ERROR: smart cast impossible — delegated property
}
```

This is exactly the problem TypeScript-Go's `identity` modifier addresses: the compiler cannot *infer* stability from opaque call implementations, so the developer must *declare* it.

### The `by lazy` Parallel to Signals

`by lazy` has a fascinating structural similarity to read-only signals:

| `by lazy` | Signal/`identity` |
|-----------|-------------------|
| First access triggers computation | Signal reads return current reactive value |
| Subsequent accesses return cached value | `identity` reads return stable value in same flow |
| Value is immutable once computed | Identity-narrowed value is stable until mutation |
| Thread-safe (`LazyThreadSafetyMode`) | No concurrent access model (single-threaded JS) |

The difference: `by lazy` guarantees stability *forever* after first computation (it's truly immutable once set). `identity` guarantees stability only *within a CFA flow region* — a `mutator` call can change the value. This makes `identity` more like a re-evaluable `lazy` that can be invalidated.

### Custom Delegates as a Contract System

Kotlin's delegate protocol is itself a form of behavioral contract:

```kotlin
class LoggingDelegate<T>(private var value: T) : ReadWriteProperty<Any?, T> {
    override fun getValue(thisRef: Any?, property: KProperty<*>): T {
        println("Reading ${property.name}")
        return value
    }
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        println("Writing ${property.name}: $value")
        this.value = value
    }
}
```

The `ReadOnlyProperty` / `ReadWriteProperty` interface split maps loosely to `identity` / `mutator`:

| Kotlin | TypeScript-Go | Semantic |
|--------|--------------|----------|
| `ReadOnlyProperty<R, T>` | `identity () => T` | Read-only access surface |
| `ReadWriteProperty<R, T>` | `identity () => T` + `mutator (v: T) => void` | Read + write access surface |

But Kotlin doesn't use this split for smart cast eligibility — all delegated properties are equally opaque to the compiler. TypeScript-Go's innovation is making the read/write interface distinction *visible to the checker*.

---

## 4. Contracts — `kotlin.contracts`

### Overview

Kotlin's contract system (introduced in 1.3, still experimental as of Kotlin 2.x) allows functions to declare behavioral guarantees that the compiler uses for control flow analysis:

```kotlin
import kotlin.contracts.*

fun require(condition: Boolean) {
    contract {
        returns() implies condition  // if function returns normally, condition is true
    }
    if (!condition) throw IllegalArgumentException()
}

fun checkNotNull(value: Any?): Any {
    contract {
        returns() implies (value != null)
    }
    if (value == null) throw IllegalArgumentException()
    return value
}
```

### Contract Effects

Kotlin supports several contract effects:

| Effect | Meaning | Example |
|--------|---------|---------|
| `returns() implies condition` | If function returns, condition holds | `require(x != null)` enables smart cast |
| `returns(value) implies condition` | If function returns specific value, condition holds | `isString(x)` returning `true` implies `x is String` |
| `callsInPlace(lambda, kind)` | Lambda is called in a specific pattern | `run { }` calls lambda exactly once |

The `callsInPlace` contract is particularly interesting — it tells the compiler how a lambda argument is invoked:

```kotlin
inline fun <R> run(block: () -> R): R {
    contract {
        callsInPlace(block, InvocationKind.EXACTLY_ONCE)
    }
    return block()
}

val x: Int
run {
    x = 42  // OK: compiler knows this runs exactly once, so x is definitely assigned
}
println(x)  // OK: x is known to be initialized
```

### Comparison with `identity`/`mutator`/`links`

| Kotlin Contracts | TypeScript-Go `identity`/`mutator`/`links` |
|------------------|---------------------------------------------|
| **Purpose** | Communicate function behavior to compiler for CFA | Communicate read/write stability for CFA narrowing |
| **Mechanism** | `contract { }` block in function body | Modifier on type signature |
| **Scope** | Single function's behavior | Endpoint relationships on interfaces/types |
| **What it tells the compiler** | "If I return, condition X holds" / "I call this lambda N times" | "This returns stable values" / "This mutates state" / "This mutation affects these endpoints" |
| **Invalidation tracking** | No — contracts don't track invalidation | Yes — `mutator` + `links` explicitly model invalidation |
| **Experimental status** | Still experimental after ~7 years | New design, not yet in stable TS |

### What Contracts Get Right

1. **`returns() implies X`** is the closest Kotlin analogue to TypeScript's type predicates (`x is T`). Both allow user-defined functions to participate in narrowing.

2. **`callsInPlace`** solves a problem TypeScript-Go also faces: how to handle lambdas/callbacks passed to higher-order functions. TypeScript-Go's approach is to treat callback boundaries as uncertainty boundaries that invalidate narrowing. Kotlin's `callsInPlace` offers a more precise but more verbose alternative.

### What Contracts Lack

Kotlin contracts have **no concept of invalidation**. They tell the compiler "these facts become true" but never "these facts become false." This is the critical gap that `mutator`/`links` fills:

```kotlin
// Kotlin contracts: can assert facts, but cannot invalidate them
fun setValue(x: Int) {
    contract {
        // No way to say: "after this call, previous narrowing on getValue() is invalid"
    }
}
```

TypeScript-Go's system explicitly models the **lifecycle of type facts**: creation (via `identity` read + narrowing), invalidation (via `mutator` call), and selective invalidation (via `links`). Kotlin contracts are unidirectional — they only create facts.

### Could Kotlin Benefit from `links`-Style Contracts?

Yes. Consider this Kotlin pattern:

```kotlin
class Store {
    var data: String? = null

    fun getData(): String? = data    // effectively identity
    fun setData(v: String?) { data = v }  // effectively mutator
}

fun test(store: Store) {
    if (store.getData() != null) {
        // store.getData()!!.length  — no smart cast, getData() is opaque call
        // Even if Kotlin could narrow through getData(), it has no way to know
        // that setData() invalidates it
    }
}
```

Currently Kotlin handles this by relying on direct property access (`store.data`) which participates in smart casts for `val` but not `var`. Function calls are never smart-cast targets. TypeScript-Go's `identity` extends narrowing to function-call-based APIs, which Kotlin cannot do even with contracts.

---

## 5. Flow-Sensitive Typing — Kotlin's Compiler CFA

### How Smart Casts Work Under the Hood

Kotlin's compiler performs flow-sensitive type analysis using a data flow framework. At each program point, the compiler maintains a set of type facts:

```kotlin
fun example(x: Any?) {
    // Facts: {x: Any?}
    if (x == null) return
    // Facts: {x: Any}  (null eliminated by early return)
    if (x is String) {
        // Facts: {x: String}  (narrowed by is-check)
        println(x.length)
    }
    // Facts: {x: Any}  (is-check only applies in true branch)
}
```

### Smart Cast Stability Rules

The compiler evaluates stability at each smart cast usage point:

1. **Local `val`**: Always stable. Smart casts always work.
2. **Local `var`**: Stable if not reassigned between check and use, and not captured by a mutating lambda.
3. **`val` property with backing field**: Stable if the property is `final` (not `open`), and has no custom getter.
4. **`val` property with custom getter**: Never stable (getter could return different values).
5. **`var` property**: Never stable (could be reassigned at any time).
6. **Delegated property**: Never stable (delegate `getValue()` is opaque).

### Comparison with TypeScript's CFA

| Aspect | Kotlin CFA | TypeScript CFA | TypeScript-Go `identity` CFA |
|--------|-----------|----------------|------------------------------|
| **Narrowing triggers** | `is`, `!is`, null checks, `when`, boolean guards | `typeof`, `instanceof`, discriminant checks, user predicates | Same as TS + repeated `identity` call narrowing |
| **Narrowing scope** | Until reassignment, branch exit, or stability violation | Until assignment, branch exit, or function call boundary | Until `mutator` call, uncertainty boundary, or branch exit |
| **Function call narrowing** | Not supported — calls never narrow | Not supported for repeated calls | Supported for `identity`-marked calls |
| **Property narrowing** | Only `val` with backing field and `final` | Properties narrow (but not through function calls) | Properties + `identity` callables |
| **Mutable invalidation** | Structural: `var` blocks smart casts | Heuristic: assignments invalidate | Explicit: `mutator` calls invalidate |
| **Callback handling** | `callsInPlace` contract for lambda stability | Callbacks invalidate narrowing | Callbacks are uncertainty boundaries |

### Key Difference: What Is "Opaque"

In Kotlin, **function calls** are the opacity boundary — no function call result can be smart-cast based on a prior call. In TypeScript, **property accesses** can be narrowed but **function calls** return independent values. TypeScript-Go's `identity` moves the opacity boundary: `identity`-marked calls are treated as transparent (like property access) while unmarked calls remain opaque.

```kotlin
// Kotlin: ALL function calls are opaque
fun getValue(): String? = "hello"
if (getValue() != null) {
    getValue()!!  // must use !! — no smart cast through function call
}
```

```typescript
// TypeScript-Go: identity calls are transparent
declare const getValue: identity () => string | undefined;
if (getValue() !== undefined) {
    getValue().toUpperCase();  // OK — identity enables narrowing
}
```

This is arguably TypeScript-Go's most significant innovation compared to Kotlin: extending narrowing to function-call-based interfaces. Kotlin requires workarounds (store in local `val`, use direct property access), while TypeScript-Go allows the API to self-document its stability.

---

## 6. Sealed Classes and `when` — Exhaustive Pattern Matching

### Kotlin's Sealed Hierarchies

Sealed classes/interfaces restrict which classes can extend them to the same compilation unit:

```kotlin
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val message: String) : Result<Nothing>()
    data object Loading : Result<Nothing>()
}

fun handle(result: Result<String>): String = when (result) {
    is Result.Success -> result.data.uppercase()  // narrowed to Success<String>
    is Result.Error   -> "Error: ${result.message}" // narrowed to Error
    is Result.Loading -> "Loading..."               // narrowed to Loading
    // no else needed — exhaustive
}
```

### Exhaustiveness and Smart Casts

The `when` expression on a sealed type:
1. Requires exhaustive handling of all subtypes (or an `else` branch).
2. Performs smart casts in each branch.
3. The compiler can prove no other subtypes exist at runtime.

This is directly analogous to TypeScript's discriminated unions:

```typescript
type Result<T> =
    | { kind: "success"; data: T }
    | { kind: "error"; message: string }
    | { kind: "loading" };

function handle(result: Result<string>): string {
    switch (result.kind) {
        case "success": return result.data.toUpperCase();  // narrowed
        case "error":   return `Error: ${result.message}`;  // narrowed
        case "loading": return "Loading...";                 // narrowed
    }
}
```

### Sealed Classes + `identity` — The Signal Pattern

Consider how a Kotlin-style sealed class models the signal pattern:

```kotlin
sealed class Signal<out T> {
    abstract val value: T     // val — smart cast eligible
    // No setter in sealed base — mutations go through subclasses
}

class MutableSignal<T>(override var value: T) : Signal<T>()
// var — smart cast NOT eligible on MutableSignal.value

fun observe(signal: Signal<String?>) {
    if (signal.value != null) {
        // Smart cast only works if signal.value is a final val with backing field
        // For Signal<T>, value is abstract — so NO smart cast
        // For MutableSignal<T>, value is var — so NO smart cast
    }
}
```

Kotlin's sealed classes cannot solve the "stable read through an interface" problem because:
1. Abstract `val` properties are not smart-cast eligible (they could be overridden with custom getters).
2. Concrete `var` properties are not smart-cast eligible (they could be reassigned).

TypeScript-Go's `identity` solves this directly: the signal's read function is marked `identity`, telling the compiler to treat it as stable regardless of the underlying implementation.

### Sealed Interfaces and Exhaustive Narrowing

Kotlin 1.5+ added sealed interfaces, allowing multiple inheritance in sealed hierarchies:

```kotlin
sealed interface Shape
data class Circle(val radius: Double) : Shape
data class Rect(val width: Double, val height: Double) : Shape
```

This is structurally identical to TypeScript's discriminated union pattern. The exhaustiveness guarantees are the same — the compiler knows all possible shapes. The difference is *where* the discrimination happens: Kotlin uses `is` checks (nominal), TypeScript uses discriminant property checks (structural).

Neither Kotlin's sealed classes nor TypeScript's discriminated unions inherently address the **read stability** problem that `identity` solves. Exhaustive matching tells you "I've handled all cases" but not "the case I checked is still the case when I use the value later." `identity` addresses this temporal stability concern.

---

## 7. StateFlow / MutableStateFlow — Kotlin's Reactive State

### Overview

Kotlin's coroutines library provides `StateFlow` / `MutableStateFlow` as the primary reactive state container:

```kotlin
interface StateFlow<out T> : SharedFlow<T> {
    val value: T  // always has a current value
}

interface MutableStateFlow<T> : StateFlow<T>, MutableSharedFlow<T> {
    override var value: T  // mutable!
    fun compareAndSet(expect: T, update: T): Boolean
}
```

### The Read/Write Split

`StateFlow` / `MutableStateFlow` is an almost exact structural match for the signal pattern that motivated `identity`:

| Kotlin | TypeScript Signal | TypeScript-Go |
|--------|------------------|---------------|
| `StateFlow<T>.value` (read-only `val`) | `signal()` (read) | `identity () => T` |
| `MutableStateFlow<T>.value = x` (mutable `var`) | `signal.set(x)` (write) | `mutator (v: T) => void` |
| `MutableStateFlow<T>.update { }` (atomic update) | `signal.update(fn)` (transform) | `mutator update(fn: (T) => T): void` |
| `StateFlow<T>.collect { }` (observe) | `effect(() => { })` (reactive) | (out of scope) |

### Smart Cast Behavior with StateFlow

Because `MutableStateFlow.value` is a `var` property, smart casts **do not work**:

```kotlin
val flow = MutableStateFlow<String?>("hello")

if (flow.value != null) {
    flow.value.length  // ERROR: smart cast impossible — 'value' is mutable
}
```

Kotlin developers must work around this with local variables:

```kotlin
val flow = MutableStateFlow<String?>("hello")

val current = flow.value  // snapshot into local val
if (current != null) {
    current.length  // OK: local val, smart cast works
}
```

This is the exact pattern TypeScript developers use today for signal-style APIs. TypeScript-Go's `identity` modifier eliminates this workaround by allowing the compiler to narrow through the `identity`-marked read directly.

### Comparison: StateFlow Smart Cast Pain Points

The Kotlin community has extensively discussed smart cast limitations with StateFlow:

1. **Repetitive local variable extraction**: Every narrowing check requires storing in a `val` first.
2. **Verbose null handling**: `flow.value?.let { ... }` or explicit `val v = flow.value; if (v != null) ...`.
3. **Inconsistency with property behavior**: `val` properties smart-cast, but `var` properties don't, even when access is single-threaded and safe.
4. **No way to annotate stability**: Kotlin has no `identity`-equivalent to say "this var property is stable for the duration of this block."

TypeScript-Go's system addresses all four pain points:

| StateFlow Pain Point | TypeScript-Go Solution |
|---------------------|----------------------|
| Local variable extraction | `identity` enables direct narrowing |
| Verbose null handling | Narrowing works through `identity` calls |
| Inconsistency | `identity`/`mutator` provides consistent opt-in model |
| No stability annotation | `identity` **is** the stability annotation |

### Thread Safety vs Single-Threaded Model

A crucial difference: Kotlin's refusal to smart-cast `var` properties is partly motivated by **thread safety**. Multiple coroutines could read and write `MutableStateFlow.value` concurrently, making any smart cast potentially unsound:

```kotlin
// Thread 1
if (flow.value != null) {
    // Thread 2 sets flow.value = null here
    flow.value.length  // NPE at runtime!
}
```

TypeScript/JavaScript is **single-threaded** (with async interleaving). `identity` narrowing is safe between synchronous control flow points — no other thread can mutate the value. The only invalidation risk is from explicit mutation calls or async suspension points, which `mutator` and uncertainty boundaries handle.

This means `identity` can be stronger than what Kotlin's smart casts offer for `var` properties, because the single-threaded execution model eliminates the primary soundness concern.

---

## 8. Alternative Syntax Ideas — Could TypeScript Adopt `val`/`var`?

### The Question

Could TypeScript adopt Kotlin-style `val`/`var` markers on declarations instead of (or in addition to) `identity`/`mutator` on callable types?

### What `val`/`var` Would Look Like in TypeScript

```typescript
// Hypothetical val/var for properties
interface Store {
    val user(): User | undefined;    // stable read — like identity
    var settings: Settings;          // mutable — smart casts blocked
}

// Hypothetical val/var for function returns
val function getUser(): User | undefined { ... }  // stable
var function setUser(u: User): void { ... }        // mutating
```

### Why This Doesn't Work for TypeScript

1. **TypeScript already has `readonly`:**

TypeScript uses `readonly` for immutable properties, which is structurally equivalent to `val`:

```typescript
interface Store {
    readonly name: string;     // ~ val
    age: number;               // ~ var
}
```

But `readonly` applies to **properties**, not **function calls**. A `readonly` function call still returns a potentially different value each time:

```typescript
interface Clock {
    readonly getTime: () => number;  // readonly binding, but getTime() returns different values!
}
```

`identity` fills the gap that `readonly` cannot: it marks the *return value* as stable, not just the *binding*.

2. **`val`/`var` is declaration-level; `identity`/`mutator` is type-level:**

Kotlin's `val`/`var` is a property of the *declaration*. TypeScript-Go's `identity`/`mutator` is a property of the *type*. This matters for higher-order programming:

```typescript
// identity is part of the type — can be passed, composed, aliased
type StableRead<T> = identity () => T;
type StateMutation<T> = mutator (v: T) => void;

// val/var would be part of the declaration — lost when passed as value
function accept(read: StableRead<string>) {
    // caller knows read is identity, can narrow through it
}
```

Making stability a type-level concept rather than a declaration-level concept is more expressive and composes better with TypeScript's structural type system.

3. **No `links` equivalent in `val`/`var`:**

`val`/`var` is binary: immutable or mutable. There's no way to express "this mutation affects *this specific* read endpoint":

```kotlin
// Kotlin: no way to say "setUser invalidates user() but not settings()"
var user: User?
var settings: Settings?
fun setUser(u: User?) { user = u }  // implicitly affects user, not settings
```

TypeScript-Go's `links` clause provides this selective invalidation, which `val`/`var` fundamentally cannot express:

```typescript
interface Store {
    identity user(): User | undefined;
    identity settings(): Settings | undefined;
    mutator setUser(v: User) links user;       // selective!
    mutator resetAll() links user, settings;    // multi-target!
}
```

4. **TypeScript struct type system is structural, not nominal:**

Kotlin's `val`/`var` works because Kotlin has a nominal type system where the compiler tracks individual declarations. TypeScript's structural type system means two types are compatible if they have the same shape — there's no inherent "declaration identity" to attach `val`/`var` to across structural boundaries.

### What TypeScript *Could* Borrow from Kotlin

1. **Inferred stability for `readonly` properties**: TypeScript already narrows `readonly` properties. This could be extended to `readonly` getters — if a getter is `readonly` and has no setter, it's effectively `identity`.

2. **Smart cast diagnostics**: Kotlin's error messages for smart cast failures are excellent — they explain *why* the smart cast is impossible ("variable is captured and modified by lambda", "property is mutable"). TypeScript-Go could emit similar guidance diagnostics when `identity` narrowing is invalidated.

3. **`callsInPlace`-style contracts for callbacks**: Instead of treating all callback boundaries as uncertainty boundaries, TypeScript-Go could (in a future phase) allow functions to declare that they call a callback synchronously and exactly once, preserving narrowing across the call. This mirrors Kotlin's `callsInPlace` contract.

### Recommendation

`val`/`var` is not a viable alternative to `identity`/`mutator` for TypeScript because:
- TypeScript already has `readonly` for the declaration-level concern.
- `identity`/`mutator` operates at the type level, which is necessary for structural typing and higher-order composition.
- `links` provides selective invalidation that `val`/`var` cannot express.

The `identity`/`mutator`/`links` design is TypeScript-native — it works with TypeScript's structural type system, gradual typing philosophy, and existing `readonly` semantics rather than against them.

---

## 9. Summary Comparison Matrix

| Dimension | Kotlin | TypeScript-Go | Verdict |
|-----------|--------|--------------|---------|
| **Narrowing after checks** | Smart casts (automatic) | CFA narrowing + `identity` for calls | TS-Go extends narrowing to callables |
| **Stability declaration** | `val` / `var` (structural) | `identity` / `mutator` (declarative) | Different levels — both valid |
| **Stability enforcement** | Compiler-enforced (hard) | Developer-asserted (soft) | Kotlin is sounder; TS-Go is more flexible |
| **Function call narrowing** | Never (calls are opaque) | `identity` calls can be narrowed | TS-Go innovation — Kotlin can't do this |
| **Invalidation model** | Implicit (`var` blocks, lambda captures) | Explicit (`mutator` + `links`) | TS-Go is more precise and granular |
| **Property delegates** | Opaque to smart casts | `identity` makes callable delegates transparent | TS-Go addresses Kotlin's limitation |
| **Contracts** | `returns() implies`, `callsInPlace` | `identity`, `mutator`, `links` | Different focus: truth-assertion vs stability-tracking |
| **Sealed type narrowing** | `when` + `is` exhaustive matching | `switch` + discriminant checks | Equivalent expressiveness |
| **Reactive state (StateFlow)** | `var` blocks smart casts | `identity` enables narrowing | TS-Go directly solves StateFlow's pain |
| **Threading model** | Multi-threaded (coroutines) | Single-threaded (event loop) | TS-Go's model is safer for `identity` |
| **Selective invalidation** | Not supported | `links` clause | Unique to TypeScript-Go |

## 10. Conclusion

Kotlin's smart cast system provides the closest prior art to TypeScript-Go's `identity` narrowing. Both systems address the same fundamental question: *when can the compiler trust that a value hasn't changed between a type check and its use?*

Kotlin answers with **structural immutability** (`val` vs `var`) — the compiler knows at the declaration level whether a value can change. This is sound and predictable but inflexible: function calls, delegated properties, mutable state containers (StateFlow), and abstract properties are all excluded from smart casts, even when they are practically stable.

TypeScript-Go answers with **declared stability** (`identity` modifier) — the developer asserts that a callable endpoint returns a stable value, and the compiler trusts this assertion for CFA purposes. This is more flexible than Kotlin's approach, enabling narrowing through function calls, signal-style APIs, and callable interfaces that Kotlin cannot narrow through.

The most important insight from the Kotlin comparison: **Kotlin's smart cast limitations with `var`, StateFlow, and delegates are exactly the pain points that `identity` addresses.** Kotlin developers routinely work around these limitations by extracting values into local `val` variables — the `identity` modifier eliminates this workaround at the type system level.

The `links` clause has no Kotlin analogue. Kotlin's invalidation model is all-or-nothing: a `var` property *always* blocks smart casts, regardless of whether a specific mutation actually affects the checked value. `links` provides the granularity that Kotlin lacks, enabling selective invalidation that preserves narrowing on unaffected endpoints.

TypeScript-Go's design correctly adapts Kotlin's smart cast philosophy for a structurally-typed, gradually-typed language: keeping the core insight (distinguish stable reads from mutating writes) while replacing Kotlin's structural enforcement with type-level declarations that compose naturally with TypeScript's existing type system.
