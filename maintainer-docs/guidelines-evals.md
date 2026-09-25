# Guideline evals

The guideline audit judges pages against `src/shared/guidelines/catalog.json`. The golden set checks that its verdicts are right. It has realistic pages, each with the verdict a careful reviewer would give it. It runs at two levels:

|                     | What it checks                                                                                                                             | Cost                      | Where                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------- |
| Deterministic suite | Classification, the deterministic rules, verdict arithmetic, and whether the workflow and MCP paths agree. A stub judge answers perfectly. | None. Runs in `pnpm test` | `src/server/lib/guidelines/golden/golden.test.ts` |
| Live eval           | The real judges on the same pages                                                                                                          | Model calls               | `scripts/guidelines-golden-eval.ts`               |

Both score cases with `caseProblems()` in `golden/golden-cases.ts`, so they agree on what counts as a failure.

## Running

```sh
pnpm vitest run src/server/lib/guidelines/golden

# Live eval. Judges come from the same variables the Worker reads:
# GUIDELINES_JUDGE, GUIDELINES_DECISION_MODEL, CLASSIFIER_API_KEY,
# GUIDELINES_API_KEY (or OPENROUTER_API_KEY), GUIDELINES_MODEL, GUIDELINES_BASE_URL.
# .env.local and .env are loaded.
pnpm eval:guidelines --dry-run                             # no judges, no cost
pnpm tsx scripts/guidelines-golden-eval.ts --runs 3        # stability across runs
pnpm tsx scripts/guidelines-golden-eval.ts --case spam- --json > eval.json
```

The Workers AI `gateway` route needs the Worker's `AI` binding, so from Node it resolves to no decision model. To evaluate Jev, use `GUIDELINES_DECISION_MODEL=classifier`.

The live eval exits 1 when a gate fails or an evaluation errors:

- **False-reject rate** is the share of legit evaluations with verdict `reject`. The gate is 0.
- **Spam recall** is the share of spam and technical evaluations that reach `verdict_min`. The gate is at least 90%. It is not measured in `--dry-run`, because nothing can reach a spam verdict without a judge.

It also reports the following, without gates:

- **Per-rule false fails and misses.** A false fail is a `must_not_fail` rule that failed. A miss is a `must_fail` rule that did not fail. The rule at the top of the list is the prompt or rule to look at first.
- **Evidence grounding.** This is the share of judged `fail` and `warn` quotes that are the page's own words, checked with the same `isGroundedQuote()` production uses before a judged fail can count (a fail whose quote is not on the page is stored as a warning). A low number means the judge paraphrases instead of quoting, which silently turns its failures into warnings.
- **Verdict stability.** This is the share of cases whose verdict is the same in every run. It needs `--runs 2` or more.

Run the live eval before merging a change to a prompt, the judge model, or a critical rule. Put the summary line in the PR.

## Case format

`golden/cases.json` holds one entry per case. `page` is a `FetchedPage`: the fetcher's output, not raw HTML. `spamSignals` defaults to none, so give it only when a case needs one. `expected` holds these fields:

| Field           | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `verdict_max`   | Legit cases: the worst acceptable verdict (`pass < pass_with_warnings < revise < reject`) |
| `verdict_min`   | Spam and technical cases: the mildest acceptable verdict                                  |
| `must_fail`     | Rules that must fail. Clear-cut only.                                                     |
| `must_not_fail` | Rules that must not fail. `warn`, `unknown` and not applicable are fine.                  |
| `must_not_pass` | Rules no evaluator may close, such as ones that need rendering                            |
| `ymyl`          | The expected `classifyPage(page).ymyl`                                                    |

`notes`, `regression_for` and `known_gap` are prose for the next reader. `known_gap_checks: ["ymyl"]` marks a classification the code still gets wrong. The suite asserts that the gap is still open, so the case fails once someone fixes it. Then update `ymyl` and remove the gap.

## What the deterministic suite asserts

For every case, `it.each` runs three checks:

1. **No judge.** Deterministic rules alone never contradict the case. No `must_not_fail` rule fails, and a legit verdict stays within `verdict_max`. A `must_fail` rule may be unanswered, but it never passes.
2. **A perfect judge.** The judge fails exactly `must_fail`, with a quote, and the case holds in full: verdict bounds, `must_fail` applicable and failing, and YMYL classification.
3. **MCP parity.** The perfect judge's failures go through `outcomesFromSubmission`, the function the MCP submit tool calls, and must reach the same verdict as `evaluatePage`.

A separate test lists the judged rules whose failure alone rejects a page. Each one is a single point of false-reject exposure. If a catalog change adds a rule to the list, update the list on purpose and say why in the PR.

## Extending the set

- **Add a case for every disputed production verdict,** especially false rejects. Anonymise the page. Say in `regression_for` which run or bug it comes from.
- **Keep pages realistic but short.** Include the footer noise that trips classifiers ("Aviso legal", "Pago seguro"), because that is where false positives come from. `wordCount` must match `bodyText`.
- **Only clear-cut rules go in `must_fail`.** Put anything arguable in `notes`, or in `must_not_pass` if a `fail`, `warn` or `unknown` result would all be acceptable.
- **Removed or renamed rules fail the case** with "is not in the catalog". Update the case in the same PR as the catalog change.
- **Pattern rules** (`scope: "both"`, such as SPAM-02 doorways) are capped at `high` when judged on one page, so a single page can only reach `revise` on them. Site-level expectations need a site-scope pass, and none exists yet.
