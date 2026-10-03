import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatTile } from "@/client/components/StatTile";
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
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  BarList,
  LiveRead,
  ViewSwitch,
} from "@/client/features/analytics/AnalyticsParts";
import {
  campaignDetailOptions,
  campaignsOptions,
  formatDuration,
  formatPercent,
  type AnalyticsDates,
  type CampaignField,
} from "@/client/features/analytics/analyticsQueries";
import { BreakdownTab } from "@/client/features/analytics/BreakdownTab";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const VIEWS = [
  { value: "channel", label: "Channels" },
  { value: "referrer", label: "Referrers" },
  { value: "utm", label: "UTM" },
  { value: "campaigns", label: "Campaigns" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const FIELD_LABELS: Record<CampaignField, string> = {
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_content: "Content",
  utm_term: "Term",
};

type Selected = { field: CampaignField; value: string };

/** Umami's channels and referrers, and UTM campaigns with their landing
 *  pages and conversions. */
export function AcquisitionTab(props: AnalyticsTabProps) {
  const { search, onSearchChange } = props;
  const view: View =
    VIEWS.find((item) => item.value === search.view)?.value ?? "channel";
  return (
    <div className="space-y-3">
      <ViewSwitch
        label="Acquisition view"
        value={view}
        items={VIEWS}
        onChange={(next) =>
          onSearchChange({ view: next, page: undefined, q: undefined })
        }
      />
      {view === "channel" ? (
        <BreakdownTab
          key="channel"
          {...props}
          views={[{ value: "channel", label: "Channels", column: "Channel" }]}
        />
      ) : view === "referrer" ? (
        <BreakdownTab
          key="referrer"
          {...props}
          views={[
            { value: "referrer", label: "Referrers", column: "Referrer" },
          ]}
        />
      ) : (
        <Campaigns {...props} view={view} />
      )}
    </div>
  );
}

function Campaigns({
  projectId,
  dates,
  view,
}: AnalyticsTabProps & { view: "utm" | "campaigns" }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const query = useQuery(campaignsOptions(projectId, dates));
  return (
    <>
      <LiveRead
        projectId={projectId}
        query={query}
        fallback="Couldn't load UTM campaigns from Umami."
      >
        {(result) =>
          view === "utm" ? (
            <div className="space-y-3">
              {!result.utmReportAvailable ? (
                <p className="text-sm text-muted-foreground">
                  This Umami can&rsquo;t run its UTM report. The Campaigns view
                  still shows UTM combinations from landing URLs.
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Pageviews per UTM value, all traffic. Choose a value to see its
                landing pages and events.
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {result.fields.map((field) => (
                  <Card key={field.field} className="gap-3 p-4">
                    <h3 className="text-sm font-semibold">
                      {FIELD_LABELS[field.field]}
                    </h3>
                    <BarList
                      rows={field.rows.slice(0, 15).map((row) => ({
                        label: row.value,
                        value: row.views,
                      }))}
                      empty="No tagged links in this range."
                      onSelect={(value) =>
                        setSelected({ field: field.field, value })
                      }
                    />
                  </Card>
                ))}
              </div>
            </div>
          ) : result.combinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No landing URL carried UTM parameters in this range.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Source, medium and campaign combinations read from landing URLs,
                in visits. Choose a row to see the campaign&rsquo;s landing
                pages and events.
              </p>
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Medium</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.combinations.map((row) => {
                      const target: Selected | null = row.campaign
                        ? { field: "utm_campaign", value: row.campaign }
                        : row.source
                          ? { field: "utm_source", value: row.source }
                          : null;
                      return (
                        <TableRow
                          key={JSON.stringify(row)}
                          className={target ? "cursor-pointer" : undefined}
                          onClick={() => {
                            if (target) setSelected(target);
                          }}
                        >
                          <TableCell>{row.source ?? "—"}</TableCell>
                          <TableCell>{row.medium ?? "—"}</TableCell>
                          <TableCell>{row.campaign ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.content ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCount(row.count)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableCard>
            </div>
          )
        }
      </LiveRead>
      <CampaignSheet
        projectId={projectId}
        dates={dates}
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function CampaignSheet({
  projectId,
  dates,
  selected,
  onClose,
}: {
  projectId: string;
  dates: AnalyticsDates;
  selected: Selected | null;
  onClose: () => void;
}) {
  const query = useQuery({
    ...campaignDetailOptions(projectId, {
      ...dates,
      field: selected?.field ?? "utm_campaign",
      value: selected?.value ?? "",
    }),
    enabled: selected !== null,
  });
  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="break-all pr-8">
            {selected
              ? `${FIELD_LABELS[selected.field]}: ${selected.value}`
              : ""}
          </SheetTitle>
          <SheetDescription>
            Visits whose landing URL carried this UTM value, for the selected
            dates.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {selected ? (
            <LiveRead
              projectId={projectId}
              query={query}
              fallback="Couldn't load this campaign from Umami."
            >
              {(detail) => (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatTile
                      label="Visits"
                      value={formatCount(detail.totals.visits)}
                    />
                    <StatTile
                      label="Visitors"
                      value={formatCount(detail.totals.visitors)}
                    />
                    <StatTile
                      label="Bounce rate"
                      value={formatPercent(detail.totals.bounceRate)}
                    />
                    <StatTile
                      label="Avg. visit"
                      value={formatDuration(detail.totals.avgVisitSeconds)}
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Landing pages</h3>
                    <BarList
                      rows={detail.landingPages.map((row) => ({
                        label: row.name,
                        value: row.visits ?? row.count ?? 0,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Events</h3>
                    <BarList
                      rows={detail.events.map((row) => ({
                        label: row.event,
                        value: row.count,
                      }))}
                      empty="No custom events from these visits."
                    />
                  </div>
                </>
              )}
            </LiveRead>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
