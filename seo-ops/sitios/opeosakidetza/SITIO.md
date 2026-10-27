# opeosakidetza.com

```yaml
openseo_project_id: 710146da-518f-43ec-9d7c-f326601cbce3
dominio: opeosakidetza.com
repo: /home/gabriel/code/ope/opetests
github: gabrielcardetti/opetests
rama_base: main
estado: activo
puede_pr: true
pr_automatica: true
commit_requiere_ok: false
checks: "npm run typecheck && npm run check:l10n && npm run check:db-layer && npm run test:unit && npm run build"
idioma: "castellano de España, tuteo; leer /home/gabriel/code/ope/redes antes de escribir copy"
rank_tracker: { id: null, intervalo_dias: null, costo_aprox: null }
auditoria_referencia: { id: 516c0f04-fa33-409e-bd06-dd0cf95aebcb, fecha: 2026-10-27, maxPages: 500, includePaths: [], excludePaths: ["/bopv"], engines: [google] }
```

## Cómo se cambia y se despliega

Igual que apruebatuope.com (mismo repo, mismo Worker, misma PR por corrida). Ver `../apruebatuope/SITIO.md`.

## Reglas de contenido

- El sitio se va fundiendo en apruebatuope.com: **nada de contenido nuevo acá**, todo va en ATP. Lo que se toca en OSK son arreglos técnicos o de CTR de páginas que ya traen tráfico.
- El canonical cruzado OSK → ATP pliega URLs a propósito: lo que se vigila es que el tráfico migre y no se evapore.

## Congelaciones y pausas

- **Congelación SEO visible del 6 al 27 de noviembre de 2026** (exámenes de Fase II): no proponer cambios de títulos, contenido ni estructura.
- Ningún 301 OSK → ATP antes del 27-nov. Fecha objetivo de la mudanza: 15-dic (draft PR #127).
- Página de sueldo: no proponer cambios en pleno arranque de temporada.

## Experimentos abiertos

| Cambio | PR | Deploy | Revisar | Métrica y línea base |
| --- | --- | --- | --- | --- |
| Ronda 6: titles y descriptions de home, guía, CV, nota de la Fase 2, /recursos, fichas `/ope/test-*` y respuestas | #95 | 7-oct | 28 d = 4-nov (CTR a igual posición, GSC y Bing) | 14 d: home, guía y respuestas mejoran; CV sin efecto en Google y peor en Bing (0,85 → 0,23 %); recursos sin efecto. Lo que no funcione se revierte **desde el 28-nov** |
| Sueldo con tabla oficial y title «Tablas retributivas Osakidetza 2026 por categoría» | #105 | 13-oct | 28 d = 10-nov | 15 → 49 clics/sem, posición 5,9 → 5,0, #2 en la SERP. La hipótesis de las calculadoras no se confirmó |
| Respuestas: title «…plantillas Fase I y II» y respuestas por categoría | #114 | 15-oct | 28 d = 12-nov | CTR 5,3 → 7,65 % a 14 días (mezclado con #95) |

## Revisiones agendadas

- 30-oct a 3-nov: ¿la nota de fechas de la Fase 2 salió del Soft 404? (`get_indexing_status` / `inspect_urls`). Si no, dejarla: caduca el 27-nov.
- 4-nov: #95. 10-nov: #105. 12-nov: #114.
- 13-nov: go/no-go de la mudanza. Dato: la cohorte de fichas migra (OSK + ATP +19 %/sem) y los destinos en ATP están indexados.
- Durante la congelación: las descriptions de las fichas pierden la fecha solas al día siguiente de cada examen y home/guía/respuestas pasan a pasado el 28-nov: no atribuir esos cambios de CTR a nada nuevo.

## Línea base

- 21-oct (METRICAS-DIARIAS §8): Google 1.139 clics/semana; Bing 616 clics en 28 días.
- 2026-10-27 (semana 17–23 oct): Google 1.159 clics/semana; Bing 653 en 28 días; Umami 7.380 visitas (20–26 oct).

## Backlog

- Cuenta de servicio de Google Indexing API sin cargar (8-oct).
- Posible causa de Soft 404 tras deploys (`ErrorBoundary` + chunk de JS viejo): ver la ficha de apruebatuope. Después de la congelación.
- Eventos `google_auth_start_failed` (8 de 501, `request_failed`) y `metodo_load_failed` (27, errores de red): volumen bajo y no SEO; aviso para Gabriel.

## Decisiones pendientes de Gabriel

- ¿La congelación permite actualizar la página de respuestas con las plantillas oficiales de cada bloque (6–8, 21–22 y 27-nov)? Es el plan H7 de la ronda 6 (+200 a +400 clics estimados del 9-nov al 15-dic) y choca con «sin cambios de contenido».

## Descartado (no volver a proponer sin datos nuevos)

- 2026-10-27: caída de 7 días de la guía (50 → 29): vuelta a la media.
- 2026-10-27: CTR de `/ope/ope-osakidetza-test`: consultas de marca ajena (osasuntest).
- 2026-10-27: CTR de `/plazas-ope-osakidetza`: poco en juego y depende de la posición (9–12); las páginas de plazas van en el mapa de la mudanza.

## Ruido propio del sitio

- Umami compartido con apruebatuope.com: filtrar por hostname.
- URLs plegadas por el canonical cruzado: esperado.

## Documentos

Los de apruebatuope.com; además `docs/seo/ronda-6/opeosakidetza.md` y el mapa de la mudanza en la draft PR #54 (`docs/seo/mudanza-2026/`).
