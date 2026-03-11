# Design Review: Elixir/Erlang — Immutability, GenServer, and Process Model

## Overview

Elixir (built on Erlang's BEAM VM) takes a radically different approach to mutation:
**all data is immutable by default**, and mutation is confined to isolated processes
communicating via message passing. This eliminates entire categories of aliasing and
invalidation problems that TypeScript-Go's `identity`/`mutator`/`links` system must
address explicitly.

---

## 1. Immutable Data — Sidestepping Mutation Tracking

### Elixir's Model

In Elixir, every value is immutable. "Updating" a map returns a new map:

```elixir
person = %{name: "Alice", age: 30}
older = %{person | age: 31}
# person is unchanged — still %{name: "Alice", age: 30}
```

There is no concept of mutating `person` in place. Variables can be rebound (shadowed),
but the underlying data structures are never modified:

```elixir
list = [1, 2, 3]
list = [0 | list]   # rebinding, not mutation — old list still exists if referenced
```

### How This Sidesteps Mutation Tracking

TypeScript-Go's `identity`/`mutator` system exists because:

1. Objects are mutable and aliased
2. A function call may or may not modify an object
3. The type system must track which narrowings are invalidated

In Elixir, **none of these problems exist**:

| Problem                         | TypeScript-Go               | Elixir                          |
|---------------------------------|-----------------------------|---------------------------------|
| Aliased mutable state           | Common, must track          | Impossible — data is immutable  |
| Function invalidates narrowing  | `mutator` required          | Functions return new values     |
| Selective invalidation          | `links` clause              | Not needed — no invalidation    |
| Stable read endpoints           | `identity` modifier         | Every binding is stable forever |

**Key insight:** Immutability makes every binding an implicit `identity` — the value
cannot change, so any narrowing remains valid indefinitely.

### Structural Sharing

Elixir/Erlang uses structural sharing internally to make immutable updates efficient.
Updating one field in a large map doesn't copy the entire structure — unchanged subtrees
are shared. This is analogous to persistent data structures in Clojure or Haskell.

---

## 2. GenServer — Managed Mutation via Processes

### The GenServer Pattern

GenServer is Elixir's primary abstraction for managed mutable state. A GenServer is a
process that holds state and responds to messages:

```elixir
defmodule Counter do
  use GenServer

  # Client API
  def start_link(initial), do: GenServer.start_link(__MODULE__, initial)
  def increment(pid), do: GenServer.call(pid, :increment)
  def get(pid), do: GenServer.call(pid, :get)

  # Server callbacks
  @impl true
  def init(initial), do: {:ok, initial}

  @impl true
  def handle_call(:increment, _from, state) do
    {:reply, state + 1, state + 1}
  end

  @impl true
  def handle_call(:get, _from, state) do
    {:reply, state, state}
  end
end
```

### Comparison to identity/mutator

| Concept              | GenServer                          | TypeScript-Go                     |
|----------------------|------------------------------------|-----------------------------------|
| State container      | Process (isolated, single-owner)   | Object (shared, aliased)          |
| Read operation       | `handle_call` returning state      | `identity` property/method        |
| Write operation      | `handle_call`/`handle_cast`        | `mutator` method                  |
| Invalidation scope   | N/A — state transitions are atomic | `links` clause                    |
| Concurrency safety   | Mailbox serialization              | Not addressed (single-threaded)   |

### Key Differences

**GenServer mutations are atomic and isolated.** When `handle_call` returns a new state,
the transition is complete — no external observer sees an intermediate state. There is no
aliasing problem because only the GenServer process can access its own state.

**TypeScript-Go must track invalidation across shared references.** Because multiple
variables can alias the same object, calling a `mutator` on one alias must invalidate
narrowings on all linked aliases. GenServer avoids this by making state private to a
single process.

**`handle_cast` (fire-and-forget) vs `handle_call` (synchronous).** This distinction
has no direct analog in TypeScript-Go's system, but it maps loosely to:
- `handle_call` → synchronous mutator with observable side effects
- `handle_cast` → async mutation (Promise-based mutator, if such a concept existed)

---

## 3. Pattern Matching and Narrowing

### Elixir's Pattern Matching

Elixir uses pattern matching pervasively — in function heads, `case`, `cond`, and `with`:

```elixir
defmodule Shape do
  def area(%{type: :circle, radius: r}), do: :math.pi() * r * r
  def area(%{type: :rect, width: w, height: h}), do: w * h
  def area(_), do: {:error, :unknown_shape}
end
```

Pattern matching in function heads acts like discriminated union narrowing in TypeScript:

```typescript
// TypeScript equivalent
function area(shape: Shape): number {
  if (shape.type === "circle") return Math.PI * shape.radius ** 2;
  if (shape.type === "rect") return shape.width * shape.height;
  throw new Error("unknown shape");
}
```

### Exhaustiveness

Elixir does **not** enforce exhaustiveness at compile time (being dynamically typed).
However, Dialyzer can detect some unreachable patterns. TypeScript's exhaustiveness
checking via `never` is strictly more powerful here.

### Narrowing Stability

In Elixir, once a pattern match succeeds, the bound variables are immutable — they
cannot be invalidated by subsequent code. This is the "ultimate identity guarantee":

```elixir
case data do
  %{type: :circle, radius: r} ->
    # r is guaranteed to be the radius forever — no mutator can change it
    compute_area(r)    # r is still valid
    do_something()     # r is still valid
    use_radius(r)      # r is still valid — always
end
```

In TypeScript, the equivalent narrowing can be invalidated:

```typescript
if (shape.type === "circle") {
  const r = shape.radius; // narrowed
  mutate(shape);          // if mutator — narrowing of shape.type invalidated
  shape.radius;           // might not be valid if shape is no longer a circle
}
```

The `identity` modifier exists precisely to restore this Elixir-like stability guarantee
for specific properties.

---

## 4. Typespecs and Dialyzer

### @spec and @type

Elixir's type annotation system is opt-in via attributes:

```elixir
@type shape :: %{type: :circle, radius: number()} | %{type: :rect, width: number(), height: number()}

@spec area(shape()) :: number() | {:error, atom()}
def area(%{type: :circle, radius: r}), do: :math.pi() * r * r
def area(%{type: :rect, width: w, height: h}), do: w * h
```

### Dialyzer's Success Typing

Dialyzer uses **success typing** — the opposite of traditional type checking:
- Traditional (TypeScript): "Prove this is correct, or report an error"
- Success typing (Dialyzer): "Prove this will definitely fail, or stay silent"

This means Dialyzer has **no false positives** but many **false negatives**. It will
only report errors it is certain about.

### Comparison to TypeScript-Go's Approach

| Aspect                | Dialyzer                    | TypeScript-Go               |
|-----------------------|-----------------------------|-----------------------------|
| Philosophy            | Success typing (no FP)      | Sound-ish (some unsoundness)|
| Mutation tracking     | Not needed (immutable)      | identity/mutator/links      |
| Annotation burden     | Optional @spec              | Optional identity/mutator   |
| Narrowing persistence | Guaranteed (immutable)      | Conditional (needs identity)|
| Exhaustiveness        | Partial                     | Full (via `never`)          |
| Adoption              | Gradual, opt-in             | Gradual, opt-in             |

### Elixir's New Type System (Post-1.17)

As of Elixir 1.17+, a **gradual set-theoretic type system** is being introduced
directly into the compiler (not Dialyzer). This system:
- Infers types from pattern matches
- Supports union types natively
- Reports type mismatches as warnings
- Is integrated into the compilation pipeline

This is philosophically closer to TypeScript's approach — bringing type checking into
the compiler rather than keeping it as a separate tool.

---

## 5. Processes and Message Passing — Isolated Mutation

### The Actor Model

Elixir processes are lightweight actors (not OS threads). Each process:
- Has its own isolated heap
- Communicates only via message passing
- Cannot directly access another process's state

```elixir
pid = spawn(fn ->
  receive do
    {:get_state, caller} -> send(caller, {:state, 42})
  end
end)

send(pid, {:get_state, self()})
receive do
  {:state, value} -> IO.puts("Got: #{value}")
end
```

### Isolation as a Mutation Boundary

In the process model, mutation is **isolated by construction**:
- Process A's state changes never affect Process B's narrowings
- Message passing copies data between processes (no shared references)
- Each process is a natural `mutator` boundary

This maps to a hypothetical TypeScript model where:

```typescript
// Hypothetical: process-isolated state
class Counter {
  // Only accessible within this "process" — no external aliasing
  private identity count: number = 0;

  mutator increment(): void {
    this.count++;
  }
}
```

The key difference: Elixir enforces isolation at the runtime level (processes cannot
share memory), while TypeScript-Go must enforce it at the type system level
(`identity`/`mutator` annotations).

### Supervision Trees

Erlang/Elixir's supervision trees provide fault tolerance — if a process crashes, its
supervisor restarts it with fresh state. This is a form of "mutation reset" that has
no analog in TypeScript-Go's system, but it reinforces the principle that managed,
isolated state transitions are safer than ad-hoc mutation.

---

## 6. ETS/DETS — Shared Mutable Tables

### Breaking the Immutability Rule

ETS (Erlang Term Storage) is a notable exception to Elixir's immutability:

```elixir
table = :ets.new(:my_table, [:set, :public])
:ets.insert(table, {"key", "value"})
:ets.lookup(table, "key")  # => [{"key", "value"}]
:ets.delete(table, "key")
```

ETS tables are **mutable, shared, concurrent data structures** — the antithesis of
Elixir's usual immutable model. They exist for performance-critical cases where
message passing overhead is unacceptable.

### ETS Access Patterns

| Access mode  | Description                          | Analog in TS-Go           |
|-------------|--------------------------------------|---------------------------|
| `:private`  | Only owning process can read/write   | Private mutator methods   |
| `:protected`| Owner writes, others read            | identity (read) + mutator (write) |
| `:public`   | Any process can read/write           | Shared mutable state      |

### Relevance to identity/mutator

ETS demonstrates that **even in an immutable-first language, shared mutable state is
sometimes necessary.** When it exists, it needs explicit access control — which is
exactly what `identity`/`mutator` provides for TypeScript.

ETS's `:protected` mode is particularly interesting: it separates read access (available
to all) from write access (restricted to owner). This mirrors the `identity`/`mutator`
split:
- `identity` = any caller can read, guaranteed stable
- `mutator` = restricted operation that changes state

---

## 7. LiveView — Reactive UI with Assigns

### The Assigns Pattern

Phoenix LiveView manages UI state through `assigns` — a map of values that Phoenix
diffs and patches to the client:

```elixir
defmodule CounterLive do
  use Phoenix.LiveView

  def mount(_params, _session, socket) do
    {:ok, assign(socket, count: 0)}
  end

  def handle_event("increment", _params, socket) do
    {:noreply, update(socket, :count, &(&1 + 1))}
  end

  def render(assigns) do
    ~H"""
    <p>Count: <%= @count %></p>
    <button phx-click="increment">+</button>
    """
  end
end
```

### Comparison to Signals

| Concept               | LiveView                        | Signals (e.g., Angular/Solid)  |
|-----------------------|---------------------------------|--------------------------------|
| State container       | `socket.assigns` map            | Signal primitive               |
| Read                  | `@count` in template            | `signal()` / `.value`          |
| Write                 | `assign(socket, count: n)`      | `signal.set(n)`                |
| Reactivity            | Server-side diff + patch        | Fine-grained DOM updates       |
| Invalidation          | Full assign diff on each event  | Dependency graph tracking      |
| Identity guarantee    | Implicit (immutable assigns)    | Needs `identity` annotation    |

### Key Insight: Managed State Transitions

LiveView enforces a pattern where:
1. State is read-only in the template (`render/1`)
2. State changes only happen in event handlers (`handle_event/3`)
3. Each state transition produces a new assigns map (immutable update)

This is structurally similar to a strict `identity`/`mutator` discipline:
- `render` = pure function reading `identity` properties
- `handle_event` = `mutator` that produces new state
- The framework guarantees no mutation during rendering

---

## 8. Alternative Syntax Ideas — Immutable-First TypeScript?

### What If TypeScript Had Immutable-First Semantics?

Elixir's approach suggests an alternative to `identity`/`mutator`:
**What if we made immutability the default and required explicit opt-in for mutation?**

#### Hypothetical: `readonly` by Default

```typescript
// Hypothetical: all properties readonly by default
interface Person {
  name: string;       // readonly (default)
  age: number;        // readonly (default)
  mutable score: number;  // explicitly mutable
}

function birthday(p: Person): Person {
  // Cannot: p.age++
  // Must: return a new object
  return { ...p, age: p.age + 1 };
}
```

In this model:
- `identity` is unnecessary — all properties are identity by default
- `mutator` only applies to `mutable` properties
- `links` is unnecessary — only `mutable` properties can be invalidated

#### Why This Doesn't Work for TypeScript

1. **Backward compatibility.** JavaScript objects are mutable. Making `readonly` the
   default would break essentially all existing code.

2. **Performance.** JavaScript engines optimize mutable objects heavily. Immutable update
   patterns (spread, `Object.assign`) create garbage collection pressure.

3. **Ecosystem.** Libraries expect mutable APIs (`Array.push`, `Map.set`, DOM APIs).

4. **Developer expectations.** JavaScript developers expect mutation.

#### Elixir-Inspired `freeze` Pattern

A more practical approach inspired by Elixir — leverage `Object.freeze` semantics:

```typescript
// Freeze as a type-level operation
function freeze<T>(obj: T): Frozen<T>;

type Frozen<T> = {
  readonly [K in keyof T]: T[K] extends object ? Frozen<T[K]> : T[K];
};

// Frozen objects have implicit identity on all properties
const person: Frozen<Person> = freeze({ name: "Alice", age: 30 });
// All narrowings on person are permanently stable
```

This is already partially possible with `as const` and `Readonly<T>`, but lacks:
- Deep freezing at the type level
- Enforcement that frozen objects cannot be passed to mutating functions
- Integration with CFA narrowing preservation

#### Process-Inspired Isolation

Elixir's process model suggests another pattern — **ownership-based mutation**:

```typescript
// Hypothetical: owned mutable state
class Counter {
  // 'owned' means only this class can mutate; external reads are stable
  owned count: number = 0;

  identity get value(): number { return this.count; }
  mutator increment(): void { this.count++; }
}
```

This is essentially what `identity`/`mutator` already provides, but the "owned" keyword
makes the process-isolation analogy explicit.

---

## Summary: Lessons from Elixir

| Lesson                          | Elixir Approach               | TypeScript-Go Approach          |
|---------------------------------|-------------------------------|---------------------------------|
| Mutation tracking               | Eliminated via immutability   | Explicit via mutator            |
| Narrowing stability             | Guaranteed by construction    | Opt-in via identity             |
| State isolation                 | Process boundaries            | Class/object boundaries         |
| Selective invalidation          | Not needed                    | links clause                    |
| Shared mutable state            | ETS (explicit, rare)          | Default (common)                |
| Reactive state                  | LiveView assigns              | Signals + identity              |
| Gradual typing                  | Dialyzer → new type system    | identity/mutator opt-in         |

### Core Takeaway

Elixir proves that **immutability eliminates the need for mutation tracking entirely**.
TypeScript-Go's `identity`/`mutator`/`links` system is the pragmatic adaptation of this
principle for a language where mutation is the default. The system effectively lets
developers mark specific islands of stability (`identity`) in a sea of potential
mutation (`mutator`), achieving Elixir-like guarantees selectively rather than globally.

The GenServer pattern is the closest structural analog: state is private, reads are
stable, writes are explicit and managed. The `identity`/`mutator` system brings this
discipline to TypeScript's object model without requiring a full paradigm shift.
