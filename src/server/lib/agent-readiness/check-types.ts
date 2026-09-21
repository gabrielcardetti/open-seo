/** Types and helpers shared by the agent-readiness checks. */
import type { Probe, ProbeResponse } from "./probe";

export const AGENT_READINESS_PROFILES = ["content", "apiApp"] as const;
export type AgentReadinessProfile = (typeof AGENT_READINESS_PROFILES)[number];

export const CHECK_STATUSES = [
  "pass",
  "fail",
  "not_applicable",
  "info",
  "error",
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_CATEGORIES = [
  "discoverability",
  "content",
  "botAccess",
  "capabilities",
] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export interface CheckResult {
  checkId: string;
  category: CheckCategory;
  status: CheckStatus;
  message: string;
  evidence?: string | null;
  fixUrl?: string | null;
}

export interface CheckContext {
  origin: string;
  probe: Probe;
  home: () => Promise<ProbeResponse | null>;
  robots: () => Promise<ProbeResponse | null>;
}

export interface CheckDefinition {
  id: string;
  category: CheckCategory;
  /** Profiles the check applies to; outside them it is `not_applicable`. */
  profiles: readonly AgentReadinessProfile[];
  fixUrl: string | null;
  run(
    ctx: CheckContext,
  ): Promise<Omit<CheckResult, "checkId" | "category" | "fixUrl">>;
}

/** An HTML page where a file was expected is almost always a soft 404. */
export function isHtml(response: ProbeResponse): boolean {
  return (
    response.contentType.includes("html") ||
    /^\s*<!doctype html|^\s*<html/i.test(response.body)
  );
}

export function describe(response: ProbeResponse | null): string {
  if (!response) return "no response";
  return `${response.status} ${response.contentType || "(no content-type)"}, ${response.body.length} bytes`;
}
