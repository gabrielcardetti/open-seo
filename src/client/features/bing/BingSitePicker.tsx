import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sortBy } from "remeda";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Field, FieldLabel } from "@/client/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  bingErrorMessage,
  bingSitesOptions,
} from "@/client/features/bing/bingQueries";

/**
 * The verified sites the member's key can read. The one whose host matches
 * the project's domain comes first and is preselected.
 */
export function BingSitePicker({
  projectId,
  saving,
  onSave,
  onCancel,
}: {
  projectId: string;
  saving: boolean;
  onSave: (siteUrl: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const sitesQuery = useQuery(bingSitesOptions(projectId));
  const [choice, setChoice] = useState<string | null>(null);

  if (sitesQuery.isPending) {
    return (
      <div role="status" aria-label="Loading Bing sites" className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (sitesQuery.isError) {
    return (
      <QueryError
        cause={sitesQuery.error}
        fallback={bingErrorMessage(
          sitesQuery.error,
          "Couldn't load your Bing sites.",
        )}
        onRetry={() => void sitesQuery.refetch()}
        isRetrying={sitesQuery.isFetching}
      />
    );
  }
  if (sitesQuery.data.keyInvalid) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Bing no longer accepts your saved API key. Replace it above to list your
        sites.
      </p>
    );
  }

  const sites = sortBy(sitesQuery.data.sites, [
    (site) => site.matchesProjectDomain,
    "desc",
  ]);
  if (sites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Your Bing Webmaster account has no verified sites yet. Add and verify
        this site in Bing Webmaster Tools (importing it from Google Search
        Console is the quickest way), then come back.
      </p>
    );
  }

  const selected =
    choice ??
    sites.find((site) => site.isSelected)?.siteUrl ??
    sites.find((site) => site.matchesProjectDomain)?.siteUrl ??
    null;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Choose the Bing site</p>
      <RadioGroup
        value={selected}
        onValueChange={(value) => {
          if (typeof value === "string") setChoice(value);
        }}
        className="gap-1"
        disabled={saving}
      >
        {sites.map((site, index) => (
          <Field
            key={site.siteUrl}
            orientation="horizontal"
            className="rounded-md px-2 py-2 hover:bg-accent"
          >
            <RadioGroupItem value={site.siteUrl} id={`${id}-${index}`} />
            <FieldLabel
              htmlFor={`${id}-${index}`}
              className="min-w-0 flex-1 font-normal"
            >
              <span className="break-all">{site.siteUrl}</span>
              {site.matchesProjectDomain ? (
                <Badge variant="soft" size="sm">
                  Matches this project
                </Badge>
              ) : null}
              {site.isSelected ? (
                <Badge variant="success" size="sm">
                  Connected
                </Badge>
              ) : null}
            </FieldLabel>
          </Field>
        ))}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          disabled={!selected}
          pending={saving}
          onClick={() => selected && onSave(selected)}
        >
          Connect site
        </Button>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
