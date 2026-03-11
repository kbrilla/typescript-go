# Design Review: Scala's val/var, Optics, and Sealed Traits vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Scala's immutability model, optics libraries, sealed hierarchies, and effect systems with TypeScript-Go's identity CFA system

---

## 1. `val` vs `var` — Immutable/Mutable Variable Distinction

### Scala's Model

Scala makes the read/write contract a first-class syntactic choice at every binding site:

```scala
val name: String = "Alice"   // immutable — no reassignment allowed
var counter: Int = 0         // mutable — reassignment permitted

name = "Bob"    // ERROR: reassignment to val
counter += 1    // OK: var allows mutation
```

This distinction permeates the entire language:

```scala
class Person(val name: String, var age: Int)

val p = Person("Alice", 30)
p.name = "Bob"  // ERROR: name is val (stable)
p.age = 31      // OK: age is var (mutable)
p.age += 1      // OK: read-modify-write on var
```

`val` parameters in class constructors generate only a getter. `var` parameters generate both getter and setter. The Scala compiler uses this information for two purposes:

1. **Stability for path-dependent types** — `val` members are "stable" and can appear in path-dependent type expressions (`p.name.type`). `var` members cannot.
2. **Pattern matching exhaustiveness** — the compiler can trust `val` members won't change between a match and a use.

### Smart Cast Implications

Scala doesn't have Kotlin-style smart casts, but its `val`/`var` distinction feeds into pattern matching safety:

```scala
sealed trait Shape
case class Circle(radius: Double) extends Shape
case class Rect(w: Double, h: Double) extends Shape

def area(s: Shape): Double = s match {
  case Circle(r) => Math.PI * r * r
  case Rect(w, h) => w * h
  // exhaustive — compiler verifies all cases covered
}
```

Because case class parameters are `val` by default, the destructured bindings `r`, `w`, `h` are immutable — the compiler knows their values won't change between the pattern match and the body.

### Comparison with `identity`/`mutator`

| Aspect | Scala `val`/`var` | TypeScript-Go `identity`/`mutator` |
|--------|-------------------|-------------------------------------|
| **Granularity** | Per-binding (variable, parameter, field) | Per-callable (function/method) |
| **Stability guarantee** | `val` is permanently immutable after initialization | `identity` asserts type consistency across repeated calls |
| **Mutation indication** | `var` allows arbitrary reassignment | `mutator` marks specific functions as invalidating |
| **Scope** | Declaration-site — baked into the binding | Declaration-site on the callable signature |
| **Flow sensitivity** | No flow narrowing from `val`/`var` | CFA narrows `identity` reads, invalidates at `mutator` calls |
| **Path-dependent types** | `val` enables `x.type` singleton types | `identity` enables narrowed type on repeated reads |
| **Override safety** | `val` can override `val`; `var` cannot override `val` | `identity` contract inherited through interface hierarchy |

### Key Insight: Declaration-Level vs Flow-Level Immutability

Scala's `val` provides **declaration-level immutability** — the binding itself can never change. This is stronger than `identity` in one sense (the value literally cannot differ between reads) but weaker in another (it says nothing about the *type* evolving through CFA).

TypeScript-Go's `identity` operates at the **flow level** — the same callable may return different runtime values, but the CFA system tracks the narrowed type through control flow. The `mutator` then acts as the explicit invalidation point, unlike Scala where `var` simply allows any write at any time.

Scala's model is simpler but also coarser: a `var` field invalidates *everything* (no smart casts possible on any `var`), whereas TypeScript-Go's `links` allows selective invalidation — a `mutator` for field A doesn't need to invalidate the narrowing of field B.

---

## 2. Case Classes and `copy` — Immutable Data with Functional Updates

### Scala's Model

Case classes are Scala's primary tool for immutable data modeling:

```scala
case class User(name: String, age: Int, role: Role)

val alice = User("Alice", 30, Admin)

// Functional update via copy — creates a new instance
val olderAlice = alice.copy(age = 31)
// olderAlice: User("Alice", 31, Admin)

// alice is unchanged — immutable
assert(alice.age == 30)
```

The compiler generates `copy` with named parameters matching the constructor. All fields are `val` by default in case classes, so the original instance is guaranteed unchanged.

### Structural Equality and Pattern Matching

Case classes also get `equals`, `hashCode`, `toString`, and `unapply` (extractor) for free:

```scala
val u1 = User("Alice", 30, Admin)
val u2 = User("Alice", 30, Admin)
u1 == u2  // true — structural equality, not referential

u1 match {
  case User(name, age, Admin) => s"$name is an admin, age $age"
  case User(name, _, Viewer) => s"$name is a viewer"
}
```

### Comparison with TypeScript-Go

The functional update pattern (`copy`) is relevant to `identity`/`mutator` because it represents **mutation-free state transitions**:

```typescript
// TypeScript equivalent of case class copy
interface User {
  readonly name: string;
  readonly age: number;
  readonly role: Role;
}

const olderAlice: User = { ...alice, age: 31 };
```

With `identity` CFA, a functional update creates a **new reference** — so any `identity` narrowing on the old reference remains valid:

```typescript
declare const getUser: identity () => User | undefined;

if (getUser() !== undefined) {
  // narrowed: getUser() is User
  const updated = { ...getUser(), age: 31 };  // does NOT invalidate getUser's narrowing
  getUser().name.toUpperCase();  // still valid — no mutator was called
}
```

In contrast, an imperative update through a `mutator` would invalidate:

```typescript
declare const setUser: mutator (u: User) => void links getUser;

setUser({ ...getUser()!, age: 31 });
getUser()!.name.toUpperCase();  // must re-narrow — setUser invalidated getUser
```

### Key Insight: Functional vs Imperative State Transition

Scala's case class `copy` makes the "no invalidation needed" case syntactically obvious — the old immutable value is untouched, and a new value is created. TypeScript doesn't have case classes, so `identity`/`mutator` must encode this distinction at the API level: only `mutator` calls invalidate, spread-based functional updates do not.

---

## 3. Optics (Monocle) — Lenses, Prisms, and Traversals

### Monocle's Model

[Monocle](https://www.optics.dev/Monocle/) is Scala's optics library, providing composable abstractions for accessing and modifying nested immutable data:

```scala
import monocle.macros.GenLens
import monocle.Lens

case class Address(street: String, city: String)
case class Person(name: String, address: Address)

// Lens: focuses on a single field within a product type
val addressLens: Lens[Person, Address] = GenLens[Person](_.address)
val cityLens: Lens[Address, String] = GenLens[Address](_.city)

// Composition: chain lenses to reach deeply nested fields
val personCityLens: Lens[Person, String] = addressLens.andThen(cityLens)

val alice = Person("Alice", Address("123 Main", "Springfield"))

// Read through composed lens
personCityLens.get(alice)  // "Springfield"

// Functional update through composed lens
val moved = personCityLens.replace("Shelbyville")(alice)
// Person("Alice", Address("123 Main", "Shelbyville"))
```

**Key optics types:**

| Optic | Focus | Read | Write | Analogy |
|-------|-------|------|-------|---------|
| `Lens[S, A]` | Exactly one `A` in `S` | `get: S => A` | `replace: A => S => S` | Field accessor |
| `Prism[S, A]` | Zero or one `A` in `S` | `getOption: S => Option[A]` | `replace: A => S => S` | Union case selector |
| `Traversal[S, A]` | Zero or many `A`s in `S` | `getAll: S => List[A]` | `modify: (A => A) => S => S` | Collection focus |
| `Optional[S, A]` | Zero or one `A` in `S` | `getOption: S => Option[A]` | `replace: A => S => S` | Optional field |
| `Iso[S, A]` | Exactly one `A` (bijection) | `get: S => A` | `reverseGet: A => S` | Type alias |

### How Optics Handle the Read/Write Split

Every optic has a **read side** (get, getOption, getAll) and a **write side** (replace, modify). The critical property is that all writes are **functional** — they produce a new `S` rather than mutating in place:

```scala
// modify: applies a function to the focused value, returns new outer structure
val uppercasedCity = personCityLens.modify(_.toUpperCase)(alice)
// Person("Alice", Address("123 Main", "SPRINGFIELD"))

// alice is unchanged
assert(personCityLens.get(alice) == "Springfield")
```

This means optics **never invalidate** in the identity/mutator sense — every operation preserves the old value and produces a new one.

### Comparison with `links`

Monocle's optics and TypeScript-Go's `links` solve overlapping problems — **tracking which writes affect which reads** — but from opposite directions:

| Aspect | Monocle Optics | TypeScript-Go `links` |
|--------|---------------|----------------------|
| **Paradigm** | Functional — all writes produce new values | Imperative — writes mutate in place |
| **Composition** | `lens1.andThen(lens2)` — composable paths | `mutator fn() links a, b` — explicit listing |
| **Read tracking** | Built into the optic type (`get`, `getAll`) | `identity` callable annotations |
| **Write tracking** | Built into the optic type (`replace`, `modify`) | `mutator` + `links` clause |
| **Invalidation** | Not needed — old values are never changed | Core feature — `links` specifies which `identity` reads to invalidate |
| **Nested access** | Natural — lens composition follows the structure | Would require per-level `identity`/`mutator` pairs |
| **Type safety** | Fully type-safe — optic types encode source and focus | Checked at declaration — `links` targets must be valid `identity` endpoints |
| **Granularity** | Arbitrary depth — compose lenses to any nesting level | Per-callable granularity — one `links` clause per `mutator` |

### Optic Composition as Implicit Links

In Monocle, composing a `Lens[Person, Address]` with a `Lens[Address, String]` automatically creates a `Lens[Person, String]` that knows exactly which sub-structure it focuses on. The read/write relationship is encoded in the type:

```scala
// The composed lens knows that modifying city:
// 1. Reads: Person => String (address.city path)
// 2. Writes: String => Person => Person (replaces along the same path)
// 3. Does NOT affect: Person.name, Address.street, etc.
```

This is structurally equivalent to what `links` encodes declaratively:

```typescript
interface Person {
  identity name(): string;
  identity city(): string;  // morally: composed lens through address

  mutator setCity(c: string) links city;  // only invalidates city, not name
}
```

The optics approach derives the "links" relationship from composition. TypeScript-Go's `links` states it explicitly. The tradeoff:

- **Optics**: more principled (the relationship is structural), but requires a functional programming paradigm and optics library adoption.
- **`links`**: more pragmatic (works with imperative mutation), but the developer must manually specify which reads each write affects.

### Prisms and Discriminated Unions

Monocle's `Prism` is particularly relevant to TypeScript discriminated unions:

```scala
sealed trait Shape
case class Circle(radius: Double) extends Shape
case class Rect(w: Double, h: Double) extends Shape

import monocle.Prism

val circlePrism: Prism[Shape, Circle] = Prism.partial[Shape, Circle] {
  case c: Circle => c
}(identity)

circlePrism.getOption(Circle(5.0))  // Some(Circle(5.0))
circlePrism.getOption(Rect(3, 4))   // None
```

This maps to TypeScript's discriminated union narrowing — a `Prism` is essentially a type guard that focuses on one case of a union. With `identity`, this pattern becomes:

```typescript
type Shape = { kind: "circle"; radius: number } | { kind: "rect"; w: number; h: number };

declare const getShape: identity () => Shape;

if (getShape().kind === "circle") {
  getShape().radius;  // narrowed — identity preserves the discriminant check
}
```

---

## 4. Sealed Traits and `match` — Exhaustive Pattern Matching

### Scala's Model

`sealed` restricts all subtypes to the same file, enabling the compiler to verify exhaustive matching:

```scala
sealed trait Result[+A]
case class Success[A](value: A) extends Result[A]
case class Failure(error: String) extends Result[Nothing]

def handle[A](r: Result[A]): String = r match {
  case Success(v) => s"Got: $v"
  case Failure(e) => s"Error: $e"
  // No default needed — compiler knows these are the only cases
}
```

If a case is missing, the compiler emits a warning:

```scala
def incomplete[A](r: Result[A]): String = r match {
  case Success(v) => s"Got: $v"
  // WARNING: match may not be exhaustive — missing case: Failure
}
```

### Nested Matching and Guards

Scala's pattern matching supports deep destructuring and guards:

```scala
sealed trait Expr
case class Lit(value: Int) extends Expr
case class Add(left: Expr, right: Expr) extends Expr
case class Mul(left: Expr, right: Expr) extends Expr

def eval(e: Expr): Int = e match {
  case Lit(v)                    => v
  case Add(Lit(0), r)            => eval(r)     // optimize: 0 + r = r
  case Add(l, Lit(0))            => eval(l)     // optimize: l + 0 = l
  case Add(l, r)                 => eval(l) + eval(r)
  case Mul(_, Lit(0))            => 0           // optimize: anything * 0 = 0
  case Mul(Lit(1), r)            => eval(r)     // optimize: 1 * r = r
  case Mul(l, r)                 => eval(l) * eval(r)
}
```

### Comparison with TypeScript-Go's Discriminated Unions + `identity`

| Aspect | Scala Sealed Traits | TypeScript Discriminated Unions + `identity` |
|--------|--------------------|--------------------------------------------|
| **Declaration** | `sealed trait` + `case class` subtypes | Union of types with discriminant field |
| **Exhaustiveness** | Compiler-enforced at `match` | Compiler-enforced at `switch` (with `never` exhaustiveness) |
| **Narrowing** | Pattern matching destructures and narrows | `identity` + type guard narrows the return type |
| **Immutability** | `case class` fields are `val` by default | No default immutability; `readonly` is opt-in |
| **Nested** | Deep destructuring in patterns | Manual nested checks (no pattern matching syntax) |
| **Stability** | Destructured vals are stable within match arm | `identity` reads are stable until `mutator` call |

### Key Insight: Sealed Hierarchies as Static Union Types

Scala's sealed traits are essentially TypeScript discriminated unions with runtime class identity instead of a discriminant field. The compiler guarantees exhaustiveness in both cases, and both narrow the type after matching.

The `identity` system adds a dimension that sealed traits don't address: **temporal stability across repeated reads**. In Scala's `match`, you destructure once and the bound values are `val` — permanently stable. In TypeScript with `identity`, the narrowed type persists across multiple reads of the same callable until a `mutator` invalidates it. This is a more dynamic invariant that accounts for mutable state.

---

## 5. ZIO `Ref` and `FiberRef` — Managed Mutable State

### ZIO's Model

[ZIO](https://zio.dev/) is Scala's primary effect system library. It provides `Ref` as a purely functional mutable reference:

```scala
import zio._

val program: ZIO[Any, Nothing, Int] = for {
  ref   <- Ref.make(0)             // create a Ref holding 0
  _     <- ref.update(_ + 1)       // increment: 0 -> 1
  _     <- ref.update(_ + 1)       // increment: 1 -> 2
  value <- ref.get                 // read current value: 2
} yield value
```

`Ref` operations are atomic and return effects (`ZIO`), not raw values. This means:
- **Reads** (`ref.get`) are explicitly sequenced in the effect chain.
- **Writes** (`ref.update`, `ref.set`) are explicitly sequenced and visible in the type.
- **No hidden mutation** — all state changes appear in the for-comprehension.

`FiberRef` extends this to fiber-local state (analogous to thread-local variables):

```scala
val fiberProgram: ZIO[Any, Nothing, String] = for {
  ref   <- FiberRef.make("default")
  _     <- ref.set("custom")
  value <- ref.get                   // "custom" — fiber-local
  // Other fibers still see "default"
} yield value
```

### Comparison with TypeScript Signals

ZIO's `Ref` and TypeScript signals (like SolidJS or Angular) share a conceptual model:

| Aspect | ZIO `Ref[A]` | TypeScript Signal (e.g., SolidJS) | `identity`/`mutator` |
|--------|-------------|----------------------------------|----------------------|
| **Read** | `ref.get: ZIO[Any, Nothing, A]` | `signal(): A` | `identity fn(): A` |
| **Write** | `ref.set(a): ZIO[Any, Nothing, Unit]` | `setSignal(a): void` | `mutator fn(a) links ...` |
| **Atomicity** | Built-in (STM-backed `Ref.Synchronized`) | Single-threaded event loop | Not addressed (runtime concern) |
| **Effect tracking** | Writes are effects in the `ZIO` type | Writes trigger reactive updates | Writes invalidate CFA narrowing |
| **Composition** | `Ref.make` + for-comprehension | `createMemo`, `createEffect` | `links` clause for selective invalidation |

### Key Insight: Effect Systems as Explicit Invalidation

ZIO makes mutation explicit through the effect type — you can see in the type signature that `ref.update` modifies state. TypeScript-Go's `mutator` achieves a similar explicitness: calling a `mutator` is a visible signal that state has changed, and `links` specifies which state.

The difference is that ZIO's approach is **total** — all effects are tracked in the type system. TypeScript-Go's approach is **selective** — only `identity`/`mutator`-annotated APIs participate in CFA tracking. This selectivity is a pragmatic choice: TypeScript must remain compatible with the vast majority of existing JavaScript/TypeScript code that doesn't use these annotations.

ZIO's `Ref.Synchronized` offers atomic update-and-read, which is conceptually similar to a "transactional mutator" that updates state and returns the new value. TypeScript-Go doesn't have this, but it could be modeled:

```typescript
interface Counter {
  identity count(): number;
  mutator incrementAndGet(): number links count;
  // Caller knows: count() is invalidated, but the return of incrementAndGet is the new value
}
```

---

## 6. Akka/Pekko Actors — Message-Passing for Mutation Isolation

### The Actor Model in Scala

Akka (and its Apache fork Pekko) implements the actor model: each actor owns its mutable state, and all interaction happens through immutable messages:

```scala
import akka.actor.typed.{ActorRef, Behavior}
import akka.actor.typed.scaladsl.Behaviors

object Counter {
  sealed trait Command
  case object Increment extends Command
  case class GetCount(replyTo: ActorRef[Int]) extends Command

  def apply(): Behavior[Command] = counter(0)

  private def counter(count: Int): Behavior[Command] =
    Behaviors.receiveMessage {
      case Increment =>
        counter(count + 1)  // returns new behavior with updated state
      case GetCount(replyTo) =>
        replyTo ! count     // sends current count
        Behaviors.same       // state unchanged
    }
}
```

Key properties:
- **No shared mutable state** — each actor's state is private.
- **Messages are immutable** — typically case classes.
- **State transitions are explicit** — returning a new `Behavior` with the updated state.
- **Reads are asynchronous** — asking for the count sends a message and awaits a reply.

### Comparison with `identity`/`mutator`

The actor model enforces mutation isolation at the architecture level — mutable state is encapsulated within an actor, and external code can only interact via messages:

| Aspect | Akka Actors | TypeScript-Go `identity`/`mutator` |
|--------|------------|-------------------------------------|
| **Mutation boundary** | Actor encapsulation — state is private | `mutator` declaration — marks the invalidation point |
| **Read access** | Send message, await reply (asynchronous) | Call `identity` function (synchronous) |
| **Write access** | Send command message (fire-and-forget or ask) | Call `mutator` function |
| **Invalidation scope** | Actor processes one message at a time — no concurrent mutation | `links` clause — specifies which reads are affected |
| **Granularity** | Per-actor (coarse) | Per-callable (fine) |

### Key Insight: Message-Passing Eliminates Temporal Aliasing

Actors solve the "when does my read become stale?" problem by making all interactions asynchronous and sequenced. There's no temporal aliasing because you can't observe intermediate states — you send a read request and get back a consistent snapshot.

TypeScript-Go's `identity` system operates in a synchronous, single-threaded context where temporal aliasing is the core problem. The `links` clause is TypeScript-Go's answer to "which reads become stale after this write?" — it's a lightweight, fine-grained version of the actor model's "send a message to the right actor."

---

## 7. Dotty/Scala 3 Enums — Tagged Union Types and Exhaustive Matching

### Scala 3's Model

Scala 3 simplified union types and enums, bringing them closer to TypeScript's discriminated unions:

```scala
// Simple enum
enum Color:
  case Red, Green, Blue

// Parameterized enum (ADT)
enum Shape:
  case Circle(radius: Double)
  case Rectangle(width: Double, height: Double)
  case Triangle(base: Double, height: Double)

// Exhaustive match
def area(s: Shape): Double = s match
  case Shape.Circle(r)        => Math.PI * r * r
  case Shape.Rectangle(w, h)  => w * h
  case Shape.Triangle(b, h)   => 0.5 * b * h
```

Scala 3 also introduced **union types** directly:

```scala
type StringOrInt = String | Int

def show(x: StringOrInt): String = x match
  case s: String => s"String: $s"
  case i: Int    => s"Int: $i"
```

And **match types** for type-level pattern matching:

```scala
type Elem[X] = X match
  case String      => Char
  case Array[t]    => t
  case Iterable[t] => t
```

### Comparison with TypeScript Discriminated Unions

| Aspect | Scala 3 Enum | TypeScript Discriminated Union |
|--------|-------------|------------------------------|
| **Syntax** | `enum Shape: case Circle(r)...` | `type Shape = { kind: "circle"; r: number } \| ...` |
| **Discriminant** | Runtime class identity | Literal type field (`kind`, `type`, etc.) |
| **Exhaustiveness** | `match` with compiler warning | `switch` + `never` check |
| **Immutability** | Enum cases are immutable by default | Object spread or `readonly` needed |
| **Nested match** | Deep pattern destructuring | Manual nested `if`/`switch` |
| **Extension** | Sealed — cannot add cases outside file | Open union — can extend with `\|` |

### Identity CFA on Enum-Like Patterns

With `identity`, TypeScript-Go enables narrowing on callable getters that return discriminated unions:

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; w: number; h: number };

interface Canvas {
  identity currentShape(): Shape;
  mutator setShape(s: Shape) links currentShape;
}

declare const canvas: Canvas;

if (canvas.currentShape().kind === "circle") {
  canvas.currentShape().radius;  // narrowed to circle
  // Without identity, this would be an error — the compiler can't prove stability
}

canvas.setShape({ kind: "rect", w: 10, h: 5 });  // invalidates via links
canvas.currentShape().radius;  // ERROR: must re-narrow after mutator call
```

This gives TypeScript-Go **the same exhaustive narrowing guarantees** as Scala 3's `match` on enums, but extended to callable getters through the `identity` system.

---

## 8. Alternative Syntax Ideas — Could Optics-Style Lens Composition Replace `links`?

### The Lens-Inspired Alternative

Instead of manually listing `links` targets, what if TypeScript-Go inferred invalidation relationships from a composable path system?

```typescript
// Hypothetical: optics-style lens paths
interface Store {
  @lens user: User | undefined;
  @lens user.name: string;
  @lens user.address.city: string;
}

// The system would infer:
// - setUser invalidates user, user.name, user.address.city (parent invalidates children)
// - setCity invalidates user.address.city (leaf change)
// - setCity does NOT invalidate user.name (sibling unaffected)
```

### Evaluation

**Advantages of lens-style inference:**
- No manual `links` listing — relationships derived from structure.
- Composition is natural — `user.address.city` composes `user`, `address`, `city`.
- Nested invalidation "just works" — changing a parent implies changing children.

**Problems with lens-style inference for TypeScript-Go:**

1. **TypeScript APIs aren't structural paths.** Signal-style APIs use method calls, not dot paths: `store.user()`, not `store.user.address.city`. There's no structural nesting to compose.

2. **Callable endpoints aren't compositionally related.** `getUser()` and `getUserName()` may be independently implemented — one doesn't compose from the other. `links` reflects this independence: the developer must state the relationship because it can't be inferred.

3. **Imperative mutation doesn't follow optics laws.** Optics guarantee that `set(get(s), s) === s` (get-set law) and `get(set(a, s)) === a` (set-get law). Imperative mutations make no such guarantees — `setUser(newUser)` might trigger side effects, validate input, or partially update state.

4. **Complexity budget.** Optics require a substantial conceptual overhead (Lens, Prism, Traversal, Optional, Iso). TypeScript-Go's `links` clause is a simple list of identifiers — low concept count, high expressiveness.

### A Lighter Alternative: Path-Based Links

A middle ground could use dot-path syntax within `links` to handle nested cases:

```typescript
// Current explicit links
interface Store {
  identity user(): User | undefined;
  identity userName(): string;
  mutator setUser(u: User) links user, userName;
}

// Hypothetical path-based links (auto-invalidation of sub-paths)
interface Store {
  identity user(): User | undefined;
  identity user.name(): string;
  mutator setUser(u: User) links user;  // automatically invalidates user.name too
}
```

This borrows optics' compositional property without importing the full optics framework. However, it introduces a new concept (dotted identity paths) that doesn't exist in TypeScript's type system today.

### Conclusion: `links` Is the Right Tradeoff

The explicit `links` clause trades optics' structural elegance for pragmatic simplicity:

| Criterion | Optics Composition | Explicit `links` |
|-----------|-------------------|-----------------|
| **Learning curve** | High — must understand Lens/Prism/etc. | Low — it's a list of names |
| **Expressiveness** | Very high for structural data | Sufficient for API-level contracts |
| **Correctness** | Guaranteed by optics laws | Programmer-asserted |
| **TypeScript compatibility** | Requires new structural concepts | Uses existing identifier references |
| **Incremental adoption** | All-or-nothing (optics library required) | Per-API opt-in |

For TypeScript-Go's use case — tracking invalidation across callable endpoints in imperative code — the explicit `links` clause is the right level of abstraction. Optics are a more powerful tool, but their power is unnecessary and their complexity is counterproductive for the problem `links` solves.

---

## Summary: Cross-Cutting Themes

### What Scala Adds to the Design Review

| Theme | Scala Mechanism | TypeScript-Go Equivalent | Delta |
|-------|----------------|-------------------------|-------|
| **Immutable bindings** | `val` | `identity` (callable) | Scala is per-binding; TS-Go is per-callable |
| **Mutable bindings** | `var` | `mutator` + `links` | Scala invalidates everything on `var`; TS-Go is selective |
| **Functional updates** | `copy` / optics `modify` | Object spread — does not invoke `mutator` | Both preserve old value; TS-Go doesn't invalidate |
| **Union narrowing** | Sealed traits + `match` | Discriminated unions + `identity` CFA | Comparable exhaustiveness; `identity` adds temporal stability |
| **Managed mutation** | ZIO `Ref` | Signals + `identity`/`mutator` | Both make reads/writes explicit; ZIO is total, TS-Go is selective |
| **Mutation isolation** | Actors (Akka/Pekko) | `links` clause | Actors are architectural; `links` is declarative and fine-grained |
| **Nested access** | Optics (Monocle) | `links` explicit listing | Optics compose structurally; `links` is manual but simpler |

### Scala's Most Useful Lesson for TypeScript-Go

Scala's ecosystem demonstrates the full spectrum from simple (`val`/`var`) to sophisticated (optics, effect systems, actors). The key lesson:

**The simplest mechanism that solves the problem wins adoption.** `val`/`var` is used everywhere. Optics are used by experts in specific domains. Effect systems are used in specialized applications.

TypeScript-Go's `identity`/`mutator`/`links` sits at the `val`/`var` level of simplicity — per-declaration annotations with clear, local semantics. This is the right level for mainstream TypeScript adoption. The optics and effect system approaches are theoretically superior but would face adoption resistance in a language that prizes pragmatic simplicity.
