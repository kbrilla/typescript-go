# Design Review Synthesis: Identity/Mutator/Links Across 24 Documents

**Date:** 2026-03-11
**Status:** Comprehensive Cross-Language Analysis
**Scope:** Synthesis of 24 design review documents surveying 20+ languages, 5 effect system research languages, reactive frameworks, alternative syntax proposals, academic PL theory, and TypeScript's own feature set

---

## 1. Executive Summary

This synthesis consolidates findings from a 24-document design review covering:

- **20+ programming languages**: Python, Rust, Kotlin, Swift, C#, Ruby, Scala, Haskell, Elixir, Clojure, Dart, F#, OCaml, Go, PHP, Groovy, Perl, Lua, R, Zig, Nim, Crystal, Java, C++
- **5 effect system research languages**: Koka, Eff, Frank, Links (Edinburgh), Effekt
- **7 reactive frameworks**: Angular Signals, SolidJS, Vue, MobX, Svelte, Preact Signals, RxJS
- **10 academic research traditions**: Linear/uniqueness types, region-based memory, fractional permissions, typestate, gradual typing, occurrence typing, and more
- **14 alternative syntax proposals** for the keyword system
- **TypeScript's own existing features** (`readonly`, `as const`, type predicates, assertion functions, branded types)

**Key conclusion:** The `identity`/`mutator`/`links` system is **well-validated** across the surveyed landscape. Every language with static typing addresses the same fundamental tension — "when can a previously-read value be trusted?" — but none provides the exact combination of callable-read narrowing, selective invalidation, and gradual adoption that TypeScript-Go's system offers. The design is sound, novel where it needs to be, and well-grounded in established patterns where it can be. **Two keyword changes are strongly recommended** based on the review: `identity` → `stable` and `links` → `invalidates`.

---

## 2. Universal Patterns Discovered

### 2.1 Read/Write Separation Is Universal

Every statically-typed language surveyed distinguishes reads from writes at some level:

| Pattern | Languages |
|---------|-----------|
| `val`/`var` (binding-level) | Kotlin, Scala, Nim, Dart, Swift (`let`/`var`), Zig (`const`/`var`) |
| `readonly`/mutable (field-level) | C#, TypeScript, PHP, F# (`mutable` keyword) |
| Per-field `mutable` annotation | OCaml, F# |
| `get`/`set` accessors | C#, Ruby (`attr_reader`/`attr_writer`), Groovy, Python (`@property`) |
| Value receiver / pointer receiver | Go, Swift (`mutating`) |
| `const`/non-`const` pointers | C++, Zig (`*const T` vs `*T`) |
| `&T`/`&mut T` borrowing | Rust |
| Channel directions (`<-chan`/`chan<-`) | Go |
| `freeze` / frozen objects | Ruby, Elixir (universal), Python (`@dataclass(frozen=True)`) |
| Effect-system read/write split | Koka (`read<h>`/`write<h>`), Eff, Frank, Links, Effekt |

**Count: All 20+ languages have some form of read/write separation.** This is arguably the most universal pattern in static type system design.

### 2.2 Immutability as the Alternative to Mutation Tracking

8 languages sidestep mutation tracking entirely through immutability:

| Language | Mechanism |
|----------|-----------|
| Haskell | All values immutable; mutation only in IO/ST monads |
| Elixir/Erlang | All data immutable; mutation via process message passing |
| Clojure | Persistent data structures; mutation via atoms/refs/agents |
| F# | Immutable bindings and records by default |
| Scala | Case classes are immutable; `val` by default |
| OCaml | Records immutable by default; opt-in `mutable` fields |
| Rust | Move semantics + borrow rules prevent aliased mutation |
| Dart | `final` + private fields enable promotion |

**Insight:** These languages prove that if mutation is either impossible or tightly controlled, narrowing/promotion is trivially safe. TypeScript cannot adopt this approach because JavaScript is fundamentally mutable and reference-based. The `identity`/`mutator`/`links` system is TypeScript's pragmatic alternative — it tracks mutation effects rather than preventing mutation entirely.

### 2.3 Per-Field vs Whole-Object Granularity

Languages split into two camps:

- **Whole-object granularity**: Kotlin (`val`/`var`), Zig (`const`/`var`), Java (`final`), PHP (`readonly class`), Groovy (`@Immutable`) — the entire object/binding is either mutable or immutable.
- **Per-field granularity**: OCaml (`mutable` on individual fields), F# (`mutable` keyword), C# (`get`/`set`/`init`), Swift (per-property `mutating`/non-`mutating`), Ruby (`attr_reader`/`attr_writer`/`attr_accessor`).

TypeScript-Go's `identity`/`mutator` operates at **per-callable granularity**, which is finer than most languages. This is essential for signal-style APIs where read and write endpoints coexist on the same object but affect different state.

The `links` clause adds a second dimension of granularity — not just "which callables are reads vs writes" but "which writes affect which reads." Only optics libraries (Scala Monocle, Haskell lens) and effect system languages (Koka's heap regions) approach this level of precision.

---

## 3. Closest Prior Art for Each Concept

### 3.1 `identity` — Closest Equivalents

| Rank | Language/System | Analog | How Close |
|------|----------------|--------|-----------|
| 1 | **Dart** | `final` private field promotion (Dart 3.0) | Closest production analog. Same problem, same solution approach. Dart requires `final` + private to guarantee promotion — structurally identical to `identity`'s guarantee. |
| 2 | **Kotlin** | `val` properties enable smart casts | Very close conceptually. `val` = "this binding is stable for narrowing." But Kotlin rejects all delegated properties and open getters — stricter but less expressive than `identity`. |
| 3 | **Swift** | Non-`mutating` methods on value types | Same contract: "this method does not modify state." But Swift enforces structurally (compiler checks body), while `identity` is declarative. |
| 4 | **Go** | Value receivers (`func (s Store) Read() string`) | Same semantic: "receives a copy, cannot modify original." Physical guarantee via copy semantics vs. declared contract. |
| 5 | **OCaml** | Immutable record fields (default) | "Unmarked fields are stable reads." Inverted from TypeScript (unmarked is mutable), but same concept. |
| 6 | **Haskell** | Pure functions (referential transparency) | Strongest possible version — every function call is stable by language guarantee. Too strong for TypeScript's mutable world. |
| 7 | **C++** | `const` member functions | Same contract: "this method does not modify the object." Compiler-verified but with escape hatches (`mutable` keyword). |
| 8 | **C#** | `readonly` struct members / `get`-only properties | Read-only accessors with compiler enforcement. |

**Verdict:** Dart's field promotion is the production system most directly comparable to `identity`. The concept is well-established; `identity`'s innovation is applying it to **callable return values** (function calls), not just property access.

### 3.2 `mutator` — Closest Equivalents

| Rank | Language/System | Analog | How Close |
|------|----------------|--------|-----------|
| 1 | **Swift** | `mutating` keyword on methods | Direct equivalent. Same keyword position (modifier on method signature), same semantic (marks state-changing operations). Swift is structural (compiler enforces), TypeScript-Go is declarative. |
| 2 | **Rust** | `&mut T` (exclusive mutable borrow) | Same concept: exclusive write access invalidates prior read assumptions. Enforcement is structural via borrow checker. |
| 3 | **Go** | Pointer receivers (`func (s *Store) Write(v string)`) | Same contract: "this method can modify the receiver." Enforced via copy semantics. |
| 4 | **Nim** | `{.noSideEffect.}` absence (plain `proc`) | Inverted: Nim marks purity; absence implies possible mutation. Same semantic space. |
| 5 | **Kotlin** | `var` property + custom setter | Implicit rather than declared. `var` allows assignment; setter is implicitly mutating. |
| 6 | **Clojure** | `swap!`/`reset!` (bang-suffix convention) | Naming convention, not type-level. Bang suffix means "side-effecting mutation." |
| 7 | **C#** | `set` accessor / non-`readonly` struct methods | Set accessors are implicitly mutating. |
| 8 | **Koka** | `write<h>` effect | Most principled version — mutation is a tracked effect with heap region scoping. |

**Verdict:** Swift's `mutating` keyword is the closest direct precedent — same keyword position, same semantic, same opt-in design. The concept is well-established across many languages.

### 3.3 `links` — Prior Art Assessment

**`links` is the most novel element of the system.** No mainstream language has an exact equivalent. The closest analogs:

| Rank | Language/System | Analog | How Close |
|------|----------------|--------|-----------|
| 1 | **Koka** | Heap regions (`read<h>`/`write<h>`) | Closest theoretical analog. Heap regions scope which state a read/write affects. The region parameter `h` plays the same role as `links` targets. |
| 2 | **Rust** | Lifetime annotations (`'a`) | Express dependency relationships between references. Different direction (validity duration vs. invalidation scope) but same structural role: "this operation affects that endpoint." |
| 3 | **Scala Monocle / Haskell lens** | Lens composition | Optics derive the read/write relationship from composition paths. Structurally equivalent to declaring "setCity invalidates city but not name." |
| 4 | **Clojure STM** | `dosync` transaction scope | Dynamic coordination graph — the runtime discovers which refs a transaction touches. `links` declares this statically. |
| 5 | **OCaml** | `{ ... with ... }` (functional update) | The `with` expression names which fields change, implying all others are preserved. Same information as `links` but in expression form. |
| 6 | **Go** | Channel direction types | `chan<- T` (send-only) implicitly "links" to `<-chan T` (receive-only): a send invalidates a prior receive. |
| 7 | **Frank** | Parameterized abilities | `State Int` vs `State String` are different abilities, like `links user` and `links settings` target different endpoints. |

**Verdict:** `links` is **genuinely novel** as a production language feature. No mainstream language provides declarative, per-endpoint selective invalidation. The concept exists in effect system research (Koka's heap regions are the closest formal model) and is implicit in optics libraries, but no language has it as a type-level annotation on callable signatures. This is the system's primary innovation.

---

## 4. Naming / Syntax Recommendations

### 4.1 Summary of Alternative Syntax Analysis (Doc 19)

Document 19 evaluated 14 alternative naming schemes across five criteria (clarity, conciseness, consistency, safety, parsability). Key findings:

| Alternative | Score | Verdict |
|-------------|-------|---------|
| `stable` / `invalidates` | **8.0** (highest) | Strong contender — `stable` is immediately clear |
| Only mark mutators (#13) | 7.5 | Minimal syntax, but risks "forgetting mutator" |
| Single keyword `stable` (#7) | 7.2 | Simple but "mutation by default" is dangerous |
| `const` on function types (#12) | 6.2 | Parser ambiguity with existing `const` |
| `observe`/`mutate` (#11) | 6.6 | `observe` implies subscription, misleading |
| `signal`/`action` (#10) | 6.3 | Too framework-specific |
| `pure`/`impure` (#2) | 6.0 | FP terminology mismatch |
| `get`/`set` modifiers (#3) | 5.7 | Collision with accessor syntax |
| `readonly` on fn types (#4) | 5.5 | Positional ambiguity |
| Branded types (#9) | 5.3 | No compiler semantics |
| `@stable`/`@mutates` decorators (#5) | 5.1 | Decorators are runtime, not type-level |
| Tagged return types (#6) | 4.6 | Wrong semantic location |

### 4.2 Cross-Reference with Language Terminology

| Concept | TypeScript-Go (Current) | Swift | Go | C# | C++ | Koka | Recommendation |
|---------|------------------------|-------|-----|-----|------|------|---------------|
| Stable read | `identity` | (non-`mutating`) | (value receiver) | `get`-only | `const` | `read<h>` | **`stable`** |
| State-changing write | `mutator` | `mutating` | (pointer receiver) | `set` | (non-`const`) | `write<h>` | **`mutator`** (keep) |
| Invalidation target | `links` | — | — | — | — | heap region `h` | **`invalidates`** |

### 4.3 Final Recommendation

**Recommended change:**

```typescript
// Current:
interface Store {
    read: identity () => string | undefined;
    write: mutator (v: string) => void links read;
}

// Recommended:
interface Store {
    read: stable () => string | undefined;
    write: mutator (v: string) => void invalidates read;
}
```

| Current | Recommended | Rationale |
|---------|-------------|-----------|
| `identity` | **`stable`** | `identity` is overloaded (math identity, identity function, object identity). `stable` immediately communicates intent: "this callable returns a stable result." Every language reviewed uses terminology closer to "stable/immutable/readonly" than "identity" for this concept. |
| `mutator` | **`mutator`** (keep) | Already clear and well-understood. Matches Swift's `mutating` convention. `mutate` (verb) is also acceptable. |
| `links` | **`invalidates`** | `links` is vague — "links to" could mean "relates to" rather than "makes invalid." `invalidates` is precise about the consequence. Cross-referenced: no language uses "links" for this concept. Koka uses region parameters, Rust uses lifetime annotations, optics use composition — none use "links." `invalidates` is the most semantically accurate term found across all 24 documents. |

**The single most impactful change is `identity` → `stable`.** If only one keyword could be changed, this is it.

---

## 5. Strengths of Current Design

### 5.1 What the Design Gets Right

1. **Callable-level granularity.** No other production language applies read/write contracts to callable return values. Property-level is well-trodden (C#, Kotlin, Dart, Swift); method-level mutation marking exists (Swift `mutating`, Go receivers); but `identity` on a callable signature — enabling CFA narrowing across repeated function calls — is a genuine innovation. This is precisely what the signal/reactive pattern demands.

2. **Selective invalidation via `links`.** The ability to declare that `setUser` invalidates `user()` but not `settings()` is unique among production languages. Only effect system research languages (Koka heap regions) and optics libraries provide comparable precision.

3. **Gradual adoption path.** The tiered heuristic system (Tier 1: high confidence inference, Tier 2: local alias-preserving forwarding, Tier 3: conservative fallback) embodies the gradual typing philosophy that made TypeScript successful. Developers get improved narrowing without any annotation, and explicit `identity`/`mutator`/`links` annotations refine precision incrementally. This matches the pattern identified across all gradual type systems (Python TypeGuard → TypeIs, Ruby Sorbet levels, Groovy `@CompileStatic`).

4. **Soft enforcement.** Unlike Rust (hard reject), Swift (compile error), or Kotlin (blocked smart cast), TypeScript-Go uses soft invalidation (type widens but program still compiles). This is the right choice for JavaScript's domain, where hard rejection would break too much existing code. Validated by: all four documents analyzing hard-vs-soft enforcement (Rust, Swift, Kotlin, Dart) conclude soft enforcement is appropriate for TypeScript.

5. **No runtime cost.** The system is entirely compile-time, unlike Ruby's `freeze` (runtime error), PHP's `readonly` (runtime enforcement), or Haskell's `IORef` (runtime borrow checks via `RefCell` analog). This matches TypeScript's "erasable types" philosophy.

6. **Compatibility with existing TypeScript.** The system extends existing CFA rather than replacing it. Property narrowing, type predicates, assertion functions, discriminated unions — all continue to work unchanged. `identity` layers on top for callable endpoints that these features cannot reach. Validated by Doc 22's exhaustive analysis of existing TypeScript features.

### 5.2 Where It Outperforms All Alternatives

- **vs. full immutability (Haskell, Elixir, Clojure):** Works with mutable state rather than requiring immutability. Essential for reactive/signal APIs where mutation is the entire point.
- **vs. ownership/borrowing (Rust):** No annotation burden on every function signature. No concept of lifetimes or borrow regions that developers must manage.
- **vs. effect systems (Koka, Eff):** No effect rows on every function type. No row polymorphism algebra. Two keywords instead of a full effect algebra.
- **vs. structural enforcement (Swift `mutating`, Go receivers):** Applies to callable return values, not just methods on value types. Works across the boundary between property access and function calls. No requirement for value types.
- **vs. smart casts (Kotlin, Dart):** Extends narrowing to repeated function calls, not just variables and properties. More expressive than `val`/`final` which is all-or-nothing.

---

## 6. Weaknesses / Risks

### 6.1 Concerns Raised Across Reviews

1. **Keyword clarity (`identity`).** Raised in 8+ documents. The word "identity" has at least three common meanings (mathematical identity function, object identity/reference equality, the identity modifier). `stable` was independently suggested or implied as clearer in multiple reviews. **Severity: High. Mitigation: rename to `stable`.**

2. **`links` ambiguity.** Raised in 5+ documents and explicitly in the syntax review. "Links" suggests association, not invalidation. Developers may misread `links read` as "related to read" rather than "invalidates the read endpoint." **Severity: Medium-High. Mitigation: rename to `invalidates`.**

3. **Complexity budget.** Three new keywords is a non-trivial addition to the language surface. Multiple documents (Koka comparison, effect systems, Nim) note that effect annotations add cognitive overhead. However, the gradual adoption path (heuristic tiers work without any annotation) mitigates this significantly. **Severity: Medium. Mitigation: heuristic tiers make explicit annotation optional for common cases.**

4. **Declarative trust vs. structural enforcement.** Unlike Swift (`mutating` is structurally verified), Rust (borrow checker proves correctness), Kotlin (smart casts are structurally sound), and C# (`readonly` is enforced), TypeScript-Go trusts developer declarations. An incorrect `identity` annotation (on a function that actually has side effects) would cause unsound narrowing. This is consistent with TypeScript's existing philosophy (`as`, `!`, type assertions are all trusted), but it's a known soundness hole. **Severity: Medium. Mitigation: consistent with existing TypeScript philosophy; lint rules can detect suspicious patterns.**

5. **Ecosystem adoption barrier.** For `links` to be useful, library authors must annotate their APIs. This is the same bootstrap problem that `@types` packages solved for TypeScript. Angular, SolidJS, and Vue are likely early adopters (they benefit directly), but smaller libraries may lag. **Severity: Medium. Mitigation: heuristic tiers provide value without library changes; gradual path is well-proven by TypeScript's own adoption history.**

6. **No async narrowing.** Multiple documents (Elixir agents, Clojure agents, async boundaries) note that `identity` narrowing is invalidated at `await` points. This is correct behavior but may frustrate developers who expect signal reads to remain narrowed across async operations. **Severity: Low. Mitigation: well-documented behavior; consistent with how all narrowing works in TypeScript today.**

---

## 7. Recommended Changes (if any)

### Prioritized List

| Priority | Change | Rationale | Effort |
|----------|--------|-----------|--------|
| **P0** | Rename `identity` → `stable` | Highest-impact clarity improvement. Universally supported across reviews. The single change that would most improve developer understanding. | Low (keyword rename) |
| **P0** | Rename `links` → `invalidates` | Eliminates ambiguity about the clause's effect. Precise about the consequence. No competing meaning. | Low (keyword rename) |
| **P1** | Keep `mutator` as-is | Already clear, matches Swift's `mutating` precedent, no confusion reported. | None |
| **P2** | Consider `stable` as optional (inferred by absence of `mutator`) | Reduces annotation burden for read-heavy interfaces. "Stable by default" is the safe default. Requires careful design to avoid silent misclassification. | Medium (design work) |
| **P3** | Evaluate constrained-overload post-call narrowing (Phase 2) | Multiple documents (typestate, Koka, academic research) validate that write-driven narrowing (not just invalidation) is a natural extension. `signal.update(() => "hello")` should narrow the signal to non-undefined. | Medium (Phase 2 feature) |

### What Should NOT Change

- **The three-concept model** (stable read / mutating write / selective invalidation) is validated by every language reviewed. No language provides just two of these; the third is always present in some form.
- **Soft enforcement** (type widening, not hard rejection) is correct for TypeScript's domain.
- **Tiered heuristic inference** is the right gradualism mechanism. None of the reviewed languages match this approach, but it embodies TypeScript's proven adoption philosophy.
- **Per-callable granularity** is essential and unique. No reviewed language matches this level of precision for the signal pattern.

---

## 8. Future Phase: DOM and Built-in Type Annotations

### 8.1 How DOM Types Could Use `stable`/`mutator`/`invalidates`

DOM APIs naturally exhibit the read/write separation pattern:

```typescript
// EventTarget — addEventListener is a mutator that affects event dispatch
interface EventTarget {
    mutator addEventListener(type: string, listener: EventListener): void;
    mutator removeEventListener(type: string, listener: EventListener): void;
}

// NodeList — stable length and indexed access
interface NodeList {
    stable readonly length: number;  // stable between DOM mutations
    stable item(index: number): Node | null;
}

// Element — classList is a stable read; className assignment is a mutator
interface Element {
    stable readonly classList: DOMTokenList;
    // className setter invalidates classList-derived narrowings
}
```

### 8.2 Built-in JS Types That Would Benefit

| Type | Stable Reads | Mutating Writes |
|------|-------------|-----------------|
| `Map<K, V>` | `get(key)`, `has(key)`, `size` | `set(key, value)`, `delete(key)`, `clear()` |
| `Set<T>` | `has(value)`, `size` | `add(value)`, `delete(value)`, `clear()` |
| `Array<T>` | `length`, `at(index)`, `includes()` | `push()`, `pop()`, `splice()`, `sort()` |
| `WeakMap<K, V>` | `get(key)`, `has(key)` | `set(key, value)`, `delete(key)` |
| `HTMLElement` | `getBoundingClientRect()`, `getAttribute()` | `setAttribute()`, `style.setProperty()` |
| `FormData` | `get(name)`, `has(name)` | `set(name, value)`, `append(name, value)`, `delete(name)` |

### 8.3 Examples

```typescript
// Map with stable/mutator annotations
interface Map<K, V> {
    stable get(key: K): V | undefined;
    stable has(key: K): boolean;
    stable readonly size: number;
    mutator set(key: K, value: V): this invalidates get, has, size;
    mutator delete(key: K): boolean invalidates get, has, size;
    mutator clear(): void invalidates get, has, size;
}

// Enables narrowing:
const m = new Map<string, number>();
if (m.has("key")) {
    m.get("key"); // narrowed to number (not number | undefined)
    m.set("other", 42); // invalidates has/get narrowing
    m.get("key"); // must re-check — could have been affected
}
```

### 8.4 Backward Compatibility

Adding `stable`/`mutator` to lib.d.ts and lib.dom.d.ts is backward-compatible:

- Existing code compiles identically (no new errors).
- Code that happens to match the narrowing patterns gets improved type precision.
- The change is additive — it enables narrowing where none existed, never removes existing narrowing.
- `@types/*` packages can adopt incrementally, same model as `strictNullChecks` adoption.

---

## 9. Language Comparison Matrix

| Language | Closest to `identity`/`stable` | Closest to `mutator` | Closest to `links`/`invalidates` | Narrowing after method calls? | Key Insight |
|----------|-------------------------------|---------------------|--------------------------------|-------------------------------|-------------|
| **Python** | `@property` (treated as attribute by mypy) | Property setter | None | Partial (property reads only) | TypeGuard/TypeIs ≠ identity; different problems |
| **Rust** | `&T` (shared reference) | `&mut T` (exclusive reference) | Lifetime annotations `'a` | N/A (borrow checker prevents aliasing) | XOR aliasing model; temporal sequencing vs spatial exclusivity |
| **Kotlin** | `val` properties enable smart casts | `var` allows reassignment | None | No (delegated/open props blocked) | All-or-nothing: `val` enables, `var` blocks |
| **Swift** | Non-`mutating` methods | `mutating` keyword | None | Yes (non-mutating guaranteed stable) | Closest keyword precedent for `mutator` |
| **C#** | `get`-only properties, `readonly` members | `set` accessor, non-`readonly` methods | `init` (temporal boundary) | No | Split accessors since 2002; natural model |
| **Ruby** | `attr_reader`, `freeze` | `attr_writer` | None | No (Sorbet doesn't narrow method calls) | Read/write macros predate TypeScript |
| **Scala** | `val` members, case class fields | `var` members | Lens composition (Monocle) | No | Optics derive links from composition paths |
| **Haskell** | Pure functions (all calls stable) | IORef `writeIORef` | Lens library paths | N/A (everything is pure/narrowed) | Too strong; can't apply to mutable JS |
| **Elixir** | All bindings (immutable data) | GenServer state transitions | N/A (no mutation) | N/A (no mutation) | Immutability eliminates the problem |
| **Clojure** | `deref`/`@` (atom read) | `swap!`/`reset!` | STM `dosync` transactions | N/A | Atoms are signals avant la lettre |
| **Dart** | `final` private field promotion | Non-`final` field access blocks promotion | None | Yes (Dart 3.0 field promotion) | Closest production analog to `identity` |
| **F#** | `let` bindings, immutable record fields | `let mutable` + `<-` operator | Per-field `mutable` annotation | N/A (immutable match) | Inverted: annotate what CAN change |
| **OCaml** | Immutable record fields (default) | `mutable` field keyword, `:=` operator | `{ ... with ... }` update syntax | N/A (immutable values) | Per-field mutation annotation = proto-`links` |
| **Go** | Value receivers | Pointer receivers | Channel direction types | No | Value/pointer split is closest structural parallel |
| **PHP** | `readonly` properties (8.1) | Non-`readonly` properties | None | No | `readonly class` is all-or-nothing |
| **Groovy** | `@Immutable` annotation | Auto-generated setters | None | Partial (`@CompileStatic` instanceof) | `@CompileStatic` adds narrowing but not for methods |
| **Perl** | Moose `is => 'ro'` | Moose `is => 'rw'` | None | No | Attribute traits are Ruby-like |
| **Lua** | `__index` metamethod | `__newindex` metamethod | None | No | Metatables invisible to type checkers |
| **R** | Active bindings (get function) | Replacement functions (`x<-`) | None | No | Niche but structurally analogous |
| **Zig** | `const` bindings, `*const T` | `var` bindings, `*T` | None | No (capture syntax sidesteps) | Transitive constness; extract-to-local workaround |
| **Nim** | `let` + `func` (noSideEffect) | `var` + `proc` | Effect pragma tracking | No | Built-in effect system closest to Koka-lite |
| **Crystal** | `getter` macro | `property` macro | None | Yes (flow typing, variables only) | Ruby-like with real static typing |
| **Java** | `final` fields, records | Setter methods | None | No (pattern vars are extractions) | Records = "all identity" objects |
| **C++** | `const` member functions | Non-`const` member functions | `mutable` keyword (const-exception) | No | Most mature const-correctness system |
| **Koka** | `read<h>` effect | `write<h>` effect | Heap region parameter `h` | Yes (effect inference) | Closest theoretical model for all three concepts |

---

## 10. Appendix: Per-Document Summary

### Doc 01 — Python
Python's `TypeGuard`/`TypeIs` solve a different problem (one-shot predicate narrowing) than `identity` (repeated-read stability). Python's `@property` decorator enables attribute-like narrowing for properties but not for callable getters. Frozen dataclasses sidestep invalidation through immutability. Python has no equivalent to `links` — no selective invalidation mechanism exists.

### Doc 02 — Rust
Rust's `&T`/`&mut T` borrowing is the closest structural analog to `identity`/`mutator`. The "aliased XOR mutable" rule prevents the problem entirely through spatial exclusivity, where TypeScript uses temporal sequencing. Interior mutability types (`Cell`, `RefCell`) mirror the signal pattern almost exactly. Lifetime annotations `'a` serve a structural role analogous to `links` — declaring dependency relationships between references.

### Doc 03 — Kotlin
Kotlin's `val`/`var` distinction is the foundation of smart casts. Smart casts are invalidated for `var` properties, open getters, and lambda captures, but are always safe for `val` with backing fields. Kotlin contracts (`returns() implies condition`) provide limited behavioral contracts but don't extend to read stability. Delegated properties (including `by lazy`) are always blocked from smart casting — exactly the problem `identity` solves.

### Doc 04 — Swift
Swift's `mutating` keyword is the closest direct keyword precedent for `mutator`. Value type semantics eliminate aliasing for structs but not classes. SwiftUI property wrappers (`@State`, `@Published`) implement reactive state with the same read/write duality as signals. Protocol conformance carries the non-`mutating` guarantee structurally — stronger than TypeScript's declarative approach.

### Doc 05 — C#
C#'s split accessor model (`get`/`set`/`init`) maps remarkably well onto `identity`/`mutator`. `init`-only setters introduce temporal mutation boundaries without equivalent in TypeScript-Go. Records with `with`-expressions demonstrate non-invalidating (functional) writes. Pattern matching narrowing with `readonly` struct members provides compiler-verified stability guarantees. The `readonly` member concept (C# 8) is structurally closest to `identity` in the .NET ecosystem.

### Doc 06 — Ruby
Ruby's `attr_reader`/`attr_writer`/`attr_accessor` macros declare read/write contracts at the class level. `freeze` provides runtime immutability enforcement. Sorbet performs flow-sensitive narrowing for local variables but **not** for method calls — exactly the gap `identity` fills. RBS type descriptions lack behavioral modifiers entirely.

### Doc 07 — Scala
Scala's `val`/`var` and case class immutability provide declaration-level stability. Monocle optics (lenses, prisms, traversals) solve the "which writes affect which reads" problem through composable, type-safe accessors — the closest analog to `links` in a functional setting. Sealed traits with exhaustive pattern matching provide invalidation-immune narrowing through immutability.

### Doc 08 — Haskell
Haskell's referential transparency makes every function call an implicit `identity` — the strongest possible version. IORef/STRef/MVar provide controlled mutation with the same read/write split as signals. The lens library (van Laarhoven optics) provides fine-grained read/write composition that structurally parallels `links`. Full purity is too restrictive for JavaScript but validates the underlying concept.

### Doc 09 — Elixir
Elixir's universal immutability makes every binding an implicit `identity`. GenServer provides managed mutation via process isolation — no aliasing is possible. Pattern-matched values are permanently stable. The actor model demonstrates that isolated mutation is the safest pattern, but JavaScript's shared-reference model cannot adopt it.

### Doc 10 — Clojure
Clojure atoms (`deref`/`swap!`/`reset!`) are structurally identical to signals and predate them by over a decade. The `!` naming convention for mutation is a weaker form of `mutator`. STM refs with `dosync` transactions demonstrate coordinated multi-ref mutation — the dynamic equivalent of `links`. Agents show async mutation boundaries analogous to `await` invalidation points.

### Doc 11 — Dart
Dart's field promotion (Dart 3.0) is the **closest production analog** to `identity`. `final` + private fields can be promoted (narrowed) after type checks; non-final fields cannot. Dart's invalidation rules are the most detailed existing specification of when promotion is lost, closely matching TypeScript-Go's tier system. Sound null safety demonstrates that narrowing-based type systems can be fully sound.

### Doc 12 — F#
F#'s default-immutable `let` bindings invert TypeScript's default-mutable model. Per-field `mutable` annotations on records are strikingly similar to per-endpoint `identity`/`mutator`. Discriminated unions with `match` provide invalidation-immune narrowing. Computation expressions track effects through types, providing a monadic framework that `mutator` approximates in a simpler, non-monadic form.

### Doc 13 — OCaml
OCaml's per-field `mutable` annotation is the closest ML-family analog to `identity`/`mutator`. Fields are immutable by default; `mutable` opts into mutation. Ref cells (`ref`, `!`, `:=`) provide explicit read/write syntax. Module signatures (abstract types) control capabilities. Variant types with pattern matching provide exhaustive, invalidation-immune narrowing. Algebraic effect handlers (OCaml 5) bring effect-system concepts to a production ML.

### Doc 14 — Effect Systems
Five research languages (Koka, Eff, Frank, Links, Effekt) demonstrate that `read`/`write` effect separation is a fundamental building block of effect typing. Koka's heap regions (`read<h>`/`write<h>`) are the closest theoretical model for all three concepts (`identity`/`mutator`/`links`). Row polymorphism enables automatic effect propagation — more principled than TypeScript-Go's heuristic tiers but too heavy for practical adoption. The document concludes that `identity`/`mutator`/`links` captures the **one specific effect dimension** needed for CFA narrowing without requiring a general effect system.

### Doc 15 — Reactive Frameworks
Angular Signals, SolidJS, Vue, MobX, Svelte, and Preact all share the same read/write duality. Angular's callable signal pattern is the primary motivation. SolidJS's [getter, setter] tuple cleanly separates identity from mutator into distinct symbols. Vue's `.value` property access already works with existing CFA. The TC39 Signals proposal may standardize the pattern, making `identity`/`mutator` annotations on signals a platform-level concern.

### Doc 16 — PHP
PHP 8.1's `readonly` properties demonstrate both the utility and limitations of write-once immutability. Readonly classes (PHP 8.2) are all-or-nothing. PHP's `match` expression is purely value-based (no flow narrowing). PHPStan and Psalm provide flow-sensitive narrowing via static analysis but cannot narrow across method calls — the same gap `identity` addresses.

### Doc 17 — Groovy & Perl
Groovy's `@Immutable` AST transform is whole-class immutability. `@CompileStatic` enables smart casts for `instanceof` but not for method returns. Perl's Moose `is => 'ro'`/`is => 'rw'` attribute traits declare per-attribute read/write intent. Both languages demonstrate that even dynamic languages evolve toward read/write contract declarations.

### Doc 18 — Lua & R
Lua's metatable `__index`/`__newindex` metamethods provide fine-grained read/write interception — structurally identical to `identity`/`mutator` but invisible to type checkers (including Teal). R's active bindings and replacement functions (`x<-(value)`) separate reads from writes syntactically. Both lack type-level enforcement, showing the gap `identity` fills.

### Doc 19 — Alternative Syntax
14 alternative naming schemes evaluated. `stable`/`invalidates` scored highest (8.0). `identity` is overloaded and not self-documenting. `links` is ambiguous. `mutator` is already clear. Recommendation: `stable`/`mutator`/`invalidates`. The single most impactful change is `identity` → `stable`.

### Doc 20 — Academic Research
10 research traditions surveyed: uniqueness/ownership types, region-based memory, fractional permissions, typestate, gradual typing, occurrence typing, and more. Typestate is the closest academic analog to `identity`/`mutator` interaction (operations change observable type). Occurrence typing (Typed Racket) formalizes what TypeScript's CFA already does; `identity` extends it to callable endpoints. The gradual typing guarantee validates the tiered heuristic approach. All full formalisms are too heavy for TypeScript; the system correctly takes a pragmatic subset.

### Doc 21 — Go
Go's value/pointer receiver distinction is a direct structural parallel to `identity`/`mutator`. Value receivers physically cannot mutate (copy semantics); pointer receivers can. `sync.RWMutex` provides read/write locking with the same shared-read/exclusive-write semantics. Channel direction types (`<-chan`/`chan<-`) encode read/write capability in the type system. Go validates the structural soundness of the read/write contract pattern.

### Doc 22 — TypeScript Existing Features
Exhaustive analysis of 9 existing TypeScript features (`readonly`, `as const`, type predicates, assertion functions, branded types, `Readonly<T>`, generics, overloads, discriminated unions). **None can solve the callable-read narrowing problem.** `readonly` prevents writes but doesn't affect CFA for function calls. Type predicates narrow arguments, not function return values. Assertion functions can't target call expressions. Branded types are structural ornaments without CFA impact. The system addresses a genuine gap that no existing feature can fill.

### Doc 23 — Zig, Nim, Crystal
Zig's `const`/`var` and `*const T`/`*T` pointer distinction are the systems-language equivalent of `identity`/`mutator`, enforced through copy semantics. Nim's `{.noSideEffect.}` pragma and `func`/`proc` distinction is the closest built-in effect system in a practical language. Crystal's flow typing narrows local variables but not method calls. All three validate the per-endpoint read/write contract pattern.

### Doc 24 — Java & C++
Java's `final` fields, records, and pattern matching demonstrate decades of experience with immutability and narrowing. Records are "total identity" objects. C++'s const-correctness system is the most mature read/write contract mechanism, with `const` member functions, `mutable` keyword for const-exceptions, and the Lakos Rule for interface design. Java's reactive streams (Publisher/Subscriber) mirror the `identity`/`mutator` duality. Both languages validate the fundamental pattern but lack callable-level granularity.

---

## Summary

The 24-document review yields three clear conclusions:

1. **The design is validated.** The read/write separation, selective invalidation, and gradual adoption patterns in `identity`/`mutator`/`links` are grounded in universal programming language design principles observed across 20+ languages and decades of PL research.

2. **The design is novel where it matters.** Callable-level read stability (`identity`/`stable`) and per-endpoint selective invalidation (`links`/`invalidates`) are genuinely new as production language features. The concepts exist in research (Koka, typestate, optics) but have never been packaged for gradual adoption in a structural type system.

3. **Two keyword changes are strongly recommended.** `identity` → `stable` and `links` → `invalidates` are supported by cross-language terminology analysis, the alternative syntax review, and the core principle that TypeScript keywords should be immediately understandable to web developers.
