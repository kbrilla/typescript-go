// @strict: true
// @noEmit: true

declare const read: identity () => string | undefined;
declare function unknownMutate(): void;
declare function invoke(cb: () => void): void;
declare function delay(): Promise<void>;

if (read() !== undefined) {
    unknownMutate();
    const afterUnknown: string = read(); // should error + heuristic-limit diagnostic
    afterUnknown;
}

if (read() !== undefined) {
    invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    const afterCallback: string = read(); // should error + heuristic-limit diagnostic
    afterCallback;
}

if (read() !== undefined) {
    const escaped = read;
    escaped;
    const afterAliasEscape: string = read(); // should error + heuristic-limit diagnostic
    afterAliasEscape;
}

async function testAwaitBoundary() {
    if (read() !== undefined) {
        await delay();
        const afterAwait: string = read(); // should error + heuristic-limit diagnostic
        afterAwait;
    }
}
