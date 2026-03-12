// @strict: true
// @target: esnext

// Section 1: Basic cross-binding invalidation with named tuple labels
// A factory returns a [getter, setter] tuple. The setter's invalidates clause
// targets the tuple label "read", connecting it to the getter binding.

declare function createSignal<T>(value: T): [
    read: stable () => T,
    write: mutator (value: T) => void invalidates read
];

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    count().toFixed(2); // OK — narrowed to number
    setCount(undefined); // mutator: invalidates read → resets count() narrowing
    // Post-call narrowing: argument is undefined → count() narrows to undefined
    const x: undefined = count();
}

// Section 2: Post-call narrowing preserves type through cross-binding
const [value, setValue] = createSignal<string | undefined>("hello");

if (value() !== undefined) {
    value().toUpperCase(); // OK — narrowed to string
    setValue("world"); // arg is string → post-call narrows value() to string
    value().toUpperCase(); // Should still work — narrowed to string
    setValue(undefined); // arg is undefined → post-call narrows to undefined
    const y: undefined = value();
}

// Section 3: Selective cross-binding — only invalidates targeted sibling
declare function createDualSignal<A, B>(a: A, b: B): [
    readA: stable () => A,
    readB: stable () => B,
    writeA: mutator (value: A) => void invalidates readA,
    writeB: mutator (value: B) => void invalidates readB,
];

const [getA, getB, setA, setB] = createDualSignal<string | undefined, number | undefined>("hello", 42);

if (getA() !== undefined && getB() !== undefined) {
    getA().toUpperCase(); // OK
    getB().toFixed(2); // OK
    setB(undefined); // invalidates readB ONLY — NOT readA
    getA().toUpperCase(); // Should still work — setB doesn't target readA
    // getB() is now invalidated
    const z: undefined = getB(); // post-call narrowing from setB(undefined)
}

// Section 4: Cross-binding without narrowing (non-union type)
declare function createCounter(): [
    read: stable () => number,
    increment: mutator () => void invalidates read
];

const [getCount, increment] = createCounter();
const n1: number = getCount(); // number — no union, no narrowing benefit
increment(); // invalidates read
const n2: number = getCount(); // still number

// Section 5: Grammar — invalidates clause on non-mutator should error
declare function createBadSignal<T>(value: T): [
    read: stable () => T,
    write: (value: T) => void invalidates read // Error: invalidates requires mutator
];

// Section 6: Cross-binding with null narrowing and sequential mutations
declare function createNullable(): [
    read: stable () => string | null,
    write: mutator (value: string | null) => void invalidates read,
];

const [getText, setText] = createNullable();

if (getText() !== null) {
    getText().length; // OK — narrowed to string
    setText(null); // post-call narrows getText() to null
    const nullVal: null = getText(); // correctly null
    setText("hello"); // post-call narrows getText() back to string
    getText().length; // OK — narrowed back to string
}

// Section 7: Multiple mutators targeting same stable endpoint
declare function createMultiMutator<T>(): [
    read: stable () => T | undefined,
    set: mutator (value: T) => void invalidates read,
    clear: mutator () => void invalidates read,
];

const [getVal, setVal, clearVal] = createMultiMutator<string>();

if (getVal() !== undefined) {
    getVal().toUpperCase(); // OK — narrowed to string
    clearVal(); // invalidates read — no args, full reset
    getVal(); // back to string | undefined (no post-call narrowing without args)
}

if (getVal() !== undefined) {
    setVal("new"); // invalidates read, post-call narrows to string
    getVal().toUpperCase(); // OK — post-call narrowed to string
}
