/**
 * Announce URLs to search engines and record every outcome in the ledger.
 *
 * Two channels: IndexNow (one POST per host, shared with every participating
 * engine) and Bing's own URL submission API (quota-limited, ≤500 per call).
 * "Received" means the engine got the notice, never that the page is indexed.
 * Google takes part in neither.
 */
import { chunk, groupBy } from "remeda";
import { openBingClientForProject } from "@/server/features/bing/bingAccess";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { UpstreamBreaker } from "@/server/features/upstreams/upstreamBreaker";
import {
  BingApiError,
  BingNotConnectedError,
} from "@/server/lib/bing/bingErrors";
import type {
  UrlSubmissionChannel,
  UrlSubmissionSource,
  UrlSubmissionStatus,
} from "@/shared/indexing";
import {
  IndexingRepository,
  type IndexingSettings,
} from "./IndexingRepository";
import { INDEXNOW_MAX_URLS, postIndexNow } from "./indexNowApi";
import { isSameSite, projectHost } from "./site";
import { UrlSubmissionRepository } from "./UrlSubmissionRepository";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_DEDUPE_HOURS = 24;
const BING_MAX_URLS_PER_CALL = 500;

type ChannelChoice = "auto" | UrlSubmissionChannel;

type Outcome = {
  status: UrlSubmissionStatus;
  channel: UrlSubmissionChannel | null;
  httpStatus: number | null;
  errorMessage: string | null;
  attempts: number;
};

export type SubmissionResult = {
  batchId: string | null;
  channel: UrlSubmissionChannel | null;
  /** Why nothing was sent (no channel, no domain), or why some URLs were
   *  not (the channel is unreachable: those have no result), in plain
   *  language. */
  problem: string | null;
  results: Array<{ url: string } & Omit<Outcome, "attempts">>;
  counts: Partial<Record<UrlSubmissionStatus, number>>;
  /** Input left out: not a URL, or not on the project's site. */
  dropped: Array<{ url: string; reason: string }>;
};

const NO_CHANNEL =
  "Set up IndexNow (generate a key, publish the key file, verify it) or connect Bing Webmaster Tools to submit URLs.";

/**
 * The channel `auto` uses: IndexNow once its key is verified, otherwise
 * Bing's API when the project has a Bing connection, otherwise none.
 */
async function resolveAutoChannel(
  projectId: string,
  settings: IndexingSettings | null,
): Promise<UrlSubmissionChannel | null> {
  if (settings?.indexnowKey && settings.indexnowVerifiedAt) return "indexnow";
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  return connection ? "bing_api" : null;
}

async function chooseChannel(
  projectId: string,
  settings: IndexingSettings | null,
  choice: ChannelChoice,
): Promise<{ channel: UrlSubmissionChannel } | { problem: string }> {
  if (choice === "indexnow") {
    return settings?.indexnowKey
      ? { channel: "indexnow" }
      : { problem: "Generate or import an IndexNow key first." };
  }
  if (choice === "bing_api") {
    const connection = await BingConnectionRepository.getByProjectId(projectId);
    return connection
      ? { channel: "bing_api" }
      : {
          problem:
            "Connect Bing Webmaster Tools in the project's integrations first.",
        };
  }
  const channel = await resolveAutoChannel(projectId, settings);
  return channel ? { channel } : { problem: NO_CHANNEL };
}

/** Valid http(s) URLs on the project's site, deduplicated, in input order. */
function filterUrls(urls: string[], siteHost: string) {
  const accepted = new Set<string>();
  const dropped: SubmissionResult["dropped"] = [];
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      dropped.push({ url: raw, reason: "Not a valid URL." });
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      dropped.push({ url: raw, reason: "Only http(s) URLs can be submitted." });
      continue;
    }
    if (!isSameSite(parsed.hostname, siteHost)) {
      dropped.push({ url: raw, reason: `Not on ${siteHost}.` });
      continue;
    }
    parsed.hash = "";
    accepted.add(parsed.toString());
  }
  return { accepted: [...accepted], dropped };
}

/**
 * Per-URL outcomes of one send. URLs left out of `outcomes` were not sent
 * because the channel is unreachable (`outage`): they get no ledger row, so
 * nothing reads as the engine's refusal, and later checks send them again.
 */
type Sent = {
  outcomes: Map<string, Outcome>;
  outage: { message: string; retryAt: string | null } | null;
};

async function sendViaIndexNow(
  projectId: string,
  settings: IndexingSettings | null,
  urls: string[],
): Promise<Sent> {
  const outcomes = new Map<string, Outcome>();
  const key = settings?.indexnowKey;
  if (!key) return { outcomes, outage: null };
  const keyLocation = settings.indexnowKeyLocation;
  // IndexNow requires every URL of one request to share its `host`.
  const byHost = groupBy(urls, (url) => new URL(url).hostname);
  for (const [host, hostUrls] of Object.entries(byHost)) {
    // A key file on the other www/apex variant is only found through its
    // default location on this host, which the site's redirect serves.
    const location =
      keyLocation && new URL(keyLocation).hostname === host
        ? keyLocation
        : null;
    for (const urlList of chunk(hostUrls, INDEXNOW_MAX_URLS)) {
      const outcome = await postIndexNow({
        host,
        key,
        keyLocation: location,
        urlList,
      });
      if ("unreachable" in outcome) {
        return { outcomes, outage: outcome.unreachable };
      }
      if (outcome.httpStatus === 403) {
        // The key file is gone or changed: stop treating the key as verified
        // so `auto` falls back to Bing until it is fixed and re-verified.
        await IndexingRepository.upsertSettings(projectId, {
          indexnowVerifiedAt: null,
          indexnowLastError: outcome.errorMessage,
        });
      }
      for (const url of urlList) {
        outcomes.set(url, { ...outcome, channel: "indexnow" });
      }
    }
  }
  return { outcomes, outage: null };
}

/** Bing's API (or its relay) is unreachable: the outage, when it is. */
async function bingOutage(error: unknown): Promise<Sent["outage"]> {
  if (!(error instanceof BingApiError) || error.kind !== "unreachable") {
    return null;
  }
  const outage = await UpstreamBreaker.getOutage("bing_api");
  return { message: error.message, retryAt: outage?.retryAt ?? null };
}

function bingFailure(error: unknown): Outcome {
  if (error instanceof BingApiError) {
    return {
      // Only `invalid` is Bing refusing the URLs themselves. A revoked key or
      // lost site access is the connection failing: fixing it lets the same
      // URLs through, so they are not recorded as refused.
      status:
        error.kind === "throttled"
          ? "throttled"
          : error.kind === "invalid"
            ? "rejected"
            : "failed",
      channel: "bing_api",
      httpStatus: error.status,
      errorMessage: error.message,
      attempts: 1,
    };
  }
  return {
    status: "failed",
    channel: "bing_api",
    httpStatus: null,
    errorMessage:
      error instanceof BingNotConnectedError
        ? "Bing Webmaster Tools needs to be reconnected for this project."
        : "Could not submit to Bing Webmaster Tools.",
    attempts: 1,
  };
}

async function sendViaBing(projectId: string, urls: string[]): Promise<Sent> {
  const outcomes = new Map<string, Outcome>();
  const setAll = (list: string[], outcome: Outcome) => {
    for (const url of list) outcomes.set(url, outcome);
  };
  let opened: Awaited<ReturnType<typeof openBingClientForProject>>;
  let quota: { daily: number; monthly: number };
  try {
    opened = await openBingClientForProject(projectId);
    quota = await opened.client.getUrlSubmissionQuota(
      opened.connection.siteUrl,
    );
    await IndexingRepository.updateBingQuota(projectId, quota);
  } catch (error) {
    const outage = await bingOutage(error);
    if (!outage) setAll(urls, bingFailure(error));
    return { outcomes, outage };
  }

  const allowed = Math.max(0, Math.min(quota.daily, quota.monthly));
  setAll(urls.slice(allowed), {
    status: "skipped_quota",
    channel: "bing_api",
    httpStatus: null,
    errorMessage:
      "Bing's URL submission quota is used up. It resets daily; IndexNow has no such quota.",
    attempts: 0,
  });
  const batches = chunk(urls.slice(0, allowed), BING_MAX_URLS_PER_CALL);
  let sent = 0;
  let outage: Sent["outage"] = null;
  for (const [index, batch] of batches.entries()) {
    try {
      await opened.client.submitUrlBatch(opened.connection.siteUrl, batch);
      sent += batch.length;
      setAll(batch, {
        status: "received",
        channel: "bing_api",
        httpStatus: 200,
        errorMessage: null,
        attempts: 1,
      });
    } catch (error) {
      // Whatever stopped this batch (bad key, throttling, an outage) stops
      // the rest.
      outage = await bingOutage(error);
      if (!outage) setAll(batches.slice(index).flat(), bingFailure(error));
      break;
    }
  }
  if (sent > 0) {
    await IndexingRepository.updateBingQuota(projectId, {
      daily: quota.daily - sent,
      monthly: quota.monthly - sent,
    });
  }
  return { outcomes, outage };
}

function countStatuses(results: SubmissionResult["results"]) {
  const counts: SubmissionResult["counts"] = {};
  for (const { status } of results) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

/**
 * Normalize and filter `urls` to the project's site, skip the ones announced
 * successfully within the dedupe window (unless `force`), send the rest on
 * the chosen channel, and write one ledger row per URL under one batch id.
 */
async function submitUrls(
  projectId: string,
  urls: string[],
  source: UrlSubmissionSource,
  options: { channel?: ChannelChoice; force?: boolean } = {},
): Promise<SubmissionResult> {
  const empty = {
    batchId: null,
    channel: null,
    results: [],
    counts: {},
  };
  // Archived projects are not found here, so they never send anything.
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project) {
    return {
      ...empty,
      dropped: [],
      problem: "This project is archived or no longer exists.",
    };
  }
  const siteHost = projectHost(project.domain);
  if (!siteHost) {
    return {
      ...empty,
      dropped: [],
      problem:
        "This project has no website domain. Set one in the project settings.",
    };
  }
  const { accepted, dropped } = filterUrls(urls, siteHost);
  if (accepted.length === 0) return { ...empty, dropped, problem: null };

  const settings = await IndexingRepository.getSettings(projectId);
  const chosen = await chooseChannel(
    projectId,
    settings,
    options.channel ?? "auto",
  );
  if ("problem" in chosen) {
    return { ...empty, dropped, problem: chosen.problem };
  }

  const now = new Date();
  const dedupeHours = settings?.dedupeHours ?? DEFAULT_DEDUPE_HOURS;
  const announced = options.force
    ? new Set<string>()
    : await UrlSubmissionRepository.getAnnouncedUrlsSince(
        projectId,
        new Date(now.getTime() - dedupeHours * HOUR_MS).toISOString(),
      );
  const toSend = accepted.filter((url) => !announced.has(url));
  const { outcomes, outage } =
    chosen.channel === "indexnow"
      ? await sendViaIndexNow(projectId, settings, toSend)
      : await sendViaBing(projectId, toSend);
  if (outage?.retryAt) {
    // The sitemap watch resends what didn't go out; run it once the breaker
    // lets a call through instead of a day from now.
    await IndexingRepository.scheduleSitemapCheckBy(projectId, outage.retryAt);
  }

  const batchId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const rows = accepted.flatMap((url) => {
    const outcome: Outcome | undefined = announced.has(url)
      ? {
          status: "skipped_duplicate",
          channel: null,
          httpStatus: null,
          errorMessage: `Already announced in the last ${dedupeHours} h.`,
          attempts: 0,
        }
      : outcomes.get(url);
    // Not sent because the channel is unreachable: no row (see Sent).
    if (!outcome) return [];
    return {
      id: crypto.randomUUID(),
      projectId,
      url,
      source,
      batchId,
      submittedAt,
      ...outcome,
    };
  });
  await UrlSubmissionRepository.insertSubmissions(rows);

  const results = rows.map((row) => ({
    url: row.url,
    status: row.status,
    channel: row.channel,
    httpStatus: row.httpStatus,
    errorMessage: row.errorMessage,
  }));
  const unsent = accepted.length - rows.length;
  return {
    batchId: rows.length > 0 ? batchId : null,
    channel: chosen.channel,
    problem: outage
      ? `${outage.message} ${unsent} URL${unsent === 1 ? " was" : "s were"} not sent; the sitemap watch sends new and changed sitemap URLs once it is reachable again.`
      : null,
    results,
    counts: countStatuses(results),
    dropped,
  };
}

export const UrlSubmissionService = {
  submitUrls,
  resolveAutoChannel,
} as const;
