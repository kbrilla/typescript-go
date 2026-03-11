// @strict: true
// @noEmit: true

type Signal<T> = identity () => T;

// === Section 1: Assertion function narrowing ===
declare function assertDefined<T>(value: T): asserts value is NonNullable<T>;

declare const maybeStr: Signal<string | undefined>;

if (true) {
    assertDefined(maybeStr());
    const s: string = maybeStr(); // Should be narrowed after assertion
}

// === Section 2: Type predicate narrowing ===
declare function isString(value: unknown): value is string;

declare const unknown: Signal<string | number>;

if (isString(unknown())) {
    const s: string = unknown(); // Should be narrowed by type predicate
}

// === Section 3: Custom assertion with identity ===
declare function assertNotNull<T>(value: T | null): asserts value is T;

declare const maybeNull: Signal<string | null>;

if (true) {
    assertNotNull(maybeNull());
    const s: string = maybeNull(); // Should be narrowed after assertion
}

// === Section 4: for-of loop narrowing ===
declare const items: Signal<readonly string[] | undefined>;

if (items() !== undefined) {
    for (const item of items()) {
        const s: string = item;
    }
}

// === Section 5: Logical AND/OR narrowing ===
declare const flag: Signal<string | undefined>;

const result1: string = flag() ?? "default"; // nullish coalescing
const result2: string | undefined = flag() && flag().toUpperCase(); // logical AND
