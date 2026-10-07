import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleIndexingService } from "./GoogleIndexingService";
import { resetTestDatabase } from "./indexing-test-db";

const EMAIL = "indexer@acme-jobs.iam.gserviceaccount.com";
const mocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("./indexing-test-db")).testDb,
}));
vi.mock("@/server/lib/secretBox", () => ({
  sealSecret: async (value: string) => value,
  openSecret: async (value: string) => value,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));

let serviceAccountJson = "";

// A real RSA key, so the JWT is actually signed.
beforeAll(async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", privateKey),
  );
  serviceAccountJson = JSON.stringify({
    type: "service_account",
    project_id: "acme-jobs",
    client_email: EMAIL,
    private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`,
  });
});

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status });
const token = () => json(200, { access_token: "ya29.token" });

describe("GoogleIndexingService.save", () => {
  beforeEach(() => {
    resetTestDatabase();
    mocks.getProjectById.mockResolvedValue({
      id: "project-1",
      domain: "jobs.example.com",
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it.each([
    {
      name: "metadata 404 (nothing sent yet) as ok",
      replies: () => [
        token(),
        json(404, { error: { message: "Requested entity was not found." } }),
      ],
      status: "ok",
      shows: "the key works",
    },
    {
      name: "the ownership 403 as not_owner",
      replies: () => [
        token(),
        json(403, {
          error: {
            message: "Permission denied. Failed to verify the URL ownership.",
            status: "PERMISSION_DENIED",
          },
        }),
      ],
      status: "not_owner",
      shows: `enter ${EMAIL} and choose the Owner permission`,
    },
    {
      name: "the SERVICE_DISABLED 403 as api_disabled",
      replies: () => [
        token(),
        json(403, {
          error: {
            message:
              "Web Search Indexing API has not been used in project 123 before or it is disabled.",
            details: [{ reason: "SERVICE_DISABLED" }],
          },
        }),
      ],
      status: "api_disabled",
      shows:
        "https://console.cloud.google.com/apis/library/indexing.googleapis.com?project=acme-jobs",
    },
    {
      name: "a refused token as invalid_key",
      replies: () => [
        json(400, {
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        }),
      ],
      status: "invalid_key",
      shows: "invalid_grant: Invalid JWT Signature.",
    },
  ])("classifies $name", async ({ replies, status, shows }) => {
    for (const reply of replies()) {
      vi.mocked(fetch).mockResolvedValueOnce(reply);
    }

    const result = await GoogleIndexingService.save("project-1", {
      serviceAccountJson,
    });

    expect(result).toMatchObject({
      ok: true,
      googleIndexing: { status, clientEmail: EMAIL },
    });
    expect(JSON.stringify(result)).toContain(shows);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });
});
