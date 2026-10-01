import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { cloudflareAccessHeaders } from "@/shared/crawler-access";

/**
 * Checks a Cloudflare Access service token against the host it will be sent
 * to, before it is saved.
 *
 * Access sends a request it doesn't accept to its login page on
 * `<team>.cloudflareaccess.com`. With a service token that happens when the
 * policy action is Allow instead of Service Auth, or when the Client ID was
 * copied without its `.access` suffix or the secret is wrong. Saving such a
 * token would only produce an audit of the login page.
 */

export type CloudflareAccessProblem = { reason: "access_denied"; host: string };

/**
 * Null means Access let the token through, the host isn't behind Access, or
 * the check couldn't run: an unreachable site must not block a save.
 */
export async function checkCloudflareAccessToken(input: {
  host: string;
  clientId: string;
  clientSecret: string;
}): Promise<CloudflareAccessProblem | null> {
  try {
    // Same SSRF validation as an audit's start URL, and no redirect is
    // followed, so the token only ever goes to the host it was saved for.
    const url = await normalizeAndValidateStartUrl(`https://${input.host}/`);
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "User-Agent": "OpenSEO-Audit/1.0",
        ...cloudflareAccessHeaders(input.clientId, input.clientSecret),
      },
      signal: AbortSignal.timeout(5_000),
    });
    const location = response.headers.get("location");
    if (!location) return null;
    return new URL(location, url).hostname.endsWith(".cloudflareaccess.com")
      ? { reason: "access_denied", host: input.host }
      : null;
  } catch (error) {
    console.warn("Skipped the Cloudflare Access token check:", error);
    return null;
  }
}
