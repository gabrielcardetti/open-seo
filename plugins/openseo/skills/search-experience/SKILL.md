---
name: search-experience
description: "Diagnose why a page does not rank or convert for its query when the cause is intent or page type. Compares what the SERP rewards against what the page is and says what to change. Use when a technically healthy page is stuck, ranks for the wrong queries, gets impressions without clicks, or the user asks whether a page matches search intent."
---

# OpenSEO Search Experience

## Goal

Answer: "Is this the kind of page Google wants to show for this query, and does it give the searcher what they came for?"

A page can be technically clean and well written and still never rank if it is the wrong type of page. When the results for a query are product pages and the page is a blog post, polishing the blog post will not close the gap. This skill compares the page against what the results reward, then recommends one change: restructure the page, add what it lacks, build a separate page, or target a different query.

Use `seo-audit` for site-wide problems and `content-brief` once you know what page to build.

## Required inputs

- `projectId`
- A page URL
- Optional target query. If missing, infer it from the page's Search Console queries or its title and H1, and confirm it.
- Optional location/language

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first. The business overview and current goal decide what a searcher should be able to do on this page (buy, book, sign up, learn), which sets what "conversion" means here.
2. This skill needs `business_overview`. If it is empty, infer what the business does from the site, confirm it with the user in one question, write it back with `update_project_context`, and continue.
3. Before spending credits, check the research log. Reuse a SERP or keyword check under 30 days old and say so.
4. On finish, write back the page via `addKeyPages` with the query it should own, and append `{ appendResearchLog: { summary: "Search experience: <url> for <query>. Verdict: <aligned | mismatch, severity>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "search-experience"`. If that skill is not available, say so and stop before writing HTML.

## OpenSEO MCP tools

- `get_search_console_performance`: when connected, the page's real queries (`dimensions: ["query"]` with a `page` filter). Impressions with few clicks at a good position point to a snippet or intent problem; queries the page ranks for but never targets point to an intent drift. Missing access is a coverage gap, not a blocker.
- `get_ranked_keywords` with `scope: "exact_url"`: the page's ranking queries when Search Console is not connected.
- `get_serp_results`: the live SERP for the target query and one or two close variants (depth 20, one call). Each row's `type` shows the result blocks present.
- `get_keyword_metrics`: intent and demand for the target query and the alternatives you might recommend.
- `get_audit_pages` with `urlContains`: status, indexability, canonical, word count, and links for the page, so a technical cause is ruled out before blaming intent.
- `get_google_analytics_organic_landing_pages` or `get_umami_organic_landing_pages`: when connected, engagement and key events for the page, to separate "doesn't rank" from "ranks but visitors leave".
- Web reading (fetch, scrape, or search): the page itself and the top results. Classifying page types needs the pages, not just their titles.

## Workflow

1. Rule out the technical causes. Check the page's status, indexability, and canonical with `get_audit_pages` (or by reading the page). If it is not indexable, stop: that is the finding, and intent analysis is premature.
2. Settle the query. Use the user's query, or the page's top Search Console query by impressions. If the page's queries scatter across different intents, say so; that is often the root problem.
3. Read the SERP. Call `get_serp_results` for the query. Classify each of the top 10 organic results by page type: product or category page, service or landing page, comparison or list, guide or how-to, tool or calculator, forum or community, video, local business, news. Note the blocks present: featured snippet, people also ask, local pack, video, shopping, AI overview.
4. Find the consensus. If one page type holds more than about 60% of the top 10, that is a strong consensus; 40–60% is mixed; below that the SERP is split, which leaves room for a differentiated page.
5. Classify the page with the same labels and compare:
   - **Aligned**: same type. The gap is depth, trust, or experience; go to step 6.
   - **Mismatch**: different type. Name the severity. A guide where the SERP shows products or services is critical; a guide where it shows comparisons, or a product page where it shows guides, is high; small format differences are medium.
6. Read the page as the searcher. Derive 3–5 searcher needs from the SERP (People Also Ask questions from a web search, the angles the top results lead with, related queries) and check each: is the answer findable within a few seconds, is there a clear next step, are there trust signals the topic needs, is anything blocking (intrusive pop-ups, a wall of text, missing prices or specs that competitors show)?
7. Decide the fix. In order of preference: adjust the page to match the dominant type when the business can honestly offer it; add the missing layer (a comparison table, pricing, a calculator, an educational section); create a separate page of the right type and link it from this one; or retarget this page to a query whose SERP matches what it already is.

## Output format

`h1`: the page URL.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The verdict** — aligned or mismatch (with severity), in one or two sentences, and the single change that matters most.
2. **What the results reward** — a table of position, URL, page type, and format, then the consensus share and the result blocks present.
3. **What this page is** — its type, its main promise, and where it stands now (queries, position, clicks, engagement when connected).
4. **Searcher needs** — a table of need, where it shows in the SERP, and whether the page meets it.
5. **What to change** — one finding per change, most important first, each tied to the evidence above.
6. **What to do next** — an ordered list, ending in `content-brief` when a new or rebuilt page is the answer.
7. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://openseo.so/docs/skills/search-experience` ("OpenSEO Search Experience skill"), then the query, country, language, and date of each SERP check.

## Guardrails

- Rule out indexing and canonical problems before diagnosing intent.
- Do not recommend a page type the business cannot honestly deliver (no product page without a product, no tool without a working tool).
- One SERP snapshot is not a trend. Date it, and treat a split SERP as an opening rather than a verdict.
- Do not score the page on a 0–100 scale; give the verdict and the evidence.
- Do not recommend FAQ or HowTo markup for rich results; Google no longer shows them.
