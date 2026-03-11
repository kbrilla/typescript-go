//// [tests/cases/compiler/stableModifierLinkedPredicates.ts] ////

//// [stableModifierLinkedPredicates.ts]
// --- Section 1: Basic linked predicate ---
interface Resource<T> {
    value: stable () => T;
    hasValue(): this.value() is Exclude<T, undefined>;
}

declare const r: Resource<string | undefined>;
if (r.hasValue()) {
    const s: string = r.value();  // narrowed to string
}
const v: string | undefined = r.value();  // outside guard, full type

// --- Section 2: Multiple guards on same target ---
interface TypedReader {
    read: stable () => number | string | boolean;
    isNumber(): this.read() is number;
    isString(): this.read() is string;
}

declare const reader: TypedReader;
if (reader.isNumber()) {
    const n: number = reader.read();  // narrowed to number
}
if (reader.isString()) {
    const s: string = reader.read();  // narrowed to string
}

// --- Section 3: Guard + mutator invalidation ---
interface WritableOption<T> {
    get: stable () => T | undefined;
    isDefined(): this.get() is T;
    set: mutator (v: T | undefined) => void invalidates get;
}

declare const opt: WritableOption<number>;
if (opt.isDefined()) {
    const n1: number = opt.get();  // narrowed by linked predicate
    opt.set(undefined);
    const n2: number | undefined = opt.get();  // back to full type after mutator
}

// --- Section 4: Different receivers (no cross-narrowing) ---
declare const r1: Resource<string | undefined>;
declare const r2: Resource<string | undefined>;
if (r1.hasValue()) {
    const s1: string = r1.value();  // narrowed
    const s2: string | undefined = r2.value();  // NOT narrowed - different receiver
}

// --- Section 5: Guard + uncertainty boundary ---
declare const r3: Resource<string | undefined>;
declare function unknownCall(): void;
if (r3.hasValue()) {
    const before: string = r3.value();  // narrowed
    unknownCall();
    const after: string | undefined = r3.value();  // narrowing lost
}

// --- Section 6: Optional container pattern ---
interface Maybe<T> {
    get: stable () => T | undefined;
    isDefined(): this.get() is T;
    isEmpty(): this.get() is undefined;
}

declare const maybe: Maybe<number>;
if (maybe.isDefined()) {
    const n: number = maybe.get();  // narrowed to number
}
if (maybe.isEmpty()) {
    const u: undefined = maybe.get();  // narrowed to undefined
}

// --- Section 7: Guard is not stable itself (rule 2) ---
interface Container<T> {
    value: stable () => T | null;
    hasValue(): this.value() is T;
}

declare const c: Container<string>;
if (c.hasValue()) {
    const s: string = c.value();  // narrowed
}

// --- Section 8: Negative - target not stable ---
interface BadTarget {
    value(): string | undefined;  // NOT stable (method signature, not stable function type)
    hasValue(): this.value() is string;  // should error: target must be stable
}

// --- Section 9: Negative - narrowed type not assignable ---
interface BadNarrowing {
    get: stable () => number | string;
    check(): this.get() is boolean;  // should error: boolean not assignable to number | string
}

// --- Section 10: Guard method called but result not used in condition ---
declare const r4: Resource<string | undefined>;
r4.hasValue();  // called but not in a condition - no narrowing effect
const v4: string | undefined = r4.value();  // full type, no narrowing


//// [stableModifierLinkedPredicates.js]
"use strict";
if (r.hasValue()) {
    const s = r.value(); // narrowed to string
}
const v = r.value(); // outside guard, full type
if (reader.isNumber()) {
    const n = reader.read(); // narrowed to number
}
if (reader.isString()) {
    const s = reader.read(); // narrowed to string
}
if (opt.isDefined()) {
    const n1 = opt.get(); // narrowed by linked predicate
    opt.set(undefined);
    const n2 = opt.get(); // back to full type after mutator
}
if (r1.hasValue()) {
    const s1 = r1.value(); // narrowed
    const s2 = r2.value(); // NOT narrowed - different receiver
}
if (r3.hasValue()) {
    const before = r3.value(); // narrowed
    unknownCall();
    const after = r3.value(); // narrowing lost
}
if (maybe.isDefined()) {
    const n = maybe.get(); // narrowed to number
}
if (maybe.isEmpty()) {
    const u = maybe.get(); // narrowed to undefined
}
if (c.hasValue()) {
    const s = c.value(); // narrowed
}
r4.hasValue(); // called but not in a condition - no narrowing effect
const v4 = r4.value(); // full type, no narrowing
