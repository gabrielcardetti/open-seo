import { Badge } from "@/client/components/ui/badge";
import {
  URL_SUBMISSION_STATUSES,
  type UrlSubmissionChannel,
  type UrlSubmissionSource,
  type UrlSubmissionStatus,
} from "@/shared/indexing";

export const indexingQueryKeys = {
  all: (projectId: string) => ["indexing", projectId] as const,
  setup: (projectId: string) => ["indexing", projectId, "setup"] as const,
  log: (projectId: string) => ["indexing", projectId, "log"] as const,
  candidates: (projectId: string) =>
    ["indexing", projectId, "candidates"] as const,
  googleStatus: (projectId: string) =>
    ["indexing", projectId, "google-status"] as const,
};

export const STATUS_LABELS: Record<UrlSubmissionStatus, string> = {
  received: "Received",
  pending: "Pending",
  rejected: "Rejected",
  failed: "Failed",
  throttled: "Throttled",
  skipped_duplicate: "Duplicate",
  skipped_quota: "Over quota",
};

const STATUS_VARIANTS = {
  received: "success",
  pending: "info",
  rejected: "destructive",
  failed: "destructive",
  throttled: "warning",
  skipped_duplicate: "outline",
  skipped_quota: "warning",
} as const satisfies Record<UrlSubmissionStatus, string>;

export const CHANNEL_LABELS: Record<UrlSubmissionChannel, string> = {
  indexnow: "IndexNow",
  bing_api: "Bing API",
};

export const SOURCE_LABELS: Record<UrlSubmissionSource, string> = {
  manual: "Manual",
  mcp: "MCP",
  sitemap: "Sitemap",
  deploy_hook: "Deploy hook",
  audit: "Audit",
};

export function StatusBadge({ status }: { status: UrlSubmissionStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "Received 3 · Duplicate 2", in a stable order. */
export function summarizeCounts(
  counts: Partial<Record<UrlSubmissionStatus, number>>,
): string {
  const parts = URL_SUBMISSION_STATUSES.filter((status) => counts[status]).map(
    (status) => `${STATUS_LABELS[status]} ${counts[status]}`,
  );
  return parts.join(" · ") || "Nothing sent";
}
