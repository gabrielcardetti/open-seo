import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

/**
 * Encryption at rest for secrets users hand us (crawler access credentials,
 * Bing Webmaster API keys). By default the same key as the stored Google OAuth
 * tokens, so self-hosters have one secret to set and hosted mode always has
 * it. Crawler access uses CRAWLER_ACCESS_SECRET instead: the audit worker that
 * replays it crawls untrusted sites, so it must not hold BETTER_AUTH_SECRET.
 *
 * `purpose` only shapes the error a self-hoster sees when the key is missing.
 */
type SecretKeyName = "BETTER_AUTH_SECRET" | "CRAWLER_ACCESS_SECRET";

async function getEncryptionKey(
  purpose: string,
  keyName: SecretKeyName,
): Promise<string> {
  const secret = (await getOptionalEnvValue(keyName))?.trim();
  if (!secret || secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `Set ${keyName} to at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters to store ${purpose}. It encrypts them.`,
    );
  }
  return secret;
}

export async function sealSecret(
  data: string,
  purpose: string,
  keyName: SecretKeyName = "BETTER_AUTH_SECRET",
): Promise<string> {
  const key = await getEncryptionKey(purpose, keyName);
  return symmetricEncrypt({ key, data });
}

/**
 * Throws AUTH_CONFIG_MISSING when the key isn't set, and another error when
 * the ciphertext can't be read (e.g. a rotated secret).
 */
export async function openSecret(
  ciphertext: string,
  purpose: string,
  keyName: SecretKeyName = "BETTER_AUTH_SECRET",
): Promise<string> {
  const key = await getEncryptionKey(purpose, keyName);
  return symmetricDecrypt({ key, data: ciphertext });
}
