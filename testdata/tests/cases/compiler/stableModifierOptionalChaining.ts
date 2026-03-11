// @strict: true
// @target: esnext
// @noEmit: true

type Signal<T> = stable () => T;

declare const read: Signal<{ name: string; age: number } | undefined>;

// Optional chaining on stable call result
const itemName = read()?.name;

// Narrowing through optional chaining
if (read() !== undefined) {
    const obj = read();
    const n: string = obj.name;
    const a: number = obj.age;
}

// Optional chaining should not narrow
const maybeName: string | undefined = read()?.name;

// Nested optional chaining
declare const nested: Signal<{ inner?: { value: string } } | undefined>;

const deep = nested()?.inner?.value;

// Identity with nullish coalescing
const nameOrDefault: string = read()?.name ?? "unknown";
