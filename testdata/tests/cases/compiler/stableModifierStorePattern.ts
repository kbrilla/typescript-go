// @strict: true
// @noEmit: true

// --- 1. Basic Keyed Store Get/Set ---

interface StoreAccessor<T> {
    stable[key] get<K extends keyof T & string>(key: K): T[K];
}

interface StoreWriter<T> {
    mutator set<K extends keyof T & string>(key: K, value: T[K]): void invalidates get[key];
}

interface AppState {
    user: string | undefined;
    count: number;
    status: "loading" | "ready" | "error";
}

declare const reader: StoreAccessor<AppState>;
declare const writer: StoreWriter<AppState>;

if (reader.get("user") !== undefined) {
    const u: string = reader.get("user");
    writer.set("count", 99);
    const u2: string = reader.get("user");
    writer.set("user", "bob");
    const u3: string = reader.get("user");
}

// --- 2. createTypedStore factory returning tuple ---

interface TypedStoreReader<T> {
    stable[key] get<K extends keyof T & string>(key: K): T[K];
}

interface TypedStoreWriter<T> {
    mutator set<K extends keyof T & string>(key: K, value: T[K]): void invalidates get[key];
}

declare function createTypedStore<T>(initial: T): [TypedStoreReader<T>, TypedStoreWriter<T>];

interface CounterState {
    x: number;
    y: number;
    label: string | undefined;
}

const [rd, wr] = createTypedStore<CounterState>({ x: 0, y: 0, label: undefined });

if (rd.get("label") !== undefined) {
    const lbl: string = rd.get("label");
    wr.set("x", 10);
    const lbl2: string = rd.get("label");
    wr.set("label", "hello");
    const lbl3: string = rd.get("label");
}

// --- 3. Exhaustive switch on keyed store field ---

switch (reader.get("status")) {
    case "loading":
        const s1: "loading" = reader.get("status");
        break;
    case "ready":
        const s2: "ready" = reader.get("status");
        break;
    case "error":
        const s3: "error" = reader.get("status");
        break;
    default:
        const _exhaustive: never = reader.get("status");
}

// --- 4. Nested state — array field narrowing ---

interface NestedState {
    users: string[] | undefined;
    active: boolean;
}

declare const nested: StoreAccessor<NestedState>;
declare const nestedWriter: StoreWriter<NestedState>;

if (reader.get("user") !== undefined && nested.get("users") !== undefined) {
    const arr: string[] = nested.get("users");
    const len: number = nested.get("users").length;
    const first: string = nested.get("users")[0];
    nestedWriter.set("active", true);
    const arr2: string[] = nested.get("users");
}

// --- 5. Independent stores — cross-store writes don't interfere ---

interface StoreA {
    foo: string | undefined;
}

interface StoreB {
    bar: number | undefined;
}

declare const readerA: StoreAccessor<StoreA>;
declare const writerA: StoreWriter<StoreA>;
declare const readerB: StoreAccessor<StoreB>;
declare const writerB: StoreWriter<StoreB>;

if (readerA.get("foo") !== undefined) {
    const f1: string = readerA.get("foo");
    writerB.set("bar", 42);
    const f2: string = readerA.get("foo");
}

if (readerB.get("bar") !== undefined) {
    const b1: number = readerB.get("bar");
    writerA.set("foo", "hello");
    const b2: number = readerB.get("bar");
}

// --- 6. Discriminated union via keyed store ---

interface TextEntry {
    kind: "text";
    content: string;
}

interface ImageEntry {
    kind: "image";
    url: string;
    width: number;
}

type Entry = TextEntry | ImageEntry;

interface EntryState {
    entry: Entry;
    title: string | undefined;
}

declare const entryReader: StoreAccessor<EntryState>;
declare const entryWriter: StoreWriter<EntryState>;

if (entryReader.get("entry").kind === "text") {
    const txt: string = entryReader.get("entry").content;
    entryWriter.set("title", "hi");
    const txt2: string = entryReader.get("entry").content;
}

if (entryReader.get("entry").kind === "image") {
    const src: string = entryReader.get("entry").url;
    const w: number = entryReader.get("entry").width;
}
