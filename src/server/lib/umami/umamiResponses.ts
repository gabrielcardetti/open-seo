import { z } from "zod";
import { UmamiApiError } from "./umamiErrors";

// Parsing for Umami API answers. Umami 2 and 3 disagree on several shapes, so
// each schema accepts both and the client returns one form.

const MAX_RESPONSE_BYTES = 2_000_000;

export type UmamiTotals = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  // Seconds summed over visits.
  totaltime: number;
};

// Counts arrive as numbers, or as strings when the database returns bigints.
const numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

// Umami 3 answers stats as flat numbers plus a `comparison` object; Umami 2
// as `{ value, prev }` per metric.
const statField = z.union([
  numeric,
  z.looseObject({ value: numeric, prev: numeric.optional() }),
]);

const totalsShape = {
  pageviews: statField,
  visitors: statField,
  // Missing before visits were tracked separately (early Umami 2).
  visits: statField.optional(),
  bounces: statField,
  totaltime: statField,
};

export const statsSchema = z.looseObject({
  ...totalsShape,
  comparison: z.looseObject(totalsShape).optional(),
});

export const seriesPointSchema = z.looseObject({
  x: z.union([z.string(), z.number()]).optional(),
  t: z.union([z.string(), z.number()]).optional(),
  y: numeric,
});

export const pageviewsSchema = z.union([
  z.looseObject({
    pageviews: z.array(seriesPointSchema),
    sessions: z.array(seriesPointSchema).optional(),
  }),
  // Very old instances answered the pageview series as a bare array.
  z.array(seriesPointSchema),
]);

export const metricsSchema = z.array(
  z.looseObject({ x: z.string().nullable(), y: numeric }),
);

export const expandedMetricsSchema = z.array(
  z.looseObject({
    name: z.string().nullable(),
    pageviews: numeric.catch(0),
    visitors: numeric.catch(0),
    visits: numeric.catch(0),
    bounces: numeric.catch(0),
    totaltime: numeric.catch(0),
  }),
);

// Umami 3: {visitors}; Umami 2: {x} or [{x}].
export const activeSchema = z.union([
  z.looseObject({ visitors: numeric }).transform((value) => value.visitors),
  z.looseObject({ x: numeric }).transform((value) => value.x),
  z.array(z.looseObject({ x: numeric })).transform((value) => value[0]?.x ?? 0),
]);

export const websiteSchema = z.looseObject({
  id: z.string(),
  name: z.string().catch(""),
  domain: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

export const teamSchema = z.looseObject({
  id: z.string(),
  name: z.string().catch(""),
});

// Lists are paged as {data, count, page, pageSize}; very old instances
// answered a bare array.
export function pagedSchema<T extends z.ZodType>(item: T) {
  return z.union([
    z.array(item),
    z.looseObject({ data: z.array(item), count: numeric.optional() }),
  ]);
}

export const loginSchema = z.looseObject({ token: z.string().min(1) });

export function statusError(status: number): UmamiApiError {
  if (status === 401 || status === 403) {
    return new UmamiApiError(
      "auth",
      "Umami rejected the saved credentials, or that user can't read this website. Save the connection again.",
      status,
    );
  }
  if (status === 404) {
    return new UmamiApiError(
      "not_found",
      "Umami couldn't find that website. Check the instance address and choose the website again.",
      status,
    );
  }
  if (status === 429) {
    return new UmamiApiError(
      "throttled",
      "Umami is rate-limiting requests. Retry in a few minutes.",
      status,
    );
  }
  if (status >= 500) {
    return new UmamiApiError(
      "unreachable",
      `Umami returned a server error (HTTP ${status}). Retry later.`,
      status,
    );
  }
  if (status >= 300 && status < 400) {
    return new UmamiApiError(
      "other",
      "Umami answered with a redirect. Enter the instance's final https address.",
      status,
    );
  }
  return new UmamiApiError(
    "other",
    `Umami rejected the request (HTTP ${status}).`,
    status,
  );
}

/** Parse an Umami answer, logging (never the payload or credentials) and
 *  failing when its shape is one this client doesn't know. */
export function parseAnswer<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.warn("[umami] unexpected response", {
    label,
    issues: parsed.error.issues.slice(0, 5).map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  });
  throw new UmamiApiError(
    "other",
    `Umami returned an unexpected ${label} response.`,
    null,
  );
}

export async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new UmamiApiError("other", "Umami's response was too large.", null);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (
    let next = await reader?.read();
    next && !next.done;
    next = await reader?.read()
  ) {
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader?.cancel().catch(() => undefined);
      throw new UmamiApiError("other", "Umami's response was too large.", null);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UmamiApiError(
      "other",
      "The address didn't answer like an Umami API. Check the instance address.",
      response.status,
    );
  }
}

export function totalsFrom(
  value: z.infer<typeof statsSchema>,
  pick: "value" | "prev",
): UmamiTotals | null {
  const read = (field: z.infer<typeof statField> | undefined) => {
    if (field === undefined) return undefined;
    if (typeof field === "number") return pick === "value" ? field : undefined;
    return field[pick];
  };
  const pageviews = read(value.pageviews);
  const visitors = read(value.visitors);
  const bounces = read(value.bounces);
  const totaltime = read(value.totaltime);
  if (
    pageviews === undefined ||
    visitors === undefined ||
    bounces === undefined ||
    totaltime === undefined
  ) {
    return null;
  }
  return {
    pageviews,
    visitors,
    visits: read(value.visits) ?? visitors,
    bounces,
    totaltime,
  };
}

/** Failures that only mean "no teams here": the route is missing on older
 *  instances, or the identity can't list a team it belongs to. */
export function isSkippableListError(error: unknown): boolean {
  return (
    error instanceof UmamiApiError &&
    (error.kind === "auth" ||
      error.kind === "not_found" ||
      error.kind === "other")
  );
}

/** The YYYY-MM-DD day of a series bucket ("2026-09-01 00:00:00", an ISO
 *  timestamp, or epoch milliseconds). */
export function bucketDay(
  point: z.infer<typeof seriesPointSchema>,
): string | null {
  const raw = point.x ?? point.t;
  if (typeof raw === "number") {
    const date = new Date(raw);
    return Number.isNaN(date.valueOf())
      ? null
      : date.toISOString().slice(0, 10);
  }
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}
