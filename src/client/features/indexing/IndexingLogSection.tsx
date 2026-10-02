import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@/client/components/PageHeader";
import { StatTile } from "@/client/components/StatTile";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { getIndexingLog } from "@/serverFunctions/indexing";
import {
  URL_SUBMISSION_CHANNELS,
  URL_SUBMISSION_SOURCES,
  URL_SUBMISSION_STATUSES,
  type UrlSubmissionChannel,
  type UrlSubmissionSource,
  type UrlSubmissionStatus,
} from "@/shared/indexing";
import {
  CHANNEL_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  StatusBadge,
  formatDateTime,
  indexingQueryKeys,
} from "./indexingShared";

const PAGE_SIZE = 50;
const ALL = "all";

type Filters = {
  url: string;
  status: UrlSubmissionStatus | typeof ALL;
  source: UrlSubmissionSource | typeof ALL;
  channel: UrlSubmissionChannel | typeof ALL;
};

function FilterSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T | typeof ALL;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T | typeof ALL) => void;
}) {
  const items: { value: T | typeof ALL; label: string }[] = [
    { value: ALL, label: `Any ${label.toLowerCase()}` },
    ...options.map((option) => ({ value: option, label: labels[option] })),
  ];
  return (
    <Select<T | typeof ALL>
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type StatusCounts = Partial<Record<UrlSubmissionStatus, number>>;
const sent = (counts: StatusCounts) =>
  (counts.received ?? 0) + (counts.pending ?? 0);
const problems = (counts: StatusCounts) =>
  (counts.rejected ?? 0) + (counts.failed ?? 0) + (counts.throttled ?? 0);

const orUndefined = <T extends string>(value: T | typeof ALL) =>
  value === ALL ? undefined : value;

/** The ledger: every URL announced, newest first, with counts by status. */
export function IndexingLogSection({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<Filters>({
    url: "",
    status: ALL,
    source: ALL,
    channel: ALL,
  });
  const [page, setPage] = useState(1);
  const update = (patch: Partial<Filters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
  };
  const [urlDraft, setUrlDraft] = useDebouncedDraft(filters.url, (url) =>
    update({ url }),
  );

  const log = useQuery({
    queryKey: [...indexingQueryKeys.log(projectId), filters, page],
    queryFn: () =>
      getIndexingLog({
        data: {
          projectId,
          url: filters.url || undefined,
          status: orUndefined(filters.status),
          source: orUndefined(filters.source),
          channel: orUndefined(filters.channel),
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const week = log.data?.counts.last7Days ?? {};
  const month = log.data?.counts.last30Days ?? {};

  return (
    <section className="space-y-3">
      <SectionHeader title="Submission log" />
      <Card>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <StatTile label="Announced, 7 days" value={String(sent(week))} />
          <StatTile label="Announced, 30 days" value={String(sent(month))} />
          <StatTile
            label="Refused or failed, 7 days"
            value={String(problems(week))}
            tone={problems(week) > 0 ? "destructive" : undefined}
          />
          <StatTile
            label="Skipped, 7 days"
            value={String(
              (week.skipped_duplicate ?? 0) + (week.skipped_quota ?? 0),
            )}
            hint="duplicates and over-quota"
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-7 w-64 text-sm"
          placeholder="Filter by URL"
          aria-label="Filter by URL"
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={URL_SUBMISSION_STATUSES}
          labels={STATUS_LABELS}
          onChange={(status) => update({ status })}
        />
        <FilterSelect
          label="Source"
          value={filters.source}
          options={URL_SUBMISSION_SOURCES}
          labels={SOURCE_LABELS}
          onChange={(source) => update({ source })}
        />
        <FilterSelect
          label="Channel"
          value={filters.channel}
          options={URL_SUBMISSION_CHANNELS}
          labels={CHANNEL_LABELS}
          onChange={(channel) => update({ channel })}
        />
      </div>

      {log.isError ? (
        <p className="text-sm text-destructive">
          Could not load the submission log.
        </p>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(log.data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.submittedAt)}
                  </TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">
                    {row.url}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    {row.channel ? CHANNEL_LABELS[row.channel] : "—"}
                  </TableCell>
                  <TableCell>{SOURCE_LABELS[row.source]}</TableCell>
                  <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">
                    {row.errorMessage ??
                      (row.httpStatus ? `HTTP ${row.httpStatus}` : "")}
                  </TableCell>
                </TableRow>
              ))}
              {log.data && log.data.rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No submissions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={log.data?.total ?? null}
            isLoading={log.isFetching}
            onPageChange={setPage}
          />
        </TableCard>
      )}
    </section>
  );
}
