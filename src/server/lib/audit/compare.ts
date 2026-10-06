/**
 * What changed between two audits of the same site: the before/after that
 * tells whether a round of SEO fixes actually moved anything.
 *
 * Issues are matched by (issue type, URL), so a fixed title on one page shows
 * as resolved even when the same issue type is still present elsewhere.
 * Guideline verdicts are matched by URL, per search engine: Google's at the
 * top level as before, Bing's beside them when either audit was judged for
 * Bing. The whole-site verdict is not a page, so it is compared on its own and
 * kept out of the page counts.
 *
 * Pages are matched by URL; a page whose body-text hash differs is "changed".
 *
 * Two crawls of a large site rarely reach the same pages, so the whole-audit
 * counts mix real fixes with pages that merely entered or left the sample.
 * The `common` block repeats the issue comparison on the URLs both audits
 * crawled, overall and per URL template — which is how a template fix shows.
 *
 * Drift compares the SEO signals of each URL both audits crawled — canonical,
 * indexability, title, meta description, H1, Open Graph tags, structured
 * data — and names what changed, by rule and severity. Unlike issues, drift
 * catches a change that breaks nothing on its own: a rewritten title, a
 * canonical pointed elsewhere, a schema type swapped out.
 */
import { sort } from "remeda";
import { urlTemplateOf } from "./url-utils";

const VERDICT_RANK: Record<string, number> = {
  reject: 0,
  revise: 1,
  pass_with_warnings: 2,
  pass: 3,
};

interface EngineVerdicts {
  /** Page verdicts by URL. */
  verdicts: ReadonlyMap<string, string>;
  /** The whole-site verdict, when the audit has one. */
  siteVerdict: string | null;
}

/** What drift compares for one crawled URL. */
interface PageSignals {
  statusCode: number | null;
  /** The HTML canonical, else the Link header's. */
  canonicalUrl: string | null;
  isIndexable: boolean;
  title: string | null;
  metaDescription: string | null;
  h1Text: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  hasStructuredData: boolean;
  /** Sorted schema.org types; empty for audits that predate their storage. */
  schemaTypes: readonly string[];
}

/** Google's verdicts at the top level; Bing's when the audit was judged for it. */
interface AuditSnapshot extends EngineVerdicts {
  pageUrls: readonly string[];
  /** Body-text fingerprint by URL, for pages that have one. */
  contentHashes: ReadonlyMap<string, string>;
  /** Drift signals by URL. */
  signals: ReadonlyMap<string, PageSignals>;
  issues: ReadonlyArray<{ issueType: string; pageUrl: string | null }>;
  bing?: EngineVerdicts;
}

type Issue = { issueType: string; pageUrl: string | null };

interface IssueDelta {
  issueType: string;
  before: number;
  after: number;
  resolved: number;
  introduced: number;
}

interface VerdictChange {
  url: string;
  before: string;
  after: string;
}

const issueKey = (issue: Issue) =>
  `${issue.issueType}\u0000${issue.pageUrl ?? ""}`;

/**
 * Before/after counts per group, with how many issues were fixed and how many
 * are new. `groupOf` names the group and any extra fields it carries.
 */
function issueDeltas<T extends Record<string, string>>(
  base: readonly Issue[],
  current: readonly Issue[],
  groupOf: (issue: Issue) => T,
): Array<T & IssueDelta> {
  const baseKeys = new Set(base.map(issueKey));
  const currentKeys = new Set(current.map(issueKey));
  const groups = new Map<string, T & IssueDelta>();
  const entry = (issue: Issue) => {
    const fields = groupOf(issue);
    const key = JSON.stringify([issue.issueType, fields]);
    let delta = groups.get(key);
    if (!delta) {
      delta = {
        ...fields,
        issueType: issue.issueType,
        before: 0,
        after: 0,
        resolved: 0,
        introduced: 0,
      };
      groups.set(key, delta);
    }
    return delta;
  };
  for (const issue of base) {
    const delta = entry(issue);
    delta.before += 1;
    if (!currentKeys.has(issueKey(issue))) delta.resolved += 1;
  }
  for (const issue of current) {
    const delta = entry(issue);
    delta.after += 1;
    if (!baseKeys.has(issueKey(issue))) delta.introduced += 1;
  }
  return sort(
    Array.from(groups.values()),
    (a, b) => b.resolved + b.introduced - (a.resolved + a.introduced),
  );
}

function countVerdicts(verdicts: ReadonlyMap<string, string>) {
  const counts: Record<string, number> = {};
  for (const verdict of verdicts.values()) {
    counts[verdict] = (counts[verdict] ?? 0) + 1;
  }
  return counts;
}

function compareVerdicts(base: EngineVerdicts, current: EngineVerdicts) {
  const improved: VerdictChange[] = [];
  const worsened: VerdictChange[] = [];
  for (const [url, after] of current.verdicts) {
    const before = base.verdicts.get(url);
    if (!before || before === after) continue;
    const change = { url, before, after };
    if ((VERDICT_RANK[after] ?? 0) > (VERDICT_RANK[before] ?? 0)) {
      improved.push(change);
    } else {
      worsened.push(change);
    }
  }
  return {
    before: countVerdicts(base.verdicts),
    after: countVerdicts(current.verdicts),
    improved,
    worsened,
    site: { before: base.siteVerdict, after: current.siteVerdict },
  };
}

/** Drift rules and how much each matters. Order is the report's order. */
const DRIFT_RULES = [
  ["canonical-changed", "critical"],
  ["canonical-removed", "critical"],
  ["noindex-added", "critical"],
  ["title-removed", "critical"],
  ["h1-removed", "critical"],
  ["status-error", "critical"],
  ["structured-data-removed", "critical"],
  ["title-changed", "warning"],
  ["meta-description-changed", "warning"],
  ["h1-changed", "warning"],
  ["og-tags-removed", "warning"],
  ["schema-types-changed", "warning"],
  ["structured-data-added", "info"],
] as const;

type DriftRule = (typeof DRIFT_RULES)[number][0];

interface DriftChange {
  url: string;
  before: string | null;
  after: string | null;
}

const isOk = (status: number | null) =>
  status !== null && status >= 200 && status < 300;
const isError = (status: number | null) => status !== null && status >= 400;
/** Whitespace and padding differences are not edits. */
const normalized = (value: string | null) =>
  value?.replace(/\s+/g, " ").trim() || null;

/** The Open Graph tags a page sets. */
const ogTagsOf = (signals: PageSignals) =>
  [
    signals.ogTitle ? "og:title" : null,
    signals.ogDescription ? "og:description" : null,
    signals.ogImage ? "og:image" : null,
  ].filter((tag) => tag !== null);

/** The rules one URL's before/after signals break. */
function driftOf(before: PageSignals, after: PageSignals) {
  const changes: Array<[DriftRule, string | null, string | null]> = [];
  if (isError(after.statusCode)) {
    // Fetch errors on both sides are not drift; a recovery is not either.
    if (before.statusCode && !isError(before.statusCode)) {
      changes.push([
        "status-error",
        String(before.statusCode),
        String(after.statusCode),
      ]);
    }
    return changes;
  }
  // Redirects and other non-content responses carry no signals to compare.
  if (!isOk(before.statusCode) || !isOk(after.statusCode)) return changes;

  if (before.canonicalUrl && !after.canonicalUrl) {
    changes.push(["canonical-removed", before.canonicalUrl, null]);
  } else if (
    before.canonicalUrl &&
    after.canonicalUrl &&
    before.canonicalUrl !== after.canonicalUrl
  ) {
    changes.push([
      "canonical-changed",
      before.canonicalUrl,
      after.canonicalUrl,
    ]);
  }
  if (before.isIndexable && !after.isIndexable) {
    changes.push(["noindex-added", "indexable", "noindex"]);
  }

  const edits: Array<[DriftRule, DriftRule, string | null, string | null]> = [
    [
      "title-removed",
      "title-changed",
      normalized(before.title),
      normalized(after.title),
    ],
    [
      "meta-description-changed",
      "meta-description-changed",
      normalized(before.metaDescription),
      normalized(after.metaDescription),
    ],
    [
      "h1-removed",
      "h1-changed",
      normalized(before.h1Text),
      normalized(after.h1Text),
    ],
  ];
  for (const [removedRule, changedRule, was, now] of edits) {
    if (!was || was === now) continue;
    changes.push([now ? changedRule : removedRule, was, now]);
  }

  const afterOg = ogTagsOf(after);
  const removedOg = ogTagsOf(before).filter((tag) => !afterOg.includes(tag));
  if (removedOg.length > 0) {
    changes.push(["og-tags-removed", removedOg.join(", "), null]);
  }

  const beforeTypes = before.schemaTypes.join(", ");
  const afterTypes = after.schemaTypes.join(", ");
  if (before.hasStructuredData && !after.hasStructuredData) {
    changes.push(["structured-data-removed", beforeTypes || "JSON-LD", null]);
  } else if (!before.hasStructuredData && after.hasStructuredData) {
    changes.push(["structured-data-added", null, afterTypes || "JSON-LD"]);
  } else if (beforeTypes && afterTypes && beforeTypes !== afterTypes) {
    changes.push(["schema-types-changed", beforeTypes, afterTypes]);
  }
  return changes;
}

/**
 * Per-rule counts and changes for the URLs both audits crawled, in
 * DRIFT_RULES order, rules nothing broke left out.
 */
function compareSignals(base: AuditSnapshot, current: AuditSnapshot) {
  const changesByRule = new Map<DriftRule, DriftChange[]>();
  let urls = 0;
  for (const [url, after] of current.signals) {
    const before = base.signals.get(url);
    if (!before) continue;
    urls += 1;
    for (const [rule, was, now] of driftOf(before, after)) {
      const changes = changesByRule.get(rule) ?? [];
      changes.push({ url, before: was, after: now });
      changesByRule.set(rule, changes);
    }
  }
  const rules = DRIFT_RULES.flatMap(([rule, severity]) => {
    const changes = changesByRule.get(rule);
    return changes ? [{ rule, severity, count: changes.length, changes }] : [];
  });
  return { urls, rules };
}

const NO_VERDICTS: EngineVerdicts = { verdicts: new Map(), siteVerdict: null };

export function compareAudits(base: AuditSnapshot, current: AuditSnapshot) {
  const basePages = new Set(base.pageUrls);
  const currentPages = new Set(current.pageUrls);
  // Site-level issues (no page URL) belong to both crawls.
  const inBoth = (issue: Issue) =>
    issue.pageUrl === null ||
    (basePages.has(issue.pageUrl) && currentPages.has(issue.pageUrl));
  const commonBase = base.issues.filter(inBoth);
  const commonCurrent = current.issues.filter(inBoth);

  return {
    pages: {
      before: basePages.size,
      after: currentPages.size,
      added: current.pageUrls.filter((url) => !basePages.has(url)),
      removed: base.pageUrls.filter((url) => !currentPages.has(url)),
      // Same URL, different visible text: what to re-announce to engines.
      changed: current.pageUrls.filter((url) => {
        const before = base.contentHashes.get(url);
        const after = current.contentHashes.get(url);
        return before !== undefined && after !== undefined && before !== after;
      }),
    },
    issues: {
      before: base.issues.length,
      after: current.issues.length,
      byType: issueDeltas(base.issues, current.issues, () => ({})),
      common: {
        urls: base.pageUrls.filter((url) => currentPages.has(url)).length,
        before: commonBase.length,
        after: commonCurrent.length,
        byType: issueDeltas(commonBase, commonCurrent, () => ({})),
        byTemplate: issueDeltas(commonBase, commonCurrent, (issue) => ({
          template: urlTemplateOf(issue.pageUrl),
        })),
      },
    },
    drift: compareSignals(base, current),
    guidelines: {
      ...compareVerdicts(base, current),
      bing:
        base.bing || current.bing
          ? compareVerdicts(
              base.bing ?? NO_VERDICTS,
              current.bing ?? NO_VERDICTS,
            )
          : null,
    },
  };
}
