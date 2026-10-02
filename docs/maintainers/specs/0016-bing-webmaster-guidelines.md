# Bing Webmaster Guidelines in the guideline catalog

## Status

Accepted

## Context

A site audit can judge pages against a catalog of atomic rules taken from Google's documentation (people-first content, spam policies, generative-AI guidance, Search Essentials) and roll each page's results into a verdict: pass, pass with warnings, revise, or reject. Users compare those verdicts across audits with `compare_audits` to see whether their fixes worked.

Bing publishes its own Webmaster Guidelines, and Copilot grounds its answers in Bing's index, so Bing's guidance also decides which pages can be cited there. Much of it says what Google says: no cloaking, no scraped or scaled content, no link schemes, crawlable links. Some of it is Bing's alone: robots.txt as Bingbot reads it (a `bingbot` group replaces the `*` group instead of adding to it), `noarchive` and `nocache`, which keep a page out of Copilot answers, IndexNow, and advice on content a language model can ground an answer in. In two places Bing prefers something Google calls unnecessary: one main topic per URL, and key answers kept out of tabs and accordions.

Bing's help pages are a JavaScript app with no visible date. Bing rewrote them in February 2026, and the only way to notice a rewrite is to compare their text with what was quoted.

## Decision

Add Bing's guidelines to the same catalog, judge them only when the caller asks for them, and report a verdict per engine.

### One catalog, sources per engine

A rule lists one or more `sources`, each naming its engine, the source document, the URL, and the official quote. A rule's engines are derived from its sources. A concept both engines state is one rule with a Google source and a Bing source, judged once and counted for both. Sixteen of Google's rules gained a Bing source this way, among them cloaking, scraped content, scaled content abuse, crawlable links, and structured data that matches the visible page. Twenty-seven `BING-xx` rules hold what only Bing says. The catalog keeps a record for each Bing source document (the Webmaster Guidelines, the robots.txt and robots meta help articles, "How Bing delivers search results", and Microsoft Advertising's article on AI answers) with the URL its text can be fetched from and the date its quotes were last checked.

Bing's rules are routed like Google's. Binary and heuristic rules are settled in code against the crawl: whether robots.txt lets Bingbot in, robots directives in meta tags and `X-Robots-Tag` headers scoped to `bingbot`, soft 404s, temporary redirects, sitemap hygiene. A heuristic whose threshold is OpenSEO's choice rather than Bing's only ever warns. Judgment rules go to the model judge, and rules no model can close are recorded as `unknown` for a human. BING-30, content built to manipulate Bing's or Copilot's language models, is the one rule a detector can fail outright: text hidden from visitors that tells a model to drop its instructions or to recommend something. The same text in an HTML comment only warns.

One rule reads Bing's own data. BING-36 asks whether Bing Webmaster Tools reports an open crawl issue for the URL, from the snapshots the Bing sync stores (spec 0015). It has its own check type, `bwt`, and precondition, `has_bwt`, so it is asked only for projects with a Bing connection, and it answers `unknown` until the first sync.

### Conflicting rules only warn

A Bing rule that contradicts a Google rule names it in `conflicts_with`, with a note saying what each engine says. Its failure counts as a warning in the verdict arithmetic, whichever engine's verdict is being computed, and reports show it as a conflict with the note instead of as a fault. Two rules conflict today: BING-17 (one main topic per URL) with AIO-02, and BING-34 (answers not folded into tabs or accordions) with SPAM-05.

### Bing only when asked

An evaluation judges Google's rules unless the caller asks for more. `run_site_audit` (with `evaluateContent`), `get_guidelines_evaluation_batch` and `submit_guidelines_evaluation` take `engines`: `["google"]` by default, `["google","bing"]`, or `["bing"]`. In the app, turning on content evaluation when starting an audit shows a second switch, "Also check Bing's Webmaster Guidelines". The audit stores its engines in its configuration, and the batch and submit tools default to them. A page already judged for some engines is handed out again for the others, and submitting one engine's verdicts keeps the page's stored answers for the other.

### Per-engine verdicts, computed when read

Each URL still has one evaluation row, with one result row per rule that did not pass, and the stored verdict weighs every rule that was judged. Readers that show engines side by side recompute each engine's verdict from the stored results: they drop the other engine's rules and weigh the rest as they were stored. Which engines a row was judged for is read from its results too. Every evaluation stores human-review rules that only one engine has (PF-W10 and SPAM-03 for Google, BING-03 and BING-30's reviewer fallback for Bing) as `unknown`, so their presence marks the engine.

- `get_guideline_results` gives each page a `verdicts` map per engine. `verdict`, the `verdict` filter and `summary` follow `engine` (Google when it was judged), and `summary.by_engine` counts each engine.
- `compare_audits` keeps Google's verdict changes at the top of `guidelines` and puts Bing's beside them in `guidelines.bing` when either audit was judged against Bing.
- The audit's guidelines tab shows a Google/Bing switch with each engine's tallies when both were judged, and each finding's "What Google and Bing say" lists the quote from each engine.

### Keeping the quotes current

`pnpm check:bing-quotes` fetches each Bing source document, reduces it to text, and checks that every Bing quote in the catalog appears in it, after collapsing whitespace. It exits non-zero when a quote no longer matches. The guideline golden set has cases judged against both engines, and the live eval takes `--engines` to judge every case against a chosen set.

## Rationale

**Merged rules rather than a separate Bing catalog.** A separate catalog would judge cloaking twice on every page: two judge calls, and two answers that could disagree on the same evidence. A merged rule gives one answer with both citations, and its question and criteria are maintained in one place. The cost is that a merged rule's criteria must hold for both engines. Where they do not, the Bing guidance is its own rule, and where it contradicts Google, the rule says so in `conflicts_with`.

**Conflicting rules warn instead of failing.** A page that follows Google's guidance on accordions should not be sent back for revision because Bing's advice differs, and a Bing preference should not outrank Google's guidance or the reverse. Reporting the failure as a conflict keeps the advice in front of users who care about Copilot without blocking anyone who does not.

**Verdicts per engine computed at read time rather than stored in a column.** Recomputing needs no schema change and no rewrite of existing evaluations. For an evaluation of one engine it reproduces the stored verdict exactly, so every audit judged before Bing's rules existed reads the same as before. The price is that engine detection depends on the human-review rules that every evaluation stores; removing them from the catalog would need another marker per engine.

**Bing only when asked.** Judging Bing's rules on every evaluation would have changed verdicts on the next audit of an unchanged site, and `compare_audits` would have shown catalog changes as regressions. Opt-in keeps Google verdicts comparable across audits and spends judge calls on Bing's rules only for users who want them.

**A script for the quotes.** With no date on Bing's pages, a quote that stops matching is the only sign of a rewrite. A script that checks every quote finds that in seconds, and the `checked` date on each source document records which version the rules describe.

## Consequences

- An audit judged for both engines makes more judge calls than a Google-only audit. Its Google verdict comes from Google's rules alone; a rule both engines state counts in both verdicts.
- BING-36 is only as current as the last Bing sync, and is not asked without a Bing connection.
- Bing's guidance changes without notice. Re-run `pnpm check:bing-quotes` before editing Bing rules and periodically, update the rules and the `checked` dates when quotes stop matching, and re-run the live eval on the Bing cases after any change to a Bing rule.
- New engines follow the same pattern: sources tagged with the engine, `conflicts_with` where they contradict an existing rule, opt-in through `engines`, and a human-review rule unique to the engine so evaluations can be attributed to it.
