# Design Review: Clojure's Atoms, Refs, Agents, and STM vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Clojure's concurrency primitives, persistent data structures, and gradual typing with TypeScript-Go's identity CFA system

---

## 1. Persistent Data Structures — Structural Sharing and Implicit Identity

### Clojure's Model

Every core data structure in Clojure is immutable and persistent. "Persistent" means
previous versions of a collection remain available after "modification" — updates return
new structures while sharing unchanged subtrees with the original:

```clojure
(def person {:name "Alice" :age 30})
(def older (assoc person :age 31))

;; person is still {:name "Alice" :age 30}
;; older is {:name "Alice" :age 31}
;; :name key shares the same string object — structural sharing
```

Vectors, maps, sets, and lists all share this property:

```clojure
(def v [1 2 3 4 5])
(def v2 (conj v 6))

;; v is unchanged — [1 2 3 4 5]
;; v2 is [1 2 3 4 5 6]
;; internally, v2 shares tree nodes with v (HAMTs / RRB trees)
```

Because data is immutable, every binding is an implicit `identity` — reading a value
twice always produces the same result:

```clojure
(let [x (:name person)]
  ;; x is "Alice" now
  ;; x is "Alice" later — guaranteed, no invalidation possible
  (str x " is " (:age person) " years old"))
```

### How This Compares to `identity`

| Aspect | Clojure Persistent DS | TypeScript-Go `identity` |
|--------|----------------------|--------------------------|
| Stability | Universal — all values are immutable | Opt-in — only `identity`-annotated callables |
| Invalidation | Impossible — no mutation exists | Required — `mutator` marks invalidation points |
| Structural sharing | Automatic, internal optimization | N/A — JavaScript objects are mutable in place |
| Aliasing safety | Complete — aliases can never diverge | Partial — aliases may observe mutation |
| CFA impact | Every read is trivially stable | CFA must track flow nodes and `mutator` calls |

### Key Insight: Identity by Elimination

Clojure achieves universal identity stability by eliminating mutation from collections
entirely. TypeScript-Go cannot do this (JavaScript objects are mutable), so `identity`
provides an opt-in mechanism to declare the same guarantee on specific endpoints.
The tradeoff is precision: Clojure's guarantee is total but inflexible; TypeScript-Go's
is selective but requires explicit annotation.

---

## 2. Atoms — The Signal Pattern Avant La Lettre

### Clojure's Model

Atoms are Clojure's simplest mutable reference type. They hold a single immutable value
and provide atomic read/update operations:

```clojure
(def counter (atom 0))

;; Read — deref (or @) retrieves the current value
(deref counter)   ;; => 0
@counter          ;; => 0 (shorthand)

;; Write — swap! applies a function atomically
(swap! counter inc)   ;; => 1
(swap! counter + 10)  ;; => 11

;; Replace — reset! sets a new value directly
(reset! counter 0)    ;; => 0
```

The critical property: `deref` always returns a consistent snapshot. Between a `deref`
and the next `swap!`/`reset!`, the value cannot change from the perspective of the
current thread of execution.

### Atoms as a Signal Primitive

Clojure atoms predated JavaScript signals by over a decade, but the pattern is
structurally identical:

```clojure
;; Clojure atom
(def name (atom "Alice"))
@name                          ;; read — deref
(reset! name "Bob")            ;; write — reset!
(swap! name clojure.string/upper-case)  ;; update — swap!

;; Compare: hypothetical TypeScript signal
const name = signal("Alice");
name();                        // read — call
name.set("Bob");               // write — set
name.update(s => s.toUpperCase()); // update — update
```

### Mapping to `identity`/`mutator`

| Atom Operation | TypeScript-Go Equivalent | Role |
|---------------|--------------------------|------|
| `deref` / `@` | `identity` callable | Stable read endpoint — CFA can narrow |
| `swap!` | `mutator` method | Transforms current value — invalidates narrowing |
| `reset!` | `mutator` method | Replaces value entirely — invalidates narrowing |
| `compare-and-set!` | `mutator` method | Conditional write — invalidates on success |

A typed atom in TypeScript-Go's system:

```typescript
interface Atom<T> {
  identity deref(): T;
  mutator swap(f: (current: T) => T): T links deref;
  mutator reset(newVal: T): T links deref;
}

declare const counter: Atom<string | number>;

if (typeof counter.deref() === "string") {
  // narrowed: counter.deref() is string
  counter.deref().toUpperCase();  // OK
  
  counter.swap(v => Number(v));   // mutator — invalidates deref
  counter.deref().toUpperCase();  // ERROR — must re-narrow
}
```

### Key Insight: Read/Write Symmetry

Clojure atoms enforce a clean separation between reading (`deref`) and writing
(`swap!`/`reset!`). The naming convention makes the read/write boundary explicit:
- Names without `!` are pure reads or pure transformations
- Names with `!` indicate side effects (mutation)

This convention is a weaker form of `identity`/`mutator` — it's a naming convention
rather than a type-system-enforced contract. TypeScript-Go's modifiers make this
distinction checkable by the compiler rather than relying on programmer discipline.

---

## 3. Refs and STM — Coordinated Mutation as Structured `links`

### Clojure's Model

Refs are mutable references that participate in Software Transactional Memory (STM).
Multiple refs can be updated atomically within a `dosync` transaction:

```clojure
(def balance-a (ref 1000))
(def balance-b (ref 2000))

;; Transfer $100 from A to B — atomic, consistent
(dosync
  (alter balance-a - 100)
  (alter balance-b + 100))
;; Either both changes happen, or neither does
```

STM guarantees:
1. **Atomicity** — all ref updates in a `dosync` commit together or retry
2. **Consistency** — validators on refs are checked before commit
3. **Isolation** — concurrent transactions see consistent snapshots
4. **No locks** — the runtime handles conflict detection and retry

### Multi-Ref Coordination as `links`

STM transactions express the same concept as `links` — coordinated mutation across
multiple state endpoints:

```clojure
;; Clojure: transaction coordinates balance-a and balance-b
(dosync
  (alter balance-a - amount)
  (alter balance-b + amount))
```

```typescript
// TypeScript-Go: links clause coordinates related identity endpoints
interface BankAccount {
  identity balanceA(): number;
  identity balanceB(): number;
  mutator transfer(amount: number): void links balanceA, balanceB;
}
```

The `links` clause is a static declaration of what STM discovers dynamically at runtime:
which state endpoints are affected by a given mutation operation.

### Comparison Table

| Aspect | Clojure STM | TypeScript-Go `links` |
|--------|------------|----------------------|
| Coordination | Runtime — `dosync` discovers ref accesses | Static — `links` declared at definition |
| Scope | Any refs touched in transaction | Explicitly listed identity endpoints |
| Granularity | Per-ref | Per-identity-callable |
| Failure mode | Automatic retry on conflict | Compile-time type error on missing narrowing |
| Invalidation | Transaction boundary | `mutator` call site |
| Partial invalidation | N/A — all-or-nothing commit | Supported — `links` targets specific endpoints |

### Key Insight: Static vs Dynamic Coordination Graphs

Clojure's STM builds the coordination graph dynamically — the runtime discovers which
refs are touched during a transaction. TypeScript-Go's `links` requires the programmer
to declare the graph statically. This is less flexible but enables compile-time
verification: the checker can prove that a `mutator` call invalidates exactly the
endpoints listed in `links`, no more, no less.

The STM model suggests an interesting extension: could `links` support transactional
semantics where multiple `mutator` calls in a block are treated as a single invalidation
event? This isn't currently in scope, but the conceptual parallel is strong.

---

## 4. Agents — Asynchronous Mutation and Async Boundaries

### Clojure's Model

Agents are like atoms but with asynchronous updates. `send` dispatches an update function
that runs on a thread pool; the caller doesn't wait for it:

```clojure
(def log-entries (agent []))

;; Send an update — returns immediately, runs asynchronously
(send log-entries conj "entry 1")
(send log-entries conj "entry 2")

;; Reads always return the last committed value
@log-entries   ;; might be [], ["entry 1"], or ["entry 1" "entry 2"]

;; Wait for all pending sends to complete
(await log-entries)
@log-entries   ;; => ["entry 1" "entry 2"]
```

Agents guarantee:
- Actions are serialized per-agent (no concurrent updates to the same agent)
- Reads always return a consistent value (the last committed state)
- Errors are captured and can be inspected via `agent-error`

### Comparison to Async Boundaries in Identity CFA

TypeScript-Go's identity CFA must handle async boundaries — points where the control
flow cannot guarantee that no mutation occurs between `await` points:

```typescript
interface Service {
  identity status(): "active" | "inactive" | "error";
  mutator shutdown(): void links status;
}

async function checkService(svc: Service) {
  if (svc.status() === "active") {
    // narrowed: status is "active"
    
    await someAsyncOperation();  // async boundary — identity narrowing invalidated
    
    // status could have changed during the await
    svc.status();  // must re-narrow — type is "active" | "inactive" | "error"
  }
}
```

| Aspect | Clojure Agents | TypeScript-Go Async + Identity |
|--------|---------------|-------------------------------|
| Mutation timing | Asynchronous, serialized per-agent | Synchronous within `await` boundaries |
| Read consistency | Last committed value | Last narrowed type until invalidation |
| Boundary | `send` returns immediately, value updates later | `await` creates uncertainty boundary |
| Synchronization | `await` (Clojure) waits for pending sends | Re-narrowing after `await` point |
| Error handling | `agent-error` captures async failures | Promise rejection / try-catch |

### Key Insight: Asynchronous Invalidation Windows

Clojure agents make the asynchronous mutation window explicit — after `send`, you know
the value may change at any time until you `await` the agent. TypeScript-Go's async
boundaries create the same window implicitly — after an `await`, any `identity`
narrowing must be considered stale because arbitrary code may have run.

The agent model suggests a useful mental model for identity CFA: every `await` point
is implicitly a `send` to every reachable agent — you don't know what mutations may
have been queued and processed during the suspension.

---

## 5. Watches and Validators — Reactive Subscriptions

### Clojure's Model

Atoms, refs, and agents all support **watches** — callbacks invoked when the value changes:

```clojure
(def counter (atom 0))

;; Add a watch — called with key, ref, old-value, new-value
(add-watch counter :logger
  (fn [key ref old new]
    (println "counter changed from" old "to" new)))

(swap! counter inc)
;; prints: counter changed from 0 to 1

(remove-watch counter :logger)
```

**Validators** constrain what values a reference can hold:

```clojure
(def age (atom 25 :validator #(and (integer? %) (>= % 0))))

(reset! age 30)   ;; OK
(reset! age -1)   ;; throws IllegalStateException — validator failed
(reset! age "x")  ;; throws IllegalStateException — validator failed
```

### Watches as Reactive Subscriptions

Clojure watches are structurally identical to signal subscriptions in reactive frameworks:

```clojure
;; Clojure watch
(add-watch counter :effect
  (fn [_ _ old new]
    (when (not= old new)
      (update-ui! new))))
```

```typescript
// TypeScript signal effect
effect(() => {
  const value = counter();  // identity read — tracks dependency
  updateUI(value);          // re-runs when counter changes
});
```

The key difference: Clojure watches are explicitly registered with `add-watch`, while
signal effects implicitly track dependencies through `identity` reads during execution.

### Validators as Type-Level Constraints

Clojure validators enforce runtime invariants on mutable state. In TypeScript-Go's system,
these constraints are expressed at the type level:

```clojure
;; Clojure: runtime validator
(def status (atom :active :validator #{:active :inactive :error}))
```

```typescript
// TypeScript-Go: type-level constraint + identity narrowing
interface StatusHolder {
  identity status(): "active" | "inactive" | "error";
  mutator setStatus(s: "active" | "inactive" | "error"): void links status;
}
```

| Aspect | Clojure Watches/Validators | TypeScript-Go Identity CFA |
|--------|---------------------------|---------------------------|
| Change notification | `add-watch` callback | Signal effect auto-tracking |
| Value constraints | Runtime validator function | Compile-time type narrowing |
| Enforcement timing | Runtime (throws on violation) | Compile-time (type error) |
| Granularity | Per-reference | Per-identity-endpoint |
| Composability | Manual watch management | CFA tracks through control flow |

### Key Insight: Push vs Pull Reactivity

Clojure watches are **push-based** — the reference notifies watchers when it changes.
TypeScript-Go's identity CFA is **pull-based** — the checker tracks narrowings through
control flow and invalidates them at `mutator` call sites. This makes identity CFA
more suitable for static analysis (no runtime overhead) but less suitable for reactive
UI patterns (which need runtime push notifications).

The ideal TypeScript system combines both: `identity`/`mutator` for compile-time
narrowing safety, and signal libraries for runtime reactivity. The modifiers serve the
type checker; watches serve the runtime.

---

## 6. `spec` and `spec2` — Runtime/Compile-Time Validation

### Clojure spec's Model

`clojure.spec` provides a system for describing the shape and constraints of data,
independent of the type system:

```clojure
(require '[clojure.spec.alpha :as s])

;; Define specs for data shapes
(s/def ::name string?)
(s/def ::age (s/and int? #(>= % 0)))
(s/def ::role #{:admin :viewer :editor})

(s/def ::person
  (s/keys :req [::name ::age]
          :opt [::role]))

;; Validate at runtime
(s/valid? ::person {::name "Alice" ::age 30})           ;; true
(s/valid? ::person {::name "Alice" ::age -1})           ;; false
(s/valid? ::person {::name "Alice"})                    ;; false — missing ::age

;; Generate test data from specs
(gen/generate (s/gen ::person))
;; => {::name "f8kQ" ::age 42 ::role :editor}
```

### Function Specs

Specs can describe function contracts — preconditions, postconditions, and the
relationship between inputs and outputs:

```clojure
(s/fdef transfer
  :args (s/cat :from ::account :to ::account :amount pos-int?)
  :ret  ::transfer-result
  :fn   (fn [{:keys [args ret]}]
          ;; postcondition: total balance unchanged
          (= (+ (:balance (:from args)) (:balance (:to args)))
             (+ (:from-balance ret) (:to-balance ret)))))
```

### Could Specs Express Stability Contracts?

The spec model suggests a declarative way to describe identity/mutator relationships:

```clojure
;; Hypothetical: spec for stability contract
(s/def ::signal-contract
  (s/keys :req [::identity-endpoints ::mutators]))

(s/fdef increment
  :args (s/cat :counter ::counter)
  :ret  ::counter
  :identity-links [::counter/value]    ;; this mutator invalidates value
  :stability :mutator)                 ;; marks this as a mutator
```

In TypeScript-Go, `identity`/`mutator`/`links` serve the same purpose but are integrated
into the type system rather than being a separate spec layer:

| Aspect | Clojure spec | TypeScript-Go modifiers |
|--------|-------------|------------------------|
| Stability declaration | Hypothetical extension to spec | `identity` modifier |
| Mutation marking | Hypothetical `:stability :mutator` | `mutator` modifier |
| Link declaration | Hypothetical `:identity-links` | `links` clause |
| Enforcement | Runtime instrumentation | Compile-time CFA |
| Generative testing | `spec.gen` produces test data | N/A |
| Documentation | Specs self-document contracts | Modifiers are in the signature |

### Key Insight: Declarative Contracts

Spec's strength is that contracts are declarative, composable, and inspectable — you can
ask "what does this function's contract say?" at runtime. TypeScript-Go's modifiers embed
the same information in the type system, making it available to the compiler but not
dynamically queryable. The spec approach would support tooling like "show me all mutators
that link to this identity" — which is valuable for IDE features.

`spec2` (Rich Hickey's successor to spec, still in alpha) adds schema-based validation
and closer integration with function signatures. Its direction aligns with TypeScript-Go's
approach: move contract information closer to the declaration site rather than keeping it
in a separate layer.

---

## 7. `core.typed` — Optional Typing and Narrowing

### Clojure core.typed's Model

`core.typed` (by Ambrose Bonnaire-Sergeant) adds optional gradual typing to Clojure.
It supports occurrence typing — a form of type narrowing based on predicates:

```clojure
(require '[clojure.core.typed :as t])

(t/ann process-value [(t/U t/Str t/Int) -> t/Str])
(defn process-value [x]
  (if (string? x)
    ;; narrowed: x is Str here
    (clojure.string/upper-case x)
    ;; narrowed: x is Int here
    (str x)))
```

### Occurrence Typing

`core.typed`'s occurrence typing tracks type narrowing through conditionals, much like
TypeScript's CFA:

```clojure
(t/ann maybe-name [(t/Option t/Str) -> t/Str])
(defn maybe-name [x]
  (if (nil? x)
    "unknown"
    ;; x is narrowed to Str (nil removed from union)
    x))
```

However, `core.typed` operates on immutable data. There is no mutation to invalidate,
so narrowings never become stale:

```clojure
;; No invalidation concern — x cannot change between the check and the use
(defn safe-process [x]
  (if (string? x)
    (do
      ;; any operations here — x is still String
      ;; no mutation can occur to x
      (clojure.string/upper-case x))
    "not a string"))
```

### How core.typed Handles Mutable References

For atoms (the main mutable reference in typical Clojure code), `core.typed` uses a
special `Atom1` type that tracks the contained value's type:

```clojure
(t/ann counter (t/Atom1 t/Int))
(def counter (atom 0))

;; deref produces Int
(t/ann-form @counter t/Int)

;; swap! requires the function to maintain the type
(swap! counter inc)    ;; OK: inc :: Int -> Int
(swap! counter str)    ;; ERROR: str :: Int -> Str, but atom holds Int
```

`core.typed` does **not** support narrowing on atom values — because `deref` may return
a different value on each call, the type system treats each `deref` independently:

```clojure
(t/ann status (t/Atom1 (t/U ':active ':inactive ':error)))
(def status (atom :active))

;; Each deref is independent — no caching of narrowed type
(if (= @status :active)
  ;; core.typed CANNOT narrow @status here
  ;; because another thread might swap! between the check and the use
  ...)
```

### Comparison with TypeScript-Go Identity CFA

| Aspect | core.typed | TypeScript-Go Identity CFA |
|--------|-----------|---------------------------|
| Narrowing | Occurrence typing on immutable values | CFA on `identity` callables |
| Mutable refs | No narrowing on `deref` results | Narrowing with `mutator` invalidation |
| Thread safety | Assumes concurrent mutation possible | Single-threaded — narrowing is safe within flow |
| Invalidation | N/A for immutable data; overly conservative for atoms | Explicit via `mutator` + `links` |
| Gradual adoption | Optional annotations, coexists with untyped code | Optional modifiers, coexists with unmodified code |

### Key Insight: Single-Threaded Advantage

TypeScript-Go operates in a single-threaded environment (the JavaScript event loop),
which makes identity narrowing much more tractable than in Clojure's multi-threaded
model. `core.typed` cannot narrow atom reads because another thread might mutate between
the check and the use. TypeScript-Go can narrow `identity` reads because no concurrent
mutation is possible between sequential statements — only explicit `mutator` calls or
`await` boundaries can invalidate.

This is a fundamental advantage of the single-threaded model: narrowing is safe by
default, and invalidation must be explicitly declared. In a multi-threaded model like
Clojure's, narrowing mutable state is unsafe by default, and safety requires
synchronization primitives.

---

## 8. Alternative Syntax Ideas — Clojure Naming Conventions

### Clojure's `!` Convention

Clojure uses a bang (`!`) suffix to mark functions with side effects:

```clojure
;; Pure — no side effects
(assoc person :age 31)           ;; returns new map
(conj items new-item)            ;; returns new collection
(update counter inc)             ;; returns new value

;; Impure — mutates something (has !)
(swap! counter inc)              ;; mutates atom
(reset! counter 0)               ;; mutates atom
(set! *warn-on-reflection* true) ;; mutates var
(conj! transient-vec item)       ;; mutates transient collection
```

This naming convention communicates mutation intent at every call site without any
type-system support. It's a social contract enforced by convention.

### Could TypeScript Adopt `deref`/`swap!` Semantics?

The atom API could inspire TypeScript naming:

```typescript
// Option A: Clojure-inspired naming
interface Signal<T> {
  deref(): T;                     // stable read
  swap(f: (current: T) => T): T;  // atomic update
  reset(value: T): T;             // direct set
}

// Option B: Current signal convention
interface Signal<T> {
  (): T;              // read via call
  set(value: T): void;
  update(f: (current: T) => T): void;
}
```

### The `!` Convention as `mutator`

The most directly transferable idea is the `!` convention:

```typescript
// Hypothetical: ! suffix as syntactic sugar for mutator
interface Collection<T> {
  identity items(): T[];
  push!(item: T): void;        // ! implies mutator links items
  splice!(start: number, count: number): T[];  // ! implies mutator
  sort!(): void;                // ! implies mutator
  
  // Non-! methods are implicitly identity-safe
  filter(pred: (t: T) => boolean): T[];
  map<U>(f: (t: T) => U): U[];
}
```

This is impractical for TypeScript — `!` is already the non-null assertion operator and
the definite assignment assertion. But the principle translates: mutation-indicating names
help developers reason about invalidation even without type checker support.

### Clojure-Inspired `deref` as Identity Pattern

A more practical adaptation:

```typescript
// Pattern: methods named 'deref' or 'get' are identity candidates
// Pattern: methods with '!' in documentation or ending in 'Set'/'Update' are mutators

class ReactiveMap<K, V> {
  identity get(key: K): V | undefined;
  identity entries(): IterableIterator<[K, V]>;
  identity size(): number;

  mutator set(key: K, value: V): this links get, entries, size;
  mutator delete(key: K): boolean links get, entries, size;
  mutator clear(): void links get, entries, size;
}
```

### Comparison of Naming Approaches

| Convention | Mechanism | Enforcement | TypeScript-Go Analog |
|-----------|-----------|-------------|---------------------|
| Clojure `!` suffix | Naming convention | Social/review | `mutator` modifier |
| Clojure `deref` | Explicit read API | API design | `identity` modifier |
| Rust `&mut` | Type system | Compiler | `mutator` modifier |
| Haskell `IO`/`ST` | Monadic effects | Type system | `mutator` at call sites |
| TypeScript-Go | Modifiers | CFA checker | `identity`/`mutator`/`links` |

### Key Insight: Convention vs Enforcement

Clojure's `!` convention demonstrates that even informal mutation markers are valuable —
they help developers reason about which operations invalidate assumptions. TypeScript-Go's
`identity`/`mutator` system formalizes this intuition into compiler-enforced contracts.

The Clojure community proves that a clean read/write separation (pure functions vs `!`
functions, `deref` vs `swap!`) can scale across an ecosystem when the convention is
strong enough. TypeScript-Go's modifiers aim to provide the same clarity with stronger
guarantees — the compiler catches what code review might miss.

---

## Summary: Lessons from Clojure

| Lesson | Clojure Approach | TypeScript-Go Approach |
|--------|-----------------|----------------------|
| Mutation tracking | Eliminated via persistent data | Explicit via `mutator` modifier |
| Stable reads | Universal (`deref` on immutable data) | Opt-in via `identity` modifier |
| Coordinated mutation | STM transactions (`dosync`) | `links` clause |
| Async mutation | Agents (`send`/`await`) | `await` boundary invalidation |
| Change notification | Watches (`add-watch`) | Signal effects (runtime layer) |
| Value constraints | Validators + spec | Type system narrowing |
| Naming convention | `!` for mutation | `mutator` keyword |
| Optional typing | core.typed (occurrence typing) | Identity CFA (flow-sensitive typing) |

### Core Takeaway

Clojure's reference types (atoms, refs, agents) form a hierarchy of mutation primitives
with increasing coordination complexity. TypeScript-Go's `identity`/`mutator`/`links`
system maps cleanly onto this hierarchy:

- **Atoms ↔ single identity/mutator** — Simple read/write on a single state endpoint.
  `deref` is `identity`, `swap!`/`reset!` are `mutator`.

- **Refs + STM ↔ links** — Coordinated mutation across multiple endpoints. `dosync`
  coordinates multiple refs; `links` declares which identity endpoints a mutator
  invalidates.

- **Agents ↔ async boundaries** — Asynchronous mutation where the effect is not
  immediately visible. `send` dispatches a future mutation; `await` creates an
  uncertainty window where narrowings must be invalidated.

The deepest lesson from Clojure is that **separating identity (value) from state
(reference)** is the fundamental abstraction. Clojure does this at the language level
with persistent data structures and explicit reference types. TypeScript-Go does this
at the type system level with `identity` (value-like read stability) and `mutator`
(state-like write invalidation). Different mechanisms, same core insight: knowing
*what can change* and *when it can change* is the foundation of safe narrowing.

Clojure's single-threaded advantage in TypeScript-Go's context is worth emphasizing:
`core.typed` cannot narrow atom reads because concurrent mutation is possible.
TypeScript-Go's identity CFA *can* narrow because JavaScript is single-threaded —
only explicit `mutator` calls and `await` boundaries can invalidate. This makes the
identity system both simpler and more powerful than what is achievable in Clojure's
multi-threaded environment.