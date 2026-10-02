function parseLoose(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
}

/** Hostname without scheme, `www.` or case: "https://www.Example.com/" and
 *  "example.com" are the same site. */
export function siteHost(value: string): string | null {
  return (
    parseLoose(value)
      ?.hostname.toLowerCase()
      .replace(/^www\./, "") ?? null
  );
}

/**
 * A join key for page URLs reported by two engines: host as in siteHost, the
 * path without a trailing slash, and the query string. Bing and Search Console
 * disagree on scheme, `www.` and trailing slashes for the same page.
 */
export function pageJoinKey(value: string): string {
  const url = parseLoose(value);
  if (!url) return value.trim();
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${url.search}`;
}
