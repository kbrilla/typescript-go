//// [tests/cases/compiler/stableModifierMethodDeclarations.ts] ////

//// [stableModifierMethodDeclarations.ts]
// === Section 1: Basic stable method on class declarations ===
class Store<T> {
    private _value: T;
    constructor(value: T) { this._value = value; }
    stable get(): T { return this._value; }
    mutator set(value: T): void { this._value = value; }
    mutator reset(): void { this._value = undefined as any; }
}

declare const store: Store<string | undefined>;

// Stable narrowing should work with method declarations
if (store.get() !== undefined) {
    const s: string = store.get(); // OK — narrowed
}

// === Section 2: Post-call narrowing — mutator with string argument ===
if (store.get() !== undefined) {
    store.set("new"); // mutator sets string → post-call narrowing gives string
    const afterSet: string = store.get(); // OK — post-call narrowed to string
    afterSet;
}

// === Section 3: Full invalidation — parameterless mutator ===
if (store.get() !== undefined) {
    store.reset(); // parameterless mutator — fully invalidates
    const afterReset: string = store.get(); // error — back to string | undefined
    afterReset;
}

// === Section 4: Mutator with undefined argument ===
if (store.get() !== undefined) {
    store.set(undefined); // mutator sets undefined → post-call narrows to undefined
    const afterSetUndefined: string = store.get(); // error — narrowed to undefined
    afterSetUndefined;
}

// === Section 5: Stable modifier on interface method signatures ===
interface ReadableStore<T> {
    stable get(): T;
}

interface WritableStore<T> extends ReadableStore<T> {
    mutator set(value: T): void;
    mutator reset(): void;
}

declare const ws: WritableStore<string | undefined>;
if (ws.get() !== undefined) {
    const s: string = ws.get(); // OK — narrowed
    ws.reset();
    const afterReset: string = ws.get(); // error — invalidated
    afterReset;
}

// === Section 6: Stable modifier on type literal method signatures ===
declare const obj: {
    stable get(): string | undefined;
    mutator set(value: string): void;
    mutator reset(): void;
};

if (obj.get() !== undefined) {
    const s: string = obj.get(); // OK — narrowed
    obj.reset();
    const afterReset: string = obj.get(); // error — invalidated
    afterReset;
}

// === Section 7: Method named 'mutator' should still work as identifier ===
class Foo {
    mutator(): void {}
}

const foo = new Foo();
foo.mutator(); // OK — just calling a method named "mutator"

// === Section 8: stable + mutator cannot combine on methods ===
interface BadStore {
    stable mutator bad(): string; // error — can't combine
}

// === Section 9: stable method must have no parameters ===
interface BadGetter {
    stable get(key: string): string; // error — stable methods must have no parameters
}

// === Section 10: Super call invalidation with method declarations ===
class Base {
    stable get(): string | undefined { return "hello"; }
    mutator set(value: string | undefined): void {}
    mutator reset(): void {}
}

class Derived extends Base {
    override stable get(): string | undefined { return super.get(); }
    override mutator set(value: string | undefined): void { super.set(value); }
    override mutator reset(): void { super.reset(); }

    test(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            this.reset(); // parameterless mutator invalidates
            const afterReset: string = this.get(); // error — invalidated
            afterReset;
        }
    }
}


//// [stableModifierMethodDeclarations.js]
"use strict";
// === Section 1: Basic stable method on class declarations ===
class Store {
    _value;
    constructor(value) { this._value = value; }
    stable get() { return this._value; }
    mutator set(value) { this._value = value; }
    mutator reset() { this._value = undefined; }
}
// Stable narrowing should work with method declarations
if (store.get() !== undefined) {
    const s = store.get(); // OK — narrowed
}
// === Section 2: Post-call narrowing — mutator with string argument ===
if (store.get() !== undefined) {
    store.set("new"); // mutator sets string → post-call narrowing gives string
    const afterSet = store.get(); // OK — post-call narrowed to string
    afterSet;
}
// === Section 3: Full invalidation — parameterless mutator ===
if (store.get() !== undefined) {
    store.reset(); // parameterless mutator — fully invalidates
    const afterReset = store.get(); // error — back to string | undefined
    afterReset;
}
// === Section 4: Mutator with undefined argument ===
if (store.get() !== undefined) {
    store.set(undefined); // mutator sets undefined → post-call narrows to undefined
    const afterSetUndefined = store.get(); // error — narrowed to undefined
    afterSetUndefined;
}
if (ws.get() !== undefined) {
    const s = ws.get(); // OK — narrowed
    ws.reset();
    const afterReset = ws.get(); // error — invalidated
    afterReset;
}
if (obj.get() !== undefined) {
    const s = obj.get(); // OK — narrowed
    obj.reset();
    const afterReset = obj.get(); // error — invalidated
    afterReset;
}
// === Section 7: Method named 'mutator' should still work as identifier ===
class Foo {
    mutator() { }
}
const foo = new Foo();
foo.mutator(); // OK — just calling a method named "mutator"
// === Section 10: Super call invalidation with method declarations ===
class Base {
    stable get() { return "hello"; }
    mutator set(value) { }
    mutator reset() { }
}
class Derived extends Base {
    stable get() { return super.get(); }
    mutator set(value) { super.set(value); }
    mutator reset() { super.reset(); }
    test() {
        if (this.get() !== undefined) {
            const before = this.get(); // OK — narrowed
            this.reset(); // parameterless mutator invalidates
            const afterReset = this.get(); // error — invalidated
            afterReset;
        }
    }
}
