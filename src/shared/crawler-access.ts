/**
 * Crawler access: credentials a site owner gives the audit crawler so it gets
 * through their own protection, replayed as static headers on every request
 * to the one host they were saved for.
 *
 * - Shopify storefronts rate-limit (429) and sometimes block crawlers they
 *   haven't authorized. The merchant mints a domain-scoped signature in
 *   Shopify admin (Online Store -> Preferences -> Crawler access).
 * - Sites behind Cloudflare Access (previews, staging) redirect every
 *   unauthenticated request to a login page. A service token, allowed by a
 *   "Service Auth" policy, lets a non-browser client through.
 *
 * These helpers are pure so both the crawler and the input validation can use
 * them.
 */

export type CrawlerAccessProvider = "shopify" | "cloudflare_access";

/** Constant Shopify expects, quotes included. We supply it; users never see it. */
export const SHOPIFY_SIGNATURE_AGENT = '"https://shopify.com"';

export const SHOPIFY_CRAWLER_ACCESS_DOC_URL =
  "https://help.shopify.com/en/manual/promoting-marketing/seo/crawling-your-store";

export const MAX_SIGNATURE_VALUE_LENGTH = 4096;

/** Every service token Client ID ends in `.access`. */
export const CLOUDFLARE_CLIENT_ID_SUFFIX_MESSAGE =
  "Copy the whole Client ID, including the part ending in .access.";

/**
 * Credential headers bound to the host they were issued for. The binding is
 * the security boundary: these values are access credentials and must
 * never be sent to another site, including across a redirect hop.
 */
export interface CrawlerAccess {
  host: string;
  headers: Record<string, string>;
  /** Checked on every request: a long crawl can outlive the signature. */
  expiresAt: string | null;
}

export function shopifyCrawlerHeaders(
  signatureInput: string,
  signature: string,
): Record<string, string> {
  return {
    "Signature-Input": signatureInput,
    Signature: signature,
    "Signature-Agent": SHOPIFY_SIGNATURE_AGENT,
  };
}

export function cloudflareAccessHeaders(
  clientId: string,
  clientSecret: string,
): Record<string, string> {
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}

/**
 * Normalize user input into a bare lowercase hostname. Accepts a full URL
 * (people paste one) as well as a bare host. Null = not a usable hostname.
 */
export function normalizeCrawlerHost(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  let hostname: string;
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }

  const host = hostname.replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

/**
 * Headers to send with a request to `url`, or `{}` when it isn't the host the
 * credential was saved for, over https, before its expiry. The host match is
 * exact: Shopify scopes a signature to one domain, so `www.store.com` and
 * `store.com` need their own, and an Access token must not leak to a sibling
 * subdomain. A redirect to plain http must not replay the credential in
 * cleartext.
 */
export function crawlerHeadersFor(
  url: string,
  access: CrawlerAccess | null | undefined,
): Record<string, string> {
  if (!access || isCrawlerAccessExpired(access.expiresAt)) return {};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }

  return parsed.protocol === "https:" &&
    parsed.hostname.toLowerCase() === access.host
    ? access.headers
    : {};
}

/**
 * Shopify's `Signature-Input` is an RFC 9421 signature parameter list that may
 * carry `;expires=<unix seconds>`. Nothing beyond that parameter is assumed.
 */
export function parseSignatureExpiry(signatureInput: string): string | null {
  const match = signatureInput.match(/expires=(\d+)/);
  if (!match) return null;

  const expiresAt = new Date(Number(match[1]) * 1000);
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt.toISOString();
}

/** Shopify rejects a signature past its `expires`, so it is never replayed. */
export function isCrawlerAccessExpired(
  expiresAt: string | null,
  now = Date.now(),
): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now;
}
