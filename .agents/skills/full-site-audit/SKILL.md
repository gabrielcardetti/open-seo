---
name: full-site-audit
description: Auditoría SEO completa y repetible de un sitio entero (todas las páginas, no una muestra) con OpenSEO en producción — crawl técnico, evaluación de contenido contra las guías de Google repartida entre modelos baratos y calibrada contra Opus, agent readiness, cruce con Search Console, backlog priorizado e informe. Usar cuando se pide "auditar todo", "auditoría completa", repetir la auditoría de un sitio o medir si las correcciones mejoraron el SEO.
metadata:
  internal: true
---

# Auditoría completa de un sitio

Este es el proceso largo. Para un informe de una página para alguien no técnico está `seo-audit`; esta skill reutiliza sus reglas de verificación y entrega por `seo-report`, pero cubre el sitio entero y deja todo guardado para poder repetirlo y comparar.

Lo que es propio de cada sitio (dominios, secciones, migraciones, fuentes de datos externas, decisiones tomadas) **no va en esta skill**: va en el contexto del proyecto de OpenSEO (`get_project_context` / `update_project_context`). Si al terminar aprendiste algo del sitio, escribilo ahí.

## Acceso

- **MCP con OAuth** (sesión interactiva de Claude Code): el server `openseo` apunta a `https://open-seo.cafecafe.dev/mcp`; si dice "Needs authentication", pedile al usuario que corra `/mcp`.
- **Subagentes de Claude Code** heredan esa misma conexión MCP: pueden pedir lotes y enviar veredictos directamente.
- **Grok u otros CLIs** no tienen sesión en el MCP (el self-host está detrás de Cloudflare Access con login por email; las API keys solo existen en modo hosted). El orquestador baja cada lote a un archivo del scratchpad, Grok juzga desde el archivo y escribe JSON, y el orquestador lo envía.
- **D1 de producción** (lecturas agregadas que el MCP no da, p. ej. conteos por tipo de issue): `npx wrangler d1 execute open-seo-db-selfhost --remote --json --command "<sql>"` con `.env.selfhost` cargado y Node 22. Solo lectura; las escrituras van por el MCP.

## Fase 0 — Alcance y contexto

1. `whoami`, `list_projects`. Un proyecto por dominio; si falta, `create_project`.
2. `get_project_context`. Si falta `business_overview` o el alcance, corré `seo-project-setup` (al menos alcance, objetivos y key pages). Registrá las decisiones de alcance como sección custom `audit-scope`: qué dominios y secciones entran, cuáles se dejan fuera y por qué.
3. Inventario real: contá las URLs de cada sitemap (incluidos índices y sub-sitemaps) y agrupalas por sección. Comprobá que cada sitemap devuelva XML y esté listado en el índice o en `robots.txt`: un sitemap que devuelve HTML o que no está enlazado ya es un hallazgo.
4. Search Console conectado en cada proyecto (Integrations). Sin GSC la priorización de la fase 4 queda ciega. Si el proyecto tiene Bing Webmaster Tools conectado, corré `sync_bing_now` antes del crawl: la auditoría lee los problemas de rastreo de Bing del último sync.

## Fase 1 — Crawl técnico completo

- `run_site_audit` con `maxPages` por encima del total del inventario (tope 10.000), `evaluateContent: false`, y `runLighthouse: true` solo si interesa rendimiento (muestra de 10). Las secciones que quedan fuera del alcance (anotadas en `audit-scope`) van en `excludePaths` (p. ej. `["/archivo"]`): no se crawlean, no gastan presupuesto de páginas y no suman hallazgos. Para auditar una sola sección, `includePaths` (p. ej. `["/bopv"]`) con la URL de inicio dentro de ella; en ese caso no se informan páginas huérfanas. El crawl arranca desde robots + sitemaps y es gratis; lo único que cuesta es tiempo (~1 min cada 50 páginas con pacing).
- `get_audit_status` con `waitSeconds: 50`, repitiendo hasta que termine.
- Al terminar: `get_audit_issues` con `groupBy: "template"` (una fila por tipo × plantilla de URL, con recuento y ejemplos). **Agrupá por plantilla**, no por página: 100 títulos largos que salen de la misma plantilla son un solo arreglo. Las páginas noindex no suman issues de longitud de título ni de meta description. Con Bing conectado aparecen además `bing-malware`, `bing-crawl-error` y `bing-blocked-by-robots`; si Bing no puede rastrear una URL que nuestro crawler sí alcanzó, puede ser un firewall o un grupo `bingbot` en robots.txt: revisá robots.txt y las reglas del firewall o CDN antes de reportarlo.
- Contrastá: páginas del sitemap que el crawl no alcanzó, páginas crawleadas que no están en el sitemap, noindex inesperados, canonicals que apuntan a otro dominio.
- Verificá cada hallazgo que vayas a reportar contra el HTML vivo (`curl`), como exige `seo-audit`.

## Fase 2 — Contenido contra las guías de Google (y de Bing)

Judging externo: la herramienta entrega páginas y reglas, un modelo nuestro juzga, y OpenSEO recalcula el veredicto desde el catálogo.

**Motores.** Por defecto se juzgan solo las reglas de Google. Pasá `engines: ["google","bing"]` a `get_guidelines_evaluation_batch` y el **mismo** valor a `submit_guidelines_evaluation` cuando importe Bing o Copilot (Bing conectado, tráfico de Bing, citas en respuestas de IA). Las reglas que dicen lo mismo en los dos motores se juzgan una vez y cuentan para ambos. Una página ya juzgada para Google vuelve a salir en el batch si pedís Bing, y enviar solo Bing conserva lo que ya estaba guardado para Google. Decidilo al empezar y anotalo en `audit-scope`, para que la ronda siguiente use los mismos motores y `compare_audits` compare lo mismo.

1. **Qué juzgar.** Todas las páginas editoriales (`strategy: "all"`). Las secciones generadas por plantilla con miles de URLs se juzgan por muestra (`strategy: "sample"` o una lista de ~20–40 URLs representativas): juzgar 2.000 páginas idénticas en estructura dice poco más que juzgar 30.
2. **Reparto.** Listá las URLs elegibles con `get_audit_pages` (2xx, indexables), partilas en lotes y dale a cada juez **su propia lista** vía `get_guidelines_evaluation_batch({ urls: [...] })`. Sin `urls`, dos jueces en paralelo reciben las mismas páginas.
3. **Calibración antes del volumen.** Elegí 10–15 páginas variadas (home, pillar, programática, legal, una que el crawl marcó thin). Que las juzguen Opus (referencia), Haiku y Grok **sin enviar**: cada uno escribe su JSON de findings en el scratchpad. Compará por página y regla: coincidencia de veredicto, fails que el barato inventa (sin cita literal), fails que se le escapan. Anotá el resultado en el contexto del proyecto (`judge-calibration`) con fecha y modelos.
4. **Volumen.** El juez que salga bien calibrado juzga el resto en paralelo (subagentes Haiku con `model: "haiku"`, o Grok por CLI), enviando con `submit_guidelines_evaluation` y `judgeModel` real. Cada lote: pedir → juzgar → enviar → siguiente, hasta que el batch devuelva vacío.
5. **Revisión.** Opus relee solo los `reject`, los `revise` y los `unknown` altos. Un fail sin cita de la página se descarta.
6. Resultado: `get_guideline_results`. Cada página trae `verdicts` por motor; `verdict`, el filtro `verdict` y `summary` siguen a `engine` (Google si se juzgó), y `summary.by_engine` cuenta los dos. Un finding con status `conflict` es una preferencia de Bing que Google considera innecesaria (BING-17, BING-34): va al backlog como opcional, nunca como bloqueo.

Reglas para los jueces: responder solo lo que no pasa; `unknown` en vez de adivinar; citar las palabras de la página en cada fail; no inventar políticas fuera del catálogo.

Cosas a tener en cuenta con los jueces:
- **Lista explícita.** Pasale a cada juez su lista de URLs dentro del prompt y confirmá que esté. Un marcador sin reemplazar lo deja sin páginas o lo hace pedir las de otro.
- **Datos de terceros.** Un fail sobre un precio, plazo o política de un tercero (Meta, Google, una pasarela de pago) se verifica contra la página oficial **renderizada en un navegador** (Playwright), no con WebFetch: puede devolver una versión archivada. En maxagente.com, dos jueces marcaron como error "hasta 7 días" porque leyeron una copia vieja que decía 72 horas. Si el juez se equivocó, reenviá el veredicto corregido de esa página.

## Fase 3 — Agent readiness

`run_agent_readiness_scan` por dominio, `get_agent_readiness` para leer. Separá lo que aplica (robots con reglas para bots de IA, Content Signals, `llms.txt`, markdown negotiation) de lo que no aplica al sitio (OAuth discovery, A2A, comercio si no vende por API).

## Fase 4 — Priorizar con datos de búsqueda

- `get_search_console_performance` por página y query (últimos 3 meses). Si el proyecto tiene una fuente de GSC propia más rica, está anotada en su contexto: usala.
- Prioridad = impacto × esfuerzo. Pesa más un problema en páginas con impresiones y CTR bajo (título o description que corta), páginas en posición 5–20, y páginas con tráfico que el crawl marcó con problemas de indexación o canonical.
- Si hay dos dominios que compiten o migran, marcá la canibalización: la misma intención servida por los dos, sin canonical ni redirección.

## Fase 5 — Backlog e informe

1. Backlog accionable, agrupado por **dónde se arregla en el código** (plantilla, generador de meta, sitemap, contenido de una página concreta), con la evidencia de cada ítem y cuántas URLs afecta.
2. Revisión adversarial antes de entregar (como en `seo-audit`): un segundo agente recibe el borrador y la evidencia, y ataca las afirmaciones que van más allá de los datos, los números que no cuadran, las prioridades mal ordenadas y los hallazgos del juicio que se perdieron en el backlog. Verificá cada cosa que marque antes de corregirla.
3. Informe por `seo-report` (`skill: "full-site-audit"`): estado por dominio, top 5 por impacto, backlog completo, qué se verificó a mano y con qué modelos se juzgó.
4. `update_project_context`: `appendResearchLog` con fecha, IDs de auditoría y veredicto; key pages nuevas; decisiones.

## Repetir y medir

- Después de desplegar correcciones, corré de nuevo las fases 1–3 con la misma configuración y compará contra la auditoría anterior (IDs en el research log, o `list_site_audits`) con `compare_audits({ baseAuditId, auditId })`: páginas nuevas y eliminadas, issues resueltos y nuevos por tipo, veredictos de guías que mejoraron o empeoraron (los de Bing, aparte, en `guidelines.bing`). Si los dos crawls no cubrieron las mismas URLs, mirá `issues.common` (solo URLs presentes en ambas, también por plantilla): lo demás mezcla arreglos con cambios de muestra. Agent readiness guarda su propio historial en `get_agent_readiness`.
- Anotá el resultado de cada ronda en el research log, para que la evolución quede en un solo lugar.
- **Después de un lanzamiento de contenido**, seguí la fase 7 de `content-build`: indexación en Search Console (cuota de unas 10 a 12 por día), Bing, IndexNow y la línea base de medición.
- **Lighthouse.** El MCP no devuelve los puntajes de Lighthouse. Para medir rendimiento, corré Lighthouse en local contra producción y mirá las peticiones más pesadas de cada página (comandos en `content-build/checks.md`).

## Guardrails

- No enviar veredictos de un juez sin calibrar.
- No reportar nada que no se haya visto en el HTML vivo o en los datos.
- No tocar el código del sitio auditado desde esta skill: el backlog se entrega, y los cambios se hacen en el repo del sitio con su propio flujo.
- Para ubicar un hallazgo en el código del sitio, leé lo que está desplegado (normalmente `origin/main`), nunca el working tree: suele tener ramas y cambios locales sin publicar que confunden lo que ve el crawler con lo que hay en el disco. `git fetch origin main && git archive origin/main | tar -x -C <scratchpad>/<sitio>-main`, sin checkout.
