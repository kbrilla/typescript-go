// @strict: true
// @noEmit: true

// Basic stable function type narrowing
declare const value: stable () => string | undefined;

if (value() !== undefined) {
    value(); // should be narrowed to string
    console.log(value().toUpperCase()); // should work, no error
}

// Identity function with truthiness check
declare const flag: stable () => string | null;

if (flag()) {
    flag(); // should be narrowed to string (truthy)
    console.log(flag().length); // should work
}

// Identity function narrowing cleared in closures
declare const closureVal: stable () => string | undefined;

if (closureVal() !== undefined) {
    setTimeout(() => {
        closureVal(); // should be string | undefined (narrowing lost in closure)
    });
}

// Generic stable function type alias
type Signal<T> = stable () => T;

declare const sig: Signal<string | undefined>;

if (sig() !== undefined) {
    sig(); // should be narrowed to string
}

// Multiple stable functions - independent narrowing
declare const a: stable () => string | undefined;
declare const b: stable () => number | undefined;

if (a() !== undefined && b() !== undefined) {
    a(); // should be string
    b(); // should be number
}
