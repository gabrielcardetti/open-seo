---
name: content-brief
description: "Build a competitive content brief for one keyword or page: intent, the pages it has to beat, gaps, an H2/H3 outline, meta tags, information gain, trust signals, and internal links. Use when the user asks for a content brief, writing brief, outline, or how to improve an existing page for a keyword."
---

# OpenSEO Content Brief

## Goal

Answer: "What would a page need to say, and how should it be built, to deserve a top result for this query on this site?"

The brief is for whoever writes the page: a business owner, a writer, or another agent. It works in two modes:

- **New page**: the user gives a keyword or topic and no page exists yet.
- **Improve page**: the user gives an existing URL. Keep what already works and name the sections to strengthen or add. Do not propose a rewrite when targeted changes would close the gap.

For many keywords at once, run `keyword-clustering` first and brief one cluster at a time.

## Required inputs

- `projectId`
- A target keyword or topic, or an existing URL (and optionally its keyword)
- Optional page type (guide, service page, product page, category, comparison, tool)
- Optional location/language

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first. The business overview and positioning decide which subtopics this site can credibly cover; the key pages are the first internal-link targets; writing preferences set the tone of the outline notes.
2. This skill needs `business_overview`. If it is empty, infer what the business does from the site, confirm it with the user in one question, write it back with `update_project_context`, and continue. Suggest `seo-project-setup` at the end for the rest.
3. Before spending credits, check the research log. If the same keyword was researched within the last 30 days, reuse that result and say so instead of re-buying it.
4. On finish, write back what is durable with `update_project_context` (the target page via `addKeyPages` with its topic, role `spoke` or `hub`) and append a research log entry: `{ appendResearchLog: { summary: "Content brief: <keyword>. Verdict: <page type, angle>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "content-brief"`. If that skill is not available, say so and stop before writing HTML.

## OpenSEO MCP tools

- `get_keyword_metrics`: volume, difficulty, intent, and trend for the primary keyword and the secondary terms you plan to use. One batch is usually enough.
- `research_keywords`: one seed call when the user gives only a topic and you need the primary keyword and its close variants.
- `get_serp_results`: the live SERP for the primary keyword (depth 20). Ranking URLs and each row's `type` (organic, featured snippet, people also ask, video, local pack) show the format Google rewards. The rows do not list the People Also Ask questions themselves; read those from a web search when you need them. Send related queries in the same call, up to 10.
- `get_ranked_keywords` with `scope: "exact_url"`: in improve mode, which queries the page already earns and where it sits.
- `get_search_console_performance`: in improve mode, when connected, filter by the page (`dimensions: ["query"]`, a `page` filter) to see the real queries, impressions, and position. These queries often name subtopics the page never answers.
- `get_audit_pages`: the site's crawled pages, for real internal-link targets and to check that no other page already targets this keyword. Use `urlContains` to narrow.
- Web reading (fetch, scrape, or search): read the main content of the top results and of the user's page. SERP rows alone do not show what a page covers.

## Workflow

1. Settle the target. Pick the primary keyword from the user's input, `research_keywords`, or the page's Search Console queries. Confirm demand with `get_keyword_metrics`. If the keyword has no measurable demand, say so and ask before continuing.
2. Check for cannibalization. Look for an existing page on the site that already targets the keyword (`get_audit_pages`, Search Console `["query","page"]`). If one exists, switch to improve mode on that page instead of briefing a duplicate.
3. Read the SERP. Call `get_serp_results`. Classify the intent (informational, commercial, transactional, navigational) and the dominant page type and format: long guide, list, comparison table, landing page, tool, video, local pack. If the dominant type does not match the page the user wants to build, say so first; `search-experience` covers that diagnosis in depth.
4. Read the competition. Pick the top 3–5 organic results that compete for the same reader. Skip encyclopedias, forums, marketplaces, and social platforms unless they dominate the SERP, in which case note it. For each, record the H2 sections, the approximate length, what it does well, and its main gap.
5. Find the gaps:
   - **Topic gaps**: subtopics the reader needs that competitors skip.
   - **Depth gaps**: subtopics covered thinly.
   - **Quality gaps**: outdated facts, no first-hand experience, unsourced claims, poor structure.
   Use Search Console queries and People Also Ask questions (from a web search) as evidence of what readers ask.
6. Apply the relevance rule. Keep only the headings, subtopics, and questions this business can credibly write about given what it offers. Do not copy competitor sections about things the site does not do.
7. Build the outline: H1, URL slug, then the H2/H3 structure. For each section give its purpose, the format (paragraph, table, steps, definition, comparison), roughly how much it needs to say, and which keyword or question it covers. Put the direct answer to the main question near the top. For hub pages, include every relevant child page or category that exists on the site, each with an internal link.
8. Write the meta: a title of about 50–60 characters with the primary keyword near the front, and a meta description of about 130–155 characters that expands on the title. Match the site's existing title pattern.
9. Name the information gain: the specific thing this page will offer that no current result does: original data, first-hand experience, a worked example, a calculator, a clearer comparison. "More detail" or "better formatting" does not count. If you cannot name one, say the page is unlikely to outrank the current results and suggest a different angle or keyword.
10. List the trust signals the topic needs: a named author or team with relevant background, cited primary sources with dates, a last-updated date that reflects real changes. Raise the bar for health, money, legal, and safety topics.
11. Pick 3–5 internal links: pages that should link to the new page and pages it should link out to, each with descriptive anchor text, chosen from crawled URLs or key pages. Say whether the page is a hub or a spoke.

## Output format

`h1`: the primary keyword (new page) or the page URL (improve mode).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The brief in one line** — the page to build or change, the format the SERP rewards, and the angle that wins.
2. **Search intent** — intent type, the format and page type the SERP rewards, and who is searching. Three or four lines.
3. **What ranks now** — a table of URL, page type, key sections, approximate length, and main gap.
4. **Gaps to fill** — topic, depth, and quality gaps, each with its evidence.
5. **Outline** — H1, slug, and the H2/H3 structure with per-section notes. In improve mode, label each section keep, strengthen, or add.
6. **Meta tags** — title and meta description, with character counts.
7. **Information gain** — one paragraph naming what is new.
8. **Trust signals** — the specific signals the page needs.
9. **Internal links** — a table of source page, target page, and anchor text.
10. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://openseo.so/docs/skills/content-brief` ("OpenSEO Content Brief skill"), then the query, country, language, and date of the SERP check.

When the user asks for "just an outline", deliver sections 1, 5, and 6 only.

## Guardrails

- Do not set a keyword density target or a fixed word count. Length follows what the topic and the competing pages need; say "about as long as the strongest results" rather than inventing a number.
- Do not invent facts, statistics, or quotes for the writer. Mark where they need a sourced number.
- Do not recommend FAQ or HowTo markup for rich results; Google no longer shows them. Suggest structured data only where it describes the page accurately.
- Do not name SEO tools, frameworks, or researchers in the brief. Write plain advice a writer can follow.
- One SERP snapshot is not a trend. Date every ranking observation.
