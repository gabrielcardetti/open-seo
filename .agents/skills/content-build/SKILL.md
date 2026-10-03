---
name: content-build
description: Armar o rehacer el contenido SEO/GEO/AEO de un sitio en su propio repo, de cero a producción. Elige páginas por demanda real, las escribe con subagentes que siguen un brief común, las itera con el dueño en local, las revisa con el juez de guías y la auditoría de OpenSEO, prepara el sitio para agentes de IA, lo publica por PR y deja armada la indexación y la medición. Usar cuando un sitio tiene poco o nada de contenido, cuando se pide "armar el sitio para SEO", "páginas que traigan tráfico", "reorganizar el contenido" o repetir lo que se hizo en maxagente.com.
metadata:
  internal: true
---

# Armar el contenido de un sitio

`seo-audit` y `full-site-audit` diagnostican; esta skill construye. Escribe páginas en el código del sitio, con su diseño y sus componentes, y las lleva a producción. Salió del trabajo en maxagente.com (octubre de 2026): de 8 a 25 páginas en una sesión, todas elegidas por demanda, juzgadas y auditadas antes y después del deploy.

Lo propio de cada sitio no va acá: va en el contexto del proyecto de OpenSEO.
- **`positioning`**: qué hace el producto y contra quién compite.
- **`writing_preferences`**: las reglas de escritura del dueño.
- **Sección custom `decisiones`**: lo que el dueño decidió.
- **Research log**: cada compra de datos y cada auditoría.

Leelo al empezar y escribí ahí cada regla nueva **en el momento** en que el dueño la da. Esa memoria es lo que hace que la segunda página salga mejor que la primera y que otro agente pueda seguir.

## Fase 0: Contexto y punto de partida

1. `whoami`, `list_projects` (o `create_project`) y `get_project_context`. Si faltan `business_overview` o `positioning`, corré `seo-project-setup`, aunque sea mínimo.
2. **Leé el sitio como lo ve el cliente:**
   - La landing y sus componentes, para tomar su vocabulario ("responde, cobra, agenda") y sus bloques visuales.
   - El producto real (código, docs) para saber qué existe de verdad.
   - Toda afirmación de la página se va a verificar contra eso.
3. **Línea base, antes de tocar nada:**
   - `run_site_audit` sobre producción.
   - `run_agent_readiness_scan`.
   - `get_search_console_performance` por página y por query de los últimos 3 meses.
   - Anotá los IDs y los números en el research log: sin esto, después no se puede mostrar el impacto.
4. **Reglas operativas con el dueño, preguntadas una vez y guardadas en `decisiones`:**
   - Presupuesto de créditos (en Max: preguntar antes de gastar más de 2.000).
   - Rama y PR; nunca push a main.
   - Archivos locales que no se suben.
   - Cuándo se commitea (en Max: recién después de que el dueño revisa).

## Fase 1: Demanda primero

La regla que más cambió el resultado: **cada página existe porque hay búsquedas reales que la piden**, y tiene que vender el producto.

1. **Ideas gratis primero:**
   - Autocomplete de Google por país, sitemaps y páginas de competidores.
   - Qué citan las IAs para la categoría.
   - Subagentes con búsqueda web en paralelo.
   - Guardá el hallazgo en una sección custom del contexto.
2. **Validá con volúmenes antes de escribir:**
   - `get_keyword_metrics` (hasta 700 keywords por llamada) y `research_keywords` para expandir semillas.
   - Por mercado: el volumen de AR y el de MX pueden diferir 15 veces ("mensajes automáticos instagram": 210 contra 3.600).
   - El autocomplete sobreestima. Un cluster que parecía "alto" tenía de 10 a 50 búsquedas por variante.
3. **Decidí el mapa con estos criterios:**
   - Una página por intención con demanda. Variantes de la misma intención van a la misma página.
   - Integraciones o variantes sin demanda propia (≈10 búsquedas) se fusionan en una página de caso de uso. En Max, Google Calendar, Cal.com y Calendly entraron en /turnos-por-whatsapp.
   - Sin miedo a tirar páginas ya escritas si no tienen demanda o no venden.
   - No escribir guías que enseñan a usar el producto de un tercero, aunque tengan demanda: le hacen publicidad al reemplazo.
   - Competidores: "X precios" suele tener más demanda que "alternativas a X". Una URL por competidor, sin año en la URL.
   - Una herramienta gratis solo si resuelve algo real por sí sola y la búsqueda es grande. El generador de link de WhatsApp sí (18.000 búsquedas al mes en AR); el generador de plantillas de mensajes no.
4. **Cerrá el mapa con el dueño:**
   - Tabla de URL, keyword principal, volumen por mercado, intención, y si la página es nueva, se fusiona o se elimina.
   - Guardá los volúmenes en el research log y las páginas en `addKeyPages`.

## Fase 2: Arquitectura

- **Un solo registro de páginas** en el código (en Max, `app/_marketing/site-pages.ts`: ruta, título, resumen, grupo, fecha de actualización). De ahí salen el sitemap, `llms.txt`, los hubs, el footer y la versión en markdown. Una página nueva o eliminada se toca en un solo lugar.
- **Una biblioteca de bloques compartidos** con el estilo de la landing: intro, sección con superficie alterna, grilla de beneficios, pasos, tarjetas "Sigue con", preguntas frecuentes con su schema, franja de CTA, nota de fuentes, JSON-LD. Las páginas se arman con bloques, no con CSS suelto.
- **Convenciones fijas:**
  - Title de hasta 60 caracteres, con la búsqueda principal primero.
  - Description de 120 a 155 caracteres.
  - Un solo H1 con la keyword.
  - H2 que respondan búsquedas reales, y la primera oración de cada sección como respuesta directa.
- **JSON-LD:**
  - `BreadcrumbList`.
  - `WebPage` o `Article` con `dateModified` tomado del registro.
  - `FAQPage` solo si las preguntas se ven en la página.
  - Nunca ratings propios.
- **Navegación:** nav corto (canales, integraciones, guías, precios) y footer con todo. Toda página del sitemap tiene que tener al menos un link interno; si no, queda huérfana.

## Fase 3: Escribir en paralelo

1. **Escribí un brief común** a partir de [brief.md](brief.md) y guardalo en el scratchpad. Lleva:
   - El producto en un párrafo.
   - El objetivo de la ronda.
   - Las reglas de `writing_preferences`.
   - Los componentes disponibles.
   - El reparto de archivos.
   - La verificación obligatoria y el formato del informe.

   Cada subagente lo lee entero antes de empezar.
2. **Un subagente por grupo de páginas**, con un brief corto propio que apunta al común: páginas asignadas, keyword, qué reutilizar.
   - Cada uno edita **solo sus archivos**.
   - Los archivos compartidos (registro, nav, sitemap, hubs, landing) los conecta el coordinador al final.
   - Si un subagente necesita cambiar un componente compartido, solo agrega props opcionales y captura otra página que lo use.
3. **Al pasar URLs o listas a un subagente, verificá que estén en el prompt.** Un marcador sin reemplazar ("URLS_HERE") hace que el agente trabaje sin datos o tome lo de otro.
4. **El coordinador integra:** conecta el registro y los hubs, corre la pasada de duplicados entre páginas y revisa que los informes no hayan recortado de más. En Max, los agentes de deduplicación vaciaron ledes que había que restaurar.

### Reglas de contenido (la vara)

Son las que el dueño de Max fue fijando en la revisión. Valen como punto de partida para cualquier sitio; las propias del sitio mandan.

**Foco**
- Cada página vende el producto. Nada de tutoriales de productos de terceros.
- Comparativas: el peso en el producto propio. Del competidor, lo justo, con fuente oficial y fecha. Sin secciones "cuándo te conviene X" ni "otras opciones". Los números honestos, y que el lector saque las conclusiones.
- Simplificar y generalizar: "no importa dónde tengas X, lo resolvemos". Nombrar plataformas ayuda al SEO, pero sin tablas que comparen tus propias integraciones entre sí.
- La configuración se ve dentro del producto. En la página de venta, a lo sumo 3 o 4 pasos que muestren lo fácil que es empezar, sin tokens, permisos ni plazos.
- Los precios del producto viven en un solo lugar y el resto enlaza ahí.

**Forma**
- **Ledes con punch:** lista concreta de lo que hace de verdad y "y mucho más". El lede puede resumir la página.
- **Sin contenido duplicado entre secciones:** la misma idea no va en dos bloques, aunque cambie el formato (tabla, tarjetas, FAQ, caption, "Sigue con"). Es lo que más molestó al dueño, así que hacé una pasada solo para eso antes de mostrar.
- **FAQ:** de 2 a 4 preguntas reales que la página no responde ya. La respuesta empieza con la respuesta ("Sí.", "No.", el dato), sin jerga interna. Con 0 o 1, no va la sección.
- **En positivo:** lo que el producto hace, no lo que no hace. Corto. Sin raya larga, sin relleno de IA, sin exclamaciones.

**Verdad**
- Toda afirmación sobre el producto se verifica en el código o en las docs.
- Toda regla de un tercero (precios de Meta, políticas) lleva fuente oficial y "revisada el <fecha>". Leela **renderizada en un navegador** (Playwright): WebFetch puede devolver una versión archivada. En Max devolvió "72 horas" cuando la página viva decía "hasta 7 días".
- En salud o veterinaria, las indicaciones se atribuyen al negocio ("según las indicaciones del laboratorio"), nunca al producto.

**Visuales**
- Diagramas siempre en código (SVG o HTML). Las imágenes raster generadas salieron borrosas y se descartaron.
- **Conversaciones de ejemplo realistas:**
  - Ida y vuelta, mensajes cortos, una idea por mensaje.
  - Cada herramienta en su momento: buscar antes de ofrecer, verificar después de "pagué".
  - Horarios coherentes: si hay un seguimiento a los 2 minutos, el mensaje sale 2 minutos después.
  - El realismo vale más que unos segundos menos de animación.
- Varios casos del mismo flujo van en pestañas que cambian la animación, no en bloques repetidos.
- Fotos generadas solo como contenido dentro de los chats (comprobantes, pedidos), con datos ficticios y sin marcas reales. WebP de menos de 120 KB con **nombre nuevo**: Next cachea las imágenes por nombre.

## Fase 4: Iterar con el dueño

- Levantá el sitio en local y compartilo por túnel (`bun tunnel.ts up <slug>` en `~/code/cloudflare-tunnels`). Mandá URLs completas, no rutas.
- Capturá con Playwright a 1440 y a 390 px y miralas antes de mostrar. Las animaciones, cuando terminaron, con un viewport más alto que la sección.
- **Cada corrección del dueño se generaliza:**
  1. Arreglala en la página que la motivó.
  2. Buscá el mismo problema en todas las demás.
  3. Guardala en `writing_preferences` o `decisiones` con la fecha.

  Ejemplos de Max: "sacá el '¿Cuánto cuesta?' de todos lados", "esto no interesa para vender, lo ven dentro de la plataforma".
- Si un cambio de diseño compartido rompe algo que al dueño le gustaba, revertilo enseguida y preguntá.
- Commiteá solo lo que el dueño ya revisó. Un solo PR al final.

## Fase 5: Revisión antes del PR

1. **Código:** typecheck, lint, tests y el build de producción. Si el repo tiene `node_modules` enlazado, buildeá en un worktree aparte con `bun install`.
2. **Auditoría del túnel:** `run_site_audit` sobre la URL del túnel. Los canonical que apuntan a producción son ruido esperado ahí.
3. **Juez de guías con modelo propio** (gratis):
   - Usá `get_guidelines_evaluation_batch` y `submit_guidelines_evaluation`, con `engines: ["google","bing"]` en las dos llamadas.
   - Primero el ítem del sitio (`<origen>/#site`), juzgado y enviado.
   - Después las páginas, repartidas entre subagentes con **listas de URLs explícitas**.
   - Los fails de datos de terceros se verifican contra la fuente renderizada antes de aceptarlos. Si el juez se equivocó, reenviá el veredicto corregido.
4. **Chequeos técnicos** de [checks.md](checks.md):
   - Un solo H1 por página, también cuando la landing incrusta pantallas reales de la app.
   - Palabras pegadas por saltos de línea en JSX.
   - Recursos pesados precargados que se filtran a otras páginas.
   - Páginas eliminadas que siguen enlazadas.
   - Sin scroll horizontal a 390 px.

## Fase 6: Listo para agentes de IA

Hacelo en el mismo PR o en uno hermano, y medilo con `run_agent_readiness_scan` (en Max pasó de 5/14 a 12/14):
- **`robots.txt`:**
  - Grupos explícitos para GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, Meta-ExternalAgent, Amazonbot y CCBot.
  - `Content-Signal: search=yes, ai-input=yes, ai-train=yes`.
  - `Sitemap:`.
- **`llms.txt`** generado desde el registro de páginas.
- **Markdown para agentes:** `Accept: text/markdown` devuelve markdown, más `<link rel="alternate" type="text/markdown">`.
- **Link headers en la home:** `api-catalog`, `describedby` (llms.txt), `service-doc` y `alternate`.
- **Si hay API o MCP:**
  - `/.well-known/api-catalog` (RFC 9727).
  - `/.well-known/mcp/server-card.json`.
  - `oauth-authorization-server` y `oauth-protected-resource`.

## Fase 7: Lanzamiento y medición

1. Después del merge y el deploy, corré `run_site_audit` sobre producción con `runLighthouse: true`, y comparalo con la línea base usando `compare_audits`. Juzgá todo de nuevo con el juez (ver `full-site-audit`, fase 2) y `run_agent_readiness_scan`.
2. **Lighthouse:**
   - El MCP no devuelve los puntajes. Corré Lighthouse en local contra producción (comandos en [checks.md](checks.md)) en las páginas principales.
   - Mirá las peticiones más pesadas de cada página: en Max, un modelo 3D de 3 MB de la home se descargaba en todo el sitio.
3. **Indexación:**
   - `inspect_urls` dice "URL is unknown to Google" para lo nuevo.
   - El dueño envía el sitemap en Search Console y pide indexación a mano, por orden de demanda. La cuota ronda las 10 o 12 por día, así que pasale la lista partida por días.
   - Bing Webmaster Tools se da de alta importando desde Search Console. Después, conectarlo en OpenSEO y `verify_indexnow_key` / `submit_urls_for_indexing`.
4. **Medición:**
   - Anotá en el research log la línea base de Search Console y los IDs de las auditorías.
   - Si el sitio mide con Umami (Cloud o self-hosted), conectalo en Integraciones del proyecto y anotá también la línea base orgánica de `get_umami_overview`. Con Search Console y Umami conectados, `get_search_opportunities` prioriza las páginas en posiciones 4–20 que ya traen visitas que se quedan.
   - Proponé saber qué página trae cada registro: guardar la primera página de la visita junto con los UTM al crear la cuenta.
   - Eventos en los CTA y las herramientas (en Umami, `umami.track`; se leen con `get_umami_events`).
   - Un rank tracker de las keywords del mapa: `estimate_rank_tracker_cost` antes y aprobación del dueño.
5. Revisá Search Console a las 2 semanas y al mes. Una página sin impresiones a los 3 meses se consolida o se pone en noindex.

## Guardrails

- Ninguna página sin demanda medida, y ninguna que no venda el producto.
- No publicar una afirmación que no se verificó en el código, las docs o una fuente oficial renderizada.
- No gastar créditos por encima del presupuesto del dueño sin preguntar.
- No commitear antes de que el dueño revise. No hacer push a main. No subir archivos que el dueño marcó como locales.
- Lo específico del sitio va al contexto del proyecto, no a esta skill. Si aparece una regla que sirve para cualquier sitio, proponé sumarla acá.
