/**
 * `POST /api/indexing/hook/:projectId`, called from a site's deploy pipeline.
 *
 * Auth is the project's deploy hook secret as a bearer token. An unknown
 * project and a wrong secret get the same 401, so the endpoint can't be used
 * to learn which project ids exist. With `urls` the listed URLs are
 * submitted; without, the sitemaps are checked and new and changed URLs are
 * submitted. The dedupe window makes a repeated deploy a no-op.
 */
import { z } from "zod";
import { IndexingService } from "./IndexingService";
import { SitemapWatchService } from "./SitemapWatchService";
import { UrlSubmissionService } from "./UrlSubmissionService";

const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  urls: z.array(z.string().max(2048)).max(2000).optional(),
});

const errorResponse = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status });

/** The body as text, or null when it is larger than `maxBytes`. */
async function readBounded(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function handleDeployHookRequest(
  request: Request,
  projectId: string,
): Promise<Response> {
  const secret = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (
    !secret ||
    !(await IndexingService.authorizeDeployHook(projectId, secret))
  ) {
    return errorResponse(401, "unauthorized");
  }

  const text = await readBounded(request, MAX_BODY_BYTES);
  if (text === null) return errorResponse(413, "Body larger than 64 KB.");
  let json: unknown = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return errorResponse(400, "Body must be JSON.");
    }
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return errorResponse(
      400,
      "Expected { urls?: string[] } with at most 2000 URLs.",
    );
  }

  if (body.data.urls?.length) {
    const result = await UrlSubmissionService.submitUrls(
      projectId,
      body.data.urls,
      "deploy_hook",
    );
    return Response.json({
      ok: result.problem === null,
      mode: "urls",
      problem: result.problem,
      batchId: result.batchId,
      channel: result.channel,
      counts: result.counts,
      dropped: result.dropped.length,
    });
  }

  const outcome = await SitemapWatchService.runSitemapCheck(
    projectId,
    "deploy_hook",
  );
  if (!outcome.ok) {
    return Response.json({
      ok: false,
      mode: "sitemap",
      problem: outcome.problem,
    });
  }
  const { diff, submission } = outcome;
  return Response.json({
    ok: submission?.problem == null,
    mode: "sitemap",
    baseline: diff.baseline,
    problem: submission?.problem ?? null,
    warning: outcome.warning,
    sitemapUrls: diff.totalUrls,
    newUrls: diff.newUrls.length,
    changedUrls: diff.changedUrls.length,
    removedUrls: diff.removedUrls.length,
    batchId: submission?.batchId ?? null,
    channel: submission?.channel ?? null,
    counts: submission?.counts ?? {},
  });
}
