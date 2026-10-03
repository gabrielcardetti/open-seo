import type { Tool, ToolSet } from "ai";
import type { ZodRawShape } from "zod";
import type { McpToolDefinition } from "@/server/features/sam/samMcpToolDefinition";
import {
  getUmamiAttributionTool,
  getUmamiEventPropertiesTool,
  getUmamiFunnelTool,
  getUmamiWebVitalsTool,
} from "@/server/mcp/tools/umami-conversion-tools";
import {
  getUmamiAiReferralsTool,
  getUmamiCampaignsTool,
  getUmamiOrganicBySearchEngineTool,
} from "@/server/mcp/tools/umami-source-tools";
import {
  getUmamiAudienceBreakdownTool,
  getUmamiEventsTool,
  getUmamiOrganicLandingPagesTool,
  getUmamiOverviewTool,
  getUmamiPagePerformanceTool,
  getUmamiRealtimeTool,
  getUmamiTrafficAcquisitionTool,
} from "@/server/mcp/tools/umami-tools";

/** SAM's Umami tools, adapted with the caller's project-bound adapter. */
export function umamiChatTools(
  adaptTool: <Shape extends ZodRawShape>(
    definition: McpToolDefinition<Shape>,
  ) => Tool,
): ToolSet {
  return {
    get_umami_overview: adaptTool(getUmamiOverviewTool),
    get_umami_organic_landing_pages: adaptTool(getUmamiOrganicLandingPagesTool),
    get_umami_page_performance: adaptTool(getUmamiPagePerformanceTool),
    get_umami_traffic_acquisition: adaptTool(getUmamiTrafficAcquisitionTool),
    get_umami_events: adaptTool(getUmamiEventsTool),
    get_umami_audience_breakdown: adaptTool(getUmamiAudienceBreakdownTool),
    get_umami_realtime: adaptTool(getUmamiRealtimeTool),
    get_umami_organic_by_search_engine: adaptTool(
      getUmamiOrganicBySearchEngineTool,
    ),
    get_umami_ai_referrals: adaptTool(getUmamiAiReferralsTool),
    get_umami_campaigns: adaptTool(getUmamiCampaignsTool),
    get_umami_event_properties: adaptTool(getUmamiEventPropertiesTool),
    get_umami_funnel: adaptTool(getUmamiFunnelTool),
    get_umami_attribution: adaptTool(getUmamiAttributionTool),
    get_umami_web_vitals: adaptTool(getUmamiWebVitalsTool),
  };
}
