// @strict: true
// @noEmit: true

// Generic discriminant narrowing parity: getter and stable endpoint forms.
type Fish = { type: "fish"; hasFins: true };
type Dog = { type: "dog"; saysWoof: true };
type Pet = Fish | Dog;

function getterGeneric<PetType extends Pet>(pet: { get value(): PetType }) {
    if (pet.value.type === "dog") {
        const getterDog: true = pet.value.saysWoof; // baseline: OK
        getterDog;
    }
}

function identityGeneric<PetType extends Pet>(pet: { value: stable () => PetType }) {
    if (pet.value().type === "dog") {
        const identityDog: true = pet.value().saysWoof; // parity target: OK
        identityDog;
    }
}
