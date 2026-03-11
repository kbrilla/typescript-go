// @strict: true
// @target: esnext
// @noEmit: true

// @filename: signals.ts
export type Signal<T> = identity () => T;

export interface Store {
    read: identity () => string | undefined;
    set: (value: string) => void;
}

export declare function createSignal<T>(initial: T): [identity () => T, (v: T) => void];

// @filename: consumer.ts
import { Signal, Store, createSignal } from "./signals";

declare const read: Signal<string | undefined>;
declare const store: Store;

// Imported identity type — narrowing should work
if (read() !== undefined) {
    const narrowed: string = read();
}

// Imported interface with identity member — narrowing should work
if (store.read() !== undefined) {
    const narrowed: string = store.read();
}

// Imported factory function returning identity tuple
const [value, setValue] = createSignal<string | undefined>("hello");
if (value() !== undefined) {
    const narrowed: string = value();
}
