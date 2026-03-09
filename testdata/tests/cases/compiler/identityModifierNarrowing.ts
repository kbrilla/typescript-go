// @strict: true
// @noEmit: true

// Basic identity function type narrowing
declare const value: identity () => string | undefined;

if (value() !== undefined) {
    value(); // should be narrowed to string
    console.log(value().toUpperCase()); // should work, no error
}

// Identity function with truthiness check
declare const flag: identity () => string | null;

if (flag()) {
    flag(); // should be narrowed to string (truthy)
    console.log(flag().length); // should work
}

// Identity function narrowing cleared in closures
declare const closureVal: identity () => string | undefined;

if (closureVal() !== undefined) {
    setTimeout(() => {
        closureVal(); // should be string | undefined (narrowing lost in closure)
    });
}

// Identity function with typeof narrowing
declare const mixed: identity () => string | number;

if (typeof mixed() === "string") {
    mixed(); // should be narrowed to string
    console.log(mixed().toUpperCase()); // should work
}

// Identity function with null check (Angular signals pattern)
declare function signal<T>(initial: T): identity () => T;

const count = signal(null as null | number);

if (count() !== null) {
    const total: number = count(); // should work, narrowed to number
}

// Generic identity function type
type Signal<T> = identity () => T;

declare const sig: Signal<string | undefined>;

if (sig() !== undefined) {
    sig(); // should be narrowed to string
}

// Multiple identity functions - independent narrowing
declare const a: identity () => string | undefined;
declare const b: identity () => number | undefined;

if (a() !== undefined && b() !== undefined) {
    a(); // should be string
    b(); // should be number
}
