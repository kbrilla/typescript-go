// @strict: true
// @noEmit: true

// P3: Post-call narrowing — mutator sets narrow the stable type

// === Setup: Signal with stable read / mutator set ===
interface Signal<T> {
    read: stable () => T;
    set: mutator (value: T) => void;
}

// === 1. Basic post-call narrowing: set(42) narrows to number ===
declare const count: Signal<number | undefined>;
count.set(42);
const n1: number = count.read();  // Should narrow to number after set(42)

// === 2. Set to string narrows to string ===
declare const mixed: Signal<string | number | undefined>;
mixed.set("hello");
const s1: string = mixed.read();  // Should narrow to string

// === 3. Set to undefined doesn't narrow further ===
declare const opt: Signal<string | undefined>;
opt.set(undefined);
const u1: string | undefined = opt.read();  // Remains string | undefined

// === 4. Sequential sets — each narrows to its argument ===
declare const seq: Signal<string | number | undefined>;
seq.set(100);
const v1: number = seq.read();  // Should narrow to number
seq.set("world");
const v2: string = seq.read();  // Should narrow to string

// === 5. Cross-receiver independence ===
declare const a: Signal<string | undefined>;
declare const b: Signal<string | undefined>;
if (b.read() !== undefined) {
    a.set("changed");
    const bVal: string = b.read();  // Still narrowed — b not affected by a.set()
}

// === 6. Set with literal type ===
declare const lit: Signal<"a" | "b" | "c">;
lit.set("a");
const l1: "a" = lit.read();  // Should narrow to "a"

// === 7. Guard then set overwrites narrowing ===
declare const guarded: Signal<number | null>;
if (guarded.read() !== null) {
    guarded.set(null);
    const g1: number | null = guarded.read();  // Set(null) narrows to null, but null is assignable to number|null
}

// === 8. Set with wider variable — no narrowing improvement ===
declare const dynSig: Signal<string | undefined>;
declare const someVal: string | undefined;
dynSig.set(someVal);
const d1: string | undefined = dynSig.read();  // someVal is string|undefined, no improvement

// === 9. Set with narrowed variable ===
declare const narrowedSig: Signal<string | number | undefined>;
const val: string = "hello";
narrowedSig.set(val);
const ns1: string = narrowedSig.read();  // val is string, narrows to string

// === 10. Post-call narrowing with named invalidates targets ===
declare const store: {
    user: stable () => string | undefined;
    settings: stable () => { theme: string } | undefined;
    setUser: mutator (value: string | undefined) => void invalidates user;
    setSettings: mutator (value: { theme: string } | undefined) => void invalidates settings;
};

if (store.user() !== undefined && store.settings() !== undefined) {
    store.setUser("Alice");
    const u: string = store.user();  // Narrowed to string (typeof "Alice") — post-call narrowing
    const s: { theme: string } = store.settings();  // Still narrowed from guard (not invalidated by setUser)
}

// === 11. Set(undefined) after guard resets to narrower type ===
declare const resetSig: Signal<string | number | undefined>;
resetSig.set(undefined);
const rs1: string | number | undefined = resetSig.read();  // set(undefined) narrows to undefined, but undefined is in the union

// === 12. Multiple sets in sequence ===
declare const multi: Signal<string | number | undefined>;
multi.set(42);
const m1: number = multi.read();  // number
multi.set("hello");
const m2: string = multi.read();  // string
multi.set(undefined);
const m3: string | number | undefined = multi.read();  // reset to full type
