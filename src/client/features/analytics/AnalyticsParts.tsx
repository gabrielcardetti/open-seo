import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { StatTile } from "@/client/components/StatTile";
import { Card } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { analyticsErrorMessage } from "@/client/features/analytics/analyticsQueries";
import { umamiConnectionOptions } from "@/client/features/umami/umamiQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const NOT_CONNECTED_MESSAGES = {
  not_connected: "Umami isn't connected to this project any more.",
  auth: "Umami no longer accepts the saved credentials, or that user can't read this website. Save the connection again in Settings → Integrations.",
  website_not_found:
    "Umami can't find the connected website any more. Choose the website again in Settings → Integrations.",
} as const;

type NotConnectedReason = keyof typeof NOT_CONNECTED_MESSAGES;

/**
 * A read answered `connected: false` while the cached connection still says
 * connected (another member disconnected, or Umami refused the credentials).
 * Says why, and refreshes the connection so the page shows the connect card
 * when the project is no longer connected.
 */
export function AnalyticsConnectionLost({
  projectId,
  reason,
}: {
  projectId: string;
  reason: NotConnectedReason;
}) {
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: umamiConnectionOptions(projectId).queryKey,
    });
  }, [queryClient, projectId]);
  return (
    <p role="alert" className="text-sm text-destructive">
      {NOT_CONNECTED_MESSAGES[reason]}
    </p>
  );
}

type LiveAnswer =
  | { connected: true }
  | { connected: false; reason: NotConnectedReason };

function isConnected<T extends LiveAnswer>(
  answer: T,
): answer is Extract<T, { connected: true }> {
  return answer.connected;
}

/**
 * The loading, error and connection-lost states every live read shares;
 * `children` renders the connected answer.
 */
export function LiveRead<T extends LiveAnswer>({
  projectId,
  query,
  fallback,
  skeleton = <SkeletonTableRows columns={4} />,
  children,
}: {
  projectId: string;
  query: UseQueryResult<T, unknown>;
  fallback: string;
  skeleton?: ReactNode;
  children: (data: Extract<T, { connected: true }>) => ReactNode;
}) {
  if (query.isError && !query.data) {
    return (
      <QueryError
        cause={query.error}
        fallback={analyticsErrorMessage(query.error, fallback)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  if (!data) return <>{skeleton}</>;
  if (isConnected(data)) return <>{children(data)}</>;
  return (
    <AnalyticsConnectionLost
      projectId={projectId}
      reason={data.connected ? "not_connected" : data.reason}
    />
  );
}

export function MetricCard(props: {
  label: string;
  value: string;
  delta?: { current: number | null; previous: number | null };
  hint?: string;
}) {
  return (
    <Card className="gap-0 p-4">
      <StatTile {...props} />
    </Card>
  );
}

/** Pill tabs that switch a tab's sub-view. */
export function ViewSwitch<T extends string>({
  value,
  items,
  onChange,
  label,
}: {
  value: T;
  items: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const picked = items.find((item) => item.value === next);
        if (picked) onChange(picked.value);
      }}
    >
      <TabsList aria-label={label} className="h-auto! flex-wrap">
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** A ranked list with proportional bars, for short breakdowns. */
export function BarList({
  rows,
  format = formatCount,
  empty = "Nothing recorded in this range.",
  onSelect,
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
  format?: (value: number) => string;
  empty?: string;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const content = (
          <>
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
            <span className="relative min-w-0 truncate" title={row.label}>
              {row.label || "(none)"}
              {row.hint ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.hint}
                </span>
              ) : null}
            </span>
            <span className="relative shrink-0 tabular-nums">
              {format(row.value)}
            </span>
          </>
        );
        const className =
          "relative flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm";
        return (
          <li key={row.label}>
            {onSelect ? (
              <button
                type="button"
                className={`${className} hover:bg-muted`}
                onClick={() => onSelect(row.label)}
              >
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const MAX_SEARCH_LENGTH = 200;

/** A filter box that applies on submit or blur. */
export function SearchBox({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      className="relative max-w-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() !== initial) onSubmit(value.trim());
        }}
        className="h-8 pl-8"
      />
    </form>
  );
}

/** A titled block inside a tab. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
