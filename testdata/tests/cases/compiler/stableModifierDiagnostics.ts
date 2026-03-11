// @strict: true
// @noEmit: true

// Error: stable modifier on function type with parameters
declare const badWithParams: stable (x: string) => string;

// Error: duplicate stable modifier
declare const badDuplicate: stable stable () => string;

// Error: stable modifier cannot appear on constructor type
declare const badConstructor: stable new () => object;

// Valid: stable on parameterless function type
declare const good: stable () => string | undefined;
