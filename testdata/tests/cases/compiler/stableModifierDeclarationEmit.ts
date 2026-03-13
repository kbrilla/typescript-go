// @strict: true
// @declaration: true

// Phase: Declaration emit for stable/mutator/invalidates modifiers

// === 1. Basic stable/mutator function types ===
export type Accessor<T> = stable () => T;
export type SimpleSetter<T> = mutator (v: T) => void;

// === 2. Function type with invalidates clause ===
export type LinkedSetter<T> = mutator (v: T) => void invalidates get;

// === 3. Signal tuple with cross-binding ===
export type Signal<T> = [get: Accessor<T>, set: LinkedSetter<T>];

export declare function createSignal<T>(value: T): Signal<T>;

// === 4. Method signatures with invalidates ===
export interface Store<T> {
    stable getValue(): T;
    stable getLabel(): string;
    mutator setValue(v: T): void invalidates getValue;
    mutator setLabel(l: string): void invalidates getLabel;
    mutator reset(): void invalidates getValue, getLabel;
}

// === 5. Keyed stable/mutator on function types ===
export type KeyedGetter<K, V> = stable[key] (key: K) => V | undefined;
export type KeyedSetter<K, V> = mutator[key] (key: K, value: V) => void invalidates get[key];

// === 6. Keyed stable/mutator on methods ===
export interface TypedMap<K, V> {
    stable[key] get(key: K): V | undefined;
    mutator[key] set(key: K, value: V): void invalidates get[key];
    mutator[key] delete(key: K): boolean invalidates get[key];
    mutator clear(): void;
}

// === 7. Mutator type reference wrapper ===
export interface Setter<T> {
    (value: T): void;
    (fn: (prev: T) => T): void;
}

export type WrappedSignal<T> = [get: Accessor<T>, set: mutator Setter<T> invalidates get];

// === 8. Class with stable/mutator methods ===
export class Container<T> {
    private _value: T;
    constructor(v: T) { this._value = v; }
    stable getValue(): T { return this._value; }
    mutator setValue(v: T): void invalidates getValue { this._value = v; }
}
