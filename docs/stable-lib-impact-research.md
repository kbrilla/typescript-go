# Impact Analysis: `stable`/`mutator`/`invalidates` on JS/DOM Built-in Types

> Research document assessing what would happen if `stable`/`mutator`/`invalidates`
> modifiers were added to JavaScript's built-in type definitions (`lib.dom.d.ts`,
> `lib.es*.d.ts`, etc.).

**Status:** Research Complete  
**Context:** Phase 1 `stable`/`mutator`/`invalidates` system in TypeScript-Go  
**Related:**
- [stable-modifier-spec.md](stable-modifier-spec.md) — Phase 1 SDD
- [transitive-mutator-propagation-research.md](transitive-mutator-propagation-research.md) — Transitive propagation
- [lying-setter-mutator-soundness-research.md](lying-setter-mutator-soundness-research.md) — Soundness analysis

---

## 0. The Fundamental Constraint

**Our `stable` modifier only works for zero-argument function calls.** This is hardcoded in the checker:

```go
// internal/checker/flow.go
func isNoArgCallExpression(node *ast.Node) bool {
    return ast.IsCallExpression(node) && len(node.Arguments()) == 0
}

func (c *Checker) isStableCallReference(reference *ast.Node) bool {
    if !isNoArgCallExpression(reference) {
        return false
    }
    signature := c.getResolvedSignature(reference, nil, CheckModeTypeOnly)
    return signature != nil && signature != c.resolvingSignature &&
           signature.flags&SignatureFlagsStable != 0
}
```

This constraint exists because CFA tracks narrowing by **flow node identity**. Two calls
`f()` and `f()` at different program points are treated as "the same reference" because
the callee is the same symbol with no arguments to distinguish them. But `map.get("a")`
and `map.get("b")` are different logical reads — CFA cannot track argument-dependent
stability without a fundamentally different architecture.

**This single constraint eliminates the vast majority of JS/DOM built-in APIs from consideration.**

---

## 1. API-by-API Analysis

### 1.1 Map<K, V>

```ts
interface Map<K, V> {
  get(key: K): V | undefined;       // Takes arg — NOT eligible
  set(key: K, value: V): this;      // Takes arg
  delete(key: K): boolean;          // Takes arg
  has(key: K): boolean;             // Takes arg
  clear(): void;                    // Zero-arg, but returns void
  readonly size: number;            // Property, not function call
}
```

| Method | Zero-arg? | Returns union? | Stable candidate? |
|--------|-----------|----------------|-------------------|
| `get(key)` | No | Yes (`V \| undefined`) | **No** |
| `has(key)` | No | No (boolean) | **No** |
| `set(key, value)` | No | No | **No** |
| `delete(key)` | No | No | **No** |
| `clear()` | Yes | void | Mutator candidate only |
| `size` | Property | number | N/A (already a property) |

**Verdict: No eligible stable endpoints. The has/get pattern CANNOT benefit from `stable`.**

The common pattern `if (map.has(key)) { map.get(key)!.doSomething() }` would require a
hypothetical `stable(key)` (argument-dependent stability) feature — see Section 3.

Could `clear()` be marked `mutator`? Yes, but there's nothing to invalidate since no
Map methods are `stable`. The only benefit would be if a future `stable(key)` feature
existed.

**Impact on existing code: None (zero-arg constraint blocks all useful patterns).**

---

### 1.2 Array<T>

```ts
interface Array<T> {
  // Zero-arg methods:
  pop(): T | undefined;       // NOT stable — mutates array, different each call
  shift(): T | undefined;     // NOT stable — mutates array, different each call
  reverse(): this;             // Mutator, returns same ref but modifies in place
  sort(): this;                // Mutator (when no compareFn)
  
  // Takes args — NOT eligible:
  at(index: number): T | undefined;
  push(...items: T[]): number;
  splice(start: number, ...): T[];
  fill(value: T, ...): this;
  unshift(...items: T[]): number;
  indexOf(searchElement: T, ...): number;
  
  // Properties:
  readonly length: number;     // Property, not function call
}
```

| Method | Zero-arg? | Stable? | Why not? |
|--------|-----------|---------|----------|
| `pop()` | Yes | **No** | Returns different value each call (destructive) |
| `shift()` | Yes | **No** | Returns different value each call (destructive) |
| `reverse()` | Yes | **No** | Mutates in place; calling twice reverses back |
| `sort()` | Yes | **No** | Mutates in place |
| `at(i)` | No | **No** | Takes argument |

Zero-arg array methods are all either mutating (pop, shift, reverse, sort) or trivial
(toString, valueOf). None qualify as stable because they inherently produce different
results on repeated calls.

**Verdict: Zero eligible endpoints. Arrays are fundamentally mutable sequences.**

Could mutator annotations on `push`/`pop`/etc. help? Only if there were something `stable`
to invalidate — but there isn't. `length` is a property (CFA already handles property
narrowing natively).

**Impact on existing code: None.**

---

### 1.3 Set<T>

```ts
interface Set<T> {
  has(value: T): boolean;     // Takes arg — NOT eligible
  add(value: T): this;        // Takes arg
  delete(value: T): boolean;  // Takes arg
  clear(): void;              // Zero-arg, void return
  readonly size: number;      // Property
}
```

Same analysis as Map. All interesting methods take arguments. No stable candidates.

**Verdict: No eligible endpoints. Impact: None.**

---

### 1.4 WeakRef<T>

```ts
interface WeakRef<T extends WeakKey> {
  deref(): T | undefined;  // ← Zero-arg, returns T | undefined
}
```

**This is the ONE built-in API that perfectly fits `stable`.**

| Criterion | Assessment |
|-----------|-----------|
| Zero-arg? | **Yes** |
| Returns union? | **Yes** (`T \| undefined`) |
| Same result on repeated calls? | **Yes** (within the same synchronous execution / microtask) |
| Would narrowing help? | **Yes** — eliminates need for temp variables |

#### Common pattern today:
```ts
const ref = new WeakRef(someObject);

// Pattern 1: Users must use temp variable
const obj = ref.deref();
if (obj !== undefined) {
  obj.doSomething(); // OK
}

// Pattern 2: What users WANT to write (currently errors)
if (ref.deref() !== undefined) {
  ref.deref().doSomething(); // Error: Object is possibly 'undefined'
}
```

#### With `stable` annotation:
```ts
interface WeakRef<T extends WeakKey> {
  deref: stable () => T | undefined;
}

// Now works:
if (ref.deref() !== undefined) {
  ref.deref().doSomething(); // OK — narrowed to T
}
```

#### Soundness concern:
Is `deref()` truly stable? The GC could technically collect the referenced object between
two synchronous calls. However:

1. **Within a synchronous execution tick**, the GC cannot run (JS is single-threaded, 
   GC can only run between microtasks or during `await`).
2. The `stable` system already invalidates across `await` boundaries.
3. **ECMAScript semantics guarantee**: If `deref()` returns the object (not undefined),
   that object cannot be collected during the same synchronous turn because the engine
   holds a strong reference to it for the duration of the call stack.

**Practical soundness: YES — `deref()` is stable within a synchronous execution context,
which is exactly the scope our CFA tracks.**

#### Would it break existing code?
No. Adding `stable` to `deref()` only makes CFA **more permissive** (preserves narrowing
that would otherwise be lost). It cannot introduce new type errors because:
- It never makes types narrower than the declared return type
- It only preserves narrowing that the user explicitly established via type guards

#### Bug-finding potential:
Low for finding bugs, but **high for ergonomic improvement**. The main benefit is
eliminating unnecessary temp variables when using WeakRef patterns.

**Verdict: PERFECT candidate. Worth annotating. No breaking changes. Pure ergonomic win.**

However: WeakRef is rarely used in typical application code. It's primarily used in
framework internals, caching layers, and polyfills. The real-world impact on most
codebases would be minimal.

---

### 1.5 Promise<T>

```ts
interface Promise<T> {
  then<R1, R2>(onfulfilled?, onrejected?): Promise<R1 | R2>;
  catch<R>(onrejected?): Promise<T | R>;
  finally(onfinally?): Promise<T>;
}
```

Promises are **immutable once created**. `.then()` returns a NEW Promise — it doesn't
modify the original. There's nothing to mark as `stable` or `mutator`.

**Verdict: Not applicable. Promises are already functionally immutable.**

---

### 1.6 HTMLElement / DOM APIs

```ts
// Zero-arg DOM methods returning nullable:
interface TreeWalker {
  firstChild(): Node | null;       // NOT stable — advances walker position
  lastChild(): Node | null;        // NOT stable — advances walker position  
  nextNode(): Node | null;         // NOT stable — advances walker position
  nextSibling(): Node | null;      // NOT stable — advances walker position
  parentNode(): Node | null;       // NOT stable — advances walker position
  previousNode(): Node | null;     // NOT stable — advances walker position
  previousSibling(): Node | null;  // NOT stable — advances walker position
}

interface NodeIterator {
  nextNode(): Node | null;         // NOT stable — advances iterator
  previousNode(): Node | null;     // NOT stable — advances iterator
}

// Properties (not function calls — CFA handles these natively):
interface Element {
  readonly parentElement: Element | null;    // Property
  readonly firstElementChild: Element | null; // Property
  readonly nextElementSibling: Element | null; // Property
}
```

**DOM zero-arg methods are almost universally NON-stable.** TreeWalker/NodeIterator
methods advance internal cursor state — calling `nextNode()` twice returns different
nodes. These are essentially iterators, not getters.

DOM **properties** like `parentElement`, `firstChild`, etc. are already handled by
CFA's property narrowing system (they're properties, not function calls, so `stable`
doesn't apply).

Other zero-arg DOM methods that return nullable:
- `getSelection(): Selection | null` — Could be stable within a synchronous tick,
  but it's a static method, not called on a receiver with mutable state. It also
  depends on user focus state which can change.
- `getPublicKey(): ArrayBuffer | null` — Returns credential data, effectively stable.
  But this is rarely used with repeated calls.
- `getAsFile(): File | null` — DataTransferItem method, stable within a drag event
  handler. Rarely called twice.
- `getSVGDocument(): Document | null` — Stable per embed element. Rarely narrowing-relevant.
- `getContextAttributes(): WebGLContextAttributes | null` — Stable. But not typically
  used with narrowing patterns.

**DOM APIs with mutator potential:**
```ts
// These could theoretically be mutators:
interface Element {
  remove(): void;           // Mutates DOM tree
  replaceChildren(): void;  // Mutates children
}
interface Node {
  normalize(): void;        // Mutates text nodes
}
```
But there's nothing `stable` to invalidate on these receivers, so marking them `mutator`
achieves nothing.

**Verdict: No practical DOM candidates. DOM properties are handled by property CFA.
DOM zero-arg methods are iterators/cursors, not stable reads.**

---

### 1.7 RegExp

```ts
interface RegExp {
  test(string: string): boolean;        // Takes arg — NOT eligible
  exec(string: string): RegExpExecArray | null;  // Takes arg + has lastIndex side effect
  
  // Zero-arg properties:
  readonly source: string;     // Property
  readonly flags: string;      // Property
  readonly global: boolean;    // Property
  readonly ignoreCase: boolean; // Property
  readonly multiline: boolean; // Property
}
```

All RegExp methods that return interesting types take arguments. The readonly properties
are properties (not function calls). `exec()` additionally has the notorious `lastIndex`
side effect, making it doubly unsuitable.

**Verdict: No eligible endpoints. Impact: None.**

---

### 1.8 Error / Standard Value Objects

```ts
interface Error {
  readonly message: string;   // Property
  readonly name: string;      // Property
  readonly stack?: string;    // Property (not guaranteed stable across engines)
}

interface Date {
  getTime(): number;          // Zero-arg, stable — but returns number (no union narrowing benefit)
  getFullYear(): number;      // Zero-arg, stable — but returns number
  getMonth(): number;         // Zero-arg, stable — but returns number
  // ...all getter methods return number, no union types
}
```

Date methods are zero-arg and stable, but they return `number` — there's no union type
to narrow. `stable` only adds value when the return type is a union (`T | undefined`,
`T | null`, `string | number`, etc.) and you want CFA to preserve a type guard.

**Verdict: Technically eligible, but no practical benefit. No union types to narrow.**

---

### 1.9 Iterator / Generator

```ts
interface Iterator<T> {
  next(): IteratorResult<T>;   // NOT stable — returns different values each call
}
interface Generator<T, TReturn, TNext> {
  next(value?: TNext): IteratorResult<T, TReturn>;  // NOT stable, takes optional arg
  return(value?: TReturn): IteratorResult<T, TReturn>;
  throw(e?: any): IteratorResult<T, TReturn>;
}
```

Iterators are the **opposite** of stable — their entire purpose is to return different
values on each call. `next()` advances the iterator position.

**Verdict: Categorically ineligible. Iterators are stateful readers by design.**

---

### 1.10 Intl APIs

```ts
interface Intl.NumberFormat {
  resolvedOptions(): ResolvedNumberFormatOptions;  // Zero-arg, returns same options
}
interface Intl.DateTimeFormat {
  resolvedOptions(): ResolvedDateTimeFormatOptions;  // Zero-arg, returns same options
}
interface Intl.Collator {
  resolvedOptions(): ResolvedCollatorOptions;  // Zero-arg, returns same options
}
```

`resolvedOptions()` is zero-arg and technically stable (returns the same configuration
object). BUT: the return type is a concrete object type (not a union), so there's no
narrowing opportunity.

**Verdict: Technically eligible, but no practical benefit. No union types to narrow.**

---

### 1.11 Blob / File / Body (Fetch API)

```ts
interface Body {
  arrayBuffer(): Promise<ArrayBuffer>;   // Zero-arg, but returns Promise (async)
  blob(): Promise<Blob>;                 // Zero-arg, but returns Promise (async)
  text(): Promise<string>;               // Zero-arg, but returns Promise (async)
  json(): Promise<any>;                  // Zero-arg, but returns Promise (async)
}

interface Blob {
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream<Uint8Array>;  // Zero-arg, could be stable
  text(): Promise<string>;
}
```

These are zero-arg but:
1. Most return `Promise<T>` — CFA resets across `await` boundaries.
2. The return types aren't unions — no narrowing to preserve.
3. `Body` methods can only be consumed ONCE — calling `text()` twice rejects the second time.

**Verdict: Not eligible. Async returns + no union types + one-shot consumption.**

---

### 1.12 AudioData / VideoFrame (Media APIs)

```ts
interface AudioData {
  clone(): AudioData;  // Zero-arg, but creates a new object — not same-value stable
}
interface VideoFrame {
  clone(): VideoFrame;  // Same — creates new object
}
```

`clone()` creates a **new object** each time — not stable (different reference each call).

**Verdict: Not eligible. `clone()` semantics are inherently non-stable.**

---

## 2. Complete Eligibility Census

### 2.1 All Zero-Arg Methods in ES/DOM Libs Returning Union Types

After exhaustive grep of all `lib.es*.d.ts` and `lib.dom.d.ts`:

| API | Method | Return Type | Truly Stable? | Narrowing Benefit? |
|-----|--------|-------------|---------------|--------------------|
| **WeakRef<T>** | `deref()` | `T \| undefined` | **Yes** (within sync tick) | **Yes** |
| Array<T> | `pop()` | `T \| undefined` | No (destructive) | No |
| Array<T> | `shift()` | `T \| undefined` | No (destructive) | No |
| TreeWalker | `nextNode()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `previousNode()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `firstChild()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `lastChild()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `nextSibling()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `parentNode()` | `Node \| null` | No (advances cursor) | No |
| TreeWalker | `previousSibling()` | `Node \| null` | No (advances cursor) | No |
| NodeIterator | `nextNode()` | `Node \| null` | No (advances iterator) | No |
| NodeIterator | `previousNode()` | `Node \| null` | No (advances iterator) | No |
| XPathResult | `iterateNext()` | `Node \| null` | No (advances iterator) | No |
| SVGTransformList | `consolidate()` | `SVGTransform \| null` | Possibly | Rare use case |
| GPUDevice | `popErrorScope()` | `Promise<GPUError \| null>` | No (async + consumes scope) | No |
| AuthenticatorAttestationResponse | `getPublicKey()` | `ArrayBuffer \| null` | Yes | Very rare use |
| Navigator | `getGamepads()` | `(Gamepad \| null)[]` | Questionable | No union narrowing |

**Total truly eligible: 1 (WeakRef.deref) + 1 marginal (AuthenticatorAttestationResponse.getPublicKey)**

### 2.2 Zero-Arg Methods Returning Non-Union Types (No Narrowing Benefit)

These are technically stable but provide zero narrowing benefit because the return type
is not a union:

- `Date.getTime()`, `Date.getFullYear()`, ... → `number`
- `Intl.*.resolvedOptions()` → concrete option objects
- `Blob.stream()` → `ReadableStream`
- `String.trimEnd()`, `String.big()`, ... → `string`
- `Node.entries()`, `keys()`, `values()` → iterators

**Count: ~50+ methods, but none benefit from `stable` narrowing.**

---

## 3. The Hypothetical: `stable(key)` (Argument-Dependent Stability)

The analysis above reveals a massive gap: the most useful patterns (`Map.get(key)`,
`Set.has(value)`, `Array.at(index)`) all take arguments. Would a hypothetical
argument-aware stable system change the picture?

### 3.1 What `stable(key)` Would Mean

```ts
interface Map<K, V> {
  get: stable (key: K) => V | undefined;  // Same key → same result (until mutated)
  set: mutator (key: K, value: V) => this invalidates get;
  delete: mutator (key: K) => boolean invalidates get;
}
```

CFA would need to track not just "was `get` called?" but "was `get` called **with the
same argument**?" This fundamentally changes the CFA tracking model:

```ts
const map = new Map<string, number>();

if (map.get("x") !== undefined) {
  map.get("x");  // narrowed to number (same key)
  map.get("y");  // NOT narrowed (different key)
  
  map.set("x", 42);  // invalidates get("x") → post-call narrowing from argument
  map.get("x");      // narrowed to number (argument type propagated)
  
  map.set("y", 10);  // invalidates get("y"), NOT get("x")
  map.get("x");      // ??? depends on whether invalidation is per-key
}
```

### 3.2 Implementation Complexity

Argument-dependent stability would require:

1. **CFA flow node identity to include arguments**: Currently, flow nodes for call
   expressions are keyed by the call expression AST node. Argument-dependent stability
   would need to compare argument values across flow nodes.

2. **Argument equivalence checking**: CFA would need to determine that `get("x")` at
   line 5 and `get("x")` at line 8 have "the same argument." For literals this is
   straight-forward; for variables it requires tracking the variable's flow state.

3. **Per-argument invalidation**: `set("x", value)` should invalidate `get("x")` but
   not `get("y")`. This requires matching argument values between the mutator call and
   the stable call.

4. **Performance concerns**: Tracking argument-dependent stability multiplies the number
   of flow states the checker must track. For a hot loop with many map accesses, this
   could be expensive.

**Feasibility: HIGH complexity, UNCERTAIN performance impact. Would be a Phase 3+
feature at earliest.**

### 3.3 Patterns That Would Benefit

```ts
// Pattern 1: Map has/get (extremely common)
if (map.has("key")) {
  const val = map.get("key")!;  // Currently requires non-null assertion
  // With stable(key): map.get("key") narrows to V
}

// Pattern 2: Map get with undefined check (extremely common)
const val = map.get("key");
if (val !== undefined) {
  // val is narrowed, but map.get("key") is not
  map.get("key").doSomething(); // Error today, would work with stable(key)
}

// Pattern 3: Set has check (common)
if (set.has(item)) {
  // Doesn't help narrowing since has() returns boolean
  // Would need linked predicates: has(item) being true => get(item) is V
}
```

**Assessment: Pattern 1 and 2 are extremely common in real-world code. Argument-dependent
stability would have MASSIVE ecosystem impact — but it's also a much harder problem.**

---

## 4. Would `mutates` Parameter Modifier Change the Answer?

The transitive propagation research explored a `mutates` parameter modifier:

```ts
function wrapper(mutates r: Resource<string>) {
  r.set("value");
}
```

This marks parameters as potentially mutated by the function. Would this help with
built-in APIs?

**No.** The `mutates` modifier affects how **callers** of `wrapper` see their stable
references — it tells CFA that passing a resource to `wrapper()` might invalidate
stable narrowing on that resource. This is a transitive propagation concern, not a
lib definition concern.

For lib types, we'd need `mutator` on the method itself, not `mutates` on parameters.
And even then, `mutator` is only useful when there are `stable` endpoints to invalidate.

---

## 5. Impact Assessment Summary

### 5.1 Quantitative Impact

| Category | APIs Examined | Eligible for `stable` | Narrowing Benefit | Would Find Bugs | Would Break Code |
|----------|:---:|:---:|:---:|:---:|:---:|
| Map | 6 | 0 | 0 | 0 | 0 |
| Array | 15 | 0 | 0 | 0 | 0 |
| Set | 5 | 0 | 0 | 0 | 0 |
| WeakRef | 1 | **1** | **1** | 0 | 0 |
| Promise | 3 | 0 | 0 | 0 | 0 |
| DOM Elements | ~100 | 0 | 0 | 0 | 0 |
| DOM Iterators | 10 | 0 | 0 | 0 | 0 |
| RegExp | 4 | 0 | 0 | 0 | 0 |
| Date | 20+ | 20+ (technically) | 0 | 0 | 0 |
| Intl | 6 | 6 (technically) | 0 | 0 | 0 |
| Error | 3 | 0 | 0 | 0 | 0 |
| Iterator/Generator | 3 | 0 | 0 | 0 | 0 |
| Fetch/Body | 5 | 0 | 0 | 0 | 0 |
| **Total** | **~180** | **~27** | **1** | **0** | **0** |

### 5.2 Key Takeaways

1. **WeakRef.deref() is the only built-in API that benefits from `stable`.** It's
   zero-arg, returns a union type, and is genuinely stable within a synchronous tick.
   Adding `stable` would be a zero-risk ergonomic improvement.

2. **The zero-arg constraint eliminates ~95% of candidates.** The most impactful APIs
   (Map.get, Set.has, Array.at, document.getElementById) all take arguments. Without
   argument-dependent stability, `stable` cannot help them.

3. **No built-in API would be broken** by adding `stable`/`mutator` annotations.
   `stable` makes CFA more permissive, not more restrictive. `mutator` could
   theoretically cause new errors if stable narrowing was being relied upon, but
   there are no stable endpoints in built-ins to invalidate.

4. **No real bugs would be found** by annotating built-in types. The one eligible
   API (WeakRef.deref) doesn't have soundness issues that narrowing would expose.

5. **The feature IS "just for signals"** when constrained to zero-arg. The entire
   value proposition is:
   - Framework signal APIs: `value()`, `count()`, `user()` — **HIGH value**
   - WeakRef.deref() — **marginal value** (rarely used)
   - Everything else — **no value**

### 5.3 The Broader Ecosystem Value

Despite the lack of built-in API impact, `stable`/`mutator` has significant value via:

| Ecosystem | Value | Examples |
|-----------|-------|---------|
| Angular Signals | **Very High** | `signal()`, `computed()`, `input()` |
| SolidJS Signals | **Very High** | `createSignal()[0]()`, `createMemo()()` |
| TC39 Signal Proposal | **Very High** | `signal.get()` when it ships |
| Preact Signals | **High** | `signal.value` (property, but `.peek()` is zero-arg) |
| Vue Refs | **Moderate** | `.value` is a property, but computed refs use `.value` |
| MobX Observables | **Moderate** | Computed values accessed as properties |
| Custom reactive stores | **High** | Any signal-like zero-arg getter pattern |
| RxJS | **Low** | Observables are push-based, not pull-based |

The value is overwhelmingly in **userland reactive/signal APIs**, not in platform built-ins.

---

## 6. Answers to Final Questions

### Q1: How many JS/DOM APIs are actually eligible for `stable`?

**~27 are technically zero-arg, but only 1 (WeakRef.deref) returns a union type where
narrowing would help.** The other ~26 return concrete types (number, string, object)
where there's nothing to narrow.

### Q2: Would `mutates` parameter modifier change the answer?

**No.** The `mutates` modifier is about transitive propagation (marking function parameters
as potentially mutated). It helps callers of user-defined wrapper functions, not the
built-in API definitions themselves. Built-in APIs need `mutator` on methods, not `mutates`
on parameters, and `mutator` is useless without `stable` endpoints to invalidate.

### Q3: Would `stable(key)` open up Map/Set patterns?

**Yes, dramatically.** Argument-dependent stability would unlock:
- `Map.get(key)` / `Map.has(key)` linking — the single most requested TS narrowing feature
- `Array.at(index)` stability
- `Set.has(value)` type predicates
- `document.getElementById(id)` stability

This would affect virtually every TypeScript codebase. However, it requires fundamental
CFA architecture changes (argument-aware flow tracking) and is a Phase 3+ consideration.

### Q4: Overall impact on JS/DOM ecosystem?

**Minimal for zero-arg `stable`.** The feature's value is:
- **95% userland** (signals, reactive stores, custom APIs)
- **5% built-in** (WeakRef.deref only)
- **0% breaking** (no existing code would be affected)

The `stable` modifier is correctly positioned as a **library/framework feature**, not a
**platform feature**. Its power comes from enabling framework authors (Angular, Solid,
TC39 Signals) to annotate their APIs, not from annotating built-in JavaScript types.

This is actually **a strength of the design**: it doesn't require changes to lib.d.ts
to deliver value. Framework `.d.ts` files can adopt `stable`/`mutator` independently,
without waiting for TC39 or W3C standardization of the annotations.

---

## 7. Recommendations

1. **Do NOT prioritize lib.d.ts annotations.** The return on investment is near-zero
   for built-in types with the current zero-arg constraint.

2. **Consider annotating WeakRef.deref as `stable` as a proof-of-concept.** It's the
   one built-in that cleanly fits, even if the practical impact is small.

3. **Focus ecosystem evangelization on signal frameworks.** Angular, SolidJS, and the
   TC39 Signal proposal are where `stable`/`mutator` delivers transformative value.

4. **Evaluate `stable(key)` as a future extension.** If the feature proves successful
   for signals, argument-dependent stability for Map/Set patterns would have massive
   ecosystem impact — but it's a fundamentally harder problem that should not gate
   Phase 1 or Phase 2.

5. **Document the zero-arg constraint prominently** in user-facing docs. Users will
   inevitably ask "can I use `stable` on Map.get?" and the answer needs to be clear
   and explain why not.
