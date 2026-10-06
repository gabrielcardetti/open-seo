---
name: programmatic-seo
description: "Plan or review pages generated at scale from data: templates, URL patterns, internal linking, indexing, and the safeguards that keep a page set from reading as thin or scaled content. Use when the user asks about programmatic SEO, template pages, location or integration pages at scale, or why a large generated section does not get indexed."
---

# OpenSEO Programmatic SEO

## Goal

Answer: "Does each page in this set give a searcher something worth finding, and is the set built so Google can crawl, index, and trust it?"

Pages generated from data (one per city, product, integration, term, record) can earn a lot of long-tail traffic. They can also turn into thousands of near-identical pages that Google crawls slowly, indexes partially, and may treat as scaled content abuse. This skill works in two modes:

- **Review**: an existing section of generated pages. Measure it with the crawl, the content-guideline judge, and Search Console, then say what to fix in the template, the data, or the scope.
- **Plan**: a set the user wants to build. Check the demand, the data, and the template before anything is published.

Use `seo-audit` for a whole-site review and `keyword-clustering` to decide which queries deserve their own page.

## Required inputs

- `projectId`
- The section's URL prefix (for example `/locations` or `/integrations`) or a description of the planned set
- Optional data source description (what each record holds)
- Optional location/language

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first. The business overview decides whether the set fits what the site is about; a section far from the site's main purpose is a risk in itself.
2. This skill needs `business_overview`. If it is empty, infer it from the site, confirm it with the user in one question, write it back with `update_project_context`, and continue.
3. Check the research log and reuse audits and research under 30 days old.
4. On finish, write back the section's hub page via `addKeyPages` (role `hub`) and append `{ appendResearchLog: { summary: "Programmatic SEO: <section>. Verdict: <conclusion>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "programmatic-seo"`. If that skill is not available, say so and stop before writing HTML.

## OpenSEO MCP tools

- `run_site_audit` with `includePaths: ["<prefix>"]` and a `maxPages` large enough to see the variety in the set, then `get_audit_status` (`waitSeconds: 50`, repeat). Crawling only the section spends the page budget where it matters.
- `get_audit_issues` with `groupBy: "template"`: one row per issue type and URL template, with page counts. A template problem is fixed once. Look first at `duplicate-content`, `thin-content`, `duplicate-title`, `duplicate-meta-description`, `canonical-conflict`, `orphan-page`, `deep-page`, and `noindex-page`.
- `get_audit_pages` with `urlContains`: word count, indexability, crawl depth, sitemap membership, and internal links per page.
- Content guidelines: `run_site_audit` with `evaluateContent: true`, or the audit's guideline batch judged by your own model (`get_guidelines_evaluation_batch` with `strategy: "sample"`, then `submit_guidelines_evaluation`). Read the whole-site verdict with `get_guideline_results`: its `site` item covers doorway pages, scaled content, and near-duplicate clusters (C1, C2…) judged from the crawl inventory. A fail there marks every page in the cited cluster.
- `get_search_console_performance` with a `page` filter `contains` the prefix: clicks and impressions per page. Many pages with zero impressions after a few months means Google is not indexing or not trusting the set.
- `inspect_urls`: Google's index state for a sample of up to 10 pages across the set. "Crawled, currently not indexed" or "Duplicate, Google chose different canonical" on many of them is the clearest signal.
- `get_sitemaps` and `get_indexing_candidates`: whether the set is in a tracked sitemap and whether `lastmod` reflects real data changes.
- `get_keyword_metrics`: in plan mode, demand for a sample of the queries the template would target (one per variant type, not all of them).
- `compare_audits`: after a template fix, re-audit the section and compare; `issues.common.byTemplate` shows what the fix moved.

## Workflow

1. Map the set. List the URL templates under the prefix (`get_audit_issues` with `groupBy: "template"` or the audit pages), count pages per template, and compare with how many records the data source holds.
2. Read pages, not just counts. Open three or four pages from the same template: one that gets traffic, one that gets none, and two random ones. Mark what changes between them (only a name or city, or real facts, numbers, local details) and what is shared boilerplate.
3. Apply the standalone test to each template: would this page be worth publishing if no sibling existed? A page passes when the data gives it facts a searcher needs that the siblings do not have. Swapping a city or product name into the same text fails.
4. Check the crawl signals for the template: duplicate and thin-content groups, duplicate titles or descriptions that follow one generated pattern, canonical conflicts, orphans (pages reachable only from the sitemap), and depth.
5. Check the judge's site verdict when there is one. A scaled-content or doorway finding on a cluster is the most serious result this skill can return; quote its evidence.
6. Check indexing. Sample `inspect_urls` across the set and pull Search Console for the prefix. Compare indexed or impression-earning pages with the number published.
7. Check the structure: a hub page that links to every page in the set (or to sub-hubs), related-record links between siblings, breadcrumbs, self-referencing canonicals, filtered or sorted variants pointing to the base page, and a sitemap with honest `lastmod`.
8. Decide per template: keep and strengthen (add the data that makes pages distinct), merge thin records into an aggregate page, noindex the weak ones and remove them from the sitemap, or stop generating them. In plan mode, decide which variants to launch first.
9. Roll out in batches. Recommend publishing or re-publishing in batches and watching indexing for a few weeks before the next.

## Output format

`h1`: the section or the planned set.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The verdict** — whether the set helps or hurts the site and the single change that matters most.
2. **The set at a glance** — a table of URL template, pages published, pages indexed or earning impressions, main issue, and decision.
3. **What makes pages distinct** — what actually varies between siblings, with examples quoted from the pages.
4. **Risks** — scaled content, doorways, index bloat, and crawl waste, each with its evidence.
5. **What to change** — one finding per template or structural fix, most impact first.
6. **What to do next** — an ordered list, including the re-audit and `compare_audits` check after the fix ships.
7. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://openseo.so/docs/skills/programmatic-seo` ("OpenSEO Programmatic SEO skill"), then the audit ID, the pages read, and the date of the Search Console range.

## Guardrails

- Judge from the pages, not only from counts and word totals. Short pages can be useful; long boilerplate is not.
- Do not set a uniqueness percentage or word count as a pass mark. Say what information the page is missing.
- A crawl sample of a large set is a sample. Say how many pages were crawled out of how many exist.
- Do not recommend publishing hundreds of new pages at once. Recommend batches and measurement.
- Recommend noindexing or removing pages only with evidence, and say what traffic, if any, they currently earn.
