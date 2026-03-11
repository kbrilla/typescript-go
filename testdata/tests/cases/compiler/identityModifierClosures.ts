// @strict: true
// @noEmit: true

// Identity modifier: closure and callback scope tests.
// Tests that identity call narrowing behaves correctly inside closures,
// after last assignment, and across callback boundaries.

declare const read: identity () => string | undefined;

// --- 1. Basic closure captures narrowed identity type ---

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
        const v: string = read(); // OK — identity narrowing propagates into closure (getter parity)
        v;
    };
    fn();
}

// --- 3. Closure after trivial passthrough preserves narrowing ---

declare function passthrough<T>(x: T): T;

if (read() !== undefined) {
    passthrough(read());
    const fn = () => {
        const v: string = read(); // should error — closure re-evaluates identity call
        v;
    };
    fn();
}

// --- 4. Identity narrowing in immediately invoked closure ---

if (read() !== undefined) {
    const result = (() => {
        return read(); // string — IIFE preserves identity narrowing (getter parity)
    })();
    result;
}

// --- 5. Multiple identity endpoints in closures ---

declare const readA: identity () => number | null;
declare const readB: identity () => boolean | undefined;

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
