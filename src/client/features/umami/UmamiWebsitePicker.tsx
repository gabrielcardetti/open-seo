import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { groupBy, sortBy } from "remeda";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Field, FieldLabel } from "@/client/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  umamiErrorMessage,
  umamiWebsitesOptions,
} from "@/client/features/umami/umamiQueries";

const PERSONAL = "Personal";

/**
 * The websites the saved credentials can read, grouped by owner: the user's
 * own ("Personal") and each team's. The one whose domain matches the
 * project's is preselected and its group comes first.
 */
export function UmamiWebsitePicker({
  projectId,
  saving,
  onSave,
  onCancel,
}: {
  projectId: string;
  saving: boolean;
  onSave: (websiteId: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const websitesQuery = useQuery(umamiWebsitesOptions(projectId));
  const [choice, setChoice] = useState<string | null>(null);

  if (websitesQuery.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading Umami websites"
        className="space-y-2"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (websitesQuery.isError) {
    return (
      <QueryError
        cause={websitesQuery.error}
        fallback={umamiErrorMessage(
          websitesQuery.error,
          "Couldn't load your Umami websites.",
        )}
        onRetry={() => void websitesQuery.refetch()}
        isRetrying={websitesQuery.isFetching}
      />
    );
  }
  if (websitesQuery.data.credentialsInvalid) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Umami no longer accepts the saved credentials. Save them again to list
        your websites.
      </p>
    );
  }

  const websites = websitesQuery.data.websites;
  if (websites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        These credentials can&rsquo;t read any website yet. Add this site in
        Umami, or share it with this user or one of their teams, then come back.
      </p>
    );
  }

  const groups = sortBy(
    Object.entries(
      groupBy(websites, (website) => website.teamName ?? PERSONAL),
    ),
    [
      ([, members]) => members.some((website) => website.matchesProjectDomain),
      "desc",
    ],
    [([owner]) => owner === PERSONAL, "desc"],
    ([owner]) => owner,
  );
  const selected =
    choice ??
    websites.find((website) => website.isSelected)?.id ??
    websites.find((website) => website.matchesProjectDomain)?.id ??
    null;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Choose the Umami website</p>
      <RadioGroup
        value={selected}
        onValueChange={(value) => {
          if (typeof value === "string") setChoice(value);
        }}
        className="gap-3"
        disabled={saving}
      >
        {groups.map(([owner, members]) => (
          <div key={owner} className="space-y-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              {owner}
            </p>
            {sortBy(members, [
              (website) => website.matchesProjectDomain,
              "desc",
            ]).map((website) => (
              <Field
                key={website.id}
                orientation="horizontal"
                className="rounded-md px-2 py-2 hover:bg-accent"
              >
                <RadioGroupItem value={website.id} id={`${id}-${website.id}`} />
                <FieldLabel
                  htmlFor={`${id}-${website.id}`}
                  className="min-w-0 flex-1 font-normal"
                >
                  <span className="break-all">
                    {website.name || website.domain || website.id}
                    {website.domain && website.name ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {website.domain}
                      </span>
                    ) : null}
                  </span>
                  {website.matchesProjectDomain ? (
                    <Badge variant="soft" size="sm">
                      Matches this project
                    </Badge>
                  ) : null}
                  {website.isSelected ? (
                    <Badge variant="success" size="sm">
                      Connected
                    </Badge>
                  ) : null}
                </FieldLabel>
              </Field>
            ))}
          </div>
        ))}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          disabled={!selected}
          pending={saving}
          onClick={() => selected && onSave(selected)}
        >
          Use this website
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
