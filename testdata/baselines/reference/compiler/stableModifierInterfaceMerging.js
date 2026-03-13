//// [tests/cases/compiler/stableModifierInterfaceMerging.ts] ////

//// [stableModifierInterfaceMerging.ts]
// Section 1: Merged interfaces — both declarations agree on stable
// When both declarations have stable, the modifier survives.
interface StableAgreed {
    value: stable () => string | undefined;
}
interface StableAgreed {
    other(): void;
}

declare const agreed: StableAgreed;
if (agreed.value() !== undefined) {
    agreed.value().toUpperCase(); // OK — stable survives merging when both agree
}

// Section 2: Merged interfaces — first declaration has stable, second doesn't
// The first declaration is the ValueDeclaration. Since stable is on the function
// type (not the symbol), the first declaration's type is used → stable survives.
interface StableFirstWins {
    value: stable () => string | undefined;
}
interface StableFirstWins {
    value: () => string | undefined; // different type annotation — no stable
}

declare const firstWins: StableFirstWins;
if (firstWins.value() !== undefined) {
    firstWins.value().toUpperCase(); // stable from first declaration
}

// Section 3: Merged interfaces — first declaration lacks stable, second has it
// First declaration wins via ValueDeclaration. Since first lacks stable, it's lost.
interface StableLost {
    value: () => string | undefined;
}
interface StableLost {
    value: stable () => string | undefined;
}

declare const lost: StableLost;
if (lost.value() !== undefined) {
    lost.value().toUpperCase(); // stable is lost — first declaration has no stable
}

// Section 4: Intersection types — both have stable
// In intersections, each constituent's signatures are independent.
// If the resolved signature has stable, narrowing applies.
interface StableA {
    value: stable () => string | undefined;
}
interface StableB {
    value: stable () => string | undefined;
}

declare const both: StableA & StableB;
if (both.value() !== undefined) {
    both.value().toUpperCase(); // OK — stable present in both constituents
}

// Section 5: Intersection types — one has stable, one doesn't
// In intersections, the property type is resolved from the first constituent.
// Since WithStable has the stable modifier, narrowing survives.
interface WithStable {
    getValue: stable () => number | undefined;
}
interface WithoutStable {
    getValue: () => number | undefined;
}

declare const mixed: WithStable & WithoutStable;
if (mixed.getValue() !== undefined) {
    mixed.getValue().toFixed(2); // OK — stable from first constituent survives intersection
}

// Section 6: Merged interfaces with mutator disagreement
// Same first-declaration-wins behavior applies to mutator.
interface MutatorAgreed {
    value: stable () => string | undefined;
    set: mutator (v: string | undefined) => void;
}
interface MutatorAgreed {
    set: (v: string | undefined) => void; // no mutator modifier
}

declare const mutAgreed: MutatorAgreed;
if (mutAgreed.value() !== undefined) {
    mutAgreed.set(undefined); // mutator from first declaration applies
    mutAgreed.value(); // should be reset by mutator
}

// Section 7: Interface extends — stable preserved in extension
// Extension (not merging) preserves stable through inheritance.
interface Base {
    value: stable () => string | undefined;
}
interface Derived extends Base {
    other(): void;
}

declare const derived: Derived;
if (derived.value() !== undefined) {
    derived.value().toUpperCase(); // OK — stable inherited from Base
}

// Section 8: Interface extends — overriding stable with non-stable
// When a derived interface re-declares a property without stable,
// the derived declaration takes priority over the base.
interface BaseStable {
    value: stable () => string | undefined;
}
interface DerivedNoStable extends BaseStable {
    value: () => string | undefined; // overrides base without stable
}

declare const overridden: DerivedNoStable;
if (overridden.value() !== undefined) {
    overridden.value().toUpperCase(); // stable lost — derived type doesn't have it
}

// Section 9: Interface extends — adding stable to non-stable base
// When a derived interface adds stable to a property that wasn't stable in base.
interface BaseNoStable {
    value: () => string | undefined;
}
interface DerivedStable extends BaseNoStable {
    value: stable () => string | undefined; // adds stable
}

declare const addedStable: DerivedStable;
if (addedStable.value() !== undefined) {
    addedStable.value().toUpperCase(); // stable added by derived
}

// Section 10: Merged interfaces with stable method declarations
// Same behavior for stable/mutator as method modifiers.
interface MethodMerge {
    stable getValue(): string | undefined;
    mutator setValue(v: string | undefined): void;
}
interface MethodMerge {
    other(): void;
}

declare const methodMerge: MethodMerge;
if (methodMerge.getValue() !== undefined) {
    methodMerge.getValue().toUpperCase(); // OK — stable method survives merge
    methodMerge.setValue(undefined); // mutator resets
    methodMerge.getValue(); // back to string | undefined
}


//// [stableModifierInterfaceMerging.js]
"use strict";
if (agreed.value() !== undefined) {
    agreed.value().toUpperCase(); // OK — stable survives merging when both agree
}
if (firstWins.value() !== undefined) {
    firstWins.value().toUpperCase(); // stable from first declaration
}
if (lost.value() !== undefined) {
    lost.value().toUpperCase(); // stable is lost — first declaration has no stable
}
if (both.value() !== undefined) {
    both.value().toUpperCase(); // OK — stable present in both constituents
}
if (mixed.getValue() !== undefined) {
    mixed.getValue().toFixed(2); // OK — stable from first constituent survives intersection
}
if (mutAgreed.value() !== undefined) {
    mutAgreed.set(undefined); // mutator from first declaration applies
    mutAgreed.value(); // should be reset by mutator
}
if (derived.value() !== undefined) {
    derived.value().toUpperCase(); // OK — stable inherited from Base
}
if (overridden.value() !== undefined) {
    overridden.value().toUpperCase(); // stable lost — derived type doesn't have it
}
if (addedStable.value() !== undefined) {
    addedStable.value().toUpperCase(); // stable added by derived
}
if (methodMerge.getValue() !== undefined) {
    methodMerge.getValue().toUpperCase(); // OK — stable method survives merge
    methodMerge.setValue(undefined); // mutator resets
    methodMerge.getValue(); // back to string | undefined
}
