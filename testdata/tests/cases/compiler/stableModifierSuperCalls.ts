// @strict: true
// @noEmit: true

// Tests that super.mutator() calls correctly invalidate this.stable() narrowing

// === Section 1: Base class with stable/mutator ===
class Base<T> {
    private _value: T;
    constructor(value: T) { this._value = value; }
    get: stable () => T = () => this._value;
    set: mutator (value: T) => void invalidates get = (v) => { this._value = v; };
    reset: mutator () => void = () => { this._value = undefined as any; };
}

// === Section 2: super.mutator() should invalidate this.stable() narrowing ===
class DerivedInvalidation extends Base<string | undefined> {
    superInvalidatesGet(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed to string
            before;

            super.set("new value");

            const after: string = this.get(); // should error — super.set() resets this.get()
            after;
        }
    }
}

// === Section 3: super.reset() (blanket mutator) should invalidate ===
class DerivedBlanket extends Base<string | undefined> {
    superResetInvalidates(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            before;

            super.reset();

            const after: string = this.get(); // should error — super.reset() resets narrowing
            after;
        }
    }
}

// === Section 4: super.mutator with invalidates clause respects targeting ===
class DerivedTargeted extends Base<string | undefined> {
    extra: stable () => number | undefined = () => 42;

    superSetTargeted(): void {
        if (this.get() !== undefined && this.extra() !== undefined) {
            const getVal: string = this.get(); // OK — narrowed
            const extraVal: number = this.extra(); // OK — narrowed
            getVal;
            extraVal;

            // super.set() invalidates get, but NOT extra (targeted via invalidates clause)
            super.set("new");

            const getAfter: string = this.get(); // should error — invalidated
            const extraAfter: number = this.extra(); // OK — NOT invalidated (set only targets get)
            getAfter;
            extraAfter;
        }
    }
}

// === Section 5: Non-mutator super call should NOT invalidate ===
class DerivedNonMutator extends Base<string | undefined> {
    superNonMutator(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            before;

            // super.toString() is NOT a mutator — should not reset narrowing
            super.toString();

            const after: string = this.get(); // OK — still narrowed (toString is not mutator)
            after;
        }
    }
}

// === Section 6: this.mutator() still works (control case) ===
class DerivedThis extends Base<string | undefined> {
    thisInvalidatesGet(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            before;

            this.set("new");

            const after: string = this.get(); // should error — this.set() resets
            after;
        }
    }
}
