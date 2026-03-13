// @strict: true
// @noEmit: true

// Phase 5: Mutator validation diagnostics and error cases

// === Section 1: mutator and stable cannot combine ===
type BadCombo1 = stable mutator (v: string) => void; // error: can't combine
type BadCombo2 = mutator stable () => void; // error: can't combine

// === Section 2: Valid mutator declarations ===
type GoodMutator1 = mutator (v: string) => void;
type GoodMutator2 = mutator (a: number, b: string) => void;
type GoodMutator3 = mutator <T>(v: T) => void;
type GoodMutator4 = mutator () => void; // valid — parameterless mutator like reset()

// === Section 3: mutator in generic position ===
interface Container<T> {
    read: stable () => T;
    write: mutator (v: T) => void invalidates read;
}

declare function createContainer<T>(initial: T): Container<T>;
const c = createContainer<string | undefined>("hello");
if (c.read() !== undefined) {
    const val: string = c.read(); // OK — narrowed
    c.write(undefined);
    const afterWrite: string = c.read(); // should error — mutator invalidated
}
