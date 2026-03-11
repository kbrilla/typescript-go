# Design Review: Groovy & Perl — Dynamic Language Type Systems, Immutability, and Read/Write Contracts vs TypeScript-Go's `identity`/`mutator`/`links`

## Overview

Groovy and Perl occupy a distinctive niche among dynamic languages: both have evolved
sophisticated mechanisms for declaring read/write intent, enforcing immutability, and
layering optional static type checking over fundamentally dynamic runtimes. Groovy's
`@Immutable` AST transforms and `@CompileStatic` flow typing, combined with Perl's
Moose/Moo attribute traits (`is => 'ro'`/`is => 'rw'`) and the emerging Corinna OO
system, provide direct analogs to TypeScript-Go's `identity`/`mutator`/`links` system.
This document examines each language's approach, maps patterns to TypeScript-Go's
type-level contracts, and extracts cross-cutting lessons for dynamic-to-static
gradual typing.

---

## 1. Groovy: `@Immutable` and `@Canonical` — AST Transforms for Immutable Classes

### 1.1 `@Immutable`

Groovy provides the `@Immutable` AST transformation (from `groovy.transform`) that
generates immutable classes at compile time. When applied, the transform:

- Makes all properties `final` (no setters generated)
- Generates a constructor accepting all properties
- Generates `equals()`, `hashCode()`, and `toString()`
- Deep-copies mutable constructor arguments (collections, dates)
- Disallows subclassing by default

```groovy
import groovy.transform.Immutable

@Immutable
class Point {
    double x
    double y
}

def p = new Point(3.0, 4.0)
p.x          // 3.0 — getter works
p.x = 5.0   // ReadOnlyPropertyException at runtime
```

The `@Immutable` transform guarantees that once constructed, a `Point`'s properties
cannot change. This is a **whole-object immutability** guarantee — stronger than
TypeScript-Go's per-endpoint `identity`, but also less granular.

### 1.2 `@Canonical`

`@Canonical` is a lighter transform that generates `equals()`, `hashCode()`,
`toString()`, and tuple constructors, but does **not** enforce immutability:

```groovy
import groovy.transform.Canonical

@Canonical
class MutablePoint {
    double x
    double y
}

def p = new MutablePoint(3.0, 4.0)
p.x = 5.0   // OK — properties are still mutable
```

### 1.3 Comparison with `identity`/`mutator`/`links`

| Groovy Concept              | TypeScript-Go Analog          | Key Difference                              |
|-----------------------------|-------------------------------|---------------------------------------------|
| `@Immutable` class          | All properties as `identity`  | Groovy is whole-class; TS-Go is per-endpoint |
| `@Immutable` prevents setters | `mutator` absence            | Groovy enforces at runtime; TS-Go at compile |
| `@Canonical` (mutable)      | No `identity` annotation      | Both leave properties mutable by default     |
| Deep-copy of ctor args      | No analog                     | Groovy prevents aliased mutation             |

The critical insight: Groovy's `@Immutable` is an **all-or-nothing** class-level
declaration. TypeScript-Go's `identity` is more flexible — individual methods or
getters can be marked stable while the same class has `mutator` methods for other
endpoints. This per-endpoint granularity is essential for APIs like Angular Signals
where read and write endpoints coexist on the same object.

---

## 2. Groovy Property Access — Auto-Generated Getters/Setters

### 2.1 The Groovy Property Convention

Groovy automatically generates getters and setters for class properties. A simple
property declaration:

```groovy
class Person {
    String name
    int age
}
```

compiles to roughly:

```groovy
class Person {
    private String name
    private int age

    String getName() { return name }
    void setName(String name) { this.name = name }

    int getAge() { return age }
    void setAge(int age) { this.age = age }
}
```

Property access syntax (`person.name`) is transparently rewritten to `person.getName()`.
This means Groovy properties are **always** method-backed, similar to C# auto-properties
or Kotlin properties.

### 2.2 Custom Getters and Setters

Groovy allows overriding auto-generated accessors:

```groovy
class Temperature {
    double celsius

    double getFahrenheit() {
        celsius * 9.0 / 5.0 + 32.0
    }

    void setFahrenheit(double f) {
        celsius = (f - 32.0) * 5.0 / 9.0
    }
}

def t = new Temperature(celsius: 100.0)
t.fahrenheit        // 212.0 — computed getter
t.fahrenheit = 32.0 // sets celsius to 0.0
```

This is structurally identical to TypeScript's getter/setter pairs. The challenge for
narrowing is the same: `t.fahrenheit` calls `getFahrenheit()` which reads `celsius` —
if `celsius` changes between calls, the narrowed type of `fahrenheit` may be invalid.

### 2.3 Comparison with `identity`

| Groovy Property Pattern           | TypeScript-Go Analog                             |
|-----------------------------------|--------------------------------------------------|
| Auto-generated getter (trivial)   | Getter that could be `identity` (stable by construction) |
| Custom getter (computed)          | Getter that needs `identity` to assert stability |
| Auto-generated setter             | Implicitly `mutator` — invalidates narrowing     |
| Custom setter with side effects   | `mutator ... links` for selective invalidation   |

Groovy has no mechanism to declare that a custom getter is stable or that a setter
invalidates specific computed properties. The language relies on runtime behavior and
developer convention. TypeScript-Go's `identity`/`mutator`/`links` fills exactly
this gap — it provides a **declarative contract** for what Groovy leaves implicit.

---

## 3. `@CompileStatic` — Groovy's Static Type Checking Mode

### 3.1 Overview

By default, Groovy is dynamically typed — method resolution occurs at runtime via the
MOP (Meta-Object Protocol). The `@CompileStatic` annotation (introduced in Groovy 2.0)
opts individual classes or methods into static type checking:

```groovy
import groovy.transform.CompileStatic

@CompileStatic
class Calculator {
    int add(int a, int b) {
        return a + b
    }

    String process(Object input) {
        if (input instanceof String) {
            return input.toUpperCase()  // Smart cast: input is String here
        }
        return input.toString()
    }
}
```

Under `@CompileStatic`:
- All method calls are resolved at compile time
- Type mismatches produce compile errors (not runtime `MissingMethodException`)
- `instanceof` checks enable smart casts (similar to Kotlin/TypeScript narrowing)
- Property access is type-checked against declared types

### 3.2 Without `@CompileStatic`

Without the annotation, Groovy permits anything and defers to runtime resolution:

```groovy
class DynamicExample {
    def process(input) {
        input.nonExistentMethod()  // No error at compile time!
        // MissingMethodException at runtime if method doesn't exist
    }
}
```

### 3.3 The Gradual Typing Parallel

Groovy's `@CompileStatic` is a **per-class/per-method opt-in** to static checking
within a dynamically typed codebase. This is directly analogous to TypeScript's
relationship with JavaScript:

| Mechanism                    | Groovy                       | TypeScript                    |
|------------------------------|------------------------------|-------------------------------|
| Gradual opt-in               | `@CompileStatic`             | `.ts` files / `@ts-check`     |
| Default behavior             | Dynamic (runtime dispatch)   | Static (type-checked)         |
| Smart casts / narrowing      | `instanceof` under `@CompileStatic` | CFA type guards          |
| Escape hatch                 | Remove `@CompileStatic`      | `any` type / `@ts-ignore`     |

The implication for `identity`/`mutator`/`links`: Groovy's `@CompileStatic` enables
narrowing similar to TypeScript's CFA, but only for `instanceof` checks and
variable assignments — not for repeated method calls returning stable types.
TypeScript-Go's `identity` extends narrowing into territory that even `@CompileStatic`
Groovy cannot reach.

---

## 4. Flow Typing Under `@CompileStatic`

### 4.1 Smart Casts

Groovy's flow-sensitive typing under `@CompileStatic` narrows types after type checks:

```groovy
@CompileStatic
class FlowExample {
    String describe(Object obj) {
        if (obj instanceof String) {
            // obj is narrowed to String — no explicit cast needed
            return "String of length ${obj.length()}"
        }
        if (obj instanceof List) {
            // obj is narrowed to List
            return "List of size ${obj.size()}"
        }
        return obj.toString()
    }
}
```

### 4.2 Limitations of Groovy Flow Typing

Groovy's flow typing is limited compared to TypeScript's CFA:

1. **No union type narrowing** — Groovy doesn't have union types at the language level,
   so there's no equivalent of `string | number` narrowing.

2. **No truthiness narrowing** — `if (obj)` doesn't narrow `Object?` to `Object`.

3. **No discriminated unions** — No pattern matching on discriminant properties.

4. **No narrowing across calls** — `obj.getType()` cannot be used to narrow `obj`,
   even under `@CompileStatic`.

5. **Property access doesn't narrow** — Reading `obj.name` twice doesn't establish
   a stable type for the second read.

```groovy
@CompileStatic
class NarrowingGap {
    void process(Object obj) {
        if (obj instanceof String) {
            someMethod()   // Does this invalidate the narrowing of obj?
            obj.length()   // Groovy still considers obj as String here
                           // — no invalidation on unrelated calls
        }
    }

    void someMethod() { /* side effects? */ }
}
```

### 4.3 Flow Typing vs `identity` Narrowing

Groovy's flow typing under `@CompileStatic` makes an **implicit assumption**: once a
variable is narrowed via `instanceof`, it stays narrowed until reassignment. For local
variables, this is sound (locals can't be mutated by external calls). For properties,
Groovy's approach is less rigorous — `@CompileStatic` does not analyze whether an
intervening call could have mutated the property.

TypeScript-Go's CFA is more sophisticated here — it tracks property narrowing and
invalidates at uncertainty boundaries. The `identity`/`mutator`/`links` system extends
this to **callable return values**, a category that Groovy doesn't address at all.

| Narrowing Capability              | Groovy `@CompileStatic`        | TypeScript-Go CFA + `identity` |
|-----------------------------------|-------------------------------|--------------------------------|
| Variable `instanceof` narrowing   | Yes                           | Yes                            |
| Property narrowing                | Partial (no invalidation tracking) | Yes (with CFA invalidation) |
| Callable return value narrowing   | No                            | Yes (via `identity`)           |
| Mutation invalidation             | None                          | Automatic + `mutator`/`links`  |
| Cross-call stability              | Not analyzed                  | `identity` contract            |

---

## 5. Perl: Moose/Moo Attribute Traits

### 5.1 The `is` Trait — `ro` vs `rw`

Perl's Moose (and its leaner cousin Moo) provides a powerful attribute system where
read/write intent is declared explicitly at the attribute level:

```perl
package Person;
use Moose;

has 'name' => (
    is       => 'ro',    # read-only: generates getter only
    isa      => 'Str',
    required => 1,
);

has 'age' => (
    is       => 'rw',    # read-write: generates getter AND setter
    isa      => 'Int',
    default  => 0,
);

has 'email' => (
    is        => 'ro',
    isa       => 'Str',
    writer    => '_set_email',  # private writer — controlled mutation
    predicate => 'has_email',   # generates has_email() predicate
);
```

This produces:

```perl
my $p = Person->new(name => 'Alice', age => 30);

$p->name;              # 'Alice' — getter (always works)
$p->name('Bob');       # DIES: "Cannot assign a value to a read-only accessor"
$p->age;               # 30 — getter
$p->age(31);           # sets age to 31 — same method name, with argument = setter
$p->_set_email('a@b'); # private writer — bypasses 'ro' for internal use
$p->has_email;         # true — predicate
```

### 5.2 Direct Mapping to `identity`/`mutator`

Perl's `is => 'ro'`/`is => 'rw'` is **the closest analog** to TypeScript-Go's
`identity`/`mutator` split among all languages surveyed:

| Perl Moose Trait          | TypeScript-Go Analog          | Semantics                              |
|---------------------------|-------------------------------|----------------------------------------|
| `is => 'ro'`             | `identity` read endpoint      | Stable read — no mutation via this accessor |
| `is => 'rw'`             | Combined `identity` + `mutator` | Same accessor reads and writes       |
| `writer => '_set_x'`     | Separate `mutator` method     | Dedicated write endpoint               |
| `predicate => 'has_x'`   | No direct analog              | Existence check — could be `identity`  |
| `clearer => 'clear_x'`   | `mutator` that `links` the accessor | Resets to undefined               |

The critical observation: **Perl Moose forces developers to declare read/write intent
at attribute definition time.** This is remarkably similar to TypeScript-Go requiring
`identity`/`mutator` annotations on method declarations. Both systems make the
read/write contract explicit rather than inferred from implementation.

### 5.3 The `trigger` Trait — Mutation Callbacks

Moose attributes can declare a `trigger` — a callback invoked whenever the attribute's
value changes:

```perl
has 'temperature_celsius' => (
    is      => 'rw',
    isa     => 'Num',
    trigger => sub {
        my ($self, $new_val, $old_val) = @_;
        $self->_update_fahrenheit($new_val);
    },
);

has 'temperature_fahrenheit' => (
    is     => 'ro',
    isa    => 'Num',
    writer => '_set_fahrenheit',
);

sub _update_fahrenheit {
    my ($self, $celsius) = @_;
    $self->_set_fahrenheit($celsius * 9/5 + 32);
}
```

The `trigger` pattern demonstrates **selective invalidation**: writing to
`temperature_celsius` invalidates `temperature_fahrenheit` via an explicit callback
chain. This is structurally similar to TypeScript-Go's `links` clause:

```typescript
interface Thermometer {
    identity get celsius(): number;
    identity get fahrenheit(): number;
    mutator set celsius(value: number) links celsius, fahrenheit;
}
```

Both systems declare: "mutating X also affects Y." The difference is enforcement:
Perl's trigger is a runtime callback; TypeScript-Go's `links` is a compile-time
contract that affects narrowing decisions.

### 5.4 `lazy` and `builder` — Deferred Computation

Moose supports lazy attributes that are computed on first access:

```perl
has 'full_name' => (
    is      => 'ro',
    isa     => 'Str',
    lazy    => 1,
    builder => '_build_full_name',
);

sub _build_full_name {
    my $self = shift;
    return $self->first_name . ' ' . $self->last_name;
}
```

A `lazy` + `ro` attribute is computed once and then cached — it becomes stable after
first access. This is analogous to a memoized `identity` getter. The Moose runtime
guarantees that `_build_full_name` is called at most once; subsequent reads return the
cached value.

This pattern raises an interesting question for `identity`: should TypeScript-Go
recognize a "lazy identity" pattern where the first call may compute a value, but
subsequent calls are guaranteed stable? The current design treats all `identity` calls
as returning the same type, which covers this case — but doesn't distinguish between
"always stable" and "stable after initialization."

---

## 6. Type::Tiny — Runtime Type Checking with Coercions

### 6.1 Type Constraints

Perl's Type::Tiny library provides a runtime type system that can be used with
Moose/Moo attributes:

```perl
use Types::Standard qw( Str Int ArrayRef HashRef Maybe );

has 'name' => (
    is  => 'ro',
    isa => Str,          # must be a string
);

has 'scores' => (
    is  => 'ro',
    isa => ArrayRef[Int],  # must be arrayref of integers
);

has 'metadata' => (
    is  => 'rw',
    isa => Maybe[HashRef[Str]],  # hashref of strings, or undef
);
```

### 6.2 Coercions

Type::Tiny supports coercions — automatic type conversions applied at assignment:

```perl
use Types::Standard qw( Int Str );

has 'count' => (
    is     => 'rw',
    isa    => Int,
    coerce => 1,  # enable coercion
);

# With coercion: Str -> Int via built-in coercion
# $obj->count("42") stores 42 (integer), not "42" (string)
```

### 6.3 Comparison with TypeScript-Go

| Type::Tiny Concept         | TypeScript-Go Analog          | Key Difference                         |
|----------------------------|-------------------------------|----------------------------------------|
| `isa => Str`               | `: string` type annotation    | Perl checks at runtime; TS at compile  |
| `Maybe[Str]`               | `string \| undefined`         | Equivalent nullable semantics          |
| `ArrayRef[Int]`            | `number[]`                    | Parameterized container types          |
| Coercions                  | No direct analog              | Perl transforms values; TS requires correct types |
| Runtime enforcement        | Compile-time enforcement      | Different enforcement points           |

Type::Tiny's coercions are relevant to `identity` narrowing because a coerced
attribute may return a **different type** than what was assigned. If you assign a
`Str` to a coerced `Int` attribute, the getter returns an `Int`. This is a form of
type instability from the caller's perspective — the attribute's "identity" depends on
the coercion being applied. TypeScript-Go's `identity` avoids this issue because
TypeScript has no implicit coercions; what you assign is what you get back (modulo
type widening).

---

## 7. Method::Signatures — Function Signature Declarations

### 7.1 Overview

Method::Signatures brings type-annotated function signatures to Perl, moving beyond
the traditional `@_` argument unpacking:

```perl
use Method::Signatures;

method greet(Str $name, Int $times = 1) {
    for (1 .. $times) {
        say "Hello, $name!";
    }
}

method transform(Str $input --> Str) {
    return uc($input);
}
```

Compare with traditional Perl:

```perl
sub greet {
    my ($self, $name, $times) = @_;
    $times //= 1;
    for (1 .. $times) {
        say "Hello, $name!";
    }
}
```

### 7.2 Type Annotations in Signatures

Method::Signatures supports type annotations that are checked at runtime:

```perl
method process(
    Str      $name,
    Int      :$age,             # named parameter
    ArrayRef :$tags = [],       # optional named parameter with default
    Bool     :$active = 1,      # boolean flag
) {
    # $name is guaranteed to be Str
    # $age is guaranteed to be Int
}
```

### 7.3 Return Type Declarations

```perl
method get_name(--> Str) {
    return $self->name;
}

method get_score(--> Maybe[Int]) {
    return $self->has_score ? $self->score : undef;
}
```

### 7.4 Relevance to `identity`/`mutator`

Method::Signatures demonstrates a key principle: **explicit signature declarations
enable better tooling and correctness guarantees.** In the same way that
Method::Signatures adds type annotations to Perl's untyped function signatures,
TypeScript-Go's `identity`/`mutator` adds behavioral annotations to TypeScript's
already-typed method signatures.

| Method::Signatures Concept  | TypeScript-Go Analog          | Parallel                               |
|-----------------------------|-------------------------------|----------------------------------------|
| `method foo(Str $x)`        | `foo(x: string)`              | Explicit parameter types               |
| `--> Str` return type       | `: string` return type        | Explicit return types                  |
| Runtime type checking       | Compile-time type checking    | Different enforcement timing           |
| No read/write annotation    | `identity`/`mutator`          | TS-Go adds behavioral layer on top     |

Method::Signatures proves that developers in dynamic languages **want** explicit
contracts even when the language doesn't require them. TypeScript-Go's `identity`/
`mutator` extends this principle from types to **behavioral stability contracts**.

---

## 8. Object::Pad and Corinna — Perl's New OO System

### 8.1 Object::Pad (Available Now)

Object::Pad is a CPAN module implementing the Corinna OO proposal for Perl. It
introduces proper field declarations with explicit read/write visibility:

```perl
use Object::Pad;

class Point {
    field $x :param :reader;           # constructor param + read-only accessor
    field $y :param :reader;           # constructor param + read-only accessor
    field $label :param :reader :writer;  # read-write accessor

    method magnitude() {
        return sqrt($x * $x + $y * $y);
    }
}

my $p = Point->new(x => 3, y => 4, label => "origin");
$p->x;              # 3 — reader accessor
$p->label;          # "origin"
$p->set_label("A"); # writer accessor (generated from :writer)
```

### 8.2 Corinna — The Language-Level Proposal

Corinna (the OO proposal that Object::Pad prototypes) envisions first-class OO with
field declarations:

```perl
class Person {
    field $name :param :reader;              # immutable after construction
    field $age  :param :reader :writer;      # mutable
    field $id   :reader = generate_id();     # computed default, read-only

    ADJUST {
        # post-construction validation
        die "Age must be positive" unless $age > 0;
    }

    method greet() {
        return "Hello, I'm $name, age $age";
    }
}
```

### 8.3 `:reader`/`:writer` as `identity`/`mutator`

Corinna's `:reader`/`:writer` annotations map almost directly to
`identity`/`mutator`:

| Corinna/Object::Pad        | TypeScript-Go               | Mapping                                |
|-----------------------------|-----------------------------|----------------------------------------|
| `field $x :reader`          | `identity get x(): T`      | Read-only accessor — stable identity   |
| `field $x :writer`          | `mutator set x(v: T): void` | Write accessor — mutates state        |
| `field $x :reader :writer`  | `identity get x()` + `mutator set x()` | Both endpoints declared    |
| `field $x :param`           | Constructor parameter       | Initialization-time assignment         |
| No `:reader` or `:writer`   | Private field               | No public accessor generated           |

The parallel is striking: both systems require **explicit opt-in** to declare that
an accessor is a stable read endpoint or a mutation endpoint. Neither system infers
this from implementation — the developer must declare intent.

### 8.4 Advantages of Corinna's Approach

Corinna's `:reader`/`:writer` has a syntactic advantage over TypeScript-Go's
`identity`/`mutator`: the annotations are attached to the **field declaration**, not
to the generated methods. This means:

1. The read/write contract is visible at the point of field definition
2. There's no possibility of annotating a method incorrectly (the runtime generates
   the correct accessor)
3. The syntax is concise — a single `:reader` replaces a getter definition

TypeScript-Go cannot take this approach because TypeScript methods are not
auto-generated from field declarations — developers write custom getters, setters,
and methods with arbitrary logic. The `identity`/`mutator` annotations must be on
the **methods themselves** because TypeScript methods are the behavioral contract,
not field declarations.

---

## 9. What Dynamic Languages Teach Us — Cross-Cutting Patterns

### 9.1 Common Patterns Across Groovy and Perl

Examining both languages reveals recurring themes:

**Pattern 1: Explicit Read/Write Declaration**

Both Groovy and Perl have mechanisms to declare read-only vs read-write intent:

| Language | Read-Only Declaration       | Read-Write Declaration          |
|----------|-----------------------------|---------------------------------|
| Groovy   | `@Immutable` (class-level)  | Default (mutable properties)    |
| Perl/Moose | `is => 'ro'`             | `is => 'rw'`                    |
| Perl/Corinna | `field $x :reader`      | `field $x :reader :writer`      |
| TypeScript-Go | `identity`              | `identity` + `mutator`          |

**Pattern 2: Whole-Object vs Per-Field Granularity**

- Groovy's `@Immutable`: whole-object — all fields are immutable
- Perl's `is => 'ro'`: per-field — individual attributes can be read-only
- TypeScript-Go's `identity`: per-method — individual callables declare stability

The evolution across these languages trends toward **finer granularity**. Whole-object
immutability is too restrictive for most real-world APIs; per-field is more practical;
per-method is the most flexible.

**Pattern 3: Mutation Provenance**

All three ecosystems need to express "which mutations affect which reads":

- Groovy: No mechanism — developer convention only
- Perl/Moose: `trigger` callbacks — runtime linkage between attributes
- TypeScript-Go: `links` clause — compile-time linkage between methods

TypeScript-Go's `links` clause is the only compile-time solution among these,
providing narrowing correctness that dynamic languages can only approximate at runtime.

**Pattern 4: Gradual Typing Adoption**

Both Groovy (`@CompileStatic`) and Perl (Type::Tiny, Method::Signatures) demonstrate
that dynamic language communities eventually want static guarantees — but only as
opt-in layers. TypeScript was born from this same insight (adding types to JavaScript).
The `identity`/`mutator` system continues this trajectory: adding **behavioral static
guarantees** to a language that already has structural static types.

### 9.2 Lessons for TypeScript-Go

1. **Developers in dynamic languages voluntarily adopt read/write contracts** —
   Perl's `is => 'ro'` / `is => 'rw'` is not mandated by the language, yet it is
   the universal convention. This validates TypeScript-Go's approach of letting
   developers declare `identity`/`mutator` contracts.

2. **Per-field granularity wins over whole-object immutability** — Groovy's
   `@Immutable` is used far less than Perl's per-attribute `ro`/`rw`. TypeScript-Go's
   per-method `identity` is appropriately granular.

3. **Explicit mutation provenance is needed** — Perl's `trigger` mechanism exists
   because developers need to express "writing X invalidates Y." TypeScript-Go's
   `links` clause solves the same problem at compile time.

4. **Runtime enforcement is insufficient** — Both Groovy (runtime
   `ReadOnlyPropertyException`) and Perl (runtime Moose type checks) demonstrate
   that runtime-only enforcement catches bugs too late. TypeScript-Go's compile-time
   approach is strictly superior for developer experience.

---

## 10. Alternative Syntax Ideas — Could Dynamic Language Patterns Inspire Simpler Syntax?

### 10.1 Perl-Inspired `ro`/`rw` Annotations

Perl's `is => 'ro'` / `is => 'rw'` is remarkably concise. Could TypeScript-Go adopt
a similar shorthand?

```typescript
// Current TypeScript-Go syntax
interface Signal<T> {
    identity (): T;
}
interface WritableSignal<T> extends Signal<T> {
    mutator set(value: T): void links ();
}

// Hypothetical Perl-inspired syntax
interface Signal<T> {
    ro (): T;              // 'ro' = 'read-only' = stable read endpoint
}
interface WritableSignal<T> extends Signal<T> {
    rw set(value: T): void links ();  // 'rw' = 'read-write' = may mutate
}
```

**Advantages:**
- Very concise — two characters vs seven/seven
- Familiar to Perl developers
- Intuitive meaning: "this is read-only" / "this is read-write"

**Disadvantages:**
- `ro` / `rw` don't clearly convey the **narrowing** semantics — `identity` implies
  "the return value's type identity is stable," while `ro` implies "the endpoint is
  read-only" (which isn't quite the same — an `identity` method can have internal
  state changes, it just returns a stable type)
- `rw` on a void-returning mutator method is misleading — the method doesn't "read
  and write," it only writes
- Namespace collision risk: `ro` and `rw` are plausible variable names

### 10.2 Groovy-Inspired Annotation Syntax

Groovy uses `@` annotations (Java-style). Could TypeScript-Go use decorator-like syntax?

```typescript
// Hypothetical decorator-style syntax
interface Signal<T> {
    @stable (): T;
}
interface WritableSignal<T> extends Signal<T> {
    @mutates('()') set(value: T): void;
}
```

**Advantages:**
- Familiar to TypeScript developers who use decorators
- Metadata-style annotation is visually distinct from the type signature
- `@stable` clearly communicates the intent

**Disadvantages:**
- Decorators are a runtime feature in TypeScript — using `@` for compile-time-only
  annotations is confusing
- TypeScript decorators have specific semantics (class, method, property decorators)
  that don't apply to interface method declarations
- Would require a parallel decorator-like syntax that behaves differently from actual
  decorators

### 10.3 Corinna-Inspired Field-Level Syntax

Perl's Corinna attaches `:reader`/`:writer` to field declarations. TypeScript could
consider a similar field-level approach for simple cases:

```typescript
// Hypothetical field-level syntax for simple wrappers
class Counter {
    :stable count: number = 0;       // auto-generates identity getter
    :mutable label: string = "";     // auto-generates getter + mutator setter
}
```

**Advantages:**
- Extremely concise for the common case (simple accessor wrappers)
- Read/write contract is visible at the field declaration

**Disadvantages:**
- Only works for trivial getters/setters — doesn't help with computed properties,
  method-style accessors, or callable interfaces
- TypeScript already has `readonly` for fields — adding `:stable` creates confusion
- Doesn't address the primary motivation (callable-style APIs like SignalS)

### 10.4 Assessment

The current `identity`/`mutator`/`links` syntax is more verbose than Perl's `ro`/`rw`
or Groovy's `@Immutable`, but it is **more precise**:

| Syntax                    | Conciseness | Precision | Applicable Scope          |
|---------------------------|-------------|-----------|---------------------------|
| `ro` / `rw`               | High        | Medium    | Properties only           |
| `@stable` / `@mutates`    | Medium      | Medium    | Methods only              |
| `:reader` / `:writer`     | High        | Medium    | Fields only               |
| `identity` / `mutator`    | Low         | High      | Any callable              |

TypeScript-Go's system needs to work with arbitrary callables (including the `()`
call signature for Signals), not just properties or fields. The `identity`/`mutator`
keywords, while more verbose, are the only syntax that cleanly applies to all
callable patterns — property getters, methods, call signatures, and computed values.

---

## Summary Table

| Feature                          | Groovy                       | Perl (Moose/Corinna)         | TypeScript-Go                |
|----------------------------------|------------------------------|------------------------------|------------------------------|
| Read-only declaration            | `@Immutable` (class-level)   | `is => 'ro'`, `:reader`      | `identity`                   |
| Read-write declaration           | Default (mutable)            | `is => 'rw'`, `:reader :writer` | `identity` + `mutator`    |
| Granularity                      | Whole class                  | Per attribute                | Per callable                 |
| Mutation tracking                | None                         | `trigger` (runtime)          | `links` (compile-time)       |
| Static type checking             | `@CompileStatic` (opt-in)    | Type::Tiny (runtime)         | Always-on                    |
| Flow typing / narrowing          | `instanceof` under `@CompileStatic` | None                  | Full CFA + `identity`        |
| Custom accessor stability        | Not expressible              | Not expressible              | `identity` asserts stability |
| Selective invalidation           | Not available                | `trigger` + `clearer`        | `mutator ... links`          |
| Enforcement timing               | Runtime                      | Runtime                      | Compile-time                 |

---

## Key Takeaways

1. **Perl's `ro`/`rw` is the closest prior art** to `identity`/`mutator` — both
   require explicit declaration of read vs write intent at the API level. The main
   difference is enforcement timing (runtime vs compile-time) and scope (per-attribute
   vs per-callable).

2. **Groovy demonstrates the limits of whole-object immutability** — `@Immutable` is
   too coarse for APIs where some endpoints are stable and others are mutable.
   TypeScript-Go's per-callable granularity is the right level of abstraction.

3. **Both languages validate the need for explicit mutation provenance** — Perl's
   `trigger` and Groovy's lack thereof both point to the same gap that `links` fills.

4. **Dynamic languages add static-like contracts voluntarily** — Perl developers
   universally use `is => 'ro'`/`is => 'rw'`; Groovy developers adopt `@CompileStatic`.
   This validates TypeScript-Go's approach of providing **opt-in behavioral contracts**
   that improve narrowing correctness.

5. **The `identity`/`mutator`/`links` syntax is appropriately precise** — while more
   verbose than Perl's `ro`/`rw`, it handles the full range of callable patterns that
   TypeScript developers need, including call signatures, computed properties, and
   method-style accessors.
