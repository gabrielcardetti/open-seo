---
name: internal-linking
description: Enlazado interno de un sitio — arma el grafo de enlaces desde el HTML en vivo, separa los enlaces de cuerpo de los de menú y pie, encuentra las páginas que importan y casi nadie enlaza, y lleva enlaces hacia ellas desde las páginas que ya reciben tráfico, con tabla de antes y después. Usar cuando se pide "enlazado interno", "enlaces internos", "páginas huérfanas", "por qué no rankea esta página si el blog sí", repartir autoridad hacia las páginas que convierten, o como módulo de `seo-review-cycle`.
metadata:
  internal: true
---

# Enlazado interno

Las páginas informativas (guías, artículos, fichas) suelen llevarse casi todo el tráfico y los enlaces externos. Las que convierten (cursos, precios, demo, la landing de un servicio) quedan a tres clics, con un enlace en el pie. Google reparte señal por los enlaces internos y la gente sigue los que aparecen mientras lee: si el cuerpo de las páginas con tráfico nunca enlaza a las que importan, esas no reciben ni la señal ni las visitas. Arreglarlo no pide contenido nuevo ni enlaces externos.

El resultado es código editado en el repo del sitio y una tabla de antes y después. Una lista de "enlaces sugeridos" sin editar nada no es el trabajo, salvo en un sitio de terceros donde no hay repo (ver **Sin repo**).

Lo propio de cada sitio (qué páginas convierten, qué no tocar) va en el contexto del proyecto de OpenSEO y, si el sitio está en `seo-ops/sitios/`, en su `SITIO.md`. Leé las dos cosas antes de empezar: puede haber experimentos abiertos con páginas congeladas.

## 1. Destinos y fuentes

- **Destinos**: las páginas que tienen que rankear o convertir. Salen de `key_pages` del contexto del proyecto y de lo que diga el dueño; si no están escritas, proponelas y confirmalas antes de seguir. Son pocas: de 5 a 20.
- **Fuentes**: las páginas que ya reciben visitas de búsqueda. `get_search_console_performance` por página, 90 días, ordenado por clics; sumá `get_bing_search_performance` y `get_umami_organic_landing_pages` si están conectados. Sin datos (sitio de un prospecto), usá las páginas con más enlaces de cuerpo entrantes del grafo.

## 2. Grafo

```bash
node .agents/skills/internal-linking/scripts/link-graph.mjs \
  --site https://dominio.com \
  --targets '^/(cursos|precios|demo)' \
  --exclude '^/archivo' \
  > <carpeta-de-trabajo>/enlaces-antes.json
```

Lee el sitemap, pide cada página (solo GET, cuatro a la vez) y cuenta los enlaces del HTML que sirve el servidor, que es lo que ven los buscadores antes de renderizar y los bots de IA. Por cada página deja:

- `bodyInbound`: páginas que la enlazan desde el cuerpo (dentro de `<main>`, fuera de `<nav>`, `<header>`, `<footer>` y `<aside>`).
- `editorialInbound`: de esos, los que no son un bloque repetido. Un mismo texto de enlace desde más de cinco páginas es plantilla (una firma, un "ver todos", un listado), aunque esté en el cuerpo.
- `sitewide`: está en el menú o el pie de más de la mitad del sitio.
- `anchors` y `linkedFrom`, con la posición de cada enlace dentro del cuerpo (0 arriba, 100 al final).
- `underlinkedTargets`: destinos con menos de tres enlaces editoriales. Es la lista de trabajo.

Qué mirar antes de fiarse:

- `pagesRead` contra `inScope`, y `errors`. Si `truncated` es `true`, subí `--max`.
- Una página con `hasMain: false` no tiene `<main>`: ahí todo el `<body>` menos menú y pie cuenta como cuerpo, y el número es menos fiable.
- Si las páginas traen muy pocas palabras (`words`), el contenido se pinta con JavaScript y este grafo no lo ve. Corré `run_site_audit` con `renderJavaScript: true` y trabajá con `get_audit_pages`; decilo en el informe, porque es un hallazgo en sí mismo.
- `linkedButNotInSitemap`: páginas enlazadas que el sitemap no declara. Puede ser intencional (un archivo excluido) o un sitemap incompleto.
- `editorialInbound` es una heurística. Abrí dos o tres `linkedFrom` de un destino antes de afirmar que está mal enlazado.

Guardá el JSON de antes; el de después lo va a pisar si usás el mismo nombre.

## 3. Elegir qué enlazar

Para cada fuente, de uno a tres destinos **de los que la página ya habla**. Una guía sobre la bolsa de un servicio de salud enlaza al curso de esa oposición, no a uno de otra comunidad. Si no hay destino que encaje, esa fuente no se toca.

Reglas:

1. **Al menos un enlace nuevo en el primer 40 % del cuerpo.** La gente abandona a medida que baja y un bloque de "relacionados" al final casi no recibe clics. `position` del grafo lo mide.
2. **De dos a cuatro enlaces nuevos por página, uno por destino.** Un segundo enlace al mismo destino desde la misma página no suma.
3. **Texto de tres a siete palabras que diga qué hay del otro lado**: "curso de auxiliar administrativo del SAS", no "clic aquí" ni "más información".
4. **Variar el texto.** Cada destino recibe al menos cinco textos distintos entre todas sus fuentes, y ninguno exacto se repite más de tres veces en el sitio. Mirá `anchors` del destino antes de escribir uno nuevo.
5. **Sin `nofollow`** en enlaces internos.
6. **Editar lo mínimo.** Envolver una frase que ya existe; si ninguna sirve, agregar una oración que sea útil por sí sola. No reescribir el párrafo.
7. **No inventar datos para justificar el enlace.** Precios, plazas y fechas salen del sitio o de su fuente oficial.

Además del enlace en el texto, cada fuente puede llevar **un bloque de llamada** (dos si pasa de 2.500 palabras) justo después de la sección que explica el problema y antes de los pasos: es donde el lector quiere el atajo. Usá el componente que el sitio ya tenga; tiene que renderizar un `<a href>` real en el HTML del servidor, no una navegación por `onClick`.

## 4. Hubs y profundidad

- Cada destino a tres clics o menos de la portada. `get_audit_pages` da la profundidad (`depth`).
- Cada página enlaza a su índice de sección y a una o dos hermanas del mismo tema.
- Una sección con dos o más páginas y sin índice necesita uno. Con una sola, no: sería una página pobre.
- Migas de pan visibles y `BreadcrumbList` que coincidan con la URL.

## 5. Ejecutar

Con repo (sitios propios): seguí las reglas de PR del sitio. Para los de `seo-ops/sitios/` están en su `SITIO.md` (worktree propio, rama, checks, quién despliega). Los enlaces viven a veces en contenido y a veces en datos o componentes: buscá cómo arma el sitio cada página antes de editar. Corré los checks del repo y mirá las páginas cambiadas en local.

Como módulo de `seo-review-cycle`, esto es **una** de las acciones de la corrida y pasa por su validación: si hay un experimento abierto midiendo una página, no se le agregan enlaces hasta la lectura.

### Sin repo

En un sitio de terceros (un prospecto, un cliente que edita en su CMS) se entrega la lista lista para aplicar: página fuente, frase exacta donde va, texto del enlace, destino. Sin eso es otro informe que nadie ejecuta.

## 6. Verificar y dejar registro

1. Tras el deploy, corré el script de nuevo a `enlaces-despues.json`. Terminó cuando `underlinkedTargets` está vacío o cada destino que queda tiene su razón escrita (por ejemplo, "ninguna página con tráfico habla de esto: hace falta una").
2. Tabla en el PR y en el log de la corrida:

   ```markdown
   | Destino | Editoriales antes | Después | Textos distintos | Fuentes |
   | --- | --- | --- | --- | --- |
   | /cursos/sas-auxiliar | 1 | 6 | 6 | bolsa-sas, temario-sas, … |
   ```

3. `submit_urls_for_indexing` con las páginas editadas, para que Bing las vuelva a leer.
4. Qué medir y cuándo, anotado donde el sitio lleva sus experimentos: clics y posición de los destinos a 28 días (`get_search_console_performance`), y visitas que llegan a ellos desde las fuentes si hay Umami.

## No hacer

- Contar el menú o el pie como enlaces de cuerpo.
- Resolverlo con un bloque de "relacionados" al final como único cambio.
- Enlazar a un destino del que la página no habla.
- Repetir el mismo texto de enlace en serie.
- Tocar páginas congeladas por un experimento abierto.
