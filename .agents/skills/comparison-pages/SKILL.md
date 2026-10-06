---
name: comparison-pages
description: "Plan or review \"X vs Y\", \"alternatives to X\", and \"best X\" pages: which ones to build from real demand, how to structure them, an honest feature matrix with sources, and markup that describes the page accurately. Use when the user asks for a comparison page, a versus page, an alternatives page, or a review of existing ones."
---

# OpenSEO Comparison Pages

## Goal

Answer: "Which comparison pages are worth building for this business, and what does each one need so a buyer trusts it and Google ranks it?"

People searching "X vs Y" or "X alternatives" are close to a decision. A page that answers their question fairly converts well; a page that only praises the owner's product loses the reader's trust and rarely ranks. This skill picks the comparison queries with real demand, then plans or reviews each page.

Use `competitor-analysis` to study one competitor's SEO in depth, and `content-brief` for the full outline of one page once it is chosen.

## Required inputs

- `projectId`
- The user's product or service, or the site
- Optional competitors to compare against
- Optional existing comparison pages to review
- Optional location/language

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first. The saved competitors are the starting roster; the positioning says where the user's product genuinely wins and for whom.
2. This skill needs competitors. If none are saved, ask the user who buyers compare them with, or propose a shortlist from `find_serp_competitors` and confirm it, write it back with `update_project_context` (`addCompetitors`), then continue.
3. Before spending credits, check the research log. Reuse keyword or SERP results under 30 days old and say so.
4. On finish, write back the planned or reviewed pages via `addKeyPages` with the query each targets, and append `{ appendResearchLog: { summary: "Comparison pages: <product>. Verdict: <pages to build or fix>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "comparison-pages"`. If that skill is not available, say so and stop before writing HTML.

## OpenSEO MCP tools

- `get_keyword_metrics`: demand and difficulty for the comparison queries you build from the roster: "<brand> vs <competitor>", "<competitor> vs <brand>", "<competitor> alternatives", "best <category>", "<competitor> pricing". One batch.
- `research_keywords`: one seed per main competitor ("<competitor> alternative") when you need the variants buyers actually use.
- `get_serp_results`: who ranks for the comparison queries that matter (depth 20, up to 10 queries per call). Review sites, marketplaces, and the competitors' own comparison pages show what the page has to beat.
- `get_ranked_keywords`: comparison and alternative queries a competitor already ranks for (filter the rows for "vs", "alternative", "compare"). Their own "vs" pages are evidence of demand.
- `get_search_console_performance`: when connected, queries containing competitor names (`filters: [{dimension: "query", operator: "contains", expression: "<competitor>"}]`) and the pages that get them.
- `get_audit_pages` with `urlContains: "vs"` or `"alternative"`: existing comparison pages on the site, their status and indexability.
- Web reading (fetch, scrape, or search): each competitor's pricing, feature, and documentation pages. Every claim in the matrix comes from there or from the user.

## Workflow

1. List the candidate pages: one "X vs Y" per serious competitor, one "alternatives to X" for each competitor whose buyers are a good fit, and one "best <category>" roundup if the business can credibly publish one.
2. Size the demand with `get_keyword_metrics`. Drop pages with no measurable demand unless sales says buyers ask the question; mark those "for sales, not search".
3. Check the SERP for the ones you keep. If a competitor's own page and a few review sites hold the top results, a fair, specific page can compete. If the results are all large review sites, say the page will mostly serve buyers who already know the brand.
4. Check what exists. Existing pages get a review in place of a new plan. An existing page that is thin or one-sided is the first fix.
5. Collect the facts for each competitor from its own pricing, feature, and documentation pages: plans and starting price, the features buyers ask about, limits, and who it suits. Note the URL and the date for each fact. If a fact cannot be verified, leave it out or ask the user.
6. Plan each page:
   - **X vs Y**: who each product is for, a feature matrix with "yes / partial / no" and a source link per competitor cell, pricing as of a date, a fair verdict that names when the competitor is the better choice, and a clear next step.
   - **Alternatives to X**: why people leave X (from public reviews or the user's own sales notes), then each alternative with who it suits and its main trade-off. The user's product appears once, without hiding the others.
   - **Best <category>**: stated ranking criteria first, then each option with the same structure. Only when the business has first-hand experience of the options.
7. Title and H1: match the query ("X vs Y: <the real difference>", "<N> X alternatives for <use case>"). Keep the year only if the page is truly updated every year.
8. Markup: `BreadcrumbList` and `Article` or `WebPage` describe the page; an `ItemList` fits a roundup. Do not mark up competitors' products with `Product` or `AggregateRating`. Review snippets for products the page does not sell are against Google's guidelines, and self-serving ratings are ignored.
9. Internal links: link each comparison page from the pricing or product page and from the related competitor's alternatives page.

## Output format

`h1`: the product or the site.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The plan** — how many pages to build or fix and which one first, in one or two sentences.
2. **Pages worth building** — a table of page, target query, monthly demand, who ranks now, and priority.
3. **Page plans** — one finding per page: the buyer's question, the angle, the sections, and the matrix rows with their sources. For existing pages, what to fix.
4. **Facts to verify** — the claims that still need a source or the user's confirmation.
5. **What to do next** — an ordered list, ending in `content-brief` for the first page.
6. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://openseo.so/docs/skills/comparison-pages` ("OpenSEO Comparison Pages skill"), then the queries checked and the date the competitor facts were read.

## Guardrails

- Every competitor claim needs a public source or the user's confirmation, with a date. Pricing changes; say "as of <date>".
- Say when the competitor is the better choice. A one-sided page loses the reader and invites legal trouble.
- Do not invent review scores, customer quotes, or migration stories.
- Do not use competitors' trademarks in a way that suggests affiliation.
- Do not build a page per competitor by swapping names into one template; each page needs facts specific to that comparison.
