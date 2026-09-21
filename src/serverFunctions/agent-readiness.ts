import { createServerFn } from "@tanstack/react-start";
import { AgentReadinessService } from "@/server/features/agent-readiness/AgentReadinessService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  getAgentReadinessSchema,
  runAgentReadinessScanSchema,
  updateAgentReadinessConfigSchema,
} from "@/types/schemas/agent-readiness";

export const getAgentReadiness = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAgentReadinessSchema)
  .handler(async ({ context }) => {
    const overview = await AgentReadinessService.getOverview(context.projectId);
    return { ...overview, domain: context.project.domain };
  });

export const runAgentReadinessScan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runAgentReadinessScanSchema)
  .handler(async ({ context }) => {
    const scanId = await AgentReadinessService.runScan({
      projectId: context.projectId,
      domain: context.project.domain,
      trigger: "manual",
    });
    return { scanId };
  });

export const updateAgentReadinessConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateAgentReadinessConfigSchema)
  .handler(async ({ data, context }) => {
    await AgentReadinessService.updateConfig({
      projectId: context.projectId,
      profile: data.profile,
      scheduleEnabled: data.scheduleEnabled,
    });
    return { ok: true };
  });
