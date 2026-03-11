# Design Review: Algebraic Effect Systems — Koka, Eff, Frank, Links, Effekt

## Overview

Algebraic effect systems in research languages provide fine-grained, composable,
type-level tracking of side effects — reads, writes, exceptions, I/O, nondeterminism,
and more. These systems represent the state of the art in effect typing and offer the
most principled comparison point for TypeScript-Go's `identity`/`mutator`/`links`
contracts. This document examines five research languages (Koka, Eff, Frank, Links,
Effekt), the shared theory of row polymorphism for effects, effect inference, and the
pragmatic trade-offs that led TypeScript-Go to adopt a targeted subset rather than a
full effect system.

---

## 1. Koka — Row-Based Effect Types

### Effect Rows

Koka (Microsoft Research) tracks effects through row-based effect types. Every function
signature includes an effect row that enumerates which effects the function may perform:

```koka
fun read-file(path: string): <io,exn> string
//                            ^^^^^^^ effect row: may do IO and throw exceptions

fun pure-add(x: int, y: int): total int
//                             ^^^^^ no effects — guaranteed pure
```

The effect row is a **set** of effect labels. Koka distinguishes:

- `total` — no effects at all (pure)
- `exn` — may throw exceptions
- `div` — may diverge (nontermination)
- `io` — may perform I/O
- `st<h>` — may access mutable state in heap region `h`
- `read<h>` / `write<h>` — fine-grained read/write on heap `h`

### Read/Write Effect Separation

Koka splits mutable state effects into separate `read` and `write` components:

```koka
fun get-value(ref: ref<h,int>): <read<h>> int
//                                ^^^^^^^ only reads from heap h

fun set-value(ref: ref<h,int>, v: int): <write<h>> ()
//                                       ^^^^^^^^ only writes to heap h

fun increment(ref: ref<h,int>): <read<h>,write<h>> ()
//                                ^^^^^^^^^^^^^^^^^ both read and write
```

This is structurally parallel to `identity`/`mutator`:

| Koka Effect        | TypeScript-Go Analog   | Semantics                                |
|--------------------|------------------------|------------------------------------------|
| `read<h>`          | `identity` read        | Observes state, does not invalidate      |
| `write<h>`         | `mutator` call         | Modifies state, invalidates read facts   |
| `st<h>` (= read+write) | Unmodified method | May do either; conservative assumption   |
| Heap region `h`    | `links` target         | Scopes which state is affected           |

### Row Polymorphism

Koka uses row polymorphism to make effects composable. A higher-order function can be
polymorphic over the effects of its argument:

```koka
fun map(xs: list<a>, f: (a) -> <e> b): <e> list<b>
//                                 ^^^ effect variable e
//                                      ^^^ propagated to result
```

The effect variable `e` captures whatever effects `f` performs and propagates them to
`map`'s effect row. This means `map` with a pure function is pure, and `map` with an
effectful function is effectful — automatically, without overloads.

### Comparison to identity/mutator

Koka's system is **strictly more expressive** than `identity`/`mutator`:

- Koka tracks effects on every function, not just declared stable endpoints.
- Koka's heap regions provide a type-level mechanism like `links`, but generalized
  to arbitrary state partitioning.
- Koka infers effects automatically — developers rarely write effect annotations.
- Koka's `total` effect guarantees referential transparency, which is stronger than
  `identity`'s "stable within a flow region" contract.

The cost: every function in Koka carries effect type information, every call site
propagates effects through row unification, and the effect system is a core part of the
type algebra. This is far too heavy for TypeScript's structural type system.

---

## 2. Eff — Algebraic Effect Operations and Handlers

### Effect Declarations

Eff (Matija Pretnar, Andrej Bauer) uses algebraic effects as first-class operations.
Effects are declared with typed operation signatures:

```eff
effect State = {
  operation get : unit -> int
  operation set : int -> unit
}
```

Each operation is a typed contract: `get` takes unit and returns int, `set` takes int
and returns unit. These operations do not have built-in semantics — their meaning is
defined by **handlers**.

### Handlers

Handlers give meaning to effect operations, analogous to try/catch but for arbitrary
effects:

```eff
handler {
  operation get () k -> k !state     (* resume with current state *)
  operation set v k  -> state := v; k ()  (* mutate and resume *)
}
```

The handler intercepts `get` and `set` operations and provides their implementation.
The continuation `k` represents the rest of the computation after the operation.

### Effect Rows

Eff tracks which effects a computation may perform through effect rows in the type:

```eff
val read_twice : unit -> {State} int
(* read_twice performs State operations *)

val pure_compute : int -> {} int
(* pure_compute has no effects *)
```

### Comparison to identity/mutator

| Eff Concept            | TypeScript-Go Analog            | Key Difference                       |
|------------------------|---------------------------------|--------------------------------------|
| `operation get`        | `identity` callable             | Eff: handler-defined semantics       |
| `operation set`        | `mutator` method                | Eff: handler can intercept/reorder   |
| Effect row `{State}`   | Declaration on interface        | Eff: compositional row types         |
| Handler                | (no equivalent)                 | Eff: effects are first-class values  |
| Empty effect row `{}`  | Pure function                   | Eff: machine-checked guarantee       |

Eff's key insight is that effects are **definable**, not built-in. A language can
introduce new effect kinds (logging, async, nondeterminism) without modifying the core
type system. TypeScript-Go's `identity`/`mutator`/`links` is a fixed vocabulary for one
specific effect dimension (read stability vs. write invalidation), not an extensible
effect algebra.

---

## 3. Frank — Multi-Handler Effects and Ability Types

### Ability Types

Frank (Sam Lindley, Conor McBride) uses **ability types** instead of effect rows. An
ability is a set of commands (operations) that a computation may invoke:

```frank
interface State X = get : X
                  | put : X -> Unit
```

Functions declare which abilities they require:

```frank
next : {[State Int]Int}
next! = put (get! + 1); get!
```

The `{[State Int]Int}` type says: this is a thunk that requires `State Int` ability and
returns `Int`.

### Multi-Handlers

Frank's distinctive feature is **multi-handlers**, which can handle multiple computations
simultaneously, mediating between their effects:

```frank
pipe : {<Send X>Unit -> <Receive X>Y -> [Abort]Y}
```

A `pipe` handler connects a computation that sends values to one that receives them.
This allows compositional plumbing of effects across computation boundaries.

### Comparison to identity/mutator

Frank's ability types parallel `links` in an interesting way:

- In Frank, abilities are **parameterized**: `State Int` vs `State String` are different
  abilities, just as `links user` and `links settings` target different endpoints.
- Multi-handlers connect effect producers and consumers, similar to how a `mutator`
  with `links` declares which `identity` endpoints it invalidates.
- Frank types make the "who can affect whom" relationships explicit in the type signature,
  which is the same goal as `links` metadata.

The key difference: Frank's system is structural and machine-checked. `links` is
declarative metadata trusted by the checker without semantic verification.

---

## 4. Links — Effect Typing in a Web Programming Language

### Row-Based Effect Types

Links (University of Edinburgh) is a web programming language with row-based effect
types. Effects track different kinds of computation capabilities:

```links
sig readState : () {Get:a |e}-> a
fun readState() { do Get }

sig writeState : (a) {Put:(a) {}-> () |e}-> ()
fun writeState(v) { do Put(v) }
```

The effect row `{Get:a |e}` means "this function performs the `Get` operation (returning
type `a`) and possibly other effects `e`." The `|e` is a row variable enabling effect
polymorphism.

### Effect Polymorphism for Web Tiers

Links uniquely extends effect typing to web tier separation. Effects distinguish
client-side, server-side, and database computations:

```links
# Server-side function — cannot run on client
sig serverOnly : () {hear:_, |e}-> String
fun serverOnly() { ... }

# Client-side function — cannot run on server  
sig clientOnly : () {wild:_, |e}-> ()
fun clientOnly() { ... }
```

### Comparison to identity/mutator

Links demonstrates that effect rows can scope tracking to **regions** of a system (client,
server, database) rather than just effect kinds. This parallels `links`-clause targeting:

| Links Concept          | TypeScript-Go Analog        | Semantics                          |
|------------------------|-----------------------------|------------------------------------|
| `{Get:a \|e}`          | `identity` read effect      | Observable, does not modify state  |
| `{Put:(a) {}-> () \|e}`| `mutator` write effect      | Modifies state, invalidates reads  |
| Row variable `\|e`     | Heuristic tier propagation  | Open-ended effect composition      |
| Web tier effects       | `links` endpoint targeting  | Scoping effects to specific domains|

Links' row variables (`|e`) are particularly relevant. They represent "and whatever other
effects the caller performs" — this is the compositional glue that lets effects propagate
through higher-order functions. TypeScript-Go's heuristic tier system achieves a
similar (but much weaker) form of propagation: Tier 2 infers mutator impact through
local alias-preserving forwarding, which is a hand-tuned approximation of what row
variables provide for free.

---

## 5. Effekt — Lightweight Effect Polymorphism

### Capability-Based Effects

Effekt (University of Tübingen) takes a different approach: effects are modeled as
**capabilities** that are passed to functions, not as row types:

```effekt
effect Emit[A] {
  def emit(value: A): Unit
}

def generate(n: Int) { cap: Emit[Int] =>
  var i = 0
  while (i < n) {
    cap.emit(i)
    i = i + 1
  }
}
```

Effect capabilities are second-class — they cannot be stored in data structures or
returned from functions. This restriction ensures that effect handlers are always on the
stack, enabling efficient compilation.

### Lightweight Polymorphism

Effekt achieves effect polymorphism without row types by using **contextual abstraction**.
Functions are automatically polymorphic over the effects of their arguments:

```effekt
def map[A, B](xs: List[A]) { f: A => B }: List[B]
```

The function `f` may perform arbitrary effects, and those effects are automatically
tracked. Unlike Koka's row variables, Effekt achieves this through its capability-passing
discipline rather than explicit polymorphic effect variables.

### Second-Class Capabilities and Safety

Effekt's second-class restriction on capabilities provides a key safety property:
capabilities cannot escape their handler's scope. This means:

- A capability received by a closure cannot be invoked after the handler has returned.
- Effect safety is guaranteed without complex ownership or lifetime tracking.
- The compiler can always determine statically which handler will service an effect.

### Comparison to identity/mutator

| Effekt Concept              | TypeScript-Go Analog          | Key Insight                          |
|-----------------------------|-------------------------------|--------------------------------------|
| Effect capability           | Interface method contract     | Both scope what operations are available |
| Second-class restriction    | Local flow region boundaries  | Both limit effect scope to prevent escapes |
| Capability passing          | Receiver identity tracking    | Both trace "who can do what to whom" |
| Handler scope = effect scope| Uncertainty boundary = invalidation | Both tie effect validity to lexical scope |

Effekt's key insight for TypeScript-Go: the second-class restriction on capabilities
is analogous to `identity`'s flow-region scoping. Just as Effekt capabilities cannot
escape their handler, `identity` narrowing facts cannot survive past uncertainty
boundaries. Both systems use scope restriction as a tractability mechanism.

---

## 6. Row Polymorphism for Effects — The Shared Foundation

### What Row Polymorphism Provides

All of the above systems (except Effekt) share a common theoretical foundation: **row
polymorphism**. A row type is an extensible record of labels → types:

```
{ read : (), write : int → () | ε }
```

The row variable `ε` (often written `|e` or `<e>`) represents "and possibly more effects."
This enables:

1. **Subtyping-free composition** — A function with effects `{read | e}` can be used
   anywhere that expects `{read, write | e}` without subtype coercion. The row variable
   absorbs the difference.

2. **Automatic propagation** — Higher-order functions inherit the effects of their
   arguments through row unification:
   ```
   map : (a → <e> b) → List<a> → <e> List<b>
   ```

3. **Selective handling** — A handler can "peel off" one effect from the row, leaving
   the rest for an outer handler:
   ```
   handle { ... } with State  →  remaining effects: {exn, io | e}
   ```

### Row Polymorphism vs. links

Row polymorphism solves the same problem as `links` — selective effect scoping — but
with a general-purpose mechanism:

| Row Polymorphism Feature | `links` Clause Equivalent | Difference                          |
|--------------------------|---------------------------|-------------------------------------|
| Named effect labels      | Named identity endpoints  | Rows: open-ended; links: closed set |
| Row variable `\|e`       | (no equivalent)           | Rows compose; links are terminal    |
| Row unification          | Heuristic tier inference  | Rows: decidable; heuristics: best-effort |
| Handler peeling          | Selective invalidation    | Handlers: compositional; links: flat |

The critical gap: row polymorphism is **compositional** — effects propagate through
any number of function call layers automatically. `links` is **flat** — it declares
a direct relationship between a mutator and specific identity endpoints, with no
mechanism for transitive propagation. Heuristic tiers partially compensate (Tier 2
follows local alias-preserving forwarding), but this is hand-tuned rather than
principled.

---

## 7. Effect Inference — Automatic vs. Heuristic

### How Research Languages Infer Effects

Most effect system languages infer effect types automatically:

**Koka:** Full Hindley-Milner-style inference extended with row types. Effect annotations
are almost never required — the compiler infers effect rows from the operations a
function performs:

```koka
fun example(r: ref<h,int>)
  val v = !r        // inferred: read<h>
  r := v + 1        // inferred: write<h>
  // overall effect: <read<h>, write<h>>  — inferred, not annotated
```

**Eff:** Bidirectional type inference with effect row constraints. Operations in the body
of a function determine the effect row.

**Links:** Constraint-based inference with row unification. Effect rows are inferred at
definition sites and unified at call sites.

**Effekt:** Capability-based inference. The presence or absence of capability parameters
determines effects.

### TypeScript-Go's Heuristic Tiers as Approximate Inference

TypeScript-Go's heuristic tier system is a **pragmatic approximation** of effect
inference. The tiers correspond to different inference strategies with decreasing
confidence:

| Research Language Inference | TypeScript-Go Heuristic Tier | Confidence |
|-----------------------------|------------------------------|------------|
| Direct operation in body    | Tier 1: direct receiver write | High — same syntactic locality |
| Effect propagation through call | Tier 2: alias-preserving forwarding | Medium — limited to provable identity |
| Global effect constraint solving | Tier 3: cross-file inference | Low — requires explicit contracts |

The fundamental difference:

- **Research languages:** Inference is **sound** — the inferred effect set is a
  guaranteed upper bound on actual effects. If the system says a function has no
  write effects, it truly cannot write.
- **TypeScript-Go:** Heuristic inference is **best-effort** — tiers represent
  confidence levels, not soundness guarantees. Tier 1 is very likely correct. Tier 2
  is correct when guards hold. Tier 3 is unreliable and escalates to explicit contracts.

This is the pragmatic core of TypeScript-Go's design: **trade soundness for adoptability**.
A sound effect system would require annotating every function in the ecosystem. Heuristic
tiers provide useful narrowing for the most common patterns without any annotation burden,
and explicit contracts (`mutator`/`links`) serve as the escape hatch when heuristics
are insufficient.

---

## 8. Trade-Offs — Why Full Effect Systems Are Too Heavy for TypeScript

### Structural Type System Incompatibility

TypeScript uses structural typing: two types are compatible if their shapes match,
regardless of declaration. Effect rows are **nominal** in nature — `{read, write}` and
`{write, read}` are the same row, but `{read}` and `{read, exn}` are not. Integrating
row types into TypeScript's structural type system would require:

- Extending structural compatibility checks to include effect row matching.
- Adding effect row subtyping or effect row unification to every function call.
- Making effect rows part of the assignability relation.

This would fundamentally change TypeScript's type checking performance and complexity.

### Annotation Burden

Research effect languages largely rely on inference to avoid annotation burden, but
TypeScript's type system is too complex for complete inference. TypeScript already requires
substantial type annotations for complex code. Adding effect annotations would multiply
the annotation surface:

```typescript
// Hypothetical TypeScript with full effects — every function needs effect types:
function processUser(store: Store): <read(store.user), write(store.settings)> void {
  const u = store.user();          // read(store.user)
  store.updateSettings(u.prefs);   // write(store.settings)
}
```

This is unacceptable for TypeScript's design goals. JavaScript developers should not
need to learn effect theory to use the language.

### Ecosystem Compatibility

TypeScript must interoperate with untyped JavaScript. A full effect system would require:

- Effect type annotations for all `.d.ts` declaration files.
- An "unknown effect" escape hatch for untyped JavaScript (similar to `any`), which
  would undermine the system's value.
- Effect-polymorphic types for standard library functions (`Array.prototype.map`,
  `Promise.then`, etc.), adding complexity to already-complex generic signatures.

### What identity/mutator/links Preserves

The `identity`/`mutator`/`links` system captures the **one specific effect dimension**
that matters most for CFA narrowing: read stability vs. write invalidation. It does not
attempt to be a general effect system:

| Full Effect System Feature    | identity/mutator/links | Rationale for Omission                |
|-------------------------------|------------------------|---------------------------------------|
| Arbitrary effect kinds        | Only read/write        | Other effects don't affect narrowing  |
| Effect polymorphism           | Heuristic tiers        | Row variables too complex for TS      |
| Compositional propagation     | Local flow analysis    | Interprocedural effects too expensive |
| Sound effect inference        | Best-effort heuristics | Soundness requires full annotation    |
| Effect handlers               | (not applicable)       | No runtime semantics needed           |
| Algebraic effect operations   | Interface methods      | Existing TS patterns suffice          |

### The Pragmatic Subset

The design philosophy is: **solve the narrowing problem, not the effect-tracking problem**.

Research effect systems answer: "What can this function do?" (read, write, throw, diverge,
perform I/O, etc.)

`identity`/`mutator`/`links` answers a narrower question: "Does this call invalidate a
previously-narrowed read?"

This narrower question admits a narrower solution:

1. `identity` marks the read endpoints worth tracking (opt-in, not pervasive).
2. `mutator` marks the write operations that invalidate them (heuristic-inferred for
   common patterns, explicitly declared for complex ones).
3. `links` scopes which writes affect which reads (selective invalidation when full
   invalidation is too conservative).

No row types. No effect variables. No effect handlers. No global effect inference.
Just enough information to extend CFA narrowing from properties to callable endpoints.

---

## 9. Summary — Research Landscape Positioning

```
                    Expressiveness
                         ↑
     Koka ──────────── Full row-based effect types + inference
     Eff  ──────────── Algebraic operations + handlers + rows
     Frank ─────────── Multi-handlers + ability types
     Links ─────────── Row effects + web tier separation
     Effekt ────────── Capability-based lightweight effects
                         │
          ─ ─ ─ ─ ─ ─ ─ ┤ ─ ─ ─ ─ ─ ─ ─  "Full effect system" threshold
                         │
     OCaml 5 ────────── Algebraic effects (limited inference)
     Haskell IO/ST ──── Monad-encoded effects (no general system)
                         │
          ─ ─ ─ ─ ─ ─ ─ ┤ ─ ─ ─ ─ ─ ─ ─  "Type-level effect tracking" threshold
                         │
     identity/mutator ── Targeted read/write invalidation contracts
     C# readonly ─────── Single-dimension immutability
     Rust & ────────── Borrow-based mutation exclusion
                         │
                    Adoptability →
```

TypeScript-Go's `identity`/`mutator`/`links` sits deliberately below the "full effect
system" threshold. It trades expressiveness for adoptability:

- **No new type algebra** — effects are metadata on existing declarations, not a new
  kind of type.
- **Heuristic inference** — most code needs no annotations. Explicit contracts are the
  exception, not the rule.
- **Flat invalidation** — `links` declares direct relationships, not compositional
  effect rows.
- **Local reasoning** — all narrowing is scoped to CFA flow regions, not global
  effect constraint solving.

The research effect systems prove that fine-grained effect tracking is theoretically
sound and practically implementable in purpose-designed languages. The contribution of
`identity`/`mutator`/`links` is extracting the **minimum viable subset** that delivers
the most-requested narrowing improvement (callable CFA parity with getter/setter CFA)
without requiring TypeScript to become an effect-typed language.
