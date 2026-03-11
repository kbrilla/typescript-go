//// [tests/cases/compiler/identityModifierEmit.ts] ////

//// [identityModifierEmit.ts]
type StringSignal = identity () => string | undefined;

interface Store {
    read: identity () => string | undefined;
    set: (value: string) => void;
}

declare const store: Store;
declare const read: StringSignal;

// Basic narrowing (verifies identity works without @noEmit)
if (read() !== undefined) {
    const narrowed: string = read();
}

if (store.read() !== undefined) {
    const narrowed: string = store.read();
}


//// [identityModifierEmit.js]
"use strict";
// Basic narrowing (verifies identity works without @noEmit)
if (read() !== undefined) {
    const narrowed = read();
}
if (store.read() !== undefined) {
    const narrowed = store.read();
}


//// [identityModifierEmit.d.ts]
type StringSignal = identity () => string | undefined;
interface Store {
    read: identity () => string | undefined;
    set: (value: string) => void;
}
declare const store: Store;
declare const read: StringSignal;
