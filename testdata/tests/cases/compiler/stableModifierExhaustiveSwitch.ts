// @strict: true
// @noEmit: true

// Phase 3: Exhaustive switch carryover on stable reads.
// Verifies that switch/case discriminant narrowing works with stable calls
// and that exhaustiveness checking produces the expected `never` type.

type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; side: number }
    | { kind: "triangle"; base: number; height: number };

declare const readShape: stable () => Shape;

// Exhaustive switch — each case should narrow the discriminant.
function exhaustiveSwitch() {
    switch (readShape().kind) {
        case "circle":
            const circleRadius: number = readShape().radius;
            circleRadius;
            break;
        case "square":
            const squareSide: number = readShape().side;
            squareSide;
            break;
        case "triangle":
            const triBase: number = readShape().base;
            triBase;
            break;
    }
}

// Exhaustive switch with default never — confirms exhaustiveness.
function exhaustiveWithDefaultNever() {
    switch (readShape().kind) {
        case "circle":
            const circleRadius: number = readShape().radius;
            circleRadius;
            break;
        case "square":
            const squareSide: number = readShape().side;
            squareSide;
            break;
        case "triangle":
            const triBase: number = readShape().base;
            triBase;
            break;
        default:
            const _exhaustive: never = readShape();
            _exhaustive;
    }
}

// typeof switch narrowing on stable calls.
declare const readValue: stable () => string | number | boolean;

function typeofSwitch() {
    switch (typeof readValue()) {
        case "string":
            const str: string = readValue();
            str;
            break;
        case "number":
            const num: number = readValue();
            num;
            break;
        case "boolean":
            const bool: boolean = readValue();
            bool;
            break;
    }
}

// Switch with fall-through between cases (narrowing should widen).
function switchFallthrough() {
    switch (readShape().kind) {
        case "circle":
        case "square":
            // After fall-through, should be circle | square
            const circleOrSquare: { kind: "circle"; radius: number } | { kind: "square"; side: number } = readShape();
            circleOrSquare;
            break;
        case "triangle":
            const tri: { kind: "triangle"; base: number; height: number } = readShape();
            tri;
            break;
    }
}

// Non-exhaustive switch — narrowing is not guaranteed after switch.
function nonExhaustiveSwitch() {
    switch (readShape().kind) {
        case "circle":
            const circleRadius: number = readShape().radius;
            circleRadius;
            break;
        // Missing square and triangle cases
    }
    // After non-exhaustive switch, type should be Shape (not narrowed).
    const afterNonExhaustive: Shape = readShape();
    afterNonExhaustive;
}
