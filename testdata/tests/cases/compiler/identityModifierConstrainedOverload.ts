// @strict: true
// @noEmit: true

// Phase 5: Constrained-overload post-call narrowing
// When a mutator has <U extends T> and overload resolution selects it,
// the linked identity endpoint narrows to U after the call.
// NOTE: This is a future enhancement. For now, mutator calls invalidate
// (widen back to declared type), which is correct conservative behavior.

// === Section 1: Mutator with constrained generic ===
declare const sig: {
    read: identity () => string | undefined;
    update: mutator <U extends string | undefined>(fn: (value: string | undefined) => U) => void links read;
};

// After update, narrowing is invalidated (future: could narrow to U)
sig.update(() => "hello");
const afterUpdate = sig.read(); // string | undefined — conservative (future: could narrow to string)

// === Section 2: Reset mutator = no narrowing ===
declare const sig2: {
    read: identity () => string | undefined;
    reset: mutator () => void links read;
};

if (sig2.read() !== undefined) {
    sig2.reset();
    const afterReset: string = sig2.read(); // should error — reset invalidated
}

// === Section 3: WritableSignal pattern ===
interface WritableSignal<T> {
    read: identity () => T;
    set: mutator (value: T) => void links read;
    update: mutator <U extends T>(fn: (value: T) => U) => void links read;
}

declare const ws: WritableSignal<string | undefined>;

if (ws.read() !== undefined) {
    const narrowed: string = ws.read(); // OK — narrowed
    ws.set(undefined);
    const afterSet: string = ws.read(); // should error — set invalidated
}
