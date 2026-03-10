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
        // callback boundary
    });
    const afterCallback: string = identityRead(); // should error
    afterCallback;
}

// Await boundary parity: prior narrowing should invalidate.
declare function delay(): Promise<void>;

async function testAwaitParity() {
    if (identityRead() !== undefined) {
        await delay();
        const afterAwait: string = identityRead(); // should error
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
    const afterSetCall: string = store.read(); // should error
    afterSetCall;
}