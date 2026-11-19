#!/usr/bin/env node
// Grafo de enlaces internos de un sitio, leído del HTML que sirve (sin JS).
//
//   node link-graph.mjs --site https://ejemplo.com [opciones] > grafo.json
//
//   --sitemap <url>      sitemap a leer (por defecto <site>/sitemap.xml; sigue índices)
//   --include <regex>    solo URLs cuyo path coincide
//   --exclude <regex>    deja fuera URLs cuyo path coincide
//   --targets <regex>    paths de las páginas que importan (las que convierten)
//   --max <n>            tope de páginas a pedir (por defecto 600)
//   --concurrency <n>    peticiones en paralelo (por defecto 4)
//
// Un enlace cuenta como "de cuerpo" cuando está dentro de <main> (o de <body>
// si no hay <main>) y fuera de <nav>, <header>, <footer> y <aside>. Los del
// menú y el pie se cuentan aparte: son un solo enlace de plantilla repetido.
// Solo hace GET, a la velocidad de --concurrency.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((pair) => {
      const [key, ...rest] = pair.trim().split(/\s+/);
      return [key, rest.join(" ") || "true"];
    }),
);

if (!args.site) {
  console.error("Falta --site https://dominio");
  process.exit(2);
}

const site = new URL(args.site);
const bareHost = (host) => host.replace(/^www\./, "");
const include = args.include ? new RegExp(args.include) : null;
const exclude = args.exclude ? new RegExp(args.exclude) : null;
const targets = args.targets ? new RegExp(args.targets) : null;
const maxPages = Number(args.max ?? 600);
const concurrency = Number(args.concurrency ?? 4);
const USER_AGENT = "Mozilla/5.0 (compatible; OpenSEO-LinkGraph/1.0)";

/** Path sin barra final, sin query ni fragmento; null si es de otro sitio. */
function pathOf(href, base) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (bareHost(url.hostname) !== bareHost(site.hostname)) return null;
  if (/\.(png|jpe?g|webp|gif|svg|pdf|zip|xml|json|ico|css|js)$/i.test(url.pathname))
    return null;
  return url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
}

async function get(url) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  return { response, text: await response.text() };
}

async function readSitemap(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const { response, text } = await get(url);
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    m[1].replaceAll("&amp;", "&"),
  );
  if (!/<sitemapindex/i.test(text)) return locs;
  const nested = [];
  for (const loc of locs) nested.push(...(await readSitemap(loc, seen)));
  return nested;
}

const strip = (html, tags) =>
  html.replace(
    new RegExp(`<(${tags})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"),
    (block) => " ".repeat(block.length), // conserva las posiciones
  );

const ENTITIES = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ntilde: "ñ",
  Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü",
  iquest: "¿", iexcl: "¡", mdash: "—", ndash: "–", rarr: "→", middot: "·",
};
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, code) =>
      String.fromCodePoint(parseInt(code, hex ? 16 : 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();

function linksIn(html, base) {
  const links = [];
  for (const match of html.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
  )) {
    const path = pathOf(match[1], base);
    if (!path) continue;
    const label = match[0].match(/\baria-label\s*=\s*["']([^"']+)["']/i)?.[1];
    links.push({
      path,
      anchor: textOf(match[2]) || label || "(sin texto)",
      nofollow: /\brel\s*=\s*["'][^"']*nofollow/i.test(match[0]),
      at: match.index,
    });
  }
  return links;
}

function readPage(html, base) {
  const clean = strip(html, "script|style|noscript|template|svg").replace(
    /<!--[\s\S]*?-->/g,
    (block) => " ".repeat(block.length),
  );
  const main = clean.match(/<main\b[\s\S]*<\/main\s*>/i);
  const scope = main ? main[0] : (clean.match(/<body\b[\s\S]*/i)?.[0] ?? clean);
  const body = strip(scope, "nav|header|footer|aside");
  const bodyLinks = linksIn(body, base);
  const bodyPaths = new Set(bodyLinks.map((link) => link.path));
  const chromeLinks = linksIn(clean, base).filter(
    (link) => !bodyPaths.has(link.path),
  );
  return {
    words: textOf(body).split(" ").filter(Boolean).length,
    hasMain: Boolean(main),
    bodyLinks: bodyLinks.map((link) => ({
      ...link,
      // Dónde cae el enlace dentro del cuerpo, 0 arriba y 100 al final.
      position: Math.round((link.at / Math.max(body.length, 1)) * 100),
    })),
    chromePaths: [...new Set(chromeLinks.map((link) => link.path))],
    canonical: clean.match(
      /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
    )?.[1],
    noindex: /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(
      clean,
    ),
  };
}

const sitemapUrl = args.sitemap ?? new URL("/sitemap.xml", site).href;
const fromSitemap = [...new Set(await readSitemap(sitemapUrl))]
  .map((url) => ({ url, path: pathOf(url, site) }))
  .filter(({ path }) => path !== null);
const sitemapPaths = new Set(fromSitemap.map(({ path }) => path));
const inScope = fromSitemap.filter(
  ({ path }) =>
    (!include || include.test(path)) && !(exclude && exclude.test(path)),
);
const queue = inScope.slice(0, maxPages);

const pages = new Map();
const errors = [];
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const { url, path } = queue[cursor++];
    try {
      const { response, text } = await get(url);
      const landed = pathOf(response.url, site);
      if (!response.ok || landed !== path) {
        errors.push({ path, status: response.status, landed });
        continue;
      }
      pages.set(path, readPage(text, response.url));
    } catch (error) {
      errors.push({ path, error: String(error) });
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

// Inbound de cuerpo: una fuente cuenta una vez por destino.
const inbound = new Map();
const chromeInbound = new Map();
for (const [source, page] of pages) {
  const first = new Map();
  for (const link of page.bodyLinks) {
    if (link.path === source || link.nofollow) continue;
    if (!first.has(link.path)) first.set(link.path, link);
  }
  for (const [target, link] of first) {
    if (!inbound.has(target)) inbound.set(target, []);
    inbound
      .get(target)
      .push({ from: source, anchor: link.anchor, position: link.position });
  }
  for (const target of page.chromePaths) {
    chromeInbound.set(target, (chromeInbound.get(target) ?? 0) + 1);
  }
}

const TEMPLATE_ANCHOR_REPEATS = 5;
const rows = [...pages].map(([path, page]) => {
  const links = inbound.get(path) ?? [];
  const anchors = new Map();
  for (const link of links)
    anchors.set(link.anchor, (anchors.get(link.anchor) ?? 0) + 1);
  return {
    path,
    target: targets ? targets.test(path) : false,
    words: page.words,
    bodyInbound: links.length,
    // Enlaces cuyo texto no se repite en serie: un mismo texto desde muchas
    // páginas es un bloque de plantilla, aunque esté dentro del cuerpo.
    editorialInbound: links.filter(
      (link) => anchors.get(link.anchor) <= TEMPLATE_ANCHOR_REPEATS,
    ).length,
    // En el menú o el pie de más de la mitad de las páginas leídas.
    sitewide: (chromeInbound.get(path) ?? 0) > pages.size / 2,
    chromeInbound: chromeInbound.get(path) ?? 0,
    bodyOutbound: new Set(
      page.bodyLinks.map((link) => link.path).filter((p) => p !== path),
    ).size,
    anchors: [...anchors]
      .sort((a, b) => b[1] - a[1])
      .map(([anchor, count]) => ({ anchor, count })),
    linkedFrom: links.sort((a, b) => a.position - b.position),
    noindex: page.noindex || undefined,
    hasMain: page.hasMain ? undefined : false,
  };
});
rows.sort(
  (a, b) =>
    a.editorialInbound - b.editorialInbound || a.path.localeCompare(b.path),
);

const known = new Set(pages.keys());
const linkedButNotInSitemap = [...inbound.keys()]
  .filter((path) => !known.has(path) && !sitemapPaths.has(path))
  .sort();

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      site: site.origin,
      sitemap: sitemapUrl,
      inSitemap: fromSitemap.length,
      inScope: inScope.length,
      pagesRead: pages.size,
      truncated: inScope.length > queue.length,
      errors,
      // Destinos que importan con menos de 3 enlaces editoriales.
      underlinkedTargets: rows
        .filter((row) => row.target && row.editorialInbound < 3)
        .map((row) => ({
          path: row.path,
          editorialInbound: row.editorialInbound,
          bodyInbound: row.bodyInbound,
        })),
      // Páginas a las que no llega ningún enlace de cuerpo.
      noBodyInbound: rows
        .filter((row) => row.bodyInbound === 0)
        .map((row) => row.path),
      linkedButNotInSitemap,
      pages: rows,
    },
    null,
    2,
  ),
);
