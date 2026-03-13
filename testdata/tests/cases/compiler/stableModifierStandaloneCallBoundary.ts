// @strict: true
// @noEmit: true

type Signal<T> = stable () => T;
declare const value: Signal<string | undefined>;

// === Section 1: Standalone function calls should NOT invalidate ===
// Matches getter behavior: function calls are transparent to property narrowing.
declare function someHelper(x: string): void;
declare function unknownFunc(): void;
declare function anotherFunc(a: number, b: string): void;

if (value() !== undefined) {
    someHelper(value());
    const s: string = value(); // Should preserve - standalone call is unrelated
}

if (value() !== undefined) {
    unknownFunc();
    const s: string = value(); // Should preserve - standalone call is unrelated
}

if (value() !== undefined) {
    anotherFunc(42, "hello");
    const s: string = value(); // Should preserve - standalone call is unrelated
}

// === Section 2: Same-receiver method calls are transparent (getter parity) ===
declare const store: {
    read: stable () => string | undefined;
    clear(): void;
};

if (store.read() !== undefined) {
    store.clear();
    const s: string = store.read(); // Transparent - getter parity: method calls don't invalidate narrowing
}

// === Section 3: Member stable with standalone call ===
if (store.read() !== undefined) {
    unknownFunc();
    const s: string = store.read(); // Should preserve - standalone call is unrelated to store
}

// === Section 4: Mixed patterns ===
declare const otherStore: { doSomething(): void };

if (store.read() !== undefined) {
    otherStore.doSomething();
    unknownFunc();
    someHelper("test");
    const s: string = store.read(); // Should preserve through all unrelated calls
}
