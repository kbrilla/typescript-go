# Design Review: Haskell's Pure Functions, Mutable References, Lenses, and Effect Systems vs TypeScript-Go's `identity`/`mutator`/`links`

## Document Control
- Status: Research Analysis
- Audience: TypeScript language/design contributors, checker implementers
- Scope: Cross-language comparison of Haskell's approach to purity, mutable state, fine-grained access, and type-level mutation tracking with TypeScript-Go's identity CFA system

---

## 1. Pure Functions and Referential Transparency — Haskell's Core Stability Guarantee

### Haskell's Model

Haskell enforces referential transparency as a language-level invariant: every function in Haskell is pure by default. A pure function always returns the same result for the same arguments, and has no observable side effects:

```haskell
double :: Int -> Int
double x = x + x

-- Calling double 5 always returns 10, anywhere, any time.
-- The compiler can freely substitute double 5 with 10 (equational reasoning).
```

This guarantee is **structural**, not declarative — purity is enforced by the type system. A function that performs IO must have `IO` in its return type:

```haskell
readFile :: FilePath -> IO String    -- impure: returns IO action
length   :: [a] -> Int               -- pure: no IO in type

-- The compiler REJECTS this:
-- badPure :: Int -> Int
-- badPure x = do { putStrLn "side effect"; return (x + 1) }
-- ERROR: Couldn't match type 'IO' with 'Int'
```

There is no way to "escape" IO — once a value is wrapped in IO, it stays in IO forever. This is enforced by the monad abstraction:

```haskell
-- You cannot extract a pure value from IO without staying in IO:
main :: IO ()
main = do
  contents <- readFile "data.txt"   -- contents :: String, but only inside IO
  let len = length contents          -- pure computation on extracted value
  print len                          -- back to IO for output
```

### Direct Parallel to `identity`

The `identity` modifier encodes a weaker version of the same guarantee:

| Aspect | Haskell Pure Functions | TypeScript-Go `identity` |
|--------|----------------------|------------------------|
| **Guarantee** | Same inputs → same output, always | Repeated calls → same narrowed type within flow region |
| **Scope** | Global and permanent | Local to CFA flow region, until mutator |
| **Enforcement** | Structural (type system rejects impure in pure context) | Declarative (developer asserts stability) |
| **Invalidation** | Cannot occur — pure functions have no state | `mutator` calls, uncertainty boundaries |
| **Side effects** | Impossible in pure context | Possible but irrelevant if return type is stable |
| **Equational reasoning** | Full — `f x` can be replaced by its result | Partial — `read()` can reuse narrowed type, not arbitrary substitution |

The critical difference: Haskell's purity makes **all** function calls narrowing-safe by default. TypeScript's `identity` opts specific callables into a narrowing-safe contract for a much weaker guarantee — not "this function is pure" but "this function's return type is stable enough for narrowing."

### Why Haskell Doesn't Need `identity`

In Haskell, given:

```haskell
getValue :: Maybe String
getValue = Just "hello"
```

The expression `getValue` is referentially transparent — every occurrence of `getValue` can be substituted by `Just "hello"`. Pattern matching on `getValue` carries its narrowing forward unconditionally:

```haskell
case getValue of
  Just s  -> toUpper s      -- s is String, guaranteed
  Nothing -> "default"
```

There is no concept of "invalidation" because there is no mutation. Haskell's entire paradigm eliminates the need for `identity` — but at the cost of requiring all state manipulation through monadic wrappers.

TypeScript cannot adopt this approach because JavaScript is fundamentally imperative. The `identity` modifier is the pragmatic middle ground: explicit opt-in to the stability guarantee that Haskell gets for free.

---

## 2. IORef/STRef/MVar — Mutable References in Controlled Contexts

### IORef — Mutable Variables in IO

Haskell's `IORef` provides mutable reference cells, but only accessible within the `IO` monad:

```haskell
import Data.IORef

main :: IO ()
main = do
  ref <- newIORef (42 :: Int)   -- create mutable cell
  val <- readIORef ref           -- read: val = 42
  writeIORef ref 99              -- write: ref now holds 99
  val2 <- readIORef ref          -- read: val2 = 99
  modifyIORef ref (+1)           -- modify: ref now holds 100
  print val2                     -- prints 99 (val2 is bound, not aliased)
```

Key characteristics:
- `readIORef` returns the current value — each call can return a different result.
- `writeIORef` mutates the reference — subsequent reads reflect the change.
- The mutable state is **quarantined** in IO — pure code cannot observe it.
- Each `<-` binding creates an independent snapshot — `val` is not affected by later writes.

### STRef — Mutable Variables with Scoped Escape

`ST` (State Thread) provides mutable references that can be used in otherwise pure code, via the `runST` escape hatch:

```haskell
import Control.Monad.ST
import Data.STRef

pureSum :: [Int] -> Int
pureSum xs = runST $ do
  ref <- newSTRef 0
  mapM_ (\x -> modifySTRef ref (+x)) xs
  readSTRef ref

-- pureSum [1,2,3] = 6
-- Despite using mutation internally, the result is pure!
-- The rank-2 type of runST prevents refs from escaping.
```

The type of `runST` uses a rank-2 type to prevent mutable references from leaking:

```haskell
runST :: (forall s. ST s a) -> a
```

The phantom type variable `s` ensures that `STRef s Int` created inside one `runST` block cannot be used in another — the type system statically prevents reference escape.

### MVar — Concurrent Mutable Variables

`MVar` provides thread-safe mutable containers:

```haskell
import Control.Concurrent.MVar

main :: IO ()
main = do
  mvar <- newMVar (0 :: Int)     -- create with initial value
  val <- readMVar mvar            -- read without taking
  takeMVar mvar >>= \v ->         -- take (blocks if empty)
    putMVar mvar (v + 1)          -- put back modified
```

### Comparison with Signal Read/Write

The IORef/STRef model maps directly onto the signal pattern:

| Haskell | TypeScript-Go Signals | Semantic |
|---------|----------------------|----------|
| `readIORef ref` | `identity read()` | Read current value from mutable cell |
| `writeIORef ref v` | `mutator set(v)` | Write new value to mutable cell |
| `modifyIORef ref f` | `mutator update(f)` | Apply function to current value |
| `newIORef v` | `createSignal(v)` | Create mutable cell with initial value |
| IO monad quarantine | CFA region tracking | Context where mutation effects are tracked |
| `<-` binding (snapshot) | `const local = read()` | Capture current value independently of future mutations |

The deepest parallel is between Haskell's `<-` binding and TypeScript's "assign to local variable" workaround:

```haskell
-- Haskell: each <- creates an independent binding
val <- readIORef ref
writeIORef ref 99
-- val is still 42 — immune to the write
```

```typescript
// TypeScript: assign to local to "snapshot" the value
const val = read();
set(99);
// val is still the pre-write value
```

TypeScript's workaround is exactly what `identity` eliminates the need for — the modifier tells CFA that repeated reads without an intervening mutator return a stable type, avoiding the need to manually snapshot.

### The ST Rank-2 Type Parallel

ST's rank-2 type prevents mutable references from escaping their scope. TypeScript-Go's CFA uncertainty boundaries serve an analogous purpose — they prevent narrowed identity facts from "escaping" into contexts where mutation could have occurred:

| ST scope enforcement | TypeScript-Go uncertainty boundaries |
|---------------------|--------------------------------------|
| `runST` creates a sealed scope | CFA flow region bounds narrowing |
| Rank-2 type prevents ref escape | Uncertainty boundaries (callback, await, alias escape) drop facts |
| Pure result guaranteed | Conservative type with widened type guaranteed |
| Scope violation = type error | Boundary crossing = narrowing loss |

---

## 3. Lens Library (van Laarhoven/Optics) — Fine-Grained Field Access

### Van Laarhoven Lenses

Haskell's lens library (originally by Edward Kmett) provides composable optics for accessing and modifying nested immutable data. The van Laarhoven encoding represents a lens as a higher-rank function:

```haskell
type Lens s t a b = forall f. Functor f => (a -> f b) -> s -> f t
type Lens' s a = Lens s s a a  -- simple lens (no type change)
```

In practice, lenses are used with combinators:

```haskell
import Control.Lens

data Address = Address { _street :: String, _city :: String }
data Person  = Person  { _name :: String, _address :: Address }

makeLenses ''Person   -- generates: name, address
makeLenses ''Address  -- generates: street, city

-- Read (view/^.)
view (address . city) alice            -- "Springfield"
alice ^. address . city                -- "Springfield"

-- Write (set/.~)
set (address . city) "Shelbyville" alice    -- new Person with city changed
alice & address . city .~ "Shelbyville"     -- same, using operator syntax

-- Modify (over/%~)
over (address . city) toUpper alice         -- new Person with city uppercased
alice & address . city %~ toUpper           -- same, using operator syntax
```

### Optic Hierarchy

Haskell's lens library provides a rich hierarchy of optics, each with different focus cardinality:

| Optic | Focus | Get | Set | TypeScript-Go Analogy |
|-------|-------|-----|-----|-----------------------|
| `Iso` | Exactly 1 (bijection) | Total | Total | Type alias / newtype wrapper |
| `Lens` | Exactly 1 field | Total | Total | `identity` read + `mutator links` write on one field |
| `Prism` | 0 or 1 (sum type case) | Partial (`Maybe`) | Total | Discriminated union narrowing |
| `Traversal` | 0 or many | List | Modify all | Mapped identity reads over a collection |
| `Getter` | Exactly 1 (read-only) | Total | — | `identity` without any mutator |
| `Fold` | 0 or many (read-only) | List | — | Multiple identity reads |
| `Setter` | Exactly 1 (write-only) | — | Total | `mutator` without identity |
| `Review` | Sum injection (write-only) | — | Total | Constructor / factory |

### Comparison with `links`

Lenses and `links` solve the same fundamental problem: **declaring which writes affect which reads**.

A lens encodes this structurally — `Lens' Person String` with the path `address . city` carries the full read/write relationship in the type and composition chain. The library knows that modifying through `address . city` affects reads through `address . city` but not through `name`:

```haskell
-- Structural: composition encodes the relationship
let moved = alice & address . city .~ "Shelbyville"
-- The lens library knows this write targets address.city
-- and does NOT affect name
```

TypeScript-Go's `links` encodes this declaratively:

```typescript
interface Person {
  identity name(): string;
  identity city(): string;

  mutator setCity(c: string) links city;   // explicitly declares: affects city, not name
}
```

| Aspect | Haskell Lens Composition | TypeScript-Go `links` |
|--------|------------------------|----------------------|
| **Relationship source** | Derived from composition path | Declared explicitly in `links` clause |
| **Granularity** | Arbitrary depth via composition | Per-callable (one declaration level) |
| **Type safety** | Fully type-safe — lens types encode source and focus | Checked at declaration — targets must be identity endpoints |
| **Composability** | First-class — `lens1 . lens2 . lens3` | Flat — `links a, b, c` (no nesting/composition) |
| **Paradigm** | Functional — writes produce new values | Imperative — writes mutate in place |
| **Invalidation model** | Not needed — old values persist | Core feature — `links` specifies what narrowing to drop |

### Prisms as Discriminated Union Narrowing

Haskell's `Prism` is particularly interesting because it models the same concept as TypeScript's discriminated union narrowing:

```haskell
data Shape = Circle Double | Rect Double Double

_Circle :: Prism' Shape Double
_Circle = prism' Circle $ \case
  Circle r -> Just r
  _        -> Nothing

-- Reading through a prism is partial (might fail):
preview _Circle (Circle 5.0)    -- Just 5.0
preview _Circle (Rect 3.0 4.0)  -- Nothing

-- Writing through a prism is total:
review _Circle 5.0              -- Circle 5.0
```

In TypeScript-Go terms, a `Prism` is a type-narrowing read (like an identity read that might return a discriminated branch) combined with a constructing write:

```typescript
// TypeScript equivalent of Prism semantics
interface ShapeStore {
  identity shape(): Circle | Rect;
  mutator setShape(s: Circle | Rect) links shape;
}

// Prism-like narrowing:
if (store.shape().kind === "circle") {
  store.shape().radius;  // narrowed — like preview _Circle succeeding
}
```

The lens library's `Prism` demonstrates that discriminated access (read a specific variant from a sum type) and total reconstruction (write a new variant) are naturally complementary operations — exactly the `identity`/`mutator` split.

---

## 4. GADTs and Type-Level Narrowing — Pattern Matching for Type Refinement

### GADTs in Haskell

Generalized Algebraic Data Types (GADTs) allow data constructors to introduce type equalities, enabling pattern matching to narrow the type parameter:

```haskell
{-# LANGUAGE GADTs #-}

data Expr a where
  IntLit  :: Int    -> Expr Int
  BoolLit :: Bool   -> Expr Bool
  Add     :: Expr Int -> Expr Int -> Expr Int
  If      :: Expr Bool -> Expr a -> Expr a -> Expr a

eval :: Expr a -> a
eval (IntLit n)    = n         -- here, a ~ Int (compiler knows)
eval (BoolLit b)   = b         -- here, a ~ Bool
eval (Add x y)     = eval x + eval y  -- x, y :: Expr Int
eval (If c t e)    = if eval c then eval t else eval e
```

When the compiler pattern-matches on `IntLit n`, it **learns** that `a ~ Int`. This is genuine type-level narrowing — the return type `a` becomes `Int` in that branch. No cast is needed; the type equality is proven by the pattern match.

### GADT Pattern Matching vs TypeScript Narrowing

| Aspect | Haskell GADT | TypeScript Narrowing | TypeScript-Go `identity` |
|--------|-------------|---------------------|------------------------|
| **Narrowing trigger** | Constructor pattern match | Type guard, typeof, instanceof, discriminant | Guard on identity call result |
| **Precision** | Exact — type equality proven by constructor | Intersection-based — narrows within declared union | Same as standard TS narrowing, applied to identity reads |
| **Exhaustiveness** | Enforced by compiler | Enforced for discriminated unions in switch | Same as standard TS |
| **Stability** | Permanent — matched value is immutable | Until reassignment or mutation | Until mutator call or uncertainty boundary |
| **Type-level information** | Constructor carries type witness | Discriminant property carries literal type | Identity read carries narrowed return type |

### The Type Witness Parallel

In GADTs, each constructor is a **type witness** — proof that the type parameter has a specific value. When you pattern match, you consume the witness and gain the type knowledge.

TypeScript's discriminated unions work similarly — the literal value of a discriminant property witnesses the specific variant:

```typescript
type Expr = { kind: "int"; value: number } | { kind: "bool"; value: boolean };

function eval(e: Expr): number | boolean {
  switch (e.kind) {
    case "int": return e.value;   // e narrowed to { kind: "int"; value: number }
    case "bool": return e.value;  // e narrowed to { kind: "bool"; value: boolean }
  }
}
```

With `identity`, the same narrowing applies to callable getters:

```typescript
interface ExprStore {
  identity expr(): { kind: "int"; value: number } | { kind: "bool"; value: boolean };
}

// GADT-like narrowing through identity read:
if (store.expr().kind === "int") {
  store.expr().value;  // number — narrowing preserved across repeated read
}
```

The key insight: GADTs make type witnesses structural (embedded in the data). TypeScript makes them value-level (discriminant properties). `identity` makes them flow-level (preserved across repeated reads). All three are mechanisms for the type system to learn facts from runtime checks.

---

## 5. Effect Systems (Polysemy, Fused-Effects) — Tracking Mutation at the Type Level

### Effect System Architecture

Modern Haskell effect systems (polysemy, fused-effects, effectful) encode side effects as type-level markers, allowing fine-grained tracking of what a function can do:

```haskell
-- Using polysemy
import Polysemy
import Polysemy.State

-- State effect: typed mutable state
readState :: Member (State s) r => Sem r s
modifyState :: Member (State s) r => (s -> s) -> Sem r ()

-- A function that reads state (but doesn't write):
getUser :: Member (State AppState) r => Sem r (Maybe User)
getUser = do
  state <- readState
  return (appUser state)

-- A function that modifies state:
setUser :: Member (State AppState) r => User -> Sem r ()
setUser u = modifyState (\s -> s { appUser = Just u })
```

The type signature `Member (State AppState) r =>` is a constraint that says "this computation requires mutable state capability." Functions without this constraint are provably state-free.

### Effect Rows as Capability Types

Effect rows encode exactly which capabilities a function requires:

```haskell
-- This function can ONLY read and write state:
pureComputation :: Sem '[State AppState] a

-- This function can do IO AND state:
impureComputation :: Sem '[State AppState, Embed IO] a

-- This function needs NO effects:
trulyPure :: a -> a  -- no Sem wrapper, no effects possible
```

The compiler enforces that a function cannot perform an effect not listed in its type. This is the strongest form of mutation tracking — you can look at a function's type and know exactly what it can mutate.

### Comparison with `identity`/`mutator`

| Aspect | Haskell Effect Systems | TypeScript-Go `identity`/`mutator` |
|--------|----------------------|-------------------------------------|
| **Granularity** | Per-effect (State, Reader, Writer, Error, etc.) | Binary (identity = read, mutator = write) |
| **Composability** | Effect rows compose (union of capabilities) | Per-declaration (no composition algebra) |
| **Inference** | Constraint inference from function body | Heuristic tiers infer mutation impact |
| **Verification** | Structural — compiler proves capability usage | Declarative — developer asserts behavior |
| **Scope** | Entire function body | CFA flow region |
| **Read contract** | `Reader` effect (read-only view of state) | `identity` modifier |
| **Write contract** | `State`/`Writer` effect (mutation capability) | `mutator` modifier |
| **Selective targeting** | Different `State s` for different state slices | `links` clause targeting specific identity endpoints |

### The `Reader` vs `State` Split

Haskell's effect systems distinguish between `Reader` (read-only access) and `State` (read-write access):

```haskell
-- Reader: read-only access — guaranteed no mutation
askConfig :: Member (Reader Config) r => Sem r Config
askConfig = ask

-- State: read-write access — mutation possible
updateCounter :: Member (State Counter) r => Sem r ()
updateCounter = modify (+1)
```

This is structurally identical to the `identity`/`mutator` split:

```typescript
// identity: read-only access — guaranteed stable
interface Store {
  identity config(): Config;              // ~ Reader Config
  mutator updateCounter() links counter;  // ~ State Counter
}
```

The difference is scope: Haskell's `Reader`/`State` constraint propagates through the entire call chain (if `f` calls `g` which uses `State`, then `f` must also declare `State`). TypeScript-Go's `identity`/`mutator` operates locally — the checker doesn't track whether a function's transitive callees perform mutations.

### Effect Handlers as Mutation Interpreters

Effect systems separate **declaring** effects from **interpreting** them:

```haskell
-- Declare: the program uses State
program :: Member (State Int) r => Sem r Int
program = do
  modify (+1)
  get

-- Interpret: run the stateful program with IORef
runWithIORef :: IORef Int -> Sem (State Int ': r) a -> Sem r a

-- Or interpret purely:
runPure :: s -> Sem (State s ': r) a -> Sem r (s, a)
```

This separation means the same "effectful" code can run with real mutation (IORef) or simulated mutation (pure state threading). TypeScript-Go's `identity`/`mutator` has no analog to this — the modifiers describe the surface API contract, not the implementation strategy.

---

## 6. Phantom Types — Encoding Read/Write Capability at the Type Level

### Phantom Type Pattern

Phantom types are type parameters that appear in the type constructor but not in the value representation. They encode type-level information with zero runtime cost:

```haskell
{-# LANGUAGE DataKinds, KindSignatures #-}

data Access = ReadOnly | ReadWrite

data Ref (access :: Access) a = Ref (IORef a)  -- access has no runtime representation

-- Smart constructors enforce the capability:
newReadOnly :: a -> IO (Ref 'ReadOnly a)
newReadOnly x = Ref <$> newIORef x

newReadWrite :: a -> IO (Ref 'ReadWrite a)
newReadWrite x = Ref <$> newIORef x

-- Read works on any access level:
readRef :: Ref access a -> IO a
readRef (Ref r) = readIORef r

-- Write requires ReadWrite capability:
writeRef :: Ref 'ReadWrite a -> a -> IO ()
writeRef (Ref r) v = writeIORef r v

-- This is a type error:
-- writeToReadOnly :: Ref 'ReadOnly a -> a -> IO ()
-- writeToReadOnly ref v = writeRef ref v
-- ERROR: Couldn't match 'ReadOnly with 'ReadWrite
```

### Comparison with `identity`/`mutator`

Phantom types encode the read/write distinction at the type level, with the compiler enforcing that write operations require the correct capability:

| Aspect | Haskell Phantom Types | TypeScript-Go `identity`/`mutator` |
|--------|----------------------|-------------------------------------|
| **Mechanism** | Type parameter with no runtime representation | Modifier keyword on function type |
| **Read capability** | `Ref access a` — any access level can read | `identity () => T` — stable read |
| **Write capability** | `Ref 'ReadWrite a` — only ReadWrite can write | `mutator (v: T) => void` — mutation call |
| **Enforcement** | Structural — type parameter mismatch = compile error | Declarative — CFA uses modifier for narrowing |
| **Granularity** | Per-reference (each ref has its own access level) | Per-callable (each method has its own modifier) |
| **Composition** | Phantom type propagates through function signatures | `links` clause connects mutators to identity endpoints |
| **Runtime cost** | Zero — phantom types are erased | Zero — modifiers are erased |

### The ST Phantom Type as Scope Enforcer

The `ST` monad uses a phantom type `s` to enforce scope boundaries:

```haskell
newSTRef :: a -> ST s (STRef s a)
readSTRef :: STRef s a -> ST s a
writeSTRef :: STRef s a -> a -> ST s ()

runST :: (forall s. ST s a) -> a
```

The `forall s.` prevents `STRef s a` from escaping `runST` — the phantom variable `s` is existentially bound and cannot unify with any external type. This is the type-level equivalent of TypeScript-Go's uncertainty boundaries: the phantom type **prevents mutable state from leaking** out of its controlled scope.

TypeScript-Go's uncertainty boundaries serve the same purpose through CFA: when an identity-narrowed reference crosses a boundary (callback, await, alias escape), the narrowing is dropped — preventing stale type information from "leaking" into a context where mutation could have occurred.

---

## 7. Type Families — Type-Level Computation for Conditional Narrowing

### Closed Type Families

Haskell type families enable type-level computation — functions that map types to types:

```haskell
{-# LANGUAGE TypeFamilies #-}

type family ElementType a where
  ElementType [a]      = a
  ElementType (Set a)  = a
  ElementType String   = Char
  ElementType a        = TypeError ('Text "No element type for " ':<>: 'ShowType a)
```

Closed type families are evaluated by the compiler via pattern matching on types. They enable conditional type computation — the output type depends on the input type's structure.

### Comparison with TypeScript's Conditional Types

TypeScript's conditional types (`T extends U ? X : Y`) serve a similar purpose:

```typescript
type ElementType<T> =
  T extends readonly (infer U)[] ? U :
  T extends Set<infer U> ? U :
  T extends string ? string :
  never;
```

### Relevance to `identity` Narrowing

Type families demonstrate that **type-level conditional logic** (selecting an output type based on an input type's shape) is a well-established pattern. TypeScript-Go's identity narrowing performs a runtime-to-type-level version of this:

```typescript
// Without identity: conditional logic stays at value level
declare const read: identity () => string | number;

if (typeof read() === "string") {
  // TypeScript-Go narrows: read() :: string
  // This is like a runtime-evaluated type family:
  // TypeOf(read()) where typeof read() === "string" → string
}
```

The parallel is structural: type families compute output types from input shapes at compile time, while `identity` narrowing computes narrowed return types from runtime guard results at type-check time. Both are mechanisms for the type system to derive specific types from general ones.

### Associated Type Families

Associated type families attach type-level functions to type classes:

```haskell
class Container f where
  type Elem f :: *
  empty :: f
  insert :: Elem f -> f -> f
  toList :: f -> [Elem f]

instance Container [a] where
  type Elem [a] = a
  empty = []
  insert = (:)
  toList = id

instance Container (Set a) where
  type Elem (Set a) = a
  empty = Set.empty
  insert = Set.insert
  toList = Set.toList
```

Associated type families tie a "read type" (`Elem f`) to a container `f`, with operations (`insert`) that modify the container. This is conceptually similar to an interface with `identity` reads returning the element type and `mutator` writes modifying the container:

```typescript
interface Container<F> {
  identity elem(): Elem<F>;
  mutator insert(e: Elem<F>) links elem;
}
```

---

## 8. Alternative Design — Could TypeScript Use Haskell-Style Monadic Effects or Lens Composition?

### Option A: Monadic Effect Tracking

**Concept:** Encode mutation effects in the type system, requiring functions that mutate to declare their effects.

```typescript
// Hypothetical TypeScript with effect types:
type Pure<T> = T;
type Effectful<Effects, T> = T;

function readUser(): Pure<User | undefined> { ... }
function setUser(u: User): Effectful<[State<UserStore>], void> { ... }

// The compiler knows readUser is pure → safe for repeated narrowing
// The compiler knows setUser has State effect → invalidates prior reads
```

**Why this is impractical for TypeScript:**

1. **Viral annotation burden:** Every function in the call chain must declare its effects. This is incompatible with TypeScript's gradual typing philosophy and the vast untyped JavaScript ecosystem.

2. **Function type incompatibility:** A `Pure<User>` and an `Effectful<[State<X>], User>` would be different types. Existing JavaScript APIs would need wholesale rewriting.

3. **Higher-kinded types required:** Monadic effect composition requires HKTs (`Monad m => m a → (a → m b) → m b`), which TypeScript does not have. Adding HKTs would be a fundamental language extension far beyond the scope of narrowing improvements.

4. **Colored function problem:** Effect-typed functions cannot be called from pure contexts without propagating the effect type. This creates the same "function coloring" problem as async/await, but worse — every possible effect creates a new color.

**Verdict:** Too invasive. `identity`/`mutator` achieves the same practical outcome (the checker knows which calls are reads and which are writes) without requiring a pervasive type-system extension.

### Option B: Lens Composition for `links`

**Concept:** Instead of flat `links a, b, c` declarations, use composable path expressions that derive write targets from read paths.

```typescript
// Hypothetical lens-style links:
interface Store {
  identity user(): User;
  identity user.name(): string;    // nested identity path
  identity user.age(): number;

  mutator setUserName(n: string) links user.name;  // path-directed invalidation
}
```

**Why this is impractical for TypeScript:**

1. **No nested identity paths:** TypeScript interfaces declare methods on a flat surface. There is no structural mechanism to express `user.name` as a property of `user` at the interface level — `user()` returns a `User` object, and `.name` is a property of that returned object, not of the interface.

2. **Impedance mismatch with JavaScript:** JavaScript objects don't have lens infrastructure. A Haskell lens composes because the library provides a consistent `get`/`set` algebra. JavaScript objects have ad-hoc access via property lookup and method calls with no unifying composition abstraction.

3. **Complexity without proportional benefit:** Most real-world signal APIs have 1–3 identity endpoints per interface. Lens composition shines with deeply nested immutable structures (Haskell's domain), not with shallow mutable APIs (TypeScript's domain).

4. **Invalidation vs immutable update:** Haskell lenses produce new values — there is no invalidation because old values persist. TypeScript signals mutate in place. Lens semantics (functional update) are fundamentally different from `links` semantics (mutation notification).

**Verdict:** Over-engineered for TypeScript's use case. Flat `links` declarations are sufficient for the signal/computed API surface and are far simpler to parse, check, and understand.

### Option C: Phantom Type Read/Write Capabilities

**Concept:** Use phantom type parameters to encode read/write capability at the type level.

```typescript
// Hypothetical phantom capability types:
type ReadOnly = { readonly __brand: "ReadOnly" };
type ReadWrite = { readonly __brand: "ReadWrite" };

interface Signal<T, Access = ReadWrite> {
  (): T;  // read always available
  (value: T): Access extends ReadWrite ? void : never;  // write conditional on Access
}
```

**Why this is partially viable but inferior to `identity`/`mutator`:**

1. **Already possible in TypeScript today** (via branding), but it doesn't affect narrowing. The checker doesn't know that a `Signal<T, ReadOnly>` call is "stable" — it still treats every call as potentially returning a different value.

2. **Doesn't solve the core problem:** Phantom types distinguish read-capable from write-capable at the API level, but the checker still needs `identity` to know "this read is stable" and `mutator` to know "this write invalidates."

3. **Composition via conditional types is complex:** Mapping read/write capabilities through generic containers requires conditional type computation, adding complexity without improving the CFA story.

**Verdict:** Complementary but not sufficient. Phantom types can encode API-level read/write contracts, but `identity`/`mutator` is needed for the CFA integration that actually narrows types through repeated calls.

### The Pragmatism Trade-Off

Haskell's approaches (purity by default, monadic effects, lenses, phantom types) are all fundamentally **compositional** and **structural** — correctness is derived from the type system's algebraic properties. This works because Haskell's ecosystem is built on these abstractions from the ground up.

TypeScript-Go's `identity`/`mutator`/`links` is fundamentally **declarative** and **pragmatic** — correctness comes from developer assertions checked by CFA heuristics. This works because:

1. **JavaScript is imperative.** Functional purity cannot be assumed or enforced.
2. **Gradual adoption.** Existing APIs work unchanged; `identity` is opt-in.
3. **Bounded complexity.** The feature solves a specific, well-scoped problem (callable getter narrowing) without requiring a general-purpose effect system.
4. **Proportional investment.** The implementation cost and learning curve are proportional to the narrowing benefit.

The right comparison is not "why doesn't TypeScript have Haskell's type system?" but "does `identity`/`mutator`/`links` extract the practical narrowing value from Haskell's purity concept without requiring Haskell's type-system infrastructure?" The answer is yes — by focusing on the specific read-stability guarantee that CFA needs, rather than the general purity guarantee that Haskell provides.

---

## 9. Summary Table

| Haskell Concept | TypeScript-Go Equivalent | Key Difference |
|----------------|-------------------------|----------------|
| Pure functions | `identity` callable | Haskell: structural purity. TS-Go: declared stability |
| `IORef`/`readIORef` | `identity read()` | Haskell: in IO monad. TS-Go: in CFA flow |
| `IORef`/`writeIORef` | `mutator set()` | Haskell: in IO monad. TS-Go: invalidates narrowing |
| `STRef` + rank-2 scope | Uncertainty boundaries | Both prevent mutable state from leaking scope |
| `Lens get/set` | `identity` / `mutator links` | Haskell: composable algebra. TS-Go: flat declarations |
| `Prism` | Discriminated union narrowing | Haskell: optic type. TS-Go: CFA discriminant check |
| GADT pattern match | Type guard + narrowing | Both: pattern match → type equality/narrowing |
| Effect system (`State`/`Reader`) | `identity` (Reader) / `mutator` (State) | Haskell: pervasive constraints. TS-Go: per-callable |
| Phantom `ReadOnly`/`ReadWrite` | `identity` / `mutator` modifiers | Haskell: type parameter. TS-Go: modifier keyword |
| Type families | Conditional types + CFA narrowing | Haskell: compile-time type computation. TS-Go: flow-sensitive narrowing |

Haskell demonstrates that tracking mutation at the type level is both sound and practical — when the language is designed for it from the start. TypeScript-Go's `identity`/`mutator`/`links` extracts the essential narrowing benefit from Haskell's purity model while remaining compatible with JavaScript's imperative reality.
