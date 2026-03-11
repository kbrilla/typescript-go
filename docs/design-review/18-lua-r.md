# Design Review: Lua & R — Metatables, Active Bindings, and Read/Write Contracts vs TypeScript-Go's `identity`/`mutator`/`links`

## Overview

Lua and R represent two radically different corners of the programming language
landscape — one an embeddable scripting language designed for minimal footprint, the
other a statistical computing environment designed for data manipulation — yet both
have evolved sophisticated mechanisms for intercepting reads and writes, separating
stable values from mutable state, and layering type-level reasoning onto dynamic
foundations. Lua's metatable system provides fine-grained read/write interception that
maps surprisingly well onto TypeScript-Go's `identity`/`mutator` semantics, while R's
active bindings, replacement functions, and reference classes offer a distinct
vocabulary for the same fundamental problem: how should a type system reason about
when a "read" is stable and when a "write" invalidates cached knowledge?

This document examines each language's approach, maps patterns to TypeScript-Go's
`identity`/`mutator`/`links` contracts, and extracts cross-cutting lessons from
these niche but conceptually rich ecosystems.

---

## 1. Lua Metatables — `__index` and `__newindex` for Read/Write Interception

### 1.1 The Metatable Model

Lua's metatable system is the language's primary mechanism for customizing read and
write behavior on tables (Lua's sole compound data structure). Any table can have
an associated metatable that defines metamethod handlers for operations including
property reads, property writes, arithmetic, comparison, and function calls.

The two metamethods most relevant to TypeScript-Go's `identity`/`mutator` distinction
are:

- **`__index`** — intercepted on read access to a missing key
- **`__newindex`** — intercepted on write access to a missing key

```lua
local mt = {
    __index = function(self, key)
        -- Custom read: computed property, proxy, or stable lookup
        return rawget(self, "_data")[key]
    end,

    __newindex = function(self, key, value)
        -- Custom write: validation, notification, or tracking
        rawset(self, "_dirty", true)
        rawget(self, "_data")[key] = value
    end,
}

local obj = setmetatable({ _data = { x = 10, y = 20 }, _dirty = false }, mt)
print(obj.x)   -- triggers __index → 10
obj.x = 30     -- triggers __newindex → sets _dirty = true
```

### 1.2 Metatable as Getter/Setter Contract

The metatable pattern establishes a **declaration-site contract** for read and write
behavior — each metamethod defines what happens when code reads from or writes to a
table. This maps directly onto TypeScript-Go's concepts:

| Lua Metamethod     | TypeScript-Go Analog     | Role                                      |
|--------------------|--------------------------|-------------------------------------------|
| `__index`          | `identity` getter        | Defines what a "read" returns             |
| `__newindex`       | `mutator` setter         | Defines what a "write" does               |
| `rawget()`         | Direct property access   | Bypasses interception                     |
| `rawset()`         | Direct property write    | Bypasses interception                     |

The critical insight is that `__index` can return different values on repeated calls
(it is a function, not a cached value), meaning that Lua's read interception does
**not** guarantee stability. In TypeScript-Go terms, a Lua `__index` metamethod is
a callable read endpoint that is not `identity` by default — the programmer must
establish stability semantics by convention or by implementation.

### 1.3 Proxy Tables — Complete Read/Write Separation

Lua's idiomatic "proxy table" pattern uses an empty table with a metatable that
delegates all access to a hidden backing store:

```lua
function createProxy(target)
    local proxy = {}
    local mt = {
        __index = function(_, key)
            return target[key]
        end,
        __newindex = function(_, key, value)
            -- Could validate, log, or reject writes
            target[key] = value
        end,
    }
    return setmetatable(proxy, mt)
end

local real = { name = "Alice", score = 100 }
local p = createProxy(real)
print(p.name)    -- "Alice" via __index
p.score = 200    -- writes through to `real` via __newindex
```

This is structurally identical to TypeScript-Go's use case: a proxy (or signal) that
has stable reads (`identity`) and controlled writes (`mutator`). The difference is
that Lua leaves the stability contract to the programmer's discipline — there is no
type-level assertion that reads are stable.

### 1.4 Readonly Proxies

Lua can create a fully readonly proxy by making `__newindex` raise an error:

```lua
function readonlyProxy(target)
    return setmetatable({}, {
        __index = target,
        __newindex = function()
            error("attempt to modify a readonly table")
        end,
    })
end

local config = readonlyProxy({ debug = true, logLevel = "info" })
print(config.debug)    -- true
config.debug = false   -- error: attempt to modify a readonly table
```

This is the Lua equivalent of TypeScript's `Readonly<T>` utility type, but enforced
at runtime rather than at compile time. A readonly proxy in Lua is implicitly
`identity`-safe because no mutations can occur — the equivalent of a TypeScript-Go
type where all properties are `identity` and no `mutator` methods exist.

### 1.5 Comparison to TypeScript-Go

| Lua Metatables                | TypeScript-Go              | Key Difference                          |
|-------------------------------|----------------------------|-----------------------------------------|
| `__index` metamethod          | `identity` read endpoint   | Lua is runtime; TS-Go is compile-time   |
| `__newindex` metamethod       | `mutator` write endpoint   | Lua has no selective invalidation        |
| Readonly proxy (error on set) | `Readonly<T>` + `identity` | Lua enforces at runtime; TS at compile  |
| `rawget()`/`rawset()`         | No bypass mechanism        | Lua allows escaping the contract        |
| No type-level metamethod info | `identity`/`mutator` decl  | Lua metatables are invisible to tools   |

---

## 2. Lapis and Teal — Lua Type Checkers and Web Frameworks

### 2.1 Teal: Typed Lua

Teal is a typed dialect of Lua that compiles to Lua. It adds a static type system
with generics, records, enums, and interfaces — but notably does **not** add any
metatable-aware type checking:

```teal
local record Point
    x: number
    y: number
end

local p: Point = { x = 1, y = 2 }
p.x = 3  -- allowed, no readonly modifier exists
```

Teal's type system is structural and flow-sensitive (it performs narrowing on `is`
checks for union types), but it has no concept analogous to:

- **`identity`** — there is no way to declare that a record field is "stable for
  narrowing purposes"
- **`mutator`** — there is no annotation for methods that invalidate narrowing
- **`links`** — there is no selective invalidation at all

Teal's narrowing is purely control-flow based and resets at any assignment to the
narrowed variable. It does not track reads through accessor functions or metatables.

### 2.2 Lapis: Web Framework Pattern

Lapis, a Lua web framework built on OpenResty, uses a class system with method-based
access patterns:

```lua
local Model = require("lapis.db.model").Model

local Users = Model:extend("users")

-- Read: stable query result
local user = Users:find(1)
print(user.name)

-- Write: explicit update method
user:update({ name = "Bob" })
```

The `Model:find()` / `Model:update()` pattern is a natural read/write separation:
`find()` returns stable data (an `identity`-like read), while `update()` mutates
the underlying state (a `mutator`-like write). These semantics exist by convention
in Lapis — the framework does not enforce them through a type system.

### 2.3 Comparison to TypeScript-Go

| Teal / Lapis                     | TypeScript-Go                     | Key Difference                     |
|----------------------------------|-----------------------------------|------------------------------------|
| Teal records (structural)        | TypeScript interfaces             | Both structural; Teal lacks depth  |
| Teal narrowing (union `is`)      | TS-Go CFA narrowing               | Teal is simpler, no callable reads |
| Lapis `find()` / `update()`      | `identity` / `mutator`            | Lapis by convention; TS-Go by type |
| No metatable-aware type checking | `identity` on callable getters    | Teal ignores metatables entirely   |

The gap in Teal is instructive: even when a language adds static typing to a dynamic
foundation, the type system may not capture read/write stability patterns unless it
is specifically designed to do so. TypeScript-Go's `identity` modifier is a deliberate
design addition to address exactly this gap.

---

## 3. Lua Module Pattern — Upvalue-Based Encapsulation

### 3.1 The Module Idiom

Lua's standard module pattern uses closures and upvalues to create encapsulated
state with explicit read/write separation:

```lua
local function createCounter()
    local count = 0  -- private state via upvalue

    return {
        get = function()     -- read endpoint
            return count
        end,
        increment = function()  -- write endpoint
            count = count + 1
        end,
        reset = function()     -- write endpoint
            count = 0
        end,
    }
end

local c = createCounter()
print(c.get())    -- 0
c.increment()
print(c.get())    -- 1
```

This pattern achieves read/write separation through **closure boundaries**: the
`count` upvalue is only accessible through the returned function table. The `get`
function is the read endpoint; `increment` and `reset` are write endpoints.

### 3.2 Mapping to TypeScript-Go

In TypeScript-Go terms, this pattern naturally maps to:

```typescript
interface Counter {
    identity get(): number;
    mutator increment(): void;
    mutator reset(): void;
}
```

The Lua module pattern **implicitly** achieves what `identity`/`mutator` annotations
**explicitly** declare:

- `get()` is a stable read — calling it twice returns the same value unless
  `increment()` or `reset()` has been called in between
- `increment()` and `reset()` are mutation endpoints — calling either invalidates
  the cached result of `get()`

The difference is that Lua's type system (or Teal's) cannot express this contract,
so a type checker cannot reason about narrowing stability. TypeScript-Go makes this
reasoning possible at the type level.

### 3.3 Selective Invalidation via Module Design

More sophisticated Lua modules can separate independent state channels:

```lua
local function createStateful()
    local x = 0
    local y = 0

    return {
        getX = function() return x end,
        getY = function() return y end,
        setX = function(v) x = v end,
        setY = function(v) y = v end,
    }
end
```

Here, `setX` invalidates `getX` but not `getY`, and vice versa. This is the
Lua equivalent of TypeScript-Go's `links` clause:

```typescript
interface Stateful {
    identity getX(): number;
    identity getY(): number;
    mutator links(getX) setX(v: number): void;
    mutator links(getY) setY(v: number): void;
}
```

Lua programmers know these relationships by reading the code, but no Lua type
checker can reason about them. TypeScript-Go's `links` clause makes this implicit
knowledge explicit and checkable.

---

## 4. Copy-on-Write Tables — Sharing and Mutation Semantics

### 4.1 Table Sharing in Lua

Lua tables are reference types — assignment copies the reference, not the contents:

```lua
local a = { x = 1, y = 2 }
local b = a        -- b and a reference the same table
b.x = 10
print(a.x)         -- 10 — mutation through b is visible through a
```

This aliasing behavior is the fundamental obstacle to narrowing through reads in
any language: if a value might be aliased, a mutation through one alias invalidates
narrowing through another. TypeScript-Go's `identity` system must account for this
same aliasing problem.

### 4.2 Manual Copy-on-Write

Lua programmers sometimes implement copy-on-write patterns to avoid aliasing
problems:

```lua
local function shallowCopy(t)
    local copy = {}
    for k, v in pairs(t) do
        copy[k] = v
    end
    return copy
end

local function immutableUpdate(obj, key, value)
    local new = shallowCopy(obj)
    new[key] = value
    return new
end

local a = { x = 1, y = 2 }
local b = immutableUpdate(a, "x", 10)
print(a.x)  -- 1 (unchanged)
print(b.x)  -- 10 (new copy)
```

This copy-on-write pattern is structurally related to React/Redux-style immutable
updates in JavaScript. In the TypeScript-Go model, copy-on-write means the original
object's `identity` reads remain valid after the update — the mutation creates a
new object rather than invalidating existing reads.

### 4.3 Metatable-Based Copy-on-Write

A more sophisticated COW pattern uses metatables to defer copying until a write
actually occurs:

```lua
function cowProxy(original)
    local copy = nil
    return setmetatable({}, {
        __index = function(_, k)
            if copy then return copy[k] end
            return original[k]
        end,
        __newindex = function(_, k, v)
            if not copy then
                copy = shallowCopy(original)
            end
            copy[k] = v
        end,
    })
end
```

In this pattern:
- **Reads** before any write delegate to the shared `original` — these are stable
  (`identity`-safe) as long as `original` is not mutated elsewhere
- **The first write** triggers a copy, after which reads go to the private `copy`
- **Subsequent writes** modify the private copy without affecting the original

This maps to a TypeScript-Go type where `identity` holds until the first `mutator`
call, at which point the object transitions to independently-mutated state.

### 4.4 Comparison to TypeScript-Go

| Lua COW Pattern                    | TypeScript-Go Analog             | Key Difference                      |
|------------------------------------|----------------------------------|-------------------------------------|
| `__index` before write             | `identity` read (stable)         | Lua is runtime only                 |
| `__newindex` triggers copy         | `mutator` invalidates            | COW preserves original; mutator doesn't |
| No aliasing awareness              | Alias-sensitive CFA              | Lua has no compile-time aliasing model |
| Manual discipline required         | Type-level enforcement           | TS-Go catches errors at compile time |

---

## 5. R5 Reference Classes — R's Mutable OO System

### 5.1 Reference Semantics in a Copy-on-Modify Language

R is fundamentally a copy-on-modify language: assignments create logical copies, and
the runtime uses reference counting to defer physical copies until a shared value is
actually modified. This is baked into the language — R programmers rarely think
about mutation because assignment semantics hide it:

```r
x <- c(1, 2, 3)
y <- x             # y "copies" x (actually shares via refcount)
y[1] <- 10         # physical copy occurs here; x is unchanged
print(x)           # [1] 1 2 3
print(y)           # [1] 10  2  3
```

Historically, R had no mutable reference types. R5 reference classes (introduced
in R 2.12) broke this pattern by providing objects with **reference semantics**
where mutations are visible through all references:

```r
Counter <- setRefClass("Counter",
    fields = list(
        count = "numeric"
    ),
    methods = list(
        get = function() {
            return(count)
        },
        increment = function() {
            count <<- count + 1  # <<- modifies the field in the enclosing env
        },
        reset = function() {
            count <<- 0
        }
    )
)

c <- Counter$new(count = 0)
c$get()        # 0
c$increment()
c$get()        # 1
```

### 5.2 R5 Fields and `identity`

R5 reference class fields are mutable by default — there is no `readonly` or
`identity` modifier. However, R5 classes support **field accessors** that can
intercept reads and writes:

```r
Validated <- setRefClass("Validated",
    fields = list(
        .value = "numeric"
    ),
    methods = list(
        getValue = function() {
            return(.value)
        },
        setValue = function(v) {
            if (v < 0) stop("Value must be non-negative")
            .value <<- v
        }
    )
)
```

The `getValue()`/`setValue()` pattern mirrors TypeScript-Go's `identity`/`mutator`
split: `getValue()` is a stable read endpoint, `setValue()` is a mutation endpoint
that invalidates knowledge about `getValue()`'s return value. R has no way to
express this relationship in its type system — it relies on naming conventions
(get/set prefixes) and documentation.

### 5.3 R6 Classes (via the R6 Package)

The popular `R6` package provides a more idiomatic OO system with explicit public
and private access:

```r
library(R6)

Person <- R6Class("Person",
    private = list(
        .name = NULL,
        .age = NULL
    ),
    active = list(
        name = function(value) {
            if (missing(value)) return(private$.name)
            if (!is.character(value)) stop("Name must be a string")
            private$.name <- value
        },
        age = function(value) {
            if (missing(value)) return(private$.age)
            if (!is.numeric(value) || value < 0) stop("Age must be non-negative")
            private$.age <- value
        }
    ),
    public = list(
        initialize = function(name, age) {
            self$name <- name
            self$age <- age
        }
    )
)

p <- Person$new("Alice", 30)
p$name          # "Alice" — triggers active binding (read)
p$name <- "Bob" # triggers active binding (write, with validation)
```

R6's `active` bindings are **JavaScript-style getter/setter properties** in R:
the same syntax is used for both reading and writing, and the `value` parameter's
presence distinguishes the two. This is directly analogous to TypeScript's:

```typescript
class Person {
    #name: string;
    get name(): string { return this.#name; }
    set name(value: string) { this.#name = value; }
}
```

### 5.4 Comparison to TypeScript-Go

| R5/R6 Reference Classes           | TypeScript-Go                    | Key Difference                      |
|------------------------------------|----------------------------------|-------------------------------------|
| Field accessor methods             | `identity`/`mutator`             | R by convention; TS-Go by type      |
| R6 `active` bindings               | Getter/setter properties         | Semantically identical              |
| `<<-` super-assignment             | Method mutation                  | R's `<<-` is scope-based            |
| No compile-time type narrowing     | CFA-based narrowing              | R has no narrowing concept          |
| Private fields (R6)                | `#private` fields (TS)           | Both enforce encapsulation          |

---

## 6. Active Bindings — `makeActiveBinding()` for Computed Properties

### 6.1 The Active Binding Mechanism

R provides a low-level mechanism, `makeActiveBinding()`, that makes a name in an
environment evaluate a function on every access. Unlike regular variables, active
bindings are **computed on read**:

```r
env <- new.env(parent = emptyenv())

counter <- 0L
makeActiveBinding("count", function() {
    counter <<- counter + 1L
    counter
}, env)

env$count  # 1
env$count  # 2
env$count  # 3 — different value every time!
```

This demonstrates a critical point: an active binding is **not** `identity`-safe.
Each read produces a different value. This is the R equivalent of a TypeScript
getter that has side effects:

```typescript
class Unstable {
    #counter = 0;
    get count(): number { return ++this.#counter; }
}
```

In TypeScript-Go, this getter should **not** be marked `identity` because it returns
different values on repeated reads. `identity` is a semantic commitment that the
read endpoint is stable — R's `makeActiveBinding()` makes no such commitment.

### 6.2 Stable Active Bindings

Active bindings can also be stable — they can return the same value until the
underlying state changes:

```r
env <- new.env(parent = emptyenv())

.state <- list(value = 42)

makeActiveBinding("value", function() .state$value, env)

env$value  # 42
env$value  # 42 — same value, this IS identity-safe

# External mutation:
.state$value <- 99
env$value  # 99 — changed because .state was mutated
```

Whether an active binding is `identity`-safe depends entirely on its implementation.
R provides no way to distinguish stable bindings from unstable ones at the type
level. TypeScript-Go's `identity` modifier solves this by letting the programmer
explicitly declare stability.

### 6.3 Read/Write Active Bindings

Active bindings can also handle both reads and writes by checking for arguments:

```r
env <- new.env(parent = emptyenv())
.storage <- 0

makeActiveBinding("x", function(value) {
    if (missing(value)) {
        return(.storage)     # read path
    }
    .storage <<- value       # write path
}, env)

env$x       # 0 (read)
env$x <- 5  # (write, through active binding)
env$x       # 5 (read, reflects write)
```

This unified read/write active binding has the same structure as R6's `active` list
and TypeScript's getter/setter pairs. The key difference from TypeScript-Go is that
R treats the binding as a single entity rather than splitting it into separate
`identity` (read) and `mutator` (write) contracts.

### 6.4 Comparison to TypeScript-Go

| R Active Bindings                  | TypeScript-Go                    | Key Difference                      |
|------------------------------------|----------------------------------|-------------------------------------|
| `makeActiveBinding()` (read)       | `identity` getter                | R has no stability guarantee        |
| Active binding (write via `<-`)    | `mutator` setter                 | R provides no invalidation tracking |
| No distinction stable vs unstable  | `identity` modifier              | TS-Go makes stability explicit      |
| Per-binding, per-environment       | Per-member, per-interface        | Similar granularity                 |

---

## 7. Replacement Functions — `<-` Assignment Triggers Custom Functions

### 7.1 The Replacement Function Idiom

R has a distinctive syntactic feature: when you write `foo(x) <- value`, R
translates this into a call to a "replacement function" named `foo<-`:

```r
# Define a replacement function
`name<-` <- function(x, value) {
    x$name <- value
    x  # must return the modified object
}

person <- list(name = "Alice", age = 30)
name(person) <- "Bob"  # desugars to: person <- `name<-`(person, "Bob")
print(person$name)     # "Bob"
```

The sugar `name(person) <- "Bob"` looks like in-place mutation, but it actually
creates a modified copy and rebinds the variable. This is the copy-on-modify
semantics that pervade R.

### 7.2 Replacement Functions as Setter Contracts

Replacement functions are R's closest analog to TypeScript-Go's `mutator` modifier
on setter-like operations. The key difference is semantic: R's replacement functions
**copy** rather than mutate:

```r
# S3 method-style replacement function
`balance<-` <- function(account, value) {
    if (value < 0) stop("Balance cannot be negative")
    account$balance <- value
    account
}

acc <- list(balance = 100)
balance(acc) <- 200  # creates modified copy, rebinds acc
```

In TypeScript-Go terms:
- The function `balance(acc)` (read) would be an `identity` endpoint
- The replacement `balance(acc) <- 200` (write) would be a `mutator` endpoint
- Because R copies rather than mutates, the original `identity` narrowing on the
  old binding `acc` is invalidated by rebinding, not by mutation

### 7.3 Chained Replacement

R allows chaining of replacement functions, which creates a sophisticated
invalidation pattern:

```r
`first<-` <- function(x, value) {
    x[[1]] <- value
    x
}

`second<-` <- function(x, value) {
    x[[2]] <- value
    x
}

data <- list(1, 2, 3)
first(data) <- 10   # invalidates data[[1]], preserves data[[2]] and data[[3]]
second(data) <- 20  # invalidates data[[2]], preserves data[[1]] and data[[3]]
```

Each replacement function invalidates only the portion of the structure it modifies.
This is structurally similar to TypeScript-Go's `links` clause — each `mutator`
specifies which `identity` endpoints it affects:

```typescript
interface DataTuple {
    identity first(): number;
    identity second(): number;
    identity third(): number;
    mutator links(first) setFirst(value: number): void;
    mutator links(second) setSecond(value: number): void;
}
```

R achieves this selectivity through copy semantics (each replacement creates a new
copy that differs only in the replaced part), while TypeScript-Go achieves it through
explicit `links` declarations. The conceptual goal is the same: selective invalidation.

### 7.4 Comparison to TypeScript-Go

| R Replacement Functions            | TypeScript-Go                    | Key Difference                      |
|------------------------------------|----------------------------------|-------------------------------------|
| `foo(x) <- value` syntax          | `x.setFoo(value)` via `mutator`  | R uses copy semantics; TS mutates   |
| Replacement creates modified copy  | `mutator` invalidates in place   | R is safer but more expensive       |
| Chained replacements               | `links` clause                   | Both achieve selective invalidation |
| Automatic variable rebinding       | CFA tracks mutation              | R rebinding is simpler to reason about |

---

## 8. S4 Generics — Multiple Dispatch and Type Checking

### 8.1 The S4 System

R's S4 system is a formal object-oriented framework with:
- Class definitions with typed slots
- Generic functions with multiple dispatch
- Method signatures that match on argument types
- Inheritance and virtual classes

```r
setClass("Shape", representation(
    color = "character"
))

setClass("Circle", representation(
    radius = "numeric"
), contains = "Shape")

setClass("Rectangle", representation(
    width = "numeric",
    height = "numeric"
), contains = "Shape")
```

### 8.2 Generics and Multiple Dispatch

S4 generics dispatch on the runtime type of arguments, similar to TypeScript's
type narrowing but resolved at runtime:

```r
setGeneric("area", function(shape) standardGeneric("area"))

setMethod("area", "Circle", function(shape) {
    pi * shape@radius^2
})

setMethod("area", "Rectangle", function(shape) {
    shape@width * shape@height
})

c <- new("Circle", color = "red", radius = 5)
area(c)  # dispatches to Circle method → 78.54
```

### 8.3 Slot Access and Validity

S4 uses `@` for slot access (analogous to `.` in most languages) and supports
validity checking via `validObject()`:

```r
setValidity("Circle", function(object) {
    if (object@radius <= 0) {
        return("radius must be positive")
    }
    TRUE
})

c <- new("Circle", color = "blue", radius = -1)
# Error: invalid class "Circle" object: radius must be positive
```

Validity checking is a form of write-time enforcement — it ensures that the
object's state satisfies invariants after construction or modification. This is
analogous to TypeScript-Go's type narrowing: both systems want to guarantee that
after a check, certain properties hold. The difference is timing — S4 checks at
runtime on construction/modification, while TypeScript-Go checks at compile time
via CFA.

### 8.4 `setReplaceMethod` — S4 Replacement Methods

S4 extends the replacement function pattern to methods:

```r
setGeneric("name<-", function(x, value) standardGeneric("name<-"))

setReplaceMethod("name", "Shape", function(x, value) {
    x@color <- value
    validObject(x)
    x
})
```

This combines type-dispatched writes with validity checking — the S4 system ensures
that replacement methods are dispatched correctly by type and that the resulting
object satisfies its validity constraints.

### 8.5 Comparison to TypeScript-Go

| S4 System                          | TypeScript-Go                    | Key Difference                      |
|------------------------------------|----------------------------------|-------------------------------------|
| Typed slots (`representation()`)   | Typed properties                 | Both enforce types on members       |
| Multiple dispatch generics         | Overloaded methods               | S4 dispatches on all args; TS on `this` |
| Validity checking                  | Type narrowing via CFA           | S4 is runtime; CFA is compile-time  |
| `setReplaceMethod`                 | `mutator` method                 | S4 adds dispatch; TS-Go adds links  |
| Formal class hierarchy             | Structural typing                | S4 is nominal; TS is structural     |

---

## 9. Cross-Language Patterns — What Do Lua and R Teach?

### 9.1 The Fundamental Read/Write Contract Problem

Both Lua and R, despite their vastly different designs, encounter the same
fundamental problem that TypeScript-Go's `identity`/`mutator`/`links` system
addresses:

1. **Reads can be intercepted** (Lua `__index`, R active bindings, R replacement
   function reads) — and some intercepted reads are stable while others are not.

2. **Writes can be intercepted** (Lua `__newindex`, R replacement functions, R6
   active binding writes) — and some writes invalidate all reads while others
   invalidate only specific reads.

3. **Neither language's type system can distinguish stable reads from unstable
   reads**, or selective invalidation from total invalidation.

### 9.2 Convention vs Declaration

Both languages rely on **convention** rather than **declaration** for read/write
contracts:

| Pattern                         | Lua Convention                    | R Convention                      |
|---------------------------------|-----------------------------------|-----------------------------------|
| Stable read                     | Named `get*` function             | Named `get*` method or `@` access |
| Mutation                        | Named `set*` function             | Replacement function `foo<-`      |
| Selective invalidation          | Module design separating state    | Chained replacement targets       |
| Read-only object                | Error-throwing `__newindex`       | Locked environment/binding        |

TypeScript-Go replaces these conventions with **first-class type annotations**:
`identity`, `mutator`, and `links`. This is a general principle: as languages
evolve from dynamic to gradually typed, the conventions that programmers already
follow should become expressible in the type system.

### 9.3 Copy Semantics vs Reference Semantics

R's copy-on-modify semantics provide an interesting alternative model for reasoning
about identity stability:

- In R, when you "modify" a value, you actually create a new binding to a new
  copy. The old binding still refers to the old value. This means `identity`-like
  stability is **automatic** for the old reference.

- In TypeScript (and Lua), mutation happens in place. The old reference now points
  to modified data. This means `identity` stability must be **declared** because the
  type system cannot know whether a function mutates shared state.

R's copy semantics are safer for narrowing but more expensive at runtime. TypeScript-Go's
approach — keeping reference semantics but adding `identity`/`mutator` annotations —
gives the same safety guarantees at compile time without the runtime copy overhead.

### 9.4 The Metatable/Active-Binding Principle

Both Lua's metatables and R's active bindings demonstrate the same principle:
**intercepted property access creates a need for stability annotations**. When a
"read" is not a simple memory load but a function call, the type system needs
additional information to know whether re-reading will produce the same result.

This is exactly the problem that `identity` solves. Any language that supports
computed properties (JavaScript getters, Lua metatables, R active bindings, C#
properties, Kotlin properties with custom getters) faces this problem. Most solve it
by not narrowing through computed reads at all — TypeScript-Go's `identity` modifier
is a more nuanced solution that allows narrowing when the programmer asserts stability.

### 9.5 Progressive Complexity

Both languages show a **progressive complexity** pattern that mirrors TypeScript-Go's
tiered approach:

| Complexity Level | Lua                                  | R                             | TypeScript-Go            |
|------------------|--------------------------------------|-------------------------------|--------------------------|
| Simple           | Direct table field access            | Direct variable access        | Direct property access   |
| Intermediate     | `__index` metatable override         | Active binding (stable)       | `identity` getter        |
| Complex          | Proxy with selective `__newindex`     | Chained replacement functions | `mutator links(...)` |
| Full contract    | Module pattern with closure state    | R6 class with active bindings | Full `identity`/`mutator`/`links` interface |

---

## 10. Alternative Syntax Ideas from Lua and R

### 10.1 Lua's Metatable Declaration Pattern

Lua's metatable syntax suggests a **declaration-site contract** pattern:

```lua
local mt = {
    __index = readHandler,
    __newindex = writeHandler,
}
```

This cleanly separates the read contract from the write contract at the point of
table creation. A TypeScript-Go analog might be a more compact syntax for declaring
the entire read/write contract at once:

```typescript
// Current TypeScript-Go syntax (verbose):
interface Signal<T> {
    identity value(): T;
    mutator links(value) setValue(v: T): void;
}

// Hypothetical metatable-inspired compact syntax:
interface Signal<T> {
    identity value(): T;
    mutator(value) setValue(v: T): void;  // links inferred from position
}
```

The Lua pattern suggests that since read and write handlers are naturally paired,
the `links` clause might be inferable from context or position rather than requiring
an explicit clause.

### 10.2 R's Replacement Function Naming Convention

R's replacement function syntax (`foo<-`) uses a **naming convention** to pair
reads with writes:

```r
name(x)         # read
name(x) <- "v"  # write
```

A TypeScript-Go analog could allow the compiler to infer `links` relationships
from naming patterns:

```typescript
interface Person {
    identity name(): string;
    mutator setName(v: string): void;  // auto-links to name() via set+Name convention
}
```

This would reduce annotation burden for common patterns while still requiring
explicit `links` for non-conventional pairings.

### 10.3 R6's Unified Active Binding Pattern

R6's active bindings use a single function for both reads and writes, distinguished
by whether an argument is provided:

```r
active = list(
    name = function(value) {
        if (missing(value)) return(private$.name)
        private$.name <- value
    }
)
```

This suggests a unified TypeScript-Go syntax for simple get/set pairs:

```typescript
interface Counter {
    // Active-binding style: identity read, mutator write, auto-linked
    active count: number;  // expands to identity get + mutator set
}
```

This hypothetical `active` modifier would be syntactic sugar for the common case
of a get/set pair where the write invalidates the read. It would reduce boilerplate
for the primary use case while preserving the full `identity`/`mutator`/`links`
syntax for complex scenarios.

### 10.4 Lua's `rawget`/`rawset` — Bypass Mechanism

Lua's `rawget()` and `rawset()` functions bypass metatable interception entirely.
This suggests a useful pattern for TypeScript-Go: there may be cases where code
needs to "bypass" the `identity`/`mutator` contract for performance or internal
implementation reasons. However, TypeScript-Go's compile-time approach makes this
less necessary — the contract is a type-level assertion, not a runtime mechanism,
so there is no runtime overhead to bypass.

---

## Summary: Lua & R ↔ TypeScript-Go Comparison

| Feature                       | Lua                                      | R                                        | TypeScript-Go                          |
|-------------------------------|------------------------------------------|------------------------------------------|----------------------------------------|
| Read interception             | `__index` metamethod                     | Active bindings, S4 slot access          | `identity` modifier                    |
| Write interception            | `__newindex` metamethod                  | Replacement functions, `<<-`             | `mutator` modifier                     |
| Selective invalidation        | Module design (implicit)                 | Chained replacement (implicit)           | `links` clause (explicit)              |
| Stability declaration         | None (convention only)                   | None (convention only)                   | `identity` (type-level)                |
| Mutation tracking             | None                                     | Copy-on-modify (implicit tracking)       | `mutator` (explicit tracking)          |
| Type-level checking           | Teal (basic narrowing)                   | S4 validity (runtime only)               | CFA narrowing (compile-time)           |
| Deep immutability             | Recursive readonly proxy (manual)        | Frozen environments                      | `Readonly<T>` + `identity`             |
| Computed properties           | `__index` function                       | `makeActiveBinding()`                    | Getter methods                         |
| Read/write pairing            | Metatable declaration                    | `name()`/`name<-()` convention           | `identity`/`mutator links(...)`        |

### Key Takeaways

1. **The read/write interception problem is universal**: Lua's `__index`/`__newindex`
   and R's `makeActiveBinding()` solve the same problem as TypeScript getters/setters.
   All three need a way to declare read stability for downstream reasoning.

2. **Convention-based contracts are the norm; TypeScript-Go's type-level contracts
   are the exception**: Both Lua and R rely on naming conventions and module design
   to communicate read/write semantics. TypeScript-Go's `identity`/`mutator`/`links`
   annotations promote these conventions to first-class type system features.

3. **R's copy semantics validate `identity`'s design**: R's copy-on-modify model
   gives automatic `identity`-like stability by copying on mutation. TypeScript-Go
   achieves the same guarantee at compile time without the copy overhead — this
   confirms that `identity` stability is a real semantic need, not an arbitrary
   annotation.

4. **Selective invalidation (`links`) has no analog in either language**: Neither
   Lua nor R can express "this write invalidates this read but not that read" in
   their type systems, though both achieve it by convention (Lua module patterns,
   R chained replacement). `links` is a genuine innovation.

5. **The unified active-binding pattern suggests syntax simplification**: R6's
   single-function active binding for get/set pairs suggests that TypeScript-Go
   could benefit from an `active`-like sugar for the common case of paired
   `identity`/`mutator` endpoints.

6. **Metatables and active bindings show that untypeable interceptors are a
   liability**: Teal cannot type-check Lua metatables; R has no compile-time
   checking for active bindings. TypeScript-Go's approach of making interception
   visible to the type system is the right design for a gradually-typed language.
