// @strict: true
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

type Animal = Cat | Dog;

declare const animal: Signal<Animal>;

// === Section 1: Method calls on narrowed results ===
// Method calls on local consts narrowed from stable should not invalidate
if (animal().kind === "cat") {
    const cat: Cat = animal();
    cat.meow();
    const cat2: Cat = animal(); // Should still be narrowed to Cat
}

if (animal().kind === "dog") {
    const dog: Dog = animal();
    dog.bark();
    const dog2: Dog = animal(); // Should still be narrowed to Dog
}

// === Section 2: Console/utility method calls ===
declare const value: Signal<string | undefined>;

if (value() !== undefined) {
    console.log("test");
    const s: string = value(); // console.log should not invalidate
}

// === Section 3: Method calls on unrelated objects ===
declare const helper: { log(s: string): void; format(s: string): string };

if (value() !== undefined) {
    helper.log(value());
    const s: string = value(); // Method call on unrelated object
}

// === Section 4: Same-receiver method calls are transparent (getter parity) ===
declare const store: {
    read: stable () => string | undefined;
    clear(): void;
    reset(v: string): void;
};

if (store.read() !== undefined) {
    store.clear();
    const s: string = store.read(); // Transparent - getter parity: method calls don't invalidate narrowing
}

if (store.read() !== undefined) {
    store.reset("new");
    const s: string = store.read(); // Transparent - getter parity: only property writes invalidate
}

// === Section 5: Method calls on different receiver ===
declare const otherStore: { doSomething(): void };

if (store.read() !== undefined) {
    otherStore.doSomething();
    const s: string = store.read(); // Should preserve - different receiver
}
