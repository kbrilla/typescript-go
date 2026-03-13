# Design Review: Ruby's Type Checking, Frozen Objects, and Read/Write Contracts vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Ruby's approach to immutability, read/write access declarations, and gradual type checking with TypeScript-Go's identity CFA system

---

## 1. `attr_reader`/`attr_writer`/`attr_accessor` — Declarative Read/Write Contracts

### Ruby's Model

Ruby uses metaprogramming macros to generate getter/setter methods from instance variable names:

```ruby
class Person
  attr_reader   :name    # generates def name; @name; end
  attr_writer   :age     # generates def age=(val); @age = val; end
  attr_accessor :email   # generates both getter and setter
end

p = Person.new
p.name            # read-only: stable identity — always returns @name
p.age = 25        # write-only: mutates internal state
p.email           # read: returns @email
p.email = "a@b.c" # write: sets @email
```

The generated methods are trivial — they return or set the corresponding instance variable. Ruby's `attr_reader` declares a **stable read endpoint**: the method always returns whatever the instance variable currently holds, with no side effects. `attr_writer` declares a **mutation endpoint**: calling it changes internal state.

### Comparison with `identity`/`mutator`

| Aspect | Ruby `attr_reader`/`attr_writer` | TypeScript-Go `identity`/`mutator` |
|--------|----------------------------------|-------------------------------------|
| **Semantics** | Generates trivial getter/setter methods | Annotates existing methods with behavioral contracts |
| **Read stability** | `attr_reader` always returns `@var` — stable by construction | `identity` asserts same-type-on-repeated-calls — stable by declaration |
| **Mutation** | `attr_writer` generates `var=(val)` — writes by construction | `mutator` asserts the call invalidates narrowing of linked identities |
| **Granularity** | Per-instance-variable | Per-callable |
| **Override** | Can be overridden in subclasses (no stability guarantee after override) | Contract inherited but not structurally enforced |
| **Both read/write** | `attr_accessor` — single macro generates both | Separate `identity`/`mutator` — cannot combine on same callable |

The key insight: Ruby's `attr_reader` is **trivially stable** because the generated method body is just `@name` — there's no computation, no dispatch, no side effect. TypeScript-Go's `identity` makes a stronger claim (type remains consistent across calls) on potentially complex methods.

### Custom Getters vs `attr_reader`

Ruby developers often replace `attr_reader` with custom methods:

```ruby
class LazyPerson
  def name
    @name ||= compute_name  # memoized — first call computes, subsequent calls return cached
  end
end
```

This is analogous to a method that *could* be `identity` — after the first call, it returns a stable value. But Ruby has no way to express this contract. The `attr_reader` macro is all-or-nothing: either you use the trivial getter, or you write a custom method with no declared semantics.

TypeScript-Go's `identity` is more expressive here — it can be applied to any callable, including memoized getters, computed properties, and factory methods.

---

## 2. `freeze` and `frozen?` — Runtime Immutability

### Ruby's Model

Ruby provides a runtime mechanism to make objects immutable:

```ruby
str = "hello"
str.freeze

str.frozen?       # => true
str << " world"   # RuntimeError: can't modify frozen String
str.upcase!       # RuntimeError: can't modify frozen String
str.upcase        # OK — returns new String, doesn't modify original
```

`freeze` is **deep for the object, shallow for references**:

```ruby
arr = ["a", "b", "c"]
arr.freeze

arr << "d"        # RuntimeError: can't modify frozen Array
arr[0] << "!"     # OK! — the Array is frozen, but its String elements are not
arr[0]            # => "a!" — the element was mutated
```

### Frozen String Literals

Ruby 3+ supports a pragma to freeze all string literals at the source level:

```ruby
# frozen_string_literal: true

str = "hello"
str.frozen?       # => true
str << " world"   # RuntimeError
```

This is a **compile-time opt-in** for a runtime guarantee — the string object is allocated as frozen.

### Comparison with TypeScript-Go

| Aspect | Ruby `freeze` | TypeScript-Go `identity` |
|--------|--------------|------------------------|
| **When** | Runtime enforcement | Type-checking time (static analysis) |
| **Scope** | Any object | Callable return types |
| **Depth** | Shallow — only the frozen object, not its references | Type-level — return type consistency, not deep immutability |
| **Override** | Cannot unfreeze (no `unfreeze` method) | `mutator` explicitly invalidates narrowing |
| **Error mode** | RuntimeError exception | Type error / narrowing loss |
| **Use case** | Prevent all mutation of an object | Prevent narrowing invalidation from unrelated calls |

Ruby's `freeze` is **broader** (prevents any mutation) but **shallower** (only the immediate object). TypeScript-Go's `identity` is **narrower** (only claims type stability) but **compositional** (works with the CFA system for narrowing across control flow).

### `frozen?` as a Type Guard

An interesting parallel: `frozen?` can be used as a conditional guard in Ruby, similar to how type narrowing works:

```ruby
def process(obj)
  if obj.frozen?
    # Safe to cache — won't be mutated
    @cache[obj.object_id] = obj
  else
    # Must duplicate to avoid aliasing issues
    @cache[obj.object_id] = obj.dup.freeze
  end
end
```

In TypeScript-Go terms, `frozen?` acts as a runtime discriminator that separates "stable" from "potentially unstable" references — but Ruby's type system (even with Sorbet) doesn't narrow types based on `frozen?`.

---

## 3. Sorbet Type Checker — Flow-Sensitive Typing for Ruby

### Sorbet's Model

[Sorbet](https://sorbet.org/) is Stripe's gradual type checker for Ruby. It adds static type checking on top of Ruby's dynamic type system:

```ruby
# typed: strict
extend T::Sig

sig { params(x: T.nilable(String)).returns(Integer) }
def length_or_zero(x)
  if x.nil?
    0
  else
    x.length  # narrowed to String
  end
end
```

### Flow-Sensitive Narrowing

Sorbet performs flow-sensitive type narrowing similar to TypeScript:

```ruby
# typed: strict
extend T::Sig

sig { params(x: T.any(String, Integer)).void }
def process(x)
  case x
  when String
    puts x.upcase    # x narrowed to String
  when Integer
    puts x + 1       # x narrowed to Integer
  end
end
```

Narrowing works with:
- `is_a?` / `kind_of?` checks
- `nil?` checks
- `case`/`when` exhaustive matching
- `T.let` / `T.cast` explicit assertions

### T.nilable and Narrowing Invalidation

```ruby
sig { params(x: T.nilable(String)).void }
def example(x)
  return if x.nil?
  # x is narrowed to String here
  
  some_method()  # Does this invalidate narrowing?
  
  x.length       # Sorbet: still narrowed — local variables are stable
end
```

Sorbet **does not invalidate local variable narrowing** across arbitrary method calls — this mirrors TypeScript's behavior for local variables. The narrowing is considered safe because local variables in Ruby (like TypeScript) are not aliased by reference.

### Where Sorbet Lacks Expressiveness

Sorbet has no concept analogous to `identity`/`mutator`:

```ruby
# typed: strict
extend T::Sig

class Container
  extend T::Sig
  
  sig { returns(T.any(String, Integer)) }
  def value
    @value
  end
  
  sig { params(v: T.any(String, Integer)).void }
  def value=(v)
    @value = v
  end
end

sig { params(c: Container).void }
def process(c)
  if c.value.is_a?(String)
    # Sorbet does NOT narrow c.value to String here
    # because c.value is a method call, not a variable
    c.value.upcase  # ERROR: method 'upcase' does not exist on T.any(String, Integer)
  end
end
```

Sorbet treats every method call as potentially returning a different type — there's no way to tell Sorbet "this getter is stable." This is exactly the problem `identity` solves in TypeScript-Go.

### Comparison with TypeScript-Go

| Aspect | Sorbet | TypeScript-Go |
|--------|--------|---------------|
| **Local variable narrowing** | Supported, stable across calls | Supported, stable across calls |
| **Property/getter narrowing** | Not supported | Supported with `identity` |
| **Explicit invalidation** | Not needed (method calls never narrow) | `mutator` explicitly invalidates |
| **Selective invalidation** | N/A | `links` targets specific identities |
| **Gradual typing** | `# typed: false/true/strict/strong` | Strict mode, JSDoc annotations |
| **Union discrimination** | `case`/`when`, `is_a?`, `nil?` | Type guards, discriminated unions, `identity` narrowing |

---

## 4. RBS Type Signatures — Ruby's Official Type Language

### RBS Syntax

RBS (Ruby Signature) is Ruby's official type description language (separate from Sorbet's inline annotations):

```rbs
class Person
  attr_reader name: String
  attr_writer age: Integer
  attr_accessor email: String

  def greet: (String name) -> String
  def process: (String | Integer value) -> void
end
```

### Could RBS Express `identity`/`mutator`?

RBS currently has no mechanism for behavioral modifiers on methods. Hypothetically, it could be extended:

```rbs
# Hypothetical RBS extensions
class Container
  # identity: return type is stable across repeated calls  
  %identity attr_reader value: String | Integer
  
  # mutator: calling this invalidates narrowing of value
  %mutator def set_value: (String | Integer v) -> void
  
  # links: selective invalidation
  %mutator %links(value) def update_value: (String | Integer v) -> void
end
```

### Challenges

1. **RBS is purely declarative** — it describes types, not behavioral contracts. Adding `identity`/`mutator` would require extending RBS beyond type descriptions into semantic annotations.

2. **RBS is separate from code** — it lives in `.rbs` files, not inline. This makes it harder to keep behavioral contracts in sync with implementation.

3. **No tooling support** — Neither Steep (the RBS type checker) nor Sorbet supports behavioral narrowing from method calls, so even if RBS could express it, no checker would use it.

### Comparison

| Aspect | RBS | TypeScript declarations |
|--------|-----|----------------------|
| **Location** | Separate `.rbs` files | Inline or `.d.ts` files |
| **Expressiveness** | Types only | Types + modifiers (`identity`, `mutator`, `readonly`) |
| **`attr_reader`** | Declares type of generated getter | `get` accessor with `identity` modifier |
| **`attr_writer`** | Declares type of generated setter | `set` accessor with `mutator` modifier |
| **Behavioral contracts** | Not expressible | `identity`/`mutator`/`links` |

---

## 5. Method Visibility — `public`/`protected`/`private`

### Ruby's Model

Ruby uses method-level visibility modifiers:

```ruby
class Account
  def balance        # public by default
    @balance
  end

  protected

  def internal_id    # accessible from same class and subclasses
    @id
  end

  private

  def secret_key     # accessible only within the instance
    @key
  end
end
```

Ruby's `private` is unique — it prevents calling a method with an **explicit receiver**, not from subclasses:

```ruby
class Account
  private

  def secret
    "shh"
  end
end

class SubAccount < Account
  def reveal
    secret          # OK! — no explicit receiver, uses implicit self
    self.secret     # ERROR in Ruby < 2.7, OK in Ruby 2.7+
  end
end
```

### Visibility as Read/Write Control

Ruby's visibility system doesn't directly control read vs write access. A common pattern combines `attr_reader` with visibility:

```ruby
class SafeAccount
  attr_reader :balance         # public read access

  private

  attr_writer :balance         # private write access — only internal methods can set
  
  public
  
  def deposit(amount)
    self.balance = balance + amount  # uses private writer internally
  end
end
```

This pattern — **public read, private write** — is directly analogous to an `identity` getter with a private `mutator`:

```typescript
// TypeScript-Go equivalent
class SafeAccount {
    private _balance: number;
    
    identity get balance(): number { return this._balance; }
    private mutator set balance(v: number) { this._balance = v; }
    
    mutator deposit(amount: number): void {
        this._balance += amount;
    }
}
```

### Comparison

| Aspect | Ruby visibility | TypeScript-Go modifiers |
|--------|----------------|----------------------|
| **Purpose** | Access control (who can call) | Behavioral contracts (what calling means) |
| **Orthogonality** | Independent of getter/setter semantics | Composes with `public`/`private`/`protected` |
| **Read/write split** | Combine `attr_reader`/`attr_writer` with visibility | Combine `identity`/`mutator` with access modifiers |
| **Enforcement** | Runtime (NameError if called on wrong receiver) | Static (type checker enforces narrowing rules) |

---

## 6. `Comparable` and `Enumerable` — Read-Only Iteration Patterns

### Ruby's Model

Ruby's `Enumerable` module provides read-only iteration over collections through a single required method: `each`.

```ruby
class NumberSet
  include Enumerable

  def initialize(*numbers)
    @numbers = numbers
  end

  def each(&block)
    @numbers.each(&block)
  end
end

set = NumberSet.new(3, 1, 4, 1, 5)
set.map { |n| n * 2 }    # => [6, 2, 8, 2, 10]
set.select { |n| n > 2 } # => [3, 4, 5]
set.sort                  # => [1, 1, 3, 4, 5]
```

All `Enumerable` methods (`map`, `select`, `reject`, `sort`, `reduce`, etc.) are **non-mutating** — they return new arrays/values without modifying the original collection. This is a read-only protocol by convention.

### `Comparable` — Stable Ordering Contract

```ruby
class Temperature
  include Comparable

  attr_reader :degrees  # stable read endpoint

  def initialize(degrees)
    @degrees = degrees
  end

  def <=>(other)
    degrees <=> other.degrees  # comparison relies on stable attr_reader
  end
end
```

`Comparable` requires `<=>` (spaceship operator) and provides `<`, `<=`, `==`, `>=`, `>`, `between?`, and `clamp`. The contract implicitly depends on the compared values being **stable** — if `degrees` changed between comparisons, ordering would be inconsistent.

### Relevance to `identity`

Ruby's `Enumerable` and `Comparable` demonstrate a design principle: **useful abstractions build on stable read endpoints**. The `each` method and `<=>` operator both assume their underlying data doesn't change mid-iteration/comparison.

TypeScript-Go's `identity` formalizes exactly this assumption. In TypeScript terms:

```typescript
interface Comparable<T> {
    identity get value(): T;
    compareTo(other: Comparable<T>): number;
}
```

The `identity` modifier would let the type checker prove that `value` is safe to narrow and that comparison chains are consistent.

---

## 7. Ractor — Safe Concurrency Without Shared Mutation

### Ruby's Model

Ruby 3.0 introduced Ractors (Ruby Actors) for parallel execution without shared mutable state:

```ruby
ractor = Ractor.new do
  msg = Ractor.receive
  msg.upcase  # processes the message
end

ractor.send("hello")
result = ractor.take    # => "HELLO"
```

### Shareable Objects

Ractors enforce strict rules about what can be shared:

```ruby
# Frozen objects are shareable
frozen_str = "hello".freeze
Ractor.new(frozen_str) { |s| puts s }  # OK

# Mutable objects are NOT shareable
mutable_str = "hello"
Ractor.new(mutable_str) { |s| puts s }  # Ractor::IsolationError

# Ractor.make_shareable deep-freezes an object
obj = { name: "Alice", tags: ["admin", "user"] }
Ractor.make_shareable(obj)
obj.frozen?             # => true
obj[:tags].frozen?      # => true — deep freeze
```

### The `freeze`/`Ractor` Connection

Ractor creates a formal link between immutability and safe sharing:

| Object State | Shareable? | Concurrently Safe? |
|-------------|-----------|-------------------|
| Mutable | No | No — must be moved (ownership transfer) |
| Frozen | Yes | Yes — no mutation possible |
| `Ractor.make_shareable` | Yes | Yes — deep frozen |

### Comparison with TypeScript-Go

| Aspect | Ruby Ractor | TypeScript-Go `identity` |
|--------|------------|------------------------|
| **Problem** | Safe concurrency | Safe type narrowing |
| **Mechanism** | Ownership transfer + freeze | Behavioral contracts on callables |
| **Immutability role** | Frozen objects can be shared | `identity` callables return stable types |
| **Mutation detection** | Runtime IsolationError | Static narrowing invalidation via `mutator` |
| **Selective sharing** | `Ractor.make_shareable` for specific objects | `links` for selective invalidation |

The parallel is instructive: both systems need to answer "when is it safe to assume this value hasn't changed?" Ractors answer at running time via ownership/freeze. TypeScript-Go answers at type-checking time via `identity`/`mutator` contracts.

---

## 8. Alternative Syntax Ideas — Could TypeScript Use `attr_reader`-Style Declarations?

### Ruby's `attr_reader` as Inspiration

Ruby's `attr_reader` is admired for its conciseness — a single line declares "this is a readable property":

```ruby
class Person
  attr_reader :name, :age
  attr_writer :email
  attr_accessor :phone
end
```

### What Would This Look Like in TypeScript?

#### Option A: Modifier-based (current TypeScript-Go approach)

```typescript
class Person {
    identity get name(): string { return this._name; }
    mutator set name(v: string) { this._name = v; }
}
```

**Pros:** Consistent with existing modifier syntax (`public`, `static`, `readonly`).
**Cons:** Verbose when declaring many identity properties.

#### Option B: Declaration-style (Ruby-inspired)

```typescript
class Person {
    identity name: string;      // generates: identity get name() { return this.#name; }
    mutator name: string;       // generates: mutator set name(v) { this.#name = v; }
    accessor name: string;      // generates: both (like attr_accessor)
}
```

**Pros:** Very concise. Immediately clear which properties are readable vs writable.
**Cons:** Conflicts with existing `accessor` keyword (Stage 3 auto-accessors). Overloaded declaration syntax. Hides implementation details.

#### Option C: Decorator-based

```typescript
class Person {
    @identity accessor name: string = "";
    @mutator setName(v: string) { this.name = v; }
}
```

**Pros:** Uses existing decorator infrastructure. Non-grammar extension.
**Cons:** Decorators are runtime; `identity`/`mutator` are type-level contracts. Conflates runtime behavior with static analysis.

#### Option D: Interface-level contracts (RBS-inspired)

```typescript
interface ReadablePerson {
    identity name: string;    // declares a stable read endpoint
    identity age: number;
}

interface MutablePerson extends ReadablePerson {
    mutator setName(v: string): void links name;
    mutator setAge(v: number): void links age;
}
```

**Pros:** Separates read and write contracts at the interface level. Clean for API design.
**Cons:** Duplicates property declarations. Doesn't help with class implementations.

### Evaluation

| Option | Conciseness | Compatibility | Type Safety | Expressiveness |
|--------|------------|---------------|-------------|----------------|
| A: Modifier | Medium | High | High | High |
| B: Declaration | High | Low (conflicts with `accessor`) | Medium | Low |
| C: Decorator | Medium | Medium | Low (runtime) | Medium |
| D: Interface | Medium | High | High | Medium |

**Option A (current approach)** remains the strongest choice because:
1. It's consistent with TypeScript's existing modifier syntax.
2. It composes naturally with `public`/`private`/`protected`/`static`/`readonly`.
3. It works on any callable, not just simple property access.
4. It doesn't introduce new declaration forms.

The Ruby-inspired shorthand (Option B) is attractive for simple cases but loses expressiveness for complex methods and creates conflicts with Stage 3 `accessor`.

---

## Summary: Key Takeaways from Ruby

### What Ruby Does Well

1. **`attr_reader`/`attr_writer` separation:** Ruby's explicit read/write contract declarations are a clear precedent for `identity`/`mutator`. The insight that "reading" and "writing" are fundamentally different operations worth declaring separately is validated by decades of Ruby practice.

2. **`freeze` as a total immutability mechanism:** Ruby's `freeze` shows that immutability guarantees enable powerful optimizations (caching, sharing, concurrency). TypeScript-Go's `identity` is a more targeted, type-level analog.

3. **Ractor's ownership model:** The Ractor system demonstrates that "safe to share" and "immutable" are closely linked. The `mutator`/`links` system achieves a similar goal (safe to narrow = stable) without runtime enforcement.

### What Ruby Lacks (and TypeScript-Go Provides)

1. **No gradual stability:** Ruby's `attr_reader` is all-or-nothing — either you use the trivial getter or you get no stability guarantees. `identity` works on any callable.

2. **No selective invalidation:** Ruby's `freeze` prevents all mutation. `links` allows selective invalidation, preserving narrowing of unrelated identities when only one property changes.

3. **No static narrowing from method calls:** Neither Sorbet nor Steep can narrow types based on method call results. TypeScript-Go's `identity` enables exactly this.

4. **No type-level enforcement:** Ruby's `freeze` is runtime-only. TypeScript-Go's system is entirely static, catching errors at type-check time.

### Design Principles Reinforced

- **Read/write separation is fundamental** — Ruby, TypeScript-Go, and many other languages all find value in distinguishing read and write endpoints.
- **Behavioral contracts complement type contracts** — knowing a method returns `string | number` is less useful than knowing it returns the *same* `string | number` on repeated calls.
- **Selective invalidation beats total immutability** — Ruby's `freeze` is too blunt for real-world use in many cases; TypeScript-Go's `links` provides surgical precision.
