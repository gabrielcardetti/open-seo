import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

/**
 * Encryption at rest for secrets users hand us (crawler access credentials,
 * Bing Webmaster API keys). Same key as the stored Google OAuth tokens, so
 * self-hosters have one secret to set and hosted mode always has it.
 *
 * `purpose` only shapes the error a self-hoster sees when the key is missing.
 */
async function getEncryptionKey(purpose: string): Promise<string> {
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  if (!secret || secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `Set BETTER_AUTH_SECRET to at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters to store ${purpose}. It encrypts them.`,
    );
  }
  return secret;
}

export async function sealSecret(
  data: string,
  purpose: string,
): Promise<string> {
  const key = await getEncryptionKey(purpose);
  return symmetricEncrypt({ key, data });
}

/** Throws when the ciphertext can't be read (e.g. a rotated secret). */
export async function openSecret(
  ciphertext: string,
  purpose: string,
): Promise<string> {
  const key = await getEncryptionKey(purpose);
  return symmetricDecrypt({ key, data: ciphertext });
}
