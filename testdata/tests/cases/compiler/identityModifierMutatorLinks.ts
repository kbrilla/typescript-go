// @strict: true
// @noEmit: true

// Phase 5: Mutator with links clause — selective invalidation

// === Section 1: Single-endpoint links ===
declare const userStore: {
    user: identity () => { name: string } | undefined;
    settings: identity () => { theme: string } | undefined;
    setUser: mutator (v: { name: string } | undefined) => void links user;
};

// setUser links to user — should invalidate user() but NOT settings()
if (userStore.user() !== undefined && userStore.settings() !== undefined) {
    userStore.setUser({ name: "new" });
    const u: { name: string } = userStore.user(); // should error — user() invalidated by setUser
    const s: { theme: string } = userStore.settings(); // OK — settings() NOT linked, still narrowed
}

// === Section 2: Multi-endpoint links ===
declare const multiStore: {
    a: identity () => string | undefined;
    b: identity () => number | undefined;
    resetAll: mutator () => void links a, b;
};

if (multiStore.a() !== undefined && multiStore.b() !== undefined) {
    multiStore.resetAll();
    const afterA: string = multiStore.a();   // should error — a() invalidated
    const afterB: number = multiStore.b();   // should error — b() invalidated
}

// === Section 3: Mutator without links on multi-endpoint = conservative ===
declare const ambiguousStore: {
    x: identity () => string | undefined;
    y: identity () => number | undefined;
    doSomething: mutator (v: number) => void; // no links clause
};

if (ambiguousStore.x() !== undefined && ambiguousStore.y() !== undefined) {
    ambiguousStore.doSomething(42);
    const afterX: string = ambiguousStore.x(); // should error — conservatively dropped
    const afterY: number = ambiguousStore.y(); // should error — conservatively dropped
}

// === Section 4: Mutator on single-endpoint = no ambiguity ===
declare const singleStore: {
    value: identity () => string | undefined;
    setValue: mutator (v: string | undefined) => void; // no links, but only one identity endpoint
};

if (singleStore.value() !== undefined) {
    singleStore.setValue("new");
    const after: string = singleStore.value(); // should error — mutator invalidated
}

// === Section 5: Selective invalidation — unlinked endpoint preserved ===
declare const selectiveStore: {
    x: identity () => string | undefined;
    y: identity () => number | undefined;
    setX: mutator (v: string | undefined) => void links x;
};

if (selectiveStore.x() !== undefined && selectiveStore.y() !== undefined) {
    selectiveStore.setX(undefined);
    const afterX: string = selectiveStore.x(); // should error — x() is linked
    const afterY: number = selectiveStore.y(); // OK — y() is NOT linked, preserved
}
