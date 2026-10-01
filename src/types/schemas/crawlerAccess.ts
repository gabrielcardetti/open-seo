import { z } from "zod";
import {
  CLOUDFLARE_CLIENT_ID_SUFFIX_MESSAGE,
  MAX_SIGNATURE_VALUE_LENGTH,
  isCrawlerAccessExpired,
  normalizeCrawlerHost,
  parseSignatureExpiry,
} from "@/shared/crawler-access";

const hostSchema = z.string().transform((value, ctx) => {
  const host = normalizeCrawlerHost(value);
  if (!host) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a domain like store.example.com",
    });
    return z.NEVER;
  }
  return host;
});

// These values are replayed verbatim as HTTP headers. Anything outside
// printable ASCII (a smart quote from a rich-text paste, a CR/LF) would either
// inject a header or make every crawler fetch throw, silently emptying the
// audit — so reject it here where the user can fix it.
function headerValueSchema(emptyMessage: string) {
  return z
    .string()
    .trim()
    .min(1, emptyMessage)
    .max(MAX_SIGNATURE_VALUE_LENGTH)
    .refine(
      (value) => /^[\x20-\x7e]+$/.test(value),
      "This value contains characters that can't go in an HTTP header",
    );
}

const shopifyValue = headerValueSchema("Paste the value from Shopify admin");
const cloudflareValue = headerValueSchema(
  "Paste the value from Cloudflare Zero Trust",
);

export const saveCrawlerCredentialSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("shopify"),
    projectId: z.string().min(1),
    host: hostSchema,
    signatureInput: shopifyValue.refine(
      (value) => !isCrawlerAccessExpired(parseSignatureExpiry(value)),
      "This signature has already expired. Create a new one in Shopify admin.",
    ),
    signature: shopifyValue,
  }),
  z.object({
    provider: z.literal("cloudflare_access"),
    projectId: z.string().min(1),
    host: hostSchema,
    // Double-clicking the ID in the dashboard selects it without its suffix.
    clientId: cloudflareValue.refine(
      (value) => value.endsWith(".access"),
      CLOUDFLARE_CLIENT_ID_SUFFIX_MESSAGE,
    ),
    clientSecret: cloudflareValue,
  }),
]);

export const deleteCrawlerCredentialSchema = z.object({
  id: z.string().min(1),
});
