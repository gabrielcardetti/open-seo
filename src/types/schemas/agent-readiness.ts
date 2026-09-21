import { z } from "zod";

export const getAgentReadinessSchema = z.object({
  projectId: z.string().min(1),
});

export const runAgentReadinessScanSchema = z.object({
  projectId: z.string().min(1),
});

export const updateAgentReadinessConfigSchema = z.object({
  projectId: z.string().min(1),
  profile: z.enum(["content", "apiApp"]),
  scheduleEnabled: z.boolean(),
});
