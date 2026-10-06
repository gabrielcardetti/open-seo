---
name: ai-search-optimization
description: "Check whether a site can be found, read, and cited by AI answers (Google AI Overviews and AI Mode, ChatGPT, Copilot, Perplexity, Claude), measure what AI assistants already send, and find the pages and fixes most likely to earn citations. Use when the user asks about GEO, AEO, AI Overviews, LLM visibility, AI citations, or AI assistant traffic."
---

# OpenSEO AI Search Optimization

## Goal

Answer: "Do AI answers cite this site, what stops them, and what would make its pages the source worth citing?"

Google says it plainly in its guide to generative AI features: "optimizing for generative AI search is optimizing for the search experience, and thus still SEO." AI Overviews and AI Mode retrieve pages from the regular Search index, and other assistants work from their own crawls and indexes. This skill treats it as SEO and checks three things in order: whether the AI systems can reach and use the pages, what they already cite and send, and whether the content is the kind worth citing.

Use `seo-audit` for a general site review and `content-brief` to rebuild a page once you know it should be the cited source.

## Required inputs

- `projectId`
- The site, or specific pages or topics to check
- Optional queries or prompts the business wants to appear for
- Optional location/language

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first. The business overview and positioning decide which questions an AI answer should cite this site for; the key pages are the first candidates.
2. This skill needs `business_overview`. If it is empty, infer it from the site, confirm it with the user in one question, write it back with `update_project_context`, and continue.
3. Check the research log and reuse scans and research under 30 days old.
4. On finish, write back the pages that should be the cited source via `addKeyPages`, and append `{ appendResearchLog: { summary: "AI search optimization: <site>. Verdict: <conclusion>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "ai-search-optimization"`. If that skill is not available, say so and stop before writing HTML.

## OpenSEO MCP tools

- `get_agent_readiness` (free; `run_agent_readiness_scan` for a fresh one): robots.txt rules per AI crawler, Content Signals, content visible without JavaScript, markdown delivery, soft 404s, and whether AI user agents are served or blocked by a firewall. Each check carries its evidence and fix.
- `get_audit_pages` and `get_audit_issues`: status, indexability, `noindex`, canonicals, and robots directives for the pages that matter. A page with `nosnippet` or a tight `max-snippet` cannot be quoted in Google's AI features.
- `inspect_urls`: Google's index state for up to 10 key pages. Google requires a page to be indexed and eligible for a snippet before its AI features can use it.
- `get_ranked_keywords` with `resultTypes: ["ai_overview_reference"]`: the queries where Google's AI Overview already cites the domain or a page. Run it for the site and for one or two competitors to compare.
- `get_serp_results`: the live SERP for a few target questions; rows of `type` `ai_overview` show whether an AI Overview appears.
- `get_umami_ai_referrals`: visits from AI assistants (ChatGPT, Perplexity, Copilot, Gemini, Claude, others) by referrer and by `utm_source`, with the landing pages and a daily trend.
- `get_bing_ai_citations`: how often Copilot and Bing's AI answers cited the site, the most-cited pages, and the grounding queries, for periods where the AI Performance export was imported.
- `get_guideline_results`: the content-guideline verdicts. The rules most relevant here are automated content quality (AI-03), one-page-per-query-variant fan-out (AI-04), accurate titles, alt text, and markup (AI-05), and content built to manipulate AI answers (SPAM-16), alongside the people-first and E-E-A-T rules. Run `run_site_audit` with `evaluateContent: true` (add `engines: ["google","bing"]` when Copilot matters) if there are no verdicts yet.
- `get_search_console_performance`: queries and pages from Google Search. Search Console's Generative AI performance report is only in the Search Console interface; ask the user for it when the AI share of Google traffic matters.
- `get_ai_brand_visibility` shows how often ChatGPT and Google AI Overviews mention the brand, which pages they cite, and Share of Voice against competitors (about 1,000 credits; confirm before running). `explore_ai_prompt` runs one prompt through chosen models and returns the answer, cited sources, and whether the brand is named (about 50–230 credits per model). Use them when prompt-level visibility is the question.
- Web reading (fetch, scrape, or search): the pages themselves, the sources AI answers cite for the target questions, and the brand's presence on the sites those answers draw from.

## Workflow

1. Access first. Read `get_agent_readiness`; it tests GPTBot, OAI-SearchBot, ClaudeBot, and PerplexityBot. Read `/robots.txt` yourself for the others (Claude-SearchBot, Google-Extended, Bingbot). Report each AI crawler by what it controls, and never mix them up:
   - `Googlebot` decides Google Search, AI Overviews, and AI Mode. `Google-Extended` only controls use for Gemini training and grounding; blocking it does not remove the site from Search or AI Overviews.
   - `OAI-SearchBot` decides ChatGPT search citations; `GPTBot` is OpenAI's training crawler.
   - `Claude-SearchBot` decides citations in Claude's search; `ClaudeBot` is Anthropic's training crawler.
   - `PerplexityBot` decides Perplexity's index; `Bingbot` feeds Copilot and Bing's AI answers.
   Blocking a training crawler is a licensing choice, not a visibility problem. Blocking a search crawler, or a firewall that challenges it, is.
2. Eligibility. For the key pages, check indexability, canonical, and snippet directives (`get_audit_pages`), and Google's index state (`inspect_urls`). Content that only appears after JavaScript runs is a risk for assistants whose crawlers read raw HTML; the agent-readiness scan reports it.
3. Current visibility. Pull `get_ranked_keywords` with `ai_overview_reference`, `get_umami_ai_referrals`, and `get_bing_ai_citations`. Note which pages are cited or visited and for which questions. Missing connections are coverage gaps, not findings.
4. The questions that matter. Build 5–10 questions or prompts from the business's offer and the user's input. Check the SERP for a few with `get_serp_results`, and see who AI answers cite for them (web search, or `explore_ai_prompt` for a few key prompts).
5. Content worth citing. For each key page and each question, read the page and ask:
   - Does it give a direct, specific answer early, in its own words, with facts a reader could check?
   - Does it offer something the commonly cited sources do not: first-hand experience, original data, a worked example, a current figure with its date?
   - Is it clear who wrote it and why they know, and when it was last really updated?
   - Is it one strong page for the topic, or one of many thin variants written for slightly different phrasings?
   Use the guideline verdicts as leads and quote the page.
6. Entity and brand. Check that the site states plainly who the business is, what it offers, and where, and that this matches its Google Business Profile, Merchant Center feed, and the profiles AI answers draw from. Google names Merchant Center and Business Profiles as ways products and businesses show up in AI responses.
7. Recommend. Order the fixes: access blockers, then eligibility, then the pages that should be cited but are weaker than the sources cited today.

## Output format

`h1`: the site.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The verdict** — whether AI answers can use the site today and the single change most likely to earn citations.
2. **Access and eligibility** — a table of crawler or check, what it controls, its status, and the fix, then the key pages' index and snippet state.
3. **What AI already cites and sends** — AI Overview references, AI assistant visits, and Copilot citations, with the pages behind them.
4. **The questions that matter** — a table of question, who is cited now, and whether the site has a page that deserves the citation.
5. **Pages to strengthen** — one finding per page: what is missing, quoted from the page, and the change.
6. **What to do next** — an ordered list, ending in `content-brief` for the first page to rebuild.
7. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://openseo.so/docs/skills/ai-search-optimization` ("OpenSEO AI Search Optimization skill"), then the date of each scan and SERP check and the connections that were missing.

## Guardrails

- Do not recommend `llms.txt` as a way to appear in Google: Google says its Search ignores these files. Report it as optional for other systems at most.
- Do not recommend splitting content into small chunks, rewriting it in AI-style phrasing, adding special AI markup, or chasing mentions on other sites. Google's guide rejects all four.
- Do not recommend a page per query variation. That is the fan-out pattern Google calls scaled content abuse.
- Do not present third-party correlation studies as rules. Quote them with source and date, or leave them out.
- AI answers vary by user, location, and day. A single check is a snapshot; date it.
- No tool, OpenSEO included, sees inside Google's or any assistant's ranking systems. Present findings as evidence and judgment, not as a score.
