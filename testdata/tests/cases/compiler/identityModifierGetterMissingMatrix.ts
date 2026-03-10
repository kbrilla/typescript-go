// @strict: true
// @noEmit: true
// @target: es2015

// Missing getter-origin parity matrix additions discovered by sweep/swarm.
// Intent: visibility-first local coverage for Phase 1; do not force behavior changes.

declare function unknownMutate(): void;

// -----------------------------------------------------------------------------
// [M1] Qualified-name typeof retention across loops
// Source: _submodules/TypeScript/tests/cases/compiler/narrowingOfQualifiedNames.ts
// -----------------------------------------------------------------------------

interface M1Props {
    foo?: {
        aaa: string;
        bbb: string;
    };
}

declare const getterM1: {
    get value(): M1Props;
};

declare const identityM1: {
    value: identity () => M1Props;
};

if (getterM1.value.foo) {
    for (const _ of [1, 2, 3]) {
        type M1GetterTypeof = typeof getterM1.value.foo;
        const m1GetterA: string = getterM1.value.foo.aaa; // getter baseline: OK
        const m1GetterB: string = getterM1.value.foo.bbb; // getter baseline: OK
        m1GetterA;
        m1GetterB;
        const _typeWitnessGetter: M1GetterTypeof = getterM1.value.foo;
        _typeWitnessGetter;
    }
}

if (identityM1.value().foo) {
    for (const _ of [1, 2, 3]) {
        const m1IdentityA: string = identityM1.value().foo.aaa; // identity parity target
        const m1IdentityB: string = identityM1.value().foo.bbb; // identity parity target
        m1IdentityA;
        m1IdentityB;
    }
}

// -----------------------------------------------------------------------------
// [M2] Deep qualified-chain repeated type-query checks
// Source: _submodules/TypeScript/tests/cases/compiler/narrowingOfQualifiedNames.ts
// -----------------------------------------------------------------------------

interface M2DeepOptional {
    a?: {
        b?: {
            c?: string;
        };
    };
}

declare const getterM2: {
    get value(): M2DeepOptional;
};

declare const identityM2: {
    value: identity () => M2DeepOptional;
};

if (getterM2.value.a) {
    for (const _ of [1]) {
        type _M2GetterA = typeof getterM2.value.a;
        type _M2GetterB = typeof getterM2.value.a.b;
        if (getterM2.value.a.b && getterM2.value.a.b.c) {
            type _M2GetterC = typeof getterM2.value.a.b.c;
            const m2Getter: string = getterM2.value.a.b.c; // getter baseline: OK
            m2Getter;
        }
    }
}

if (identityM2.value().a) {
    for (const _ of [1]) {
        type _M2IdentityA = M2DeepOptional["a"];
        type _M2IdentityB = M2DeepOptional["a"] extends infer A
            ? A extends { b?: infer B }
                ? B
                : never
            : never;
        if (identityM2.value().a.b && identityM2.value().a.b.c) {
            type _M2IdentityC = NonNullable<
                NonNullable<NonNullable<M2DeepOptional["a"]>["b"]>["c"]
            >;
            const m2Identity: string = identityM2.value().a.b.c; // identity parity target
            m2Identity;
        }
    }
}

// -----------------------------------------------------------------------------
// [M3] Dotted-name while(true) no-break variant
// Source: _submodules/TypeScript/tests/cases/compiler/narrowingOfDottedNames.ts
// -----------------------------------------------------------------------------

class M3A {
    prop!: { a: string };
}

class M3B {
    prop!: { b: string };
}

class M3AIdentity {
    prop!: identity () => { a: string };
}

class M3BIdentity {
    prop!: identity () => { b: string };
}

function m3GetterWhileTrue(x: M3A | M3B) {
    while (true) {
        if (x instanceof M3A) {
            const m3a: string = x.prop.a; // getter baseline: OK
            m3a;
        } else if (x instanceof M3B) {
            const m3b: string = x.prop.b; // getter baseline: OK
            m3b;
        }
    }
}

function m3IdentityWhileTrue(x: M3AIdentity | M3BIdentity) {
    while (true) {
        if (x instanceof M3AIdentity) {
            const m3a: string = x.prop().a; // identity parity target
            m3a;
        } else if (x instanceof M3BIdentity) {
            const m3b: string = x.prop().b; // identity parity target
            m3b;
        }
    }
}

// -----------------------------------------------------------------------------
// [M4] Predicate input typed any vs unknown
// Source: _submodules/TypeScript/tests/cases/compiler/narrowingOfDottedNames.ts
// -----------------------------------------------------------------------------

function isM3AAny(x: any): x is M3AIdentity {
    return x instanceof M3AIdentity;
}

function isM3BAny(x: any): x is M3BIdentity {
    return x instanceof M3BIdentity;
}

function isM3AUnknown(x: unknown): x is M3AIdentity {
    return x instanceof M3AIdentity;
}

function isM3BUnknown(x: unknown): x is M3BIdentity {
    return x instanceof M3BIdentity;
}

function m4IdentityPredicateAny(x: M3AIdentity | M3BIdentity) {
    while (true) {
        if (isM3AAny(x)) {
            const m4a: string = x.prop().a; // identity parity target
            m4a;
        } else if (isM3BAny(x)) {
            const m4b: string = x.prop().b; // identity parity target
            m4b;
        }
    }
}

function m4IdentityPredicateUnknown(x: M3AIdentity | M3BIdentity) {
    while (true) {
        if (isM3AUnknown(x)) {
            const m4a: string = x.prop().a; // identity parity target
            m4a;
        } else if (isM3BUnknown(x)) {
            const m4b: string = x.prop().b; // identity parity target
            m4b;
        }
    }
}

// -----------------------------------------------------------------------------
// [M5] Direct-vs-generic discriminant baseline contrast
// Source: _submodules/TypeScript/tests/cases/compiler/narrowingOfQualifiedNames.ts
// -----------------------------------------------------------------------------

type M5Fish = { type: "fish"; hasFins: true };
type M5Dog = { type: "dog"; saysWoof: true };
type M5Pet = M5Fish | M5Dog;

function m5GetterDirect(pet: { get value(): M5Pet }) {
    if (pet.value.type === "dog") {
        const m5a: true = pet.value.saysWoof; // getter baseline: OK
        m5a;
    }
}

function m5IdentityDirect(pet: { value: identity () => M5Pet }) {
    if (pet.value().type === "dog") {
        const m5a: true = pet.value().saysWoof; // identity parity target
        m5a;
    }
}

function m5GetterGeneric<PetType extends M5Pet>(pet: { get value(): PetType }) {
    if (pet.value.type === "dog") {
        const m5a: true = pet.value.saysWoof; // getter baseline: OK
        m5a;
    }
}

function m5IdentityGeneric<PetType extends M5Pet>(pet: { value: identity () => PetType }) {
    if (pet.value().type === "dog") {
        const m5a: true = pet.value().saysWoof; // identity parity target
        m5a;
    }
}

// -----------------------------------------------------------------------------
// [M6] Selected conformance guard/accessor scenarios (Phase 1 meaningful ports)
// Sources:
//   - _submodules/TypeScript/tests/cases/conformance/expressions/typeGuards/typeGuardsInProperties.ts
//   - _submodules/TypeScript/tests/cases/conformance/expressions/typeGuards/typeGuardsInClassAccessors.ts
// -----------------------------------------------------------------------------

let m6Sink: string | number | false;

class M6GetterContainer {
    member: string | number = "x";
    get accessor() {
        return this.member;
    }
}

class M6IdentityContainer {
    memberRead: identity () => string | number = (() => "x") as identity () => string | number;
}

declare const m6GetterObj: {
    value: string | number;
};

declare const m6IdentityObj: {
    value: identity () => string | number;
};

declare const m6BoundaryGetter: {
    get value(): string | undefined;
};

declare const m6BoundaryIdentity: identity () => string | undefined;

m6Sink = typeof m6GetterObj.value === "string" && m6GetterObj.value; // getter baseline: string | number
m6Sink = typeof m6IdentityObj.value() === "string" && m6IdentityObj.value(); // identity parity target

const m6GetterInstance = new M6GetterContainer();
const m6IdentityInstance = new M6IdentityContainer();

m6Sink = typeof m6GetterInstance.member === "string" && m6GetterInstance.member; // getter baseline: string | number
m6Sink = typeof m6IdentityInstance.memberRead() === "string" && m6IdentityInstance.memberRead(); // identity parity target

m6Sink = typeof m6GetterInstance.accessor === "string" && m6GetterInstance.accessor; // getter baseline: string | number
m6Sink = typeof m6IdentityInstance.memberRead() === "string" && m6IdentityInstance.memberRead(); // identity parity target

// Boundary control in this matrix file: if getter path remains narrowed but identity drops,
// keep the delta visible for parity tracking.
if (m6BoundaryGetter.value !== undefined) {
    unknownMutate();
    const m6GetterBoundaryControl: string = m6BoundaryGetter.value; // getter baseline contrast
    m6GetterBoundaryControl;
}

if (m6BoundaryIdentity() !== undefined) {
    unknownMutate();
    const m6IdentityBoundaryControl: string = m6BoundaryIdentity(); // expected to remain conservative
    m6IdentityBoundaryControl;
}
