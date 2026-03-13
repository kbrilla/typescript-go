// @strict: true
// @noEmit: true

// Error: stable modifier on function with parameters
declare const fn1: stable (x: string) => number; // should error

// Valid: stable modifier on parameterless function type
declare const fn3: stable () => string | undefined; // OK

// Identity modifier in a type alias
type Getter<T> = stable () => T; // OK

// Using 'stable' as a variable name should still work (contextual keyword)
const stable = <T>(x: T): T => x; // OK - 'stable' used as identifier
const result = stable("hello");
