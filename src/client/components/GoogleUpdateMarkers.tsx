import { ReferenceLine } from "recharts";
import { sort } from "remeda";
import {
  googleSearchUpdatesBetween,
  RANKING_UPDATE_KINDS,
  type GoogleSearchUpdate,
} from "@/shared/google-search-updates";

/**
 * Pins each Google core or spam update to the first chart point on or after
 * its announcement date, so a weekly bucket still gets the update that landed
 * mid-week. Updates past the last point are left out: the chart cannot show
 * what they did yet.
 */
function markersFor(dates: string[]): Array<[string, GoogleSearchUpdate[]]> {
  const sorted = sort(dates, (a, b) => a.localeCompare(b));
  if (sorted.length === 0) return [];
  const byPoint = new Map<string, GoogleSearchUpdate[]>();
  const updates = googleSearchUpdatesBetween(
    sorted[0],
    sorted[sorted.length - 1],
    RANKING_UPDATE_KINDS,
  );
  for (const update of updates) {
    const point = sorted.find((date) => date >= update.date);
    if (point) byPoint.set(point, [...(byPoint.get(point) ?? []), update]);
  }
  return [...byPoint];
}

/** A small dot at the top of the line; hover names the update, click opens
 *  Google's announcement. Recharts passes the line's `viewBox`. */
function UpdateMarker({
  updates,
  viewBox,
}: {
  updates: GoogleSearchUpdate[];
  viewBox?: { x?: number; y?: number };
}) {
  const x = viewBox?.x;
  const y = viewBox?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  const title = updates
    .map((update) => `${update.name} (${update.date})`)
    .join("\n");
  return (
    <a href={updates[0].source} target="_blank" rel="noreferrer">
      <title>{`Google update: ${title}`}</title>
      <circle cx={x} cy={y + 4} r={8} fill="transparent" />
      <circle
        cx={x}
        cy={y + 4}
        r={3}
        fill="var(--muted-foreground)"
        fillOpacity={0.7}
      />
    </a>
  );
}

/**
 * Dashed vertical markers for Google's core and spam updates on a daily or
 * weekly chart whose x axis is YYYY-MM-DD dates. Charts with named y axes pass
 * `yAxisId`, which Recharts requires to place the line.
 */
export function GoogleUpdateMarkers({
  dates,
  yAxisId,
}: {
  dates: string[];
  yAxisId?: string;
}) {
  return markersFor(dates).map(([x, updates]) => (
    <ReferenceLine
      key={x}
      x={x}
      yAxisId={yAxisId}
      stroke="var(--muted-foreground)"
      strokeOpacity={0.35}
      strokeDasharray="2 3"
      label={<UpdateMarker updates={updates} />}
    />
  ));
}
