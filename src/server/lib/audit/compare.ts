/**
 * What changed between two audits of the same site: the before/after that
 * tells whether a round of SEO fixes actually moved anything.
 *
 * Issues are matched by (issue type, URL), so a fixed title on one page shows
 * as resolved even when the same issue type is still present elsewhere.
 * Guideline verdicts are matched by URL. The whole-site verdict is not a page,
 * so it is compared on its own and kept out of the page counts.
 *
 * Two crawls of a large site rarely reach the same pages, so the whole-audit
 * counts mix real fixes with pages that merely entered or left the sample.
 * The `common` block repeats the issue comparison on the URLs both audits
 * crawled, overall and per URL template — which is how a template fix shows.
 */
import { sort } from "remeda";
import { urlTemplateOf } from "./url-utils";

const VERDICT_RANK: Record<string, number> = {
  reject: 0,
  revise: 1,
  pass_with_warnings: 2,
  pass: 3,
};

interface AuditSnapshot {
  pageUrls: readonly string[];
  issues: ReadonlyArray<{ issueType: string; pageUrl: string | null }>;
  /** Page verdicts by URL. */
  verdicts: ReadonlyMap<string, string>;
  /** The whole-site verdict, when the audit has one. */
  siteVerdict: string | null;
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

export function compareAudits(base: AuditSnapshot, current: AuditSnapshot) {
  const basePages = new Set(base.pageUrls);
  const currentPages = new Set(current.pageUrls);
  // Site-level issues (no page URL) belong to both crawls.
  const inBoth = (issue: Issue) =>
    issue.pageUrl === null ||
    (basePages.has(issue.pageUrl) && currentPages.has(issue.pageUrl));
  const commonBase = base.issues.filter(inBoth);
  const commonCurrent = current.issues.filter(inBoth);

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
    pages: {
      before: basePages.size,
      after: currentPages.size,
      added: current.pageUrls.filter((url) => !basePages.has(url)),
      removed: base.pageUrls.filter((url) => !currentPages.has(url)),
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
    guidelines: {
      before: countVerdicts(base.verdicts),
      after: countVerdicts(current.verdicts),
      improved,
      worsened,
      site: { before: base.siteVerdict, after: current.siteVerdict },
    },
  };
}
