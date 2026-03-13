// @strict: true
// @noEmit: true

// Identity modifier: closure and callback scope tests.
// Tests that stable call narrowing behaves correctly inside closures,
// after last assignment, and across callback boundaries.

declare const read: stable () => string | undefined;

// --- 1. Basic closure captures narrowed stable type ---

if (read() !== undefined) {
    const captured = read();
    const fn = () => {
        const v: string = captured; // OK — captured const preserves narrowing
        v;
    };
    fn();
}

// --- 2. Identity call inside closure re-evaluates (no stale narrowing) ---

if (read() !== undefined) {
    const fn = () => {
        // Identity narrowing from outer scope propagates into closures,
        // matching getter behavior. The call is narrowed by the outer guard.
        const v: string = read(); // OK — stable narrowing propagates into closure (getter parity)
        v;
    };
    fn();
}

// --- 3. Closure after trivial passthrough preserves narrowing ---

declare function passthrough<T>(x: T): T;

if (read() !== undefined) {
    passthrough(read());
    const fn = () => {
        const v: string = read(); // should error — closure re-evaluates stable call
        v;
    };
    fn();
}

// --- 4. Identity narrowing in immediately invoked closure ---

if (read() !== undefined) {
    const result = (() => {
        return read(); // string — IIFE preserves stable narrowing (getter parity)
    })();
    result;
}

// --- 5. Multiple stable endpoints in closures ---

declare const readA: stable () => number | null;
declare const readB: stable () => boolean | undefined;

if (readA() !== null && readB() !== undefined) {
    const a = readA(); // narrowed to number
    const b = readB(); // narrowed to boolean
    const fn = () => {
        const va: number = a;   // OK — captured const
        const vb: boolean = b;  // OK — captured const
        va;
        vb;
    };
    fn();
}
