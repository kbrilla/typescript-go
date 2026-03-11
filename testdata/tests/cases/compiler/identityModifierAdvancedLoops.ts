// @strict: true
// @noEmit: true

// Phase 3: Advanced loop patterns with identity narrowing.
// Verifies that for-in nonnull, for-of with narrowing, and loop body
// boundaries interact correctly with identity CFA.

declare const readObj: identity () => Record<string, number> | undefined;
declare const readArr: identity () => number[] | undefined;
declare const read: identity () => string | undefined;

// For-in over identity read — should narrow to non-nullish.
if (readObj() !== undefined) {
    for (const key in readObj()) {
        const k: string = key;
        k;
    }
}

// For-of over identity read — should work with narrowed array.
if (readArr() !== undefined) {
    for (const item of readArr()) {
        const n: number = item;
        n;
    }
}

// For-of with destructuring from identity read.
declare const readPairs: identity () => Array<{ a: string; b: number }>;

for (const { a, b } of readPairs()) {
    const str: string = a;
    const num: number = b;
    str;
    num;
}

// While loop with identity read condition.
declare const readFlag: identity () => boolean;

while (readFlag()) {
    const flag: boolean = readFlag();
    flag;
}

// Do-while with identity read.
do {
    const val = read();
    val;
} while (read() !== undefined);

// Nested for-of with identity.
declare const readMatrix: identity () => number[][];

for (const row of readMatrix()) {
    for (const cell of row) {
        const n: number = cell;
        n;
    }
}

// For-of with narrowing check inside loop body.
if (read() !== undefined) {
    for (const _ of [1, 2, 3]) {
        if (read() !== undefined) {
            const val: string = read();
            val;
        }
    }
}
