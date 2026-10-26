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
auditoria_referencia: { id: 91531f49-9310-4d9f-9189-7c9a7a07b542, fecha: 2026-09-29, maxPages: 500, includePaths: [], excludePaths: ["/bopv"], engines: [google] }
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

## Revisiones agendadas

- 28-oct: sueldo OSK −72 % de clics (206 → 58, 28 contra 28) por calculadoras en la SERP (osakiprep, redopositor): competencia de formato, no penalización. Eventos `google_auth_start_failed` y `metodo_load_failed` en OSK.
- 13-nov: go/no-go de la mudanza.

## Línea base

- 21-oct (METRICAS-DIARIAS §8): Google 1.139 clics/semana; Bing 616 clics en 28 días.

## Backlog

- Cuenta de servicio de Google Indexing API sin cargar (8-oct).

## Ruido propio del sitio

- Umami compartido con apruebatuope.com: filtrar por hostname.
- URLs plegadas por el canonical cruzado: esperado.

## Documentos

Los de apruebatuope.com; además `docs/seo/ronda-6/opeosakidetza.md` y el mapa de la mudanza en la draft PR #54 (`docs/seo/mudanza-2026/`).
