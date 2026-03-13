// @strict: true

// === Section 1: super.mutator() should invalidate this.stable() ===
class Base {
    stable get(): string | undefined { return "hello"; }
    mutator set(value: string | undefined): void {}
    mutator reset(): void {}
}

class DerivedSuperTest extends Base {
    override stable get(): string | undefined { return super.get(); }
    override mutator set(value: string | undefined): void { super.set(value); }
    override mutator reset(): void { super.reset(); }

    testSuperReset(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            super.reset(); // super.mutator() invalidates this.stable()
            const after: string = this.get(); // error — invalidated
            after;
        }
    }

    testSuperSet(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            super.set(undefined); // super.mutator(undefined) post-call narrows to undefined
            const after: string = this.get(); // error — narrowed to undefined
            after;
        }
    }

    testSuperSetString(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            super.set("new"); // super.mutator("new") post-call narrows to string
            const after: string = this.get(); // OK — post-call narrowed to string
            after;
        }
    }
}

// === Section 2: this.mutator() should invalidate this.stable() (control) ===
class DerivedThisTest extends Base {
    testThisReset(): void {
        if (this.get() !== undefined) {
            const before: string = this.get(); // OK — narrowed
            this.reset(); // this.mutator() invalidates
            const after: string = this.get(); // error — invalidated
            after;
        }
    }
}
