/** Which sitemaps a Search Console property accepts, and the reconnect
 *  messages shared by the coverage read and submissions. */

export const RECONNECT_GSC_FOR_WRITE =
  "Search Console is connected with read-only access. Reconnect Search Console to let OpenSEO submit sitemaps.";
export const RECONNECT_GSC =
  "The Search Console connection has expired or was revoked. Reconnect Search Console.";

/** A domain property (`sc-domain:`) accepts sitemaps on the domain and its
 *  subdomains; a URL-prefix property only sitemaps under its prefix. */
export function insideProperty(siteUrl: string, url: string): boolean {
  if (siteUrl.startsWith("sc-domain:")) {
    const domain = siteUrl.slice("sc-domain:".length).toLowerCase();
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }
  return url.startsWith(siteUrl);
}
