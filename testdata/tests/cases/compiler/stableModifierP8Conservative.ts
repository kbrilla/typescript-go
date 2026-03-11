// @strict: true
// @noEmit: true

// P8/X3 guarded unknown-call boundary:
// Preserve narrowing only for a very narrow shape and keep broader unknown-call
// forms conservative.

type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; size: number };

declare function unknownMutate(): void;
declare function unknownMutateWithArg(v: number): void;

declare const getterModel: {
    get value(): Shape;
};

declare const identityModel: stable () => Shape;

if (getterModel.value.kind === "circle") {
    unknownMutate();
    const getterAfterUnknown: number = getterModel.value.radius; // getter baseline: remains narrowed in this sweep shape
    getterAfterUnknown;
}

if (identityModel().kind === "circle") {
    unknownMutate();
    const identityAfterUnknown: number = identityModel().radius; // guarded parity target: OK
    identityAfterUnknown;
}

if (identityModel().kind === "circle") {
    unknownMutateWithArg(1);
    const identityAfterUnknownWithArg: number = identityModel().radius; // expected conservative error (non-target shape)
    identityAfterUnknownWithArg;
}
