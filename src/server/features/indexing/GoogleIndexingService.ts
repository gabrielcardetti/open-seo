/**
 * The Google Indexing API connection: a project's service-account key, kept
 * encrypted, and a read-only health check that tells the user what is still
 * missing on Google's side. The check mints a token (does the key work?) and
 * reads urlNotifications/metadata for a sample URL (is the API enabled, and
 * does the service account own the Search Console property?). It never sends
 * a notification. Runs on save, on demand, and once a day from the cron.
 *
 * Problems the user can fix come back as data with plain-language steps, not
 * thrown errors, because thrown errors reach the client as a bare code.
 */
import { AppError } from "@/server/lib/errors";
import { openSecret, sealSecret } from "@/server/lib/secretBox";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import type { GoogleIndexingStatus } from "@/shared/indexing";
import {
  getUrlMetadata,
  mintAccessToken,
  serviceAccountSchema,
  type GoogleReply,
  type ServiceAccount,
} from "./googleIndexingApi";
import {
  GoogleIndexingRepository,
  type GoogleIndexingConnection,
} from "./GoogleIndexingRepository";
import { isSameSite, projectHost } from "./site";

const KEY_PURPOSE = "Google Indexing API service-account keys";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CHECKS_PER_TICK = 10;
const TICK_DEADLINE_MS = 2 * MINUTE_MS;
const MAX_ERROR_LENGTH = 500;

type CheckResult = { status: GoogleIndexingStatus; error: string | null };

/** Sorts a metadata answer into a status. A 404 only means "nothing sent yet". */
function classifyMetadata(reply: GoogleReply): CheckResult {
  if (reply.status === 200 || reply.status === 404) {
    return { status: "ok", error: null };
  }
  if (reply.status === 429) {
    return { status: "quota_exceeded", error: reply.message };
  }
  if (reply.status === 403) {
    if (
      /SERVICE_DISABLED|has not been used in project|is disabled/i.test(
        reply.body,
      )
    ) {
      return { status: "api_disabled", error: reply.message };
    }
    if (/verify the URL ownership/i.test(reply.body)) {
      return { status: "not_owner", error: reply.message };
    }
  }
  return { status: "error", error: reply.message };
}

async function runCheck(
  account: ServiceAccount,
  sampleUrl: string | null,
): Promise<CheckResult> {
  const minted = await mintAccessToken(account);
  if ("reply" in minted) {
    const { status, message } = minted.reply;
    // Unreachable or Google-side failures say nothing about the key.
    if (status === 0 || status >= 500)
      return { status: "error", error: message };
    if (status === 429) return { status: "quota_exceeded", error: message };
    return { status: "invalid_key", error: message };
  }
  if (!sampleUrl) {
    return {
      status: "error",
      error:
        "The project has no website domain to check against. Set one in the project settings, or choose a sample URL.",
    };
  }
  return classifyMetadata(await getUrlMetadata(minted.token, sampleUrl));
}

/** The URL the check reads: the chosen one, else the domain's home page. */
function sampleUrlFor(
  connection: Pick<GoogleIndexingConnection, "sampleUrl"> | null,
  domain: string | null,
): string | null {
  if (connection?.sampleUrl) return connection.sampleUrl;
  const host = projectHost(domain);
  return host ? `https://${host}/` : null;
}

function describe(
  status: GoogleIndexingStatus,
  context: {
    clientEmail: string | null;
    gcpProjectId: string | null;
    sampleUrl: string | null;
    error: string | null;
  },
): { reason: string; steps: string[]; fixUrl: string | null } {
  const email = context.clientEmail ?? "the service account's email";
  const sample = context.sampleUrl ?? "the sample URL";
  switch (status) {
    case "ok":
      return {
        reason: `Google accepted the service account for ${sample}: the key works, the Indexing API is enabled, and ${email} owns the property.`,
        steps: [],
        fixUrl: null,
      };
    case "not_configured":
      return {
        reason: "No service account saved.",
        steps: [
          "In Google Cloud, create a service account and add a JSON key to it (IAM & Admin → Service accounts → Keys → Add key → JSON).",
          "Enable the Web Search Indexing API in that Cloud project.",
          "In Search Console, add the service account's email as an Owner of the property.",
          "Paste the JSON key here.",
        ],
        fixUrl: null,
      };
    case "invalid_key":
      return {
        reason: `Google's token endpoint refused the key: ${context.error ?? "no reason given"}`,
        steps: [
          `In Google Cloud, open IAM & Admin → Service accounts → ${email} → Keys and check the key still exists and the account is enabled.`,
          "If the key was deleted or disabled, add a new JSON key and paste it here.",
          "A message about iat, exp or the time means the clock of the server running OpenSEO is off; fix its time sync and check again.",
        ],
        fixUrl: null,
      };
    case "api_disabled": {
      const fixUrl = `https://console.cloud.google.com/apis/library/indexing.googleapis.com${context.gcpProjectId ? `?project=${encodeURIComponent(context.gcpProjectId)}` : ""}`;
      return {
        reason: `The Web Search Indexing API is not enabled in the Google Cloud project ${context.gcpProjectId ?? "of the service account"}.`,
        steps: [
          `Open ${fixUrl} and click Enable.`,
          "Wait a few minutes for the change to reach Google's systems, then check again.",
        ],
        fixUrl,
      };
    }
    case "not_owner":
      return {
        reason: `Google could not verify that ${email} owns the Search Console property for ${sample}.`,
        steps: [
          `In Search Console, open the property that covers ${sample}.`,
          `Go to Settings → Users and permissions → Add user, enter ${email} and choose the Owner permission. If you are a delegated owner, use Manage property owners → Add an owner instead.`,
          `If ${email} is already listed with Full permission, that is not enough: the Indexing API only accepts Owners. Make it an Owner.`,
          "Owner changes can take a few minutes to reach the Indexing API. Check again here.",
        ],
        fixUrl: "https://search.google.com/search-console/users",
      };
    case "quota_exceeded":
      return {
        reason: `Google's Indexing API quota for this Cloud project is used up for now: ${context.error ?? "HTTP 429"}`,
        steps: [
          "Wait for the quota to reset (the daily quota resets at midnight Pacific Time), then check again.",
          "To see or raise the quota: Google Cloud → APIs & Services → Web Search Indexing API → Quotas.",
        ],
        fixUrl: null,
      };
    case "error":
      return {
        reason: `The check failed: ${context.error ?? "unknown error"}`,
        steps: [
          "Check again in a few minutes. If the same message comes back, follow what Google says in it.",
        ],
        fixUrl: null,
      };
  }
}

function toView(
  connection: GoogleIndexingConnection | null,
  domain: string | null,
) {
  const sampleUrl = sampleUrlFor(connection, domain);
  const status = connection?.status ?? "not_configured";
  return {
    status,
    ...describe(status, {
      clientEmail: connection?.clientEmail ?? null,
      gcpProjectId: connection?.gcpProjectId ?? null,
      sampleUrl,
      error: connection?.lastError ?? null,
    }),
    clientEmail: connection?.clientEmail ?? null,
    gcpProjectId: connection?.gcpProjectId ?? null,
    sampleUrl,
    customSampleUrl: connection?.sampleUrl ?? null,
    lastError: connection?.lastError ?? null,
    lastCheckedAt: connection?.lastCheckedAt ?? null,
    statusChangedAt: connection?.statusChangedAt ?? null,
  };
}
export type GoogleIndexingView = ReturnType<typeof toView>;

async function requireProject(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  return project;
}

async function getView(projectId: string, domain: string | null) {
  return toView(
    await GoogleIndexingRepository.getByProjectId(projectId),
    domain,
  );
}

/** The pasted JSON as a service account, or why it isn't one. */
function parseServiceAccount(
  json: string,
): { account: ServiceAccount } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "That is not valid JSON. Paste the whole key file." };
  }
  const result = serviceAccountSchema.safeParse(parsed);
  if (!result.success) {
    return {
      error: result.error.issues[0]?.message ?? "Not a service account key.",
    };
  }
  return { account: result.data };
}

async function openAccount(
  connection: GoogleIndexingConnection,
): Promise<ServiceAccount | null> {
  try {
    const json = await openSecret(
      connection.serviceAccountEncrypted,
      KEY_PURPOSE,
    );
    const parsed = parseServiceAccount(json);
    return "account" in parsed ? parsed.account : null;
  } catch {
    return null;
  }
}

/** A chosen sample URL on the project's site, or why it can't be used. */
function validateSampleUrl(
  value: string,
  domain: string | null,
): { url: string } | { error: string } {
  const host = projectHost(domain);
  let parsed: URL | null = null;
  try {
    parsed = new URL(value);
  } catch {
    // handled below
  }
  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    (host && !isSameSite(parsed.hostname, host))
  ) {
    return {
      error: `The sample URL must be a full URL on ${host ?? "the project's site"}.`,
    };
  }
  return { url: parsed.toString() };
}

const statusChangedAt = (
  previous: GoogleIndexingConnection | null,
  status: GoogleIndexingStatus,
  nowIso: string,
) =>
  previous && previous.status === status ? previous.statusChangedAt : nowIso;

/**
 * Save (or replace) the key and the sample URL, then check them. Without new
 * JSON the saved key is kept, so the sample URL can change on its own. A key
 * Google refuses is still saved, with the status saying why.
 */
async function save(
  projectId: string,
  input: { serviceAccountJson?: string; sampleUrl?: string | null },
): Promise<
  | { ok: true; googleIndexing: GoogleIndexingView }
  | { ok: false; field: "serviceAccountJson" | "sampleUrl"; error: string }
> {
  const project = await requireProject(projectId);
  const existing = await GoogleIndexingRepository.getByProjectId(projectId);

  let sampleUrl: string | null = null;
  const rawSample = input.sampleUrl?.trim();
  if (rawSample) {
    const validated = validateSampleUrl(rawSample, project.domain);
    if ("error" in validated)
      return { ok: false, field: "sampleUrl", error: validated.error };
    sampleUrl = validated.url;
  }

  const json = input.serviceAccountJson?.trim();
  let account: ServiceAccount;
  let serviceAccountEncrypted: string;
  if (json) {
    const parsed = parseServiceAccount(json);
    if ("error" in parsed) {
      return { ok: false, field: "serviceAccountJson", error: parsed.error };
    }
    account = parsed.account;
    serviceAccountEncrypted = await sealSecret(json, KEY_PURPOSE);
  } else if (existing) {
    const opened = await openAccount(existing);
    if (!opened) {
      return {
        ok: false,
        field: "serviceAccountJson",
        error: "The saved key can no longer be read. Paste the JSON key again.",
      };
    }
    account = opened;
    serviceAccountEncrypted = existing.serviceAccountEncrypted;
  } else {
    return {
      ok: false,
      field: "serviceAccountJson",
      error: "Paste the service account's JSON key.",
    };
  }

  const result = await runCheck(
    account,
    sampleUrlFor({ sampleUrl }, project.domain),
  );
  const now = new Date();
  const nowIso = now.toISOString();
  await GoogleIndexingRepository.upsert(projectId, {
    serviceAccountEncrypted,
    clientEmail: account.client_email,
    gcpProjectId: account.project_id ?? null,
    sampleUrl,
    status: result.status,
    lastError: result.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
    lastCheckedAt: nowIso,
    statusChangedAt: statusChangedAt(existing, result.status, nowIso),
    nextCheckAt: new Date(now.getTime() + DAY_MS).toISOString(),
  });
  return { ok: true, googleIndexing: await getView(projectId, project.domain) };
}

/** Check the saved key now and record the result. */
async function check(projectId: string): Promise<GoogleIndexingView> {
  const project = await requireProject(projectId);
  const connection = await GoogleIndexingRepository.getByProjectId(projectId);
  if (!connection) return toView(null, project.domain);

  const account = await openAccount(connection);
  const result: CheckResult = account
    ? await runCheck(account, sampleUrlFor(connection, project.domain))
    : {
        status: "invalid_key",
        error:
          "The saved key can no longer be decrypted (was BETTER_AUTH_SECRET changed?). Paste the JSON key again.",
      };
  const now = new Date();
  const nowIso = now.toISOString();
  await GoogleIndexingRepository.update(projectId, {
    status: result.status,
    lastError: result.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
    lastCheckedAt: nowIso,
    statusChangedAt: statusChangedAt(connection, result.status, nowIso),
    nextCheckAt: new Date(now.getTime() + DAY_MS).toISOString(),
  });
  return getView(projectId, project.domain);
}

async function remove(projectId: string) {
  await requireProject(projectId);
  await GoogleIndexingRepository.deleteByProjectId(projectId);
}

/**
 * Daily checks driven by the five-minute cron. Each due project is claimed
 * with a compare-and-set a day ahead, so overlapping ticks never check one
 * project twice. Never throws: one cron job must not stop the others.
 */
async function runScheduledChecks() {
  const startedAt = Date.now();
  const tally = { ran: 0, failed: 0 };
  try {
    const due = await GoogleIndexingRepository.getDue(
      new Date(startedAt).toISOString(),
      CHECKS_PER_TICK,
    );
    for (const connection of due) {
      if (Date.now() - startedAt > TICK_DEADLINE_MS) break;
      const claimed = await GoogleIndexingRepository.claimCheck({
        projectId: connection.projectId,
        observed: connection.nextCheckAt,
        next: new Date(startedAt + DAY_MS).toISOString(),
      });
      if (!claimed) continue;
      try {
        await check(connection.projectId);
        tally.ran += 1;
      } catch (error) {
        tally.failed += 1;
        console.error("Scheduled Google Indexing API check failed", {
          projectId: connection.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (due.length > 0) {
      console.log("Scheduled Google Indexing API checks", {
        due: due.length,
        ...tally,
      });
    }
  } catch (error) {
    console.error("Scheduled Google Indexing API tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return tally;
}

export const GoogleIndexingService = {
  getView,
  save,
  check,
  remove,
  runScheduledChecks,
} as const;
