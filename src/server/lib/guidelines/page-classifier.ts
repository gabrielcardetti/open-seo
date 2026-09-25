/**
 * What a page is, decided from its own content before any rule is asked.
 *
 * The classification picks the rule set: YMYL pages get the stricter YMYL
 * rules, reviews get the review rules. It runs before anything expensive and
 * stays heuristic on purpose; when a judge is available it can do better.
 */
import type { FetchedPage } from "./page-fetch";

export type PageType =
  | "article"
  | "hub"
  | "product"
  | "review"
  | "category"
  | "landing"
  | "ugc"
  | "other";

const YMYL_TOPICS = [
  "health_safety",
  "financial",
  "government_civics_society",
  "other_wellbeing",
] as const;

export type YmylTopic = (typeof YMYL_TOPICS)[number];

export interface PageClassification {
  pageType: PageType;
  ymyl: boolean;
  ymylTopics: YmylTopic[];
  isReview: boolean;
  hasSchema: boolean;
  aiSuspected: boolean;
}

/**
 * Topic markers for the YMYL call, matched against the page's own words.
 *
 * Broad on purpose, but not so broad that every site qualifies. Misclassifying
 * a YMYL page as ordinary drops the strict rules that exist precisely for pages
 * that can hurt someone; misclassifying an ordinary page asks YMYL-02 and
 * YMYL-03, which are critical, of a page they were never written for. So the
 * markers leave out words that sit in every footer and checkout ("Aviso legal",
 * "pago seguro", "Visa", "impuestos incluidos"), and the body has to keep
 * returning to a topic, not mention it once. When a judge is available it
 * decides instead, and this is the floor.
 */
const YMYL_MARKERS: Array<{ topic: YmylTopic; pattern: RegExp }> = [
  {
    topic: "health_safety",
    pattern:
      /\b(s[ií]ntoma|diagn[oó]stic|tratamiento|medicament|dosis|enfermedad|salud|m[eé]dic|terapia|diabet|insulin|oncol[oó]g|tumor|embaraz(?!os)|vacun|f[aá]rmaco|symptom|diagnos|treatment|medication|dosage|disease|health(?!y)|medical|oncolog|pregnan|vaccin|drugs?\b)\w*/gi,
  },
  {
    topic: "financial",
    pattern:
      /\b(inversi[oó]n|invertir|hipotec|pr[eé]stamo|jubilaci[oó]n|p[oó]liza|aseguradora|declaraci[oó]n de la renta|invest(?!ig)|mortgage|loans?\b|retirement|insurance|pension\b)\w*/gi,
  },
  {
    topic: "government_civics_society",
    pattern:
      /\b(oposici[oó]n|oposiciones|convocatoria de (?:plazas|empleo|oposici)|bolet[ií]n oficial|sede electr[oó]nica|multas?\b|sanci[oó]n|abogad|jur[ií]dic|elecciones|votaci[oó]n|inmigraci[oó]n|visado|permiso de residencia|elections?\b|immigration|government|lawyer|attorney)\w*/gi,
  },
];

/** Body mentions of one topic before the page counts as being about it. */
const YMYL_BODY_MENTIONS = 3;

function mentionsTopic(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}

/** Phrasing that suggests a page exists for a search engine rather than a reader. */
const AI_SCALE_MARKERS =
  /\b(en conclusi[oó]n|esperamos que este art[ií]culo|en este art[ií]culo te (mostramos|explicamos)|gu[ií]a definitiva|in conclusion|we hope this article|ultimate guide|in this article we will)\b/i;

/**
 * Classify a page from its own content.
 *
 * Used as the input to rule selection, so it runs before anything expensive.
 * It stays heuristic on purpose: the classification decides which questions get
 * asked, and it is better to ask a few unnecessary questions than to skip the
 * strict ones.
 */
export function classifyPage(page: FetchedPage): PageClassification {
  // "Recipe | Healthy Kitchen": the site name after the separator describes
  // the site, not this page.
  const title = page.title.split(/\s[|–—-]\s/)[0] ?? "";
  const heading = `${title} ${page.h1s.join(" ")}`;
  const body = page.bodyText.slice(0, 6000);
  const haystack = `${heading} ${body}`;

  // A topic in the title or H1 is what the page is about; in the body alone it
  // has to recur, so a footer link or a passing mention does not count.
  const ymylTopics = YMYL_MARKERS.filter(
    ({ pattern }) =>
      mentionsTopic(pattern, heading) > 0 ||
      mentionsTopic(pattern, body) >= YMYL_BODY_MENTIONS,
  ).map(({ topic }) => topic);

  const isReview =
    /\b(review|rese[ñn]a|an[aá]lisis de|comparativa|mejores \d+|best \d+|vs\.?)\b/i.test(
      `${page.title} ${page.h1s.join(" ")}`,
    );

  const path = (() => {
    try {
      return new URL(page.finalUrl).pathname;
    } catch {
      return "/";
    }
  })();

  const pageType: PageType = isReview
    ? "review"
    : path === "/" || path === ""
      ? "landing"
      : /\/(blog|guias|guides|articulo|article|post)\//i.test(path)
        ? "article"
        : page.internalLinks > 30 && page.wordCount < 400
          ? "category"
          : "article";

  return {
    pageType,
    ymyl: ymylTopics.length > 0,
    ymylTopics,
    isReview,
    hasSchema: page.structuredData.length > 0,
    aiSuspected: AI_SCALE_MARKERS.test(haystack),
  };
}
