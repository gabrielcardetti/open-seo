import type { z } from "zod";
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";
import { UmamiApiError } from "./umamiErrors";
import {
  activeSchema,
  bucketDay,
  expandedMetricsSchema,
  isSkippableListError,
  loginSchema,
  metricsSchema,
  pagedSchema,
  pageviewsSchema,
  parseAnswer,
  readJson,
  statsSchema,
  statusError,
  teamSchema,
  totalsFrom,
  websiteSchema,
  type seriesPointSchema,
  type UmamiTotals,
} from "./umamiResponses";

export type { UmamiTotals } from "./umamiResponses";

/** Umami Cloud's API origin; self-hosted instances serve theirs at /api. */
export const UMAMI_CLOUD_API_URL = "https://api.umami.is/v1";

const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_TEAMS = 25;

export type UmamiCredentials =
  | { mode: "cloud"; apiKey: string }
  | { mode: "self_hosted"; username: string; password: string };

export type UmamiWebsite = {
  id: string;
  name: string;
  domain: string | null;
  // Set for websites owned by a team rather than the user.
  teamId: string | null;
  teamName: string | null;
};

type UmamiMetricRow = { name: string; value: number };
export type UmamiExpandedRow = { name: string } & UmamiTotals;
type UmamiSeriesPoint = { date: string; value: number };

/**
 * Filters in Umami's own `operator.value` query form, e.g.
 * `{ referrer: "eq.google.com,www.bing.com" }`. A `path` filter is sent as
 * `url` to instances older than Umami 3.
 */
export type UmamiFilters = Record<string, string>;

type RangeInput = {
  websiteId: string;
  startAt: number;
  endAt: number;
  filters?: UmamiFilters;
};

type MetricsInput = RangeInput & {
  type: string;
  limit: number;
  offset?: number;
  // Keeps rows whose value contains this text.
  search?: string;
};

type Query = Record<string, string | number | undefined>;

function rangeQuery(range: RangeInput): Query {
  return {
    startAt: range.startAt,
    endAt: range.endAt,
    ...range.filters,
  };
}

/**
 * Umami API client for one connection. Cloud sends the API key on every call;
 * self-hosted logs in with the saved username and password, keeps the token
 * for the life of this client (one server request), and logs in again once
 * when Umami answers 401 to a cached token. Redirects are never followed, and
 * every URL passes the same SSRF host check as the site crawler.
 */
export function createUmamiClient(input: {
  baseUrl: string;
  credentials: UmamiCredentials;
}) {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const { credentials } = input;
  let token: string | null = null;
  // Set once an instance turns out to predate Umami 3 (`url`, not `path`).
  let legacyPaths = false;

  function apiUrl(path: string, query: Query = {}): URL {
    const url = new URL(`${baseUrl}/${path}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url;
  }

  async function send(url: URL, init: RequestInit): Promise<Response> {
    if (!isCrawlableUrl(url.toString())) {
      throw new UmamiApiError(
        "other",
        "That Umami address isn't allowed.",
        null,
      );
    }
    try {
      return await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "TimeoutError";
      throw new UmamiApiError(
        "unreachable",
        timedOut
          ? "Umami did not answer in time. Retry later."
          : "Could not reach Umami. Check the instance address and retry.",
        null,
      );
    }
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await send(apiUrl("auth/login"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw statusError(response.status);
    return parseAnswer(loginSchema, await readJson(response), "login").token;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    if (credentials.mode === "cloud") {
      return {
        Accept: "application/json",
        "x-umami-api-key": credentials.apiKey,
      };
    }
    token ??= await login(credentials.username, credentials.password);
    return { Accept: "application/json", Authorization: `Bearer ${token}` };
  }

  async function call(
    path: string,
    query: Query = {},
    body?: unknown,
  ): Promise<unknown> {
    const url = apiUrl(path, query);
    const init = async (): Promise<RequestInit> =>
      body === undefined
        ? { headers: await authHeaders() }
        : {
            method: "POST",
            headers: {
              ...(await authHeaders()),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          };
    let response = await send(url, await init());
    if (response.status === 401 && credentials.mode === "self_hosted") {
      // The token expired or was revoked: log in again, once.
      token = null;
      response = await send(url, await init());
    }
    if (!response.ok) {
      // The path names the website at most; the query is never logged.
      console.warn("[umami] API error", {
        status: response.status,
        path: path.replace(/[0-9a-f-]{36}/gi, ":id"),
      });
      throw statusError(response.status);
    }
    return readJson(response);
  }

  const get = (path: string, query: Query = {}) => call(path, query);

  async function listPaged<T extends z.ZodType>(
    path: string,
    item: T,
    label: string,
    query: Query = {},
  ): Promise<z.infer<T>[]> {
    const schema = pagedSchema(item);
    const rows: z.infer<T>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = parseAnswer(
        schema,
        await get(path, { ...query, page, pageSize: PAGE_SIZE }),
        label,
      );
      if (Array.isArray(answer)) return answer;
      rows.push(...answer.data);
      if (
        answer.data.length < PAGE_SIZE ||
        (answer.count !== undefined && rows.length >= answer.count)
      ) {
        break;
      }
    }
    return rows;
  }

  /** Metric requests name pages `path` since Umami 3 and `url` before; an
   *  older instance answers 400 to `path`, so retry once with `url`. */
  async function getMetricRows(
    endpoint: "metrics" | "metrics/expanded",
    request: MetricsInput,
  ): Promise<unknown> {
    const path = `websites/${encodeURIComponent(request.websiteId)}/${endpoint}`;
    const query: Query = {
      ...rangeQuery(request),
      type: request.type,
      limit: request.limit,
      offset: request.offset ?? 0,
      search: request.search,
    };
    const usesPath = query.type === "path" || query.path !== undefined;
    const legacyQuery = (): Query => {
      const { path: pathFilter, ...rest } = query;
      return {
        ...rest,
        type: query.type === "path" ? "url" : query.type,
        ...(pathFilter !== undefined ? { url: pathFilter } : {}),
      };
    };
    if (usesPath && legacyPaths) return get(path, legacyQuery());
    try {
      return await get(path, query);
    } catch (error) {
      if (
        !usesPath ||
        !(error instanceof UmamiApiError) ||
        error.status !== 400
      ) {
        throw error;
      }
      legacyPaths = true;
      return get(path, legacyQuery());
    }
  }

  return {
    /** A raw GET under the API base, for reads parsed by their caller. */
    get,

    /** A raw POST (Umami's report endpoints take their input as a body). */
    post: (path: string, body: unknown) => call(path, {}, body),

    /**
     * Every website the credentials can read: the user's own, and those of
     * every team the user belongs to. `websites?includeTeams=true` already
     * covers team access on recent instances; each team's own list
     * (`teams/:id/websites`) names the owner and covers instances that ignore
     * the flag. Deduplicated by id. Also the cheapest credential check.
     */
    async listWebsites(): Promise<UmamiWebsite[]> {
      const own = await listPaged("websites", websiteSchema, "website list", {
        includeTeams: "true",
      });
      let teams: z.infer<typeof teamSchema>[] = [];
      try {
        teams = await listPaged("teams", teamSchema, "team list");
      } catch (error) {
        // An instance without teams (or a key that can't list them) still
        // has its own websites; only an outage or throttling is fatal.
        if (!isSkippableListError(error)) throw error;
      }
      const teamWebsites = await Promise.all(
        teams.slice(0, MAX_TEAMS).map(async (team) => {
          try {
            const rows = await listPaged(
              `teams/${encodeURIComponent(team.id)}/websites`,
              websiteSchema,
              "team website list",
            );
            return rows.map((row) => ({ row, team }));
          } catch (error) {
            if (!isSkippableListError(error)) throw error;
            return [];
          }
        }),
      );

      const teamNames = new Map(teams.map((team) => [team.id, team.name]));
      const byId = new Map<string, UmamiWebsite>();
      for (const { row, team } of teamWebsites.flat()) {
        byId.set(row.id.toLowerCase(), {
          id: row.id,
          name: row.name,
          domain: row.domain ?? null,
          teamId: team.id,
          teamName: team.name || null,
        });
      }
      for (const row of own) {
        if (byId.has(row.id.toLowerCase())) continue;
        const teamId = row.teamId ?? null;
        byId.set(row.id.toLowerCase(), {
          id: row.id,
          name: row.name,
          domain: row.domain ?? null,
          teamId,
          teamName: (teamId && teamNames.get(teamId)) || null,
        });
      }
      return [...byId.values()];
    },

    /** Totals for the range and, when Umami reports it, the equal-length
     *  period just before it (Umami's default comparison). */
    async getStats(
      request: RangeInput,
    ): Promise<{ current: UmamiTotals; previous: UmamiTotals | null }> {
      const answer = parseAnswer(
        statsSchema,
        await get(
          `websites/${encodeURIComponent(request.websiteId)}/stats`,
          rangeQuery(request),
        ),
        "stats",
      );
      const current = totalsFrom(answer, "value");
      if (!current) {
        throw new UmamiApiError(
          "other",
          "Umami returned an unexpected stats response.",
          null,
        );
      }
      return {
        current,
        previous: answer.comparison
          ? totalsFrom(answer.comparison, "value")
          : totalsFrom(answer, "prev"),
      };
    },

    /** Daily (or `unit`) pageviews and visitors, bucketed in `timezone`. */
    async getPageviewSeries(
      request: RangeInput & { unit: "day" | "hour"; timezone: string },
    ): Promise<{
      pageviews: UmamiSeriesPoint[];
      sessions: UmamiSeriesPoint[];
    }> {
      const answer = parseAnswer(
        pageviewsSchema,
        await get(
          `websites/${encodeURIComponent(request.websiteId)}/pageviews`,
          {
            ...rangeQuery(request),
            unit: request.unit,
            timezone: request.timezone,
          },
        ),
        "pageview series",
      );
      const toPoints = (points: z.infer<typeof seriesPointSchema>[]) =>
        points.flatMap((point) => {
          const date = bucketDay(point);
          return date ? [{ date, value: point.y }] : [];
        });
      return Array.isArray(answer)
        ? { pageviews: toPoints(answer), sessions: [] }
        : {
            pageviews: toPoints(answer.pageviews),
            sessions: toPoints(answer.sessions ?? []),
          };
    },

    /** One count per value of `type` (path, entry, referrer, channel, event,
     *  country...). Umami counts visitors for most types and views for
     *  pages. A null value (no referrer, unknown country) is named "". */
    async getMetrics(request: MetricsInput): Promise<UmamiMetricRow[]> {
      const rows = parseAnswer(
        metricsSchema,
        await getMetricRows("metrics", request),
        "metrics",
      );
      return rows.map((row) => ({ name: row.x ?? "", value: row.y }));
    },

    /** Visitors, visits, views, bounces and time per value of `type`
     *  (Umami 3 and later). */
    async getExpandedMetrics(
      request: MetricsInput,
    ): Promise<UmamiExpandedRow[]> {
      const rows = parseAnswer(
        expandedMetricsSchema,
        await getMetricRows("metrics/expanded", request),
        "expanded metrics",
      );
      return rows.map((row) => ({ ...row, name: row.name ?? "" }));
    },

    /** Visitors seen in the last few minutes. */
    async getActiveVisitors(websiteId: string): Promise<number> {
      return parseAnswer(
        activeSchema,
        await get(`websites/${encodeURIComponent(websiteId)}/active`),
        "active visitors",
      );
    },
  };
}

export type UmamiClient = ReturnType<typeof createUmamiClient>;
