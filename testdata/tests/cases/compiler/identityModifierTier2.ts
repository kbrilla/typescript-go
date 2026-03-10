// @strict: true
// @noEmit: true

// Candidate Tier 2 patterns: local alias-preserving forwarding and helper passthrough.
declare const read: identity () => string | undefined;
declare function pass<T>(x: T): T;
declare function useReader(fn: () => string | undefined): void;

if (read() !== undefined) {
    const stable: string = read(); // baseline sanity check: still narrowed before boundaries
    stable;
}

if (read() !== undefined) {
    // Tier 2 precision target: inline trivial passthrough lambda should preserve narrowing.
    const fwd = ((x) => x)(read);
    fwd;

    const afterInlinePassthrough: string = read(); // should stay narrowed
    afterInlinePassthrough;
}

if (read() !== undefined) {
    // Tier 2 precision target: local const helper identifier with trivial passthrough body.
    const localId = <T>(x: T) => x;
    const forwarded = localId(read);
    forwarded;

    const afterConstHelperPassthrough: string = read(); // should stay narrowed
    afterConstHelperPassthrough;
}

if (read() !== undefined) {
    // Tier 2 precision target: const alias-chain to trivial passthrough helper should preserve narrowing.
    const localId = <T>(x: T) => x;
    const localId2 = localId;
    const forwarded = localId2(read);
    forwarded;

    const afterConstHelperAliasChain: string = read(); // should stay narrowed
    afterConstHelperAliasChain;
}

if (read() !== undefined) {
    // Tier 2 precision target: local function declaration helper with trivial passthrough body.
    function localFnId<T>(x: T) {
        return x;
    }
    const forwarded = localFnId(read);
    forwarded;

    const stillString: string = read(); // should stay narrowed
    stillString;
}

if (read() !== undefined) {
    // Tier 2 precision target: expression-statement passthrough via local const helper should preserve narrowing.
    const localId = <T>(x: T) => x;
    localId(read);

    const afterExprStmtConstHelper: string = read(); // should stay narrowed
    afterExprStmtConstHelper;
}

if (read() !== undefined) {
    // Tier 2 precision target: expression-statement passthrough via local function declaration should preserve narrowing.
    function localFnId<T>(x: T) {
        return x;
    }
    localFnId(read);

    const afterExprStmtFunctionDecl: string = read(); // should stay narrowed
    afterExprStmtFunctionDecl;
}

if (read() !== undefined) {
    // Conservative boundary: non-trivial helper body should still invalidate prior narrowing.
    function localFnWrap<T>(x: T) {
        return () => x;
    }
    const forwarded = localFnWrap(read);
    forwarded;

    const afterNonTrivialFnHelper: string = read(); // current conservative: error
    afterNonTrivialFnHelper;
}

if (read() !== undefined) {
    // Conservative boundary: mutable helper can be reassigned and must invalidate prior narrowing.
    let localMaybeId = <T>(x: T) => x;
    localMaybeId = pass;
    const forwarded = localMaybeId(read);
    forwarded;

    const afterMutableHelperPassthrough: string = read(); // current conservative: error
    afterMutableHelperPassthrough;
}

if (read() !== undefined) {
    // Conservative boundary: mutable alias chain remains invalidating after reassignment.
    const localId = <T>(x: T) => x;
    let maybeAlias = localId;
    maybeAlias = pass;
    const forwarded = maybeAlias(read);
    forwarded;

    const afterMutableAliasChain: string = read(); // current conservative: error
    afterMutableAliasChain;
}

if (read() !== undefined) {
    // Conservative boundary: mutable helper in expression-statement form remains invalidating.
    let localMaybeId = <T>(x: T) => x;
    localMaybeId = pass;
    localMaybeId(read);

    const afterExprStmtMutableHelper: string = read(); // current conservative: error
    afterExprStmtMutableHelper;
}

if (read() !== undefined) {
    // Conservative boundary: non-trivial helper in expression-statement form remains invalidating.
    function localFnWrap<T>(x: T) {
        return () => x;
    }
    localFnWrap(read);

    const afterExprStmtNonTrivialHelper: string = read(); // current conservative: error
    afterExprStmtNonTrivialHelper;
}

if (read() !== undefined) {
    // Tier 2 precision target: ambient identity helper passthrough preserves narrowing.
    const forwarded = pass(read);
    forwarded;

    const afterAliasPreservingPass: string = read(); // should stay narrowed
    afterAliasPreservingPass;
}

if (read() !== undefined) {
    // current conservative: passing read endpoint through a helper call invalidates prior narrowing
    useReader(pass(read));

    const afterHelperPassthrough: string = read(); // current conservative: error
    afterHelperPassthrough;

    // Tier 2 target: keep precision with guarded inference in provably stable local forwarding shapes.
}
