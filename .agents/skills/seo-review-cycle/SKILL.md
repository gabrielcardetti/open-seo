---
name: seo-review-cycle
description: Revisión SEO periódica de todos los sitios que sigue este OpenSEO (cada pocos días) — junta métricas de Search Console, Bing, Umami, rank tracker, indexación y auditorías, compara con la corrida anterior, propone un plan solo si hay evidencia, lo pasa por una validación que puede decir "no tocar nada", abre como mucho una PR por repo y deja el log de la corrida en `seo-ops/`. Usar con /seo-review-cycle, "revisión SEO", "pasada de métricas", "cómo vienen los sitios", o desde un loop programado (argumento `auto`).
metadata:
  internal: true
---

# Ciclo de revisión SEO

Una corrida recorre los sitios de `seo-ops/sitios/`, mira cómo vienen, decide si hay algo que valga la pena cambiar y, solo si pasa la validación, lo deja en una PR en el repo del sitio. **"Esta vez no hay que tocar nada" es un resultado bueno**, no un fracaso: la mayoría de las corridas deberían terminar así. Cambiar por cambiar mete ruido en las mediciones y gasta la revisión de Gabriel.

Todo lo que pasa queda escrito en `seo-ops/` (en este repo, commiteado), para que la corrida siguiente compare contra esta y para mejorar el proceso con el tiempo.

Archivos de la skill:

- `senales.md`: umbrales, ventanas de comparación y el ruido conocido que **no** dispara nada. Leelo antes de diagnosticar.
- `plantillas.md`: formato del log por sitio, del resumen de la corrida y de la ficha `SITIO.md`.

Lo que es propio de cada sitio (repo, reglas de PR, idioma, congelaciones, experimentos abiertos, presupuesto) **no va en la skill**: va en `seo-ops/sitios/<slug>/SITIO.md`. El contexto de negocio (posicionamiento, competidores, key pages) sigue en el contexto del proyecto de OpenSEO (`get_project_context`); no lo dupliques.

## Fase 0 — Preparación

1. **Conectividad.** `curl -s -o /dev/null -w '%{http_code}' https://open-seo.cafecafe.dev/about` tiene que dar 200. Si da `000`, casi seguro es el bloqueo de IPs de Cloudflare por LaLiga: pará y reintentá más tarde. No intentes deployar nada de OpenSEO en ese estado.
2. **MCP.** `whoami`. Si dice "Needs authentication", pedile al usuario que corra `/mcp` (en modo `auto`, terminá la corrida avisando que falta login). Anotá el saldo de DataForSEO: se compara al final.
3. **Historia.** Leé `seo-ops/config.yaml`, `seo-ops/APRENDIZAJES.md`, y por cada sitio su `SITIO.md` y su última corrida en `seo-ops/sitios/<slug>/corridas/`. La corrida anterior dice qué se cambió, qué experimentos están abiertos y qué quedó pendiente.
4. **Opciones de la corrida.** En modo interactivo, preguntá con `AskUserQuestion` (una sola tanda, con los valores de `config.yaml` como recomendados):
   - **Sitios:** todos o una selección.
   - **Auditoría:** `ninguna` · `ligera` (re-auditar con la misma config y `compare_audits`) · `completa` (la skill `full-site-audit` al 100 %, con juez de contenido).
   - **Competidores:** sí/no. Qué hicieron los competidores últimamente frente a nosotros (cuesta créditos).
   - **Keywords nuevas:** sí/no. Investigar demanda nueva para páginas nuevas (cuesta créditos).
   - **Rank tracker:** `no` · `si_toca` (solo si pasó su intervalo) · `forzar`.
   - **AI visibility:** sí/no (cuesta créditos si hay que comprar respuestas).
   - **Salida:** `informe` (solo log) · `plan` (log + plan, sin PR) · `pr` (abre PR si pasa la validación).
   - **Presupuesto** de créditos para toda la corrida.

   Con el argumento `auto` no preguntes: usá `config.yaml`. En `auto` las PR solo se abren en sitios con `pr_automatica: true` en su `SITIO.md`; en el resto la salida es `plan`.

   La ficha del sitio puede bajar la salida: `estado: pausado` → como mucho `informe`; `puede_pr: false` (no hay repo accesible desde esta máquina) → como mucho `plan`.

5. **Estado de los repos.** Por cada repo, `gh pr list` filtrando la rama `seo-review/`, y además las PR abiertas que toquen SEO (títulos, metadata, sitemap, robots) aunque no sean del ciclo. Si la PR de la corrida anterior sigue abierta, **no abras otra** en ese repo (anotá que espera revisión). Si hay trabajo de Gabriel en curso sobre los mismos archivos (PR abierta o worktree con cambios sin commitear, ver `SITIO.md`), no lo pises. Si una PR del ciclo se mergeó desde la última corrida, ese cambio entra en medición: hacé las tareas post-deploy de la fase 6 si todavía no se hicieron, y registrá la fecha de deploy en `SITIO.md` como inicio del experimento. Mirá también si `main` del repo está en verde: una PR nueva sobre un `main` roto se anota como bloqueo en el resumen.

Trabajá los sitios en paralelo con subagentes (como mucho ~5 a la vez; heredan el MCP). Cada subagente recibe la ficha del sitio, la corrida anterior y las opciones, y devuelve el log del sitio. El orquestador revisa, valida (fase 4) y ejecuta.

## Fase 1 — Señales (gratis)

Por sitio, con el `projectId` de su `SITIO.md`. Todo esto no gasta créditos:

- **Search Console:** `get_search_console_performance` por `query` y por `page`, en ventanas iguales y completas (ver `senales.md`: datos finales, terminar en D-4). `get_search_opportunities` para posiciones 4–20. Si hubo un cambio brusco, `get_google_search_updates` para ver si coincide con un update de Google.
- **Bing:** `get_bing_overview` (trae el periodo anterior) y `get_bing_search_performance`. `compare_search_engines` si Google y Bing divergen.
- **Tráfico:** `get_umami_overview` y `get_umami_organic_landing_pages` (o GA4 si el sitio lo tiene). Ojo con el ruido conocido de Umami (`senales.md`).
- **Rank tracker:** `get_rank_tracker` (posición actual y anterior por keyword). Correr uno nuevo (`run_rank_tracker`, cuesta créditos) solo según la opción elegida.
- **Indexación:** `get_indexing_status` (problemas: `lost_indexing`, `noindex`, `fetch_error`, `canonical_mismatch`, `not_indexed_after_days`), `get_sitemaps`, `get_indexing_log` (últimos 7/30 días), `get_indexing_candidates`.
- **Auditoría** (según opción):
  - `ligera`: `run_site_audit` con la config de auditoría de `SITIO.md` (mismo `maxPages`, `includePaths`/`excludePaths`, motores) y `compare_audits` contra la última auditoría registrada. Mirá `issues.new`, `issues.resolved` y `drift` (canonical, noindex, title, h1 que cambiaron sin querer).
  - `completa`: seguí la skill `full-site-audit` para ese sitio.
- **AI** (gratis, si hay datos): `get_umami_ai_referrals`, `get_agent_readiness`, `get_ai_visibility_trend` (solo cuando dice `comparable`).

Escribí los números en el log del sitio (sección "Métricas") junto a los de la corrida anterior. Sin la comparación, el número no dice nada.

## Fase 2 — Diagnóstico

Con `senales.md` delante:

1. Marcá qué señales pasan un umbral y cuáles caen en el ruido conocido. Lo que es ruido se anota como ruido y no sigue.
2. Para cada señal real, buscá la **causa** antes de proponer nada: las observaciones no son causas. Verificá contra el HTML vivo (`curl`), el código del repo leído desde `origin/main` (`git archive`, nunca el working tree) y, para rankings, la SERP en vivo (`get_serp_results`, cuesta créditos).
3. Revisá los experimentos abiertos de `SITIO.md`: si llegó su fecha de revisión (7 y 28 días), medí contra la línea base del experimento y anotá el veredicto (funcionó / no funcionó / sin datos suficientes). Un experimento que no funcionó es un candidato a revertir, no a apilarle otro cambio encima.

## Fase 3 — Módulos opcionales (según opciones)

- **Competidores** (`competidores: sí`): para los competidores del contexto del proyecto, qué keywords ganaron o perdieron y qué páginas nuevas publicaron desde la última corrida. Reutilizá las skills `competitor-analysis` y `competitive-landscape`, acotadas a "qué cambió". Compará contra nuestras key pages. Resultado: oportunidades concretas o "nada relevante".
- **Keywords nuevas** (`keywords_nuevas: sí`): skill `keyword-research` arrancando por striking distance de GSC y Bing; `keyword-clustering` para mapear contra páginas existentes y detectar canibalización. Una página nueva necesita demanda medida.
- **Auditoría completa**: `full-site-audit`.
- **AI visibility** (`ai_visibility: sí`): skill `ai-visibility-audit`. Nunca compres respuestas nuevas si hay una corrida completa reciente.

Antes de cualquier llamada que cueste créditos, estimá el costo y comparalo con el presupuesto restante de la corrida. Si no alcanza, saltealo y anotalo.

## Fase 4 — Plan y validación

Armá la lista de **candidatos**: cada uno con la acción concreta (crear página, mejorar title/description/contenido de una URL, consolidar, noindex/redirigir, arreglar un bug técnico, pedir indexación), la evidencia (números y fuente), la causa verificada, el impacto esperado, el riesgo y cómo se va a medir (métrica y fechas de revisión a 7 y 28 días).

Cada candidato pasa por la validación. Tiene que cumplir **todo**:

1. **Señal real:** supera un umbral de `senales.md` con datos finales y ventanas iguales, y no está en la lista de ruido.
2. **Causa verificada**, no inferida: hay una prueba (HTML, código en `origin/main`, SERP en vivo, reporte de GSC/Bing) que conecta la señal con lo que se va a cambiar.
3. **No pisa nada:** no está en una congelación de `SITIO.md`, la página no tiene un experimento abierto (cambiada hace menos de 28 días) y no hay otra PR del ciclo abierta en ese repo.
4. **Mínimo y reversible:** el cambio más chico que ataca la causa, fácil de revertir.
5. **Medible:** queda escrito qué métrica debería moverse, cuánto y cuándo se revisa.
6. **Vale la pena:** el beneficio esperado (impresiones o clics en juego, páginas afectadas) justifica el riesgo y la revisión de Gabriel. Problemas de una sola URL con 5 impresiones no valen una PR.
7. **Página nueva:** demanda medida (volumen de DataForSEO o impresiones reales en GSC), sin canibalizar una página existente, y contenido que cumple las reglas del sitio (sin contenido de relleno).

Después, un **revisor adversarial**: un subagente nuevo, sin tu conclusión, recibe cada candidato con su evidencia cruda y tiene que argumentar por qué **no** hacerlo (ruido, causa equivocada, demasiado pronto, riesgo). Si encuentra un agujero que no podés cerrar con evidencia, el candidato cae.

Como mucho **3 acciones por sitio por corrida**, y un experimento por página a la vez. Lo que pasa la validación es `GO`; lo demás queda en el log como `NO-GO` con el motivo (así la corrida siguiente no lo vuelve a proponer sin datos nuevos) o como `ESPERAR` con la fecha en la que se vuelve a mirar.

## Fase 5 — Ejecución (solo con salida `pr` y algún `GO`)

En el repo del sitio, siguiendo las reglas de su `SITIO.md`:

1. Worktree desde `origin/main` en una rama `seo-review/AAAA-MM-DD`, **una por repo y corrida**: si dos sitios comparten repo (apruebatuope y opeosakidetza), sus cambios `GO` van en la misma PR. Nunca toques el working tree principal del repo.
2. Hacé solo los cambios `GO`. Respetá el idioma y el registro del sitio. Para contenido nuevo seguí `content-build` (brief, reglas de calidad, verificación de afirmaciones).
3. Corré los checks del repo (build, tests, lint) que diga `SITIO.md`. Revisá visualmente las páginas tocadas si cambió algo visible.
4. Commit y PR **sin mergear nunca**. Cuerpo de la PR al estilo `simple-issue-description`, en castellano: qué problema muestran los datos, qué cambia y cómo se va a medir. Enlazá el log de la corrida.
5. Si el repo exige el OK de Gabriel antes de commitear (`commit_requiere_ok: true` en `SITIO.md`), dejá los cambios en el worktree sin commitear, el plan en el log, y pedí el OK en el resumen. En la corrida siguiente, si dio el OK, commiteá y abrí la PR; si no respondió, no sigas acumulando cambios en ese repo.

## Fase 6 — Tareas post-deploy (corrida siguiente)

Cuando una PR del ciclo ya está mergeada y deployada:

- `submit_urls_for_indexing` con las URLs nuevas o cambiadas (IndexNow, con fallback a Yandex/Yep).
- Lista de URLs para pedir indexación a mano en Search Console (~10 por día y propiedad; no repetir las ya pedidas).
- Re-auditar las páginas tocadas y mirar los títulos y metas reales en producción (`curl`): ya pasó que un título salió distinto al de la PR.
- Registrar en `SITIO.md` el experimento con su fecha de deploy y sus fechas de revisión.

## Fase 7 — Registro y cierre

1. Escribí el log de cada sitio en `seo-ops/sitios/<slug>/corridas/AAAA-MM-DD.md` y el resumen de la corrida en `seo-ops/corridas/AAAA-MM-DD.md` (formatos en `plantillas.md`). Si corrés dos veces el mismo día, sufijo `-2`.
2. Actualizá cada `SITIO.md`: experimentos abiertos, backlog, decisiones nuevas de Gabriel, última auditoría de referencia.
3. En OpenSEO, una línea por sitio con `update_project_context` → `appendResearchLog` ("Revisión SEO AAAA-MM-DD: <veredicto>, PR <url|ninguna>, log seo-ops/…"). Es el índice; el detalle vive en el repo.
4. **Aprendizajes del proceso:** agregá a `seo-ops/APRENDIZAJES.md` lo que esta corrida enseñó sobre el proceso (un umbral que dio falsa alarma, una herramienta que falló, un paso que sobró o faltó). Si un mismo aprendizaje aparece dos veces, proponé el cambio concreto a esta skill o a `senales.md` en el resumen.
5. Saldo de DataForSEO al final (`whoami`) y créditos gastados en el resumen.
6. Commit en este repo (open-seo, se commitea directo a `main`) con solo los archivos de `seo-ops/`, y push.
7. Al usuario, 5–10 líneas: por sitio el veredicto (sin cambios / plan / PR con enlace), lo que espera una decisión suya, y lo que se revisa en la próxima corrida. En modo `auto`, el mismo resumen es el resultado del loop.

## Guardarraíles

- Nunca mergees PRs ni pushees a `main` en los repos de los sitios. Nunca toques robots.txt, canonicals, sitemaps ni redirecciones fuera de una PR validada.
- Nunca leas código de un sitio desde su working tree: siempre `origin/main` (`git archive`) o un worktree nuevo.
- Nunca gastes por encima del presupuesto de la corrida; en interactivo, preguntá antes de pasar de 2.000 créditos en total.
- Si una herramienta del MCP falla, reintentá una vez; si sigue, anotalo en el log y en `APRENDIZAJES.md` y seguí con el resto.
- Ante la duda entre cambiar y esperar, esperá y anotá cuándo se vuelve a mirar.
