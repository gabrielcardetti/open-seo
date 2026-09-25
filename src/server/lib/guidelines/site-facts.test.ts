import { describe, expect, it } from "vitest";
import { reverse } from "remeda";
import {
  MAX_MEMBER_URLS,
  buildSiteFacts,
  clusterMembership,
  type SiteInventoryPage,
} from "./site-facts";

const START = "https://firma.es/";

function page(
  path: string,
  overrides: Partial<SiteInventoryPage> = {},
): SiteInventoryPage {
  return {
    id: path,
    url: `https://firma.es${path}`,
    statusCode: 200,
    isIndexable: true,
    title: null,
    wordCount: 500,
    contentHash: null,
    crawlDepth: 1,
    ...overrides,
  };
}

function facts(
  pages: SiteInventoryPage[],
  extra: Partial<Parameters<typeof buildSiteFacts>[0]> = {},
) {
  return buildSiteFacts({
    pages,
    startUrl: START,
    crawlCompleted: true,
    ...extra,
  });
}

const CITIES = [
  "Madrid",
  "Sevilla",
  "Valencia",
  "Bilbao",
  "Málaga",
  "Zaragoza",
  "Murcia",
  "Granada",
  "San Sebastián",
];

const slugify = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

// The city pages share `/:slug` with ordinary posts, so the pattern has to be
// found among unrelated siblings, not in a section of its own.
const doorways = CITIES.map((city, i) =>
  page(`/abogados-en-${slugify(city)}`, {
    title: `Abogados en ${city} | Firma`,
    wordCount: 420 + i,
  }),
);
const blogPosts = [
  "Cómo reclamar una deuda",
  "Qué hacer tras un despido",
  "Guía de herencias sin testamento",
].map((title) => page(`/${slugify(title)}`, { title, wordCount: 1500 }));

const fanOut = [
  "dentistas",
  "abogados",
  "gimnasios",
  "inmobiliarias",
  "clinicas-veterinarias",
  "autoescuelas",
  "restaurantes",
  "peluquerias",
].map((niche) => page(`/mejor-crm-para-${niche}`));

describe("buildSiteFacts clusters", () => {
  it.each([
    {
      name: "city-swap doorway titles",
      pages: [...doorways, ...blogPosts],
      kind: "title_skeleton",
      key: "Abogados en {*} | Firma",
      size: CITIES.length,
    },
    {
      name: "query fan-out slugs",
      pages: fanOut,
      kind: "slug_skeleton",
      key: "/mejor-crm-para-{*}",
      size: fanOut.length,
    },
  ])("finds $name", ({ pages, kind, key, size }) => {
    const cluster = facts(pages).clusters.find((c) => c.kind === kind);
    expect(cluster).toMatchObject({ key, size, template: "/:slug" });
    expect(cluster?.wordCv).toBeLessThan(0.15);
    expect(clusterMembership(facts(pages), pages[0].url)).toContain(
      cluster?.id,
    );
  });

  // A catalog is templated by design; varied names and lengths under a
  // shared brand suffix are not a skeleton.
  it("finds no title or slug pattern in a genuine product catalog", () => {
    const products = [
      "Nordic Oak Dining Table",
      "Linen Sofa Cover, Grey",
      "Cast Iron Skillet 26cm",
      "Wool Throw Blanket",
      "Ceramic Pour-Over Coffee Set",
      "Walnut Bookshelf with Five Shelves",
      "Bamboo Bath Mat",
      "Copper Pendant Lamp",
      "Kids Bunk Bed in Pine",
      "Velvet Accent Chair",
    ].map((name, i) =>
      page(`/producto/${slugify(name.replace(/,/g, ""))}`, {
        title: `${name} – Acme`,
        wordCount: 150 + i * 90,
      }),
    );
    expect(facts(products).clusters).toEqual([]);
  });

  it("groups exact duplicate bodies", () => {
    const tags = "abcdefgh"
      .split("")
      .map((letter) =>
        page(`/tag/${letter}`, { title: `Tag ${letter}`, contentHash: "h1" }),
      );
    expect(facts(tags).clusters).toMatchObject([
      { kind: "exact_body", key: "h1", size: 8, template: "/tag/:*" },
    ]);
  });

  it("does not depend on the order the rows arrive in", () => {
    const pages = [...doorways, ...blogPosts, ...fanOut];
    expect(facts(reverse(pages))).toEqual(facts(pages));
  });

  // Small clusters keep every member; the big ones split what is left.
  it("shares the member URL cap fairly across clusters", () => {
    const pages = [2500, 1500, 200].flatMap((size, hash) =>
      Array.from({ length: size }, (_, i) =>
        page(`/s${hash}/${i}`, { contentHash: `h${hash}` }),
      ),
    );
    const { clusters } = facts(pages);
    expect(MAX_MEMBER_URLS).toBe(3000);
    expect(
      clusters.map((c) => [c.memberUrls.length, c.membersTruncated]),
    ).toEqual([
      [1400, true],
      [1400, true],
      [200, false],
    ]);
  });

  // The filtered members, plus the first two of each cluster so a flagged
  // cluster's pages can join the sample.
  it("keeps the filtered member URLs and two per cluster, uncapped", () => {
    const pages = [...doorways, ...blogPosts];
    const [madrid, bilbao] = [doorways[0].url, doorways[3].url];
    const filter = new Set([madrid, bilbao, blogPosts[0].url]);
    const result = facts(pages, { memberUrlFilter: filter });
    // The title and the slug skeleton each find the doorways.
    expect(result.clusters).toHaveLength(2);
    for (const cluster of result.clusters) {
      expect(cluster).toMatchObject({
        size: doorways.length,
        membersTruncated: false,
      });
      expect(cluster.memberUrls).toEqual(
        expect.arrayContaining([bilbao, madrid]),
      );
      expect(
        cluster.memberUrls.filter((url) => !filter.has(url)).length,
      ).toBeLessThanOrEqual(2);
    }
    expect(clusterMembership(result, madrid)).toEqual(["C1", "C2"]);
  });

  // The facts are a workflow step's output, which has a size limit.
  it("stays bounded on a big crawl with long URLs and titles", () => {
    const long = "x".repeat(400);
    const pages = Array.from({ length: 10_000 }, (_, i) =>
      page(`/abogados-en-ciudad-${i}-${long}`, {
        title: `Abogados en Ciudad ${i} | ${long}`,
        contentHash: `h${i % 3}`,
      }),
    );
    const result = facts(pages);
    expect(JSON.stringify(result).length).toBeLessThan(1_000_000);
    expect(result.clusters[0].memberUrls[0]).toHaveLength(200);
    expect(clusterMembership(result, pages[0].url)).not.toEqual([]);
  });
});

describe("buildSiteFacts trust pages", () => {
  it("recognizes Spanish trust pages and author archives", () => {
    const { trust } = facts([
      page("/", { title: "Firma | Abogados", crawlDepth: 0 }),
      page("/blog/como-contactar-con-tu-abogado-laboralista"),
      page("/quienes-somos"),
      page("/contacto"),
      page("/aviso-legal"),
      page("/politica-de-privacidad", { isIndexable: false }),
      page("/autor/ana"),
      page("/autor/luis"),
    ]);
    expect(trust).toEqual({
      about: "https://firma.es/quienes-somos",
      contact: "https://firma.es/contacto",
      privacy: "https://firma.es/politica-de-privacidad",
      terms: "https://firma.es/aviso-legal",
      authorTemplate: { template: "/autor/:slug", count: 2 },
    });
  });

  it.each([
    { path: "/empresa", found: "about" },
    { path: "/nuestro-equipo", found: "about" },
    { path: "/team", found: "about" },
    { path: "/fr/a-propos", found: "about" },
    { path: "/chi-siamo", found: "about" },
    { path: "/ueber-uns", found: "about" },
    { path: "/sobre-nos", found: "about" },
    { path: "/contacta", found: "contact" },
    { path: "/contactar", found: "contact" },
    { path: "/contactez-nous", found: "contact" },
    { path: "/contatti", found: "contact" },
    { path: "/fale-conosco", found: "contact" },
    { path: "/legal", found: "terms" },
    { path: "/es/aviso-legal", found: "terms" },
    { path: "/terminos-y-condiciones", found: "terms" },
    { path: "/blog/team-building-ideas", found: null },
    { path: "/producto/camiseta-equipo", found: null },
    { path: "/servicios/asesoria-legal", found: null },
    { path: "/asesoria-legal", found: null },
    { path: "/legal-services", found: null },
  ])("$path -> $found", ({ path, found }) => {
    // The title is what a product page would carry; it must not count either.
    const { trust } = facts([page(path, { title: "Camiseta Equipo Legal" })]);
    const hits = Object.entries(trust).flatMap(([kind, url]) =>
      url && kind !== "authorTemplate" ? [kind] : [],
    );
    expect(hits).toEqual(found ? [found] : []);
  });

  // A truncated crawl can stop before the footer pages; the homepage's own
  // links still show they exist.
  it("finds a contact page linked from the homepage but never crawled", () => {
    const result = facts([page("/", { crawlDepth: 0 })], {
      crawlCompleted: false,
      homepageOutlinks: ["/contacto", "https://other.example/contact"],
    });
    expect(result.crawlCompleted).toBe(false);
    expect(result.trust.contact).toBe("https://firma.es/contacto");
  });
});

describe("buildSiteFacts tripwires", () => {
  it.each([
    {
      name: "pharma titles injected into a law firm",
      pages: [
        page("/", { title: "Firma | Abogados" }),
        page("/cheap-viagra-online", { title: "Buy Viagra Online Cheap" }),
      ],
      rules: ["SPAM-04"],
    },
    {
      name: "a coupon section on a law firm",
      pages: [1, 2, 3].map((i) =>
        page(`/cupones/tienda-${i}`, { title: `Código descuento tienda ${i}` }),
      ),
      rules: ["SPAM-12"],
    },
    {
      name: "a Japanese title outside a language section",
      pages: [
        page("/", { title: "Firma | Abogados" }),
        page("/p/1", { title: "激安ブランド通販" }),
      ],
      rules: ["SPAM-04"],
    },
    {
      name: "a Japanese translation",
      pages: [
        page("/", { title: "Firma | Abogados" }),
        page("/ja/about", { title: "私たちについて" }),
        page("/zh-CN/about", { title: "关于我们" }),
      ],
      rules: [],
    },
    {
      name: "an ordinary legal blog",
      pages: [page("/", { title: "Firma | Abogados" }), ...blogPosts],
      rules: [],
    },
  ])("$name -> $rules", ({ pages, rules }) => {
    const { tripwires } = facts(pages, {
      businessOverview: "Despacho de abogados laboralistas en Madrid.",
    });
    expect(tripwires.map((t) => t.ruleId)).toEqual(rules);
  });
});
