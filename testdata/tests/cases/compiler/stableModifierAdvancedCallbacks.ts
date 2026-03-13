// @strict: true
// @noEmit: true

// Phase 3: Expanded callback-alias parity family.
// Tests parametered callbacks, function keyword callbacks, async callbacks,
// and advanced callback patterns at stable boundaries.

declare const read: stable () => string | undefined;
declare function invoke(cb: () => void): void;
declare function invokeWithArg(cb: (x: number) => void): void;

// Parametered callback with empty body — should preserve narrowing.
// The callback takes a parameter but does nothing with it, so it can't mutate stable state.
if (read() !== undefined) {
    invokeWithArg((x: number) => {});
    const afterParamEmptyCallback: string = read(); // should stay narrowed
    afterParamEmptyCallback;
}

// Parametered callback with non-empty body — should error (conservative).
if (read() !== undefined) {
    invokeWithArg((x: number) => { console.log(x); });
    const afterParamNonEmptyCallback: string = read(); // should stay narrowed (unrelated standalone call)
    afterParamNonEmptyCallback;
}

// Function keyword callback (empty body) — should preserve narrowing.
if (read() !== undefined) {
    invoke(function myCallback() {});
    const afterFunctionKeywordEmpty: string = read(); // should stay narrowed
    afterFunctionKeywordEmpty;
}

// Function keyword callback (non-empty body) — should error (conservative).
if (read() !== undefined) {
    invoke(function myCallback() { console.log("side effect"); });
    const afterFunctionKeywordNonEmpty: string = read(); // should stay narrowed (unrelated standalone call)
    afterFunctionKeywordNonEmpty;
}

// Async callback (empty body) — should preserve narrowing.
if (read() !== undefined) {
    invoke(async () => {});
    const afterAsyncEmptyCallback: string = read(); // should stay narrowed
    afterAsyncEmptyCallback;
}

// Async callback (non-empty body) — should error (conservative).
if (read() !== undefined) {
    invoke(async () => { await Promise.resolve(); });
    const afterAsyncNonEmptyCallback: string = read(); // should stay narrowed (unrelated standalone call)
    afterAsyncNonEmptyCallback;
}

// Generator function callback — should error (conservative, can yield side effects).
declare function invokeGen(cb: () => Generator): void;
if (read() !== undefined) {
    invokeGen(function*() { yield 1; });
    const afterGeneratorCallback: string = read(); // should stay narrowed (unrelated standalone call)
    afterGeneratorCallback;
}

// Multiple parametered callbacks all empty — should preserve.
declare function invokeTwo(cb1: (a: string) => void, cb2: (b: number) => void): void;
if (read() !== undefined) {
    invokeTwo((a: string) => {}, (b: number) => {});
    const afterMultiParamEmpty: string = read(); // should stay narrowed
    afterMultiParamEmpty;
}

// Multiple parametered callbacks, one non-empty — should error.
if (read() !== undefined) {
    invokeTwo((a: string) => {}, (b: number) => { console.log(b); });
    const afterMultiParamOneNonEmpty: string = read(); // should stay narrowed (unrelated standalone call)
    afterMultiParamOneNonEmpty;
}

// Rest parameter callback (empty body) — should preserve.
declare function invokeRest(cb: (...args: any[]) => void): void;
if (read() !== undefined) {
    invokeRest((...args: any[]) => {});
    const afterRestParamEmpty: string = read(); // should stay narrowed
    afterRestParamEmpty;
}

// Optional parameter callback (empty body) — should preserve.
declare function invokeOpt(cb: (x?: number) => void): void;
if (read() !== undefined) {
    invokeOpt((x?: number) => {});
    const afterOptParamEmpty: string = read(); // should stay narrowed
    afterOptParamEmpty;
}
