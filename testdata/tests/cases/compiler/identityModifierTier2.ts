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
    // current conservative: alias-preserving helper passthrough is treated as an uncertainty boundary
    const forwarded = pass(read);
    forwarded;

    const afterAliasPreservingPass: string = read(); // current conservative: error
    afterAliasPreservingPass;

    // Tier 2 target: preserve narrowing when helper forwarding can be proven alias-preserving and non-mutating.
}

if (read() !== undefined) {
    // current conservative: passing read endpoint through a helper call invalidates prior narrowing
    useReader(pass(read));

    const afterHelperPassthrough: string = read(); // current conservative: error
    afterHelperPassthrough;

    // Tier 2 target: keep precision with guarded inference in provably stable local forwarding shapes.
}
