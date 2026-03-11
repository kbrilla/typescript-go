# Design Review: Academic Programming Language Research — Foundational Theory Behind `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers, PL researchers
- Scope: Survey of academic PL research traditions that inform or parallel TypeScript-Go's identity CFA system

---

## Overview

TypeScript-Go's `identity`/`mutator`/`links` system occupies a design point that draws
on several decades of programming language research. This document surveys ten academic
research areas, tracing the theoretical lineage of the design choices and explaining why
a pragmatic type checker must take a substantially lighter approach than any of these
formalisms prescribe. The recurring theme: each academic system solves a flavor of the
same problem — "when can a type fact be trusted across time?" — but demands costs
(annotation burden, type algebra complexity, ecosystem disruption) that TypeScript cannot
absorb.

---

## 1. Uniqueness and Ownership Types — Wadler's Linear Types, Clean's Uniqueness Types

### Core Idea

Linear types (Wadler, 1990; Girard's linear logic, 1987) enforce that every value is
used exactly once. Clean's uniqueness types (Barendsen & Smetsers, 1993) are a practical
instantiation: a value with a uniqueness attribute is guaranteed to have no other
references. If a value is unique, it is safe to mutate in-place because no one else
can observe the change.

```clean
// Clean uniqueness types
updateArray :: *{Int} Int Int -> *{Int}
updateArray arr idx val = {arr & [idx] = val}
// The * prefix means the array is unique — no aliases exist.
// The compiler statically ensures uniqueness is preserved across the call.
```

In Rust, ownership types encode a similar discipline:

```rust
fn consume(v: Vec<i32>) {
    // v is moved here — caller can no longer use it
    println!("{:?}", v);
}

fn borrow(v: &Vec<i32>) {
    // shared borrow — read-only, multiple borrows allowed
    println!("{:?}", v);
}

fn mutate(v: &mut Vec<i32>) {
    // exclusive borrow — no other references may exist
    v.push(42);
}
```

The key invariant: **if you hold the only reference to a value, you know its type has
not been changed by someone else.** Uniqueness/ownership eliminates the aliasing problem
that makes narrowing unsound.

### Relationship to `identity`/`mutator`/`links`

The `identity` modifier encodes a dramatically weaker version of the uniqueness insight:

| Aspect | Uniqueness/Ownership | `identity`/`mutator`/`links` |
|--------|---------------------|------------------------------|
| **What is tracked** | Reference uniqueness — at most one live reference | Endpoint stability — repeated calls yield consistent type |
| **Alias handling** | Structural prohibition on aliasing | Conservative invalidation when alias escape is detected |
| **Mutation model** | Only unique reference holder can mutate | `mutator` declares which operations invalidate which endpoints |
| **Scope** | Whole-program (Rust borrow checker) or whole-expression (Clean) | Local CFA flow region |
| **Soundness** | Fully sound — type system enforces | Declarative — developer asserts correctness |

The `links` clause is analogous to ownership's region-scoping: just as Rust's lifetimes
connect borrows to their owners, `links` connects mutators to the specific identity
endpoints they invalidate. But where Rust enforces this connection structurally through
the borrow checker, TypeScript relies on developer declaration.

### What TypeScript Could Learn

- **Selective invalidation is the key insight.** Ownership systems prove that tracking
  which mutations affect which values enables precise reasoning. `links` captures this
  at declaration granularity rather than reference granularity.
- **The "no alias" intuition maps to "no interleaved writes."** Identity narrowing trusts
  that between a narrowing read and a subsequent read, no mutation has occurred. This is
  the temporal equivalent of uniqueness's spatial "no other references" guarantee.

### Why Full Uniqueness/Ownership Is Too Heavy

- **Annotation burden.** Rust's lifetime annotations pervade function signatures, and even
  Rust developers cite lifetimes as the primary learning barrier. Adding ownership tracking
  to TypeScript's structural type system would require pervasive annotation on every function.
- **Ecosystem incompatibility.** JavaScript's object model is fundamentally aliased — objects
  are always references, closures capture by reference, and the prototype chain creates
  implicit sharing. An ownership system would reject the majority of idiomatic JS patterns.
- **Structural typing conflict.** Ownership relies on nominal identity of values. TypeScript's
  structural types mean that two structurally identical objects are interchangeable, making
  reference-tracking intractable without a fundamental type system redesign.

---

## 2. Region-Based Memory Management — Tofte-Talpin Regions

### Core Idea

Tofte and Talpin (1994, 1997) proposed region-based memory management as an alternative
to garbage collection. Values are allocated into named regions, and entire regions are
deallocated at once when their lexical scope ends. The type system tracks which region
each value lives in, and prevents dangling references by ensuring no reference outlives
its region.

```
// Tofte-Talpin-style pseudocode
letregion ρ in
  let x = alloc_in(ρ, 42) in
  let y = alloc_in(ρ, x + 1) in
  use(y)
  // end of letregion: ρ is deallocated, x and y are freed
```

The ML Kit compiler (Tofte et al., 1998) implemented this for Standard ML, achieving
competitive performance with garbage collection for many programs. Cyclone (Jim et al.,
2002) extended the idea with safe manual memory management and region subtyping.

### Relationship to `identity`/`mutator`/`links`

The parallel is not about memory but about **scope-bounded validity of facts**:

| Aspect | Tofte-Talpin Regions | Identity CFA Regions |
|--------|---------------------|---------------------|
| **Region** | Lexical scope where values live | CFA flow region where narrowing facts are valid |
| **Allocation** | Value placed into named region | Narrowing fact established by `identity` read |
| **Deallocation** | Region end invalidates all values | `mutator` call or uncertainty boundary invalidates facts |
| **Outliving prevention** | Type error if reference escapes region | Conservative invalidation at boundary escape |
| **Nesting** | Regions can nest — inner regions die first | Flow regions nest — inner blocks inherit outer narrowing |

The `links` clause functions like region annotations — it declares which "fact region"
(identity endpoint) is invalidated by which operation, just as region types declare which
region is deallocated by which scope exit.

### What TypeScript Could Learn

- **Lexical scoping as a soundness boundary.** Tofte-Talpin proved that lexical scope
  provides sufficient structure for safe resource management without runtime overhead.
  Identity CFA uses the same insight: narrowing facts are valid within a flow scope and
  are invalidated at scope exits (uncertainty boundaries).
- **Region polymorphism.** Tofte-Talpin developed region polymorphism to avoid "region
  monomorphization" — functions that work over values from different regions don't need
  separate copies. This is analogous to `identity` applying uniformly regardless of which
  concrete type the endpoint returns.

### Why Full Region Types Are Too Heavy

- **Region inference is undecidable in general.** The ML Kit required extensive region
  inference algorithms that sometimes produced suboptimal region lifetimes. Translating
  this to TypeScript's already-complex inference engine would be impractical.
- **JavaScript has no regions.** JS uses garbage collection exclusively. Region types
  model a resource management concern that doesn't exist in the JS runtime. Mapping region
  concepts onto CFA flow is useful for reasoning but doesn't justify a full region type system.
- **Annotation overhead.** Even Cyclone, designed for practical use, required region annotations
  on pointers. TypeScript cannot add region parameters to its type syntax without massive
  ecosystem disruption.

---

## 3. Fractional Permissions — Boyland's Model for Shared/Exclusive Access

### Core Idea

Boyland (2003) introduced fractional permissions to provide a mathematically clean model
for shared versus exclusive access to mutable state. Each reference holds a fractional
permission — a value between 0 and 1:

- **Permission = 1 (full):** Exclusive access. The holder can read and write.
- **Permission = 1/n (fractional):** Shared read access. Multiple holders each have a
  fraction, totaling 1. No one can write, because no one has full permission.
- **Permission = 0:** No access.

```
// Pseudocode for fractional permissions
let x : Ref<Int, 1>        // full permission — can read and write
let (y, z) = split(x)      // y : Ref<Int, 1/2>, z : Ref<Int, 1/2>
                            // both can read, neither can write
let w = join(y, z)          // w : Ref<Int, 1> — full permission restored
```

The critical property: **permissions are conserved.** You cannot create permission out of
nothing. If you split a full permission into two halves, you must recombine them before
writing is possible again.

Drossopoulou and colleagues extended this to "permission-based separation logic" for Java
(Heule et al., 2011), and Plural (Bierhoff & Aldrich, 2007) brought fractional permissions
to practical Java verification.

### Relationship to `identity`/`mutator`/`links`

| Aspect | Fractional Permissions | `identity`/`mutator`/`links` |
|--------|----------------------|------------------------------|
| **Read access** | Any nonzero fraction (shared) | `identity` read — stable observation |
| **Write access** | Full permission only (exclusive) | `mutator` call — declared state change |
| **Permission transfer** | Split/join operations | Not modeled — TypeScript doesn't track access fractions |
| **Soundness basis** | Conservation of permissions | Developer-declared contracts |
| **Concurrency safety** | Naturally extends to concurrent reads | Not applicable — JS is single-threaded in practice |

The `identity` modifier can be seen as asserting "this call requires only read permission,"
while `mutator` asserts "this call requires write permission." The `links` clause is
analogous to permission annotations that scope which reference is being written.

### What TypeScript Could Learn

- **The read/write distinction is fundamental.** Fractional permissions formalize the
  intuition that reading and writing are categorically different operations with different
  safety requirements. `identity`/`mutator` captures this at the API contract level.
- **Conservation as a reasoning tool.** Permissions being conserved means you can always
  account for who can modify what. While TypeScript doesn't track permissions, the CFA
  flow graph provides a weaker form of accounting — facts established at reads are
  "consumed" (invalidated) at writes.

### Why Full Fractional Permissions Are Too Heavy

- **Algebraic overhead.** Fractional permissions require tracking numeric fractions through
  the type system, with arithmetic on type-level values. TypeScript's type system has no
  facility for type-level arithmetic on permissions.
- **Splitting/joining discipline.** Every function call that shares a reference requires
  explicit permission splitting, and the caller must manage recombination. This is
  conceptually clean but practically burdensome for JavaScript's pervasively shared
  reference model.
- **No practical adoption.** Despite elegant theory, fractional permissions have not been
  adopted by any mainstream language. Even Rust's borrow checker, heavily influenced by
  this work, uses a simplified binary model (shared `&T` vs exclusive `&mut T`) rather
  than true fractions.

---

## 4. Typestate — Strom & Yemini's State-Dependent Types

### Core Idea

Typestate (Strom & Yemini, 1986) extends a type system with state-dependent types: a
value's type changes as operations are performed on it. The canonical example is a file
handle that transitions through states:

```
// Typestate pseudocode
File f = open("data.txt");   // f : File<Open>
String s = f.read();          // f : File<Open> (still open after read)
f.close();                    // f : File<Closed>
f.read();                     // TYPE ERROR: cannot read from File<Closed>
```

The Plaid language (Aldrich et al., 2009; Sunshine et al., 2011) made typestate a
first-class language feature, where objects carry state specifications and operations
declare state transitions:

```
// Plaid-style typestate
state File {
  state Open {
    method read() : String [Open >> Open]
    method close() : void  [Open >> Closed]
  }
  state Closed {
    method reopen() : void [Closed >> Open]
  }
}
```

The state transitions `[Open >> Open]` and `[Open >> Closed]` are checked by the type
system. Calling `close()` on a `File<Closed>` is a static error.

### Relationship to `identity`/`mutator`/`links`

Typestate is perhaps the closest academic analog to the `identity`/`mutator` interaction:

| Aspect | Typestate | `identity`/`mutator`/`links` |
|--------|-----------|------------------------------|
| **State observation** | State is part of the type | Narrowed type after `identity` read |
| **State transition** | Operation changes type from A to B | `mutator` call invalidates narrowed type (or narrows via constrained overload) |
| **Transition specification** | `[Pre >> Post]` annotations | `mutator`/`links` annotations |
| **Invalid operation prevention** | Type error if operation doesn't match current state | Conservative invalidation — narrowed type no longer trusted |
| **Precision** | Exact state known at every point | Narrowed but may lose precision at uncertainty boundaries |

The constrained overload effect in `identity`/`mutator` is directly typestate-like:

```typescript
interface WritableSignal<T> {
  identity (): T;
  mutator update<U extends T>(fn: (value: T) => U): void;
}

declare const s: WritableSignal<string | undefined>;
s.update(() => "hello");
// Post-call: s() narrows to string (typestate transition)
```

This is a simplified `[string | undefined >> string]` transition driven by the constrained
overload resolution, not by explicit typestate annotations.

### What TypeScript Could Learn

- **Post-call narrowing is typestate narrowing.** The constrained overload effect in the
  identity spec is exactly typestate: an operation's signature determines how the observed
  type changes. TypeScript already does this for type guards — the identity system extends
  it to callable endpoints.
- **Not all state changes invalidate — some refine.** Typestate distinguishes destructive
  transitions (file closing) from refinement transitions (initializing a field). Similarly,
  `mutator` with constrained overloads can narrow rather than just invalidate.

### Why Full Typestate Is Too Heavy

- **State explosion.** For objects with N independent state components, the typestate space
  is exponential. TypeScript's union and intersection types already handle type refinement
  without requiring explicit state enumerations.
- **Aliasing destroys typestate.** If two references point to the same file handle, one
  can close it while the other still believes it's open. Plaid addressed this with
  access permissions (combining typestate with fractional permissions), but this compounds
  the annotation burden. TypeScript's aliased object model makes typestate tracking
  across references intractable.
- **Incompatible with structural typing.** Typestate requires tracking the current state
  of individual values through the flow graph. TypeScript's structural typing means an
  object's type is determined by its shape, not its history. A `File<Open>` and a
  `File<Closed>` with the same structural shape would be considered the same type.

---

## 5. Gradual Typing Theory — Siek & Taha

### Core Idea

Gradual typing (Siek & Taha, 2006, 2007) provides a theory for mixing statically typed
and dynamically typed code within the same language. The key innovation is the
**consistent** relation (`~`), which replaces the subtype relation at boundaries between
typed and untyped code:

```
Int ~ Int           // static types are consistent with themselves
Int ~ ?             // any type is consistent with the dynamic type ?
? ~ String          // the dynamic type is consistent with any type
Int ~/~ String      // incompatible static types are not consistent
```

The dynamic type `?` (written `any` in TypeScript) acts as a universal consistency
wildcard. At the boundary between typed and untyped code, the gradual type system inserts
runtime casts that enforce type contracts dynamically:

```typescript
// Conceptual gradual typing boundary
function typed(x: number): number { return x + 1; }
function untyped(x: any): any { return x + 1; }

// At the boundary, a runtime cast is inserted:
let result: number = untyped(42);  // cast<number>(untyped(42))
```

Siek and Taha's **gradual guarantee** states that removing type annotations from a
well-typed program always produces a well-typed program (the program only gets more
permissive), and adding correct type annotations to a well-typed program always produces
a well-typed program.

### Relationship to `identity`/`mutator`/`links`

Gradual typing's insight applies to how `identity` contracts interact with untyped code:

| Aspect | Gradual Typing | `identity`/`mutator`/`links` |
|--------|---------------|------------------------------|
| **Typed/untyped boundary** | `?` type at boundary, casts inserted | Uncertainty boundary at unknown calls, conservative invalidation |
| **Gradual guarantee** | Adding types only catches more errors | Adding `identity` only enables more narrowing |
| **Blame tracking** | Runtime cast failures blamed on boundary | Diagnostics `TSX0001`/`TSX0002` guide authors to add annotations |
| **Precision spectrum** | Fully dynamic → fully static | Fully conservative → fully annotated with `links` |
| **Migration path** | Add types incrementally | Add `identity`/`mutator`/`links` incrementally |

The tiered heuristic system directly embodies gradual typing's migration philosophy:

- **Tier 3 (no annotations):** Fully conservative, like `any`-typed code.
- **Tier 2 (partial confidence):** Medium precision with guardrails, like partially typed code.
- **Tier 1 (high confidence or explicit annotations):** Full precision, like fully typed code.

### What TypeScript Could Learn

- **The gradual guarantee as a design test.** Any new narrowing contract should satisfy:
  removing annotations makes behavior more conservative (never less), and adding correct
  annotations makes behavior more precise (never unsound). The identity system's tiered
  heuristics are designed to satisfy this property.
- **Blame assignment at boundaries.** Gradual typing's blame calculus (Wadler & Findler,
  2009) provides a principled way to identify which boundary introduced a type error.
  The `TSX0001`/`TSX0002` diagnostics serve this role — they identify where annotation
  boundaries are insufficient and guide correction.
- **Incremental adoption is non-negotiable.** Gradual typing's central lesson is that all
  or nothing approaches fail. TypeScript itself is the most successful gradual type
  system in practice. The identity system must follow the same philosophy.

### Why Full Gradual Typing Theory Is Too Heavy (As Applied to Effects)

- **Runtime casts.** Gradual typing achieves soundness through runtime casts at boundaries.
  TypeScript has no runtime layer — `identity` contracts are purely compile-time. This
  means TypeScript's gradual effect tracking is inherently unsound in the presence of
  incorrect annotations.
- **Cast insertion overhead.** A fully gradual effect system would insert effect-checking
  code at every function call boundary, with significant runtime cost.
- **Effect consistency relation.** Extending the consistency relation to effect types
  requires defining what it means for an effect row to be consistent with `?`. The theory
  exists (Bañados Schwerter et al., 2014, 2020 — gradual effect typing) but adds
  substantial complexity to the type algebra.

---

## 6. Occurrence Typing — Tobin-Hochstadt & Felleisen (Typed Racket)

### Core Idea

Occurrence typing (Tobin-Hochstadt & Felleisen, 2008, 2010) is the academic formalization
of what TypeScript calls "type narrowing" or "type guards." Developed for Typed Racket,
occurrence typing provides a type-theoretic foundation for flow-sensitive typing after
type tests.

The key insight: when a program tests a value's type, the result of that test carries
type information that refines the variable's type in subsequent code:

```racket
;; Typed Racket occurrence typing
(: safe-add (-> (U Number String) (U Number String) Number))
(define (safe-add x y)
  (cond
    [(and (number? x) (number? y))
     (+ x y)]                         ; x : Number, y : Number
    [(and (string? x) (string? y))
     (+ (string->number x)            ; x : String, y : String
        (string->number y))]
    [else 0]))
```

Typed Racket's system is based on **logical propositions** attached to expressions:

```
e : τ | ψ+ | ψ-
```

Where `ψ+` is the proposition that holds when `e` is truthy, and `ψ-` is the proposition
that holds when `e` is falsy. For `(number? x)`:

```
(number? x) : Boolean | x:Number | x:¬Number
```

These propositions propagate through boolean connectives:

```
(and A B) : τ | (ψ+_A ∧ ψ+_B) | (ψ-_A ∨ ψ-_B)
(or  A B) : τ | (ψ+_A ∨ ψ+_B) | (ψ-_A ∧ ψ-_B)
(not A)   : τ | ψ-_A           | ψ+_A
```

### Relationship to `identity`/`mutator`/`links`

TypeScript's existing CFA narrowing is already an implementation of occurrence typing.
The identity system extends it to callable endpoints:

| Aspect | Occurrence Typing (Typed Racket) | TypeScript CFA + Identity |
|--------|----------------------------------|---------------------------|
| **Narrowing trigger** | Type predicate in conditional | Type guard, `typeof`, `instanceof`, identity read in conditional |
| **Fact representation** | Logical propositions on variables | Flow facts on symbols / identity endpoints |
| **Fact propagation** | Through boolean connectives | Through CFA flow graph edges |
| **Fact invalidation** | Variable reassignment | Assignment, `mutator` call, uncertainty boundary |
| **Callable reads** | Not addressed — Racket predicates are pure by assumption | `identity` extends narrowing to repeated callable reads |

The crucial extension: Typed Racket's occurrence typing assumes that predicate functions
are pure. In TypeScript, a function like `getValue()` may return different values across
calls. The `identity` modifier bridges this gap by asserting that a callable endpoint
behaves like a pure observation — it can be treated as a stable read for narrowing
purposes.

### What TypeScript Could Learn

- **Propositions as first-class typing artifacts.** Typed Racket's formal proposition
  system provides a clean way to reason about narrowing. TypeScript's type predicate
  return types (`x is string`) are an ad-hoc version of this. The identity system's flow
  facts can be understood as propositions: "endpoint E returns type T at this flow node."
- **Negation is as important as assertion.** Occurrence typing tracks both positive and
  negative propositions. TypeScript does this for control flow (the else branch knows a
  type test failed), and the identity system should maintain this — when a `mutator` is
  known to remove a possibility, the post-call type should reflect the negation.
- **Path-sensitive typing.** Tobin-Hochstadt extended occurrence typing to track type
  information along object access paths (`x.y.z`). This is relevant to identity endpoints
  accessed through dotted paths.

### Why Full Occurrence Typing Is Too Heavy

- **TypeScript already has it.** The core of occurrence typing is already implemented in
  TypeScript's CFA. The challenge is not adopting the theory but extending it to callable
  endpoints without unsoundness — which is exactly what `identity` does.
- **Set-theoretic types.** Recent extensions to occurrence typing (Castagna & Lanvin, 2017)
  use set-theoretic types (union, intersection, negation as type-level set operations).
  TypeScript has unions and intersections but lacks negation types, making a full
  formalization impossible without extending the type algebra.
- **Termination and decidability.** Full occurrence typing with path sensitivity and
  recursive types can lead to undecidable type checking. TypeScript's existing narrowing
  already requires depth limits and heuristic cutoffs.

---

## 7. Dependent Types for State — Idris, Agda

### Core Idea

Dependent type systems (Martin-Löf, 1984) allow types to depend on values. Idris (Brady,
2013) and Agda (Norell, 2007) use dependent types to encode pre/post conditions directly
in function signatures, enabling verification of stateful protocols at type-check time:

```idris
-- Idris: A door protocol encoded in types
data DoorState = Open | Closed

data Door : DoorState -> Type where
  MkDoor : (state : DoorState) -> Door state

openDoor : Door Closed -> Door Open
openDoor (MkDoor Closed) = MkDoor Open

closeDoor : Door Open -> Door Closed
closeDoor (MkDoor Open) = MkDoor Closed

-- knockOnClosedDoor : Door Closed -> String
-- knockOnClosedDoor d = "knock knock"

-- Trying to open an already-open door is a TYPE ERROR:
-- bad : Door Open -> Door Open
-- bad d = openDoor d  -- Error: Can't match Door Open with Door Closed
```

Idris's `ST` library (Brady, 2017) extends this to mutable state with type-level state
tracking:

```idris
-- State transitions tracked in the type
login : (store : Var) ->
        ST m LoginResult
           [store ::: State LoggedOut :->
            (\res => State (case res of
                             OK => LoggedIn
                             BadPassword => LoggedOut))]
```

The return type of `login` depends on its runtime result — if login succeeds, the state
transitions to `LoggedIn`; if it fails, the state remains `LoggedOut`.

### Relationship to `identity`/`mutator`/`links`

| Aspect | Dependent Types (Idris/Agda) | `identity`/`mutator`/`links` |
|--------|------------------------------|------------------------------|
| **State in types** | Types literally contain state values | Narrowed type represents current observable state |
| **Pre/post conditions** | Function signature specifies exact state transitions | `mutator` specifies which endpoints are invalidated |
| **Verification** | Machine-checked proofs at compile time | Heuristic + declarative trust at compile time |
| **Expressiveness** | Can encode arbitrary protocols | Limited to narrowing invalidation/refinement |
| **Precision** | Exact — type encodes precise state | Approximate — narrowing may lose information |

The constrained overload effect is the closest parallel:

```typescript
// TypeScript-Go: state-dependent return type
interface Store {
  identity user(): User | undefined;
  mutator setUser<U extends User | undefined>(v: U): void links user;
}

// After: store.setUser(new User("Alice"))
// store.user() narrows to User (the U that was constrained)
```

This is a simplified version of Idris's dependent state transitions — the post-call type
depends on the argument type, but through overload resolution rather than full dependent
type computation.

### What TypeScript Could Learn

- **Types that remember operations.** The core insight of dependent types for state is
  that a value's type can evolve as operations are applied. The identity system implements
  a flow-sensitive version of this — the observed type of an endpoint changes based on
  which mutators have been called.
- **Protocol encoding without protocols.** Dependent types can encode multi-step protocols
  (open → read → close) in types. While TypeScript won't get dependent types, the
  identity + constrained overload pattern enables simple two-step protocols (check → use)
  that cover the majority of practical narrowing needs.

### Why Full Dependent Types Are Too Heavy

- **Type checking is undecidable.** Full dependent type checking is equivalent to theorem
  proving. Idris and Agda require interactive proof development for complex programs.
  TypeScript must type-check millions of lines of code in seconds.
- **Type-level computation.** Dependent types require evaluating arbitrary expressions at
  the type level. TypeScript has conditional types and template literal types that provide
  limited type-level computation, but extending this to full dependent types would make
  the type checker Turing-complete (worse — it already is, but keeping it practical
  requires strict limits).
- **Annotation burden.** Encoding state protocols in dependent types requires detailed
  annotations on every function signature. JavaScript libraries are not designed with
  this level of specification.

---

## 8. Information Flow Types — Denning's Lattice Model

### Core Idea

Information flow analysis (Denning, 1976; Denning & Denning, 1977) uses security
lattices to track how data flows through a program, preventing information leaks from
high-security to low-security contexts. The JFlow/Jif system (Myers, 1999) implemented
information flow types for Java:

```java
// Jif: information flow labels
int{Alice:} secret = 42;        // labeled: Alice can read
int{Alice:Bob} shared = 0;       // labeled: Alice owns, Bob can read
int{} public = 0;                // labeled: anyone can read

public = secret;                 // COMPILE ERROR: illegal flow
                                 // (high-security data to low-security variable)

shared = secret;                 // OK: Alice-owned data to Alice-owned+Bob-readable
// The lattice ensures: label(target) ⊒ label(source)
```

The lattice model defines a partial order on security labels. Data can flow "up" the
lattice (from low to high security) but not "down" (from high to low). The compiler
verifies that all data flows respect the lattice ordering.

Volpano, Smith, and Irvine (1996) proved that a type system enforcing noninterference
(high-security inputs cannot influence low-security outputs) can be formulated as a
standard type system. This established that information flow tracking is a type-theoretic
problem.

### Relationship to `identity`/`mutator`/`links`

The analogy is not about security but about **tracking how state changes flow** through a
program:

| Aspect | Information Flow Types | `identity`/`mutator`/`links` |
|--------|----------------------|------------------------------|
| **Labels** | Security levels on values | Identity endpoint symbols on narrowing facts |
| **Flow direction** | Data must not flow down the lattice | Mutation effects must not silently invalidate unlinked endpoints |
| **Explicit declassification** | `declassify` operation to intentionally downgrade | `links` clause to explicitly declare which endpoints a mutator affects |
| **Implicit flows** | Control flow can leak information (if secret then public = 1) | Control flow can interleave mutations (callback, async) |
| **Tracking granularity** | Per-variable, per-expression | Per-endpoint symbol, per-flow node |

The `links` clause is structurally similar to declassification: it's an explicit
declaration that a particular operation affects a particular data channel, overriding the
default conservative assumption.

### What TypeScript Could Learn

- **Explicit channel declarations provide precision.** Information flow types show that
  labeling data channels enables precise tracking without whole-program analysis. `links`
  applies this insight to mutation tracking — by declaring which endpoints a mutator
  affects, the checker avoids invalidating unrelated endpoints.
- **Implicit flows require conservative handling.** Information flow research proved that
  control-dependent data flows (implicit flows) are as dangerous as direct data flows.
  The identity system's uncertainty boundary invalidation (at callbacks, `await`, unknown
  calls) addresses the same concern: control flow structures can create mutation paths
  that aren't syntactically visible.
- **Lattice models map to invalidation hierarchies.** A mutator that `links` to all
  endpoints is like a top-of-lattice write — it invalidates everything. A mutator with
  narrow `links` is like a precisely labeled write. The lattice structure ensures safe
  composition.

### Why Full Information Flow Types Are Too Heavy

- **Pervasive label annotations.** Jif requires security labels on every variable, field,
  method parameter, and return type. TypeScript cannot add a second annotation dimension
  to its already-complex type syntax.
- **Label polymorphism.** Practical information flow typing requires label polymorphism
  (functions parameterized over security levels), which adds another dimension of type
  parameters to every generic function.
- **Implicit flow analysis.** Tracking implicit flows (information leaks through control
  flow) requires analyzing all conditional branches for their information content. This is
  computationally expensive and produces many false positives in practice.

---

## 9. Capabilities and the Object-Capability Model — Miller's Ocap Model

### Core Idea

The object-capability model (Miller, 2006; Dennis & Van Horn, 1966) provides fine-grained
authority control: an object can only perform operations for which it holds
**capabilities** — unforgeable references to resources. Authority is delegated by passing
capability references, and can be attenuated (reduced) but not amplified:

```javascript
// E language (Mark Miller's capability-secure language):
// A file-reading capability
def makeFileReader(path) {
  def reader {
    to read() { return readFile(path) }
    // No write method — this capability cannot write
  }
  return reader
}

// Attenuation: wrapping to reduce authority
def makeLoggingReader(reader) {
  def loggingReader {
    to read() {
      log("reading file")
      return reader.read()   // delegates to original capability
    }
  }
  return loggingReader
}
```

In the ocap model, if you don't have a reference to an object, you can't affect it. There
are no ambient authorities (no global mutable state, no ambient file system access). This
principle is called **the principle of least authority (POLA)**.

Wyvern (Melicher et al., 2017) extended capability safety to a modern language with
modules and effects. Google's Caja project applied ocap principles to sandboxing
JavaScript.

### Relationship to `identity`/`mutator`/`links`

| Aspect | Object-Capability Model | `identity`/`mutator`/`links` |
|--------|------------------------|------------------------------|
| **Authority** | Holding a capability reference | Being declared as a `mutator` for an endpoint |
| **Delegation** | Passing capability to another object | `links` clause declares which endpoints a mutator can affect |
| **Attenuation** | Wrapping to reduce authority | A mutator with narrow `links` has less invalidation authority than one with broad `links` |
| **No ambient authority** | No global mutable state | Conservative invalidation at unknown calls (assume ambient mutation) |
| **Reference = authority** | If you hold it, you can use it | If a function has a path to a receiver, it might mutate it |

The `links` clause is an **authority declaration**: it says "this mutator has the authority
to invalidate these specific identity endpoints." Without `links`, the checker must
conservatively assume the mutator has authority over all endpoints on the receiver — the
equivalent of ambient authority.

### What TypeScript Could Learn

- **Least authority as a design principle.** The ocap model's POLA maps directly to narrow
  `links` declarations: mutators should declare the minimum set of endpoints they affect.
  This enables the checker to preserve narrowing on unlinked endpoints.
- **Capability attenuation for wrappers.** When a mutator is wrapped (e.g., debounced,
  throttled), its mutation authority should propagate through the wrapper. The identity
  system's Tier 2 heuristics for receiver-preserving helpers address this — recognizing
  that wrappers forward authority without amplifying it.
- **Unforgeable references prevent confused deputy attacks.** In capability systems, you
  can't trick a function into using capabilities it shouldn't. Similarly, `links` prevents
  a mutator from being incorrectly associated with endpoints it doesn't affect — the
  linkage is explicit rather than inferred.

### Why Full Ocap Is Too Heavy

- **JavaScript's ambient authority.** JavaScript has pervasive ambient authority — global
  variables, mutable prototypes, `eval`, `Proxy`, and dynamic property access. An ocap
  discipline requires removing all ambient authority, which is fundamentally incompatible
  with JavaScript's execution model.
- **No runtime enforcement.** Capability safety requires runtime guarantees (unforgeable
  references, no ambient access). TypeScript is a compile-time type checker with no
  runtime component.
- **Ecosystem friction.** Capability-safe programming requires restructuring all code to
  pass capabilities explicitly. This is antithetical to JavaScript's module system, global
  `window`/`globalThis`, and DOM API design.

---

## 10. Session Types — Honda, Vasconcelos, Kubo

### Core Idea

Session types (Honda, 1993; Honda, Vasconcelos, & Kubo, 1998) provide type-level
specifications of communication protocols. A session type describes the sequence of
messages that two parties exchange, ensuring protocol compliance at compile time:

```
// Session type for a simple calculator protocol
CalcServer = ?Add(Int, Int).!Result(Int).CalcServer   // receive Add, send Result, loop
           + ?Quit.end                                 // receive Quit, end session

CalcClient = !Add(Int, Int).?Result(Int).CalcClient   // send Add, receive Result, loop
           + !Quit.end                                 // send Quit, end session
```

The `!` prefix means "send," `?` means "receive," and `.` is sequencing. The types of
client and server are **dual** — every send matches a receive and vice versa.

Multiparty session types (Honda, Yoshida, & Carbone, 2008) generalize binary sessions
to protocols involving multiple participants. Scribble (Yoshida et al., 2013) is a
practical protocol description language based on multiparty session types.

Session types have been applied to practical languages: GV for functional languages
(Gay & Vasconcelos, 2010; Lindley & Morris, 2015), and various embeddings in Haskell,
OCaml, Scala, and Java.

### Relationship to `identity`/`mutator`/`links`

| Aspect | Session Types | `identity`/`mutator`/`links` |
|--------|--------------|------------------------------|
| **Protocol** | Typed sequence of send/receive operations | Typed sequence of read/write operations on endpoints |
| **State transitions** | Each operation moves to next protocol state | `mutator` moves narrowing state (invalidation or refinement) |
| **Duality** | Client and server types are dual | `identity` (read) and `mutator` (write) are dual operations |
| **Linearity** | Session channels used exactly once per step | Narrowing facts used between writes, invalidated at writes |
| **Sequencing** | Protocol specifies operation order | CFA flow graph determines operation order |
| **Branching** | Choice types (`+`) for protocol branching | Conditional narrowing for type-dependent branching |

The read-check-use pattern that `identity` enables is a simple two-step session:

```
// As a session type:
ReadSession = !Read.?Value(T | undefined).
              (case Value of
                T         => !Use(T).end
                undefined => end)
```

### What TypeScript Could Learn

- **Protocol compliance as type safety.** Session types prove that sequencing constraints
  can be verified statically. The `identity`/`mutator` system verifies a simple sequencing
  constraint: reads establish facts, writes invalidate facts, and using invalidated facts
  is an error.
- **Duality captures the read/write relationship.** The session type notion of duality —
  where each send has a matching receive — is a clean way to think about `identity` and
  `mutator` as dual faces of the same state interface.
- **Branching on received values.** Session types with dependent types can branch on the
  value received. This parallels narrowing after an `identity` read — the "received"
  type determines which branch is taken.

### Why Full Session Types Are Too Heavy

- **Linear channel usage.** Session types require linear usage of communication channels —
  each channel is used exactly once per protocol step. JavaScript's object references are
  freely shared and reused, making linearity enforcement impractical.
- **Protocol specification burden.** Every interaction requires a protocol specification.
  TypeScript APIs are not designed as protocols — they're collections of independently
  callable methods. Imposing protocol sequencing on every API would require a fundamental
  redesign.
- **Concurrency model mismatch.** Session types are designed for concurrent processes
  communicating through channels. JavaScript is single-threaded with an event loop. While
  async/await introduces concurrency-like patterns, JavaScript's concurrency model is
  fundamentally different from the process calculi that session types are defined over.
- **No duality checking.** Session types verify protocol compliance by checking that the
  client's session type is dual to the server's. TypeScript has no notion of duality —
  interface implementers are checked for structural subtyping, not protocol complement.

---

## Synthesis: Where `identity`/`mutator`/`links` Sits in the Design Space

### The Core Tradeoff

Every academic system reviewed above provides **stronger guarantees** than
`identity`/`mutator`/`links`, but demands **higher costs** along one or more axes:

| System | Guarantee Strength | Annotation Burden | Ecosystem Compatibility | Type Algebra Complexity |
|--------|--------------------|-------------------|------------------------|------------------------|
| Uniqueness/Ownership | Very High | Very High | Very Low (aliasing model) | High |
| Region Types | High | High | Low (no GC analog) | High |
| Fractional Permissions | Very High | Very High | Very Low | Very High |
| Typestate | High | High | Low (aliasing) | High |
| Gradual Typing | Medium | Low (incremental) | High | Medium |
| Occurrence Typing | Medium | Low (predicates) | High (already in TS) | Medium |
| Dependent Types | Very High | Very High | Very Low | Very High |
| Information Flow | High | High | Low (labels) | High |
| Capabilities | High | High | Very Low (ambient auth.) | Medium |
| Session Types | High | High | Low (linearity) | High |
| **identity/mutator/links** | **Medium** | **Low** | **High** | **Low** |

### Design Principles Extracted

1. **Read/write separation is universal.** Every system distinguishes observation from
   mutation. `identity`/`mutator` captures this at the minimum viable level.

2. **Scope-bounded validity is universal.** Every system limits how far a type fact
   extends — regions, lifetimes, linear usage, session steps. Identity CFA uses flow
   regions.

3. **Selective invalidation requires explicit declaration.** Ownership has lifetimes,
   Koka has heap regions, information flow has labels, capabilities have references.
   `links` serves this role.

4. **Gradual adoption is essential.** Only gradual typing and occurrence typing have
   achieved mainstream adoption. Both prioritize incremental, low-annotation-burden
   integration. `identity`/`mutator`/`links` follows this path.

5. **Unsoundness is acceptable for practical utility.** TypeScript's type system is
   already intentionally unsound (bivariant function parameters, `any` type, assertion
   functions). The identity system's declarative trust model fits TypeScript's philosophy
   of providing useful checking rather than proof-level guarantees.

### The Pragmatic Sweet Spot

The `identity`/`mutator`/`links` system can be understood as extracting the
**minimum viable mechanism** from each academic tradition:

- From **uniqueness types**: the insight that unaliased observation is safe for narrowing.
- From **region types**: scope-bounded validity of narrowing facts.
- From **fractional permissions**: the read/write distinction as a first-class API concept.
- From **typestate**: post-call type transitions via constrained overloads.
- From **gradual typing**: incremental adoption with tiered precision.
- From **occurrence typing**: flow-sensitive narrowing (already in TypeScript's CFA).
- From **dependent types**: simplified pre/post conditions via constrained generics.
- From **information flow**: selective invalidation via explicit channel declarations.
- From **capabilities**: least-authority mutation declarations via narrow `links`.
- From **session types**: sequential read-write protocols as a narrowing discipline.

The result is a system that provides practical narrowing for callable endpoints —
TypeScript's most requested CFA gap — without requiring any of the heavy theoretical
machinery that formal soundness would demand.
