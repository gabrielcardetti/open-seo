import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { collectBingAuditIssues } from "./bingAuditIssues";

const testDb = await vi.hoisted(async () => {
  const { createBingTestDb } = await import("./bing-test-db");
  return createBingTestDb();
});

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getPagesForAudit: async () => [
      { id: "page_1", url: "https://example.com/gone" },
    ],
  },
}));

const SITE = "https://example.com/";

async function seedIssue(input: {
  url: string;
  httpCode: number | null;
  flags: number;
  resolvedAt?: string;
}) {
  await testDb.client.execute({
    sql: `INSERT INTO bing_crawl_issues
      (project_id, site_url, url, http_code, issue_flags, first_seen_at, last_seen_at, resolved_at)
      VALUES ('proj_1', ?, ?, ?, ?, '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', ?)`,
    args: [
      SITE,
      input.url,
      input.httpCode,
      input.flags,
      input.resolvedAt ?? null,
    ],
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedConnection(
  input: {
    syncEnabled?: boolean;
    syncedDaysAgo?: number;
    withKey?: boolean;
  } = {},
) {
  const syncedAt = new Date(
    Date.now() - (input.syncedDaysAgo ?? 0) * DAY_MS,
  ).toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO bing_connections
      (id, project_id, organization_id, site_url, connected_by_user_id, sync_enabled, last_synced_at)
      VALUES ('conn_1', 'proj_1', 'org_1', ?, 'user_1', ?, ?)`,
    args: [SITE, input.syncEnabled === false ? 0 : 1, syncedAt],
  });
  if (input.withKey !== false) {
    await testDb.client.execute(
      "INSERT INTO bing_api_keys (user_id, api_key_encrypted, key_hint) VALUES ('user_1', 'key', 'abcd')",
    );
  }
}

describe("collectBingAuditIssues", () => {
  beforeEach(async () => {
    await resetBingTestDb(testDb.client);
  });

  it("returns nothing when the project has no Bing connection", async () => {
    await seedIssue({
      url: "https://example.com/gone",
      httpCode: 404,
      flags: 4,
    });

    expect(
      await collectBingAuditIssues({ projectId: "proj_1", auditId: "a_1" }),
    ).toEqual([]);
  });

  it.each([
    ["daily sync is off", { syncEnabled: false }],
    ["the connector's key is gone", { withKey: false }],
    ["the last successful sync is over a week old", { syncedDaysAgo: 8 }],
  ])("reports nothing when %s", async (_case, connection) => {
    await seedConnection(connection);
    await seedIssue({
      url: "https://example.com/gone",
      httpCode: 404,
      flags: 4,
    });

    expect(
      await collectBingAuditIssues({ projectId: "proj_1", auditId: "a_1" }),
    ).toEqual([]);
  });

  it("maps open crawl issues to audit issues, matching crawled pages", async () => {
    await seedConnection();
    // 404 on a page our crawl reached.
    await seedIssue({
      url: "https://example.com/gone",
      httpCode: 404,
      flags: 4,
    });
    // Malware and a timeout on one URL our crawl didn't reach.
    await seedIssue({
      url: "https://EXAMPLE.com/bad",
      httpCode: null,
      flags: 32 | 256,
    });
    await seedIssue({
      url: "https://example.com/private",
      httpCode: null,
      flags: 16,
    });
    // A redirect alone isn't a problem; a resolved issue is history.
    await seedIssue({
      url: "https://example.com/moved",
      httpCode: 301,
      flags: 1,
    });
    await seedIssue({
      url: "https://example.com/fixed",
      httpCode: 500,
      flags: 8,
      resolvedAt: "2026-09-20T00:00:00Z",
    });

    const issues = await collectBingAuditIssues({
      projectId: "proj_1",
      auditId: "a_1",
    });

    expect(
      issues.map(({ issueType, pageId, pageUrl }) => ({
        issueType,
        pageId,
        pageUrl,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          issueType: "bing-crawl-error",
          pageId: "page_1",
          pageUrl: "https://example.com/gone",
        },
        {
          issueType: "bing-malware",
          pageId: null,
          pageUrl: "https://example.com/bad",
        },
        {
          issueType: "bing-crawl-error",
          pageId: null,
          pageUrl: "https://example.com/bad",
        },
        {
          issueType: "bing-blocked-by-robots",
          pageId: null,
          pageUrl: "https://example.com/private",
        },
      ]),
    );
    expect(issues).toHaveLength(4);
  });
});
