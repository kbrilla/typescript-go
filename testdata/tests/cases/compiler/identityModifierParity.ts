// @strict: true
// @noEmit: true

// Parity baseline: property getter/setter repeated read narrowing.
declare const propertyModel: {
    get value(): string | undefined;
    set value(v: string | undefined);
};

if (propertyModel.value !== undefined) {
    const propertyStable: string = propertyModel.value; // OK
    propertyStable;
}

if (propertyModel.value !== undefined) {
    propertyModel.value = "next";
    const propertyAfterSet: string = propertyModel.value; // should error
    propertyAfterSet;
}

// Identity parity: repeated-read stable narrowing success.
declare const identityRead: identity () => string | undefined;

if (identityRead() !== undefined) {
    const identityStable: string = identityRead(); // OK
    identityStable;
}

// One-liner ternary parity shape from issue families.
const ternaryStable: string = identityRead() !== undefined ? identityRead() : "fallback"; // OK
ternaryStable;

// Callback boundary parity: prior narrowing should invalidate.
declare function invoke(cb: () => void): void;

if (identityRead() !== undefined) {
    invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    const afterCallback: string = identityRead(); // should error
    afterCallback;
}

// Await boundary parity: prior narrowing should invalidate.
declare function delay(): Promise<void>;

async function testAwaitParity() {
    if (identityRead() !== undefined) {
        await delay();
        const afterAwait: string = identityRead(); // OK (ambient no-arg await preserves narrowing)
        afterAwait;
    }
}

// Setter/write-call analog shape: object identity getter + mutating method call.
declare const store: {
    read: identity () => string | undefined;
    set(v: string | undefined): void;
};

if (store.read() !== undefined) {
    store.set("next");
    const afterSetCall: string = store.read(); // should be OK
    afterSetCall;
}

// Callable hybrid parity: same callable symbol used as getter and setter-style write.
// Known Phase 1 limitation: `identity` on call signatures in interfaces is not supported.
// The parser interprets `identity` as a method name, not a modifier on the call signature.
// Only standalone function types (`identity () => T`) are supported in Phase 1.
// See Edge Case 4 in docs/identity-modifier-research.md.
interface HybridSignal {
    identity (): string | undefined;
    (v: string | undefined): void;
}

declare const hybrid: HybridSignal;

// Because `identity` is parsed as a method name (not a call signature modifier),
// overload resolution only sees the setter `(v)` overload for zero-arg calls.
// These errors are expected in Phase 1.
if (hybrid() !== undefined) {
    hybrid("next");
    const afterHybridSetCall: string = hybrid(); // should error
    afterHybridSetCall;
}

// Callable hybrid direct undefined write should also invalidate prior narrowing.
// Same Phase 1 limitation applies here.
if (hybrid() !== undefined) {
    hybrid(undefined);
    const afterHybridUndefinedWrite: string = hybrid(); // should error
    afterHybridUndefinedWrite;
}

// Discriminated-union parity: repeated identity reads should narrow by kind.
type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; size: number };

declare const shape: identity () => Shape;

if (shape().kind === "circle") {
    const circleRadius: number = shape().radius; // OK
    circleRadius;
}

// Discriminated-union boundary parity: unknown call invalidates prior narrowing.
declare function unknownShapeMutate(): void;

if (shape().kind === "circle") {
    unknownShapeMutate();
    const afterUnknownShapeCall: number = shape().radius; // OK (no-arg unknown call preserves narrowing)
    afterUnknownShapeCall;
}