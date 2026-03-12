# Research: ngxtension Signal Utilities — `stable`/`mutator`/`invalidates` Integration

> **Status**: Research (informational)
> **Context**: `stable`/`mutator`/`invalidates` CFA system in TypeScript-Go
> **Related**:
> - [research-angular-computed-integration.md](research-angular-computed-integration.md) — Core Angular `computed()` integration (prerequisite reading)
> - [../stable-modifier-spec.md](../stable-modifier-spec.md) — Phase 1 SDD
> - [../research-map-has-get-narrowing.md](../research-map-has-get-narrowing.md) — Map `.has()`/`.get()` keyed narrowing
> - [../research-solidjs-cross-binding.md](../research-solidjs-cross-binding.md) — SolidJS cross-binding invalidation
> - [../stable-design-decisions.md](../stable-design-decisions.md) — Open decisions

---

## 1. Executive Summary

[ngxtension](https://ngxtension.netlify.app/) is a community-driven Angular utility library that extends Angular's core signal primitives with higher-level reactive abstractions: `SignalMap`, `SignalSet`, `signalSlice`, `signalHistory`, `createNotifier`, and more. Several of these utilities are **ideal candidates** for the proposed `stable`/`mutator`/`invalidates` CFA modifiers — and one, `SignalMap`, is arguably the **perfect showcase** for `stable[key]` keyed narrowing.

**Key Findings:**

1. **`SignalMap` is the single most compelling real-world use case for `stable[key]`** — its per-key reactive tracking at runtime perfectly mirrors per-key narrowing invalidation at the type level.
2. **`signalSlice` demonstrates state management with CFA** — selectors are `stable`, action sources are `mutator`, giving narrowing-safe state management out of the box.
3. **`signalHistory` benefits from selective invalidation** — `undo()`/`redo()` are mutators that should invalidate `history()` but not `canUndo()` (or vice versa, depending on semantics).
4. **Most async/derived utilities are already covered** by core Angular `Signal<T>` type annotations — they return read-only `Signal<T>`, which gets `stable` from the base type.
5. **No runtime changes needed** — all annotations are purely type-level. ngxtension's runtime reactivity already provides the guarantees that `stable`/`mutator` codify.

**Impact Assessment:** Annotating ngxtension's `.d.ts` files would immediately benefit narrowing for ~14,000+ npm weekly installs, with `SignalMap` alone providing the most compelling `stable[key]` demo outside of the standard `Map` type.

---

## 2. ngxtension Signal Ecosystem Overview

| # | Utility | Category | Relevance | Tier | Rationale |
|---|---------|----------|-----------|------|-----------|
| 1 | `SignalMap<K,V>` | Container | ★★★★★ | 1 | **Perfect** `stable[key]` candidate — per-key reactivity matches per-key invalidation |
| 2 | `SignalSet<T>` | Container | ★★★★☆ | 1 | `has()`/`add()`/`delete()` with structural invalidation |
| 3 | `signalSlice` | State Mgmt | ★★★★☆ | 1 | Selectors = `stable`, actions = `mutator` |
| 4 | `createNotifier` | Primitive | ★★★☆☆ | 2 | `listen()` = `stable`, `notify()` = `mutator invalidates listen()` |
| 5 | `signalHistory` | State Mgmt | ★★★☆☆ | 2 | `undo()`/`redo()` = `mutator`, `history()` = `stable` |
| 6 | `createSignal` | Primitive | ★★★☆☆ | 2 | Vue-style `.value` setter = `mutator` of `.value` getter |
| 7 | `createComputed` | Primitive | ★★☆☆☆ | 3 | Read-only — inherits `stable` from `Signal<T>` |
| 8 | `computedPrevious` | Primitive | ★★☆☆☆ | 3 | Read-only — inherits `stable` from `Signal<T>` |
| 9 | `derivedAsync` | Async | ★★☆☆☆ | 3 | Read-only — inherits `stable` from `Signal<T>` |
| 10 | `derivedFrom` | Async | ★★☆☆☆ | 3 | Read-only — inherits `stable` from `Signal<T>` |
| 11 | `connect` | Async | ★★☆☆☆ | 3 | Feeds into `WritableSignal<T>` — covered by core types |
| 12 | `toLazySignal` | Async | ★★☆☆☆ | 3 | Read-only — inherits `stable` from `Signal<T>` |
| 13 | `extendedComputed` | Primitive | ☆☆☆☆☆ | 4 | **DEPRECATED** in favor of `computedPrevious` |
| 14 | `createEffect` | Effect | ★☆☆☆☆ | 4 | Side-effect channel — not directly relevant to CFA |
| 15 | `explicitEffect` | Effect | ★☆☆☆☆ | 4 | Explicit deps interesting but no narrowing impact |

---

## 3. Tier 1: High-Value Candidates

### 3.1 `SignalMap<K, V>` — The Star Candidate

#### What It Does

`SignalMap` is a reactive `Map` wrapper that provides **per-key granular reactivity**. Reading `map.get(key)` only subscribes to changes for *that specific key* — not the entire map. This is achieved through internal signal-per-key tracking.

#### Current Type Signature (simplified)

```ts
class SignalMap<K, V> {
  constructor(entries?: Iterable<[K, V]> | null);

  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;

  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  forEach(callbackfn: (value: V, key: K, map: SignalMap<K, V>) => void): void;

  [Symbol.iterator](): IterableIterator<[K, V]>;
}
```

#### Proposed Annotated Type

```ts
class SignalMap<K, V> {
  constructor(entries?: Iterable<[K, V]> | null);

  // Per-key stable getter — narrowing preserved across calls with same key
  stable[key] get(key: K): V | undefined;

  // Per-key mutator — invalidates ONLY the affected key's narrowing
  mutator invalidates get[key] set(key: K, value: V): this;

  // Keyed linked predicate — has(k) narrows get(k) from V|undefined to V
  stable[key] has(key: K): this.get(key) is V;

  // Per-key mutator — invalidates that key AND structure
  mutator invalidates get[key] delete(key: K): boolean;

  // Blanket mutator — invalidates ALL keys and structure
  mutator clear(): void;

  // Structural stable getters
  stable readonly size: number;

  // Iteration — stable structural reads
  stable keys(): IterableIterator<K>;
  stable values(): IterableIterator<V>;
  stable entries(): IterableIterator<[K, V]>;
  forEach(callbackfn: (value: V, key: K, map: SignalMap<K, V>) => void): void;
}
```

#### CFA Behavior Example

```ts
const users = new SignalMap<string, User | null>();
users.set("alice", { name: "Alice", role: "admin" });
users.set("bob", null);

const alice = users.get("alice");
// alice: User | null

if (alice !== null) {
  // alice narrowed to: User ✓

  console.log(alice.name);       // ✓ OK — alice is User

  const bob = users.get("bob");  // Different key — does NOT invalidate alice's narrowing
  console.log(alice.name);       // ✓ STILL OK — alice's narrowing preserved (stable[key])

  users.set("bob", { name: "Bob", role: "viewer" });
  //       ^^^^^^^^ mutator invalidates get["bob"]
  console.log(alice.name);       // ✓ STILL OK — only "bob" key invalidated, not "alice"

  users.set("alice", null);
  //       ^^^^^^^^ mutator invalidates get["alice"]
  console.log(alice.name);       // ✗ ERROR — alice's narrowing invalidated! (alice could be null now)

  users.clear();
  //    ^^^^^^^ mutator (blanket) — invalidates ALL narrowings
}
```

#### Why This Matters

The runtime behavior of `SignalMap` is **already per-key-reactive** — setting `"bob"` doesn't notify listeners of `"alice"`. The `stable[key]` + `invalidates get[key]` annotations make the *type system* match this runtime guarantee. Without these annotations, TypeScript would conservatively reset all narrowings after any `.set()` call, even for unrelated keys.

---

### 3.2 `SignalSet<T>`

#### What It Does

`SignalSet` is a reactive `Set` wrapper with structure-level reactivity. Unlike `SignalMap`, there's no per-key value retrieval — `has()` is the primary read operation.

#### Current Type Signature

```ts
class SignalSet<T> {
  constructor(values?: Iterable<T> | null);

  has(value: T): boolean;
  add(value: T): this;
  delete(value: T): boolean;
  clear(): void;
  readonly size: number;

  keys(): IterableIterator<T>;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[T, T]>;
  forEach(callbackfn: (value: T, value2: T, set: SignalSet<T>) => void): void;
}
```

#### Proposed Annotated Type

```ts
class SignalSet<T> {
  constructor(values?: Iterable<T> | null);

  // Stable structural read — tracks set membership
  stable has(value: T): boolean;

  // Mutator — modifies structure, invalidates has() and size
  mutator add(value: T): this;

  // Mutator — modifies structure
  mutator delete(value: T): boolean;

  // Blanket mutator — invalidates everything
  mutator clear(): void;

  // Stable structural read
  stable readonly size: number;

  stable keys(): IterableIterator<T>;
  stable values(): IterableIterator<T>;
  stable entries(): IterableIterator<[T, T]>;
}
```

> **Note:** `SignalSet` doesn't benefit from `stable[key]` because `has()` returns `boolean`, not a union type. There's no type narrowing to preserve — the value is always `boolean`. The benefit is purely in preserving the `boolean` narrowing across other stable calls. For example: after checking `set.has(x)` in a branch, calling `set.has(y)` for a different value doesn't invalidate the `has(x)` check.

#### CFA Example

```ts
const permissions = new SignalSet<string>();
permissions.add("read");
permissions.add("write");

if (permissions.has("admin")) {
  // narrowed to: true branch — "admin" is in the set

  permissions.add("logging");
  // mutator — but since has() doesn't return a union narrowing,
  // the practical CFA benefit is limited.
  // However, if we had previously narrowed 'size' or checked 'has("admin")',
  // those narrowings would be invalidated by the structural mutation.
}
```

---

### 3.3 `signalSlice` — State Management with CFA

#### What It Does

`signalSlice` creates a Redux-like state slice with computed selectors and declarative action sources. It returns a signal containing the state, plus derived selectors and action methods.

#### Current Type Signature (conceptual — highly generic)

```ts
function signalSlice<TState extends object>(config: {
  initialState: TState;
  sources?: Array<Observable<Partial<TState>>>;
  actionSources?: {
    [key: string]: (state: Signal<TState>, action$: Subject<any>) => Observable<Partial<TState>>;
  };
  selectors?: (state: Signal<TState>) => {
    [key: string]: Signal<any>;
  };
}): SignalSlice<TState>;

// Return type (conceptual)
type SignalSlice<TState> = Signal<TState> & {
  // Selectors — computed signals derived from state
  [SelectorKey]: Signal<SelectorReturnType>;

  // Actions — methods that trigger state updates
  [ActionKey]: (payload?: ActionPayload) => void;
};
```

#### Proposed Annotated Type

```ts
type SignalSlice<TState> = Signal<TState> & {
  // Reading the slice itself — stable (computed from internal state)
  stable (): TState;

  // All selectors — stable (computed from state)
  stable [SelectorKey]: Signal<SelectorReturnType>;

  // All actions — mutators (trigger state updates)
  mutator [ActionKey]: (payload?: ActionPayload) => void;
};
```

#### CFA Behavior Example

```ts
interface TodoState {
  todos: Todo[];
  filter: "all" | "active" | "completed";
  loading: boolean;
}

const todoSlice = signalSlice({
  initialState: { todos: [], filter: "all" as const, loading: false },
  selectors: (state) => ({
    activeTodos: computed(() => state().todos.filter(t => !t.completed)),
    completedCount: computed(() => state().todos.filter(t => t.completed).length),
  }),
  actionSources: {
    addTodo: (state, action$: Subject<string>) =>
      action$.pipe(map(text => ({ todos: [...state().todos, { text, completed: false }] }))),
    setFilter: (state, action$: Subject<TodoState["filter"]>) =>
      action$.pipe(map(filter => ({ filter }))),
  },
});

const state = todoSlice();
// state: TodoState

if (state.filter === "active") {
  // state.filter narrowed to: "active" ✓

  const active = todoSlice.activeTodos();
  // stable selector — does NOT invalidate state.filter narrowing ✓

  console.log(state.filter); // ✓ still "active"

  todoSlice.setFilter("completed");
  // mutator — invalidates ALL stable narrowings on todoSlice ✓

  console.log(state.filter);
  // ✗ narrowing gone — state.filter could be anything now
}
```

---

## 4. Tier 2: Medium-Value Candidates

### 4.1 `createNotifier`

#### What It Does

Creates a notification channel: `listen()` returns an incrementing counter signal, `notify()` bumps it.

#### Current Type Signature

```ts
function createNotifier(): {
  listen: Signal<number>;
  notify: () => void;
};
```

> `listen` is a `Signal<number>`, so calling `listen()` returns a `number`. `notify()` causes `listen()` to return an incremented value.

#### Proposed Annotated Type

```ts
function createNotifier(): {
  stable listen: Signal<number>;
  mutator invalidates listen notify: () => void;
};
```

#### CFA Example

```ts
const notifier = createNotifier();

const count = notifier.listen();
// count: number

if (count > 0) {
  // count narrowed to: number (> 0)

  console.log(count.toFixed(2)); // ✓ OK — count is number

  notifier.notify();
  // mutator invalidates listen — count's narrowing from listen() is invalidated

  // If we re-read:
  const newCount = notifier.listen();
  // newCount could be different — fresh read
}
```

> **Practical Value:** Limited, because `number` narrowing via `> 0` is not a common pattern. The main benefit is demonstrating the `invalidates` mechanism on a simple API.

---

### 4.2 `signalHistory`

#### What It Does

Tracks history of a signal's values, enabling undo/redo functionality.

#### Current Type Signature

```ts
function signalHistory<T>(source: WritableSignal<T>, options?: {
  bufferSize?: number;
}): {
  history: Signal<T[]>;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  clear: () => void;
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;
};
```

#### Proposed Annotated Type

```ts
function signalHistory<T>(source: WritableSignal<T>, options?: {
  bufferSize?: number;
}): {
  stable history: Signal<T[]>;

  // undo/redo — mutators that change what history() and canUndo()/canRedo() return
  mutator undo: () => void;
  mutator redo: () => void;

  // reset/clear — blanket mutators
  mutator reset: () => void;
  mutator clear: () => void;

  stable canUndo: Signal<boolean>;
  stable canRedo: Signal<boolean>;
};
```

#### CFA Example

```ts
const count = signal(0);
const hist = signalHistory(count);

if (hist.canUndo()) {
  // canUndo() narrowed to: true ✓

  hist.undo();
  // mutator — invalidates canUndo() narrowing ✓
  // canUndo() might now be false (no more undo history)

  // Must re-check:
  if (hist.canUndo()) {
    hist.undo(); // safe
  }
}

const currentHistory = hist.history();
if (currentHistory.length > 0) {
  // currentHistory narrowed to: T[] with length > 0

  hist.clear();
  // mutator — invalidates history() narrowing
  // currentHistory still holds the old array reference,
  // but re-reading hist.history() would return []
}
```

> **Open Question:** Should `undo()` selectively invalidate `canUndo()` and `history()` but NOT `canRedo()`? The answer depends on whether we want maximum precision or simplicity. In practice, `undo()` affects ALL of `canUndo`, `canRedo`, and `history`, so blanket `mutator` is correct.

---

### 4.3 `createSignal` / `createComputed`

#### What It Does

Vue.js-style signal wrappers exposing a `.value` property instead of callable syntax.

#### Current Type Signature

```ts
function createSignal<T>(initialValue: T): WritableSignal<T> & { value: T };
function createComputed<T>(computation: () => T): Signal<T> & { value: T };
```

#### Proposed Annotated Type

```ts
// createSignal — the .value property has both getter (stable) and setter (mutator)
function createSignal<T>(initialValue: T): WritableSignal<T> & {
  stable get value(): T;
  mutator set value(v: T);
};

// createComputed — .value is read-only
function createComputed<T>(computation: () => T): Signal<T> & {
  stable get value(): T;
};
```

#### CFA Example

```ts
const name = createSignal<string | null>("Alice");

if (name.value !== null) {
  // name.value narrowed to: string ✓

  console.log(name.value.toUpperCase()); // ✓ OK

  name.value = null;
  // mutator (setter) — invalidates name.value narrowing ✓

  console.log(name.value.toUpperCase()); // ✗ ERROR — name.value could be null
}
```

> **Note:** This is architecturally identical to the core `WritableSignal` annotations — the `.value` accessor is just syntactic sugar for `signal()` / `signal.set()`.

---

## 5. Tier 3: Already Covered by Core Angular Types

These utilities all return `Signal<T>` (read-only). Their `stable` behavior comes from the base Angular `Signal<T>` type annotation — no ngxtension-specific annotations needed.

### 5.1 `computedPrevious`

```ts
// Returns Signal<T> — stable by base type
const prev = computedPrevious(mySignal);
// prev() is stable — narrowing preserved across calls
```

### 5.2 `derivedAsync`

```ts
// Returns Signal<T | undefined> — stable by base type
const data = derivedAsync(() => fetch('/api/users').then(r => r.json()));
// data() is stable — narrowing preserved
```

### 5.3 `derivedFrom`

```ts
// Returns Signal<CombinedType> — stable by base type
const combined = derivedFrom([signal1, signal2], pipe(map(([a, b]) => a + b)));
// combined() is stable — narrowing preserved
```

### 5.4 `connect`

```ts
// connect() itself doesn't return a signal — it feeds data into an existing WritableSignal
const count = signal(0);
connect(count, interval(1000));
// count is already WritableSignal<number> — covered by core types
// count.set() is mutator, count() is stable — by base type
```

### 5.5 `toLazySignal`

```ts
// Returns Signal<T> — stable by base type, lazy subscription
const lazy = toLazySignal(someObservable$);
// lazy() is stable — narrowing preserved
```

**Summary:** For all Tier 3 utilities, the only work needed is ensuring Angular's core `Signal<T>` and `WritableSignal<T>` are properly annotated with `stable`/`mutator`. ngxtension inherits these annotations automatically.

---

## 6. Tier 4: Irrelevant to CFA

### 6.1 `extendedComputed` (DEPRECATED)

Deprecated in favor of `computedPrevious`. No analysis warranted.

### 6.2 `createEffect` (NgRx-style)

Observable-based side-effect pipeline. Effects are fired-and-forget — they don't produce values that participate in CFA narrowing. No annotations needed.

### 6.3 `explicitEffect`

```ts
explicitEffect([dep1, dep2], ([val1, val2]) => {
  // side effect
});
```

While `explicitEffect` is architecturally interesting (it surfaces dependency information at the API level, unlike Angular's `effect()` which tracks implicitly), the effect callback is a side-effect — it doesn't produce a narrowable value. No CFA annotations needed.

> **Side note:** `explicitEffect`'s explicit deps array COULD theoretically inform a future "dependency-aware" CFA system that understands reactive graphs. This is far beyond current scope.

---

## 7. DEEP DIVE: `SignalMap` — The Perfect `stable[key]` Candidate

### 7.1 Why SignalMap is Special

Most reactive containers treat the entire container as a single reactive atom — mutating any entry notifies all listeners. `SignalMap` is different: it maintains **per-key signals** internally, so `map.get("alice")` and `map.get("bob")` are independently reactive.

This is the exact same granularity that `stable[key]` provides at the type level:

| Level | Per-key reactivity | Blanket mutation |
|-------|-------------------|-----------------|
| **Runtime** (ngxtension) | `set("alice", v)` notifies only `"alice"` listeners | `clear()` notifies all listeners |
| **Type system** (`stable[key]`) | `set("alice", v)` invalidates only `get("alice")` narrowing | `clear()` invalidates all narrowings |

The isomorphism is exact. This is not a coincidence — both systems solve the same problem (fine-grained dependency tracking) at different abstraction levels.

### 7.2 Current Type Definition (from ngxtension source)

```ts
// Simplified from ngxtension source
export class SignalMap<K, V> implements Iterable<[K, V]> {
  private readonly _map: Map<K, WritableSignal<V | undefined>>;
  private readonly _size: WritableSignal<number>;
  private readonly _keys: WritableSignal<Set<K>>;

  constructor(entries?: Iterable<[K, V]> | null) { /* ... */ }

  get(key: K): V | undefined {
    // Reads (or creates) the per-key signal, subscribing the caller
    let sig = this._map.get(key);
    if (!sig) {
      sig = signal(undefined);
      this._map.set(key, sig);
    }
    return sig();
  }

  set(key: K, value: V): this {
    const existing = this._map.get(key);
    if (existing) {
      existing.set(value);
    } else {
      this._map.set(key, signal(value));
      this._keys.update(keys => new Set([...keys, key]));
      this._size.update(s => s + 1);
    }
    return this;
  }

  has(key: K): boolean {
    return this._keys()?.has(key) ?? false;
  }

  delete(key: K): boolean {
    const sig = this._map.get(key);
    if (sig) {
      sig.set(undefined as any); // notify per-key listeners
      this._map.delete(key);
      this._keys.update(keys => { keys.delete(key); return new Set(keys); });
      this._size.update(s => s - 1);
      return true;
    }
    return false;
  }

  clear(): void {
    this._map.forEach(sig => sig.set(undefined as any));
    this._map.clear();
    this._keys.set(new Set());
    this._size.set(0);
  }

  get size(): number {
    return this._size();
  }

  // ... iteration methods
}
```

### 7.3 Proposed Annotated Type Definition

```ts
declare class SignalMap<K, V> implements Iterable<[K, V]> {
  constructor(entries?: Iterable<[K, V]> | null);

  /**
   * Get a value by key. Reactive per-key — only re-evaluates when
   * this specific key is modified via set() or delete().
   *
   * stable[key]: narrowing of this call is preserved as long as
   * no mutator targeting this same key is called.
   */
  stable[key] get(key: K): V | undefined;

  /**
   * Set a value for a key. Only invalidates narrowing for THIS key.
   *
   * mutator invalidates get[key]: only the narrowing of get(key)
   * for the matching key argument is reset.
   */
  mutator invalidates get[key] set(key: K, value: V): this;

  /**
   * Check if a key exists. Acts as a keyed linked predicate:
   * if has(key) returns true, then get(key) is narrowed to V (not undefined).
   */
  stable[key] has(key: K): this.get(key) is V;

  /**
   * Delete a key. Invalidates both the per-key narrowing AND structural reads.
   */
  mutator invalidates get[key] delete(key: K): boolean;

  /**
   * Clear all entries. Blanket mutator — invalidates ALL narrowings.
   */
  mutator clear(): void;

  /** Stable structural read. */
  stable get size(): number;

  stable keys(): IterableIterator<K>;
  stable values(): IterableIterator<V>;
  stable entries(): IterableIterator<[K, V]>;
  forEach(callbackfn: (value: V, key: K, map: SignalMap<K, V>) => void): void;

  [Symbol.iterator](): IterableIterator<[K, V]>;
}
```

### 7.4 CFA Behavior Walkthrough — Step by Step

```ts
const config = new SignalMap<string, string | number | boolean>();
config.set("port", 3000);
config.set("host", "localhost");
config.set("debug", true);

// --- Step 1: Initial narrowing via has() + get() ---

if (config.has("port")) {
  // ✓ Linked predicate: has("port") narrows get("port") to: string | number | boolean
  //   (removes undefined from V | undefined)
  const port = config.get("port");
  // port: string | number | boolean (not undefined!)

  if (typeof port === "number") {
    // port narrowed to: number ✓

    // --- Step 2: Unrelated key mutation ---
    config.set("host", "0.0.0.0");
    // mutator invalidates get["host"] — only "host" key's narrowing invalidated
    // "port" narrowing is PRESERVED ✓

    console.log(port.toFixed(0)); // ✓ OK — port is still number

    // --- Step 3: Same key mutation ---
    config.set("port", "8080");
    // mutator invalidates get["port"] — "port" narrowing INVALIDATED ✗

    // console.log(port.toFixed(0));
    // ✗ ERROR — port could be string now (was set to "8080")

    // --- Step 4: Re-narrow after mutation ---
    const port2 = config.get("port");
    if (typeof port2 === "number") {
      console.log(port2.toFixed(0)); // ✓ OK — re-narrowed
    }
  }
}

// --- Step 5: Blanket invalidation via clear() ---

if (config.has("debug")) {
  const debug = config.get("debug");
  // debug: string | number | boolean

  config.clear();
  // mutator (blanket) — invalidates ALL keys

  // config.get("debug") would return undefined now
  // debug's narrowing from has() is invalidated
}
```

### 7.5 Per-Key Invalidation ↔ Per-Key Reactivity Mapping

| Runtime Operation | Runtime Effect | Type-Level Effect |
|-------------------|---------------|-------------------|
| `map.set("a", v)` | Notifies `"a"` listeners only | Invalidates `get("a")` narrowing only |
| `map.delete("a")` | Notifies `"a"` + structure listeners | Invalidates `get("a")` + `has("a")` + `size` |
| `map.clear()` | Notifies ALL key listeners + structure | Invalidates ALL narrowings |
| `map.get("a")` after `set("b", v)` | Returns same value (no notification) | Narrowing preserved (`stable[key]`) |
| `map.has("a")` after `set("a", v)` | May return different value | Must re-evaluate (`has` invalidated) |

### 7.6 What if You `.clear()` After Narrowing?

```ts
if (config.has("port")) {
  const port = config.get("port"); // narrowed: V (not undefined)

  config.clear();
  // Blanket mutator — ALL CFA narrowings on this SignalMap instance reset.

  // ✗ Cannot assume port is still valid:
  // config.get("port") → undefined (key deleted)
  // The narrowing from has("port") is GONE.

  // Must re-check:
  if (config.has("port")) {
    const port2 = config.get("port"); // fresh narrowing
  }
}
```

This is correct behavior: `clear()` is a blanket mutator because it affects every key simultaneously. There's no way to model "clears everything except..." in the type system, nor should there be — the operation is semantically total.

---

## 8. DEEP DIVE: `signalSlice` — State Management with CFA

### 8.1 How Selectors Become `stable`

In `signalSlice`, selectors are computed signals derived from the state:

```ts
const slice = signalSlice({
  initialState: { count: 0, name: "Alice" as string | null },
  selectors: (state) => ({
    isPositive: computed(() => state().count > 0),
    upperName: computed(() => state().name?.toUpperCase() ?? ""),
  }),
});
```

Each selector (`slice.isPositive`, `slice.upperName`) is a `Signal<T>` — read-only, never mutated externally. They are `stable` by virtue of being computed.

```ts
// With annotations, this works:
if (slice.isPositive()) {
  // isPositive narrowed to: true (boolean literal)

  const upper = slice.upperName();
  // stable selector call — isPositive narrowing preserved ✓

  console.log("Positive count and name:", upper);
}
```

### 8.2 How ActionSources Become `mutator`

Action sources are the only mutation channel in `signalSlice`:

```ts
const slice = signalSlice({
  initialState: { count: 0, name: "Alice" as string | null },
  actionSources: {
    increment: (state, action$: Subject<void>) =>
      action$.pipe(map(() => ({ count: state().count + 1 }))),
    setName: (state, action$: Subject<string | null>) =>
      action$.pipe(map(name => ({ name }))),
  },
});
```

Each action method (`slice.increment()`, `slice.setName(v)`) is a `mutator`:

```ts
const state = slice();
if (state.name !== null) {
  // state.name narrowed to: string ✓

  slice.increment();
  // mutator — invalidates ALL narrowings on slice ✓
  // Even though increment() only touches 'count', not 'name',
  // we can't know this statically.

  // state.name narrowing is GONE
  // (conservative but correct — increment might have been implemented
  //  to also clear the name)
}
```

### 8.3 Narrowing Preservation Across Action Calls

The ideal scenario would be per-property invalidation:

```ts
// IDEAL (hypothetical — NOT currently expressible):
mutator invalidates state.count increment: () => void;
mutator invalidates state.name setName: (name: string | null) => void;

// Then:
if (state.name !== null) {
  slice.increment();
  // Only invalidates 'count' narrowing — name narrowing preserved! ✓
}
```

However, this requires knowing *which state properties* an action source modifies — information that's embedded in the observable pipeline, not the type signature. This falls into the same "callback body introspection" problem identified in [research-angular-computed-integration.md](research-angular-computed-integration.md) §3.2.

**Conclusion:** `signalSlice` actions should be blanket `mutator`s. Per-property invalidation would require explicit annotation by the developer, which is too burdensome for the typical `signalSlice` usage pattern.

### 8.4 Proposed `signalSlice` Return Type Annotation

```ts
// Conceptual — TypeScript can't express this generically today,
// but this is what the annotations WOULD look like on a concrete slice:

type TodoSlice = {
  // The state signal itself — stable
  stable (): TodoState;

  // Selectors — stable computed signals
  stable activeTodos: Signal<Todo[]>;
  stable completedCount: Signal<number>;
  stable isEmpty: Signal<boolean>;

  // Actions — mutators
  mutator addTodo: (text: string) => void;
  mutator removeTodo: (id: number) => void;
  mutator setFilter: (filter: "all" | "active" | "completed") => void;
  mutator toggleTodo: (id: number) => void;
};
```

---

## 9. What Exactly Would Need to Be Added to Type Definitions

### 9.1 Core Angular Types (prerequisite — covered in prior research)

These annotations on Angular's core types benefit ALL ngxtension utilities in Tier 3:

```ts
// packages/core — Signal<T>
interface Signal<T> {
  stable (): T;          // Reading a signal is stable
}

// packages/core — WritableSignal<T>
interface WritableSignal<T> extends Signal<T> {
  mutator set(value: T): void;
  mutator update(updateFn: (value: T) => T): void;
  stable asReadonly(): Signal<T>;
}
```

### 9.2 ngxtension `SignalMap<K, V>`

```ts
// ngxtension/signal-map
declare class SignalMap<K, V> {
  stable[key] get(key: K): V | undefined;
  mutator invalidates get[key] set(key: K, value: V): this;
  stable[key] has(key: K): this.get(key) is V;
  mutator invalidates get[key] delete(key: K): boolean;
  mutator clear(): void;
  stable get size(): number;
  stable keys(): IterableIterator<K>;
  stable values(): IterableIterator<V>;
  stable entries(): IterableIterator<[K, V]>;
}
```

### 9.3 ngxtension `SignalSet<T>`

```ts
// ngxtension/signal-set
declare class SignalSet<T> {
  stable has(value: T): boolean;
  mutator add(value: T): this;
  mutator delete(value: T): boolean;
  mutator clear(): void;
  stable get size(): number;
}
```

### 9.4 ngxtension `createNotifier`

```ts
// ngxtension/create-notifier
declare function createNotifier(): {
  stable listen: Signal<number>;
  mutator invalidates listen notify: () => void;
};
```

### 9.5 ngxtension `signalHistory`

```ts
// ngxtension/signal-history
declare function signalHistory<T>(source: WritableSignal<T>, options?: {
  bufferSize?: number;
}): {
  stable history: Signal<T[]>;
  mutator undo: () => void;
  mutator redo: () => void;
  mutator reset: () => void;
  mutator clear: () => void;
  stable canUndo: Signal<boolean>;
  stable canRedo: Signal<boolean>;
};
```

### 9.6 Import Strategy: Augment vs. Fork

| Strategy | Pros | Cons |
|----------|------|------|
| **Module augmentation** | No fork, immediate adoption | Requires TS support for augmenting with modifiers |
| **Fork `.d.ts`** | Full control, can ship independently | Maintenance burden, version coupling |
| **`@types/ngxtension`** | Community-maintained, standard pattern | Requires DefinitelyTyped acceptance of new modifiers |
| **Upstream PR to ngxtension** | Best long-term solution | Requires ngxtension to adopt pre-release TS feature |

**Recommendation:** Start with module augmentation during development/prototyping. Once the `stable`/`mutator` system ships in TypeScript, submit upstream PRs to ngxtension to add annotations directly to source types.

---

## 10. Comparison with Prior Research

### vs. [research-angular-computed-integration.md](research-angular-computed-integration.md)

| Aspect | Core Angular Research | This Document (ngxtension) |
|--------|----------------------|---------------------------|
| **Focus** | `Signal<T>`, `WritableSignal<T>`, `computed()` | Higher-level abstractions built on signals |
| **Key finding** | Transitive invalidation unsolvable | Per-key invalidation IS solvable (SignalMap) |
| **Recommended approach** | Conservative invalidation for computed deps | Fine-grained invalidation for container types |
| **Main beneficiary** | All Angular apps | Apps using ngxtension's reactive containers |
| **Novelty** | First angular-specific research | First per-key reactive container analysis |

### vs. [research-map-has-get-narrowing.md](../research-map-has-get-narrowing.md)

The standard `Map<K, V>` research applies directly to `SignalMap<K, V>`. The difference:

- Standard `Map.set(k, v)` is a normal mutation — no reactive notification.
- `SignalMap.set(k, v)` is a reactive mutation — triggers per-key signal updates.
- At the type level, both get the same `stable[key]` + `invalidates get[key]` annotations.
- `SignalMap`'s implementation **already enforces** the invariant that `set(k)` only affects key `k` — the type system annotation just mirrors this runtime guarantee.

### vs. [research-solidjs-cross-binding.md](../research-solidjs-cross-binding.md)

SolidJS's `createSignal` returns a `[getter, setter]` tuple — the cross-binding analysis focuses on named tuple label invalidation. ngxtension's `createSignal` uses a `.value` property instead, which is simpler (getter/setter on the same object, no cross-binding needed).

---

## 11. Recommendations

### 11.1 Priority Order for Implementation

1. **Core Angular `Signal<T>` / `WritableSignal<T>`** — prerequisite for everything. (See [research-angular-computed-integration.md](research-angular-computed-integration.md))
2. **`SignalMap<K, V>`** — showcase for `stable[key]`, highest unique value.
3. **`SignalSet<T>`** — natural companion to `SignalMap`, lower unique value.
4. **`signalSlice`** — demonstrates state management CFA, medium complexity.
5. **`signalHistory`, `createNotifier`, `createSignal`** — straightforward, low complexity.
6. **Tier 3/4 utilities** — automatically covered by core types, no work needed.

### 11.2 Demo/Showcase Value

For presenting the `stable`/`mutator` system to the TypeScript community:

| Scenario | Showcase Value | Why |
|----------|---------------|-----|
| `SignalMap` per-key narrowing | ★★★★★ | Novel, concrete, immediately useful |
| `signalSlice` state management | ★★★★☆ | Familiar Redux pattern, wide appeal |
| `signalHistory` undo/redo | ★★★☆☆ | Easy to understand, limited scope |
| `createNotifier` | ★★☆☆☆ | Too simple to be impressive |

### 11.3 Testing Strategy

Each annotated utility should have at least:

1. **Positive test** — narrowing preserved through stable calls.
2. **Negative test** — narrowing correctly invalidated by mutator calls.
3. **Per-key test** (for `SignalMap`, `SignalSet`) — key-specific invalidation.
4. **Blanket test** — `clear()` invalidates all narrowings.
5. **Re-narrow test** — narrowing recoverable after invalidation + re-check.

---

## 12. Open Questions

### OQ-1: Should `SignalMap.delete()` invalidate `size` narrowing?

`delete()` changes the structural state (key count), so `size` narrowing should be invalidated. But `delete()` is currently modeled as `mutator invalidates get[key]` — should it also say `invalidates size`? This requires `invalidates` to target both keyed and non-keyed members.

**Tentative answer:** Yes. `delete()` should be `mutator invalidates get[key], size`. Or: blanket mutator is acceptable since `delete` affects structure.

### OQ-2: Can `SignalMap.set()` guarantee `has(key)` is true after?

After `map.set("alice", v)`, we know `map.has("alice")` is `true`. This is post-call narrowing (already implemented for basic cases). Does it extend to keyed linked predicates?

**Desired behavior:**
```ts
map.set("alice", { name: "Alice" });
// After set("alice", v), has("alice") should be narrowable to true
// AND get("alice") should be narrowable to V (not V | undefined)
const alice = map.get("alice"); // → { name: string }, not { name: string } | undefined
```

### OQ-3: How does `signalSlice` action typing work generically?

`signalSlice` uses highly generic types with mapped types and conditional types. Can `stable`/`mutator` survive through complex generic type inference? This needs compiler testing.

### OQ-4: Should `forEach` be marked `stable` or not?

`forEach` reads all entries (stable from the map's perspective) but invokes a callback that could have side effects. The callback could even mutate the same map. Conservative answer: NOT `stable` (callback is an uncertainty boundary).

### OQ-5: Does `SignalMap` need a `stable[K]` constraint on `K`?

For per-key narrowing to work, the key must be a literal type (or at least narrowable). If `K` is just `string`, then `get(someVar)` and `get(otherVar)` can't be distinguished. Should there be a constraint like `K extends string | number | symbol`?

**Tentative answer:** The constraint is already implicit — keyed narrowing only works when the key argument is a narrowable literal. This is a CFA property, not a type constraint on `K`.

### OQ-6: What about `WeakSignalMap`/`SignalWeakMap` if ngxtension adds it?

Would follow the same pattern as `SignalMap`. `WeakMap`-style APIs have the same `get`/`set`/`has`/`delete` surface.

---

## Appendix A: ngxtension Package Structure

```
ngxtension/
├── signal-map/        → SignalMap<K,V>           (Tier 1)
├── signal-set/        → SignalSet<T>             (Tier 1)
├── signal-slice/      → signalSlice()            (Tier 1)
├── create-notifier/   → createNotifier()         (Tier 2)
├── signal-history/    → signalHistory()          (Tier 2)
├── create-signal/     → createSignal/Computed()  (Tier 2)
├── computed-previous/ → computedPrevious()       (Tier 3)
├── derived-async/     → derivedAsync()           (Tier 3)
├── derived-from/      → derivedFrom()            (Tier 3)
├── connect/           → connect()                (Tier 3)
├── to-lazy-signal/    → toLazySignal()           (Tier 3)
├── create-effect/     → createEffect()           (Tier 4)
└── explicit-effect/   → explicitEffect()         (Tier 4)
```

## Appendix B: Full Annotated `.d.ts` — `SignalMap` (Copy-Paste Ready)

```ts
/**
 * Reactive Map with per-key granular reactivity.
 *
 * CFA annotations:
 * - get(key): stable[key] — narrowing preserved per-key across calls
 * - set(key, value): mutator invalidates get[key] — per-key invalidation
 * - has(key): stable[key] linked predicate — narrows get(key) to V
 * - delete(key): mutator invalidates get[key] — per-key + structural
 * - clear(): mutator — blanket invalidation
 * - size: stable — structural read
 */
declare class SignalMap<K, V> implements Iterable<[K, V]> {
  constructor(entries?: Iterable<[K, V]> | null);

  stable[key] get(key: K): V | undefined;
  mutator invalidates get[key] set(key: K, value: V): this;
  stable[key] has(key: K): this.get(key) is V;
  mutator invalidates get[key] delete(key: K): boolean;
  mutator clear(): void;

  stable get size(): number;
  stable keys(): IterableIterator<K>;
  stable values(): IterableIterator<V>;
  stable entries(): IterableIterator<[K, V]>;
  forEach(callbackfn: (value: V, key: K, map: SignalMap<K, V>) => void): void;

  [Symbol.iterator](): IterableIterator<[K, V]>;
}

export { SignalMap };
```
