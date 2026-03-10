// @strict: true
// @noEmit: true

// Error: identity modifier on function with parameters
declare const fn1: identity (x: string) => number; // should error

// Valid: identity modifier on parameterless function type
declare const fn3: identity () => string | undefined; // OK

// Identity modifier in a type alias
type Getter<T> = identity () => T; // OK

// Using 'identity' as a variable name should still work (contextual keyword)
const identity = <T>(x: T): T => x; // OK - 'identity' used as identifier
const result = identity("hello");
