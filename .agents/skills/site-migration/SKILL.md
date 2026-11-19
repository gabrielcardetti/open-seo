---
name: site-migration
description: Mudanza de URLs sin perder posiciones — cambio de dominio, fusión de dos sitios en uno, subdominio a carpeta o cambio de slugs. Arma el inventario completo de URLs viejas (sitemap, repo, Search Console, Bing, analítica, backlinks), el mapa de redirecciones una a una, lo verifica contra el sitio en vivo con un script, repasa el corte (canonical, sitemap, robots, schema, Search Console) y deja el seguimiento agendado. Usar cuando se pide "migrar el dominio", "fusionar sitios", "mudanza", "redirecciones 301", "cambiar las URLs" o revisar una migración ya hecha que perdió tráfico.
metadata:
  internal: true
---

# Mudanza de un sitio

Mover URLs es lo más fácil de romper en SEO: el tráfico se pierde en un día y tarda meses en volver. Casi siempre es por una de estas:

| Error | Qué pasa |
| --- | --- |
| Mandar todas las URLs viejas a la portada nueva | Google las trata como 404 blandos y se pierde lo que cada página interior había ganado |
| Cadenas de dos o tres saltos (http → https → slug viejo → dominio nuevo) | Cada salto retrasa el procesamiento y los rastreadores dejan de seguir |
| Salir con el `noindex` o el `Disallow: /` de staging | El sitio nuevo se desindexa el día del lanzamiento |
| Bloquear el dominio viejo en robots.txt | Google no puede rastrear las URLs viejas, nunca ve los 301 y las deja indexadas |
| Mapear solo lo que está en el sitemap actual | Las páginas retiradas con enlaces externos pasan a dar 404 |
| Quitar las redirecciones a los meses | Los enlaces externos viven años; sin el 301 dejan de contar |

El resultado es un mapa de redirecciones verificado, los cambios del corte en el repo y el seguimiento agendado. Una checklist sin mapa no es el trabajo.

Los datos de cada sitio (fecha del corte, qué queda congelado, cómo se despliega) están en el contexto del proyecto de OpenSEO y, para los sitios de `seo-ops/sitios/`, en su `SITIO.md`. Leelos primero: la mudanza puede estar ya planificada, con una PR abierta y una fecha.

## Qué tipo de mudanza es

- **Cambio de dominio completo**: todos los pasos, más la herramienta de cambio de dirección de Search Console.
- **Fusión de dos sitios en uno**: todos los pasos para el sitio que se retira. Cada página retirada va a su equivalente temático más cercano en el que queda. Las dos propiedades de Search Console son proyectos distintos en OpenSEO: hacen falta los dos `projectId`.
- **Subdominio a carpeta**: pasos 1 a 4.
- **Cambio de slugs en el mismo dominio**: pasos 1 a 3 y actualizar el sitemap.

## 1. Inventario de URLs viejas

La unión de todas estas fuentes. Cada una encuentra URLs que las otras no:

1. **Sitemap del sitio viejo** (y los anidados).
2. **Rutas del repo**: las estáticas y todas las que salen de datos o contenido.
3. **Search Console**: `get_search_console_performance` por página con el rango más largo que dé, toda URL con al menos un clic o diez impresiones. Pedilo también por tipo de búsqueda si el sitio aparece en Discover o imágenes.
4. **Bing**: `get_bing_search_performance` por página, si está conectado.
5. **Analítica**: `get_umami_organic_landing_pages` o `get_google_analytics_organic_landing_pages`, páginas de entrada de los últimos 12 meses.
6. **Backlinks**: `get_backlinks_profile`, las URLs viejas con dominios de referencia. Cuesta créditos y es la fuente que salva las páginas retiradas con enlaces: no saltearla en una mudanza de dominio.
7. **Última auditoría**: `get_audit_pages`, que además dice cuáles ya redirigen hoy.

Normalizá antes de deduplicar: host en minúsculas, sin query ni fragmento, una sola forma de barra final. Guardá `inventario.csv` con `old_url,fuentes,clics,impresiones,dominios_de_referencia`. Los datos que costaron créditos se guardan en la carpeta del sitio.

## 2. Mapa uno a uno

Cada fila del inventario recibe un destino:

- Mismo contenido, misma ruta en el dominio nuevo → regla general de misma ruta.
- Mismo contenido, slug nuevo → entrada explícita.
- Contenido que se fusionó en otra página → entrada explícita a la página que lo absorbió.
- Contenido borrado **con** clics o enlaces → a la página del mismo tema si existe; si no existe, se restaura el contenido en el sitio nuevo y se mapea a eso.
- Contenido borrado sin clics ni enlaces → que dé 410. Nunca a la portada.

Después, **aplastar cadenas**: si el sitio ya tenía redirecciones, cada URL vieja apunta a su destino final para llegar en un solo salto.

Escribí `mapa-redirecciones.csv` con cabecera `old_url,new_url`. Toda `new_url` tiene que responder 200 antes del corte. En una fusión, revisá que dos páginas del sitio viejo y el nuevo no compitan por la misma búsqueda: `compare_search_engines` y las consultas de cada página en Search Console dicen cuál de las dos gana hoy, y esa es la que queda.

Implementá el mapa donde el sitio ya resuelve sus redirecciones (el Worker, el framework, reglas de Cloudflare). Las entradas explícitas van antes que la regla general.

## 3. Verificar contra el sitio

```bash
node .agents/skills/site-migration/scripts/verify-redirects.mjs mapa-redirecciones.csv
```

Para cada fila comprueba que la URL vieja responde 301 o 308, que su `Location` es exactamente la nueva, que llega en un salto, y que la nueva responde 200 sin `noindex` y con su canonical apuntándose a sí misma. Sale con error si algo falla.

- **Antes del corte**: `--old-origin https://preview…` pide las rutas viejas al entorno de prueba y compara contra el mismo destino.
- `--http-hops 2` donde el host fuerza HTTPS antes de que corra la aplicación (Cloudflare con "Always Use HTTPS", Vercel, Netlify): `http://` tarda un salto más que no se puede quitar. Nunca más de dos.
- **El día del corte**, otra vez contra producción. La mudanza está hecha cuando imprime `0 con fallas`.

## 4. Corte

Bloqueantes en el sitio nuevo, todos tienen que pasar:

```bash
curl -s https://nuevo.com/robots.txt                 # sin "Disallow: /" para User-agent: *
curl -sI https://nuevo.com/ | grep -i x-robots-tag   # no imprime nada
curl -s https://nuevo.com/ | grep -io '<meta name="robots"[^>]*>'   # sin noindex
```

En el repo:

1. **URL base**: canonicals, Open Graph y sitemap usan el origen nuevo. Un `grep` del dominio viejo solo debería encontrar las redirecciones y las menciones históricas.
2. **Sitemaps**: el del dominio nuevo lista solo URLs nuevas. El del viejo se deja accesible con las URLs viejas unos 60 días: Google las vuelve a pedir, encuentra los 301 y procesa la mudanza antes.
3. **robots.txt del dominio viejo**: sigue permitiendo el rastreo.
4. **Enlaces internos**: apuntan directo a las URLs nuevas, no pasan por la redirección.
5. **`hreflang`**, si hay: todas las alternativas en el dominio nuevo y recíprocas.
6. **Schema `Organization`**: `alternateName` con el nombre y el dominio viejos, y una línea visible ("antes X") en la página de quiénes somos. Así Google y las IAs conectan las menciones viejas con el sitio nuevo.
7. **IndexNow**: el archivo de clave del dominio nuevo publicado (`get_indexing_setup`, `verify_indexnow_key`).

A mano, a cargo del dueño:

- Search Console: verificar las dos propiedades y, en un cambio de dominio completo, usar **Cambio de dirección** desde la vieja.
- Bing Webmaster Tools: herramienta de traslado de sitio.
- Mantener el dominio viejo registrado, con HTTPS válido y las redirecciones vivas **para siempre**.

## 5. Después del corte

- **Día 1**: el script contra producción en `0 con fallas`. `update_sitemaps` y `submit_sitemaps` en el proyecto nuevo. `submit_urls_for_indexing` con las URLs nuevas más importantes. `inspect_urls` de diez de ellas.
- **Semanas 1 a 4**: `get_indexing_status` del proyecto nuevo sube mientras el viejo baja. Si el nuevo sigue plano a los 14 días hay un bloqueo de rastreo. Clics e impresiones sumados de las dos propiedades contra la línea base de antes del corte: lo esperable es una caída corta y recuperación, no dos curvas que no se cruzan.
- **Rank tracker**: los mismos términos, ahora contra el dominio nuevo. Anotar la posición de la víspera.
- **Auditoría**: `run_site_audit` del sitio nuevo con la configuración de referencia y `compare_audits`; enlaces rotos y cadenas de redirección aparecen ahí.
- **Enlaces externos**: de los backlinks al dominio viejo, los 20 a 50 mejores (uno por dominio, con tráfico) reciben un borrador de mail pidiendo actualizar el enlace: la página exacta, el enlace viejo y el nuevo, menos de 90 palabras, un solo pedido. Se dejan escritos; no se envían.

Dejá agendadas las revisiones (7, 14 y 28 días) donde el sitio lleva sus experimentos, con la línea base al lado.

## Si la mudanza ya se hizo y perdió tráfico

Mismo orden, como diagnóstico: reconstruí el inventario con Search Console de antes del corte (las URLs viejas con clics), corré el script contra lo que haya de mapa y buscá las que dan 404, caen en la portada o tardan más de un salto. Casi siempre son las URLs que no estaban en el sitemap.

## No hacer

- Redirigir páginas interiores a la portada.
- Publicar una redirección de más de un salto.
- Bloquear el dominio viejo en robots.txt.
- Dejar vencer el dominio viejo o su certificado.
- Quitar las redirecciones cuando el tráfico se recupera.
- Enviar mails o tocar Search Console en nombre del dueño.
