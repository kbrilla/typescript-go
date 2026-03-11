// @strict: true
// @noEmit: true

// Identity modifier: submodule parity expansion.
// Tests CFA narrowing patterns from _submodules/TypeScript/tests/ adapted for identity reads.
// Sources: controlFlowGenericTypes, controlFlowTruthiness, controlFlowOptionalChain,
//          controlFlowIfStatement, controlFlowWhileStatement, narrowByEquality.

// --- Declarations ---

type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; size: number }
    | { kind: "triangle"; base: number; height: number };

declare const readShape: identity () => Shape;
declare const readMaybe: identity () => string | undefined;
declare const readNullable: identity () => number | null;
declare const readUnion: identity () => string | number | boolean;

// --- 1. Switch/case discriminant narrowing ---
// Source: narrowByDiscriminantInLoop, controlFlowAliasedDiscriminants

switch (readShape().kind) {
    case "circle":
        const r: number = readShape().radius; // should narrow to circle
        r;
        break;
    case "square":
        const s: number = readShape().size; // should narrow to square
        s;
        break;
    case "triangle":
        const b: number = readShape().base; // should narrow to triangle
        b;
        break;
}

// --- 2. Truthiness narrowing ---
// Source: controlFlowTruthiness

if (readMaybe()) {
    const truthyVal: string = readMaybe(); // should narrow to string (truthy excludes undefined)
    truthyVal;
}

if (!readMaybe()) {
    // After falsy check, type should still be string | undefined (empty string is falsy)
    readMaybe();
}

// --- 3. Type predicate narrowing ---
// Source: controlFlowGenericTypes, typeGuardsInProperties

declare function isString(x: unknown): x is string;
declare function isNumber(x: unknown): x is number;

if (isString(readUnion())) {
    const str: string = readUnion(); // should narrow to string
    str;
}

if (isNumber(readUnion())) {
    const num: number = readUnion(); // should narrow to number
    num;
}

// --- 4. Equality narrowing ---
// Source: narrowByEquality

if (readMaybe() === "hello") {
    const hello: "hello" = readMaybe(); // should narrow to "hello"
    hello;
}

if (readMaybe() !== undefined) {
    const definite: string = readMaybe(); // should narrow to string
    definite;
}

if (readNullable() !== null) {
    const nonNull: number = readNullable(); // should narrow to number
    nonNull;
}

// --- 5. While loop narrowing ---
// Source: controlFlowWhileStatement

while (readMaybe() !== undefined) {
    const loopVal: string = readMaybe(); // should narrow to string inside loop
    loopVal;
    break;
}

// --- 6. Ternary/conditional expression narrowing ---
// Source: controlFlowTruthiness

const ternaryResult: string = readMaybe() !== undefined ? readMaybe() : "default"; // should narrow in true branch
ternaryResult;

// --- 7. Logical AND/OR narrowing ---
// Source: controlFlowTruthiness

const andResult = readMaybe() && readMaybe().length; // should narrow: if truthy, can access .length
andResult;

const orResult: string = readMaybe() || "fallback"; // should narrow: if falsy, use fallback
orResult;

// --- 8. Nullish coalescing narrowing ---
// Source: controlFlowNullishCoalesce

const coalesceResult: string = readMaybe() ?? "fallback"; // should narrow to string
coalesceResult;

const coalesceNullResult: number = readNullable() ?? 0; // should narrow to number
coalesceNullResult;

// --- 9. Discriminant narrowing with nested member access ---
// Source: controlFlowAliasedDiscriminants

if (readShape().kind === "circle") {
    const circleRadius: number = readShape().radius; // should narrow to circle
    circleRadius;
}

if (readShape().kind === "square") {
    const squareSize: number = readShape().size; // should narrow to square
    squareSize;
}

// --- 10. Negated narrowing ---

if (readMaybe() === undefined) {
    const undef: undefined = readMaybe(); // should narrow to undefined
    undef;
}

if (readNullable() === null) {
    const nullVal: null = readNullable(); // should narrow to null
    nullVal;
}
