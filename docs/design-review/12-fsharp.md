# Design Review: F# — Immutability, Computation Expressions, and Type Providers

## Overview

F# is a functional-first language on the .NET platform that enforces **immutability by
default**, uses **discriminated unions** as its primary modeling tool, and provides
**computation expressions** for composable effect tracking. Its approach to mutation
control offers direct parallels and instructive contrasts with TypeScript-Go's
`identity`/`mutator`/`links` system.

---

## 1. Immutable Bindings — `let` vs `let mutable`

### F#'s Model

In F#, all bindings are immutable by default. Mutation requires explicit `mutable`
annotation:

```fsharp
let name = "Alice"          // immutable — cannot be reassigned
// name <- "Bob"            // compile error: 'name' is not mutable

let mutable counter = 0     // explicitly mutable
counter <- counter + 1      // ok — mutation is opt-in
```

The `<-` operator distinguishes mutation from binding, making it syntactically visible
at every use site. This is a deliberate design choice: mutation stands out visually in
code review.

### Shadowing vs Mutation

F# distinguishes **rebinding** (shadowing) from **mutation**:

```fsharp
let x = 10
let x = x + 1    // rebinding — creates a new binding, original 10 is unreachable
                  // NOT mutation — the old value still exists if captured in a closure

let mutable y = 10
y <- y + 1        // mutation — the storage location now holds 11
```

Shadowing is safe for narrowing: the new `x` is a fresh value with its own type facts.
Mutation is unsafe: the storage location `y` may have changed, invalidating narrowings.

### Comparison to identity/mutator

| Concept                | F#                                | TypeScript-Go                      |
|------------------------|-----------------------------------|------------------------------------|
| Default binding        | Immutable (`let`)                 | Mutable (`let`/property)           |
| Opt-in mutation        | `let mutable` + `<-`             | Default behavior                   |
| Syntactic visibility   | `<-` operator at every mutation   | No syntactic marker on writes      |
| Narrowing stability    | Guaranteed for `let` bindings     | Requires `identity` annotation     |
| Compiler enforcement   | Prevents reassignment of `let`    | `identity` marks stable reads      |

**Key insight:** F#'s `let mutable` is the inverse of TypeScript-Go's `identity`. In
F#, you annotate what **can** change. In TypeScript-Go, you annotate what **cannot**
change. Both achieve the same goal — separating stable reads from mutable state — but
F#'s approach is safer by default because immutability requires no annotation.

---

## 2. Records and Anonymous Records — Immutable Data with `with` Expressions

### F# Records

Records are immutable product types with named fields:

```fsharp
type Person = { Name: string; Age: int; Score: int }

let alice = { Name = "Alice"; Age = 30; Score = 100 }
// alice.Age <- 31    // compile error — record fields are immutable

let olderAlice = { alice with Age = 31 }
// alice is unchanged — olderAlice is a new record
```

The `with` expression creates a **structural copy** with modified fields, preserving the
original. This is the idiomatic way to "update" data — no mutation occurs.

### Mutable Record Fields

Records can have mutable fields, but this is explicitly opt-in per field:

```fsharp
type MutablePerson = { Name: string; mutable Age: int; mutable Score: int }

let bob = { Name = "Bob"; Age = 25; Score = 50 }
bob.Age <- 26       // ok — field is explicitly mutable
// bob.Name <- "Robert"  // compile error — Name is not mutable
```

### Anonymous Records

F# 4.6+ introduced anonymous records — structural record types without a named declaration:

```fsharp
let point = {| X = 1; Y = 2 |}           // anonymous record, inferred type
let moved = {| point with X = point.X + 1 |}  // copy-with-update
```

Anonymous records are always immutable. There is no `mutable` annotation for anonymous
record fields.

### Comparison to identity/mutator

The `with` expression pattern maps directly to the `identity`/`mutator` dichotomy:

```fsharp
// F# — immutable update, narrowing always safe
let person = { Name = "Alice"; Age = 30 }
let older = { person with Age = 31 }
// person.Name is still "Alice" — no invalidation needed
```

```typescript
// TypeScript-Go — mutable update, narrowing needs protection
interface Person {
  identity name(): string;
  identity age(): number;
  mutator setAge(v: number) links age;
}

const p: Person = /* ... */;
if (p.name() === "Alice") {
  p.setAge(31);        // links age — does NOT invalidate name() narrowing
  p.name().toUpperCase(); // safe — identity preserved
}
```

F#'s per-field `mutable` annotation is strikingly similar to TypeScript-Go's per-endpoint
`identity`/`mutator` split:

| F# field modifier       | TypeScript-Go equivalent     | Effect on narrowing           |
|--------------------------|------------------------------|-------------------------------|
| (default immutable)      | `identity`                   | Narrowing preserved           |
| `mutable`                | Needs `mutator` + `links`    | Narrowing may be invalidated  |

**Key insight:** F#'s `mutable` keyword on record fields is a per-field mutation
annotation — conceptually identical to TypeScript-Go's `links` clause targeting
specific identity endpoints. Both achieve **selective invalidation**: marking which
parts of a data structure can change while guaranteeing stability of the rest.

---

## 3. Discriminated Unions and Match — Exhaustive Pattern Matching

### F# Discriminated Unions

Discriminated unions (DUs) are F#'s primary tool for modeling alternatives:

```fsharp
type Shape =
    | Circle of radius: float
    | Rect of width: float * height: float
    | Triangle of base: float * height: float

let area (shape: Shape) =
    match shape with
    | Circle(radius = r) -> System.Math.PI * r * r
    | Rect(width = w; height = h) -> w * h
    | Triangle(base = b; height = h) -> 0.5 * b * h
    // exhaustive — compiler error if a case is missing
```

The compiler enforces exhaustiveness. If a new `Pentagon` case is added to `Shape`,
every `match` expression must be updated or the code will not compile.

### Narrowing in Match Arms

Within a `match` arm, the matched value is narrowed to the specific case. Because DU
values are immutable, this narrowing is **permanently stable**:

```fsharp
let describe (shape: Shape) =
    match shape with
    | Circle(radius = r) ->
        // shape is narrowed to Circle, r is bound to radius
        someFunction()       // cannot invalidate — shape is immutable
        anotherFunction()    // r is still the radius
        sprintf "Circle with radius %f" r   // guaranteed stable
    | _ -> "other"
```

### Comparison to TypeScript Discriminated Unions

```typescript
type Shape =
  | { type: "circle"; radius: number }
  | { type: "rect"; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.type) {
    case "circle":
      mutate(shape);          // could invalidate shape.type narrowing!
      return Math.PI * shape.radius ** 2;  // unsafe without identity
    case "rect":
      return shape.width * shape.height;
  }
}
```

| Aspect                  | F# Match                        | TypeScript switch/if            |
|-------------------------|---------------------------------|---------------------------------|
| Exhaustiveness          | Compiler-enforced               | Via `never` check               |
| Narrowing stability     | Guaranteed (immutable values)   | Fragile (mutable objects)       |
| Invalidation by calls   | Impossible                      | Possible (needs identity)       |
| Data destructuring      | In pattern (binds components)   | Manual property access          |
| Pattern nesting         | Arbitrary depth                 | Single discriminant field       |

**Key insight:** F#'s match gives permanent narrowing for free because DU values are
immutable. TypeScript-Go's `identity` system is an explicit mechanism to approximate
this guarantee in a mutable-object world. The `identity` modifier says
"treat this read as if it were a destructured binding from an immutable match."

---

## 4. Computation Expressions — Monadic Effect Tracking

### What Are Computation Expressions?

Computation expressions (CEs) are F#'s syntactic abstraction for sequencing effectful
operations. They generalize `async/await`, `try/catch`, and custom monadic patterns:

```fsharp
// Async CE — built into F#
let fetchUser (id: int) = async {
    let! response = httpGet (sprintf "/users/%d" id)
    let! body = readBody response
    return deserialize<User> body
}

// Task CE — .NET Task interop (FSharp.Core 6.0+)
let fetchUserTask (id: int) = task {
    let! response = httpGetTask (sprintf "/users/%d" id)
    let! body = readBodyTask response
    return deserialize<User> body
}
```

The `let!` keyword "unwraps" an effectful result (analogous to `await`), while `let`
binds a pure value. The CE builder controls how effects are sequenced.

### Custom CEs for State Tracking

CEs can model custom effect types, including state transformations:

```fsharp
type StateBuilder<'s>() =
    member _.Bind(m: 's -> 'a * 's, f: 'a -> 's -> 'b * 's) =
        fun s ->
            let (a, s') = m s
            f a s'
    member _.Return(x: 'a) =
        fun s -> (x, s)

let state = StateBuilder<Map<string, int>>()

let computation = state {
    let! count = fun s -> (s.["counter"], s)
    do! fun s -> ((), s |> Map.add "counter" (count + 1))
    return count
}
```

### Effect Tracking via Types

CEs provide **type-level effect tracking**: the return type of a CE block encodes which
effects it may perform. An `async { }` block returns `Async<'T>`, a `task { }` returns
`Task<'T>`, and a custom `state { }` returns `State<'S, 'T>`.

This is a form of **explicit effect annotation** — the type system tracks what kind of
side effects a computation may have.

### Comparison to identity/mutator

| Concept                | F# CEs                           | TypeScript-Go                     |
|------------------------|----------------------------------|-----------------------------------|
| Effect declaration     | CE type (`Async<T>`, `State<S,T>`) | `mutator` modifier              |
| Pure operations        | `let` in CE body                 | `identity` reads                  |
| Effectful operations   | `let!` (bind/unwrap)             | `mutator` calls                   |
| Sequencing control     | Builder defines composition      | CFA flow analysis                 |
| Boundary tracking      | Type-level (return type)         | Declaration-level (modifiers)     |
| Async boundaries       | `async { }` / `task { }`         | `await` invalidates narrowing     |

**Key insight:** F#'s computation expressions provide a monadic framework where effects
are tracked by the type system. Each CE builder defines what "effectful" means in its
context. TypeScript-Go's `mutator` modifier is a simpler version of the same idea: it
marks a function as effectful (state-changing) without requiring a monadic type wrapper.

The critical difference: F# CEs compose effects — you can stack `async` inside `state`
inside `result`. TypeScript-Go's system is flat — `mutator` is a binary annotation
(effectful or not), with `links` providing the only composition mechanism (which
endpoints are affected).

### CE-Inspired Invalidation Model

A hypothetical CE-inspired approach in TypeScript:

```typescript
// Hypothetical: CE-like state tracking (NOT proposed)
declare function stateful<S, T>(
  computation: (ctx: StateContext<S>) => T
): StatefulResult<S, T>;

// The StatefulResult type tracks which state was read/written
// — similar to how F# CE return types encode effects
```

This would be more powerful but far too complex for TypeScript's developer audience.
The `identity`/`mutator` system achieves 80% of the benefit with 20% of the complexity.

---

## 5. Active Patterns — Custom Decomposition

### What Are Active Patterns?

Active patterns let you define custom decomposition logic that integrates with F#'s
pattern matching syntax:

```fsharp
// Complete active pattern (exhaustive)
let (|Even|Odd|) n =
    if n % 2 = 0 then Even else Odd

let describe n =
    match n with
    | Even -> "even"
    | Odd -> "odd"

// Partial active pattern (may not match)
let (|Int|_|) (s: string) =
    match System.Int32.TryParse(s) with
    | true, n -> Some n
    | _ -> None

let tryParse input =
    match input with
    | Int n -> sprintf "Got number: %d" n
    | _ -> "Not a number"
```

### Parameterized Active Patterns

Active patterns can take parameters, enabling expressive decomposition:

```fsharp
let (|DivisibleBy|_|) divisor n =
    if n % divisor = 0 then Some() else None

let classify n =
    match n with
    | DivisibleBy 3 & DivisibleBy 5 -> "FizzBuzz"
    | DivisibleBy 3 -> "Fizz"
    | DivisibleBy 5 -> "Buzz"
    | _ -> string n
```

### Comparison to TypeScript Type Guards

TypeScript's type guards serve a similar role — custom narrowing logic:

```typescript
function isCircle(shape: Shape): shape is Circle {
  return shape.type === "circle";
}

if (isCircle(shape)) {
  shape.radius; // narrowed to Circle
}
```

| Aspect                  | F# Active Patterns              | TypeScript Type Guards          |
|-------------------------|---------------------------------|---------------------------------|
| Syntax integration      | First-class match syntax        | if-statement only               |
| Pattern composition     | `&` (and), `|` (or) patterns    | Manual boolean logic            |
| Exhaustiveness          | Complete patterns are exhaustive | Not exhaustive                  |
| Value extraction        | Binds decomposed values         | Only narrows type               |
| Stability guarantee     | Immutable (inherent)            | Fragile (needs identity)        |
| Parameterization        | Yes (`DivisibleBy 3`)           | No (fixed predicates)           |

### Active Patterns and identity

Active patterns are implicitly `identity`-safe: they decompose immutable values, so
the result is guaranteed stable. Consider the TypeScript equivalent:

```typescript
// TypeScript type guard — narrowing can be invalidated
if (isValid(store.user())) {
  mutate(store);
  store.user(); // invalidated — was the user changed?
}
```

```fsharp
// F# active pattern — narrowing is permanent
match user with
| Valid u ->
    someFunction()    // cannot invalidate — user is immutable
    u.Name            // always valid
```

The `identity` modifier bridges this gap: when `user()` is marked `identity`, repeated
reads reuse narrowing, approximating the stability that F# active patterns get for free.

---

## 6. FSharp.Core Cells and `ref` — Mutable Reference Cells

### Reference Cells

F#'s `ref` creates a mutable reference cell — an explicit, first-class mutable container:

```fsharp
let counter = ref 0        // create a reference cell holding 0
counter.Value               // read: 0  (also: !counter in older syntax)
counter.Value <- 1          // write: set to 1  (also: counter := 1)
incr counter                // increment in place
```

Reference cells are the F# equivalent of a single-value mutable container. They make
mutation **visible at the type level**: `ref<int>` is a different type from `int`.

### The Type Signature Tells You

A function's type signature reveals whether it can mutate:

```fsharp
let pureFunction (x: int) : int = x + 1           // no mutation possible
let mutatingFunction (x: ref<int>) : unit = x.Value <- x.Value + 1  // mutation explicit
```

The `ref<int>` parameter is a type-level signal: this function receives mutation
capability. A function taking plain `int` cannot mutate anything.

### Comparison to identity/mutator

| Concept                | F# ref cells                     | TypeScript-Go                     |
|------------------------|----------------------------------|-----------------------------------|
| Mutable container      | `ref<T>` (explicit type)         | Mutable property (implicit)       |
| Read operation         | `cell.Value` / `!cell`           | `identity prop()`                 |
| Write operation        | `cell.Value <- v` / `cell := v`  | `mutator set(v) links prop`       |
| Mutation visibility    | Type signature (`ref<T>`)        | Declaration modifier (`mutator`)  |
| Capability tracking    | Type-level (ref vs value)        | Declaration-level (identity/mutator) |

**Key insight:** F# `ref` cells make mutation a **type-level** property — you can see
from a function's signature whether it can mutate state. TypeScript-Go's `mutator` modifier
achieves the same goal at the **declaration level** rather than the type level. Both
approaches make mutation explicit and trackable.

The advantage of F#'s approach: mutation capability propagates through type inference.
If function A takes a `ref<int>` and passes it to function B, the compiler can see that
B also has mutation access. TypeScript-Go's `mutator`/`links` system doesn't propagate
this way — it is local to each declaration.

---

## 7. Elmish/MVU Architecture — Model-View-Update

### The MVU Pattern

Elmish (F# implementation of the Elm architecture) enforces strict separation of state
management:

```fsharp
// Model — the entire application state (immutable)
type Model = {
    Count: int
    Name: string
    IsValid: bool
}

// Messages — all possible state transitions
type Msg =
    | Increment
    | Decrement
    | SetName of string
    | Validate

// Update — pure function: Model -> Msg -> Model
let update (msg: Msg) (model: Model) : Model =
    match msg with
    | Increment -> { model with Count = model.Count + 1 }
    | Decrement -> { model with Count = model.Count - 1 }
    | SetName s -> { model with Name = s }
    | Validate -> { model with IsValid = model.Name.Length > 0 }

// View — pure function: Model -> Html
let view (model: Model) (dispatch: Msg -> unit) =
    div [] [
        text (sprintf "Count: %d" model.Count)
        button [ onClick (fun _ -> dispatch Increment) ] [ text "+" ]
        input [ value model.Name; onInput (fun e -> dispatch (SetName e.Value)) ]
    ]
```

### MVU Guarantees

The MVU architecture provides structural guarantees:

1. **Model is immutable.** The view function reads a frozen snapshot.
2. **Update is pure.** Given the same model and message, it always produces the same result.
3. **View is pure.** Given the same model, it always produces the same HTML.
4. **Messages are the only mutation vector.** No other mechanism can change state.
5. **State transitions are atomic.** Each message produces a complete new model.

### Mapping to identity/mutator

The MVU pattern maps directly to TypeScript-Go's system:

```typescript
// TypeScript-Go equivalent of MVU
interface Store {
    identity count(): number;
    identity name(): string;
    identity isValid(): boolean;

    mutator increment() links count;
    mutator decrement() links count;
    mutator setName(s: string) links name;
    mutator validate() links isValid;
}
```

| MVU Concept            | F# Elmish                        | TypeScript-Go                     |
|------------------------|----------------------------------|-----------------------------------|
| Model (state)          | Immutable record                 | `identity` endpoints              |
| View (reads)           | Pure function of model           | Code reading `identity` endpoints |
| Msg (write intent)     | Discriminated union case         | `mutator` method call             |
| Update (state change)  | Pure function: Model→Msg→Model   | `mutator` implementation          |
| Selective invalidation | `with` expression (per-field)    | `links` clause (per-endpoint)     |
| Exhaustive effects     | All Msg cases handled            | All linked endpoints declared     |

**Key insight:** The `links` clause in TypeScript-Go is the equivalent of F#'s `with`
expression in MVU. In Elmish, `{ model with Count = model.Count + 1 }` tells the
framework exactly which field changed. In TypeScript-Go,
`mutator increment() links count` tells the checker exactly which identity endpoint
is invalidated. Both enable **selective, precise invalidation** rather than
whole-state invalidation.

### MVU and Narrowing

In Elmish, the view function receives an immutable model snapshot. All narrowings within
the view are permanently stable:

```fsharp
let view (model: Model) (dispatch: Msg -> unit) =
    if model.Count > 0 then
        // model.Count is narrowed to positive — this is permanent
        someExpensiveComputation model.Count   // safe
        dispatch Increment                     // schedules future update, but
                                               // model is still the same snapshot
        model.Count.ToString()                 // still positive — guaranteed
```

TypeScript-Go achieves similar stability for `identity` endpoints within a flow region,
but must conservatively invalidate at `mutator` call sites. The MVU architecture avoids
this by separating the mutation phase (update) from the reading phase (view) entirely.

---

## 8. Alternative Syntax Ideas — F#'s `mutable` Annotation Approach

### Could TypeScript Adopt F#'s Model?

F#'s approach to mutation control has two key properties:
1. **Immutable by default** — mutation requires explicit `mutable` annotation
2. **Per-field granularity** — each field independently declared mutable or immutable
3. **Mutation operator** — `<-` instead of `=` makes every mutation visible

### Approach A: `mutable` Keyword on Interface Members

Inspired by F#'s per-field `mutable`, flip the default for annotated interfaces:

```typescript
// Hypothetical: mutable-annotated interface members
interface Store {
    count(): number;                      // stable by default (implicit identity)
    settings(): Settings;                 // stable by default

    mutable setCount(v: number): void;    // explicitly mutable (mutator)
    mutable reset(): void;                // explicitly mutable
}
```

**Pros:**
- Single keyword instead of three (`identity`, `mutator`, `links`)
- Closer to F#'s mental model — annotate the exception (mutation), not the rule (stability)
- Lower annotation burden — fewer members in typical interfaces are mutators

**Cons:**
- Loses `links` precision — `mutable reset()` doesn't say which reads it invalidates
- Implies immutable-by-default, which conflicts with TypeScript's mutable-by-default semantics
- `mutable` is not a reserved word in TypeScript (though neither is `identity`)

### Approach B: F#-Style `with` Expression for Objects

Adapt F#'s copy-with-update pattern as a TypeScript expression:

```typescript
// Hypothetical: with expression (NOT proposed)
const older = { ...person, with age: person.age + 1 };
// or
const older = person with { age: person.age + 1 };
```

TypeScript already has spread syntax, which is the closest equivalent. But spread
doesn't integrate with the type system for narrowing preservation — the compiler
doesn't know that `{ ...person, age: 31 }` preserves `person.name`.

### Approach C: Explicit Mutation Operator

F#'s `<-` operator makes every mutation visually distinct. TypeScript could introduce
a similar distinction:

```typescript
// Hypothetical: mutation operator (NOT proposed)
store.count = 5;       // compile error if count is identity
store.count <- 5;      // explicit mutation, triggers invalidation

// Or with methods:
store.setCount(5);     // if setCount is declared mutator, CFA knows
```

This is impractical for TypeScript because:
- `<-` is valid JavaScript (less-than followed by unary minus)
- Adding new syntax for mutation conflicts with JavaScript compatibility
- Existing APIs use `=` universally

### Approach D: Hybrid — `mutable` + `links`

Take F#'s `mutable` annotation but keep TypeScript-Go's `links` for precision:

```typescript
interface Store {
    count(): number;                               // stable (implicit identity)
    name(): string;                                // stable

    mutable setCount(v: number) links count;       // F#-style annotation + links
    mutable reset() links count, name;             // precise invalidation
}
```

This is nearly identical to the current `identity`/`mutator` design, but uses `mutable`
instead of the `identity`/`mutator` pair. The tradeoff:
- Simpler (one keyword instead of two) but implicitly makes non-`mutable` members stable
- Requires all call-returning members to be implicitly `identity`-like, which may be
  too broad — not all non-mutating methods return stable values

### Why TypeScript-Go's Current Design is Preferable

F#'s approach works because *everything* is immutable by default. In a mutable-first
language like TypeScript:

1. **Opt-in stability is more practical than opt-in mutation.** Most TypeScript interfaces
   have many more readable members than writable ones, but making all non-annotated
   members implicitly stable would be too aggressive — a method that returns a cached
   value is not necessarily stable.

2. **Explicit `identity` prevents false stability.** Marking a member `identity` is an
   intentional guarantee. Implying identity for all non-`mutable` members would produce
   false positives.

3. **`links` requires the writer endpoint, not the reader.** The `links` clause belongs
   on the mutator because it describes the *effect* of the mutation. Without separate
   `mutator`/`identity` keywords, the association between writer and affected readers
   is less clear.

4. **Two keywords mirror the read/write duality.** `identity` and `mutator` make the
   semantic intent unambiguous at declaration site. F#'s `mutable` works because
   `let` (the default) is obviously immutable. TypeScript's default is mutable, so
   the "stable" annotation must be explicit.

---

## Summary: Lessons from F#

| Lesson                          | F# Approach                    | TypeScript-Go Approach           |
|---------------------------------|--------------------------------|----------------------------------|
| Default mutability              | Immutable (`let`)              | Mutable (properties/variables)   |
| Opt-in mutation                 | `let mutable` / `mutable` field| Default — opt-in stability       |
| Mutation visibility             | `<-` operator, `ref<T>` type   | `mutator` modifier               |
| Stable read endpoints           | All immutable bindings         | `identity` modifier              |
| Selective invalidation          | `with` expression (per-field)  | `links` clause (per-endpoint)    |
| Effect tracking                 | CE types (`Async<T>`, etc.)    | `mutator` (binary annotation)    |
| Custom decomposition            | Active patterns                | Type guards                      |
| Exhaustive handling             | Compiler-enforced match        | `never` check in switch          |
| Reactive state (MVU)            | Elmish: immutable model+update | Signals with identity/mutator    |
| Mutable containers              | `ref<T>` (explicit type)       | Mutable properties (implicit)    |

### Core Takeaway

F# demonstrates that **per-field mutation annotations combined with immutable defaults**
produce the cleanest model for narrowing stability. TypeScript-Go's `identity`/`mutator`/
`links` system is F#'s approach adapted for a mutable-first language:

- **`identity`** = F#'s default immutable binding (explicit because TypeScript's default is mutable)
- **`mutator`** = F#'s `mutable` annotation (marking the exception rather than the rule)
- **`links`** = F#'s `with` expression (declaring exactly which fields an update touches)

The strongest validation from F# is the **MVU/Elmish pattern**: the `update` function
explicitly declares which model fields it modifies via `with`, and the `view` function
reads a frozen snapshot. TypeScript-Go's `mutator ... links` clause captures exactly
this information at the type level, enabling the same selective invalidation without
requiring an architectural commitment to MVU.

F#'s computation expressions show that a richer effect system is theoretically possible,
but TypeScript-Go's simpler binary annotation (`identity` or `mutator`) is the right
trade-off for a language that prioritizes gradual adoption and developer accessibility
over formal effect-tracking completeness.
