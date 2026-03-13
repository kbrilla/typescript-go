// @strict: true
// @target: esnext
// @declaration: true

type StringSignal = stable () => string | undefined;

interface Store {
    read: stable () => string | undefined;
    set: (value: string) => void;
}

declare const store: Store;
declare const read: StringSignal;

// Basic narrowing (verifies stable works without @noEmit)
if (read() !== undefined) {
    const narrowed: string = read();
}

if (store.read() !== undefined) {
    const narrowed: string = store.read();
}
