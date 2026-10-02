/**
 * How the project's tracked sitemaps stand in Google Search Console and Bing
 * Webmaster Tools. Google is read live (`sitemaps.list` works with the
 * read-only scope); Bing from the daily snapshot of GetFeeds.
 */
import { sort } from "remeda";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";
import {
  GscConnectionRepository,
  type GscConnection,
} from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import type { GscSitemap } from "@/server/lib/gscClient";
import {
  insideProperty,
  RECONNECT_GSC,
  RECONNECT_GSC_FOR_WRITE,
} from "./searchConsoleProperty";
import { SitemapRegistryService } from "./SitemapRegistryService";

type CoverageState = "submitted" | "missing" | "not_connected" | "unknown";

type GoogleCoverage = {
  state: CoverageState;
  /** A URL-prefix property only accepts sitemaps under its prefix. */
  outsideProperty: boolean;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  errors: number;
  warnings: number;
  submitted: number | null;
  indexed: number | null;
};

type BingCoverage = {
  state: CoverageState;
  status: string | null;
  urlCount: number | null;
  lastCrawled: string | null;
};

const toNumber = (value: string | number | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function googleCoverage(
  url: string,
  siteUrl: string | null,
  listed: Map<string, GscSitemap> | null,
): GoogleCoverage {
  const sitemap = listed?.get(url);
  const sum = (key: "submitted" | "indexed") =>
    sitemap?.contents?.length
      ? sitemap.contents.reduce(
          (total, content) => total + (toNumber(content[key]) ?? 0),
          0,
        )
      : null;
  return {
    state: !siteUrl
      ? "not_connected"
      : !listed
        ? "unknown"
        : sitemap
          ? "submitted"
          : "missing",
    outsideProperty: siteUrl ? !insideProperty(siteUrl, url) : false,
    lastSubmitted: sitemap?.lastSubmitted ?? null,
    lastDownloaded: sitemap?.lastDownloaded ?? null,
    isPending: sitemap?.isPending ?? false,
    errors: toNumber(sitemap?.errors) ?? 0,
    warnings: toNumber(sitemap?.warnings) ?? 0,
    submitted: sum("submitted"),
    indexed: sum("indexed"),
  };
}

/** Search Console's view: the property's sitemaps, or why they can't be read. */
async function readGoogle(connection: GscConnection | null) {
  if (!connection) {
    return { listed: null, canSubmit: false, problem: null };
  }
  const canSubmit = await GscService.canSubmitSitemaps(connection);
  try {
    const sitemaps = await GscService.listSitemaps(connection);
    return {
      listed: new Map(sitemaps.map((sitemap) => [sitemap.path, sitemap])),
      canSubmit,
      problem: null,
    };
  } catch (error) {
    if (!isExpectedGrantFailure(error)) {
      console.error("Failed to list Search Console sitemaps", error);
    }
    return {
      listed: null,
      canSubmit,
      problem: isExpectedGrantFailure(error)
        ? RECONNECT_GSC
        : "Search Console didn't answer just now. Try again shortly.",
    };
  }
}

/** Bing's view from the last sync: the sitemaps its newest GetFeeds listed. */
async function readBing(projectId: string) {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) return { connection: null, listed: null };
  const rows = await BingSnapshotRepository.getSitemaps({
    projectId,
    siteUrl: connection.siteUrl,
  });
  if (rows.length === 0 && !connection.lastSyncedAt) {
    return { connection, listed: null };
  }
  // A sitemap seen before the newest answer was missing from it.
  const newest = rows.reduce(
    (latest, row) => (row.lastSeenAt > latest ? row.lastSeenAt : latest),
    "",
  );
  return {
    connection,
    listed: new Map(
      rows
        .filter((row) => row.lastSeenAt === newest)
        .map((row) => [row.feedUrl, row]),
    ),
  };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

async function coverage(projectId: string) {
  const [registry, gscConnection, bing] = await Promise.all([
    SitemapRegistryService.list(projectId),
    GscConnectionRepository.getByProjectId(projectId),
    readBing(projectId),
  ]);
  const google = await readGoogle(gscConnection);
  const siteUrl = gscConnection?.siteUrl ?? null;

  const tracked = registry.tracked.map((row) => {
    const feed = bing.listed?.get(row.url);
    const bingCoverage: BingCoverage = {
      state: !bing.connection
        ? "not_connected"
        : !bing.listed
          ? "unknown"
          : feed
            ? "submitted"
            : "missing",
      status: feed?.status ?? null,
      urlCount: feed?.urlCount ?? null,
      lastCrawled: feed?.lastCrawledAt ?? null,
    };
    return {
      url: row.url,
      source: row.source,
      confirmedAt: row.confirmedAt,
      google: googleCoverage(row.url, siteUrl, google.listed),
      bing: bingCoverage,
    };
  });

  const known = new Set(
    [...registry.tracked, ...registry.suggested, ...registry.ignored].map(
      (row) => row.url,
    ),
  );
  const engineUrls = [
    ...(google.listed?.keys() ?? []),
    ...(bing.listed?.keys() ?? []),
  ];
  const engineOnly = sort(
    [...new Set(engineUrls)].filter((url) => !known.has(url)),
    (a, b) => a.localeCompare(b),
  ).map((url) => ({
    url,
    google: google.listed?.has(url) ?? false,
    bing: bing.listed?.has(url) ?? false,
  }));

  const missing = {
    google: tracked.filter((row) => row.google.state === "missing").length,
    bing: tracked.filter((row) => row.bing.state === "missing").length,
  };

  const actionNeeded: string[] = [];
  const rowCount = known.size;
  if (rowCount === 0) {
    actionNeeded.push(
      "No sitemaps registered yet: detect them from robots.txt and /sitemap.xml, or add yours.",
    );
  }
  if (registry.suggested.length > 0) {
    actionNeeded.push(
      `${plural(registry.suggested.length, "suggested sitemap")} need${registry.suggested.length === 1 ? "s" : ""} confirming: track or ignore ${registry.suggested.length === 1 ? "it" : "them"}.`,
    );
  }
  for (const row of tracked) {
    if (row.google.state === "missing" && row.google.outsideProperty) {
      actionNeeded.push(
        `${row.url} is outside the Search Console property ${siteUrl}, which only accepts sitemaps under it.`,
      );
    } else if (row.google.state === "missing") {
      actionNeeded.push(`${row.url} is missing in Google Search Console.`);
    }
    if (row.google.errors > 0) {
      actionNeeded.push(
        `Google reports ${plural(row.google.errors, "error")} in ${row.url}.`,
      );
    }
    if (row.bing.state === "missing") {
      actionNeeded.push(`${row.url} is missing in Bing Webmaster Tools.`);
    }
  }
  if (missing.google > 0 && !google.canSubmit) {
    actionNeeded.push(RECONNECT_GSC_FOR_WRITE);
  }
  if (google.problem) actionNeeded.push(google.problem);
  if (engineOnly.length > 0) {
    actionNeeded.push(
      `${plural(engineOnly.length, "sitemap")} registered in Google or Bing ${engineOnly.length === 1 ? "is" : "are"} unknown to OpenSEO: track or ignore ${engineOnly.length === 1 ? "it" : "them"}.`,
    );
  }
  if (tracked.length > 0 && (!gscConnection || !bing.connection)) {
    const engines = [
      gscConnection ? null : "Search Console",
      bing.connection ? null : "Bing Webmaster Tools",
    ].filter(Boolean);
    actionNeeded.push(
      `Connect ${engines.join(" and ")} to check that ${engines.length === 1 ? "it has" : "they have"} every tracked sitemap.`,
    );
  }

  return {
    tracked,
    suggested: registry.suggested.map((row) => ({
      url: row.url,
      createdAt: row.createdAt,
    })),
    ignored: registry.ignored.map((row) => ({ url: row.url })),
    engineOnly,
    google: {
      connected: Boolean(gscConnection),
      siteUrl,
      canSubmit: google.canSubmit,
      problem: google.problem,
    },
    bing: {
      connected: Boolean(bing.connection),
      siteUrl: bing.connection?.siteUrl ?? null,
      lastSyncedAt: bing.connection?.lastSyncedAt ?? null,
    },
    suggestedCount: registry.suggested.length,
    missing,
    gscCanSubmit: google.canSubmit,
    actionNeeded,
  };
}

export const SitemapCoverageService = {
  coverage,
};
