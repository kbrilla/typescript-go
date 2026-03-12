# TS Team Rejection Risk Assessment

**`stable` / `mutator` / `invalidates` Proposal — Risk Analysis**
*March 2026*

---

## Executive Summary

This document assesses the likelihood that the TypeScript team would reject each component of our `stable`/`mutator`/`invalidates` proposal. The analysis is based on TypeScript Design Goals, direct quotes from TS team members, community engagement data, and precedent from accepted TypeScript features.

**Bottom line:** The core proposal (`stable` narrowing preservation) is **not at risk of blanket rejection**. RyanCavanaugh has actively engaged with the upstream identity modifier proposal, and himself identified the need for invalidation syntax — which is precisely what `mutator`/`invalidates` provide. Advanced features (linked predicates, constrained-overload narrowing) carry higher risk and should be positioned as extensions, not blockers.

---

## 1. The kitsonk Comment — Context and Authority

### What Was Said

kitsonk commented on the "Add pure and immutable keywords" issue stating:

> "Adding expression level syntax is anti pattern for TypeScript."

### Authority Assessment

- kitsonk is labeled as a GitHub **"Contributor"** — this is **not** a TypeScript team "Member" label.
- The "Add pure and immutable keywords" issue remains **open** with "In Discussion" and "Suggestion" labels. These labels were added by mhegazy, an actual TS team member — who notably did **not** reject the issue.
- KiaraGrouwstra pushed back directly: *"Like assertion operator `!`? :P"* — correctly noting TypeScript already ships expression-level syntax.

### kitsonk's Track Record on This Topic

kitsonk also marked the "pure annotation in downlevel emits" issue as a duplicate of the "pure and immutable keywords" issue. This was **incorrect** — they are fundamentally different issues:

- The emits issue was about generating `/*#__PURE__*/` comments for tree-shaking.
- The keywords issue was about type-level semantic modifiers.

The emits issue was subsequently **implemented and shipped** in TypeScript 2.5; DanielRosenwasser (TS team) closed it as completed.

### Conclusion

kitsonk's comment carries **no TypeScript team authority** and contains a factual error. TypeScript has accepted multiple expression-level constructs (`satisfies`, `as const`, `!`). The comment should not factor into our risk assessment.

---

## 2. TypeScript Design Goals Alignment

The official [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals) define 11 Goals and 7 Non-Goals.

### Goals — Our Alignment

| Goal | Text | Our Alignment |
|------|------|---------------|
| **Goal 3** | "Impose no runtime overhead on emitted programs" | ✅ All modifiers are **fully erasable**, zero runtime impact |
| **Goal 8** | "Avoid adding expression-level syntax" | ✅ Our modifiers are **declaration-site type annotations**, not expression syntax |
| **Goal 9** | "Use a consistent, fully erasable, structural type system" | ✅ Fully erasable, checked structurally |

### Non-Goals — Our Position

| Non-Goal | Text | Our Position |
|----------|------|-------------|
| **Non-goal 3** | "Apply a sound or 'provably correct' type system. Instead, strike a balance between correctness and productivity." | Our soundness tradeoff mirrors property narrowing — which the CFA trade-offs issue acknowledges as acceptable |
| **Non-goal 5** | "Add or rely on run-time type information in programs" | ✅ No runtime type info involved |

### The Goal 8 Misconception

Goal 8 ("Avoid adding expression-level syntax") is sometimes cited as a blanket prohibition on new syntax. This is **demonstrably false**:

| Keyword | Version | Expression-level? |
|---------|---------|-------------------|
| `as const` | TS 3.4 | **Yes** — appears after expressions |
| `satisfies` | TS 4.9 | **Yes** — appears after expressions (`expr satisfies Type`) |
| `!` (non-null assertion) | TS 2.0 | **Yes** — postfix expression operator |

All three were accepted by the TS team. Goal 8 means "avoid adding runtime JavaScript expression constructs" — type-level keywords and erasable modifiers are explicitly fine.

Our modifiers (`stable`, `mutator`, `invalidates`) are **declaration-site**, appearing only in type annotation positions. They are less "expression-level" than `satisfies`, which was championed by RyanCavanaugh himself.

---

## 3. RyanCavanaugh's Engagement on the Identity Modifier Proposal

RyanCavanaugh (TypeScript team lead) was **actively engaged** on the upstream identity modifier proposal. His responses reveal critical information about what the TS team would accept.

### Design Questions (Not Dismissal)

Ryan asked probing design questions rather than dismissing the proposal:

> "Isn't the core problem in this example that `value` is incorrectly declared?"

> "Also an ELI5 explanation for why it's not correct to write `const v = value()`"

He also suggested workarounds via `PossibleFuncs<T>` distributive conditional types — indicating he takes the problem seriously enough to propose alternatives.

### The Critical Invalidation Quote

> "Wait, if the idea is that `get` 'always returns the same value', why is there a `set` method? **Doesn't this imply the need for additional syntax to identify which functions/methods invalidate the narrowing?**"

**This is exactly what our `mutator` and `invalidates` keywords address.** RyanCavanaugh himself identified the need for invalidation syntax before anyone formally proposed it.

### The Completeness Requirement

> "it seems extremely nearsighted to ship a new CFA feature that is going to immediately run into another feature request before it's considered useful."

This quote is pivotal. It means:

1. RyanCavanaugh **wants a complete solution**, not a partial one.
2. Shipping `stable` without invalidation control would be seen as incomplete.
3. Our proposal's inclusion of `mutator`/`invalidates` directly addresses this concern.

### Current Status

The upstream identity modifier proposal is labeled **"Needs More Info"** — not rejected. The TS team is asking for more detail and justification, which a working implementation can provide.

---

## 4. Community Support and Demand

### The "Pure/Impure Narrowing" Issue

- **351+ thumbs up** — massive community demand
- Labels: **"Suggestion"**, **"Awaiting More Feedback"** — RyanCavanaugh himself added these
- **Not rejected**
- robbiespeed proposed that any function call should reset all narrowing unless the function is marked pure — conceptually similar to our `mutator` approach

### Framework Author Support

Multiple framework authors have publicly supported identity/stable narrowing:

| Person | Role | Position |
|--------|------|----------|
| alxhub | Angular team | Argued extensively; Angular explored implementing in their language service and concluded it was infeasible at that level |
| ryansolid | Solid creator | Strongly supported |
| dummdidumm | Svelte team | Supporters of identity narrowing |

alxhub specifically noted:
- Workarounds (extracting to temp variables) may alter behavior
- The soundness tradeoffs are the same as property narrowing
- Framework-level solutions are infeasible

---

## 5. Precedent: Accepted TypeScript Modifiers and Keywords

| Keyword | Version | Type | Declaration-site? |
|---------|---------|------|-------------------|
| `readonly` | TS 2.0 | Property modifier | Yes |
| `abstract` | TS 1.6 | Class/method modifier | Yes |
| `!` (definite assignment) | TS 2.7 | Variable assertion | Yes |
| `asserts` | TS 3.7 | Return type modifier | Yes |
| `override` | TS 4.3 | Method modifier | Yes |
| `in`/`out` (variance) | TS 4.7 | Generic parameter modifier | Yes |
| `using` | TS 5.2 | Declaration keyword | Yes |
| `accessor` | TS 4.9 | Property modifier | Yes |
| `as const` | TS 3.4 | Expression modifier | **No** |
| `satisfies` | TS 4.9 | Expression operator | **No** |

Our modifiers fit squarely in the same category as `readonly`, `abstract`, `override`, and `asserts` — all declaration-site type annotations that passed TS team review.

### The `satisfies` Precedent

`satisfies` is the most relevant precedent for evaluating our proposal's chances:

- A **completely new keyword** added to TypeScript
- **Expression-level syntax** (appears after expressions) — more "invasive" than our declaration-site modifiers
- RyanCavanaugh **himself opened the feedback reset issue** and championed it
- Went through extensive community discussion
- Shipped in TypeScript 4.9
- Modifies the type system's understanding, not runtime behavior
- **Fully erasable**

If `satisfies` (expression-level, new keyword) was accepted, declaration-site modifiers like `stable` face a lower bar.

---

## 6. Component-by-Component Risk Assessment

### 6.1 `stable` Getter Narrowing — LOW RISK

| Factor | Assessment |
|--------|-----------|
| TS team engagement | RyanCavanaugh actively engaged on upstream proposal |
| Community demand | 105+ thumbs up (identity), 351+ (pure/impure) |
| Framework support | Angular, Solid, Svelte teams support |
| Design Goal alignment | Fully erasable, declaration-site, structural |
| Precedent | Same space as `readonly` — type-level property modifier |
| Current status | "Needs More Info" — not rejected |

**Key risk:** Naming debate (`stable` vs `identity` vs `pure`). The TS team may prefer a different keyword name, but the concept itself aligns with demonstrated need.

### 6.2 `mutator` Keyword — LOW-MEDIUM RISK

| Factor | Assessment |
|--------|-----------|
| TS team engagement | RyanCavanaugh **himself identified the need** |
| Design alignment | Declaration-site modifier, erasable |
| Community discussion | robbiespeed proposed similar concept; shicks suggested `mutating` |
| Precedent | Less novel than `asserts` was when introduced |

**Key risks:**
- Specific keyword name may be debated (`mutator` vs `mutating` vs `impure`)
- Semantics may differ from what the TS team envisions
- TS team might prefer a simpler model (any `mutator` call resets *all* narrowing on the receiver)

**Mitigant:** RyanCavanaugh's own quote directly calls for this feature: *"Doesn't this imply the need for additional syntax to identify which functions/methods invalidate the narrowing?"*

### 6.3 `invalidates` Clause — MEDIUM RISK

| Factor | Assessment |
|--------|-----------|
| Precedent | No direct precedent, but structurally similar to `asserts` return type syntax |
| TS team signal | Solves the problem RyanCavanaugh identified |
| Novelty | Novel syntax — only our proposal introduces this |

**Key risks:**
- TS team may prefer a simpler model (nuclear option: any `mutator` resets all narrowing on the receiver, no granular `invalidates`)
- TS team may prefer different syntax entirely
- Added complexity may push against the TS team's "complexity budget"

**Mitigant:** The alternative (nuclear invalidation) is demonstrably inferior for real-world APIs. A working implementation can show the difference.

### 6.4 Bare Parameter Support — MEDIUM RISK

| Factor | Assessment |
|--------|-----------|
| Upstream position | JoshuaKGoldberg explicitly deferred this in the upstream proposal |
| TS team signal | No explicit objection, but also no support |

**Key risk:** JoshuaKGoldberg's upstream proposal explicitly stated: *"The modifier not be allowed on function signatures with parameters to start."* The TS team may want to start with parameter-less functions only and extend later.

**Mitigant:** Parameter support is separable — can be added in a later phase without affecting the core feature.

### 6.5 Constrained-Overload Narrowing — MEDIUM-HIGH RISK

| Factor | Assessment |
|--------|-----------|
| Community discussion | Very few community members have discussed this behavior |
| Complexity | Complex interaction between overloads and narrowing |
| Precedent | No precedent in existing TS features |

**Key risks:**
- TS team may question soundness and performance impact
- After `set(42)`, narrowing `get()` to `number` — powerful but high complexity
- May be seen as over-engineering

**Mitigant:** This can be positioned as a separate, future enhancement rather than part of the core proposal.

### 6.6 Linked Type Predicates (`this.value() is string`) — HIGHER RISK

| Factor | Assessment |
|--------|-----------|
| Novelty | Very novel — no precedent in TS issues or community discussion |
| Complexity | Extends type predicate syntax significantly |
| Soundness | Cross-method type guards introduce complex soundness concerns |

**Key risks:**
- TS team may see this as too complex / not justified by use cases
- No community discussion or demand specifically for this pattern
- Soundness analysis is more complex than basic stable narrowing

**Mitigant:** Strictly optional — can be deferred indefinitely without affecting the value of `stable`/`mutator`/`invalidates`.

---

## 7. Risk Matrix Summary

| Component | Risk | Key Factor | Recommendation |
|-----------|------|------------|----------------|
| `stable` getter narrowing | **LOW** | Ryan engaged, massive demand | Ship as core feature |
| `mutator` keyword | **LOW-MEDIUM** | Ryan identified the need himself | Ship as core feature |
| `invalidates` clause | **MEDIUM** | Novel but solves Ryan's concern | Ship as core, accept simplification |
| Bare parameter support | **MEDIUM** | Upstream deferred explicitly | Defer to Phase 2 |
| Constrained-overload narrowing | **MEDIUM-HIGH** | Complex, not community-discussed | Defer to Phase 3+ |
| Linked type predicates | **HIGHER** | Very novel, no community support | Defer indefinitely |

---

## 8. Exacerbating Risk Factors

These factors could increase rejection risk across all components:

1. **RyanCavanaugh prefers workarounds first.** He suggested `PossibleFuncs<T>` and `const v = value()` before considering new syntax. The proposal must demonstrate that workarounds are insufficient.

2. **"Needs More Info" means more justification needed.** The TS team wants concrete evidence, not just theoretical arguments. A working implementation with real-world examples is essential.

3. **No TC39 coordination.** If the TC39 Signals proposal introduces its own narrowing approach, the TS team may defer to that standard rather than adopt custom syntax.

4. **Soundness extension risk.** Property narrowing tradeoffs are accepted, but *extending* them may face higher scrutiny. Each new unsound edge case must be justified.

5. **Complexity budget.** The TS team carefully guards against feature creep. Proposing too many features at once (stable + mutator + invalidates + linked predicates + constrained-overload) risks being seen as scope creep.

---

## 9. Mitigating Factors

1. **Running on typescript-go fork.** The implementation can be demonstrated without requiring upstream merge. This derisks the proposal by providing working proof.

2. **Incremental adoption path.** The features are separable: `stable` alone is useful, `mutator` adds value independently, `invalidates` enhances `mutator`. Each can ship separately.

3. **Full Design Goal compliance.** Fully erasable, declaration-site, structural — the proposal violates no Design Goals.

4. **Structural typing integration.** `stable` participates in structural subtyping naturally, following existing TypeScript patterns.

5. **Broad framework demand.** Angular, Solid, Vue, and Svelte all have use cases for identity-preserving narrowing.

6. **Working implementation.** A working proof-of-concept in typescript-go is vastly more convincing than a markdown proposal. The TS team can evaluate real behavior, not hypotheticals.

---

## 10. Alternative Approaches the TS Team Might Prefer

| Alternative | Description | Our Response |
|-------------|-------------|-------------|
| Built-in type (`Identity<T>`) | Generic type alias instead of keyword | Less ergonomic, harder to compose with existing types |
| Decorator-based | `@stable` decorator on methods | Runtime semantics, not erasable, violates Goal 3 |
| Nuclear invalidation only | Any `mutator` resets ALL narrowing | Acceptable simplification for v1 — we should be prepared to accept this |
| Parameter-less only | `stable` only on zero-arg functions | Acceptable for v1 — bare parameter support can come later |
| Comment pragma | `// @stable` comment annotations | Precedent exists (`// @ts-ignore`) but less ergonomic and harder to type-check |

---

## 11. Actionable Recommendations

### Must Do
1. **Lead with `stable` + `mutator`.** These have the strongest TS team signal and community demand.
2. **Demonstrate with real framework code.** Angular Signals, SolidJS, Vue refs — show concrete before/after.
3. **Accept nuclear invalidation as v1 fallback.** If the TS team pushes back on granular `invalidates`, pivot to "any `mutator` call resets all narrowing on the receiver."
4. **Prepare parameter-less-only fallback.** Be ready to defer bare parameter support.

### Should Do
5. **Prepare naming alternatives.** Have answers ready for `stable` vs `identity` vs `pure` debate.
6. **Document soundness boundaries explicitly.** Show where unsoundness can occur and why the tradeoff is acceptable (same as property narrowing).
7. **Benchmark performance impact.** The TS team will ask about checker performance — have numbers ready.

### Defer
8. **Linked type predicates** — too novel, no community demand for the specific pattern.
9. **Constrained-overload narrowing** — too complex for initial proposal.
10. **Cross-method type guards** — interesting but untested; save for subsequent proposal.

---

## 12. Conclusion

The `stable`/`mutator`/`invalidates` proposal is **well-positioned for acceptance** in its core form. The strongest evidence:

- RyanCavanaugh actively engaged with the upstream identity modifier proposal and identified the need for invalidation syntax — precisely what we provide.
- 351+ community thumbs-up on the pure/impure narrowing issue, with framework authors from Angular, Solid, and Svelte supporting.
- The proposal fully complies with every TypeScript Design Goal.
- The `satisfies` precedent proves TypeScript accepts new keywords when they solve real problems.

The primary risks are around **scope** (too many features at once), **naming** (keyword choice), and **complexity** (advanced features like linked predicates). These are manageable through incremental shipping and willingness to accept simplifications.

kitsonk's comment about expression-level syntax being an "anti-pattern" is factually incorrect, comes from a non-team contributor, and should not influence our approach.

**The path forward is clear: ship a working implementation of `stable` + `mutator` (with nuclear invalidation as the default), demonstrate with real framework code, and iterate based on TS team feedback.**
