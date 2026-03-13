// @strict: true
// @noEmit: true

// Phase 5: Mutator with invalidates clause — selective invalidation

// === Section 1: Single-endpoint invalidates ===
declare const userStore: {
    user: stable () => { name: string } | undefined;
    settings: stable () => { theme: string } | undefined;
    setUser: mutator (v: { name: string } | undefined) => void invalidates user;
};

// setUser invalidates to user — should invalidate user() but NOT settings()
if (userStore.user() !== undefined && userStore.settings() !== undefined) {
    userStore.setUser({ name: "new" });
    const u: { name: string } = userStore.user(); // should error — user() invalidated by setUser
    const s: { theme: string } = userStore.settings(); // OK — settings() NOT linked, still narrowed
}

// === Section 2: Multi-endpoint invalidates ===
declare const multiStore: {
    a: stable () => string | undefined;
    b: stable () => number | undefined;
    resetAll: mutator () => void invalidates a, b;
};

if (multiStore.a() !== undefined && multiStore.b() !== undefined) {
    multiStore.resetAll();
    const afterA: string = multiStore.a();   // should error — a() invalidated
    const afterB: number = multiStore.b();   // should error — b() invalidated
}

// === Section 3: Mutator without invalidates on multi-endpoint = conservative ===
declare const ambiguousStore: {
    x: stable () => string | undefined;
    y: stable () => number | undefined;
    doSomething: mutator (v: number) => void; // no invalidates clause
};

if (ambiguousStore.x() !== undefined && ambiguousStore.y() !== undefined) {
    ambiguousStore.doSomething(42);
    const afterX: string = ambiguousStore.x(); // should error — conservatively dropped
    const afterY: number = ambiguousStore.y(); // should error — conservatively dropped
}

// === Section 4: Mutator on single-endpoint = no ambiguity ===
declare const singleStore: {
    value: stable () => string | undefined;
    setValue: mutator (v: string | undefined) => void; // no invalidates, but only one stable endpoint
};

if (singleStore.value() !== undefined) {
    singleStore.setValue("new");
    const after: string = singleStore.value(); // should error — mutator invalidated
}

// === Section 5: Selective invalidation — unlinked endpoint preserved ===
declare const selectiveStore: {
    x: stable () => string | undefined;
    y: stable () => number | undefined;
    setX: mutator (v: string | undefined) => void invalidates x;
};

if (selectiveStore.x() !== undefined && selectiveStore.y() !== undefined) {
    selectiveStore.setX(undefined);
    const afterX: string = selectiveStore.x(); // should error — x() is linked
    const afterY: number = selectiveStore.y(); // OK — y() is NOT linked, preserved
}
