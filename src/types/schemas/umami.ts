import { z } from "zod";

const projectScoped = { projectId: z.string().min(1) };

export const umamiProjectSchema = z.object(projectScoped);

export const saveUmamiConnectionSchema = z.discriminatedUnion("mode", [
  z.object({
    ...projectScoped,
    mode: z.literal("cloud"),
    apiKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    ...projectScoped,
    mode: z.literal("self_hosted"),
    baseUrl: z.string().trim().min(1).max(2048),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
  }),
]);

export const selectUmamiWebsiteSchema = z.object({
  ...projectScoped,
  websiteId: z.string().min(1).max(100),
});
