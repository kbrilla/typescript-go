# Design Review #23: Zig, Nim, and Crystal — Systems-Level Approaches to Mutability and Type Safety

## Document Control
- Status: Research Analysis
- Date: 2026-03-11
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Zig, Nim, and Crystal's mutability/narrowing models with TypeScript-Go's `identity`/`mutator`/`links` CFA system

---

## Background

Zig, Nim, and Crystal represent a generation of systems-oriented languages that emerged after C++11/Rust but before the current wave of effect-system-heavy designs. Each takes a pragmatic approach to type safety and mutability:

- **Zig** (2016): Manual memory, no hidden control flow, comptime metaprogramming
- **Nim** (2008, 1.0 in 2019): Effect tracking via pragmas, macro-driven metaprogramming
- **Crystal** (2014): Ruby-like syntax with full static typing and union-based flow narrowing

All three are relevant because they solve subsets of the same problem TypeScript-Go's `identity`/`mutator`/`links` addresses: how to let compilers reason about value stability across reads and writes.

---

## 1. Zig: `const` vs `var` — Immutable/Mutable Distinction

### Zig's Model

Zig enforces mutability at the binding level. Every declaration is either `const` (immutable) or `var` (mutable):

```zig
const x: u32 = 42;   // immutable — cannot reassign
var y: u32 = 42;      // mutable — can reassign
y = 100;              // OK
x = 100;              // ERROR: cannot assign to constant
```

This distinction propagates to struct fields. If a struct is accessed through a `const` binding, all field accesses are read-only — even fields that would be mutable on a `var` binding:

```zig
const Point = struct {
    x: i32,
    y: i32,
};

var p = Point{ .x = 10, .y = 20 };
p.x = 30;  // OK — p is var

const q = Point{ .x = 10, .y = 20 };
q.x = 30;  // ERROR — q is const, so all fields are read-only
```

Zig has no `mut` keyword on individual fields — mutability is determined entirely by the binding. This is a transitive constness model, similar to C's `const` but without C's ability to cast it away.

### Comparison to identity/mutator

| Zig Concept | TypeScript-Go Analog | Semantic |
|-------------|---------------------|----------|
| `const` binding | `identity` endpoint | Stable read — value won't change |
| `var` binding | Regular mutable property | May be written to; no narrowing guarantees |
| No per-field `mut` | `identity` per-member granularity | TS-Go is more granular — individual members can be identity |
| Transitive constness | No analog (shallow) | Zig freezes entire object graph; TS-Go is per-endpoint |

**Key difference:** Zig's constness is **all-or-nothing** per binding. You cannot have a struct where some fields are stable and others are mutable through the same reference. TypeScript-Go's `identity` modifier operates at the individual member level:

```typescript
interface Store {
    read: identity () => string | undefined;   // stable
    count: identity () => number;              // also stable
    write: mutator (v: string) => void;        // mutable — invalidates read
}
```

This per-member granularity is critical for signal-style APIs where read and write operations coexist on the same object but affect different properties.

### Zig's Comptime Narrowing

Zig does not have flow-based type narrowing in the traditional sense. Instead, optional types (`?T`) require explicit unwrapping:

```zig
fn process(maybe_val: ?u32) void {
    if (maybe_val) |val| {
        // val is u32 here — the optional is "unwrapped"
        std.debug.print("{}\n", .{val});
    }
    // maybe_val is still ?u32 here — no narrowing carried forward
}
```

The `|val|` capture syntax creates a new binding rather than narrowing the existing one. This means Zig sidesteps the entire invalidation problem: there is no narrowing to invalidate because the unwrapped value is a separate scope-local binding.

**Insight for identity:** Zig's approach — "extract into a local binding instead of narrowing" — is exactly the workaround TypeScript developers use today (`const val = store.read()`). The `identity` modifier makes this extraction unnecessary by telling the compiler the read is stable.

---

## 2. Zig: Comptime — Compile-Time Evaluation and Type Narrowing

### The Comptime Model

Zig's `comptime` is a full compile-time execution environment. Any expression marked `comptime` is evaluated during compilation:

```zig
const len = comptime blk: {
    var sum: usize = 0;
    for ("hello") |_| {
        sum += 1;
    }
    break :blk sum;
};
// len is a compile-time known constant: 5
```

Type-level computation uses `comptime` extensively. Generic types are just functions that run at compile time:

```zig
fn ArrayList(comptime T: type) type {
    return struct {
        items: []T,
        capacity: usize,

        pub fn append(self: *@This(), item: T) !void {
            // ...
        }
    };
}
```

### Comptime and Type Safety

Because `comptime` values are fully evaluated at compile time, they are inherently immutable from the runtime perspective. A `comptime var` can change during compilation but becomes fixed in the emitted code:

```zig
comptime var flags: u8 = 0;
comptime {
    flags |= 0x01;  // OK at compile time
    flags |= 0x04;  // OK at compile time
}
// flags is now a compile-time constant 0x05 at runtime
```

This creates a two-phase model:
1. **Comptime phase:** Values can mutate freely during compilation.
2. **Runtime phase:** Comptime-derived values are frozen constants.

### Comparison to identity

| Zig Comptime | TypeScript-Go Identity | Semantic |
|-------------|----------------------|----------|
| `comptime const` | `identity` (conceptually) | Value is fixed; reads are stable |
| `comptime var` | No direct analog | Mutable during computation, frozen after |
| Two-phase evaluation | CFA flow analysis | Different mechanisms, similar goal |
| Compile-time generic instantiation | Generic type inference | Both resolve types before emit |

**Key insight:** Zig separates "when can this change?" into two distinct phases. TypeScript-Go's identity system makes a weaker but more flexible claim: "this read endpoint returns consistent values between mutations." Zig's guarantee is absolute (comptime values literally cannot change at runtime); TypeScript's is flow-dependent (values may change, but the compiler tracks when).

---

## 3. Zig: Pointer Semantics — `*const T` vs `*T`

### Pointer Mutability

Zig distinguishes read-only and mutable pointers at the type level:

```zig
fn readOnly(ptr: *const u32) void {
    // Can read *ptr, cannot write through it
    const val = ptr.*;     // OK
    ptr.* = 42;            // ERROR: cannot assign through const pointer
}

fn readWrite(ptr: *u32) void {
    // Full read-write access
    const val = ptr.*;     // OK
    ptr.* = 42;            // OK
}
```

When a function takes `*const T`, the caller knows their data won't be modified. When a function takes `*T`, the caller knows mutation is possible. This is an explicit contract in the type signature.

### Coercion Rules

Zig allows implicit coercion from `*T` to `*const T` (widening) but not the reverse:

```zig
var x: u32 = 10;
const mutable_ptr: *u32 = &x;
const readonly_ptr: *const u32 = mutable_ptr;  // OK: *T → *const T
// Cannot go back: *const T → *T is not allowed
```

This mirrors the Liskov substitution principle: a mutable reference is a subtype of a read-only reference. You can always provide more capability than requested.

### Comparison to identity/mutator

| Zig Pointer | TypeScript-Go Analog | Contract |
|-------------|---------------------|----------|
| `*const T` | `identity () => T` | "I will only read; value is stable" |
| `*T` | `mutator (v: T) => void` | "I may write; assumptions may be invalidated" |
| `*T → *const T` coercion | N/A (modifiers are per-member) | Subtyping direction |
| `*const` in signature | `identity` in declaration | Caller can see the contract |

**Critical parallel:** Zig's `*const T` in function parameter position says "this function promises not to mutate through this pointer." TypeScript-Go's `identity` says "this read endpoint promises to return consistent values." Both are **contracts visible in the declaration** that enable compiler optimizations and reasoning.

**Key difference:** Zig's pointer constness is about **who can write** (capability-based). TypeScript-Go's identity is about **what the compiler can assume** (knowledge-based). Zig physically prevents writes through const pointers; TypeScript-Go allows writes but tells the compiler where to invalidate assumptions.

---

## 4. Nim: `let` vs `var` — Immutable/Mutable Bindings

### Nim's Model

Nim has a three-tier mutability system similar to Dart's:

```nim
let x = 42       # immutable binding — cannot reassign
var y = 42       # mutable binding — can reassign
const z = 42     # compile-time constant — evaluated at compile time

y = 100          # OK
x = 100          # ERROR: 'x' cannot be assigned to
```

For objects, `let` creates a shallow freeze — the binding cannot be reassigned, but object fields accessed through it may still be mutable:

```nim
type Person = object
  name: string
  age: int

let p = Person(name: "Alice", age: 30)
p.name = "Bob"   # ERROR: 'p' is immutable
p.age = 31       # ERROR: 'p' is immutable

var q = Person(name: "Alice", age: 30)
q.name = "Bob"   # OK
```

However, Nim uses **value semantics by default** for objects. When you assign an object to a new variable, it's copied:

```nim
var a = Person(name: "Alice", age: 30)
var b = a          # b is a copy of a
b.name = "Bob"     # does NOT affect a
echo a.name        # "Alice"
```

Reference semantics require explicit `ref` types:

```nim
type PersonRef = ref Person

var a = PersonRef(name: "Alice", age: 30)
var b = a          # b is an alias to the same object
b.name = "Bob"     # DOES affect a
echo a.name        # "Bob"
```

### Comparison to identity/mutator

| Nim Concept | TypeScript-Go Analog | Semantic |
|-------------|---------------------|----------|
| `let` binding | Local `const` (partial) | Cannot reassign; value stable for this reference |
| `var` binding | Regular property access | Mutable; no narrowing guarantees |
| `const` | N/A (no full compile-time eval in TS) | Compile-time constant |
| Value semantics (objects) | N/A (JS is reference-based) | Copies prevent aliasing issues entirely |
| `ref` types | Normal JS object semantics | Shared mutable state |

**Key insight:** Nim's default value semantics eliminate many aliasing problems that `identity` needs to solve. When objects are copied on assignment, mutations to one copy can't invalidate reads from another. JavaScript (and therefore TypeScript) is reference-based by default, so aliasing is pervasive — making `identity`/`mutator` annotations necessary for the compiler to reason about stability.

---

## 5. Nim: Effect System — `{.noSideEffect.}` Pragma

### Nim's Effect Tracking

Nim has a built-in effect system exposed through pragmas. The most relevant is `{.noSideEffect.}` (and its shorthand `func` instead of `proc`):

```nim
func add(a, b: int): int =
  # Guaranteed: no side effects
  # Cannot modify global state, write to var parameters, or call impure functions
  return a + b

proc mutate(x: var int) =
  # Side-effecting procedure
  x += 1
```

The `func` keyword is syntactic sugar for `proc {.noSideEffect.}`. The compiler verifies the claim — a `func` that modifies global state or calls a `proc` without `{.noSideEffect.}` is a compile error:

```nim
var globalCounter = 0

func pureFunction(): int =
  globalCounter += 1    # ERROR: cannot modify global state in a noSideEffect context
  return globalCounter

func callsImpure(): int =
  mutate(globalCounter)  # ERROR: cannot call side-effecting proc from func
  return globalCounter
```

### Effect Propagation

Nim's effect system propagates through call chains. A function marked `{.noSideEffect.}` can only call other `{.noSideEffect.}` functions:

```nim
func helper(x: int): int = x * 2     # pure
func process(x: int): int = helper(x) + 1  # OK: calls pure function

proc impureHelper(x: int): int =
  echo "logging"   # side effect
  return x * 2

func brokenProcess(x: int): int =
  impureHelper(x) + 1   # ERROR: calls impure proc
```

### Comparison to identity/mutator

| Nim Effect System | TypeScript-Go Analog | Semantic |
|-------------------|---------------------|----------|
| `func` / `{.noSideEffect.}` | `identity` modifier | "This callable does not mutate state" |
| `proc` (default) | Unmodified function type | May have side effects |
| `{.noSideEffect.}` on callback param | No analog (Phase 1) | Transitively guarantees purity |
| Effect propagation (automatic) | Heuristic tier inference | Mechanism for tracking impact |
| Compile error on violation | CFA invalidation | Enforcement strength |

**This is the closest analog to `identity` in this review.** Nim's `{.noSideEffect.}` and TypeScript-Go's `identity` both mark callables as "safe to call without worrying about state changes." The key differences:

1. **Scope:** Nim's `{.noSideEffect.}` means "no side effects at all" (no I/O, no global writes). `identity` means the narrower "this specific endpoint returns stable values." An `identity` function could have logging side effects — it just promises its return value is consistent.

2. **Transitivity:** Nim's effect system is transitive — a pure function can only call pure functions. `identity` is a per-endpoint declaration with no transitive requirement on callees.

3. **Enforcement:** Nim verifies at compile time that `func` bodies contain no side effects. TypeScript-Go trusts the `identity` declaration and uses it to enable optimistic CFA, invalidating when mutations are detected.

### The Pragma Pattern

Nim's use of pragmas (`{.pragmaName.}`) for compiler directives is worth noting. It places metadata inline with declarations without requiring new keywords:

```nim
proc readValue(s: Store): int {.noSideEffect.} =
  return s.value

proc writeValue(s: var Store, v: int) =
  s.value = v
```

TypeScript-Go chose modifier keywords (`identity`, `mutator`) over pragma-style annotations. The trade-off: keywords are more discoverable and feel native to the language, but pragmas are more extensible and don't pollute the keyword namespace.

---

## 6. Nim: Concepts — Structural Typing with Constraints

### Nim's Concepts

Nim's `concept` feature provides structural typing constraints similar to TypeScript interfaces but with built-in support for method contracts:

```nim
type
  Readable = concept r
    r.read() is string

  Writable = concept w
    w.write(string)

  ReadWriteStore = concept s
    s is Readable
    s is Writable
```

Concepts are checked structurally at call sites:

```nim
type MyStore = object
  data: string

proc read(s: MyStore): string = s.data
proc write(s: var MyStore, v: string) = s.data = v

proc process(s: Readable) =
  echo s.read()   # OK: MyStore satisfies Readable

process(MyStore(data: "hello"))  # OK
```

### Concepts and Effects

Concepts can constrain effect annotations:

```nim
type
  PureReadable = concept r
    r.read() is string
    # Implicitly: read must be callable in noSideEffect context
    # (Nim doesn't natively enforce this in concept definitions,
    # but the compiler will check at instantiation if the calling
    # context requires purity.)
```

### Comparison to identity/mutator

| Nim Concepts | TypeScript-Go Analog | Semantic |
|-------------|---------------------|----------|
| `concept r; r.read() is T` | `interface { read: identity () => T }` | Structural type requiring a read endpoint |
| `concept w; w.write(T)` | `interface { write: mutator (v: T) => void }` | Structural type requiring a write endpoint |
| Concept composition (`is`) | Interface extension | Composing read/write contracts |
| Structural matching at call site | Structural type checking | Both are structurally typed |

**Key insight:** Nim's concepts show that structural typing can carry behavioral contracts (read vs write roles) without class hierarchies. TypeScript-Go's approach goes further by attaching narrowing semantics (`identity`/`mutator`) directly to the structural type members, making the contract usable by the type checker's CFA.

---

## 7. Crystal: Type Inference — Union Types and Flow Narrowing

### Crystal's Narrowing Model

Crystal has flow-sensitive type narrowing for union types, strikingly similar to TypeScript's:

```crystal
def process(value : String | Nil)
  if value
    # value is String here — Nil is narrowed out
    puts value.upcase
  else
    # value is Nil here
    puts "no value"
  end
end
```

Crystal narrows on `if`, `case`, `is_a?`, `responds_to?`, and `nil?` checks:

```crystal
def describe(x : Int32 | String | Nil)
  case x
  when Int32
    puts "Integer: #{x + 1}"      # x is Int32
  when String
    puts "String: #{x.upcase}"    # x is String
  when nil
    puts "Nothing"                # x is Nil
  end
end
```

### Narrowing Invalidation

Crystal invalidates narrowing on reassignment:

```crystal
def example(x : String | Nil)
  if x
    puts x.upcase      # OK — x is String
    x = nil             # reassign
    # x.upcase          # ERROR — x is String | Nil again
  end
end
```

Crystal also invalidates narrowing when a variable is captured in a closure — because the closure could execute at a later time when the variable's value has changed:

```crystal
class Foo
  @value : String?

  def process
    if @value
      # Cannot narrow @value here — instance variables can change
      # between the check and the use (e.g., via another thread or method)
      v = @value     # must capture to local
      if v
        puts v.upcase  # OK — local variable v is narrowed
      end
    end
  end
end
```

### Comparison to identity/mutator

| Crystal Narrowing | TypeScript-Go Analog | Semantic |
|-------------------|---------------------|----------|
| `if value` narrows union type | `if (value() !== undefined)` narrows identity return | Flow-based narrowing on check |
| Reassignment invalidates | `mutator` call invalidates | Write resets type assumptions |
| Instance variable not narrowable | Callable return not narrowable (without `identity`) | Aliased/mutable state blocks narrowing |
| "Capture to local" pattern | `const v = store.read()` (pre-identity workaround) | Manual stabilization |
| Closure capture invalidation | Callback boundary invalidation | Interleaved execution could mutate |

**Critical parallel:** Crystal's rule "instance variables cannot be narrowed because they might change" is *exactly* the problem `identity` solves. Without `identity`, TypeScript-Go treats callable returns like Crystal treats instance variables — potentially unstable, so no narrowing. With `identity`, the declaration asserts stability, enabling the same narrowing Crystal allows for local variables.

**Crystal's "capture to local" idiom** (`v = @value; if v`) is the manual equivalent of what `identity` automates. The `identity` modifier tells the compiler "you can treat this callable as if the developer had captured its result to a local constant."

---

## 8. Crystal: `getter` and `property` Macros — Read/Write Declaration

### Crystal's Macros

Crystal uses macros to declare read and write access to instance variables:

```crystal
class User
  getter name : String           # generates def name; @name; end
  setter name : String           # generates def name=(value : String); @name = value; end
  property age : Int32           # generates both getter and setter
  getter? active : Bool          # generates def active?; @active; end (returns Bool)

  def initialize(@name : String, @age : Int32, @active : Bool = true)
  end
end

user = User.new("Alice", 30)
puts user.name      # OK — getter exists
user.age = 31       # OK — property includes setter
# user.name = "Bob" # ERROR — no setter for name (getter-only)
```

### Read-Only vs Read-Write Distinction

The `getter` vs `property` distinction creates an explicit read-only / read-write contract in Crystal declarations:

```crystal
class Config
  getter database_url : String       # read-only — set once at construction
  property log_level : String        # read-write — can change at runtime
  getter? production : Bool          # read-only boolean query

  def initialize(@database_url, @log_level = "info", @production = false)
  end
end
```

This is enforced at the type level — calling `config.database_url = "..."` is a compile error because no setter method exists.

### Comparison to identity/mutator

| Crystal Macro | TypeScript-Go Analog | Semantic |
|---------------|---------------------|----------|
| `getter name : T` | `name: identity () => T` | Read-only endpoint — stable |
| `setter name : T` | `setName: mutator (v: T) => void` | Write endpoint — invalidating |
| `property name : T` | Both `identity` getter + `mutator` setter | Read-write with explicit contract |
| `getter?` (boolean) | `isActive: identity () => boolean` | Boolean query, stable |

**Key insight:** Crystal's `getter`/`property` macros provide exactly the same read/write contract distinction as `identity`/`mutator`, but at the declaration level of instance variables rather than callable types. Crystal's approach is simpler because it controls both sides (the variable and its accessor) — TypeScript-Go must work with arbitrary callable APIs, which is why the modifier system is necessary.

### The Missing Link

Crystal's system lacks an equivalent to `links`. A `property` macro generates a setter, but there's no built-in way to express "setting property X also affects property Y":

```crystal
class UserStore
  getter name : String?        # read-only
  getter email : String?       # read-only
  # No way to express: "setName also invalidates email"
  # Crystal would need something like:
  # mutator_property name : String?, invalidates: [:email]
end
```

TypeScript-Go's `links` clause fills this gap:

```typescript
interface UserStore {
    name: identity () => string | undefined;
    email: identity () => string | undefined;
    setName: mutator (v: string) => void links name;       // only invalidates name
    resetAll: mutator () => void links name, email;         // invalidates both
}
```

---

## 9. Crystal: Nilable Types — Strict Nil Handling and Narrowing

### Crystal's Nil Safety

Crystal treats `Nil` as a first-class type in unions. All types are non-nil by default; nilable types must be explicitly declared:

```crystal
name : String       # never nil
name : String?      # equivalent to String | Nil
name : String | Nil # explicit union form
```

The compiler enforces nil checks before accessing methods that don't exist on `Nil`:

```crystal
def greet(name : String?)
  # name.upcase     # ERROR: undefined method 'upcase' for Nil
  if name
    name.upcase      # OK — narrowed to String
  end
end
```

### Nil Guards and Flow

Crystal supports several patterns for nil narrowing:

```crystal
# Pattern 1: if guard
if value
  value.method   # narrowed
end

# Pattern 2: not_nil! assertion (like TypeScript's !)
value.not_nil!.method   # runtime assertion, narrows in flow

# Pattern 3: try (safe navigation, like TypeScript's ?.)
value.try &.method   # returns nil if value is nil

# Pattern 4: case/when
case value
when String then value.upcase
when Int32 then value.to_s
when nil then "nothing"
end
```

### Narrowing Invalidation for Nilable Types

Crystal's narrowing invalidation for nilable types follows the same rules as union types — reassignment and closure capture break narrowing:

```crystal
class Container
  @data : String?

  def process
    if @data
      # @data CANNOT be narrowed — instance variable might change
      # This is a compile error:
      # puts @data.upcase

      # Must capture to local:
      local = @data
      if local
        puts local.upcase   # OK — local is narrowed
      end
    end
  end
end
```

### Comparison to identity/mutator for Nilable Types

| Crystal Nil Pattern | TypeScript-Go Analog | Behavior |
|--------------------|---------------------|----------|
| `String?` type | `string \| undefined` return type | Union with nil/undefined |
| `if value` narrows | `if (value() !== undefined)` narrows `identity` return | Flow-based nil narrowing |
| Instance var not narrowable | Callable return not narrowable (without `identity`) | Mutable state blocks narrowing |
| `value.not_nil!` | Non-null assertion `value()!` | Trust-the-developer escape hatch |
| `value.try &.method` | `value()?.method` | Safe navigation, no narrowing |
| "Capture to local" | `const v = store.read()` pattern | Manual stabilization before check |

**The parallel is remarkably direct.** Crystal's `String?` and TypeScript's `string | undefined` are the most common narrowing scenario in both languages. Crystal's inability to narrow instance variables is resolved in TypeScript-Go by the `identity` modifier — declaring that the callable return *acts* like a local variable from the compiler's perspective.

---

## 10. Synthesis: Common Patterns Across Zig, Nim, and Crystal

### Pattern 1: Constness as a Declaration-Level Contract

All three languages distinguish "can this change?" at declaration time:

| Language | Read-Only | Mutable | Compile-Time Constant |
|----------|-----------|---------|----------------------|
| Zig | `const` | `var` | `comptime` |
| Nim | `let` | `var` | `const` |
| Crystal | `getter` | `property` | Compile-time literals |
| TypeScript-Go | `identity` | (default) | `as const` (partial) |

**Consensus:** Marking read stability at the declaration site is a universal pattern. TypeScript-Go's `identity` is this pattern applied to callable return types rather than bindings or fields.

### Pattern 2: The "Capture to Local" Workaround

Both Crystal and Zig require developers to manually capture unstable values into local variables before the compiler will narrow them:

```crystal
# Crystal: instance var → local
local = @data
if local; local.upcase; end
```

```zig
// Zig: optional → payload capture
if (maybe_val) |val| { ... }
```

```typescript
// TypeScript (pre-identity): callable → local
const val = store.read();
if (val !== undefined) { val.toUpperCase(); }
```

`identity` eliminates this ceremony. The modifier tells the compiler: "this callable return is already as stable as a local variable." This is a clear ergonomic improvement — developers declare intent once, rather than defensively capturing on every use.

### Pattern 3: Effect Annotations vs Modifier Keywords

| Language | Mechanism | Syntax |
|----------|-----------|--------|
| Nim | Pragmas (`{.noSideEffect.}`) | Annotation-style, extensible |
| Zig | Binding keywords (`const`/`var`) | Keyword-based, simple |
| Crystal | Macros (`getter`/`property`) | Metaprogramming-based |
| TypeScript-Go | Modifiers (`identity`/`mutator`) | Keyword-based, per-member |

Nim's pragma approach is the most flexible but least discoverable. Zig's keyword approach is the simplest but least granular. Crystal's macro approach is powerful but opaque. TypeScript-Go's modifier approach balances discoverability with granularity.

### Pattern 4: Closure/Callback Boundary Invalidation

Crystal explicitly invalidates narrowing at closure boundaries. Nim's effect system prevents impure calls from pure contexts. Zig avoids the issue by using capture-based unwrapping.

TypeScript-Go's approach to callback boundaries — conservatively invalidating `identity` narrowing when a callback could interleave writes — aligns with Crystal's model. The `links` clause adds targeted precision that none of these three languages provide.

### Pattern 5: Missing Piece — Selective Invalidation (`links`)

None of Zig, Nim, or Crystal have an equivalent to `links`. Their effect systems and constness models are binary (pure/impure, const/mutable, getter/property). They cannot express:

> "This mutation affects endpoint A but not endpoint B."

TypeScript-Go's `links` clause is a novel contribution in this design space:

```typescript
interface Store {
    a: identity () => string | undefined;
    b: identity () => number | undefined;
    setA: mutator (v: string) => void links a;   // only invalidates a
}
```

This allows the checker to preserve narrowing for `b()` even after `setA()` is called — a precision gain that requires no analog in Zig/Nim/Crystal because their simpler access patterns (field reads, function calls) don't encounter this multi-endpoint invalidation problem.

### Summary Table

| Feature | Zig | Nim | Crystal | TypeScript-Go |
|---------|-----|-----|---------|--------------|
| **Read stability marker** | `const` | `let` / `func` | `getter` | `identity` |
| **Mutation marker** | `var` | `proc` | `property` / setter | `mutator` |
| **Selective invalidation** | N/A | N/A | N/A | `links` clause |
| **Union narrowing** | No (capture-based) | Limited | Yes (flow-based) | Yes (flow-based + identity) |
| **Nil/undefined narrowing** | `?T` capture | `Option[T]` | `T?` flow narrowing | `T \| undefined` + identity |
| **Effect tracking** | None (manual const) | `{.noSideEffect.}` | None (macro conventions) | Per-endpoint modifiers |
| **Callback boundary** | N/A (no closures narrowing) | Effect propagation | Closure invalidation | Conservative invalidation |
| **Enforcement** | Compile error | Compile error | Compile error | CFA invalidation (soft) |
| **Granularity** | Per-binding (all fields) | Per-binding + effects | Per-member (macros) | Per-member (modifiers) |

### What These Languages Teach

1. **Declaration-site contracts work.** Every language in this review succeeds by putting mutability information at the declaration site. `identity`/`mutator` follows this proven pattern.

2. **The capture-to-local pattern is universal but tedious.** `identity` automates what Crystal and Zig force developers to do manually. This is strong evidence that the feature addresses a real, cross-language pain point.

3. **Binary pure/impure is too coarse.** Nim's `{.noSideEffect.}` is all-or-nothing. TypeScript-Go's per-endpoint system with `links`-based selective invalidation is more precise — and more appropriate for APIs with multiple read/write endpoints on the same object.

4. **Soft enforcement fits TypeScript's domain.** Zig, Nim, and Crystal all use hard compile errors. TypeScript-Go's softer "invalidate narrowing" approach is correct for a gradually-typed language where `any`, type assertions, and dynamic patterns are fundamental.

5. **`links` is genuinely novel.** No language in this review (or the broader survey) provides declaration-site selective invalidation targeting. This positions TypeScript-Go's system as extending beyond existing art rather than merely porting prior work.
