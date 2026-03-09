//// [tests/cases/compiler/identityFunctionNarrowing.ts] ////

//// [identityFunctionNarrowing.ts]
// Basic identity function narrowing
declare const value: identity () => string | undefined;

if (value() !== undefined) {
    const x: string = value(); // Should narrow to string
}

// Truthiness narrowing  
declare const flag: identity () => string | undefined;
if (flag()) {
    const s: string = flag(); // Should narrow to string (truthy)
}

// typeof narrowing
declare const mixed: identity () => string | number;
if (typeof mixed() === "string") {
    const s: string = mixed(); // Should narrow to string
}

// Non-identity function should NOT narrow
declare const nonIdentity: () => string | undefined;
if (nonIdentity() !== undefined) {
    const x: string | undefined = nonIdentity(); // Should NOT narrow - stays string | undefined
}


//// [identityFunctionNarrowing.js]
"use strict";
if (value() !== undefined) {
    const x = value(); // Should narrow to string
}
if (flag()) {
    const s = flag(); // Should narrow to string (truthy)
}
if (typeof mixed() === "string") {
    const s = mixed(); // Should narrow to string
}
if (nonIdentity() !== undefined) {
    const x = nonIdentity(); // Should NOT narrow - stays string | undefined
}
