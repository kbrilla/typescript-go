// @strict: true

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
