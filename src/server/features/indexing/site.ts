/**
 * Which URLs belong to a project's site. The project domain is free text
 * ("example.com", "https://www.example.com/blog"), so it is reduced to a
 * hostname; www and the apex count as one site, since one usually redirects
 * to the other.
 */

/** The project's hostname as entered (www kept), or null without a domain. */
export function projectHost(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

export function isSameSite(host: string, siteHost: string): boolean {
  return bareHost(host) === bareHost(siteHost);
}
