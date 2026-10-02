import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectSitemaps } from "@/db/schema";
import type {
  ProjectSitemapSource,
  ProjectSitemapStatus,
} from "@/shared/sitemaps";

export type ProjectSitemap = typeof projectSitemaps.$inferSelect;

const scope = (projectId: string, urls?: string[]) =>
  and(
    eq(projectSitemaps.projectId, projectId),
    urls ? inArray(projectSitemaps.url, urls) : undefined,
  );

async function list(projectId: string): Promise<ProjectSitemap[]> {
  return db
    .select()
    .from(projectSitemaps)
    .where(scope(projectId))
    .orderBy(asc(projectSitemaps.url));
}

async function listTrackedUrls(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ url: projectSitemaps.url })
    .from(projectSitemaps)
    .where(and(scope(projectId), eq(projectSitemaps.status, "tracked")))
    .orderBy(asc(projectSitemaps.url));
  return rows.map((row) => row.url);
}

async function countRows(projectId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(projectSitemaps)
    .where(scope(projectId));
  return row?.total ?? 0;
}

/** New rows only: a URL already in the registry keeps its status, so an
 *  ignored or tracked sitemap is never turned back into a suggestion. */
async function insertIfAbsent(
  projectId: string,
  urls: string[],
  input: { source: ProjectSitemapSource; status: ProjectSitemapStatus },
  nowIso: string,
): Promise<void> {
  if (urls.length === 0) return;
  await db
    .insert(projectSitemaps)
    .values(
      urls.map((url) => ({
        projectId,
        url,
        ...input,
        createdAt: nowIso,
        updatedAt: nowIso,
        confirmedAt: input.status === "tracked" ? nowIso : null,
      })),
    )
    .onConflictDoNothing({
      target: [projectSitemaps.projectId, projectSitemaps.url],
    });
}

/** A manual add: insert as tracked, or track the existing row (keeping how
 *  it was found). */
async function upsertTracked(
  projectId: string,
  url: string,
  nowIso: string,
): Promise<void> {
  await db
    .insert(projectSitemaps)
    .values({
      projectId,
      url,
      source: "manual",
      status: "tracked",
      createdAt: nowIso,
      updatedAt: nowIso,
      confirmedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [projectSitemaps.projectId, projectSitemaps.url],
      set: { status: "tracked", updatedAt: nowIso, confirmedAt: nowIso },
    });
}

async function setStatus(
  projectId: string,
  urls: string[],
  status: ProjectSitemapStatus,
  nowIso: string,
): Promise<void> {
  if (urls.length === 0) return;
  await db
    .update(projectSitemaps)
    .set({
      status,
      updatedAt: nowIso,
      ...(status === "tracked" ? { confirmedAt: nowIso } : {}),
    })
    .where(scope(projectId, urls));
}

async function remove(projectId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await db.delete(projectSitemaps).where(scope(projectId, urls));
}

export const SitemapRegistryRepository = {
  list,
  listTrackedUrls,
  countRows,
  insertIfAbsent,
  upsertTracked,
  setStatus,
  remove,
};
