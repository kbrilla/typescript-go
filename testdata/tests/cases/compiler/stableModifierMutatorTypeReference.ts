// @strict: true
// @noEmit: true

// Tests: `mutator` applied to type references (not inline function types).
// Currently `mutator` only works before function type syntax: `mutator (value: T) => void`.
// These scenarios test extending it to support: `mutator Setter<T>`.

// === Scenario 1: mutator on a callable interface type reference in a tuple ===

type Accessor<T> = stable () => T;

interface Setter<T> {
    (value: T): void;
    (fn: (prev: T) => T): void;
}

// mutator before a type reference, with cross-binding invalidates
type Signal<T> = [get: Accessor<T>, set: mutator Setter<T> invalidates get];

declare function createSignal<T>(value: T): Signal<T>;

const [count, setCount] = createSignal<number | undefined>(0);

if (count() !== undefined) {
    count().toFixed(2);   // narrowed to number
    setCount(42);          // invalidates + post-call narrowing
    count().toFixed(2);    // still narrowed (post-call: number)
    setCount(undefined);   // post-call narrowing to undefined
}

// === Scenario 2: Complex overloaded setter (SolidJS-style) ===

type SolidSetter<in out T> = {
    <U extends T>(...args: undefined extends T ? [] : [value: Exclude<U, Function> | ((prev: T) => U)]): undefined extends T ? undefined : U;
    <U extends T>(value: (prev: T) => U): U;
    <U extends T>(value: Exclude<U, Function>): U;
    <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};

type SolidSignal<T> = [get: stable () => T, set: mutator SolidSetter<T> invalidates get];

declare function createSolidSignal<T>(value: T): SolidSignal<T>;

const [value, setValue] = createSolidSignal<string | null>("hello");

if (value() !== null) {
    value().toUpperCase();  // narrowed to string
    setValue(null);          // invalidates
}

// === Scenario 3: mutator on a type alias that resolves to a function type ===

type UpdateFn<T> = (value: T) => void;

// mutator on a type alias reference (not a callable interface)
declare function createCell<T>(init: T): [
    read: stable () => T,
    write: mutator UpdateFn<T> invalidates read
];

const [getCell, setCell] = createCell<boolean | undefined>(true);

if (getCell() !== undefined) {
    getCell() === true;    // narrowed to boolean
    setCell(undefined);     // invalidates
}

// === Scenario 4: mutator on a generic constraint ===

interface Writer<T> {
    (value: T): void;
}

// mutator applied to a generic type parameter with a callable constraint
declare function createPair<T, W extends Writer<T>>(init: T): [
    read: stable () => T,
    write: mutator W invalidates read
];

const [getPair, setPair] = createPair<number | undefined, Writer<number | undefined>>(10);

if (getPair() !== undefined) {
    getPair().toFixed(2);  // narrowed to number
    setPair(undefined);     // invalidates
}

// === Scenario 5: Explicit invalidation verification ===
// This scenario explicitly verifies that cross-binding invalidation works:
// after setCount2() is called, count2()'s narrowing should be reset.

interface SimpleSetter<T> {
    (value: T): void;
}

type Signal2<T> = [get: stable () => T, set: mutator SimpleSetter<T> invalidates get];

declare function createSignal2<T>(value: T): Signal2<T>;

const [count2, setCount2] = createSignal2<number | undefined>(0);

if (count2() !== undefined) {
    count2().toFixed(2);   // OK: narrowed to number
    setCount2(undefined);  // invalidates: resets count2() narrowing
    // After invalidation, count2() should be back to number | undefined
    // so calling .toFixed() without a check should be an error:
    count2().toFixed(2);   // Error expected: count2() is number | undefined again
}
