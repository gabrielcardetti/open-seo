/**
 * Registering the project's tracked sitemaps with Google Search Console and
 * Bing Webmaster Tools. Google only ever gets them on a user or agent action:
 * Google discourages resubmitting sitemaps it already knows, so nothing
 * resubmits on a schedule. The Bing sync also registers tracked sitemaps Bing
 * doesn't list (see BingSyncService).
 */
import { openBingClientForProject } from "@/server/features/bing/bingAccess";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { isSameSite } from "@/server/features/indexing/site";
import {
  BingApiError,
  BingNotConnectedError,
} from "@/server/lib/bing/bingErrors";
import type { SitemapEngine } from "@/shared/sitemaps";
import {
  insideProperty,
  RECONNECT_GSC,
  RECONNECT_GSC_FOR_WRITE,
} from "./searchConsoleProperty";
import { SitemapRegistryService } from "./SitemapRegistryService";

type SubmissionRow = {
  url: string;
  status: "submitted" | "skipped" | "failed";
  detail: string | null;
};

type EngineSubmission = {
  /** Why nothing was sent, when nothing could be. */
  problem: string | null;
  reason: "not_connected" | "reconnect_required" | "unavailable" | null;
  results: SubmissionRow[];
};

const nothingSent = (
  reason: NonNullable<EngineSubmission["reason"]>,
  problem: string,
): EngineSubmission => ({ problem, reason, results: [] });

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function submitToGoogle(
  projectId: string,
  urls: string[],
  onlyMissing: boolean,
): Promise<EngineSubmission> {
  const connection = await GscConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    return nothingSent(
      "not_connected",
      "Search Console is not connected for this project.",
    );
  }
  if (!(await GscService.canSubmitSitemaps(connection))) {
    return nothingSent("reconnect_required", RECONNECT_GSC_FOR_WRITE);
  }
  let listed = new Set<string>();
  if (onlyMissing) {
    try {
      listed = new Set(
        (await GscService.listSitemaps(connection)).map((s) => s.path),
      );
    } catch (error) {
      return isExpectedGrantFailure(error)
        ? nothingSent("reconnect_required", RECONNECT_GSC)
        : nothingSent("unavailable", errorMessage(error));
    }
  }
  const results: SubmissionRow[] = [];
  for (const url of urls) {
    if (!insideProperty(connection.siteUrl, url)) {
      results.push({
        url,
        status: "skipped",
        detail: `Outside the Search Console property ${connection.siteUrl}.`,
      });
    } else if (listed.has(url)) {
      results.push({ url, status: "skipped", detail: "Already submitted." });
    } else {
      try {
        await GscService.submitSitemap(connection, url);
        results.push({ url, status: "submitted", detail: null });
      } catch (error) {
        results.push({ url, status: "failed", detail: errorMessage(error) });
        if (isExpectedGrantFailure(error)) {
          return {
            problem: RECONNECT_GSC,
            reason: "reconnect_required",
            results,
          };
        }
      }
    }
  }
  return { problem: null, reason: null, results };
}

async function submitToBing(
  projectId: string,
  urls: string[],
  onlyMissing: boolean,
): Promise<EngineSubmission> {
  let opened: Awaited<ReturnType<typeof openBingClientForProject>>;
  try {
    opened = await openBingClientForProject(projectId);
  } catch (error) {
    if (error instanceof BingNotConnectedError) {
      return nothingSent(
        "not_connected",
        "Bing Webmaster Tools is not connected for this project.",
      );
    }
    throw error;
  }
  const { client, connection } = opened;
  const siteUrl = connection.siteUrl;
  let listed = new Set<string>();
  if (onlyMissing) {
    try {
      listed = new Set((await client.getFeeds(siteUrl)).map((f) => f.url));
    } catch (error) {
      return nothingSent("unavailable", errorMessage(error));
    }
  }
  const siteHost = new URL(siteUrl).hostname;
  const results: SubmissionRow[] = [];
  let stopped: string | null = null;
  for (const url of urls) {
    if (stopped) {
      results.push({ url, status: "skipped", detail: `Not tried: ${stopped}` });
    } else if (!isSameSite(new URL(url).hostname, siteHost)) {
      results.push({
        url,
        status: "skipped",
        detail: `Not on the Bing site ${siteUrl}.`,
      });
    } else if (listed.has(url)) {
      results.push({ url, status: "skipped", detail: "Already submitted." });
    } else {
      try {
        await client.submitFeed(siteUrl, url);
        results.push({ url, status: "submitted", detail: null });
      } catch (error) {
        results.push({ url, status: "failed", detail: errorMessage(error) });
        // A rejected key or throttling would fail every later call too.
        if (error instanceof BingApiError && error.kind !== "invalid") {
          stopped = error.message;
        }
      }
    }
  }
  if (results.some((row) => row.status === "submitted")) {
    // Refresh the snapshot so coverage shows the new sitemaps right away.
    try {
      await BingSnapshotRepository.upsertSitemaps(
        { projectId, siteUrl },
        await client.getFeeds(siteUrl),
        new Date().toISOString(),
      );
    } catch (error) {
      console.warn("[bing] could not refresh sitemaps after submitting", error);
    }
  }
  return { problem: null, reason: null, results };
}

/**
 * Submit tracked sitemaps to Search Console and/or Bing. `urls` limits the
 * run to those tracked sitemaps (others are reported as not tracked);
 * `onlyMissing` skips sitemaps the engine already lists.
 */
async function submitToEngines(
  projectId: string,
  input: { urls?: string[]; engines: SitemapEngine[]; onlyMissing: boolean },
) {
  const tracked = await SitemapRegistryService.trackedUrls(projectId);
  const requested = input.urls ? [...new Set(input.urls)] : tracked;
  const trackedSet = new Set(tracked);
  const targets = requested.filter((url) => trackedSet.has(url));
  const notTracked: SubmissionRow[] = requested
    .filter((url) => !trackedSet.has(url))
    .map((url) => ({
      url,
      status: "skipped",
      detail: "Not tracked in OpenSEO. Track it first.",
    }));
  const run = async (
    engine: SitemapEngine,
    submit: typeof submitToGoogle,
  ): Promise<EngineSubmission | null> => {
    if (!input.engines.includes(engine)) return null;
    const result = await submit(projectId, targets, input.onlyMissing);
    return { ...result, results: [...result.results, ...notTracked] };
  };
  return {
    google: await run("google", submitToGoogle),
    bing: await run("bing", submitToBing),
  };
}

export const SitemapSubmissionService = {
  submitToEngines,
};
