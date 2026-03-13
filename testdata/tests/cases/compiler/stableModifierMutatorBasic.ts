// @strict: true
// @noEmit: true

// Phase 5: Basic mutator keyword parsing and invalidation

// === Section 1: Basic mutator parsing ===
declare const store: {
    read: stable () => string | undefined;
    write: mutator (v: string) => void;
};

// Basic stable narrowing should still work
if (store.read() !== undefined) {
    const s: string = store.read(); // OK — narrowed
}

// === Section 2: Mutator call invalidates stable narrowing ===
if (store.read() !== undefined) {
    store.write("new");
    const afterWrite: string = store.read(); // should error — mutator invalidated narrowing
    afterWrite;
}

// === Section 3: Parameterless mutator works ===
declare const resetable: {
    value: stable () => string | undefined;
    reset: mutator () => void;
};

if (resetable.value() !== undefined) {
    resetable.reset();
    const afterReset: string = resetable.value(); // should error — mutator invalidated
    afterReset;
}

// === Section 4: Mutator validation — stable and mutator cannot combine ===
declare const bad: {
    conflict: stable mutator (v: string) => void; // should error — can't combine
};

// === Section 5: Cross-receiver mutator independence ===
declare const storeA: {
    read: stable () => string | undefined;
    reset: mutator () => void;
};
declare const storeB: {
    read: stable () => string | undefined;
    reset: mutator () => void;
};

if (storeA.read() !== undefined && storeB.read() !== undefined) {
    storeA.reset();
    const aAfterReset: string = storeA.read(); // should error — same receiver mutator
    const bAfterReset: string = storeB.read(); // OK — different receiver, unaffected
    aAfterReset;
    bAfterReset;
}
