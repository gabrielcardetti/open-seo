import type { ReactNode } from "react";
import { Badge } from "@/client/components/ui/badge";
import type { SitemapsData } from "./sitemapQueries";

type TrackedRow = SitemapsData["tracked"][number];

const count = (value: number) => value.toLocaleString();

/** Google's view of one tracked sitemap, as a few badges. */
function GoogleBadges({ google }: { google: TrackedRow["google"] }) {
  if (google.state === "not_connected") {
    return <Badge variant="outline">Google: not connected</Badge>;
  }
  if (google.state === "unknown") {
    return <Badge variant="outline">Google: unknown</Badge>;
  }
  if (google.state === "missing") {
    return (
      <Badge variant="warning">
        {google.outsideProperty
          ? "Outside the Search Console property"
          : "Missing in Google"}
      </Badge>
    );
  }
  return (
    <>
      <Badge variant="success">Google ✓</Badge>
      {google.isPending ? <Badge variant="info">Pending</Badge> : null}
      {google.errors > 0 ? (
        <Badge variant="destructive">
          {count(google.errors)} error{google.errors === 1 ? "" : "s"}
        </Badge>
      ) : null}
      {google.warnings > 0 ? (
        <Badge variant="warning">
          {count(google.warnings)} warning{google.warnings === 1 ? "" : "s"}
        </Badge>
      ) : null}
      {google.submitted !== null ? (
        <span className="text-xs text-muted-foreground">
          {count(google.indexed ?? 0)} of {count(google.submitted)} indexed
        </span>
      ) : null}
    </>
  );
}

/** Bing's view of one tracked sitemap, from the last sync. */
function BingBadges({ bing }: { bing: TrackedRow["bing"] }) {
  if (bing.state === "not_connected") {
    return <Badge variant="outline">Bing: not connected</Badge>;
  }
  if (bing.state === "unknown") {
    return <Badge variant="outline">Bing: not synced yet</Badge>;
  }
  if (bing.state === "missing") {
    return <Badge variant="warning">Missing in Bing</Badge>;
  }
  return (
    <>
      <Badge variant="success">Bing ✓</Badge>
      {bing.status && bing.status !== "Success" ? (
        <Badge variant="warning">{bing.status}</Badge>
      ) : null}
      {bing.urlCount !== null ? (
        <span className="text-xs text-muted-foreground">
          {count(bing.urlCount)} URLs
        </span>
      ) : null}
    </>
  );
}

/** One sitemap URL with its badges and row actions. */
export function SitemapRow({
  url,
  badges,
  actions,
}: {
  url: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-xs break-all">{url}</p>
        {badges ? (
          <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </li>
  );
}

export function TrackedBadges({ row }: { row: TrackedRow }) {
  return (
    <>
      <GoogleBadges google={row.google} />
      <BingBadges bing={row.bing} />
    </>
  );
}

/** A titled list of sitemap rows; renders nothing when empty. */
export function SitemapSection({
  title,
  description,
  action,
  children,
  empty,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  empty: boolean;
}) {
  if (empty) return null;
  return (
    <section className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}
