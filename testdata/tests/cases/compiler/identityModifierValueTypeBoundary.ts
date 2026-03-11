// @strict: true
// @target: esnext
// @noEmit: true

type Signal<T> = identity () => T;

declare const read: Signal<string | undefined>;

// Ambient void functions that should be transparent
declare function log(): void;
declare function tick(): void;
declare function noop(): void;

// === Ambient no-arg void calls should preserve narrowing ===
if (read() !== undefined) {
    log();
    const r1: string = read(); // Should preserve - ambient, void, no-args
}

if (read() !== undefined) {
    tick();
    noop();
    const r2: string = read(); // Should preserve - multiple transparent calls
}

// === NEGATIVE: Non-void return should NOT preserve ===
declare function getValue(): number;
if (read() !== undefined) {
    getValue();
    const r3: string = read(); // May not preserve (non-void return)
}

// === NEGATIVE: Has arguments should NOT preserve ===
declare function logMessage(msg: string): void;
if (read() !== undefined) {
    logMessage("hello");
    const r4: string = read(); // May not preserve (has args)
}

// === NEGATIVE: Non-ambient should NOT preserve ===
function sideEffect(): void {
    // has a body - not ambient
}
if (read() !== undefined) {
    sideEffect();
    const r5: string = read(); // May not preserve (has body)
}
