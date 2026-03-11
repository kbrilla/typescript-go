// @strict: true
// @target: esnext
// @noEmit: true

type Signal<T> = stable () => T;

interface Cat {
    kind: "cat";
    meow(): void;
}

interface Dog {
    kind: "dog";
    bark(): void;
}

declare const animal: Signal<Cat | Dog>;

// Discriminant narrowing with stable
if (animal().kind === "cat") {
    const cat: Cat = animal();
    cat.meow();
}

// 'in' operator narrowing with stable
if ("meow" in animal()) {
    const cat: Cat = animal();
    cat.meow();
}

if ("bark" in animal()) {
    const dog: Dog = animal();
    dog.bark();
}

// typeof narrowing with stable
declare const value: Signal<string | number>;

if (typeof value() === "string") {
    const str: string = value();
}

if (typeof value() === "number") {
    const num: number = value();
}

// instanceof narrowing with stable
declare const instance: Signal<Date | RegExp>;

if (instance() instanceof Date) {
    const d: Date = instance();
}
