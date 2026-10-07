/**
 * Google's Indexing API, authenticated as a Google Cloud service account
 * through the JWT bearer flow (RFC 7523) with WebCrypto RS256, so it runs on
 * Workers without a Google SDK. Only the token endpoint and the Indexing API
 * are ever called: the key file's own token_uri is ignored.
 */
import { z } from "zod";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const METADATA_URL =
  "https://indexing.googleapis.com/v3/urlNotifications/metadata";
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_LIFETIME_S = 3600;

export const serviceAccountSchema = z.object({
  type: z.literal("service_account", {
    error:
      'This is not a service account key: "type" must be "service_account".',
  }),
  client_email: z.email({ error: "The key has no valid client_email." }),
  private_key: z
    .string({ error: "The key has no private_key." })
    .includes("PRIVATE KEY", {
      error: "The key's private_key is not a PEM key.",
    }),
  project_id: z.string().optional(),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

/** A Google response reduced to what the check needs. */
export type GoogleReply = { status: number; message: string; body: string };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const encodeJson = (value: object) =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** The PKCS#8 key from the PEM block; throws when it isn't one. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Google's error text: `error.message`, or OAuth's error + description. */
function googleMessage(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const result = z
      .object({
        error: z.union([
          z.string(),
          z.object({ message: z.string().optional() }),
        ]),
        error_description: z.string().optional(),
      })
      .safeParse(parsed);
    if (result.success) {
      const { error, error_description } = result.data;
      if (typeof error === "string") {
        return error_description ? `${error}: ${error_description}` : error;
      }
      if (error.message) return error.message;
    }
  } catch {
    // not JSON; fall through
  }
  return body.trim().slice(0, 300) || `HTTP ${status}`;
}

async function send(url: string, init: RequestInit): Promise<GoogleReply> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    return {
      status: response.status,
      // Only errors carry a message; a success body may hold the token.
      message: response.ok ? "" : googleMessage(body, response.status),
      body,
    };
  } catch (error) {
    return {
      status: 0,
      message: `Could not reach Google: ${error instanceof Error ? error.message : String(error)}`,
      body: "",
    };
  }
}

/**
 * Exchange a signed JWT for an access token. `token` is set on success;
 * otherwise `reply` is the token endpoint's answer (status 0 when it could
 * not be reached, or -1 when the private key could not be read).
 */
export async function mintAccessToken(
  account: ServiceAccount,
): Promise<{ token: string } | { reply: GoogleReply }> {
  let key: CryptoKey;
  try {
    key = await importPrivateKey(account.private_key);
  } catch {
    return {
      reply: {
        status: -1,
        message: "The private_key in the JSON could not be read as an RSA key.",
        body: "",
      },
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
    iss: account.client_email,
    scope: INDEXING_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + TOKEN_LIFETIME_S,
  })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const reply = await send(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  if (reply.status === 200) {
    try {
      const parsed = z
        .object({ access_token: z.string().min(1) })
        .safeParse(JSON.parse(reply.body));
      if (parsed.success) return { token: parsed.data.access_token };
    } catch {
      // handled below
    }
    return {
      reply: { ...reply, status: 502, message: "No access token in reply." },
    };
  }
  return { reply };
}

/** GET urlNotifications/metadata for one URL. Read-only: sends nothing. */
export function getUrlMetadata(
  token: string,
  url: string,
): Promise<GoogleReply> {
  return send(`${METADATA_URL}?url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}
