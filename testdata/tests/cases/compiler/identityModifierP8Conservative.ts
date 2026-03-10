// @strict: true
// @noEmit: true

// P8/X3 conservative boundary lock:
// Unknown calls after discriminant guards must drop identity-call narrowing.

type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "square"; size: number };

declare function unknownMutate(): void;

declare const getterModel: {
    get value(): Shape;
};

declare const identityModel: identity () => Shape;

if (getterModel.value.kind === "circle") {
    unknownMutate();
    const getterAfterUnknown: number = getterModel.value.radius; // getter baseline: remains narrowed in this sweep shape
    getterAfterUnknown;
}

if (identityModel().kind === "circle") {
    unknownMutate();
    const identityAfterUnknown: number = identityModel().radius; // expected conservative error
    identityAfterUnknown;
}
