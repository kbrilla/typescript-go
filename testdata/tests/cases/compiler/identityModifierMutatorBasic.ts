// @strict: true
// @noEmit: true

// Phase 5: Basic mutator keyword parsing and invalidation

// === Section 1: Basic mutator parsing ===
declare const store: {
    read: identity () => string | undefined;
    write: mutator (v: string) => void;
};

// Basic identity narrowing should still work
if (store.read() !== undefined) {
    const s: string = store.read(); // OK — narrowed
}

// === Section 2: Mutator call invalidates identity narrowing ===
if (store.read() !== undefined) {
    store.write("new");
    const afterWrite: string = store.read(); // should error — mutator invalidated narrowing
    afterWrite;
}

// === Section 3: Parameterless mutator works ===
declare const resetable: {
    value: identity () => string | undefined;
    reset: mutator () => void;
};

if (resetable.value() !== undefined) {
    resetable.reset();
    const afterReset: string = resetable.value(); // should error — mutator invalidated
    afterReset;
}

// === Section 4: Mutator validation — identity and mutator cannot combine ===
declare const bad: {
    conflict: identity mutator (v: string) => void; // should error — can't combine
};
