# Design Review: PHP 8 — Typed Properties, Readonly, Enums, and Static Analysis

## Overview

PHP 8.x has undergone a rapid type-system modernization, introducing typed properties,
readonly properties and classes, enums, union and intersection types, and the `match`
expression. While PHP remains dynamically typed at its core (with optional type
declarations enforced at runtime), these features — combined with the static analysis
ecosystem built by PHPStan and Psalm — provide a rich comparison point for
TypeScript-Go's `identity`/`mutator`/`links` system. PHP's readonly semantics are
particularly instructive: they demonstrate both the utility and the limitations of
"write-once" immutability as a narrowing enabler, and they reveal gaps that
TypeScript-Go's more granular approach can address.

---

## 1. Typed Properties — PHP 8.0+

### Declaration Syntax

PHP 8.0 introduced typed property declarations, allowing classes to declare types for
their properties directly:

```php
class User {
    public string $name;
    public int $age;
    public ?string $email;     // nullable — string or null
    public string|int $id;     // union type (PHP 8.0)
}
```

Before PHP 8.0, property types were documented only via `@var` PHPDoc annotations with
no runtime enforcement. Typed properties changed this: PHP now enforces types at
runtime on assignment.

### Nullable Types

PHP uses the `?T` shorthand for nullable types, equivalent to `T|null`:

```php
class Config {
    public ?string $databaseUrl = null;  // explicitly nullable
    public string $appName;              // non-nullable — must be assigned before use
}
```

### Uninitialized State

A crucial subtlety: typed properties have a special "uninitialized" state that is
distinct from `null`. Accessing an uninitialized typed property throws a `TypeError`:

```php
class Example {
    public string $name;  // uninitialized — not null, not ""
}

$e = new Example();
echo $e->name;  // TypeError: Typed property Example::$name must not be accessed
                 // before initialization
```

This three-state model (uninitialized / null / valued) is more complex than
TypeScript's two-state model (undefined-or-type / definite). TypeScript-Go's `identity`
modifier does not need to contend with an "uninitialized" state because TypeScript's
strict property initialization checks (`strictPropertyInitialization`) handle that
concern separately.

### Comparison to TypeScript-Go

| PHP Typed Properties        | TypeScript-Go Analog              | Key Difference                         |
|-----------------------------|-----------------------------------|----------------------------------------|
| `public string $name`       | `name: string`                    | PHP enforces at runtime; TS at compile |
| `public ?string $email`     | `email: string \| null`           | Equivalent semantics                   |
| Uninitialized state         | `strictPropertyInitialization`    | PHP has 3 states; TS has 2             |
| `public string\|int $id`   | `id: string \| number`            | Both support union types               |

PHP's typed properties provide a foundation for narrowing but do not themselves
indicate stability — a typed property can be reassigned at any time. This is the gap
that `readonly` and, in TypeScript-Go, `identity` address.

---

## 2. Readonly Properties — PHP 8.1

### The `readonly` Keyword

PHP 8.1 introduced the `readonly` modifier for properties. A readonly property can be
initialized exactly once (typically in the constructor) and cannot be reassigned
afterward:

```php
class Point {
    public function __construct(
        public readonly float $x,
        public readonly float $y,
    ) {}
}

$p = new Point(3.0, 4.0);
echo $p->x;  // 3.0
$p->x = 5.0; // Error: Cannot modify readonly property Point::$x
```

### Promoted Constructor Parameters

PHP 8.0's constructor promotion combines elegantly with `readonly`:

```php
class User {
    public function __construct(
        public readonly string $name,
        public readonly string $email,
        public readonly ?string $phone = null,
    ) {}
}
```

This is syntactically compact — a single line declares the parameter, the property, its
visibility, and its immutability. TypeScript's `readonly` constructor parameter
shorthand is similar:

```typescript
class User {
    constructor(
        public readonly name: string,
        public readonly email: string,
        public readonly phone: string | null = null,
    ) {}
}
```

### Readonly Semantics: Write-Once, Not Deep

PHP's `readonly` is **shallow** — it prevents reassignment of the property binding, but
does not make the referenced value immutable:

```php
class Container {
    public function __construct(
        public readonly array $items,
    ) {}
}

$c = new Container([1, 2, 3]);
$c->items[] = 4;   // Error: Cannot modify readonly property
$c->items = [4, 5]; // Error: Cannot modify readonly property

// But if the property held an object:
class Wrapper {
    public function __construct(
        public readonly User $user,
    ) {}
}

$w = new Wrapper(new User("Alice", "a@b.c"));
$w->user = new User("Bob", "b@c.d");  // Error: Cannot modify readonly
$w->user->name;  // Accessible — but User::$name is also readonly, so safe
```

### Parallel to `identity`

PHP's `readonly` and TypeScript-Go's `identity` share the same core insight: marking
a read endpoint as stable enables safe narrowing. However, they differ in mechanism:

| Aspect                    | PHP `readonly`                         | TypeScript-Go `identity`              |
|---------------------------|----------------------------------------|---------------------------------------|
| Enforcement               | Runtime — throws on reassignment       | Compile-time — type narrowing only    |
| Granularity               | Per-property only                      | Per-property, per-method, per-getter  |
| Depth                     | Shallow (binding only)                 | Shallow (same as TS `readonly`)       |
| Mutation invalidation     | Not applicable — writes are errors     | `mutator` marks invalidating methods  |
| Selective invalidation    | N/A                                    | `links` targets specific identities   |
| Methods as stable reads   | Not possible                           | `identity get name()` on methods      |

The key advantage of `identity` over `readonly` is that `identity` can be applied to
**methods and getters** — read endpoints that compute values from internal state. PHP's
`readonly` is limited to direct property access. A PHP method like `getDisplayName()`
cannot be marked readonly even if it always returns a stable value derived from readonly
properties.

### Readonly and Narrowing in Practice

PHP itself does not perform flow-based narrowing on readonly properties — it does not
have a type narrowing / smart cast system at the language level. This is left to static
analysis tools (see Section 6). TypeScript-Go, by contrast, integrates `identity`
directly into its flow-based narrowing engine.

---

## 3. Readonly Classes — PHP 8.2

### Syntax and Semantics

PHP 8.2 introduced `readonly class`, which makes every declared property in the class
implicitly `readonly`:

```php
readonly class Coordinate {
    public function __construct(
        public float $latitude,
        public float $longitude,
        public ?string $label = null,
    ) {}
}

// Equivalent to marking each property individually as readonly
// All properties are write-once
```

### Constraints

Readonly classes impose additional restrictions:
- All properties must have a type declaration (no untyped properties)
- Dynamic properties are forbidden (cannot set undeclared properties)
- No default values on properties outside the constructor

```php
readonly class Config {
    public string $name = "default";  // Error on PHP 8.2
    // (This restriction was relaxed in PHP 8.3 — default values are now allowed
    //  if the property type does not require runtime transformation)
}
```

### Inheritance

A readonly class can only be extended by another readonly class:

```php
readonly class Base {
    public function __construct(public string $id) {}
}

readonly class Derived extends Base {
    public function __construct(
        string $id,
        public string $extra,
    ) { parent::__construct($id); }
}

// Non-readonly class cannot extend readonly class — Error
class MutableChild extends Base {}  // Fatal error
```

This ensures the readonly guarantee is not violated by subclasses — a property declared
readonly in a parent cannot be shadowed by a mutable property in a child.

### Comparison to TypeScript-Go

TypeScript-Go does not have a direct equivalent of `readonly class` — there is no
single annotation that makes all properties of a class `identity`. However, a similar
effect can be achieved:

```typescript
// PHP-style readonly class equivalent in TypeScript-Go:
class Coordinate {
    constructor(
        identity readonly latitude: number,
        identity readonly longitude: number,
        identity readonly label: string | null = null,
    ) {}
}
```

The difference is that TypeScript-Go's approach is opt-in per-member, which provides
more flexibility for classes that have a mix of stable and mutable endpoints. PHP's
`readonly class` is all-or-nothing — every property is readonly, which is simpler but
less expressive.

| PHP `readonly class`      | TypeScript-Go Equivalent              |
|---------------------------|---------------------------------------|
| All properties readonly   | Each marked `identity readonly`       |
| Inherited constraint      | No automatic propagation              |
| No mutable properties     | Can mix `identity` and mutable        |
| No method coverage        | `identity` on getters/methods         |

---

## 4. Enums and `match` — PHP 8.1

### Backed Enums

PHP 8.1 introduced first-class enums, optionally backed by `string` or `int`:

```php
enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';
    case Pending = 'pending';
}

enum Color {
    case Red;
    case Green;
    case Blue;
}
```

Backed enums provide a `->value` property that returns the backing value, and a
`Status::from($value)` / `Status::tryFrom($value)` factory method:

```php
$s = Status::from('active');   // Status::Active
$s = Status::tryFrom('oops');  // null (no match)
```

### Enums and Methods

PHP enums can implement interfaces and contain methods:

```php
interface HasLabel {
    public function label(): string;
}

enum Suit: string implements HasLabel {
    case Hearts = 'H';
    case Diamonds = 'D';
    case Clubs = 'C';
    case Spades = 'S';

    public function label(): string {
        return match($this) {
            Suit::Hearts => 'Hearts',
            Suit::Diamonds => 'Diamonds',
            Suit::Clubs => 'Clubs',
            Suit::Spades => 'Spades',
        };
    }
}
```

### The `match` Expression

PHP 8.0 introduced `match`, a strict-comparison expression (uses `===`) that is
exhaustive when used with enums:

```php
function describe(Status $status): string {
    return match($status) {
        Status::Active   => 'User is active',
        Status::Inactive => 'User is inactive',
        Status::Pending  => 'User is pending',
        // No default needed — exhaustive for this enum
    };
}
```

If a case is missing, PHP throws an `UnhandledMatchError` at runtime. Static analysis
tools can detect missing cases at analysis time.

### Parallel to TypeScript Discriminated Unions

TypeScript's discriminated union + switch/exhaustiveness checking serves the same role
as PHP's enum + match:

```typescript
type Status = 'active' | 'inactive' | 'pending';

function describe(status: Status): string {
    switch (status) {
        case 'active': return 'User is active';
        case 'inactive': return 'User is inactive';
        case 'pending': return 'User is pending';
    }
}
```

### Relevance to `identity`

Enum values in PHP are inherently immutable — they are singleton instances. This makes
them naturally "identity-stable": narrowing an enum value is always safe because the
value cannot change. In TypeScript-Go's terms, enum properties would implicitly
satisfy the `identity` contract.

The `match` expression introduces a pattern of **narrowing by value comparison** where
the narrowed type is stable for the duration of the match arm. This is analogous to
how TypeScript-Go preserves narrowing within a control flow branch, provided no
`mutator` call invalidates the narrowed fact.

---

## 5. Union and Intersection Types — PHP 8.0/8.1

### Union Types (PHP 8.0)

PHP 8.0 introduced native union type declarations:

```php
function process(int|string $input): void {
    if (is_string($input)) {
        // $input is narrowed to string (by static analysis tools)
        echo strtoupper($input);
    } else {
        // $input is int
        echo $input * 2;
    }
}

class Result {
    public function __construct(
        public readonly int|string|null $value,
    ) {}
}
```

### Intersection Types (PHP 8.1)

PHP 8.1 added intersection types using `&`:

```php
function process(Countable&Iterator $collection): void {
    // $collection must implement both Countable and Iterator
    echo count($collection);
    foreach ($collection as $item) { /* ... */ }
}
```

### Disjunctive Normal Form (DNF) Types (PHP 8.2)

PHP 8.2 combined union and intersection types in DNF form:

```php
function handle((Countable&Iterator)|null $input): void {
    if ($input !== null) {
        // $input is Countable&Iterator
    }
}
```

### Comparison

| Feature               | PHP 8.x                           | TypeScript                        |
|-----------------------|-----------------------------------|-----------------------------------|
| Union types           | `int\|string` (PHP 8.0)          | `number \| string`               |
| Intersection types    | `A&B` (PHP 8.1)                  | `A & B`                          |
| DNF types             | `(A&B)\|null` (PHP 8.2)          | `(A & B) \| null`                |
| Narrowing             | Runtime only; SA tools do CFA    | Compile-time flow analysis       |
| `identity` relevance  | N/A                               | Narrowing preserved across calls |

The type syntax is remarkably similar. The critical difference is in **narrowing
persistence**: PHP performs no compile-time narrowing itself, delegating this to static
analysis tools. TypeScript-Go's `identity` modifier extends the language's built-in
flow analysis to preserve narrowing across method calls — something PHP's type system
cannot express even with static analysis.

---

## 6. Static Analysis — PHPStan and Psalm

### Overview

Because PHP's type system is enforced at runtime, the static analysis ecosystem has
developed independently to provide compile-time-like type checking. The two major tools
are:

- **PHPStan** (https://phpstan.org) — levels 0-9, progressive strictness
- **Psalm** (https://psalm.dev) — developed at Vimeo, extensive type inference

Both tools perform flow-based narrowing, generic type checking (via PHPDoc), and
mutation tracking — making them the closest PHP analogs to TypeScript-Go's type checker.

### Flow-Based Narrowing

Both PHPStan and Psalm perform type narrowing after type guards:

```php
/**
 * @param string|int $value
 */
function example($value): void {
    if (is_string($value)) {
        // PHPStan/Psalm narrow $value to string
        echo strlen($value);  // OK
    }
    // After the if-block, $value is string|int again
}
```

### Narrowing Invalidation by Mutation

Psalm tracks mutations that invalidate narrowed types:

```php
class Box {
    public string|int $value;

    public function __construct(string|int $value) {
        $this->value = $value;
    }

    public function reset(): void {
        $this->value = 0;
    }
}

function example(Box $box): void {
    if (is_string($box->value)) {
        // $box->value narrowed to string
        $box->reset();
        // Psalm: narrowing invalidated — $box->value is string|int again
        echo strlen($box->value);  // Error: possibly int
    }
}
```

This is directly analogous to TypeScript-Go's `mutator` invalidation:

```typescript
class Box {
    value: string | number;
    mutator reset(): void { this.value = 0; }
}

function example(box: Box): void {
    if (typeof box.value === 'string') {
        // box.value narrowed to string
        box.reset();  // mutator — invalidates narrowing
        box.value;    // string | number again
    }
}
```

### PHPStan `@readonly` and `@immutable`

PHPStan supports `@readonly` and `@immutable` annotations that enable additional
narrowing:

```php
/**
 * @immutable
 */
class Config {
    public function __construct(
        public string $name,
        public int $timeout,
    ) {}
}
```

When a class is annotated `@immutable`, PHPStan can trust that narrowed types on its
properties remain valid across method calls — because no method can modify the
properties.

### Psalm's Mutation Tracking

Psalm has the most sophisticated mutation tracking in the PHP ecosystem. It operates
at several levels:

1. **Property mutation** — direct assignment to properties invalidates narrowing
2. **Method calls** — calls to methods that modify `$this` properties
3. **Reference passing** — passing by reference (`&$param`) invalidates narrowing
4. **Closure capture** — closures that capture variables by reference

```php
function example(Box $box): void {
    assert(is_string($box->value));

    // Psalm tracks that $box->value is string here

    modifyBox($box);  // Does this mutate $box->value? Psalm checks

    // If modifyBox's signature doesn't indicate mutation,
    // Psalm may preserve the narrowing
}
```

### Comparison to `identity`/`mutator`/`links`

| SA Feature                     | TypeScript-Go Equivalent          | Comparison                          |
|--------------------------------|-----------------------------------|-------------------------------------|
| `@readonly` / `@immutable`     | `identity` modifier               | Same intent; TS-Go is language-level|
| Mutation invalidation          | `mutator` modifier                | Psalm infers; TS-Go is explicit     |
| Reference invalidation         | No direct analog                  | TS has no pass-by-reference         |
| Selective invalidation         | `links` clause                    | Psalm doesn't support selective     |
| Level-based strictness         | N/A                               | TS-Go is always strict              |

The key insight from PHPStan/Psalm is that **even without language-level support**,
static analysis tools gravitate toward the same patterns that `identity`/`mutator`
encode. The difference is that TypeScript-Go makes these contracts first-class,
checked by the compiler, and visible in public API signatures.

### Psalm's `@psalm-mutation-free`

Psalm provides a `@psalm-mutation-free` annotation for methods that promises the
method has no side effects on `$this`:

```php
class Calculator {
    private float $value;

    /**
     * @psalm-mutation-free
     */
    public function getValue(): float {
        return $this->value;
    }

    public function add(float $amount): void {
        $this->value += $amount;  // mutates $this
    }
}
```

This is the closest PHP analog to `identity` on a method: `@psalm-mutation-free`
tells Psalm that calling `getValue()` will not change any state, so narrowing based
on a prior type check remains valid after the call. TypeScript-Go's `identity` on a
getter serves the same purpose but is a language-level feature rather than an
annotation consumed by a third-party tool.

---

## 7. Generics RFC — The Long-Awaited Proposal

### Current State

PHP does not have language-level generics. Generic types are expressed only through
PHPDoc annotations and consumed by static analysis tools:

```php
/**
 * @template T
 * @param T $value
 * @return array<T>
 */
function wrap($value): array {
    return [$value];
}

/**
 * @template T
 */
class Collection {
    /** @var list<T> */
    private array $items = [];

    /** @param T $item */
    public function add($item): void {
        $this->items[] = $item;
    }

    /** @return T|null */
    public function first(): mixed {
        return $this->items[0] ?? null;
    }
}
```

### RFC History

Multiple generics RFCs have been proposed for PHP:
- **2016**: Initial discussion, no formal RFC
- **2021**: RFC by Nikita Popov — reified generics, ultimately shelved
- **2023-2025**: Ongoing discussions about erased vs reified generics

The core debate centers on **reified vs erased** generics:
- **Reified**: Type parameters exist at runtime (like C#/Dart). Enables `new T()`,
  `$x instanceof Collection<int>`. Performance cost.
- **Erased**: Type parameters exist only at compile/analysis time (like TypeScript/Java).
  No runtime overhead, but no runtime reflection.

### Relevance to `identity`/`mutator`

Generics interact with `identity` in a critical way: a generic container like
`Collection<T>` needs to express whether its read methods are identity-stable:

```typescript
// TypeScript-Go: identity on a generic method
class Collection<T> {
    identity get(index: number): T { /* ... */ }
    mutator add(item: T): void { /* ... */ }
}
```

If PHP ever adopts generics, the same question arises: can a generic method be marked
`readonly` or `@psalm-mutation-free`? The answer is yes — these annotations are
orthogonal to type parameters. But without language-level narrowing, the benefit is
limited to static analysis tool checks.

The TypeScript-Go approach has an advantage here: because `identity`/`mutator` are
part of the type system, they compose naturally with generics. A `Collection<T>` with
an `identity get()` method allows the compiler to reason about the stability of
returned values across generic boundaries.

---

## 8. Alternative Syntax Ideas — Lessons from PHP 8's Readonly

### PHP's Readonly Creates a Clean Binary

PHP's `readonly` creates a clean, binary distinction: a property is either mutable or
write-once-immutable. This simplicity is both a strength (easy to understand, hard to
misuse) and a weakness (cannot express "stable read but mutated through specific
methods").

### Idea: Readonly as the Default, Mutable as the Exception

PHP 8.2's `readonly class` suggests a design philosophy where immutability is the
default and mutability is explicitly opted into. TypeScript-Go could consider a similar
inversion for narrowing purposes:

```typescript
// Hypothetical: all properties are identity-stable by default
// Only mutating endpoints need annotation
class User {
    name: string;               // implicitly identity (stable read)
    email: string;              // implicitly identity
    mutator setName(n: string): void { this.name = n; }
    mutator setEmail(e: string): void { this.email = e; }
}
```

This mirrors PHP's `readonly class` philosophy but applies it to narrowing contracts
rather than assignment prevention. The trade-off is backward compatibility — existing
TypeScript code assumes properties can be mutated, so defaulting to `identity` would
be a breaking change.

### Idea: `readonly class` as Syntax Sugar

PHP's `readonly class` demonstrates the value of a class-level modifier that
propagates to all members. TypeScript-Go could adopt something similar:

```typescript
// Hypothetical: class-level identity modifier
identity class Config {
    name: string;      // identity (from class modifier)
    timeout: number;   // identity (from class modifier)
    
    get fullName(): string { return this.name; }  // identity (from class modifier)
}
```

This would be sugar for marking every readable member as `identity`, similar to how
PHP's `readonly class` makes every property readonly.

### Idea: PHP Constructor Promotion + Identity

PHP's constructor promotion syntax is clean and widely liked. TypeScript already has
parameter properties, but combining them with `identity` could benefit from PHP's
conciseness:

```typescript
// Current TypeScript-Go:
class Point {
    constructor(
        public identity readonly x: number,
        public identity readonly y: number,
    ) {}
}

// Both `identity` and `readonly` express stability — could they be unified?
// PHP's single `readonly` keyword covers both "no reassignment" and "stable read"
```

### Lesson: Separate Concerns Are Valuable

The most important lesson from PHP's readonly is that **separating read-stability from
write-prevention is valuable**. PHP conflates them — `readonly` means both "cannot be
reassigned" and "safe to cache/narrow". TypeScript-Go separates them:

- `readonly` — prevents reassignment (existing TypeScript)
- `identity` — declares read-stability for narrowing (new)
- `mutator` — declares write-effect for invalidation (new)
- `links` — declares selective invalidation scope (new)

This separation is more expressive. A property can be:
- `readonly` but not `identity` (e.g., backed by a non-deterministic getter in TS)
- `identity` but not `readonly` (e.g., a computed value that is stable but derived
  from mutable state that is only changed through `mutator` methods)

PHP cannot express this distinction — `readonly` is the only tool available.

---

## Summary: PHP 8 ↔ TypeScript-Go Comparison

| Feature                      | PHP 8.x                                  | TypeScript-Go                           |
|------------------------------|------------------------------------------|-----------------------------------------|
| Typed properties             | Runtime-enforced (`string $name`)        | Compile-time (`name: string`)           |
| Immutable binding            | `readonly` property                      | `readonly` modifier                     |
| Read stability for narrowing | `readonly` (implicit); SA tools          | `identity` modifier (explicit)          |
| Mutation tracking            | Psalm `@psalm-mutation-free`             | `mutator` modifier                      |
| Selective invalidation       | Not supported                            | `links` clause                          |
| Immutable class              | `readonly class`                         | Per-member `identity readonly`          |
| Enums                        | First-class (backed, methods)            | String/numeric literal unions           |
| Pattern matching             | `match` expression                       | `switch` + exhaustiveness checking      |
| Union types                  | `A\|B` (runtime)                         | `A \| B` (compile-time)                |
| Intersection types           | `A&B` (runtime)                          | `A & B` (compile-time)                 |
| Generics                     | PHPDoc only (`@template T`)              | Language-level (`<T>`)                  |
| Narrowing engine             | SA tools (PHPStan/Psalm)                 | Built-in flow analysis                  |

### Key Takeaways

1. **PHP's `readonly` validates the core insight behind `identity`**: stable read
   endpoints enable better type narrowing. PHP's readonly is the same principle,
   limited to properties and enforced at runtime.

2. **Static analysis tools independently discovered `mutator` semantics**: Psalm's
   `@psalm-mutation-free` annotation is the same concept as TypeScript-Go's absence of
   `mutator` — both tell the narrowing engine that a method call preserves type facts.

3. **Selective invalidation (`links`) has no PHP analog**: This is a genuine
   innovation in TypeScript-Go. Neither PHP's language features nor its static analysis
   tools can express "this method invalidates narrowing on property X but not
   property Y."

4. **Class-level readonly is syntactically appealing**: PHP 8.2's `readonly class`
   is popular precisely because it eliminates repetition. TypeScript-Go could benefit
   from a similar class-level identity annotation.

5. **The separation of concerns in TypeScript-Go is superior**: PHP conflates
   "cannot be reassigned" and "safe for narrowing" into a single `readonly` keyword.
   TypeScript-Go's three-concept model (`identity`/`mutator`/`links`) provides more
   expressiveness for real-world patterns where these concerns diverge.
