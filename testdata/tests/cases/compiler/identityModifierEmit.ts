// @strict: true
// @target: esnext
// @declaration: true

type StringSignal = identity () => string | undefined;

interface Store {
    read: identity () => string | undefined;
    set: (value: string) => void;
}

declare const store: Store;
declare const read: StringSignal;

// Basic narrowing (verifies identity works without @noEmit)
if (read() !== undefined) {
    const narrowed: string = read();
}

if (store.read() !== undefined) {
    const narrowed: string = store.read();
}
