/**
 * The project's own list of sitemaps. Detection (robots.txt and the default
 * /sitemap.xml) only suggests; the user confirms a suggestion by tracking it,
 * or ignores it, and an ignored sitemap is never suggested again. Sitemaps
 * added by hand are tracked straight away once they answer as a sitemap.
 * Tracked sitemaps are what OpenSEO compares with Search Console and Bing.
 */
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { isSameSite, projectHost } from "@/server/features/indexing/site";
import { createProbe } from "@/server/lib/agent-readiness/probe";
import {
  fetchRobotsTxtText,
  isProbablySitemapXml,
  parseRobotsTxt,
} from "@/server/lib/audit/discovery";
import {
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "@/server/lib/audit/url-policy";
import { AppError } from "@/server/lib/errors";
import { MAX_PROJECT_SITEMAPS } from "@/shared/sitemaps";
import {
  SitemapRegistryRepository,
  type ProjectSitemap,
} from "./SitemapRegistryRepository";

const MAX_URL_LENGTH = 2048;

const unique = (urls: string[] | undefined) => [
  ...new Set((urls ?? []).map((url) => url.trim()).filter(Boolean)),
];
const now = () => new Date().toISOString();

/** What happened to one URL of a change request. */
type SitemapChange = {
  url: string;
  action: "track" | "ignore" | "add" | "remove";
  ok: boolean;
  problem: string | null;
};

type SitemapUpdateInput = {
  detect?: boolean;
  add?: string[];
  track?: string[];
  ignore?: string[];
  remove?: string[];
};

async function requireProject(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project) {
    throw new AppError(
      "NOT_FOUND",
      "This project is archived or no longer exists.",
    );
  }
  const host = projectHost(project.domain);
  if (!project.domain || !host) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no website domain. Set one in the project settings.",
    );
  }
  return { domain: project.domain, host };
}

/** Why `url` can't be one of this site's sitemaps, or null when it can. */
function urlProblem(url: string, host: string): string | null {
  if (url.length > MAX_URL_LENGTH) return "The URL is too long.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not an absolute URL.`;
  }
  if (parsed.protocol !== "https:") return `${url} must use https.`;
  if (parsed.username || parsed.password) {
    return `${url} must not carry credentials.`;
  }
  if (!isSameSite(parsed.hostname, host)) {
    return `${url} is not on this project's site (${host}).`;
  }
  return null;
}

/**
 * Null when `url` answers 200 with an XML sitemap, through the same SSRF-safe
 * probe as other user-supplied URLs. Redirects are not followed: engines are
 * told the sitemap's own URL, so the URL it redirects to is the one to add.
 */
async function probeProblem(url: string): Promise<string | null> {
  try {
    await normalizeAndValidateStartUrl(url);
  } catch {
    return `OpenSEO is not allowed to fetch ${url}.`;
  }
  const response = await createProbe(fetch, { followRedirects: false })(url);
  if (!response) {
    return `Could not reach ${url}: the request failed or timed out.`;
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    return `${url} redirects${location ? ` to ${location}` : ""}. Add the URL it redirects to.`;
  }
  if (response.status !== 200) {
    return `${url} answered HTTP ${response.status}.`;
  }
  if (!isProbablySitemapXml(response.contentType, response.body)) {
    return `${url} is not an XML sitemap.`;
  }
  return null;
}

async function list(projectId: string) {
  const rows = await SitemapRegistryRepository.list(projectId);
  const withStatus = (status: ProjectSitemap["status"]) =>
    rows.filter((row) => row.status === status);
  return {
    tracked: withStatus("tracked"),
    suggested: withStatus("suggested"),
    ignored: withStatus("ignored"),
  };
}

/** The site's real origin (validated, redirects followed), or why not. */
async function resolveOrigin(domain: string): Promise<string | AppError> {
  try {
    const { url } = await resolveStartUrlRedirects(
      await normalizeAndValidateStartUrl(domain),
    );
    return new URL(url).origin;
  } catch (error) {
    if (error instanceof AppError && error.code === "CRAWL_TARGET_BLOCKED") {
      return new AppError(
        "CRAWL_TARGET_BLOCKED",
        "The project's domain points at an address OpenSEO is not allowed to fetch.",
      );
    }
    return new AppError(
      "VALIDATION_ERROR",
      "The project's domain is not a valid website.",
    );
  }
}

/**
 * Suggest the sitemaps the site's robots.txt names and its /sitemap.xml (when
 * it answers as a sitemap), on the project's own site only. URLs already in
 * the registry keep their status. Returns the newly suggested URLs.
 */
async function detect(
  projectId: string,
): Promise<{ suggested: string[]; problem: string | null }> {
  const { domain, host } = await requireProject(projectId);
  const origin = await resolveOrigin(domain);
  if (origin instanceof AppError) {
    return { suggested: [], problem: origin.message };
  }
  const robots = parseRobotsTxt(origin, await fetchRobotsTxtText(origin));
  const candidates = [...new Set(robots.sitemapUrls)].filter(
    (url) => urlProblem(url, host) === null,
  );
  const defaultUrl = `${origin}/sitemap.xml`;
  if (
    !candidates.includes(defaultUrl) &&
    urlProblem(defaultUrl, host) === null &&
    (await probeProblem(defaultUrl)) === null
  ) {
    candidates.push(defaultUrl);
  }
  const existing = await SitemapRegistryRepository.list(projectId);
  const known = new Set(existing.map((row) => row.url));
  const suggested = candidates
    .filter((url) => !known.has(url))
    .slice(0, Math.max(0, MAX_PROJECT_SITEMAPS - existing.length));
  await SitemapRegistryRepository.insertIfAbsent(
    projectId,
    suggested,
    { source: "detected", status: "suggested" },
    now(),
  );
  return { suggested, problem: null };
}

const FULL_PROBLEM = `A project keeps at most ${MAX_PROJECT_SITEMAPS} sitemaps. Remove some first.`;

/**
 * Track one sitemap. A suggested or ignored row is confirmed as it is; a URL
 * the registry doesn't hold must be on the site, answer as a sitemap, and fit
 * under the cap.
 */
async function trackOne(
  projectId: string,
  host: string,
  url: string,
  rows: Map<string, ProjectSitemap>,
): Promise<string | null> {
  const row = rows.get(url);
  if (row?.status === "tracked") return null;
  if (row) {
    await SitemapRegistryRepository.setStatus(
      projectId,
      [url],
      "tracked",
      now(),
    );
    return null;
  }
  const problem =
    urlProblem(url, host) ??
    (rows.size >= MAX_PROJECT_SITEMAPS ? FULL_PROBLEM : null) ??
    (await probeProblem(url));
  if (problem) return problem;
  await SitemapRegistryRepository.upsertTracked(projectId, url, now());
  return null;
}

/**
 * Apply one batch of registry changes, in order: detect, add, track, ignore,
 * remove. Tracking confirms a suggested or ignored sitemap, and adds a URL
 * the registry doesn't hold (validated like a manual add); ignoring a URL it
 * doesn't hold records it as ignored so detection skips it.
 * Removing a manual sitemap forgets it; removing a detected one ignores it,
 * so the next detection doesn't suggest it again.
 */
async function update(projectId: string, input: SitemapUpdateInput) {
  const { host } = await requireProject(projectId);
  const detected = input.detect ? await detect(projectId) : null;
  const changes: SitemapChange[] = [];
  const record = (
    action: SitemapChange["action"],
    url: string,
    problem: string | null,
  ) => changes.push({ url, action, ok: problem === null, problem });
  const loadRows = async () =>
    new Map(
      (await SitemapRegistryRepository.list(projectId)).map((row) => [
        row.url,
        row,
      ]),
    );

  for (const url of unique([...(input.add ?? []), ...(input.track ?? [])])) {
    const rows = await loadRows();
    const action = input.add?.includes(url) ? "add" : "track";
    record(action, url, await trackOne(projectId, host, url, rows));
  }

  for (const url of unique(input.ignore)) {
    const rows = await loadRows();
    const row = rows.get(url);
    if (row) {
      await SitemapRegistryRepository.setStatus(
        projectId,
        [url],
        "ignored",
        now(),
      );
      record("ignore", url, null);
      continue;
    }
    const problem =
      urlProblem(url, host) ??
      (rows.size >= MAX_PROJECT_SITEMAPS ? FULL_PROBLEM : null);
    if (!problem) {
      await SitemapRegistryRepository.insertIfAbsent(
        projectId,
        [url],
        { source: "detected", status: "ignored" },
        now(),
      );
    }
    record("ignore", url, problem);
  }

  const rows = await loadRows();
  for (const url of unique(input.remove)) {
    const row = rows.get(url);
    if (!row) {
      record("remove", url, `${url} is not in this project's sitemaps.`);
    } else if (row.source === "manual") {
      await SitemapRegistryRepository.remove(projectId, [url]);
      record("remove", url, null);
    } else {
      await SitemapRegistryRepository.setStatus(
        projectId,
        [url],
        "ignored",
        now(),
      );
      record("remove", url, null);
    }
  }

  return { detected, changes };
}

/** The tracked sitemap URLs, for the sitemap watch and the Bing sync. */
async function trackedUrls(projectId: string): Promise<string[]> {
  return SitemapRegistryRepository.listTrackedUrls(projectId);
}

export const SitemapRegistryService = {
  list,
  detect,
  update,
  trackedUrls,
};
