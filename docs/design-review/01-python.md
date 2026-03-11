# Cross-Language Design Review: Python's Approach to Type Narrowing, Mutable State, and Read/Write Contracts

**Context:** TypeScript-Go has introduced `identity`/`mutator`/`links` modifiers for callable getter narrowing and selective invalidation. This document analyzes how Python's type system addresses the same class of problems and what TypeScript can learn from Python's approach.

---

## 1. TypeGuard and TypeIs — User-Defined Narrowing

### 1.1 TypeGuard (PEP 647, Python 3.10)

Python's `TypeGuard` allows user-defined functions to participate in type narrowing:

```python
from typing import TypeGuard

def is_str_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)

def process(val: list[object]) -> None:
    if is_str_list(val):
        reveal_type(val)  # list[str]
    else:
        reveal_type(val)  # list[object] — NO narrowing in else branch
```

**Key characteristics:**
- Narrowing applies only in the positive (`if`) branch — the `else` branch retains the original type.
- The narrowed type replaces the original type entirely (no intersection).
- Not strict: `TypeGuard[int]` is allowed even when narrowing from `str` (unsound by design, for flexibility).
- Narrowing targets only the **first positional argument**.

### 1.2 TypeIs (PEP 742, Python 3.13)

`TypeIs` was introduced to fix `TypeGuard`'s limitations:

```python
from typing import TypeIs

def is_str(x: object) -> TypeIs[str]:
    return isinstance(x, str)

def process(x: int | str) -> None:
    if is_str(x):
        reveal_type(x)  # str
    else:
        reveal_type(x)  # int — narrowing in BOTH branches
```

**Key improvements over TypeGuard:**
- Narrows in both `if` and `else` branches (intersection semantics: `A ∧ R` for positive, `A ∧ ¬R` for negative).
- Requires `R` to be assignable to input type `I` (stricter, prevents unsound narrowing).
- Invariant in its argument type: `TypeIs[bool]` is not a subtype of `TypeIs[int]`.
- Combines pre-existing type knowledge with the guard type.

### 1.3 Comparison with `identity`

| Dimension | Python TypeGuard/TypeIs | TypeScript `identity` |
|---|---|---|
| **What it narrows** | Single value checked by a boolean predicate | Return value of repeated calls to the same callable |
| **Narrowing mechanism** | Conditional branch after a type-checking call | CFA reuse of narrowed facts across repeated reads |
| **Invalidation** | Implicit — any reassignment ends the narrowing | Explicit via `mutator`/`links` or heuristic tiers |
| **Declaration site** | On the type guard function itself | On the callable getter's type signature |
| **Soundness model** | TypeGuard is unsound by design; TypeIs is strict | identity is conservative by default with tiered preserves |

**Key insight:** TypeGuard/TypeIs and `identity` solve fundamentally different problems:
- TypeGuard/TypeIs: "Did a user-defined check confirm this value's type?" (one-shot predicate)
- `identity`: "Can I trust that calling this getter again returns the same narrowed type?" (stable read endpoint)

Python has **no equivalent** to `identity`'s repeated-read narrowing. In Python, each function call is a fresh expression — mypy and pyright do not carry narrowing forward across repeated calls to the same function, even for `@property` getters (with exceptions noted below).

---

## 2. @property Decorator — Python's Getter/Setter

### 2.1 Mechanism

Python's `@property` is the idiomatic way to define getter/setter pairs:

```python
class Store:
    def __init__(self) -> None:
        self._user: User | None = None

    @property
    def user(self) -> User | None:
        return self._user

    @user.setter
    def user(self, value: User | None) -> None:
        self._user = value
```

### 2.2 How mypy/pyright Narrow Through Properties

**Mypy's behavior with properties:**

```python
store = Store()
if store.user is not None:
    # mypy narrows store.user to User here
    store.user.name  # OK
    
    some_function()  # Does NOT invalidate property narrowing (with caveats)
    
    store.user = None  # Direct assignment DOES invalidate
    store.user.name  # Error: possibly None
```

**Critical finding:** mypy *does* narrow through `@property` reads, treating them somewhat like attribute access. However:
- Any assignment to the property invalidates the narrowing (obvious).
- Method calls on the same object *may* invalidate narrowing depending on the checker and the method's visibility into the backing attribute.
- Neither mypy nor pyright supports narrowing through bare function calls (`get_user()`) — only through property/attribute access patterns (`obj.user`).

### 2.3 The Asymmetry Problem

Python's `@property` creates an implicit read/write contract:
- If only `@property` getter is defined: the attribute is read-only.
- If both getter and setter are defined: the attribute is read-write.

But there is **no way to express selective invalidation** — Python has no equivalent to `links`. When you write to *any* property/attribute on an object, type checkers conservatively invalidate related narrowings.

### 2.4 Comparison with `identity`

| Dimension | Python @property | TypeScript `identity` |
|---|---|---|
| **Syntax** | Decorator on methods | Modifier on function type |
| **Read-only expressible?** | Yes (omit setter) | Yes (omit `mutator`) |
| **Selective invalidation?** | No | Yes, via `links` clause |
| **Callable getter support?** | No — properties are accessed as attributes, not called | Yes — designed for `signal()` / `computed()` patterns |
| **Narrowing persistence** | Until attribute reassignment or scope exit | Until mutator call, unknown call, or uncertainty boundary |

**Key insight:** Python's @property narrowing works because properties look like attribute access, which type checkers already know how to narrow. TypeScript's `identity` is necessary precisely because signals are *callable* — they look like function calls, which type checkers treat as opaque by default.

---

## 3. Protocol and Structural Typing — Interface-Level Read/Write Contracts

### 3.1 Read-Only via @property in Protocols

Python's `Protocol` class supports read/write contract separation at the interface level:

```python
from typing import Protocol

class Readable(Protocol):
    @property
    def value(self) -> int: ...  # Read-only: no setter defined

class ReadWrite(Protocol):
    value: int  # Mutable attribute: both readable and writable

class Impl:
    value: int = 42

x: Readable = Impl()    # OK — Impl satisfies read-only interface
y: ReadWrite = Impl()   # OK — Impl satisfies read-write interface
```

### 3.2 Variance and Protocol Attributes

Protocol attributes have **invariance** implications:

```python
class Box(Protocol):
    content: object  # Mutable → invariant

class IntBox:
    content: int

def takes_box(box: Box) -> None: ...
takes_box(IntBox())  # ERROR: int is not object (invariance)
```

**Fix: use @property to make it covariant (read-only):**

```python
class Box(Protocol):
    @property
    def content(self) -> object: ...  # Read-only → covariant

class IntBox:
    content: int

takes_box(IntBox())  # OK: int is assignable to object
```

### 3.3 Comparison with TypeScript Interfaces

TypeScript already has `readonly` on interface properties:

```typescript
interface Box {
    readonly content: object;  // Covariant-ish
}
```

But TypeScript lacks a way to express the same read-only/read-write distinction for *callable* getters. This is exactly what `identity`/`mutator` provides:

```typescript
interface Store {
    identity user(): User | undefined;          // Read-only callable
    mutator setUser(v: User) links user;        // Write that targets user
}
```

**Key insight:** Python uses `@property` in `Protocol` to separate read/write contracts. TypeScript uses `readonly` for properties but needs `identity`/`mutator` for the callable getter pattern. The conceptual model is the same — distinguishing reads from writes at the type level — but the mechanism differs because of the syntactic difference between property access and function calls.

---

## 4. Frozen Dataclasses and NamedTuple — Immutability as Alternative

### 4.1 Frozen Dataclasses

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: float
    y: float

p = Point(1.0, 2.0)
p.x = 3.0  # ERROR: FrozenInstanceError at runtime, type error statically
```

Frozen dataclasses guarantee:
- All fields are effectively `readonly` after construction.
- No mutation invalidation needed — narrowed types are stable forever.
- Frozen dataclasses cannot inherit from non-frozen ones (structural soundness).

### 4.2 NamedTuple

```python
from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float

p = Point(1.0, 2.0)
p.x = 3.0  # ERROR: tuples are immutable
```

NamedTuples are structurally immutable — all fields are read-only by default.

### 4.3 Relevance to `identity`

Python's approach here is "make everything immutable, then narrowing is trivially safe." This is the **opposite** of TypeScript's approach:

| Strategy | Python (frozen) | TypeScript (`identity`) |
|---|---|---|
| **Philosophy** | Prevent mutation | Track mutation |
| **Annotation burden** | One annotation per class (`frozen=True`) | One modifier per method (`identity`, `mutator`) |
| **Flexibility** | None — truly immutable | High — selective invalidation via `links` |
| **Applicability** | Only works for fully immutable data | Works for reactive/signal APIs with mutable state |

**Key insight:** Immutability sidesteps the narrowing invalidation problem entirely but is too restrictive for signal/reactive APIs where mutation is the whole point. TypeScript's `identity`/`mutator` is a more nuanced solution that works with mutation rather than forbidding it.

---

## 5. Descriptor Protocol — Low-Level Read/Write Separation

### 5.1 Mechanism

Python's descriptor protocol provides the lowest-level read/write separation:

```python
class TypedDescriptor:
    def __get__(self, obj, objtype=None) -> int:
        return obj._value

    def __set__(self, obj, value: int) -> None:
        if not isinstance(value, int):
            raise TypeError("Expected int")
        obj._value = value

    def __delete__(self, obj) -> None:
        del obj._value

class MyClass:
    attr = TypedDescriptor()
```

### 5.2 Type Checker Treatment

- `__get__` return type determines the read type.
- `__set__` parameter type determines the write type.
- `__delete__` presence determines deletability.

Mypy handles descriptor types in protocol contexts:

```python
class Integer:
    @overload
    def __get__(self, instance: None, owner: object) -> "Integer": ...
    @overload
    def __get__(self, instance: object, owner: object) -> int: ...
    def __set__(self, instance: object, value: int) -> None: ...

class Example(Protocol):
    bar: Integer  # Protocol sees this as the raw descriptor type
```

### 5.3 Comparison with `identity`/`mutator`

| Dimension | Python Descriptors | TypeScript `identity`/`mutator` |
|---|---|---|
| **Granularity** | Per-attribute | Per-method |
| **Read type** | `__get__` return type | `identity` return type |
| **Write type** | `__set__` parameter type | `mutator` parameter type |
| **Cross-attribute invalidation** | Not expressible | `links` clause |
| **Type checker support** | Good for basic types, limited for narrowing flow | Full CFA integration with tiered heuristics |

**Key insight:** Python descriptors provide type-level read/write separation but don't participate in control flow narrowing at all. `__get__` and `__set__` tell the type checker *what types* to expect, not *how narrowing should flow*. TypeScript's `identity`/`mutator` operates at a higher level — it's about narrowing *flow*, not just type compatibility.

---

## 6. mypy/pyright Narrowing After Method Calls and Mutable State

### 6.1 Current Behavior

**mypy's narrowing invalidation rules:**

```python
class Container:
    value: int | str

    def mutate(self) -> None:
        self.value = "changed"

    def readonly(self) -> int:
        return 42

c = Container()
c.value = 42

if isinstance(c.value, int):
    reveal_type(c.value)  # int

    c.readonly()           # mypy does NOT invalidate narrowing here
    reveal_type(c.value)  # still int

    c.mutate()             # mypy does NOT invalidate narrowing here either!
    reveal_type(c.value)  # still int — UNSOUND!
    
    c.value = "oops"       # Direct assignment DOES invalidate
    reveal_type(c.value)  # int | str
```

**Critical finding:** mypy is **unsound** with respect to method-call invalidation. It only invalidates narrowing on direct assignment, not on method calls that might mutate state. This is a deliberate trade-off for usability — being too conservative would make the type checker annoying.

**pyright's behavior is similar** — it also doesn't invalidate attribute narrowing after arbitrary method calls, though it may be slightly more conservative in some edge cases.

### 6.2 Implications for TypeScript

Python type checkers have implicitly adopted a "trust the programmer" philosophy:
- Direct assignments invalidate narrowing.
- Method calls do not invalidate narrowing (even when they should).
- There is no mechanism to declare that a method is a "mutator."

This is the **exact gap** that TypeScript's `mutator`/`links` fills. Without explicit mutation tracking, Python type checkers choose between:
1. **Too conservative:** Invalidate on any method call → annoying, lots of false positives.
2. **Too permissive:** Never invalidate on method calls → unsound, potential runtime errors.

Python chose option 2. TypeScript's `identity`/`mutator`/`links` provides a **third option**: let the declaration express which calls invalidate which narrowings, achieving both soundness and usability.

### 6.3 No Python Equivalent to `links`

Python has absolutely no mechanism for selective invalidation. There is no way to say "calling `set_user()` invalidates narrowing on `user` but not on `settings`." This is arguably the most novel aspect of TypeScript's `links` clause — it has no precedent in any mainstream type system.

---

## 7. Alternative Syntax Proposals — Lessons from Python

### 7.1 Could Python's Patterns Simplify identity/mutator?

**Decorator approach (Python-inspired):**

```typescript
// Hypothetical: using JSDoc-style annotations instead of keywords
/** @identity */
declare function user(): User | undefined;

/** @mutator @links(user) */
declare function setUser(v: User): void;
```

**Verdict:** TypeScript's keyword approach (`identity`, `mutator`) is superior to decorators because:
- Keywords participate in the type system grammar (parseable, checkable).
- JSDoc annotations are stringly-typed and harder to validate.
- Python's own experience shows that decorator-based type narrowing proposals were rejected in favor of return-type annotations (PEP 647 rejected decorator syntax for TypeGuard).

### 7.2 Could a Simpler Two-State Model Work?

Python effectively has a two-state model: `@property` (read) and `@property.setter` (write). Could TypeScript use something similar?

```typescript
// Hypothetical: property-like approach
interface Store {
    get user(): User | undefined;     // Already exists in TypeScript
    set user(v: User | undefined);    // Already exists
}
```

**Problem:** This doesn't help with callable getters (`signal()` pattern). TypeScript already narrows through getter/setter properties. The `identity` modifier exists specifically for the case where the "getter" is a function call, not a property access.

### 7.3 Python's "Frozen" Pattern as Inspiration

Could TypeScript support a blanket "all getters on this interface are stable" modifier?

```typescript
// Hypothetical: frozen/stable interface modifier
stable interface Store {
    user(): User | undefined;      // Implicitly identity
    settings(): Settings;          // Implicitly identity
    setUser(v: User): void;        // Implicitly mutator (non-identity)
}
```

**Trade-off analysis:**
- **Pro:** Reduces per-method annotation burden for interfaces where all getters are stable.
- **Con:** Loses the fine-grained `links` capability — which methods invalidate which getters?
- **Con:** Ambiguous for methods that are partial mutators or that read but have side effects.
- **Verdict:** Could work as syntactic sugar on top of `identity`/`mutator`/`links`, but not as a replacement.

### 7.4 TypeIs-Inspired Approach

Could we use a return-type annotation (like TypeIs) instead of a method modifier?

```typescript
// Hypothetical: StableReturn<T> wrapper type
declare function user(): StableReturn<User | undefined>;
```

**Problems:**
- `StableReturn<T>` would need to be unwrapped at every call site.
- Doesn't compose well with existing function type syntax.
- Doesn't provide a place to hang `links` metadata.
- TypeScript's `identity` as a modifier is more natural than a wrapper type because it's a property of the *callable*, not its return value.

### 7.5 Conclusion: TypeScript's Approach is More Expressive

Python's patterns (TypeGuard/TypeIs, @property, Protocol, frozen, descriptors) each address a piece of the puzzle but none provides the full solution that `identity`/`mutator`/`links` offers:

| Python Pattern | What It Solves | What It Misses |
|---|---|---|
| TypeGuard/TypeIs | One-shot predicate narrowing | Repeated-read narrowing, callable getters |
| @property | Getter/setter syntax, basic narrowing | Callable getters, selective invalidation |
| Protocol + @property | Read-only interface contracts | Mutation tracking, callable getters |
| frozen dataclass | Immutability = safe narrowing | Mutable reactive APIs (signals) |
| Descriptors | Type-level read/write separation | CFA integration, selective invalidation |
| mypy/pyright behavior | Pragmatic unsoundness | No mutation tracking at all |

---

## 8. Summary: What TypeScript Can Learn from Python

### 8.1 Strengths Python Demonstrates

1. **Simplicity wins initially.** Python's "just use @property" approach is simple and covers 80% of cases. TypeScript should ensure `identity` is the common case and `mutator`/`links` the uncommon one.

2. **Unsoundness is sometimes acceptable.** mypy's choice to not invalidate on method calls shows that practical type checkers must balance soundness against usability. TypeScript's tiered heuristic approach (Tier 1/2/3 confidence levels) aligns with this philosophy while providing an escape hatch via explicit contracts.

3. **Separate read and write types are valuable.** Python's descriptor protocol and Protocol's @property demonstrate that the community finds value in distinguishing read and write contracts — even when the tooling doesn't fully exploit it for narrowing.

### 8.2 Gaps TypeScript's Approach Fills

1. **Callable getter narrowing.** Python has no solution for `signal()` / `computed()` patterns where values are accessed via function calls. `identity` directly addresses this.

2. **Selective invalidation.** `links` is genuinely novel — no Python mechanism can express "calling X invalidates narrowing on Y but not Z."

3. **Explicit mutation tracking.** `mutator` provides what Python type checkers lack — a way to declare intent to mutate, enabling sound narrowing without conservative over-invalidation.

### 8.3 Risks to Watch

1. **Annotation fatigue.** Python developers already complain about the proliferation of typing special forms (TypeGuard vs TypeIs vs assert_type vs...). TypeScript should be cautious about adding too many modifiers. The three-modifier system (`identity`/`mutator`/`links`) should be the ceiling, not the floor.

2. **Heuristic complexity.** Python's approach is simple because it doesn't try to be sound. TypeScript's tiered heuristics add complexity. If the heuristics are hard to predict, developers may prefer Python's pragmatic approach of "just trust the programmer."

3. **Ecosystem adoption.** Python's TypeGuard/TypeIs experience (years of TypeGuard before TypeIs was added) shows that the first version of a narrowing mechanism will reveal design flaws. Phase 1's conservative core is a wise approach — ship the simple version, learn from real-world usage, then refine.

### 8.4 Final Assessment

TypeScript's `identity`/`mutator`/`links` system is **more expressive and more sound** than anything in Python's type system for this class of problems. Python's approach is **simpler but less capable** — it works for attribute-based patterns but has no answer for callable getter APIs.

The most important lesson from Python: **the absence** of callable getter narrowing is a real pain point. Angular (Python's ecosystem equivalent: FastAPI, Django) struggles with the same signal patterns. Python's type system has no solution, which validates that TypeScript's approach is addressing a genuine need that cross-cuts language boundaries.
