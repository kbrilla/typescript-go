// @strict: true
// @noEmit: true

// Phase 3: Guarded optional-chain carryover and discriminant patterns.
// Tests optional chaining as discriminant, with method calls, and
// boundary interaction patterns with stable reads.

type Animal = { kind: "cat"; meow: boolean } | { kind: "dog"; bark: boolean };

declare const readAnimal: stable () => Animal | undefined;
declare const read: stable () => string | undefined;

// Optional chain as discriminant — should narrow.
if (readAnimal()?.kind === "cat") {
    const cat = readAnimal();
    cat;
}

// Optional chain + typeof guard.
if (typeof read() === "string") {
    const str: string = read();
    str;
}

// Optional chaining on stable result with method call.
if (read() !== undefined) {
    const upper = read()!.toUpperCase();
    const result: string = upper;
    result;
}

// Nested optional chain on stable discriminant.
declare const readNested: stable () => { inner?: Animal } | undefined;

if (readNested()?.inner?.kind === "cat") {
    const nested = readNested();
    nested;
}

// Identity read after unrelated method call on result.
if (read() !== undefined) {
    const len = read()!.length;
    const n: number = len;
    n;
    const stillNarrowed: string = read();
    stillNarrowed;
}

// Identity narrowing with template literal.
if (read() !== undefined) {
    const template = `value: ${read()}`;
    const s: string = template;
    s;
}

// Truthiness narrowing + stable.
if (read()) {
    const truthy: string = read();
    truthy;
}

// Double negation truthiness.
if (!!read()) {
    const doubleNeg: string = read();
    doubleNeg;
}

// Inequality narrowing.
if (read() != null) {
    const notNull: string = read();
    notNull;
}

// Strict equality to specific value.
if (read() === "hello") {
    const hello: "hello" = read();
    hello;
}
