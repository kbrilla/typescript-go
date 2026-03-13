// @strict: true
// @target: esnext
// @noEmit: true

type Signal<T> = stable () => T;

declare const appStatus: Signal<"loading" | "success" | "error" | "idle">;

// === Equality-chain literal-union narrowing ===

// Single equality
if (appStatus() === "loading") {
    const s: "loading" = appStatus();
}

// Two-branch OR chain
if (appStatus() === "loading" || appStatus() === "success") {
    const s: "loading" | "success" = appStatus();
}

// Three-branch OR chain
if (appStatus() === "loading" || appStatus() === "success" || appStatus() === "error") {
    const s: "loading" | "success" | "error" = appStatus();
}

// Exhaustive check (all branches)
if (appStatus() === "loading" || appStatus() === "success" || appStatus() === "error" || appStatus() === "idle") {
    const s: "loading" | "success" | "error" | "idle" = appStatus();
}

// Negation (not equal)
if (appStatus() !== "loading") {
    const s: "success" | "error" | "idle" = appStatus();
}

// Double negation intersection
if (appStatus() !== "loading" && appStatus() !== "idle") {
    const s: "success" | "error" = appStatus();
}

// === With string | undefined Signal ===

declare const read: Signal<string | undefined>;

// Simple equality narrows to literal
if (read() === "hello") {
    const r: "hello" = read();
}

// OR chain with undefined check
if (read() === "hello" || read() === "world") {
    const r: "hello" | "world" = read();
}

// !== undefined combined with equality
if (read() !== undefined && (read() === "a" || read() === "b")) {
    const r: "a" | "b" = read();
}
