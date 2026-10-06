import { createServerFn } from "@tanstack/react-start";
import { assertAiSearchAccess } from "@/server/features/ai-search/services/aiSearchAccess";
import { getBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { explorePrompt as runExplorePrompt } from "@/server/features/ai-search/services/promptExplorer";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  brandLookupInputSchema,
  promptExplorerInputSchema,
} from "@/types/schemas/ai-search";

export const lookupBrand = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(brandLookupInputSchema)
  .handler(async ({ data, context }) => {
    await assertAiSearchAccess(context.organizationId);
    return getBrandLookup({ ...data, projectId: context.projectId }, context);
  });

export const explorePrompt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(promptExplorerInputSchema)
  .handler(async ({ data, context }) => {
    await assertAiSearchAccess(context.organizationId);
    return runExplorePrompt({ ...data, projectId: context.projectId }, context);
  });
