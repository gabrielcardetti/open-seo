import {
  BingConnectionRepository,
  type BingConnection,
} from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingApiKeyRepository } from "@/server/features/bing/repositories/BingApiKeyRepository";
import {
  createBingClient,
  type BingClient,
} from "@/server/lib/bing/bingClient";
import { BingNotConnectedError } from "@/server/lib/bing/bingErrors";
import { openSecret } from "@/server/lib/secretBox";

export const BING_KEY_PURPOSE = "Bing Webmaster API keys";

/**
 * The project's Bing connection and a client authenticated with the key of
 * the member who connected it. Throws BingNotConnectedError when the project
 * has no connection, or the connector's key is gone or unreadable (deleted,
 * or BETTER_AUTH_SECRET rotated) — either way the fix is to reconnect.
 */
export async function openBingClientForProject(
  projectId: string,
): Promise<{ connection: BingConnection; client: BingClient }> {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) throw new BingNotConnectedError(projectId);
  const key = await BingApiKeyRepository.getByUserId(
    connection.connectedByUserId,
  );
  if (!key) throw new BingNotConnectedError(projectId);
  let apiKey: string;
  try {
    apiKey = await openSecret(key.apiKeyEncrypted, BING_KEY_PURPOSE);
  } catch {
    throw new BingNotConnectedError(projectId);
  }
  return { connection, client: createBingClient(apiKey) };
}
