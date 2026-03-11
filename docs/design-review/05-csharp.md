# Design Review: C#'s Properties, Records, and Nullable Analysis vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of C#'s property system, immutability guarantees, pattern matching, and nullable reference types with TypeScript-Go's identity CFA system

---

## 1. Properties (get/set/init) — C#'s Split Accessor Model

### C#'s Model

C# properties are first-class language constructs that split read and write access into distinct accessors with independent visibility and semantics:

```csharp
public class Store
{
    private User? _user;

    public User? User
    {
        get => _user;           // read accessor
        set => _user = value;   // write accessor
    }
}

// Usage looks like a field, but goes through accessors:
store.User = new User("Alice");  // calls set
var u = store.User;              // calls get
```

Each accessor can have independent access modifiers:

```csharp
public class Config
{
    public string Name { get; private set; }  // publicly readable, privately writable

    public Config(string name) => Name = name;
}
```

C# also supports expression-bodied properties and auto-properties with backing field generation:

```csharp
// Auto-property: compiler generates backing field
public string Title { get; set; }

// Read-only auto-property: only settable in constructor
public string Id { get; }

// Computed property: no backing field
public string FullName => $"{FirstName} {LastName}";
```

### Init-Only Setters (C# 9)

C# 9 introduced `init` accessors — a middle ground between `get`-only and `get`/`set`:

```csharp
public class Person
{
    public string Name { get; init; }  // settable only during initialization
    public int Age { get; init; }
}

// Legal: object initializer syntax
var p = new Person { Name = "Alice", Age = 30 };

// Illegal: mutation after construction
p.Name = "Bob";  // ERROR CS8852: Init-only property can only be assigned in an object initializer
```

`init` creates a temporal mutation boundary: the property is writable during construction, then permanently read-only. The compiler enforces this boundary statically.

### Comparison with `identity`/`mutator`

The C# property model maps remarkably well onto `identity`/`mutator`:

| C# Accessor | TypeScript-Go Equivalent | Semantic |
|-------------|-------------------------|----------|
| `get` accessor | `identity` callable | Stable read endpoint |
| `set` accessor | `mutator` callable | Write endpoint that invalidates reads |
| `init` accessor | No direct equivalent | Write-once-then-read-only |
| `get`-only property | `identity` without any linked `mutator` | Permanently stable |
| `get`/`private set` | `identity` + `mutator` with restricted scope | Controlled invalidation |

```typescript
// TypeScript-Go equivalent of C# property
interface Store {
    identity user(): User | undefined;
    mutator setUser(v: User | undefined) links user;
}

// Morally equivalent C#:
// public User? User { get; set; }
```

### Key Insight: Accessor-Level Granularity

C# proves that developers intuitively understand split read/write semantics. The `get`/`set`/`init` model has been in C# since version 1.0 (2002), and the language community has never questioned the fundamental split — it's considered natural.

TypeScript-Go's `identity`/`mutator` is semantically the same split, applied to callable getters rather than field-like properties. The difference is that TypeScript functions don't have built-in accessor syntax, so the split must be expressed through type modifiers rather than accessor keywords.

C#'s `init` is particularly interesting because it introduces a **temporal boundary** — a concept TypeScript-Go could potentially express via conditional `links` semantics (a mutator that only invalidates during a specific lifecycle phase). This is not in scope for Phase 1 but is conceptually compatible.

---

## 2. `readonly` Fields and `readonly` Structs — Compile-Time Immutability

### C#'s Model

C# has multiple layers of immutability enforcement:

**`readonly` fields** — assignable only in the constructor or at declaration:

```csharp
public class Config
{
    public readonly string ConnectionString;

    public Config(string cs)
    {
        ConnectionString = cs;  // OK: constructor assignment
    }

    public void Update()
    {
        ConnectionString = "new";  // ERROR: readonly field
    }
}
```

**`readonly struct`** (C# 7.2) — the entire struct is immutable. All fields must be `readonly`, and no method can mutate state:

```csharp
public readonly struct Point
{
    public double X { get; }  // implicitly readonly
    public double Y { get; }

    public Point(double x, double y) => (X, Y) = (x, y);

    public double DistanceTo(Point other) =>
        Math.Sqrt(Math.Pow(X - other.X, 2) + Math.Pow(Y - other.Y, 2));
}
```

**`readonly` members** (C# 8) — individual methods/properties on mutable structs can be marked `readonly`, promising they don't mutate:

```csharp
public struct Rect
{
    public double Width { get; set; }
    public double Height { get; set; }

    // This method promises not to mutate the struct
    public readonly double Area => Width * Height;

    // Compiler error if a readonly method tries to mutate:
    public readonly void Broken()
    {
        Width = 0;  // ERROR: cannot assign in readonly member
    }
}
```

The compiler also generates warnings when a non-`readonly` method is called on a `readonly` reference, because the struct is defensively copied:

```csharp
readonly Rect r = new Rect { Width = 10, Height = 20 };
var a = r.Area;       // OK: Area is readonly — no defensive copy
r.ToString();         // WARNING: ToString() is not readonly — defensive copy generated
```

### Comparison with `identity`

| Concept | C# `readonly` | TypeScript-Go `identity` |
|---------|---------------|-------------------------|
| **Scope** | Field/struct/member | Callable return type |
| **Enforcement** | Hard reject — compile error | Soft — narrowing loss |
| **Granularity** | Per-field or whole-struct | Per-callable |
| **Transitive** | `readonly struct` is deeply immutable | `identity` only marks the endpoint, not transitively |
| **Defensive copying** | Compiler copies to preserve readonly guarantee | Not applicable — JS has no value types |

C#'s `readonly` is a **structural guarantee** — the compiler proves no mutation is possible. TypeScript-Go's `identity` is a **behavioral contract** — the developer asserts that repeated calls return the same narrowed type. This difference stems from the fundamental distinction: C# has value types with copy semantics, while JavaScript has only reference types.

### The Defensive Copy Problem

C#'s defensive copying when calling non-`readonly` methods on `readonly` references is instructive. It shows what happens when an immutability system encounters an operation with unknown mutation effects: the system must either reject, copy defensively, or lose guarantees.

TypeScript-Go chose the "lose guarantees" path (widen the type), which is the right choice for JavaScript's domain. Rejecting would be too strict for dynamic JS. Defensive copying is impossible for reference types. Widening is safe, predictable, and recoverable (assign to a local variable).

---

## 3. Records and `with`-Expressions — Immutable-by-Default Value Types

### C#'s Model

C# 9 introduced `record` types — reference types with value semantics and immutable-by-default properties:

```csharp
public record Person(string Name, int Age);

// Desugars to:
// public class Person
// {
//     public string Name { get; init; }
//     public int Age { get; init; }
//     public bool Equals(Person? other) => ...  // value equality
//     public override int GetHashCode() => ...
//     public override string ToString() => $"Person {{ Name = {Name}, Age = {Age} }}";
//     public Person(Person original) { ... }    // copy constructor
// }
```

Records use `init`-only properties by default, making them immutable after construction. Mutation is expressed through `with`-expressions, which create new instances:

```csharp
var alice = new Person("Alice", 30);
var olderAlice = alice with { Age = 31 };  // new instance; alice unchanged

// alice.Name == "Alice", alice.Age == 30     — unchanged
// olderAlice.Name == "Alice", olderAlice.Age == 31  — new instance
```

C# 10 added `record struct` — value-type records with similar semantics:

```csharp
public record struct Point(double X, double Y);
// Mutable by default (unlike reference records), but has value equality.
// Use readonly record struct for immutable:
public readonly record struct ImmutablePoint(double X, double Y);
```

### How Records Relate to `identity`

Records describe a pattern where **reads are always stable** because mutation creates a new object rather than modifying the existing one. In `identity` terms:

```typescript
// If TypeScript had record-like immutability:
interface PersonRecord {
    identity name(): string;      // always stable — no mutator exists
    identity age(): number;       // always stable — no mutator exists
}

// "Mutation" returns a new object:
function withAge(p: PersonRecord, age: number): PersonRecord { ... }
```

The key insight is that records eliminate the need for `mutator`/`links` entirely by making all endpoints implicitly `identity` with no invalidation possible. This is the extreme point on the spectrum:

| Pattern | Reads | Writes | Invalidation |
|---------|-------|--------|-------------|
| C# record (immutable) | Always stable | Create new instance | Never — no in-place mutation |
| `identity` + `mutator` + `links` | Stable until invalidated | In-place via mutator | Selective via `links` |
| Untyped JavaScript | Unknown stability | Anywhere, anytime | Always (conservative) |

TypeScript-Go sits in the middle: it cannot enforce record-style immutability (JavaScript allows any mutation), but `identity`/`mutator` lets developers express which reads are stable and which writes invalidate them. Records prove the concept works at one extreme; TypeScript-Go generalizes it to the mutable world.

### `with`-Expressions and Functional Update Patterns

C#'s `with` syntax is interesting because it expresses a **non-invalidating write** — a write that creates a new value without affecting the original. In TypeScript-Go terms, a function that takes an identity-typed parameter and returns a new instance of the same type would not need the `mutator` modifier:

```typescript
// Not a mutator — creates new value, does not invalidate original
function withAge(p: { identity age(): number }, newAge: number): typeof p { ... }

// Original narrowing is preserved:
const person = getPersonRecord();
if (person.age() > 18) {
    const updated = withAge(person, 25);
    person.age();  // narrowing still valid — person was not mutated
}
```

This aligns with the principle that only **in-place mutations** should carry `mutator` semantics.

---

## 4. Pattern Matching — Narrowing by Pattern

### C#'s Model

C# has evolved a rich pattern matching system across versions 7–11:

**Type patterns** (C# 7):
```csharp
object obj = GetValue();
if (obj is string s)
{
    Console.WriteLine(s.Length);  // s is narrowed to string
}
```

**Switch expressions** (C# 8):
```csharp
string Describe(object obj) => obj switch
{
    int n when n > 0 => $"Positive: {n}",
    int n            => $"Non-positive: {n}",
    string s         => $"String: {s}",
    null             => "null",
    _                => "unknown"
};
```

**Property patterns** (C# 8):
```csharp
bool IsOrigin(Point p) => p is { X: 0, Y: 0 };

string Classify(Person p) => p switch
{
    { Age: < 18 }             => "minor",
    { Age: >= 18, Name.Length: > 0 } => "named adult",
    _                         => "unknown"
};
```

**List patterns** (C# 11):
```csharp
string Describe(int[] arr) => arr switch
{
    []           => "empty",
    [var x]      => $"single: {x}",
    [var x, ..]  => $"starts with {x}",
};
```

**Relational and logical patterns** (C# 9):
```csharp
string Classify(double temp) => temp switch
{
    < 0   => "freezing",
    >= 0 and < 20 => "cold",
    >= 20 and < 35 => "warm",
    >= 35 => "hot"
};
```

### Narrowing Stability in Patterns

C# pattern matching introduces bindings that are **inherently stable** within their scope — the matched variables cannot be reassigned:

```csharp
if (obj is string s)
{
    // s is string — this is a fresh binding, not an alias
    // s cannot be invalidated because it's a new local variable
    s.ToUpper();  // always safe
}
```

This is different from TypeScript's narrowing, which narrows the original reference and can be invalidated:

```typescript
function process(obj: string | number) {
    if (typeof obj === "string") {
        obj.toUpperCase();  // narrowed — but obj could be reassigned
        obj = 42;           // legal in TS, invalidates narrowing
    }
}
```

### Comparison with `identity`

Pattern matching and `identity` solve different but complementary problems:

| Dimension | C# Pattern Matching | TypeScript-Go `identity` |
|-----------|-------------------|-------------------------|
| **What's narrowed** | A value captured at a point in time | A callable's repeated return value |
| **Stability source** | Fresh binding (new variable) | Declared contract (identity modifier) |
| **Invalidation possible** | No — pattern bindings are immutable | Yes — mutator calls invalidate |
| **Expressiveness** | Rich structural/relational decomposition | Type narrowing through control flow |

C# patterns prove that **creating fresh stable bindings** is a sound approach to narrowing. TypeScript-Go's equivalent is the "assign to local" escape hatch: when developers can't rely on `identity` narrowing surviving a mutator, they capture the value in a local variable — which is essentially what C# pattern matching does automatically.

---

## 5. Nullable Reference Types (NRT) — Flow-Sensitive Null Checking

### C#'s Model

C# 8 introduced nullable reference types (NRT), adding flow-sensitive null analysis to reference types that were previously always nullable:

```csharp
#nullable enable

string name = null;    // WARNING CS8600: Converting null to non-nullable type
string? name2 = null;  // OK: explicitly nullable

void Greet(string? name)
{
    Console.WriteLine(name.Length);  // WARNING: possible null dereference

    if (name != null)
    {
        Console.WriteLine(name.Length);  // OK: narrowed to non-null
    }
}
```

NRT analysis is flow-sensitive — the compiler tracks null state through assignments, conditions, and method calls:

```csharp
void Process(string? input)
{
    if (input == null) return;

    // From here, input is known non-null
    Console.WriteLine(input.Length);  // OK

    input = GetValue();  // might return null
    Console.WriteLine(input.Length);  // WARNING again — assignment invalidated narrowing
}
```

### Null-State Invalidation Rules

C#'s NRT system invalidates null narrowing in situations closely paralleling TypeScript-Go's identity invalidation:

1. **Assignment to the variable:**
```csharp
string? s = GetValue();
if (s != null)
{
    s = AnotherValue();  // invalidates non-null narrowing
    s.Length;             // WARNING: possible null
}
```

2. **Calling a method that might change state** — C# uses `[MemberNotNull]` and `[MemberNotNullWhen]` attributes:
```csharp
class Container
{
    private string? _value;

    [MemberNotNull(nameof(_value))]
    public void Initialize() => _value = "default";

    [MemberNotNullWhen(true, nameof(_value))]
    public bool HasValue => _value != null;
}
```

3. **`MaybeNull` / `NotNull` annotations on out/ref parameters:**
```csharp
bool TryGetValue(string key, [MaybeNullWhen(false)] out string value);
```

### Comparison with `identity`/`mutator`

NRT and `identity` are solving the same fundamental problem — **flow-sensitive state tracking with invalidation** — but for different state dimensions:

| Aspect | C# NRT | TypeScript-Go `identity` |
|--------|--------|-------------------------|
| **Tracked state** | Null vs non-null | Full type narrowing |
| **Narrowing trigger** | Null check (`if (x != null)`) | Type check/narrowing condition |
| **Invalidation** | Assignment, method calls | `mutator` calls, uncertainty boundaries |
| **Annotations** | `?`, `[MemberNotNull]`, `[MaybeNull]` | `identity`, `mutator`, `links` |
| **Granularity** | Whole-variable null state | Per-endpoint narrowing facts |
| **Enforcement** | Warnings (not errors by default) | Type widening (soft) |

**Key parallel: `[MemberNotNull]` ≈ `links`**

C#'s `[MemberNotNull(nameof(Field))]` attribute declares: "After this method returns, `Field` is guaranteed non-null." This is the positive inverse of TypeScript-Go's `links`: where `links` says "this mutator invalidates these endpoints," `[MemberNotNull]` says "this method validates these fields."

Both systems provide per-member granularity for state flow analysis. Both require the developer to declare the relationship between a method and the fields it affects.

```csharp
// C#: Positive guarantee — after Init(), _name is non-null
[MemberNotNull(nameof(_name))]
void Init() => _name = "default";
```

```typescript
// TypeScript-Go: Negative guarantee — after setUser(), user() narrowing is invalidated
interface Store {
    identity user(): User | undefined;
    mutator setUser(v: User | undefined) links user;
}
```

Both are declaration-site metadata that the compiler consumes during flow analysis. The conceptual pattern is identical; only the polarity differs (establish guarantee vs. invalidate guarantee).

---

## 6. `INotifyPropertyChanged` — WPF/MAUI Reactive Pattern

### C#'s Model

`INotifyPropertyChanged` (INPC) is the foundational reactive pattern in .NET UI frameworks (WPF, MAUI, UWP, Avalonia):

```csharp
public class ViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    private string _name = "";
    public string Name
    {
        get => _name;
        set
        {
            if (_name != value)
            {
                _name = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Name)));
            }
        }
    }

    private int _age;
    public int Age
    {
        get => _age;
        set
        {
            if (_age != value)
            {
                _age = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Age)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsAdult)));
            }
        }
    }

    public bool IsAdult => Age >= 18;  // derived/computed property
}
```

**Key characteristics:**
- The `set` accessor notifies which properties changed using string-based property names
- Computed properties (`IsAdult`) must manually fire change notifications for their dependencies
- The binding system subscribes to `PropertyChanged` and re-reads the property value

### INPC Dependency Tracking vs `links`

INPC's notification pattern is semantically close to `mutator`/`links`:

| Concept | C# INPC | TypeScript-Go |
|---------|---------|---------------|
| Stable read | Property `get` accessor | `identity` callable |
| Invalidating write | Property `set` accessor | `mutator` callable |
| Invalidation scope | `PropertyChanged` events with property names | `links` clause listing affected endpoints |
| Dependency tracking | Manual (developer lists which properties are affected) | Manual (`links` lists affected identity endpoints) |

```csharp
// C# INPC: Setting Age invalidates Age AND IsAdult
set {
    _age = value;
    OnPropertyChanged(nameof(Age));      // links Age
    OnPropertyChanged(nameof(IsAdult));  // links IsAdult
}
```

```typescript
// TypeScript-Go: Setting age invalidates age AND isAdult
interface ViewModel {
    identity age(): number;
    identity isAdult(): boolean;
    mutator setAge(v: number) links age, isAdult;
}
```

The structural similarity is striking. Both require the developer to manually declare which read endpoints are invalidated by a write. Both are declaration-site metadata consumed by a consumer (UI framework / type checker).

### INPC vs Signals

INPC predates modern signal-based reactive systems but shares the core concept: **read/subscribe/invalidate**. Modern .NET (MAUI) increasingly uses source generators to automate INPC boilerplate:

```csharp
// With CommunityToolkit.Mvvm source generator:
[ObservableProperty]
private string _name = "";

// Generates:
// public string Name { get => _name; set => SetProperty(ref _name, value); }
// Including PropertyChanged notifications
```

Signal frameworks (Solid, Angular, Preact Signals) take this further with automatic dependency tracking. TypeScript-Go's `identity`/`mutator`/`links` is positioned between INPC (manual declaration) and signals (automatic tracking) — it uses manual declaration for soundness while enabling compiler-enforced narrowing that neither INPC nor signals provide.

---

## 7. Roslyn Analyzers — Custom Analysis Rules

### C#'s Model

Roslyn, the C# compiler platform, exposes a rich analyzer API that lets developers write custom compile-time rules:

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public class ImmutabilityAnalyzer : DiagnosticAnalyzer
{
    private static readonly DiagnosticDescriptor Rule = new(
        id: "IMM001",
        title: "Property should be immutable after initialization",
        messageFormat: "Property '{0}' is modified after construction",
        category: "Immutability",
        defaultSeverity: DiagnosticSeverity.Warning,
        isEnabledByDefault: true);

    public override void Initialize(AnalysisContext context)
    {
        context.RegisterOperationAction(AnalyzeAssignment, OperationKind.SimpleAssignment);
    }

    private void AnalyzeAssignment(OperationAnalysisContext context)
    {
        // Analyze the assignment target — flag if it targets an [Immutable] property
        // after the constructor scope...
    }
}
```

Analyzers can enforce arbitrary semantic rules at compile time, including:
- Immutability contracts beyond what the language provides
- API usage patterns ("always call Dispose after using this type")
- Concurrency safety rules ("don't access this field without a lock")
- Data flow properties ("this value must be validated before use")

### Could Analyzers Enforce Identity-Like Contracts?

In C#, an analyzer *could* enforce identity-like narrowing behavior:

1. **Detect read/write pairs**: Identify properties that serve as getter/setter pairs on a type
2. **Track narrowing**: After a null check on `obj.Prop`, track that the value was narrowed
3. **Detect invalidation**: If a setter is called on the same object, report that the narrowing may be stale
4. **Flag stale reads**: Warn if narrowed value is used after a potential invalidation

However, Roslyn analyzers have significant limitations compared to built-in compiler analysis:

| Capability | Built-in Compiler (TypeScript-Go) | Roslyn Analyzer |
|-----------|----------------------------------|-----------------|
| CFA integration | Full access to flow graph | Must reconstruct from syntax/operations |
| Type narrowing | Can modify narrowed types | Can only report diagnostics |
| Cross-method analysis | In scope for CFA | Expensive, typically avoided |
| Performance budget | Core compiler — aggressive optimization | Must be fast to avoid IDE lag |
| User trust | Errors are trusted | Warnings are often ignored |
| Configurability | Modifiers are opt-in per declaration | Rules apply globally unless suppressed |

**Verdict:** Roslyn analyzers could *approximate* identity-like analysis, but doing it as a first-class compiler feature (as TypeScript-Go does) provides better integration, performance, and developer trust. The C# ecosystem validates that developers want this kind of analysis but shows that bolting it on as an afterthought is inferior to building it into the type system.

The lesson for TypeScript-Go: making `identity`/`mutator` a first-class part of the type system rather than an ESLint rule or TypeScript plugin is the right architectural decision. C#'s experience with Roslyn analyzers shows that plugins can enforce local rules but cannot provide the deep CFA integration needed for reliable narrowing.

---

## 8. Alternative Syntax Ideas from C# — Could TypeScript Use `get`/`set`/`init`?

### C#-Inspired Syntax Alternatives

C#'s accessor syntax is deeply established and widely recognized. What would TypeScript-Go's identity system look like with C#-style accessor syntax?

**Option A: Accessor modifiers on interface members**
```typescript
// Hypothetical C#-inspired syntax
interface Store {
    get user(): User | undefined;   // identity — read endpoint
    set user(v: User): void;        // mutator — write endpoint, implicitly links user
    init config(v: Config): void;   // write-once — mutator only during initialization
}
```

**Option B: Property-style declaration with inline accessors**
```typescript
// Even more C#-like
interface Store {
    user: {
        get(): User | undefined;
        set(v: User): void;
    };
}
```

**Option C: Paired accessor declarations (closest to actual C#)**
```typescript
// C# style where get/set are sub-declarations
interface Store {
    property user: User | undefined {
        get;          // readable
        set;          // writable — implicitly invalidates this property
    }
}
```

### Why TypeScript-Go Chose Differently

TypeScript-Go's `identity`/`mutator` modifiers are applied to **callable types**, not property-like declarations. This is the right choice for JavaScript for several reasons:

1. **JavaScript doesn't have properties on interfaces**: Unlike C#, JavaScript interfaces (in TypeScript's sense) describe method signatures, not getter/setter accessors. Adding C#-style property syntax would require a new declaration form.

2. **Not all getters are properties**: In JavaScript APIs, stable read endpoints include methods like `array.length`, `map.size`, `element.tagName`, and custom methods like `store.getUser()`. C#'s property syntax assumes a name-based getter/setter pair, but JavaScript APIs use diverse naming conventions.

3. **Multiple mutators for one identity**: C#'s property model assumes one setter per property. TypeScript-Go's `links` clause allows *multiple* mutators to affect the *same* identity endpoint, and one mutator to affect *multiple* endpoints — this many-to-many relationship doesn't fit C#'s paired accessor model.

4. **Callable type modifiers compose**: `identity` and `mutator` are type-level modifiers that work on any callable type — function types, method signatures, overloaded declarations. C#'s `get`/`set` only works on property declarations.

### What TypeScript-Go Could Borrow

Despite choosing a different primary syntax, there are C#-inspired ideas worth considering:

**`init`-like semantics**: A modifier indicating "this mutator is only valid during construction" could be expressed as:
```typescript
interface Config {
    identity name(): string;
    mutator setName(v: string) links name;  // only callable in constructor context
}
```
This would require lifecycle-aware CFA, which is out of scope for Phase 1 but conceptually sound.

**`readonly` as an alternative to `identity` for simple cases**: For APIs where the read endpoint is a simple property (not a callable), TypeScript already has `readonly`. The `identity` modifier extends this concept to callables:

```typescript
interface Simple {
    readonly name: string;           // existing TS: no setter possible
    identity getName(): string;      // identity: callable, stable
}
```

The existing `readonly` modifier for properties and `identity` for callables form a coherent pair — `readonly` prevents writes to a property, `identity` enables narrowing reuse for a callable return value.

### Syntax Comparison Summary

| Syntax Family | Example | Pros | Cons |
|---------------|---------|------|------|
| C# `get`/`set` | `get user(): User` | Familiar to C# developers, clear intent | Doesn't model many-to-many links; poor fit for callable APIs |
| TypeScript-Go `identity`/`mutator` | `identity user(): User` | Composable, works on any callable, supports `links` | New keyword to learn |
| Swift `mutating` | `mutating setUser(...)` | Clear mutation marking | Only marks the mutator, no read contract |
| Rust `&`/`&mut` | N/A | Maximum safety | Far too strict for JavaScript |
| C# `init` | `init user(v: User)` | Covers write-once pattern | Requires lifecycle model |

---

## Summary: What C# Teaches TypeScript-Go

C# provides the richest comparison point for TypeScript-Go's `identity`/`mutator`/`links` system because C# has deeply explored the split between read and write access at the language level:

1. **Properties validate the getter/setter split**: C#'s 20+ year success with `get`/`set` proves developers naturally think in terms of read vs write endpoints with different semantics.

2. **`init` shows temporal boundaries are useful**: Write-once semantics are a common pattern that TypeScript-Go could eventually express through lifecycle-aware `mutator` semantics.

3. **Records show the immutability extreme**: When mutation creates new values instead of modifying existing ones, all reads are inherently stable — this is the end goal for functional patterns.

4. **NRT's `[MemberNotNull]` is the dual of `links`**: Both systems provide per-member granularity for method-to-field state relationships, just with opposite polarity (establish vs invalidate).

5. **INPC independently discovered the same `links` pattern**: Manual declaration of which writes affect which reads is a proven, widely-used pattern in reactive UI frameworks.

6. **Roslyn analyzers show that first-class compiler support wins**: Plugin-based analysis can approximate identity-like contracts but cannot match the quality of built-in CFA integration.

7. **C#'s accessor syntax doesn't generalize to callables**: TypeScript-Go's modifier-based approach is more flexible than C#'s property-based approach for JavaScript's callable-heavy API design.

TypeScript-Go's design choice to use callable-level modifiers (`identity`/`mutator`) with explicit dependency declarations (`links`) is well-validated by C#'s experience. The system is structurally isomorphic to C#'s property model but generalized to JavaScript's calling conventions and API patterns.
