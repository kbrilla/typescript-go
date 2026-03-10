// @strict: true
// @noEmit: true

// Error: identity modifier on function type with parameters
declare const badWithParams: identity (x: string) => string;

// Error: duplicate identity modifier
declare const badDuplicate: identity identity () => string;

// Error: identity modifier cannot appear on constructor type
declare const badConstructor: identity new () => object;

// Valid: identity on parameterless function type
declare const good: identity () => string | undefined;
