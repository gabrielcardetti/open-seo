/**
 * The site's trust pages, user-content surfaces and spam tripwires, read from
 * crawled URLs and titles (plus the homepage's links) with multilingual
 * patterns. Tripwires are leads for a reviewer, never a verdict on their own.
 */
import { sort } from "remeda";
import { canonicalUrlKey, detectUrlTemplate } from "../audit/url-utils";
import type { SiteExample, SiteTripwire, TrustPages } from "./site-facts";
import { normalizeText } from "./site-skeleton";

const MAX_TRIPWIRES_PER_RULE = 5;

/** A URL seen on the site: a crawled page, or a homepage link. */
export interface SiteLink {
  url: string;
  path: string;
  search: string;
  title: string | null;
}

export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function hostKey(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/** `/es/`, `/pt-br/`, `/zh_CN/`: a language prefix, not a section. */
const LOCALE_SEGMENT = /^[a-z]{2}([-_][a-z]{2,4})?$/i;

const CJK_LOCALES = new Set([
  "ja",
  "jp",
  "zh",
  "zh-cn",
  "zh-tw",
  "zh-hans",
  "zh-hant",
  "cn",
  "tw",
  "ko",
  "kr",
]);

/**
 * How each trust page is recognized, on accent-free lowercased labels with
 * `-_.+` read as spaces. `label` matches the last path segment (at most two
 * deep) or the start of the title. `ownPath` matches only a path that is one
 * segment besides a language prefix: `/equipo` and `/aviso-legal` are trust
 * pages, `/producto/camiseta-equipo` and `/servicios/asesoria-legal` are not,
 * and neither is a product titled "Camiseta Equipo".
 */
const TRUST_PATTERNS: Record<
  Exclude<keyof TrustPages, "authorTemplate">,
  { label?: RegExp; ownPath?: RegExp }
> = {
  about: {
    label:
      /\b(about|quienes somos|sobre nosotros|nosotros|acerca|who we are|a propos|chi siamo|sobre nos|ueber uns|uber uns)\b/,
    ownPath:
      /^((nuestro|nuestra|el|la|our|the|meet the) )?(team|equipo|empresa)$/,
  },
  contact: {
    label:
      /\b(contact|contacto|contacta\w*|contactar|contato|kontakt|contactez( nous)?|contatti|fale conosco)\b/,
  },
  privacy: { label: /\b(privacy|privacidad|cookies)\b/ },
  terms: {
    ownPath:
      /^(aviso legal|legal( notice)?|nota legal|mentions legales|impressum|(terms|terminos|condiciones)( .*)?)$/,
  },
};

const AUTHOR_SEGMENTS = new Set([
  "author",
  "authors",
  "autor",
  "autores",
  "autora",
  "autoras",
]);

/** The path's segments without a leading language prefix. */
function pageSegments(path: string): string[] {
  const segments = segmentsOf(path);
  return segments.length > 1 && LOCALE_SEGMENT.test(segments[0])
    ? segments.slice(1)
    : segments;
}

/**
 * Long labels are content ("how to contact your lawyer"), not the contact
 * page, so they never match.
 */
function shortLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed && trimmed.split(/\s+/).length <= 4 ? trimmed : null;
}

/**
 * Labels for a link: its last path segment (at most two deep) and the first
 * part of its title; `ownPath` when the path is a single segment.
 */
function trustLabels(link: SiteLink): {
  labels: string[];
  ownPath: string | null;
} {
  const segments = pageSegments(link.path);
  const last =
    segments.length >= 1 && segments.length <= 2
      ? shortLabel(
          normalizeText(safeDecode(segments[segments.length - 1]))
            .replace(/\.(html?|php|aspx?)$/, "")
            .replace(/[-_.+]/g, " "),
        )
      : null;
  const title = link.title
    ? shortLabel(normalizeText(link.title.split(/[|–—·:]|\s-\s/)[0]))
    : null;
  return {
    labels: [last, title].filter((label) => label !== null),
    ownPath: segments.length === 1 ? last : null,
  };
}

function findAuthorTemplate(
  links: readonly SiteLink[],
): TrustPages["authorTemplate"] {
  const pagesByTemplate = new Map<string, Set<string>>();
  for (const link of links) {
    const segments = segmentsOf(link.path.toLowerCase());
    if (segments.length < 2 || !AUTHOR_SEGMENTS.has(segments.at(-2) ?? "")) {
      continue;
    }
    const template = `/${segments.slice(0, -1).join("/")}/:slug`;
    const pages = pagesByTemplate.get(template) ?? new Set<string>();
    pages.add(canonicalUrlKey(link.url));
    pagesByTemplate.set(template, pages);
  }
  const [best] = sort(
    Array.from(pagesByTemplate, ([template, pages]) => ({
      template,
      count: pages.size,
    })),
    (a, b) => b.count - a.count || a.template.localeCompare(b.template),
  );
  return best ?? null;
}

export function findTrust(links: readonly SiteLink[]): TrustPages {
  const labelled = links.map((link) => ({ link, ...trustLabels(link) }));
  const find = ({
    label,
    ownPath,
  }: (typeof TRUST_PATTERNS)[keyof typeof TRUST_PATTERNS]): string | null =>
    labelled.find(
      (entry) =>
        (label && entry.labels.some((text) => label.test(text))) ||
        (ownPath && entry.ownPath !== null && ownPath.test(entry.ownPath)),
    )?.link.url ?? null;
  return {
    about: find(TRUST_PATTERNS.about),
    contact: find(TRUST_PATTERNS.contact),
    privacy: find(TRUST_PATTERNS.privacy),
    terms: find(TRUST_PATTERNS.terms),
    authorTemplate: findAuthorTemplate(links),
  };
}

const UGC_SEGMENT =
  /^(forums?|foros?|foren|community|comunidad|comments?|comentarios|discussions?)$/;
/** Only with something after it: `/user/ana`, not a `/members` sales page. */
const PROFILE_SEGMENT =
  /^(users?|usuarios?|profiles?|perfil|members?|miembros)$/;

export function findUgcSurfaces(links: readonly SiteLink[]): string[] {
  const surfaces = new Set<string>();
  for (const link of links) {
    if (/[?&]replytocom=/.test(link.search)) {
      surfaces.add(`${detectUrlTemplate(link.path)}?replytocom`);
    }
    const segments = segmentsOf(link.path.toLowerCase());
    const at = segments.findIndex(
      (segment, i) =>
        UGC_SEGMENT.test(segment) ||
        (PROFILE_SEGMENT.test(segment) && i < segments.length - 1),
    );
    if (at >= 0) surfaces.add(`/${segments.slice(0, at + 1).join("/")}/`);
  }
  return sort(Array.from(surfaces), (a, b) => a.localeCompare(b)).slice(0, 10);
}

interface Vertical {
  name: string;
  /** Matched against accent-free, lowercased titles and URL words. */
  pattern: RegExp;
  /** A business overview matching this is in the vertical on purpose. */
  overview: RegExp;
}

/** Words injected by the usual site hacks (SPAM-04). */
const HACK_LEXICON: Vertical[] = [
  {
    name: "pharma",
    pattern:
      /\b(viagra|cialis|levitra|kamagra|tramadol|xanax|phentermine|online pharmacy)\b/,
    overview: /pharma|farmac|drug|medic/,
  },
  {
    name: "gambling",
    pattern: /\b(casino|slot gacor|slot online|togel|judi online|sbobet)\b/,
    overview: /casino|gambl|apuesta|betting|juego/,
  },
  {
    name: "replica",
    pattern:
      /\breplica (watch|watches|rolex|handbags?|bags?|bolsos?|relojes?)\b/,
    overview: /replica/,
  },
  {
    name: "payday loan",
    pattern: /\bpayday loans?\b/,
    overview: /loan|prestamo|lend|financ/,
  },
  {
    name: "essay writing",
    pattern: /\b(essay writing|write my essay|buy essays?|essay service)\b/,
    overview: /essay|writing|redaccion|academic/,
  },
  {
    name: "adult",
    pattern: /\b(porn|xxx|sex cams?|escorts?|hentai)\b/,
    overview: /adult|sex|escort/,
  },
];

/** Verticals rented out as a section of an unrelated site (SPAM-12). */
const PARASITE_VERTICALS: Vertical[] = [
  {
    name: "coupons",
    pattern:
      /\b(coupons?|cupon(es)?|codigos? (de )?descuento|promo codes?|discount codes?|vouchers?|gutscheine?)\b/,
    overview: /coupon|cupon|descuento|discount|voucher|promo/,
  },
  {
    name: "gambling",
    pattern: /\b(casinos?|apuestas|betting|sportsbooks?|bookmakers?)\b/,
    overview: /casino|apuesta|betting|gambl|juego/,
  },
  {
    name: "loans",
    pattern: /\b(prestamos?|loans?|creditos? rapidos?|microcreditos?)\b/,
    overview: /prestamo|loan|credito|financ|lend|bank|banc/,
  },
  {
    name: "CBD",
    pattern: /\b(cbd|cannabis|delta 8)\b/,
    overview: /cbd|cannabis|hemp|canamo/,
  },
  {
    name: "affiliate roundups",
    pattern:
      /^(the )?(best|top \d+|\d+ best|mejores|los mejores|las mejores|\d+ mejores)\b/,
    overview: /review|resena|comparativ|afiliad|affiliate|best|mejores/,
  },
];

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

export function hackedTripwires(
  ok: readonly SiteLink[],
  homepage: SiteExample | null,
  overview: string,
): SiteTripwire[] {
  const lexicon = HACK_LEXICON.filter(
    (entry) => !entry.overview.test(overview),
  );
  // Judged by the homepage when there is one: a hacked site can carry more
  // injected Japanese pages than real ones.
  const titled = ok.filter((link) => link.title);
  const cjkSite = homepage?.title
    ? CJK.test(homepage.title)
    : titled.filter((link) => CJK.test(link.title ?? "")).length * 2 >=
      titled.length;

  const tripwires: SiteTripwire[] = [];
  for (const link of ok) {
    const title = link.title ?? "";
    const text = `${normalizeText(title)} ${normalizeText(safeDecode(link.path)).replace(/[/\-_.]/g, " ")}`;
    const term = lexicon
      .map((entry) => ({ entry, match: entry.pattern.exec(text) }))
      .find(({ match }) => match !== null);
    let why: string | null = null;
    if (term?.match) {
      why = `${term.entry.name} spam term "${term.match[0]}" in the title or URL`;
    } else if (
      !cjkSite &&
      CJK.test(title) &&
      // A `/ja/` or `/zh-cn/` section is a translation, not an injection.
      !CJK_LOCALES.has(
        (segmentsOf(link.path)[0] ?? "").toLowerCase().replace("_", "-"),
      )
    ) {
      why =
        "CJK-script title on a site that is not in a CJK language (Japanese keyword hack pattern)";
    }
    if (why)
      tripwires.push({
        ruleId: "SPAM-04",
        url: link.url,
        title: link.title,
        why,
      });
  }
  return tripwires.slice(0, MAX_TRIPWIRES_PER_RULE);
}

/**
 * A first-level section (at least three pages) whose name or most of whose
 * titles belong to a classic parasite vertical the business does not claim.
 */
export function parasiteTripwires(
  live: readonly SiteLink[],
  overview: string,
): SiteTripwire[] {
  const verticals = PARASITE_VERTICALS.filter(
    (vertical) => !vertical.overview.test(overview),
  );
  const nested = live.filter((link) => segmentsOf(link.path).length >= 2);
  const tripwires: SiteTripwire[] = [];
  const sections = new Map<string, SiteLink[]>();
  for (const link of nested) {
    const section = segmentsOf(link.path)[0].toLowerCase();
    sections.set(section, [...(sections.get(section) ?? []), link]);
  }
  for (const [section, members] of sections) {
    if (members.length < 3) continue;
    const label = normalizeText(safeDecode(section)).replace(/[-_]/g, " ");
    const titles = members.map((link) => normalizeText(link.title ?? ""));
    const vertical = verticals.find(
      ({ pattern }) =>
        pattern.test(label) ||
        titles.filter((title) => pattern.test(title)).length * 2 >=
          members.length,
    );
    if (!vertical) continue;
    tripwires.push({
      ruleId: "SPAM-12",
      url: members[0].url,
      title: members[0].title,
      why: `/${section}/ (${members.length} pages) reads as a ${vertical.name} section, which the business overview does not mention`,
    });
  }
  return tripwires.slice(0, MAX_TRIPWIRES_PER_RULE);
}

export function sameSiteLinks(
  outlinks: readonly string[],
  startUrl: string,
): SiteLink[] {
  const host = hostKey(new URL(startUrl));
  const links: SiteLink[] = [];
  for (const href of outlinks) {
    let parsed: URL;
    try {
      parsed = new URL(href, startUrl);
    } catch {
      continue;
    }
    if (hostKey(parsed) !== host) continue;
    links.push({
      url: parsed.toString(),
      path: parsed.pathname,
      search: parsed.search,
      title: null,
    });
  }
  return links;
}

/** Shortest path first: `/contacto` is the contact page, not `/blog/contacto-x`. */
export function byPathLength(links: readonly SiteLink[]): SiteLink[] {
  return sort(
    links,
    (a, b) => a.path.length - b.path.length || a.url.localeCompare(b.url),
  );
}
