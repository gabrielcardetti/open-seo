import { useState } from "react";
import { sort } from "remeda";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/client/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { DailyChart } from "@/client/features/analytics/AnalyticsCharts";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  BarList,
  LiveRead,
  ViewSwitch,
} from "@/client/features/analytics/AnalyticsParts";
import {
  eventDetailOptions,
  eventListOptions,
} from "@/client/features/analytics/analyticsQueries";
import { FunnelsPanel } from "@/client/features/analytics/FunnelsPanel";
import {
  AttributionPanel,
  JourneyPanel,
} from "@/client/features/analytics/ReportPanels";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const VIEWS = [
  { value: "events", label: "Events" },
  { value: "funnels", label: "Funnels" },
  { value: "journeys", label: "Journeys" },
  { value: "attribution", label: "Attribution" },
] as const;
type View = (typeof VIEWS)[number]["value"];

/** Daily points as chart rows, one key per event (`e0`, `e1`...) so event
 *  names never become CSS identifiers. */
function seriesRows(
  points: Array<{ event: string; date: string; count: number }>,
  events: string[],
) {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const point of points) {
    const index = events.indexOf(point.event);
    if (index < 0) continue;
    const row = byDate.get(point.date) ?? { date: point.date };
    row[`e${index}`] = point.count;
    byDate.set(point.date, row);
  }
  return sort([...byDate.values()], (a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

export function EventsTab(props: AnalyticsTabProps) {
  const { search, onSearchChange } = props;
  const view: View =
    VIEWS.find((item) => item.value === search.view)?.value ?? "events";
  return (
    <div className="space-y-4">
      <ViewSwitch
        label="Events view"
        value={view}
        items={VIEWS}
        onChange={(next) => onSearchChange({ view: next })}
      />
      {view === "events" ? (
        <EventList {...props} />
      ) : view === "funnels" ? (
        <FunnelsPanel {...props} />
      ) : view === "journeys" ? (
        <JourneyPanel {...props} />
      ) : (
        <AttributionPanel {...props} />
      )}
    </div>
  );
}

function EventList({ projectId, dates, channel }: AnalyticsTabProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery(eventListOptions(projectId, { ...dates, channel }));
  return (
    <>
      <LiveRead
        projectId={projectId}
        query={query}
        fallback="Couldn't load custom events from Umami."
      >
        {(result) => {
          if (result.rows.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                No custom events recorded in this range. Track them with
                Umami&rsquo;s <code>data-umami-event</code> attribute or{" "}
                <code>umami.track()</code>.
              </p>
            );
          }
          const charted = [
            ...new Set(result.points.map((point) => point.event)),
          ].slice(0, 10);
          return (
            <div className="space-y-3">
              {charted.length > 0 ? (
                <Card className="p-4">
                  <DailyChart
                    data={seriesRows(result.points, charted)}
                    label="Top custom events per day"
                    series={charted.map((event, index) => ({
                      key: `e${index}`,
                      label: event,
                    }))}
                  />
                </Card>
              ) : null}
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row) => {
                      const previous = row.previousCount ?? null;
                      const change =
                        previous && previous > 0
                          ? Math.round(
                              ((row.count - previous) / previous) * 100,
                            )
                          : null;
                      return (
                        <TableRow
                          key={row.event}
                          className="cursor-pointer"
                          onClick={() => setSelected(row.event)}
                        >
                          <TableCell className="font-medium">
                            {row.event}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCount(row.count)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {previous === null ? "—" : formatCount(previous)}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              change === null
                                ? ""
                                : change > 0
                                  ? "text-success"
                                  : change < 0
                                    ? "text-destructive"
                                    : ""
                            }`}
                          >
                            {change === null
                              ? "—"
                              : `${change > 0 ? "+" : ""}${change}%`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableCard>
            </div>
          );
        }}
      </LiveRead>
      <EventSheet
        projectId={projectId}
        scope={{ ...dates, channel }}
        event={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function EventSheet({
  projectId,
  scope,
  event,
  onClose,
}: {
  projectId: string;
  scope: AnalyticsTabProps["dates"] & {
    channel: AnalyticsTabProps["channel"];
  };
  event: string | null;
  onClose: () => void;
}) {
  const query = useQuery({
    ...eventDetailOptions(projectId, { ...scope, event: event ?? "" }),
    enabled: event !== null,
  });
  return (
    <Sheet
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="break-all pr-8">{event}</SheetTitle>
          <SheetDescription>
            Daily count and the properties recorded with this event (top ten
            properties, ten values each).
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {event ? (
            <LiveRead
              projectId={projectId}
              query={query}
              fallback="Couldn't load this event from Umami."
            >
              {(detail) => (
                <>
                  <DailyChart
                    className="h-40"
                    data={detail.points}
                    label={`${event} per day`}
                    series={[{ key: "count", label: "Count" }]}
                  />
                  {detail.properties.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No properties recorded with this event.
                    </p>
                  ) : (
                    detail.properties.map((property) => (
                      <div key={property.name} className="space-y-2">
                        <h3 className="text-sm font-semibold">
                          {property.name}
                          {property.moreValues > 0 ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              +{property.moreValues} more values
                            </span>
                          ) : null}
                        </h3>
                        <BarList
                          rows={property.values.map((value) => ({
                            label: value.value,
                            value: value.count,
                          }))}
                        />
                      </div>
                    ))
                  )}
                  {detail.moreProperties > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {detail.moreProperties} more properties not shown.
                    </p>
                  ) : null}
                </>
              )}
            </LiveRead>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
