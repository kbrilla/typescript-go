//// [tests/cases/compiler/stableModifierKeyedLinkedPredicates.ts] ////

//// [stableModifierKeyedLinkedPredicates.ts]
// Phase 9: Keyed Linked Predicates — per-key stable tracking

// === 1. Basic per-key stable with literal keys ===
interface TypedMap<K, V> {
    stable[key] get(key: K): V | undefined;
    mutator[key] set(key: K, value: V): void invalidates get[key];
    mutator[key] delete(key: K): boolean invalidates get[key];
    mutator clear(): void;  // unkeyed → invalidates ALL
}

declare const map: TypedMap<string, number>;

// Per-key narrowing with string literals
if (map.get("x") !== undefined) {
    const a: number = map.get("x");       // narrowed (same key "x")
    const b = map.get("y");               // number | undefined (different key)

    map.set("y", 42);                     // invalidates only get("y")
    const c: number = map.get("x");       // still narrowed

    map.set("x", 99);                     // invalidates get("x")
    const d = map.get("x");               // number | undefined (narrowing dropped)

    map.clear();                          // invalidates ALL keys
    map.get("x");                         // number | undefined
}

// === 2. Variable key reference ===
declare const key: string;
if (map.get(key) !== undefined) {
    const e: number = map.get(key);       // narrowed (same variable ref)
}

// === 3. Independent keys narrowed simultaneously ===
if (map.get("a") !== undefined && map.get("b") !== undefined) {
    const f: number = map.get("a");       // narrowed
    const g: number = map.get("b");       // narrowed

    map.set("a", 10);                     // only invalidates get("a")
    const h: number = map.get("b");       // still narrowed
}

// === 4. delete per-key invalidation ===
if (map.get("x") !== undefined && map.get("y") !== undefined) {
    map.delete("y");                      // invalidates get("y") only
    const i: number = map.get("x");       // still narrowed
}

// === 5. Function type syntax with keyed stable ===
interface FuncMap<K, V> {
    get: stable[key] (key: K) => V | undefined;
    set: mutator[key] (key: K, value: V) => void invalidates get[key];
}

declare const fmap: FuncMap<string, number>;
if (fmap.get("z") !== undefined) {
    const j: number = fmap.get("z");      // narrowed
    fmap.set("w", 5);                     // different key
    const k: number = fmap.get("z");      // still narrowed
}


//// [stableModifierKeyedLinkedPredicates.js]
"use strict";
// Phase 9: Keyed Linked Predicates — per-key stable tracking
// Per-key narrowing with string literals
if (map.get("x") !== undefined) {
    const a = map.get("x"); // narrowed (same key "x")
    const b = map.get("y"); // number | undefined (different key)
    map.set("y", 42); // invalidates only get("y")
    const c = map.get("x"); // still narrowed
    map.set("x", 99); // invalidates get("x")
    const d = map.get("x"); // number | undefined (narrowing dropped)
    map.clear(); // invalidates ALL keys
    map.get("x"); // number | undefined
}
if (map.get(key) !== undefined) {
    const e = map.get(key); // narrowed (same variable ref)
}
// === 3. Independent keys narrowed simultaneously ===
if (map.get("a") !== undefined && map.get("b") !== undefined) {
    const f = map.get("a"); // narrowed
    const g = map.get("b"); // narrowed
    map.set("a", 10); // only invalidates get("a")
    const h = map.get("b"); // still narrowed
}
// === 4. delete per-key invalidation ===
if (map.get("x") !== undefined && map.get("y") !== undefined) {
    map.delete("y"); // invalidates get("y") only
    const i = map.get("x"); // still narrowed
}
if (fmap.get("z") !== undefined) {
    const j = fmap.get("z"); // narrowed
    fmap.set("w", 5); // different key
    const k = fmap.get("z"); // still narrowed
}
