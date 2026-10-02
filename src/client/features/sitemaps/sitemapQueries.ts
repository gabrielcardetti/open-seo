import { queryOptions } from "@tanstack/react-query";
import { getSitemaps } from "@/serverFunctions/sitemaps";

export type SitemapsData = Awaited<ReturnType<typeof getSitemaps>>;

export const sitemapsKey = (projectId: string) => ["sitemaps", projectId];

/** The registry with live Google coverage: Search Console is read on each
 *  fetch, so it isn't refetched on window focus. */
export const sitemapsOptions = (projectId: string) =>
  queryOptions({
    queryKey: sitemapsKey(projectId),
    queryFn: () => getSitemaps({ data: { projectId } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
