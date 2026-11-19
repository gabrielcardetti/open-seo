#!/usr/bin/env node
// Comprueba un mapa de redirecciones contra el sitio en vivo.
//
//   node verify-redirects.mjs mapa.csv [opciones]
//
// El CSV lleva cabecera `old_url,new_url` (las columnas de más se ignoran).
//
//   --old-origin <url>   pide las URLs viejas a este origen (staging, preview)
//                        en vez del suyo; el destino esperado no cambia
//   --http-hops <n>      saltos admitidos para la variante http:// (por defecto 1;
//                        2 donde el host fuerza HTTPS antes de que corra la app)
//   --skip-http          no probar la variante http://
//   --concurrency <n>    peticiones en paralelo (por defecto 6)
//
// Cada fila pasa cuando la URL vieja responde 301 o 308, su Location es
// exactamente la nueva, y la nueva responde 200 sin otro salto, sin noindex y
// con canonical apuntándose a sí misma. Solo hace GET. Sale con 1 si algo falla.

import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("Uso: node verify-redirects.mjs mapa.csv [--old-origin URL]");
  process.exit(2);
}
const flag = (name) => {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? undefined : (rest[index + 1] ?? "true");
};
const oldOrigin = flag("old-origin");
const httpHops = Number(flag("http-hops") ?? 1);
const skipHttp = rest.includes("--skip-http");
const concurrency = Number(flag("concurrency") ?? 6);
const USER_AGENT = "Mozilla/5.0 (compatible; OpenSEO-RedirectCheck/1.0)";

const rows = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
  .filter(([oldUrl, newUrl]) => oldUrl && newUrl && oldUrl !== "old_url");

const same = (a, b) => {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const path = (url) => url.pathname.replace(/\/+$/, "") || "/";
    return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
  } catch {
    return false;
  }
};

const request = (url) =>
  fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

/** Sigue la cadena a mano y devuelve cada salto. */
async function walk(url, limit = 6) {
  const hops = [];
  let current = url;
  for (let i = 0; i < limit; i++) {
    const response = await request(current);
    const location = response.headers.get("location");
    hops.push({ url: current, status: response.status, location });
    if (response.status < 300 || response.status >= 400 || !location) {
      return { hops, final: response };
    }
    current = new URL(location, current).href;
  }
  return { hops, final: null };
}

const destinations = new Map();
/** La URL nueva: 200, sin noindex y con canonical propia. Una vez por destino. */
function checkDestination(newUrl) {
  if (!destinations.has(newUrl)) {
    destinations.set(
      newUrl,
      (async () => {
        const response = await request(newUrl);
        if (response.status !== 200) return [`destino responde ${response.status}`];
        const problems = [];
        if (/noindex/i.test(response.headers.get("x-robots-tag") ?? ""))
          problems.push("destino con X-Robots-Tag noindex");
        const html = await response.text();
        if (/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html))
          problems.push("destino con meta noindex");
        const canonical = html.match(
          /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
        )?.[1];
        if (!canonical) problems.push("destino sin canonical");
        else if (!same(new URL(canonical, newUrl).href, newUrl))
          problems.push(`canonical del destino apunta a ${canonical}`);
        return problems;
      })().catch((error) => [`destino no se pudo leer: ${error}`]),
    );
  }
  return destinations.get(newUrl);
}

async function checkRow([oldUrl, newUrl]) {
  const problems = [];
  const asked = oldOrigin
    ? new URL(new URL(oldUrl).pathname + new URL(oldUrl).search, oldOrigin).href
    : oldUrl;
  try {
    const { hops } = await walk(asked);
    const [first] = hops;
    const redirects = hops.filter((hop) => hop.location).length;
    if (![301, 308].includes(first.status))
      problems.push(`responde ${first.status}, no 301/308`);
    else if (!same(new URL(first.location, asked).href, newUrl))
      problems.push(`redirige a ${first.location}`);
    if (redirects > 1) problems.push(`${redirects} saltos`);

    if (!skipHttp && !oldOrigin && oldUrl.startsWith("https://")) {
      const plain = await walk(`http://${oldUrl.slice("https://".length)}`);
      const plainHops = plain.hops.filter((hop) => hop.location);
      const landed = plainHops.at(-1)?.location;
      if (plainHops.length > httpHops)
        problems.push(`http:// tarda ${plainHops.length} saltos`);
      if (!landed || !same(new URL(landed, oldUrl).href, newUrl))
        problems.push(`http:// termina en ${landed ?? "ningún lado"}`);
    }
  } catch (error) {
    problems.push(`no se pudo pedir: ${error}`);
  }
  problems.push(...(await checkDestination(newUrl)));
  return { oldUrl, newUrl, problems };
}

const results = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      results.push(await checkRow(row));
    }
  }),
);

const failed = results.filter((result) => result.problems.length > 0);
for (const { oldUrl, newUrl, problems } of failed) {
  console.log(`FALLA ${oldUrl}\n      esperado: ${newUrl}`);
  for (const problem of problems) console.log(`      - ${problem}`);
}
console.log(`${results.length - failed.length} bien, ${failed.length} con fallas`);
process.exit(failed.length > 0 ? 1 : 0);
