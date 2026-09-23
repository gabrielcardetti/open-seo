/**
 * What changed between two audits of the same site: the before/after that
 * tells whether a round of SEO fixes actually moved anything.
 *
 * Issues are matched by (issue type, URL), so a fixed title on one page shows
 * as resolved even when the same issue type is still present elsewhere.
 * Guideline verdicts are matched by URL.
 */

const VERDICT_RANK: Record<string, number> = {
  reject: 0,
  revise: 1,
  pass_with_warnings: 2,
  pass: 3,
};

interface AuditSnapshot {
  pageUrls: readonly string[];
  issues: ReadonlyArray<{ issueType: string; pageUrl: string | null }>;
  verdicts: ReadonlyMap<string, string>;
}

interface IssueTypeDelta {
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

export function compareAudits(base: AuditSnapshot, current: AuditSnapshot) {
  const basePages = new Set(base.pageUrls);
  const currentPages = new Set(current.pageUrls);

  const key = (issue: { issueType: string; pageUrl: string | null }) =>
    `${issue.issueType}\u0000${issue.pageUrl ?? ""}`;
  const baseKeys = new Set(base.issues.map(key));
  const currentKeys = new Set(current.issues.map(key));

  const byType = new Map<string, IssueTypeDelta>();
  const entry = (issueType: string) => {
    let delta = byType.get(issueType);
    if (!delta) {
      delta = { issueType, before: 0, after: 0, resolved: 0, introduced: 0 };
      byType.set(issueType, delta);
    }
    return delta;
  };
  for (const issue of base.issues) {
    const delta = entry(issue.issueType);
    delta.before += 1;
    if (!currentKeys.has(key(issue))) delta.resolved += 1;
  }
  for (const issue of current.issues) {
    const delta = entry(issue.issueType);
    delta.after += 1;
    if (!baseKeys.has(key(issue))) delta.introduced += 1;
  }

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

  const countVerdicts = (verdicts: ReadonlyMap<string, string>) => {
    const counts: Record<string, number> = {};
    for (const verdict of verdicts.values()) {
      counts[verdict] = (counts[verdict] ?? 0) + 1;
    }
    return counts;
  };

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
      byType: Array.from(byType.values()).sort(
        (a, b) => b.resolved + b.introduced - (a.resolved + a.introduced),
      ),
    },
    guidelines: {
      before: countVerdicts(base.verdicts),
      after: countVerdicts(current.verdicts),
      improved,
      worsened,
    },
  };
}
