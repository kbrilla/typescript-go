# Design Review: OCaml — Mutable Records, Module System, Effect Handlers

## Overview

OCaml is a multi-paradigm language rooted in the ML family, combining strict static
typing with immutable-by-default values, explicitly-annotated mutable record fields,
a powerful module system (signatures + functors), and — as of OCaml 5 — algebraic effect
handlers. OCaml's granular `mutable` annotation on individual record fields is the
closest ML-family analog to TypeScript-Go's `identity`/`mutator` split: immutability
is the default, and mutation is marked at the declaration site per field.

---

## 1. Mutable vs Immutable Record Fields — `mutable` Keyword

### Per-Field Mutation Annotation

OCaml records are immutable by default. Individual fields can be marked `mutable` to
allow in-place assignment:

```ocaml
type person = {
  name : string;          (* immutable — cannot be reassigned *)
  mutable age : int;      (* mutable — can be assigned with <- *)
}

let birthday p =
  p.age <- p.age + 1      (* OK — age is mutable *)
  (* p.name <- "Bob"      -- ERROR: name is not mutable *)
```

This is a **per-field** annotation, not a per-variable or per-type annotation. The record
type declares upfront exactly which fields can be modified, and the rest are guaranteed
stable by the type system.

### Comparison to identity/mutator

The duality maps cleanly:

| OCaml Concept              | TypeScript-Go Analog           | Semantics                        |
|----------------------------|--------------------------------|----------------------------------|
| Immutable field (default)  | `identity` property            | Stable read endpoint             |
| `mutable` field            | Regular mutable property       | Can be reassigned                |
| `p.age <- v` (assignment)  | `mutator` method               | Mutation site, invalidates facts |
| Record update `{ p with }` | `links`-style selective update | Declares which fields change     |

### Functional Update — `{ ... with ... }`

OCaml supports functional record update, which creates a new record with specified
fields changed:

```ocaml
type config = {
  host : string;
  port : int;
  debug : bool;
}

let enable_debug c = { c with debug = true }
(* Returns a new record — c.host and c.port are unchanged *)
```

This is structurally equivalent to a `links`-style declaration: the `with` expression
explicitly names which fields are modified, and all other fields are known to be
carried forward unchanged. A hypothetical `mutator links(debug) enable_debug()` in
TypeScript-Go captures the same information at the type level.

### Why OCaml's Default-Immutable Works

OCaml's approach succeeds because immutability is the **unmarked default**. A developer
must opt in to mutation on each field. This means:

- Any field **not** marked `mutable` is a guaranteed stable read endpoint.
- The compiler can safely assume all reads of immutable fields return the same value
  across the lifetime of the record.
- Pattern matching over immutable fields is always safe — the match cannot be
  invalidated by concurrent mutation.

TypeScript-Go inverts this (properties are mutable by default), so `identity` fills the
role of OCaml's unmarked default: explicitly declaring "this endpoint is stable."

---

## 2. Ref Cells (`ref`, `!`, `:=`) — Explicit Mutation References

### The `ref` Type

OCaml provides `ref` cells as a first-class mutable container — a single-field mutable
record under the hood:

```ocaml
let counter = ref 0        (* create a ref cell containing 0 *)
let current = !counter     (* dereference: read the current value *)
counter := !counter + 1    (* assignment: write a new value *)
```

The `ref` type is defined as:

```ocaml
type 'a ref = { mutable contents : 'a }
```

This makes mutation syntactically visible at every use site: `!` for reads, `:=` for
writes. There is no ambiguity about whether a particular access is reading a stable
value or mutating state.

### Comparison to identity/mutator

| Ref Cell Concept     | TypeScript-Go Analog           | Visibility                           |
|----------------------|--------------------------------|--------------------------------------|
| `ref 0`              | `signal(0)` / mutable property | Creates a mutable container          |
| `!counter` (read)    | `identity get value()`         | Explicit read — stable endpoint      |
| `counter := v`       | `mutator set value(v)`         | Explicit write — invalidation point  |
| `type 'a ref`        | `Signal<T>` interface          | Container type with read/write split |

### Syntactic Visibility of Mutation

OCaml's `ref` cells force the programmer to use distinct syntax for reading (`!`) vs
writing (`:=`). This syntactic signal is lost in most TypeScript APIs:

```typescript
// TypeScript — every access looks the same
const value = signal(0);
value();          // read
value.set(5);     // write — looks very different from read
value.update(v => v + 1);  // write — visible but no compiler enforcement
```

TypeScript-Go's `identity`/`mutator` brings the enforcement back: the type system
knows which call signatures are reads and which are writes, even when the surface
syntax is uniform (both are method calls).

### `ref` as a Language Design Pattern

The `ref` cell is OCaml's admission that sometimes mutation is necessary, but it should
be **contained and visible**. By wrapping mutation in a dedicated type (`'a ref`), the
rest of the language can remain purely functional. TypeScript-Go's approach is analogous:
`mutator` wraps the mutation declaration in a modifier, making it visible to the type
system without changing the runtime behavior.

---

## 3. Module System (Signatures / Functors) — Abstract Types for Capability Control

### Signatures as Capability Restriction

OCaml's module system uses **signatures** (module types) to control what is exposed:

```ocaml
module type COUNTER = sig
  type t                          (* abstract — users cannot inspect internals *)
  val create : int -> t           (* constructor *)
  val value : t -> int            (* read operation *)
  val increment : t -> t          (* produces a new counter *)
end

module Counter : COUNTER = struct
  type t = { count : int }
  let create n = { count = n }
  let value c = c.count
  let increment c = { count = c.count + 1 }
end
```

By making `type t` abstract in the signature, the module prevents external code from
directly accessing or pattern-matching on the internal representation. The only way to
interact with a `Counter.t` is through the exposed functions.

### Comparison to identity/mutator

This is a capability-based approach to mutation control:

| Module Concept              | TypeScript-Go Analog          | Purpose                          |
|-----------------------------|-------------------------------|----------------------------------|
| Abstract type `type t`      | Private fields + `identity`   | Hide internals, expose stable API|
| `val value : t -> int`      | `identity get value()`        | Declared read operation          |
| `val increment : t -> t`    | `mutator increment()`         | Declared state transition        |
| Signature restriction       | Interface with identity decl  | Restrict operations to declared  |

### Functors — Parameterized Modules

OCaml functors create modules parameterized over other modules:

```ocaml
module type ORDERED = sig
  type t
  val compare : t -> t -> int
end

module MakeSet (Elt : ORDERED) : sig
  type t
  val empty : t
  val add : Elt.t -> t -> t        (* functional — returns new set *)
  val mem : Elt.t -> t -> bool     (* read-only query *)
end = struct
  type t = Elt.t list
  let empty = []
  let add x s = x :: s
  let mem x s = List.exists (fun y -> Elt.compare x y = 0) s
end
```

The functor signature explicitly separates read operations (`mem`) from state
transitions (`add`). This is enforced structurally: `add` returns a new `t`, while
`mem` returns `bool`. In TypeScript-Go, this distinction would be captured by
`identity` (for `mem`-like methods) and `mutator` (for `add`-like methods), with the
type system enforcing the contract rather than relying on return-type conventions.

### Lesson for TypeScript-Go

OCaml's module system shows that **capability restriction is composable**: a signature
can expose a subset of operations, a functor can require specific capabilities from
input modules, and abstract types prevent back-door access. TypeScript-Go's
`identity`/`mutator` modifiers on interface members serve a similar role — they declare
capabilities and restrictions at the type level — but are more lightweight since they
don't require a full module system.

---

## 4. Pattern Matching Over Variants — Narrowing via Structural Decomposition

### Variant Types and Pattern Matching

OCaml's variant types (algebraic data types) with pattern matching are the original
inspiration for discriminated unions and narrowing:

```ocaml
type shape =
  | Circle of float             (* radius *)
  | Rectangle of float * float  (* width, height *)
  | Triangle of float * float * float  (* sides *)

let area = function
  | Circle r -> Float.pi *. r *. r
  | Rectangle (w, h) -> w *. h
  | Triangle (a, b, c) ->
    let s = (a +. b +. c) /. 2.0 in
    Float.sqrt (s *. (s -. a) *. (s -. b) *. (s -. c))
```

The compiler guarantees:
1. **Exhaustiveness** — every variant case must be handled.
2. **Irrefutability** — the bound variables (`r`, `w`, `h`, etc.) have the correct types.
3. **Stability** — matched values are immutable, so narrowing is never invalidated.

### Comparison to TypeScript Discriminated Unions

```typescript
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rectangle'; width: number; height: number }
  | { kind: 'triangle'; a: number; b: number; c: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle': return Math.PI * shape.radius ** 2;
    case 'rectangle': return shape.width * shape.height;
    case 'triangle': {
      const s = (shape.a + shape.b + shape.c) / 2;
      return Math.sqrt(s * (s - shape.a) * (s - shape.b) * (s - shape.c));
    }
  }
}
```

### Why OCaml Narrowing Is Trivially Sound

In OCaml, matched values are immutable by default. Once you match `Circle r`, the value
`r` cannot change — there is no aliased mutable reference that could invalidate the
match. TypeScript's discriminated unions face a harder problem: the `shape` object could
be mutated between the `switch` and the property access, invalidating the narrowing.

| Narrowing Aspect           | OCaml                          | TypeScript-Go                    |
|----------------------------|--------------------------------|----------------------------------|
| Match binding stability    | Guaranteed (immutable values)  | Requires `identity` or inference |
| Exhaustiveness checking    | Built-in (compiler error)      | `never` check / `--strict`       |
| Invalidation after match   | Impossible (no aliased mut)    | Possible — needs `mutator` track |
| Nested pattern matching    | Full support (deep patterns)   | Manual chained narrowing         |
| Guard clauses              | `when` guards (limit exhaust.) | Additional `if` checks           |

### Polymorphic Variants

OCaml also has **polymorphic variants** — structural (rather than nominal) variant
types:

```ocaml
let describe_color = function
  | `Red -> "red"
  | `Blue -> "blue"
  | `Green -> "green"

(* The inferred type is: [< `Blue | `Green | `Red ] -> string *)
```

Polymorphic variants are more flexible but harder to reason about. They are closer to
TypeScript's structural union types than to nominal discriminated unions. The narrowing
guarantees are the same — all values are immutable — but the type inference is more
complex.

---

## 5. Effect Handlers (OCaml 5) — Algebraic Effects for Mutation Tracking

### What Are Effect Handlers?

OCaml 5 introduced **algebraic effect handlers**, a mechanism for expressing and
controlling computational effects (mutation, I/O, exceptions, concurrency) in a
composable, first-class way:

```ocaml
(* Define an effect *)
type _ Effect.t +=
  | Get : int Effect.t
  | Set : int -> unit Effect.t

(* Use effects in code — looks like normal function calls *)
let increment () =
  let current = Effect.perform Get in
  Effect.perform (Set (current + 1))

(* Handle effects — intercept and interpret them *)
let run_with_state init f =
  let state = ref init in
  Effect.Deep.match_with f ()
    { retc = (fun x -> x);
      exnc = (fun e -> raise e);
      effc = fun (type a) (eff : a Effect.t) ->
        match eff with
        | Get -> Some (fun (k : (a, _) Effect.Deep.continuation) ->
            Effect.Deep.continue k !state)
        | Set v -> Some (fun k ->
            state := v;
            Effect.Deep.continue k ())
        | _ -> None }
```

### How This Relates to identity/mutator

Effect handlers provide a **general framework** for the same problem `identity`/`mutator`
solves — tracking and controlling which operations are reads vs writes:

| Effect Handler Concept     | TypeScript-Go Analog          | Purpose                          |
|----------------------------|-------------------------------|----------------------------------|
| `Get` effect               | `identity` read               | Declares a read operation        |
| `Set` effect               | `mutator` write               | Declares a write operation       |
| Handler interpretation     | CFA heuristic tiers           | Determines narrowing behavior    |
| Effect type annotation     | `mutator`/`identity` modifier | Declares effect at type level    |
| Effect resumption          | Post-call narrowing           | State after effect is handled    |

### Composable Effect Tracking

The power of algebraic effects is composability. Multiple effect handlers can be layered:

```ocaml
(* Logging effect *)
type _ Effect.t += Log : string -> unit Effect.t

(* Code performs multiple effects *)
let do_work () =
  Effect.perform (Log "starting");
  let v = Effect.perform Get in
  Effect.perform (Set (v * 2));
  Effect.perform (Log "done")

(* Handler can observe all effects — knows which are reads vs writes *)
```

This is more powerful than TypeScript-Go's `mutator`/`links` system, which is a binary
annotation (read or write) rather than a full effect system. However, full effect type
tracking is far beyond TypeScript's design goals and the practical needs of most
TypeScript codebases.

### Why TypeScript-Go Doesn't Need Full Effects

OCaml's effect handlers solve a broader problem — enabling user-defined control flow,
coroutines, and composable effect interpretation. TypeScript-Go's `identity`/`mutator`
system addresses a much narrower slice: **whether a call invalidates a previously
narrowed read value**.

| Capability                     | OCaml Effects          | TypeScript-Go identity  |
|--------------------------------|------------------------|-------------------------|
| Read/write distinction         | Yes (via effect types) | Yes (via modifiers)     |
| Composable effect handlers     | Yes                    | No — not needed         |
| User-defined control flow      | Yes (continuations)    | No scope                |
| Selective invalidation         | Implicit (handler scope)| Explicit (`links`)     |
| Gradual adoption               | No (needs handler)     | Yes (opt-in per member) |
| Zero runtime cost              | No (handler overhead)  | Yes (type-level only)   |

**Key insight:** TypeScript-Go extracts exactly the information it needs (is this a read
or a write? which reads does this write affect?) without requiring the full machinery
of an effect system. This is the right trade-off for a language that compiles to
JavaScript and must support gradual adoption.

---

## 6. Private Types — Module-Level Read-Only Type Exposure

### Private Type Abbreviations

OCaml allows modules to expose types as **private** — externally visible but not
constructible or matchable from outside:

```ocaml
module Positive : sig
  type t = private int     (* visible as int, but cannot be created externally *)
  val create : int -> t option
  val value : t -> int
end = struct
  type t = int
  let create n = if n > 0 then Some n else None
  let value n = n
end

(* External usage: *)
let x = Positive.create 5   (* Some 5 *)
let n = Positive.value x     (* 5 *)
(* let bad = (Positive.t) 0  -- ERROR: cannot construct private type *)
```

### Comparison to identity Guarantees

Private types provide a **stronger** guarantee than `identity`: not only is the value
stable for reads, but external code cannot create or modify instances at all. The read
interface is the only interface.

| Private Type Concept       | TypeScript-Go Analog           | Guarantee Level                  |
|----------------------------|--------------------------------|----------------------------------|
| `private int`              | `readonly` + branded type      | Constructible only internally    |
| `val value : t -> int`     | `identity get value()`         | Read-only access                 |
| `val create : int -> t`    | Factory function               | Controlled construction          |
| Type abbreviation visible  | Type alias exposed             | Users know the shape             |

### Private Rows (Private Variant Types)

OCaml also supports **private rows** — variant types where external code can match on
existing constructors but cannot add new ones:

```ocaml
module Color : sig
  type t = private [> `Red | `Green | `Blue ]
  val red : t
  val green : t
  val blue : t
end = struct
  type t = [ `Red | `Green | `Blue ]
  let red = `Red
  let green = `Green
  let blue = `Blue
end

(* Can match: *)
let is_red = function
  | `Red -> true
  | _ -> false

(* Cannot construct: *)
(* let bad : Color.t = `Red  -- ERROR *)
```

This is structurally analogous to a sealed discriminated union with `identity`-like
guarantees: external code can narrow via pattern matching, but cannot introduce new
variants that would invalidate exhaustiveness checks.

---

## 7. Eio — Effect-Based I/O Library

### Eio Architecture

Eio is OCaml 5's new I/O library, built on algebraic effects. It uses effects to make
I/O operations composable and testable:

```ocaml
let fetch_data (net : Eio.Net.t) url =
  Eio.Net.connect net (`Tcp (addr, 80)) |> fun conn ->
  Eio.Flow.copy_string ("GET " ^ url ^ " HTTP/1.0\r\n\r\n") conn;
  Eio.Buf_read.of_flow conn ~max_size:1_000_000
  |> Eio.Buf_read.take_all

(* The net capability is passed in — can be replaced for testing *)
let () =
  Eio_main.run @@ fun env ->
  let data = fetch_data (Eio.Stdenv.net env) "http://example.com" in
  print_string data
```

### Capability Passing and Mutation Control

Eio uses **capability passing** — I/O resources are explicit parameters, not global
singletons. This makes mutation boundaries visible:

```ocaml
(* This function only reads — it takes a Eio.Flow.source *)
let read_all (src : _ Eio.Flow.source) : string =
  Eio.Buf_read.of_flow src ~max_size:1_000_000
  |> Eio.Buf_read.take_all

(* This function writes — it takes a Eio.Flow.sink *)
let write_all (sink : _ Eio.Flow.sink) (data : string) : unit =
  Eio.Flow.copy_string data sink
```

The type signatures declare capabilities:
- `Eio.Flow.source` = read capability (analogous to `identity`)
- `Eio.Flow.sink` = write capability (analogous to `mutator`)
- `Eio.Flow.two_way` = both read and write

### Lessons for TypeScript-Go

| Eio Concept                | TypeScript-Go Analog          | Insight                          |
|----------------------------|-------------------------------|----------------------------------|
| `Flow.source` (read cap)   | `identity` modifier           | Read-only capability at type lvl |
| `Flow.sink` (write cap)    | `mutator` modifier            | Write capability at type level   |
| Capability passing          | Interface with identity decl  | Explicit capability boundaries   |
| Effect-based I/O            | N/A (not applicable to TS)    | Too heavyweight for JS/TS        |
| Testability via cap. pass.  | Mockable via identity iface   | Same structural benefit          |

Eio demonstrates that separating read and write capabilities at the type level produces
better code — functions declare exactly what they can do, and the compiler enforces it.
TypeScript-Go achieves the same declaration at a lighter weight: `identity` marks "this
is a read" and `mutator` marks "this is a write," without requiring a full capability
system.

---

## 8. Alternative Syntax Ideas — Per-Field `mutable` Annotation for TypeScript

### Could TypeScript Adopt OCaml's `mutable` Per-Field Annotation?

OCaml's per-field `mutable` is simple and ergonomic:

```ocaml
type point = {
  mutable x : float;
  mutable y : float;
  color : string;        (* immutable — implicitly stable *)
}
```

A hypothetical TypeScript equivalent:

```typescript
interface Point {
  mutable x: number;
  mutable y: number;
  color: string;          // immutable — implicitly identity
}
```

### Evaluation

**Arguments for OCaml-style `mutable` per field:**

1. **Simpler mental model.** One keyword instead of three (`identity`/`mutator`/`links`).
   Fields are either mutable or not.
2. **Matches TypeScript's `readonly`.** TypeScript already has `readonly` — adding
   `mutable` as its inverse would be symmetric.
3. **Implicit identity.** Non-`mutable` fields are implicitly stable, just like OCaml.
   No need for a separate `identity` keyword.
4. **Familiar to ML-trained developers.** Direct carry-over from OCaml/F#.

**Arguments against (why TypeScript-Go's current design is better):**

1. **TypeScript properties are mutable by default.** Adding `mutable` as an
   annotation would mean the *default* behavior requires opt-in. This inverts the
   existing semantics — every interface in the ecosystem would need `mutable` on
   writable fields to be correct.

2. **`readonly` is not sound.** TypeScript's `readonly` does not guarantee immutability
   — it can be circumvented via type assertions, mapped types, and index signatures.
   If `mutable` implied absence is stable, the unsoundness of `readonly` would leak
   into narrowing decisions.

3. **Method mutation is not per-field.** OCaml's `mutable` works because mutation is
   syntactic (`p.x <- 5`). In TypeScript, a method like `reset()` might mutate
   multiple fields. Per-field `mutable` cannot express "reset invalidates x and y
   but not color" — you need `links` for that.

4. **Callable getters are not fields.** The core use case for `identity` is callable
   read endpoints (signal getters, `()` calls) that look like function calls, not
   property accesses. Per-field `mutable` does not capture this pattern.

5. **Incremental adoption is harder.** Adding `mutable` to every writable field in
   existing codebases is a massive migration burden. `identity` on specific stable
   endpoints is opt-in and incremental.

### Hybrid Approach

A possible middle ground: use `mutable` for field declarations and `mutator`/`links`
for method declarations:

```typescript
interface State {
  mutable count: number;           // field — mutation via assignment
  readonly label: string;          // field — stable (existing keyword)
  identity get derived(): string;  // method — stable read endpoint
  mutator links(count) reset(): void;  // method — writes count
}
```

This separates the field-level annotation (where OCaml's model is natural) from the
method-level annotation (where TypeScript-Go's richer contracts are needed). However,
this adds complexity by introducing four keywords for mutation control instead of three.

### Recommendation

TypeScript-Go's current `identity`/`mutator`/`links` design is preferable to OCaml's
per-field `mutable` because:

1. TypeScript is mutable-first — opt-in stability (`identity`) is more practical than
   opt-in mutation (`mutable`).
2. Method-level mutation contracts (`mutator links(...)`) capture relationships that
   per-field annotations cannot express.
3. Gradual adoption of `identity` is incremental and backwards-compatible.
4. The callable getter use case (signals, computed values) has no analog in OCaml's
   field-based model.

---

## Summary: Lessons from OCaml

| Lesson                          | OCaml Approach                 | TypeScript-Go Approach           |
|---------------------------------|--------------------------------|----------------------------------|
| Default mutability              | Immutable (unmarked)           | Mutable (unmarked)               |
| Opt-in mutation                 | `mutable` per field            | Default — opt-in stability       |
| Mutation visibility             | `<-` operator, `:=` for refs   | `mutator` modifier               |
| Stable read endpoints           | All non-`mutable` fields       | `identity` modifier              |
| Selective invalidation          | `with` expression (per-field)  | `links` clause (per-endpoint)    |
| Effect tracking                 | Algebraic effects (OCaml 5)    | `mutator` (binary annotation)    |
| Capability control              | Module signatures + functors   | Interfaces with identity decl    |
| Exhaustive narrowing            | Compiler-enforced match        | `never` check in switch          |
| Ref cells                       | `ref<'a>` explicit container   | Signal / mutable properties      |
| Private types                   | `type t = private int`         | Branded types (type-level)       |
| I/O read/write split            | Eio `source` / `sink`          | `identity` / `mutator`           |

### Core Takeaway

OCaml demonstrates that **per-field mutation annotation with immutable defaults** is the
gold standard for narrowing safety in ML-family languages. Every non-`mutable` field is
implicitly a stable read endpoint, and the compiler exploits this for sound pattern
matching, value sharing, and optimization.

TypeScript-Go cannot adopt this model directly because:

1. **Default mutability.** TypeScript properties are mutable by default. Retroactively
   annotating every mutable field would be an ecosystem-breaking change.
2. **Unsound `readonly`.** OCaml's immutability guarantee is enforced by the language.
   TypeScript's `readonly` is a lint-level hint, not a soundness guarantee.
3. **Callable read endpoints.** OCaml's model is field-centric. TypeScript-Go's core use
   case is callable getters (signals), which are methods, not fields.
4. **Method-level mutation effects.** A TypeScript method might mutate multiple fields
   in non-obvious ways. OCaml's per-field `mutable` cannot express "this function
   invalidates these specific read endpoints."

TypeScript-Go's `identity`/`mutator`/`links` system is OCaml's per-field annotation
adapted for a mutable-first, method-heavy language:

- **`identity`** = OCaml's unmarked immutable field (explicit because TS defaults differ)
- **`mutator`** = OCaml's `mutable` annotation (marks mutation contracts on methods)
- **`links`** = OCaml's `{ p with x = ... }` pattern (selective invalidation targeting)

The strongest insight from OCaml is that **per-field granularity is the right level of
abstraction** for mutation tracking. OCaml proves this with `mutable` on record fields;
TypeScript-Go applies the same principle to method signatures via `identity`/`mutator`.
Both systems reject coarse-grained "the whole object is mutable" in favor of precise
"exactly these endpoints have these mutation properties."

OCaml 5's algebraic effects are theoretically the most general solution — a full effect
system could express every narrowing relationship as a typed effect. But this
generality comes with prohibitive complexity for TypeScript's audience. TypeScript-Go's
binary `identity`/`mutator` annotation is the pragmatic extraction: just enough effect
information to enable safe CFA narrowing, without requiring developers to learn an
effect system.