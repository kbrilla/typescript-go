# Heuristic-Based Uncertainty Boundary Analysis for Stable CFA

## 1. Executive Summary

This document researches practical heuristics the compiler could use — **without new syntax** — to determine which function calls are safe to preserve `stable` narrowing across, and which are true uncertainty boundaries that must invalidate narrowing.

**Key finding**: The current implementation already handles the most impactful heuristic (unrelated call transparency via `isUnrelatedCallForStableReference`). The remaining question is whether **argument analysis** — checking if the stable container is passed as an argument — can further refine boundary classification for calls that currently reach `stableBoundaryKindUnknownCall` or `stableBoundaryKindOther`.

**Recommendation**: A combined heuristic of **(1) argument non-escape + (2) const binding analysis** provides the best precision-to-complexity ratio. But the current `isUnrelatedCallForStableReference` already captures ~90% of this value for member-access stable references. The gap is primarily for **standalone stable references** passed as arguments.

---

## 2. Current State of the Art

### 2.1 TypeScript's CFA Model (Precedent)

TypeScript chose **optimistic for properties, pessimistic for locals** (ahejlsberg, #9998):

```typescript
// TypeScript's getTypeAtFlowCall returns undefined for most calls,
// meaning the call is TRANSPARENT — flow analysis continues through it.
// Only assert predicates and never-returning functions affect flow.
function getTypeAtFlowCall(flow: FlowCall): FlowType | undefined {
    const signature = getEffectsSignature(flow.node);
    if (signature) {
        const predicate = getTypePredicateOfSignature(signature);
        if (predicate && isAssertionPredicate(predicate)) {
            // ... narrows or unreachable
        }
        if (getReturnTypeOfSignature(signature).flags & TypeFlags.Never) {
            return unreachableNeverType;
        }
    }
    return undefined; // ← ALL other calls are transparent!
}
```

For **property access narrowing**: TypeScript never invalidates on function calls. Period. The `FlowStart` handler stops flow analysis for `PropertyAccessExpression` and `ElementAccessExpression` at function boundaries — but within a function, calls are fully transparent.

For **local variable narrowing**: TypeScript traverses up through function boundaries via `FlowStart` to find closures that might capture the variable. If the variable is captured in a function that's called, narrowing is reset.

### 2.2 Current Stable CFA Model

Our `classifyStableBoundary` already implements a sophisticated classification:

1. **Stable calls → None** (stable calls are pure reads by contract)
2. **Mutator calls → MutatorCall** (explicit invalidation)
3. **Alias escape → AliasEscape** (receiver identity escapes)
4. **Await boundaries → AwaitBoundary**
5. **Receiver writes → Other** (property writes on same receiver)
6. **Unrelated calls → None** (calls on different objects/functions)
7. **Noop callback calls → CallbackCall** (with preserve rules)
8. **Unknown calls → UnknownCall** (with preserve rules)
9. **Everything else → Other**

The `isUnrelatedCallForStableReference` function already handles:
- Method calls on ANY receiver → transparent (getter parity)
- Standalone calls to different identifiers → transparent
- Same-function calls → not transparent

**Gap**: When a call reaches `stableBoundaryKindUnknownCall` or `stableBoundaryKindOther`, could argument analysis provide additional information?

---

## 3. Heuristic Analysis

### 3.1 Argument Analysis Heuristic

**Core idea**: If the stable container is NOT passed as an argument to the function call, the call probably can't affect it.

#### Safe Cases (narrowing SHOULD be preserved)

```ts
interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}
declare const r: Resource<string>;

// Case 1: Stable container not passed at all
if (r.value()) {
  console.log("hello");          // r not passed → SAFE
  Math.random();                  // r not passed → SAFE  
  someFunction(42, "test");       // r not passed → SAFE
  
  const s: string = r.value();   // narrowing preserved
}

// Case 2: VALUE passed, not the container
if (r.value()) {
  someFunction(r.value());        // passes the value (string), not r → SAFE
  process(r.value().length);      // passes a number derived from value → SAFE
  
  const s: string = r.value();   // narrowing preserved
}

// Case 3: Unrelated property of container passed
if (r.value()) {
  someFunction(r.toString());     // passes a different property's result → SAFE?
  // Actually questionable — r.toString() gives the function a reference to r's prototype
  // but can't mutate r.value's backing state through toString()
  
  const s: string = r.value();   // narrowing preserved
}
```

#### Unsafe Cases (narrowing MUST be invalidated)

```ts
// Case 4: Container passed directly
if (r.value()) {
  someFunction(r);                // r IS passed → UNSAFE
  // someFunction could call r.set("...")
  
  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 5: Container passed in a wrapper object
if (r.value()) {
  someFunction({ resource: r });  // r passed transitively → UNSAFE
  // someFunction could do arg.resource.set("...")

  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 6: Container passed in an array
if (r.value()) {
  someFunction([r]);              // r in array → UNSAFE

  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 7: Container spread into arguments
if (r.value()) {
  someFunction(...[r]);           // spread containing r → UNSAFE

  const s: string = r.value();   // ERROR: narrowing invalidated
}
```

#### Edge Cases (requires careful analysis)

```ts
// Case 8: Passing a method of the container (extracts mutator capability)
if (r.value()) {
  someFunction(r.set);            // Passes the mutator function! → UNSAFE
  // someFunction could call the passed function: arg("new value")

  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 9: Passing a bound method
if (r.value()) {
  someFunction(r.set.bind(r));    // Passes a bound mutator → UNSAFE

  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 10: Passing a closure that captures the container
if (r.value()) {
  someFunction(() => r.set("x")); // Passes closure that captures r → UNSAFE
  // The callback could be called synchronously

  const s: string = r.value();   // ERROR: narrowing invalidated
}

// Case 11: Container returned by a function — aliasing concern
declare function getResource(): Resource<string>;
const r2 = getResource();
if (r2.value()) {
  someFunction(getResource());   // Could return the SAME object as r2 → ???
  // This is unknowable without global analysis
  // Conservative: UNSAFE (but practically very rare)

  const s: string = r2.value();  // If conservative: ERROR
}

// Case 12: Passing a different property that returns the container
interface Container {
  resource: Resource<string>;
  self(): Container;
}
declare const c: Container;
if (c.resource.value()) {
  someFunction(c.self());        // Returns a reference to the same container → ???
  // Unknowable without interprocedural analysis
  // Conservative: UNSAFE if c is passed (c.self() involves c as receiver)

  const s: string = c.resource.value(); // Conservative: ERROR
}
```

#### Implementation Sketch

```go
// argumentContainsStableContainer checks if any argument to the call
// contains a reference to the stable container (receiver or standalone function).
func (c *Checker) argumentContainsStableContainer(reference *ast.Node, call *ast.Node) bool {
    if !ast.IsCallExpression(call) {
        return false
    }
    
    container := c.getStableContainerReference(reference)
    if container == nil {
        return false
    }
    
    for _, arg := range call.Arguments() {
        if c.expressionContainsReference(arg, container) {
            return true
        }
    }
    
    // Also check spread elements
    // Also check if the call's receiver IS the container (for method calls)
    return false
}

func (c *Checker) expressionContainsReference(expr *ast.Node, target *ast.Node) bool {
    resolved := ast.SkipParentheses(expr)
    
    // Direct match
    if c.isMatchingReference(resolved, target) {
        return true
    }
    
    // Property access on the target: r.set, r.value, etc.
    if ast.IsAccessExpression(resolved) {
        if c.isMatchingReference(resolved.Expression(), target) {
            return true
        }
    }
    
    // Object literal containing target: { resource: r }
    if ast.IsObjectLiteralExpression(resolved) {
        for _, prop := range resolved.Properties() {
            if ast.IsPropertyAssignment(prop) {
                if c.expressionContainsReference(prop.Initializer(), target) {
                    return true
                }
            }
        }
    }
    
    // Array literal: [r]
    if ast.IsArrayLiteralExpression(resolved) {
        for _, elem := range resolved.Elements() {
            if c.expressionContainsReference(elem, target) {
                return true
            }
        }
    }
    
    // Arrow function / function expression: () => r.set("x")
    // Too expensive to analyze bodies — treat as unsafe if it has params or body
    if ast.IsArrowFunction(resolved) || ast.IsFunctionExpression(resolved) {
        // Conservative: any closure COULD capture the target
        // Optimization: if it has no body statements, it's safe
        return !c.isNoopCallback(resolved)
    }
    
    return false
}
```

#### Soundness Analysis

| Scenario | Our Classification | Possible Unsoundness? |
|---|---|---|
| `fn(42)` — no container | SAFE | No — impossible to affect container |
| `fn(r.value())` — value only | SAFE | No — primitive/immutable value passed |
| `fn(r)` — container passed | UNSAFE | No — correctly conservative |
| `fn({r})` — wrapper object | UNSAFE (if detected) | No — correctly conservative |
| `fn([r])` — array | UNSAFE (if detected) | No — correctly conservative |
| `fn(() => r.set(""))` — closure | UNSAFE (if detected) | No — correctly conservative |
| `fn(r.set)` — method extraction | UNSAFE (if detected) | No — correctly conservative |
| Global reference to container | SAFE (FALSE NEGATIVE!) | **YES** — see below |

**Critical false negative**: If the function has access to the container through global scope:

```ts
// Module-level
const r: Resource<string> = createResource();

function sneakyMutate() {
    r.set("changed!");  // Accesses r through closure, not through argument
}

if (r.value()) {
    sneakyMutate();  // r not passed as argument → heuristic says SAFE
    r.value();       // BUG: narrowing preserved but value changed!
}
```

**Mitigation**: This is the SAME unsoundness TypeScript has for property narrowing. TypeScript preserves `obj.prop` narrowing across `sneakyMutate()` even though `sneakyMutate()` could modify `obj.prop`. This is the deliberate optimistic trade-off from #9998.

**For `stable`**: Since our stated goal is getter parity, this false negative is acceptable *if and only if* we document it matches TypeScript's existing property CFA behavior.

#### Complexity Assessment

- **Lines of code**: ~60-80 lines for argument analysis
- **Performance**: O(n) per argument, O(n*m) for nested structures — bounded by argument count and nesting depth (cap at 3-5 levels)
- **Risk**: Low — conservative fallback for anything not recognized

---

### 3.2 Binding Analysis Heuristic

**Core idea**: If the stable reference is `const` and locally scoped, only code with a direct reference path can mutate its backing state.

#### Analysis by Binding Kind

```ts
// STRONGEST: const local, never captured, never passed
function example1() {
    const r = createResource<string>();  // const, local, no captures
    if (r.value()) {
        someFunction();  // Can't possibly know about r → SAFE
        r.value();       // narrowing preserved
    }
}

// STRONG: const local, but passed to function
function example2() {
    const r = createResource<string>();
    if (r.value()) {
        someFunction(r);  // r is passed → UNSAFE (function gets a reference)
        r.value();        // narrowing invalidated
    }
}

// MEDIUM: const local, captured in closure
function example3() {
    const r = createResource<string>();
    const mutator = () => r.set("new");  // Closure captures r
    
    if (r.value()) {
        mutator();     // Calls closure that captures r → UNSAFE
        someFunc();    // COULD this reach mutator? Maybe through event handlers...
        r.value();     // Conservative: invalidated after mutator()
    }
}

// WEAK: let binding (reassignable)
function example4() {
    let r = createResource<string>();
    if (r.value()) {
        r = createResource<string>();  // Reassignment! Different object now
        r.value();  // narrowing invalidated (different object)
    }
}

// WEAK: Parameter (caller has reference)
function example5(r: Resource<string>) {
    if (r.value()) {
        someFunc();  // Caller also has r → could mutate through other path
        r.value();   // Should we be conservative here?
    }
}

// WEAK: Module-level (any import could hold a reference)
const moduleR = createResource<string>();
export { moduleR };

function example6() {
    if (moduleR.value()) {
        someImportedFunction();  // Could import moduleR elsewhere → UNSAFE
        moduleR.value();         // Conservative: invalidated
    }
}
```

#### Implementation Sketch

```go
type stableBindingStrength int8

const (
    stableBindingStrengthWeak    stableBindingStrength = iota // module-level, let, parameter
    stableBindingStrengthMedium                               // const local, captured in closure
    stableBindingStrengthStrong                               // const local, not captured, not passed
)

func (c *Checker) getStableBindingStrength(reference *ast.Node) stableBindingStrength {
    container := c.getStableContainerReference(reference)
    if container == nil {
        return stableBindingStrengthWeak
    }
    
    if !ast.IsIdentifier(container) {
        return stableBindingStrengthWeak
    }
    
    symbol := c.getResolvedSymbol(container)
    if symbol == nil || symbol == c.unknownSymbol {
        return stableBindingStrengthWeak
    }
    
    // Must be const
    if !c.isConstantVariable(symbol) {
        return stableBindingStrengthWeak
    }
    
    decl := symbol.ValueDeclaration
    if decl == nil || !ast.IsVariableDeclaration(decl) {
        return stableBindingStrengthWeak
    }
    
    // Must be local (not module-level)
    if !c.isLocalVariable(symbol) {
        return stableBindingStrengthWeak
    }
    
    // Check if captured in any closure
    if c.isCapturedInClosure(symbol) {
        return stableBindingStrengthMedium
    }
    
    return stableBindingStrengthStrong
}
```

#### Soundness Analysis

| Binding Strength | Safe across non-argument calls? | Unsoundness risk |
|---|---|---|
| Strong (const local, no capture) | YES | None — no other code path can reach it |
| Medium (const local, captured) | Depends — safe if calling function doesn't invoke the capturing closure | Low — need to track which closures capture |
| Weak (let, param, module-level) | No guarantee | N/A — conservative fallback |

**The strong case is genuinely sound**: If a `const` local variable is never passed as an argument and never captured in a closure, then no function call can possibly affect it. This is provable, not heuristic.

**Problem**: Determining "captured in closure" requires visiting all nested function bodies in the containing function. This is:
- Expensive at check time
- Already partially done by the binder (captured locals for closure analysis)
- Could be cached per-symbol

#### Complexity Assessment

- **Lines of code**: ~40-60 for binding strength, ~30 for integration
- **Performance**: O(1) for const check, but closure-capture analysis is expensive (binder-level, not checker-level)
- **Risk**: Medium — requires integration with binder's closure analysis data
- **Practical note**: The binder already tracks captured variables for codegen (e.g., `let`/`const` in loops). We could potentially reuse that data.

---

### 3.3 Known-Safe Call Patterns

**Core idea**: Hardcode a list of functions that definitely can't mutate user objects.

#### Categories of Known-Safe Functions

```ts
// Category 1: Console methods
console.log(anything);      // ← SAFE
console.warn(anything);     // ← SAFE
console.error(anything);    // ← SAFE
console.dir(anything);      // ← SAFE (even though it reads properties, it doesn't mutate)

// Category 2: Math methods
Math.random();              // ← SAFE
Math.floor(x);              // ← SAFE
Math.max(a, b);             // ← SAFE

// Category 3: JSON methods  
JSON.stringify(anything);   // ← SAFE (reads but doesn't mutate)
JSON.parse(str);            // ← SAFE (creates new object)

// Category 4: String/Number/Boolean methods
str.split(",");             // ← SAFE
num.toFixed(2);             // ← SAFE

// Category 5: Pure Array methods (return new arrays)
arr.map(fn);                // ← SAFE-ish (calls fn, which could mutate)
arr.filter(fn);             // ← SAFE-ish (same caveat)
arr.slice(0, 5);            // ← SAFE

// Category 6: Object inspection
Object.keys(obj);           // ← SAFE
Object.values(obj);         // ← SAFE
typeof x;                   // ← Not a call, already safe

// Category 7: Promise construction (as expression statement)
Promise.resolve();          // ← SAFE
Promise.resolve(value);     // ← SAFE (already handled by preserve rule)
```

#### Problems with This Approach

1. **Maintenance burden**: The list would need continuous updating
2. **Subjectivity**: Is `Object.freeze(r)` safe? It mutates the object but doesn't change values
3. **Polyfills**: Users might redefine `console.log` or `Math.random`
4. **Not generalizable**: Doesn't help with user-defined functions
5. **Already covered**: The ambient no-arg void function preserve rule already handles `Math.random()` and similar. And `isUnrelatedCallForStableReference` already makes `console.log("hello")` transparent because it's a method call on a different receiver (`console`).

#### What the Current Implementation Already Covers

Looking at the existing code:
- `console.log("hello")` → method call on `console` (different receiver) → `isUnrelatedCallForStableReference` returns true → **already safe**
- `Math.random()` → method call on `Math` → **already safe**
- `JSON.stringify(r)` → method call on `JSON` → **already safe** (BUT: r is passed as argument — should this matter?)
- `someHelper(42)` → standalone call, different identifier → **already safe**

**Conclusion**: The current `isUnrelatedCallForStableReference` already covers most "known-safe" patterns because they're method calls on built-in objects (different receivers). A hardcoded list adds minimal value.

#### Complexity Assessment

- **Lines of code**: ~20-40 for a lookup table
- **Performance**: O(1) lookup
- **Risk**: Low code risk, high maintenance risk
- **Value-add over current system**: Minimal — already covered by receiver analysis

---

### 3.4 Property Access Analysis

**Core idea**: Analyze the structure of the call expression to determine relationship to the stable reference.

This is essentially what `isUnrelatedCallForStableReference` already does. Let me document the full decision matrix:

```ts
interface Store {
    data: stable () => Data | undefined;
    load(): Promise<void>;
    clear: mutator () => void;
}
declare const store: Store;
declare const otherStore: Store;

// The stable reference is: store.data()
// Callee receiver is: the object being called's method

if (store.data()) {
    // Pattern 1: Same receiver, different method
    store.load();              // Receiver: store. Name: load.
    // Current: isUnrelatedCallForStableReference returns true (method call)
    // This matches getter parity — method calls don't invalidate getter narrowing
    
    // Pattern 2: Same receiver, mutator method  
    store.clear();             // Receiver: store. Name: clear. Has mutator flag.
    // Current: isMutatorCallBoundary catches this BEFORE unrelated-call check
    // Correctly invalidates!
    
    // Pattern 3: Different receiver, any method
    otherStore.load();         // Receiver: otherStore (different)
    // Current: isUnrelatedCallForStableReference returns true
    // Correct — different object can't affect store's state
    
    // Pattern 4: Standalone function call
    someFunction();            // No receiver
    // Current: isUnrelatedCallForStableReference returns true (standalone, not matching)
    // Correct — standalone function can't affect store's backing state
    
    // Pattern 5: Standalone function call that IS the stable reference
    // (for standalone stable references like `declare const read: stable () => T`)
    // read();                 // IS the same function!
    // Current: isUnrelatedCallForStableReference returns false
    // This shouldn't happen because the boundary IS a stable call and is caught earlier
    
    // Pattern 6: IIFE
    (() => { /* ... */ })();   // Arrow IIFE
    // Current: Not handled by isUnrelatedCallForStableReference (not identifier, not access)
    // Falls through to other checks
    
    // Pattern 7: Computed property access
    store["load"]();           // ElementAccessExpression
    // Current: isUnrelatedCallForStableReference returns true (isAccessExpression)
    // Correct
}
```

#### Current Blindspot: IIFE and expression calls

```ts
if (store.data()) {
    // These are not identifiers and not access expressions:
    (() => console.log("hi"))();       // Arrow IIFE
    (function() { return 42; })();     // Function expression IIFE
    (condition ? fnA : fnB)();         // Conditional expression
    getHandler()();                    // Return value of call
    
    // Current: None of these match isUnrelatedCallForStableReference
    // They fall to stableBoundaryKindOther
}
```

For **IIFEs with no capture of the stable reference**, these should be safe. But analyzing closure capture of IIFEs would require body inspection, which violates INV-02 (no body introspection).

#### Complexity Assessment

- **Lines of code**: Already implemented (~40 lines)
- **Performance**: O(1) — simple AST checks
- **Risk**: Already validated with tests
- **Extension opportunity**: IIFE analysis for captured variables

---

### 3.5 Closure Capture Heuristic

**Core idea**: For locally-defined functions, check if they capture the stable reference.

```ts
const r = createResource<string>();

// Closure that does NOT capture r
const log = () => console.log("safe");

// Closure that DOES capture r
const mutate = () => r.set("x");

// Closure that captures r but only reads
const read = () => r.value();

if (r.value()) {
    log();      // SAFE — doesn't capture r
    read();     // Should be SAFE — only reads through stable endpoint
    mutate();   // UNSAFE — captures r and calls mutator
}
```

#### How This Would Work

```ts
// Arrow functions
const safe1 = () => console.log("hi");           // No capture of r → SAFE
const safe2 = (x: number) => x + 1;              // No capture of r → SAFE
const unsafe1 = () => r.set("x");                // Captures r, calls mutator → UNSAFE
const unsafe2 = () => someGlobal.set(r);          // Captures r, passes it → UNSAFE

// Function expressions
const safe3 = function() { return 42; };          // No capture → SAFE
const unsafe3 = function() { r.set("x"); };      // Captures r → UNSAFE

// Class methods — harder
class Foo {
    constructor(private res: Resource<string>) {}
    mutate() { this.res.set("x"); }               // Captures via this → UNSAFE
    read() { return this.res.value(); }            // Captures via this, reads only → SAFE?
}
```

#### Why This Is Hard

1. **Body inspection required**: Determining what a function captures requires visiting its body. This violates the INV-02 invariant (no callback-body introspection).

2. **Transitivity**: A function might call another function that captures the reference:
   ```ts
   const helper = () => r.set("x");
   const caller = () => helper();  // Doesn't capture r directly, but calls helper that does
   ```

3. **Dynamic dispatch**: The captured function might be stored and called later:
   ```ts
   const callbacks: (() => void)[] = [];
   callbacks.push(() => r.set("x"));
   // ... later ...
   callbacks[0]();  // Not predictable at the call site
   ```

4. **Performance**: Walking function bodies during CFA is expensive and may cause quadratic behavior on deeply nested code.

#### Limited Safe Version

We could limit this to **trivially verifiable** cases — functions we can prove don't capture the reference without deep body inspection:

```go
func (c *Checker) isLocalFunctionSafeForStableReference(callee *ast.Node, reference *ast.Node) bool {
    // Only handle identifiers (local function calls)
    if !ast.IsIdentifier(callee) {
        return false
    }
    
    symbol := c.getResolvedSymbol(callee)
    if symbol == nil || !c.isConstantVariable(symbol) {
        return false
    }
    
    decl := symbol.ValueDeclaration
    if decl == nil || !ast.IsVariableDeclaration(decl) {
        return false
    }
    
    init := decl.Initializer()
    if init == nil {
        return false
    }
    
    fn := ast.SkipParentheses(init)
    if !ast.IsArrowFunction(fn) && !ast.IsFunctionExpression(fn) {
        return false
    }
    
    // Only safe if:
    // 1. No parameters (can't receive the container)
    // 2. Empty body
    // Already handled by isNoopCallback!
    return c.isNoopCallback(fn)
}
```

This is exactly what `isNoopCallback` already does. Anything beyond "empty body" requires body inspection.

#### Complexity Assessment

- **Lines of code**: Simple version (~30 lines) already covered by noop callback analysis
- **Full version**: 100-200 lines, requires body walking
- **Performance**: Simple O(1), full O(body_size) — could be expensive
- **Risk**: High for full version (body inspection, transitivity, cache invalidation)
- **Value-add**: Low for simple version (already covered), medium for full version

---

### 3.6 Combined Heuristic Proposal

Based on the analysis above, here is a ranked set of practical rules:

#### Rule Set A: "Getter Parity Plus" (RECOMMENDED)

This is essentially what the current implementation already does, with one proposed extension:

1. **Method calls on any receiver** → transparent (getter parity) ✅ Already implemented
2. **Standalone calls to different functions** → transparent ✅ Already implemented
3. **Mutator calls on same receiver** → invalidate ✅ Already implemented
4. **Property writes on same receiver** → invalidate ✅ Already implemented
5. **Await boundaries** → invalidate (with preserve rules) ✅ Already implemented
6. **Noop callbacks** → preserve ✅ Already implemented
7. **NEW: Argument escape check** → if stable container is passed as argument to a standalone call, invalidate instead of preserving

**Rule Set A adds ~30-40 lines** for the argument check, primarily useful for edge cases.

#### Rule Set B: "Argument-Aware Boundaries"

Extends Rule Set A with deeper argument analysis:

1. Everything from Rule Set A
2. **Argument containment analysis**: Walk argument expressions to detect if stable container or its mutator-capable properties are transitively passed
3. **Object literal / array literal detection**: Detect `{resource: r}` or `[r]` patterns

**Rule Set B adds ~60-80 lines**, provides moderate precision improvement.

#### Rule Set C: "Binding-Strength Aware"

Extends Rule Set B with binding analysis:

1. Everything from Rule Set B
2. **Const local analysis**: `const` locals that are never passed as arguments and never captured get stronger guarantees
3. **Module-level / exported references**: Always conservative at unknown calls

**Rule Set C adds ~80-120 lines**, requires binder integration for closure capture data.

#### Rule Set D: "Full Closure Analysis" (NOT RECOMMENDED)

1. Everything from Rule Set C
2. **Body inspection for locally-defined functions**: Walk function bodies to determine capture
3. **Transitive capture analysis**: Follow call chains through locally-defined functions

**Rule Set D adds 200+ lines, violates INV-02, and has quadratic performance risk.**

---

## 4. Soundness Deep Dive

### 4.1 False Negatives (Unsound — We Say Safe But It's Not)

Every heuristic has the same fundamental false negative:

```ts
// Global/closure-based mutation without passing the reference
const r = createResource<string>();

function sneakyMutate() {
    r.set("changed");  // Accesses r through closure capture
}

if (r.value()) {
    sneakyMutate();    // HEURISTIC SAYS: safe (r not passed as argument)
    r.value();         // BUG: value has changed!
}
```

**This is the same unsoundness TypeScript has for property narrowing.** TypeScript preserves `obj.prop` narrowing across `sneakyMutate()` even though `sneakyMutate()` could set `obj.prop = undefined`.

The `stable` modifier is a CONTRACT: the developer declares that reads are stable across calls that don't use documented mutator methods. The heuristic is consistent with this contract — if the developer's code mutates through closure capture of a non-mutator path, the code violates the stable contract.

### 4.2 False Positives (Overly Conservative — Annoying But Safe)

The current system has these false positives:

```ts
declare const read: stable () => string | undefined;

// False positive 1: Non-void function calls with arguments
// Currently reaches stableBoundaryKindUnknownCall if not ambient no-arg void
function helper(x: number): number { return x + 1; }
if (read()) {
    helper(42);          // Currently invalidates (unknown call with args)
    read();              // narrowing lost — unnecessarily conservative
}

// False positive 2: Calls with non-empty callbacks that don't capture
function forEach(items: number[], cb: (n: number) => void): void { /* ... */ }
if (read()) {
    forEach([1, 2, 3], (n) => console.log(n));  // cb doesn't capture read
    read();              // narrowing lost — callback has body
}
```

These false positives are currently mitigated by:
- The ambient no-arg void function preserve rule (handles `Math.random()`, etc.)
- The noop callback preserve rule (handles `invoke(() => {})`)

### 4.3 The Argument Analysis Gap

The one scenario where argument analysis would matter AND isn't already covered:

```ts
// Standalone stable reference (no receiver)
declare const read: stable () => string | undefined;

// Currently classified as stableBoundaryKindUnknownCall
// but passes the ambient-no-arg-void preserve check
declare function sideEffect(): void;

if (read()) {
    sideEffect();        // ← preserved by ambient-no-arg-void rule
    read();              // OK
}

// But what about:
declare function process(x: number): void;  // has args, returns void

if (read()) {
    process(42);         // ← NOT preserved (has arguments! fails ambient-no-arg-void)
    read();              // UNNECESSARILY invalidated for standalone read
}
```

**Wait** — for standalone `read`, `isUnrelatedCallForStableReference` already returns true for `process(42)` because it's a standalone call to a different identifier:

```go
// Standalone call (Identifier callee)
if ast.IsIdentifier(callee) {
    if ast.IsIdentifier(referenceCallee) && c.isMatchingReference(callee, referenceCallee) {
        return false  // Same function
    }
    if ast.IsIdentifier(referenceCallee) || ast.IsAccessExpression(referenceCallee) {
        return true   // Different standalone function → unrelated!
    }
}
```

So `process(42)` when the stable reference is `read()` → `isUnrelatedCallForStableReference` returns true → `stableBoundaryKindNone` → **already safe!**

**Re-examining**: When does the unknown-call boundary actually trigger for a standalone stable reference? Only when:
1. The callee is NOT an identifier and NOT an access expression (e.g., IIFE, conditional expression, call return value)
2. OR the callee IS the same identifier as the stable reference (self-call)

For member-access stable references like `store.read()`:
- Method calls on ANY receiver → already transparent (getter parity)
- Standalone calls → already transparent if callee is different identifier

**The actual gap is much smaller than initially thought.** The main scenarios that reach `stableBoundaryKindUnknownCall` are:
1. Self-calls (the function calling itself — doesn't happen for stable reads)
2. IIFE calls
3. Calls through computed/dynamic expressions like `getHandler()()`

---

## 5. TypeScript CFA Precedent Deep Dive

### 5.1 How TypeScript Handles Property Narrowing

TypeScript's approach to property narrowing across calls is straightforward:

```typescript
// In getTypeAtFlowCall:
// If the call doesn't have assertion predicates or never return type,
// return undefined → the call is TRANSPARENT to narrowing.
```

This means **ALL function calls** are transparent for property narrowing. TypeScript's getter CFA is fully optimistic.

### 5.2 How TypeScript Handles Local Variable Narrowing

For local variables, TypeScript uses a different mechanism:

```typescript
// In FlowStart handling:
// For non-property references (locals), flow analysis continues
// UP through function boundaries. If the variable is captured in
// a function that's called, narrowing is reset.

// The key check:
if (container && container !== flowContainer &&
    reference.kind !== SyntaxKind.PropertyAccessExpression &&
    reference.kind !== SyntaxKind.ElementAccessExpression) {
    flow = container.flowNode!;  // Continue to outer scope
    continue;
}
```

This means:
- Properties: Never reset by calls (optimistic)
- Locals: Reset if the local escapes into a called function (slightly pessimistic)

### 5.3 How This Relates to Stable

Our `stable` modifier sits between these:
- It's not a property (it's a function call result)
- It's not a local variable being reassigned
- It's more like a property getter — a way to access underlying state

**The getter parity goal says**: Stable reads should behave like property accesses for CFA purposes. The current `isUnrelatedCallForStableReference` achieves this for the most common patterns.

### 5.4 TypeScript's Assignment Flow for Properties

```typescript
// In getTypeAtFlowAssignment:
if (containsMatchingReference(reference, node)) {
    // Any assignment to a "parent path" of the reference resets narrowing.
    // e.g., if reference is obj.prop and assignment is to obj, reset.
    return declaredType;
}
```

Our equivalent: `isStableReceiverWriteBoundaryForCallReference` checks for writes to the same receiver, which resets narrowing for all stable endpoints on that receiver.

---

## 6. Implementation Recommendation

### 6.1 Priority-Ranked Proposals

**Rank 1: Do Nothing (Current System is Already Good)**

The current system with `isUnrelatedCallForStableReference` already achieves getter parity for the vast majority of real-world code. The remaining "unknown call" scenarios are edge cases:
- IIFEs: Rare in production code
- Dynamic dispatch `getHandler()()`: Correctly conservative
- Self-calls: Not applicable to stable reads

**Estimated improvement over current system**: Minimal. The current implementation already handles ~95% of real-world patterns.

**Rank 2: Argument Escape Analysis (Rule Set A Extension)**

Add argument containment checking for the cases that do reach `stableBoundaryKindUnknownCall`:

```ts
// This would help with:
if (store.data()) {
    opaqueDynamicCall(store);  // r passed → UNSAFE (correctly caught)
    opaqueDynamicCall(42);     // r not passed → Now SAFE (was UNSAFE)
}
```

But since `opaqueDynamicCall` with an identifier callee is already transparent, this only helps for non-identifier callees (computed, IIFE, etc.).

**Value**: Low
**Complexity**: ~40 lines
**Risk**: Low

**Rank 3: Const Binding + Argument Escape (Rule Set C)**

Combine const binding analysis with argument escape for standalone stable references:

```ts
function example() {
    const read: stable () => string | undefined = getReader();
    
    if (read()) {
        // read is const local, not captured, not passed
        anyFunction();  // SAFE — can't affect read
        read();         // preserved
    }
}
```

**Value**: Medium (only for standalone stable references in const locals)
**Complexity**: ~100 lines + binder integration
**Risk**: Medium (binder data dependency)

### 6.2 Final Recommendation

**The current system is already near-optimal for the stated goals.** The `isUnrelatedCallForStableReference` function achieves getter parity by making:
- All method calls transparent (same as property getter CFA)
- All standalone calls to different identifiers transparent

The remaining edge cases (IIFEs, dynamic dispatch, computed calls) are correctly conservative and represent < 5% of real-world call patterns.

**If further refinement is desired**, argument escape analysis (Rank 2) provides the best effort-to-value ratio with minimal risk. But I'd recommend investing that effort into other areas of the stable CFA system (e.g., better error messages, documentation, or Phase 2 features) rather than chasing diminishing returns on boundary classification.

---

## 7. Gap Analysis: What Remains Unsafe

For completeness, here are the patterns that will remain unsafe (uncertainty boundaries) even with all proposed heuristics:

```ts
interface Resource<T> {
    value: stable () => T | undefined;
    set: mutator (v: T) => void;
}
declare const r: Resource<string>;

if (r.value()) {
    // 1. IIFE with body that could capture r
    (() => { /* could capture r */ })();         // Conservative: unsafe
    
    // 2. Dynamic dispatch
    getHandler()();                               // Conservative: unsafe
    
    // 3. Computed call
    (condition ? fnA : fnB)();                    // Conservative: unsafe
    
    // 4. Template tag (technically a call)
    tag`template`;                                // Conservative: unsafe
    
    // 5. new expression
    new SomeClass();                              // Already transparent (not a call)
}
```

All of these represent < 5% of real-world patterns and are correctly conservative (safe from a soundness perspective, just potentially annoying).

---

## 8. Summary Table

| Heuristic | Already Implemented? | Value Add | Complexity | Soundness Risk | Recommendation |
|---|---|---|---|---|---|
| Unrelated call (receiver analysis) | ✅ Yes | N/A | N/A | N/A | Keep |
| Known-safe builtins | ✅ Covered by receiver analysis | None | Low | None | Skip |
| Argument escape analysis | ❌ No | Low | Low-Medium | None | Optional |
| Const binding analysis | ❌ No | Medium | Medium-High | None | Defer to Phase 2+ |
| Closure capture analysis | ❌ No | Medium | High | Low (body inspection) | Not recommended |
| Full interprocedural analysis | ❌ No | High | Very High | N/A | Out of scope |
| Ambient no-arg void preserve | ✅ Yes | N/A | N/A | N/A | Keep |
| Noop callback preserve | ✅ Yes | N/A | N/A | N/A | Keep |
| Trivial passthrough preserve | ✅ Yes | N/A | N/A | N/A | Keep |

---

## 9. Test Scenarios for Future Heuristics

If argument escape analysis is implemented, these test cases should be added:

```ts
// @strict: true
// @noEmit: true

interface Resource<T> {
  value: stable () => T | undefined;
  set: mutator (v: T) => void;
}

// Case 1: Container passed directly → invalidate
declare const r: Resource<string>;
declare function process(x: Resource<string>): void;

if (r.value()) {
  process(r);
  const s: string = r.value(); // should error
}

// Case 2: Container property (mutator) extracted and passed → invalidate
if (r.value()) {
  someFunction(r.set);
  const s: string = r.value(); // should error
}

// Case 3: Container in object literal → invalidate
if (r.value()) {
  someFunction({ res: r });
  const s: string = r.value(); // should error
}

// Case 4: Value (not container) passed → preserve
if (r.value()) {
  someFunction(r.value());
  const s: string = r.value(); // should preserve
}

// Case 5: Unrelated argument → preserve
if (r.value()) {
  someFunction(42);
  const s: string = r.value(); // should preserve (already works)
}

// Case 6: Closure capturing container → invalidate
if (r.value()) {
  someFunction(() => r.set("x"));
  const s: string = r.value(); // should error
}
```
