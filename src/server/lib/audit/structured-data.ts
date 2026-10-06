/**
 * JSON-LD checks for the site audit: which schema.org types a page declares,
 * which blocks fail to parse, which types are rich results Google retired,
 * and which rich-result types lack the properties Google requires.
 *
 * Only top-level nodes and `@graph` members are checked. Nested entities (an
 * Offer inside a Product, a JobPosting under WebPage.mainEntity) are valid
 * markup that this shallow pass cannot judge, so it stays quiet about them
 * rather than guess.
 */

/** Distinct types kept per page; a page declaring more is pathological. */
const MAX_TYPES = 30;

/**
 * Rich results Google no longer shows. Sources: Google's "Simplifying search
 * results" (2025-06), "HowTo and FAQ changes" (2023-08) and the FAQ rich
 * result removal (2026-05-07). The list follows the deprecated-types table of
 * claude-seo (github.com/AgriciDaniel/claude-seo, MIT).
 */
const RETIRED_TYPES = new Set([
  "FAQPage",
  "HowTo",
  "ClaimReview",
  "EstimatedSalary",
  "OccupationalAggregateRating",
  "SpecialAnnouncement",
  "VehicleListing",
]);

type Node = Record<string, unknown>;

/** A requirement is met when any one of its alternative properties is present. */
type Requirement = string[];

/**
 * Required properties of Google rich-result types, per Google Search Central's
 * structured data documentation. Recommended properties are left out: their
 * absence costs a richer snippet, not eligibility.
 */
const REQUIRED_PROPERTIES: Record<string, Requirement[]> = {
  BreadcrumbList: [["itemListElement"]],
  ItemList: [["itemListElement"]],
  Event: [["name"], ["startDate"], ["location"]],
  LocalBusiness: [["name"], ["address"]],
  Product: [["name"], ["offers", "review", "aggregateRating"]],
  Recipe: [["name"], ["image"]],
  Review: [["author"], ["itemReviewed"], ["reviewRating"]],
  AggregateRating: [
    ["itemReviewed"],
    ["ratingValue"],
    ["ratingCount", "reviewCount"],
  ],
  VideoObject: [["name"], ["thumbnailUrl"], ["uploadDate"]],
  Course: [["name"], ["description"]],
  QAPage: [["mainEntity"]],
  ProfilePage: [["mainEntity"]],
  DiscussionForumPosting: [
    ["author"],
    ["datePosted"],
    ["text", "image", "video"],
  ],
  SoftwareApplication: [
    ["name"],
    ["offers"],
    ["aggregateRating", "review"],
  ],
  JobPosting: [
    ["title"],
    ["description"],
    ["datePosted"],
    ["hiringOrganization"],
  ],
};

export interface StructuredDataSummary {
  /** Distinct schema.org types declared at the top level, sorted. */
  types: string[];
  /** JSON-LD blocks that are not valid JSON. */
  invalidBlocks: number;
  /** Declared types whose rich result Google retired. */
  retiredTypes: string[];
  /** Rich-result types missing properties Google requires. */
  missingProperties: Array<{ type: string; missing: string[] }>;
  /** JobPostings whose validThrough date has passed. */
  expiredJobPostings: Array<{ title: string | null; validThrough: string }>;
}

export const EMPTY_STRUCTURED_DATA: StructuredDataSummary = {
  types: [],
  invalidBlocks: 0,
  retiredTypes: [],
  missingProperties: [],
  expiredJobPostings: [],
};

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function topLevelNodes(parsed: unknown): Node[] {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const nodes: Node[] = [];
  for (const root of roots) {
    if (!isNode(root)) continue;
    nodes.push(root);
    const graph = root["@graph"];
    if (Array.isArray(graph)) nodes.push(...graph.filter(isNode));
  }
  return nodes;
}

/** "https://schema.org/JobPosting" and "schema:JobPosting" are "JobPosting". */
function typesOf(node: Node): string[] {
  const raw = node["@type"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/^(https?:\/\/schema\.org\/|schema:)/, ""))
    .filter(Boolean);
}

function hasValue(node: Node, property: string): boolean {
  const value = node[property];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isRemoteJob(node: Node): boolean {
  const raw = node["jobLocationType"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.some((value) => value === "TELECOMMUTE");
}

function missingFor(node: Node, type: string): string[] {
  const requirements = [...(REQUIRED_PROPERTIES[type] ?? [])];
  if (type === "JobPosting") {
    // A remote job names where applicants may live instead of an office.
    requirements.push(
      isRemoteJob(node) ? ["applicantLocationRequirements"] : ["jobLocation"],
    );
  }
  return requirements
    .filter((options) => !options.some((option) => hasValue(node, option)))
    .map((options) => options.join(" or "));
}

/** Summarize a page's JSON-LD blocks (raw script text) as of `now`. */
export function summarizeStructuredData(
  blocks: readonly string[],
  now: Date,
): StructuredDataSummary {
  const types = new Set<string>();
  const missingProperties: StructuredDataSummary["missingProperties"] = [];
  const expiredJobPostings: StructuredDataSummary["expiredJobPostings"] = [];
  let invalidBlocks = 0;

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      invalidBlocks += 1;
      continue;
    }
    for (const node of topLevelNodes(parsed)) {
      for (const type of typesOf(node)) {
        if (types.size < MAX_TYPES) types.add(type);
        const missing = missingFor(node, type);
        if (missing.length > 0) missingProperties.push({ type, missing });
        if (type !== "JobPosting") continue;
        const validThrough = node["validThrough"];
        if (typeof validThrough !== "string") continue;
        const expiresAt = Date.parse(validThrough);
        if (!Number.isNaN(expiresAt) && expiresAt < now.getTime()) {
          const title = node["title"];
          expiredJobPostings.push({
            title: typeof title === "string" ? title : null,
            validThrough,
          });
        }
      }
    }
  }

  const sortedTypes = Array.from(types).sort();
  return {
    types: sortedTypes,
    invalidBlocks,
    retiredTypes: sortedTypes.filter((type) => RETIRED_TYPES.has(type)),
    missingProperties,
    expiredJobPostings,
  };
}
