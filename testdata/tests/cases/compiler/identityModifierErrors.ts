// @strict: true
// @noEmit: true

// Error: identity modifier on function with parameters
declare const fn1: identity (x: string) => number;  // should error

// Error: identity modifier already seen
declare const fn2: identity identity () => string;  // should error

// Valid: identity modifier on parameterless function type
declare const fn3: identity () => string | undefined;  // OK

// Using 'identity' as a variable name should still work (contextual keyword)
const identity = <T>(x: T): T => x;  // OK - 'identity' used as identifier
const result = identity("hello");

// Identity modifier in a type alias
type Getter<T> = identity () => T;  // OK
