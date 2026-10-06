import { createServerFn } from "@tanstack/react-start";
import { CoreWebVitalsService } from "@/server/features/core-web-vitals/CoreWebVitalsService";
import { AppError } from "@/server/lib/errors";
import { GoogleApiError } from "@/server/lib/googleWebVitalsClient";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { dashboardProjectInputSchema } from "@/types/schemas/dashboard";

/** The dashboard's Core Web Vitals card: the project origin's mobile CrUX
 *  field data with its weekly history. Without a Google API key the card
 *  hides itself. */
export const getProjectCoreWebVitals = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    if (!(await CoreWebVitalsService.isConfigured())) {
      return { status: "not_configured" as const };
    }
    const domain = context.project.domain;
    if (!domain) return { status: "no_domain" as const };
    try {
      const result = await CoreWebVitalsService.getFieldData({
        projectDomain: domain,
        formFactor: "PHONE",
        includeHistory: true,
      });
      return result.found
        ? { status: "ok" as const, ...result }
        : { status: "no_data" as const, tried: result.tried };
    } catch (error) {
      if (error instanceof GoogleApiError) {
        console.warn(`CrUX request failed (${error.status}): ${error.message}`);
        throw new AppError(
          error.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE",
          error.message,
        );
      }
      throw error;
    }
  });
