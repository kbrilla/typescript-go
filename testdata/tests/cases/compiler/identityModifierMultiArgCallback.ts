// @strict: true
// @target: esnext
// @noEmit: true

type Signal<T> = identity () => T;

declare function invoke(callback: () => void): void;
declare function invokeWithData(data: number, callback: () => void): void;
declare function invokeMultiCallback(cb1: () => void, cb2: () => void): void;
declare function invokeCallbackFirst(callback: () => void, data: number): void;
declare function invokeThreeArgs(a: number, callback: () => void, b: string): void;

declare const read: Signal<string | undefined>;

// === Single-arg no-op callback (Phase 1 - should preserve) ===
if (read() !== undefined) {
    invoke(() => {});
    const r1: string = read(); // OK - single no-op callback preserves
}

// === Multi-arg with trailing no-op callback (Phase 2) ===
if (read() !== undefined) {
    invokeWithData(42, () => {});
    const r2: string = read(); // Phase 2: should preserve narrowing
}

// === Multi-arg with leading no-op callback (Phase 2) ===
if (read() !== undefined) {
    invokeCallbackFirst(() => {}, 42);
    const r3: string = read(); // Phase 2: should preserve narrowing
}

// === Multi-arg with two no-op callbacks (Phase 2) ===
if (read() !== undefined) {
    invokeMultiCallback(() => {}, () => {});
    const r4: string = read(); // Phase 2: should preserve narrowing
}

// === Multi-arg with callback in middle position (Phase 2) ===
if (read() !== undefined) {
    invokeThreeArgs(1, () => {}, "x");
    const r5: string = read(); // Phase 2: should preserve narrowing
}

// === NEGATIVE: Multi-arg with non-empty callback (should NOT preserve) ===
if (read() !== undefined) {
    invokeWithData(42, () => { console.log("side effect"); });
    const r6: string = read(); // Should fail - callback has side effects
}

// === NEGATIVE: Multi-arg with parameterized callback (should NOT preserve) ===
declare function invokeWithParamCb(data: number, callback: (x: number) => void): void;
if (read() !== undefined) {
    invokeWithParamCb(42, (x) => {});
    const r7: string = read(); // Should fail - callback has parameters
}
