// @strict: true
// @noEmit: true

// =============================================================================
// Signal-pattern test coverage for stable modifier CFA parity.
// Tests real-world signal patterns: destructuring, class members, typeof,
// non-null assertion, and Angular-style component signals.
// =============================================================================

// -----------------------------------------------------------------------------
// Section 1: Destructured stable signals (SolidJS-style)
// -----------------------------------------------------------------------------

// Signal-style tuple return
type ReadonlySignal<T> = stable () => T;
type WriteSignal<T> = (v: T) => void;
type Signal<T> = [ReadonlySignal<T>, WriteSignal<T>];

declare function createSignal<T>(initial: T): Signal<T>;

const [value, setValue] = createSignal<string | undefined>("hello");

// Narrowing after destructured stable call
if (value() !== undefined) {
    const s: string = value(); // should narrow to string
    s;

    // setValue is an independent variable, not linked in Phase 1.
    // Calling setValue should NOT invalidate stable narrowing on value.
    setValue(undefined);
    const afterWrite: string | undefined = value(); // conservative: narrowing may persist since setValue is independent
    afterWrite;
}

// Destructured signal — truthiness check
if (value()) {
    const truthy: string = value(); // should narrow to string (truthy)
    truthy;
}

// Destructured signal — ternary pattern
const ternary: string = value() !== undefined ? value() : "fallback";
ternary;

// -----------------------------------------------------------------------------
// Section 2: Class member stable patterns
// -----------------------------------------------------------------------------

// Class with stable property-style members (supported in Phase 1)
declare class ReactiveStore {
    user: stable () => { name: string } | undefined;
    count: stable () => number | null;
    setUser(v: { name: string } | undefined): void;
}

declare const store: ReactiveStore;

// Direct member call narrowing
if (store.user() !== undefined) {
    const name: string = store.user().name; // should narrow
    name;
}

if (store.count() !== null) {
    const n: number = store.count(); // should narrow
    n;
}

// Cross-member independence
if (store.user() !== undefined && store.count() !== null) {
    const name: string = store.user().name; // should still be narrowed
    const n: number = store.count(); // should still be narrowed
    name;
    n;
}

// Class member narrowing after unrelated method call
if (store.user() !== undefined) {
    store.setUser({ name: "new" }); // method call — transparent for getter parity
    const afterSet: { name: string } | undefined = store.user(); // expected: narrowing dropped
    afterSet;
}

// -----------------------------------------------------------------------------
// Section 3: typeof stable() patterns
// -----------------------------------------------------------------------------

declare const mixed: stable () => string | number;

if (typeof mixed() === "string") {
    const s: string = mixed(); // should narrow to string
    s;
}

if (typeof mixed() === "number") {
    const n: number = mixed(); // should narrow to number
    n;
}

// typeof with union including undefined
declare const mixedUndef: stable () => string | number | undefined;

if (typeof mixedUndef() === "string") {
    const s: string = mixedUndef(); // should narrow to string
    s;
}

if (typeof mixedUndef() === "undefined") {
    const u: undefined = mixedUndef(); // should narrow to undefined
    u;
}

// typeof combined with truthiness
if (typeof mixed() === "string" && mixed().length > 0) {
    const s: string = mixed(); // should narrow to string
    s;
}

// -----------------------------------------------------------------------------
// Section 4: Non-null assertion stable()! patterns
// -----------------------------------------------------------------------------

declare const maybe: stable () => string | undefined;

const definite = maybe()!; // should be string
const definiteLen = maybe()!.length; // should work

declare const maybeNum: stable () => number | null;

const definiteNum = maybeNum()!; // should be number
const definiteNumPlus = maybeNum()! + 1; // should work

// Non-null assertion after guard (redundant but should still work)
if (maybe() !== undefined) {
    const alsoDefinite = maybe()!; // should be string (already narrowed)
    alsoDefinite;
}

// -----------------------------------------------------------------------------
// Section 5: Angular-style component signal pattern
// -----------------------------------------------------------------------------

// Angular-style input signal type alias
type InputSignal<T> = stable () => T;

declare class MyComponent {
    name: InputSignal<string | undefined>;
    items: InputSignal<readonly string[]>;
}

declare const comp: MyComponent;

// Guard + repeated access (common in Angular templates translated to TS)
if (comp.name() !== undefined) {
    const greeting = `Hello ${comp.name()}`; // should narrow
    const upper = comp.name().toUpperCase(); // should narrow
    greeting;
    upper;
}

// Array stable — no narrowing needed, just type correctness
comp.items().forEach(item => {
    item.toUpperCase(); // should work — items() returns readonly string[]
});

// Array stable — length check
if (comp.items().length > 0) {
    const first = comp.items()[0]; // should work
    first;
}

// Multiple component signals with independent narrowing
declare class FormComponent {
    firstName: InputSignal<string | undefined>;
    lastName: InputSignal<string | undefined>;
    age: InputSignal<number | null>;
}

declare const form: FormComponent;

if (form.firstName() !== undefined && form.lastName() !== undefined) {
    const full = `${form.firstName()} ${form.lastName()}`; // both should narrow
    full;
}

if (form.age() !== null) {
    const nextYear = form.age() + 1; // should narrow to number
    nextYear;
}
