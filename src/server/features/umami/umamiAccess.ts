import { z } from "zod";
import {
  UmamiConnectionRepository,
  type UmamiConnection,
} from "@/server/features/umami/repositories/UmamiConnectionRepository";
import {
  createUmamiClient,
  type UmamiClient,
  type UmamiCredentials,
} from "@/server/lib/umami/umamiClient";
import {
  UmamiApiError,
  UmamiNotConnectedError,
} from "@/server/lib/umami/umamiErrors";
import { openSecret, sealSecret } from "@/server/lib/secretBox";

const CREDENTIAL_PURPOSE = "Umami credentials";

const storedCredentialSchema = z.union([
  z.object({ apiKey: z.string().min(1) }),
  z.object({ username: z.string().min(1), password: z.string() }),
]);

export function sealUmamiCredentials(
  credentials: UmamiCredentials,
): Promise<string> {
  const payload =
    credentials.mode === "cloud"
      ? { apiKey: credentials.apiKey }
      : { username: credentials.username, password: credentials.password };
  return sealSecret(JSON.stringify(payload), CREDENTIAL_PURPOSE);
}

/** A client for the connection's saved credential, or null when it can't be
 *  read any more (a rotated BETTER_AUTH_SECRET) or doesn't fit its mode. */
export async function openUmamiClient(
  connection: UmamiConnection,
): Promise<UmamiClient | null> {
  let stored: z.infer<typeof storedCredentialSchema>;
  try {
    stored = storedCredentialSchema.parse(
      JSON.parse(
        await openSecret(connection.credentialEncrypted, CREDENTIAL_PURPOSE),
      ),
    );
  } catch {
    return null;
  }
  if (connection.mode === "cloud" && "apiKey" in stored) {
    return createUmamiClient({
      baseUrl: connection.baseUrl,
      credentials: { mode: "cloud", apiKey: stored.apiKey },
    });
  }
  if (connection.mode === "self_hosted" && "username" in stored) {
    return createUmamiClient({
      baseUrl: connection.baseUrl,
      credentials: { mode: "self_hosted", ...stored },
    });
  }
  return null;
}

export type ConnectedUmami = {
  connection: UmamiConnection & { websiteId: string };
  client: UmamiClient;
};

/**
 * The project's Umami website and a client for it. Throws
 * UmamiNotConnectedError when there is no connection, no website was chosen,
 * or the credential is unreadable — either way the fix is to connect again.
 */
export async function openUmamiForProject(
  projectId: string,
): Promise<ConnectedUmami> {
  const connection = await UmamiConnectionRepository.getByProjectId(projectId);
  const websiteId = connection?.websiteId;
  if (!connection || !websiteId) throw new UmamiNotConnectedError(projectId);
  const client = await openUmamiClient(connection);
  if (!client) throw new UmamiNotConnectedError(projectId);
  return { connection: { ...connection, websiteId }, client };
}

/** Remember why Umami refused a read, so the integration card can say so.
 *  Only failures the user must fix are kept; outages pass. */
export async function recordUmamiFailure(
  projectId: string,
  error: unknown,
): Promise<void> {
  if (
    error instanceof UmamiApiError &&
    (error.kind === "auth" || error.kind === "not_found")
  ) {
    await UmamiConnectionRepository.setLastError(projectId, error.message);
  }
}
