//// [tests/cases/compiler/stableModifierBareParameter.ts] ////

//// [stableModifierBareParameter.ts]
// --- Section 1: Basic typeof narrowing through stable parameter ---
function consumeStableParam(read: stable () => string | number) {
    if (typeof read() === 'string') {
        const s: string = read();  // narrowed to string
    }
    if (typeof read() === 'number') {
        const n: number = read();  // narrowed to number
    }
    const full: string | number = read();  // outside guard, full type
}

// --- Section 2: Truthiness narrowing ---
function consumeTruthy(read: stable () => string | undefined) {
    if (read() !== undefined) {
        const s: string = read();  // narrowed to string
    }
    const maybe: string | undefined = read();  // outside guard, full type
}

// --- Section 3: Discriminant narrowing ---
interface Circle { kind: 'circle'; radius: number }
interface Square { kind: 'square'; side: number }
type Shape = Circle | Square;

function consumeDiscriminant(read: stable () => Shape) {
    if (read().kind === 'circle') {
        const r: number = read().radius;  // narrowed to Circle
    }
    if (read().kind === 'square') {
        const s: number = read().side;  // narrowed to Square
    }
}

// --- Section 4: Generic parameter ---
function consumeGeneric<T>(read: stable () => T | undefined) {
    if (read() !== undefined) {
        const val: T = read();  // narrowed to T
    }
}

// --- Section 5: Passed as callback ---
function acceptReader(reader: stable () => string | number) {
    if (typeof reader() === 'string') {
        const s: string = reader();  // narrowed
    }
}

function passStableParam(read: stable () => string | number) {
    acceptReader(read);  // stable parameter can be passed to stable-expecting function
}

// --- Section 6: Non-stable comparison ---
function consumeNonStable(read: () => string | number) {
    if (typeof read() === 'string') {
        const s: string | number = read();  // NOT narrowed — not stable
    }
}

// --- Section 7: Stable in type alias ---
type StableReader<T> = stable () => T;

function consumeAlias(read: StableReader<string | undefined>) {
    if (read() !== undefined) {
        const s: string = read();  // narrowed via type alias
    }
}


//// [stableModifierBareParameter.js]
"use strict";
// --- Section 1: Basic typeof narrowing through stable parameter ---
function consumeStableParam(read) {
    if (typeof read() === 'string') {
        const s = read(); // narrowed to string
    }
    if (typeof read() === 'number') {
        const n = read(); // narrowed to number
    }
    const full = read(); // outside guard, full type
}
// --- Section 2: Truthiness narrowing ---
function consumeTruthy(read) {
    if (read() !== undefined) {
        const s = read(); // narrowed to string
    }
    const maybe = read(); // outside guard, full type
}
function consumeDiscriminant(read) {
    if (read().kind === 'circle') {
        const r = read().radius; // narrowed to Circle
    }
    if (read().kind === 'square') {
        const s = read().side; // narrowed to Square
    }
}
// --- Section 4: Generic parameter ---
function consumeGeneric(read) {
    if (read() !== undefined) {
        const val = read(); // narrowed to T
    }
}
// --- Section 5: Passed as callback ---
function acceptReader(reader) {
    if (typeof reader() === 'string') {
        const s = reader(); // narrowed
    }
}
function passStableParam(read) {
    acceptReader(read); // stable parameter can be passed to stable-expecting function
}
// --- Section 6: Non-stable comparison ---
function consumeNonStable(read) {
    if (typeof read() === 'string') {
        const s = read(); // NOT narrowed — not stable
    }
}
function consumeAlias(read) {
    if (read() !== undefined) {
        const s = read(); // narrowed via type alias
    }
}
