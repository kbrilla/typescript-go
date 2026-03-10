// @strict: true
// @noEmit: true

// Getter-to-identity parity sweep.
// Categories: repeated reads, branch merges, callback/await boundaries,
// write invalidation, aliasing, conditional/ternary, nested access.

declare function invoke(cb: () => void): void;
declare function delay(): Promise<void>;
declare function unknownMutate(): void;
declare function pass<T>(x: T): T;

// -----------------------------------------------------------------------------
// [P1] Basic repeated reads
// -----------------------------------------------------------------------------

declare const getterBasic: {
    get value(): string | undefined;
    set value(v: string | undefined);
};

declare const identityBasic: identity () => string | undefined;

if (getterBasic.value !== undefined) {
    const getterStable: string = getterBasic.value; // getter baseline: OK
    getterStable;
}

if (identityBasic() !== undefined) {
    const identityStable: string = identityBasic(); // identity parity target: OK
    identityStable;
}

// -----------------------------------------------------------------------------
// [P2] Branch merges
// -----------------------------------------------------------------------------

if (getterBasic.value !== undefined) {
    getterBasic.value;
} else {
    getterBasic.value;
}
const getterMerged: string = getterBasic.value; // getter baseline: error
getterMerged;

if (identityBasic() !== undefined) {
    identityBasic();
} else {
    identityBasic();
}
const identityMerged: string = identityBasic(); // identity parity target: error
identityMerged;

// -----------------------------------------------------------------------------
// [P3] Callback boundary invalidation
// -----------------------------------------------------------------------------

if (getterBasic.value !== undefined) {
    invoke(() => {});
    const getterAfterCallback: string = getterBasic.value; // getter observed: remains narrowed
    getterAfterCallback;
}

if (identityBasic() !== undefined) {
    invoke(() => {});
    const identityAfterCallback: string = identityBasic(); // identity observed: error (conservative boundary)
    identityAfterCallback;
}

if (identityBasic() !== undefined) {
    invoke(() => {});
    const identityAfterNoopCallback: string = identityBasic(); // parity target: OK for narrow no-op callback shape
    identityAfterNoopCallback;
}

// -----------------------------------------------------------------------------
// [P4] Await boundary invalidation
// -----------------------------------------------------------------------------

async function parityAwaitBoundaries() {
    if (getterBasic.value !== undefined) {
        await delay();
        const getterAfterAwait: string = getterBasic.value; // getter observed: remains narrowed
        getterAfterAwait;
    }

    if (identityBasic() !== undefined) {
        await delay();
        const identityAfterAwait: string = identityBasic(); // identity observed: error (conservative boundary)
        identityAfterAwait;
    }

    if (identityBasic() !== undefined) {
        await Promise.resolve();
        const identityAfterSafeAwait: string = identityBasic(); // parity target: OK for narrow safe await shape
        identityAfterSafeAwait;
    }
}

// -----------------------------------------------------------------------------
// [P5] Write invalidation
// -----------------------------------------------------------------------------

if (getterBasic.value !== undefined) {
    getterBasic.value = "next";
    const getterAfterWrite: string = getterBasic.value; // getter observed: remains narrowed
    getterAfterWrite;
}

declare const identityStore: {
    read: identity () => string | undefined;
    set(v: string | undefined): void;
};

if (identityStore.read() !== undefined) {
    identityStore.set("next");
    const identityAfterWrite: string = identityStore.read(); // identity parity target: OK
    identityAfterWrite;
}

// -----------------------------------------------------------------------------
// [P6] Aliasing / escape
// -----------------------------------------------------------------------------

if (getterBasic.value !== undefined) {
    const getterAlias = getterBasic;
    getterAlias;
    const getterAfterAlias: string = getterBasic.value; // getter baseline target: OK
    getterAfterAlias;
}

if (identityBasic() !== undefined) {
    const identityAlias = identityBasic;
    identityAlias;
    const identityAfterAlias: string = identityBasic(); // identity parity target: OK for direct const alias
    identityAfterAlias;
}

if (identityBasic() !== undefined) {
    const identityIndirectAlias = pass(identityBasic);
    identityIndirectAlias;
    const identityAfterIndirectAlias: string = identityBasic(); // identity observed: error (indirect alias escape)
    identityAfterIndirectAlias;
}

// -----------------------------------------------------------------------------
// [P7] Conditional/ternary
// -----------------------------------------------------------------------------

const getterTernary: string = getterBasic.value !== undefined ? getterBasic.value : "fallback"; // getter baseline: OK
getterTernary;

const identityTernary: string = identityBasic() !== undefined ? identityBasic() : "fallback"; // identity parity target: OK
identityTernary;

// -----------------------------------------------------------------------------
// [P8] Nested access (discriminated union)
// -----------------------------------------------------------------------------

type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; size: number };

declare const getterNested: {
    get value(): Shape;
    set value(v: Shape);
};

declare const identityNested: identity () => Shape;

if (getterNested.value.kind === "circle") {
    const getterRadius: number = getterNested.value.radius; // getter baseline: OK
    getterRadius;
}

if (identityNested().kind === "circle") {
    const identityRadius: number = identityNested().radius; // identity parity target: OK
    identityRadius;
}

if (getterNested.value.kind === "circle") {
    unknownMutate();
    const getterAfterUnknown: number = getterNested.value.radius; // getter observed: remains narrowed
    getterAfterUnknown;
}

if (identityNested().kind === "circle") {
    unknownMutate();
    const identityAfterUnknown: number = identityNested().radius; // parity target: OK for guarded ambient no-arg unknown-call shape
    identityAfterUnknown;
}
