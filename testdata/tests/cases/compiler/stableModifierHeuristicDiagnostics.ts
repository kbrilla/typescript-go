// @strict: true
// @noEmit: true

declare const read: stable () => string | undefined;
declare function unknownMutate(): void;
declare function unknownMutateWithArg(x: number): void;
declare function invoke(cb: () => void): void;
declare function delay(): Promise<void>;

if (read() !== undefined) {
    unknownMutateWithArg(1);
    const afterUnknown: string = read(); // should error + unknown-call-specific diagnostic
    afterUnknown;
}

if (read() !== undefined) {
    unknownMutateWithArg(1);
    const afterUnknownFirst: string = read(); // should error + one boundary diagnostic on unknown call
    const afterUnknownSecond: string = read(); // should error, no duplicate boundary diagnostic spam
    afterUnknownFirst;
    afterUnknownSecond;
}

if (read() !== undefined) {
    invoke(() => {
        const callbackWrite = 1;
        callbackWrite;
    });
    const afterCallback: string = read(); // should error + generic uncertainty-boundary diagnostic
    afterCallback;
}

if (read() !== undefined) {
    const escaped = read;
    escaped;
    const afterAliasEscape: string = read(); // direct const alias should preserve narrowing
    afterAliasEscape;
}

async function testAwaitBoundary() {
    if (read() !== undefined) {
        await delay();
        const afterAwait: string = read(); // OK (ambient no-arg await preserves narrowing)
        afterAwait;
    }
}
