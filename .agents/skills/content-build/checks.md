# Chequeos técnicos

Scripts chicos para los problemas que aparecieron en maxagente.com y que ni el crawl ni el juez detectan solos. Corrélos contra el build de producción en local (`<build> && PORT=3099 <start>`) o contra producción.

## Encabezados de una página

Lista los encabezados en orden. Sirve para ver H1 duplicados (por ejemplo, pantallas reales de la app incrustadas como vista previa) y saltos de nivel.

```bash
curl -s "$URL" | python3 -c '
import re,sys
h=sys.stdin.read()
for m in re.finditer(r"<h([1-6])[^>]*>(.*?)</h\1>",h,re.S):
    print(m.group(1), re.sub(r"<[^>]+>","",m.group(2))[:60])'
```

Si una vista previa trae encabezados de la app, no los cambies en la app. Poné un contexto que, dentro de la vista previa, los renderice como texto. En Max es `AppPreviewHeadings` / `AppHeading` en `components/app-heading.tsx`.

## Palabras pegadas en JSX

JSX descarta el salto de línea entre un texto y un elemento en línea. Una palabra al final de una línea seguida de `<Link>` en la línea siguiente sale pegada: "yturnos". En pantalla puede no notarse si el elemento es `display: block`, pero el texto que leen los buscadores y las IAs sí sale pegado.

```bash
python3 - <<'EOF'
import glob,re
files=glob.glob('app/**/*.tsx',recursive=True)
for f in files:
    L=open(f).read().split('\n')
    for i in range(len(L)-1):
        a=L[i].rstrip(); b=L[i+1].lstrip()
        if re.search(r'[A-Za-zÁ-úñ,.;:]$',a) and not a.strip().startswith(('//','*','import','{','}')) and re.match(r'<(Link|a|strong|em|code|span)\b',b):
            print(f"{f}:{i+1}: …{a[-40:]} | {b[:40]}")
        if re.search(r'</(Link|a|strong|em|code|span)>$',a) and re.match(r'[A-Za-zÁ-úñ]',b):
            print(f"{f}:{i+1}: …{a[-40:]} | {b[:40]}")
EOF
```

La solución es `{" "}` al final de la línea. Confirmalo en el HTML servido: `curl -s $URL | grep -o '.{30}palabra.{30}'`.

## Recursos que se filtran a otras páginas

Un `preload()` de React en un componente de servidor viaja en el payload RSC. Cuando Next precarga un link a esa página desde cualquier otra, la indicación se ejecuta igual y el recurso se descarga en todo el sitio. En Max fue un modelo 3D de 3 MB. Movelo al componente cliente que lo usa.

```js
// node check-asset.mjs <base> <patrón> <ruta>...
import { chromium } from "playwright";
const [base, pattern, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
for (const path of paths) {
  const page = await browser.newPage();
  const hits = [];
  page.on("request", (r) => r.url().includes(pattern) && hits.push(r.url()));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(4000);
  console.log(path.padEnd(45), hits.length ? "lo descarga" : "no");
  await page.close();
}
await browser.close();
```

Solo se ve con el build de producción: en desarrollo, Next no precarga.

## Lighthouse en local

La auditoría de OpenSEO corre Lighthouse, pero el MCP no devuelve los puntajes. Con el Chromium de Playwright:

```bash
export CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1)
bunx --bun lighthouse "$URL" --quiet --chrome-flags="--headless=new --no-sandbox" \
  --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=lh.json
python3 -c '
import json;d=json.load(open("lh.json"));a=d["audits"]
print({k:round(v["score"]*100) for k,v in d["categories"].items()}, a["largest-contentful-paint"]["displayValue"], a["total-blocking-time"]["displayValue"], a["total-byte-weight"]["displayValue"])
for i in sorted(a["network-requests"]["details"]["items"],key=lambda i:-i.get("transferSize",0))[:5]: print(round(i.get("transferSize",0)/1024),"KiB",i["url"][-70:])'
```

La simulación de celular exagera en una máquina cargada. Compará siempre las dos versiones con el mismo comando y en la misma máquina.

## Todo el registro responde y nada apunta a páginas eliminadas

```bash
curl -s "$BASE/sitemap.xml" | grep -oE '<loc>[^<]+' | sed 's/<loc>//' | while read u; do
  printf "%s %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"; done
grep -rn "<ruta-eliminada>" app/ | grep -v node_modules   # cada página que se borró
```

## Celular sin scroll horizontal

```js
// dentro de un script de Playwright, con viewport { width: 390, height: 844 }
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 0) console.log(path, "desborda", overflow, "px");
```

## Imágenes sin alt

`alt=""` es lo correcto en imágenes decorativas (avatares y logos dentro de los chats de ejemplo). Solo un `<img>` **sin** atributo `alt` es un problema.

```bash
curl -s "$URL" | python3 -c '
import re,sys
imgs=re.findall(r"<img[^>]*>",sys.stdin.read())
print(len(imgs),"imágenes;",sum(" alt=" not in i for i in imgs),"sin alt")'
```
