// @strict: true
// @noEmit: true

declare const read: identity () => string | undefined;

if (read() !== undefined) {
    const stable: string = read(); // OK
}

declare function unknownMutate(): void;
declare function unknownMutateWithArg(x: number): void;
declare function pass<T>(x: T): T;

declare function invoke(cb: () => void): void;
declare function delay(): Promise<void>;

if (read() !== undefined) {
    unknownMutate();
    const afterUnknownCall: string = read(); // preserved by ambient no-arg unknown-call rule
}

if (read() !== undefined) {
    unknownMutateWithArg(1);
    const afterUnknownCallWithArg: string = read(); // should error
}

if (read() !== undefined) {
    invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    const afterCallbackCall: string = read(); // should error
}

if (read() !== undefined) {
    const result = invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    result;
    const afterAssignedCallbackCall: string = read(); // should error
}

let assignedCallbackResult: void;
if (read() !== undefined) {
    assignedCallbackResult = invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    assignedCallbackResult;
    const afterAssignmentExpressionCallbackCall: string = read(); // should error
}

if (read() !== undefined) {
    const indirectCallbackResult = invoke(pass(() => {
        const callbackWrite = 1;
        callbackWrite;
    }));
    indirectCallbackResult;
    const afterIndirectCallbackCall: string = read(); // should error
}

if (read() !== undefined) {
    const conditionalCallbackResult = true
        ? invoke(() => {
            const callbackWrite = 1;
            callbackWrite;
        })
        : invoke(() => {
            const callbackWrite = 1;
            callbackWrite;
        });
    conditionalCallbackResult;
    const afterConditionalCallbackCall: string = read(); // should error
}

if (read() !== undefined) {
    const noopCallback = () => {};
    invoke(noopCallback);
    const afterConstNoopCallbackAlias: string = read(); // should be preserved under strict alias guard
}

if (read() !== undefined) {
    const noopCallback = () => {};
    const assignedNoopCallbackResult = invoke(noopCallback);
    assignedNoopCallbackResult;
    const afterAssignedConstNoopCallbackAlias: string = read(); // should be preserved under strict alias guard
}

let assignedNoopCallbackResult: void;
if (read() !== undefined) {
    const noopCallback = () => {};
    assignedNoopCallbackResult = invoke(noopCallback);
    assignedNoopCallbackResult;
    const afterAssignmentExprConstNoopCallbackAlias: string = read(); // should be preserved under strict alias guard
}

if (read() !== undefined) {
    let mutableNoopCallback = () => {};
    mutableNoopCallback = () => {
        const callbackWrite = 1;
        callbackWrite;
    };
    invoke(mutableNoopCallback);
    const afterMutableNoopCallbackAlias: string = read(); // should error
}

if (read() !== undefined) {
    const nonEmptyCallback = () => {
        const callbackWrite = 1;
        callbackWrite;
    };
    invoke(nonEmptyCallback);
    const afterNonEmptyCallbackAlias: string = read(); // should error
}

if (read() !== undefined) {
    const escapedRead = read;
    const afterAliasEscape: string = read(); // direct const alias should preserve narrowing
    escapedRead;
}

if (read() !== undefined) {
    const indirect = pass(read);
    indirect;
    const afterIndirectAliasEscape: string = read(); // should error
}


let reassignedRead: () => string | undefined;

if (read() !== undefined) {
    reassignedRead = read;
    const afterReassignmentEscape: string = read(); // should error
    reassignedRead;
}

async function testAwaitBoundary() {
    if (read() !== undefined) {
        await delay();
        const afterAwait: string = read(); // OK (ambient no-arg await preserves narrowing)
    }
}

async function testAwaitAssignmentBoundary() {
    if (read() !== undefined) {
        const x = await delay();
        x;
        const afterAwaitAssignment: string = read(); // should error
    }
}
