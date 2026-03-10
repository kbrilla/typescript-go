// @strict: true
// @noEmit: true

// Tier 1 write-form invalidation: dot and bracket-literal assignment forms.
declare const propertyModel: {
    get value(): string | undefined;
    set value(v: string | undefined);
};

if (propertyModel.value !== undefined) {
    propertyModel.value += "!";
    const afterPlusEquals: string = propertyModel.value; // should error
    afterPlusEquals;
}

if (propertyModel.value !== undefined) {
    propertyModel.value ??= "fallback";
    const afterQuestionQuestionEquals: string = propertyModel.value; // should error
    afterQuestionQuestionEquals;
}

if (propertyModel.value !== undefined) {
    propertyModel.value ||= "fallback";
    const afterBarBarEquals: string = propertyModel.value; // should error
    afterBarBarEquals;
}

if (propertyModel.value !== undefined) {
    propertyModel.value &&= "next";
    const afterAmpAmpEquals: string = propertyModel.value; // should error
    afterAmpAmpEquals;
}

if (propertyModel.value !== undefined) {
    propertyModel["value"] = "next";
    const afterBracketEquals: string = propertyModel.value; // parity with dot '=' behavior (currently preserved)
    afterBracketEquals;
}

if (propertyModel.value !== undefined) {
    propertyModel["value"] ||= "fallback";
    const afterBracketBarBarEquals: string = propertyModel.value; // should error
    afterBracketBarBarEquals;
}

declare const numberModel: {
    get value(): number | undefined;
    set value(v: number | undefined);
};

if (numberModel.value !== undefined) {
    numberModel.value++;
    const afterPostfixPlusPlus: number = numberModel.value; // should error
    afterPostfixPlusPlus;
}

if (numberModel.value !== undefined) {
    --numberModel.value;
    const afterPrefixMinusMinus: number = numberModel.value; // should error
    afterPrefixMinusMinus;
}

if (numberModel.value !== undefined) {
    numberModel["value"]++;
    const afterBracketPostfixPlusPlus: number = numberModel.value; // should error
    afterBracketPostfixPlusPlus;
}

// Bracket-literal mutator parity with existing dot-form read/set special-case.
declare const store: {
    read: identity () => string | undefined;
    set(v: string | undefined): void;
};

if (store.read() !== undefined) {
    store.set("next");
    const afterDotSetCall: string = store.read(); // should stay narrowed
    afterDotSetCall;
}

if (store.read() !== undefined) {
    store["set"]("next");
    const afterBracketSetCall: string = store.read(); // should stay narrowed
    afterBracketSetCall;
}
