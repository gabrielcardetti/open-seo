# apruebatuope.com

```yaml
openseo_project_id: af3759c8-ef5d-42e1-bbf5-6f988ac7cd0b
dominio: apruebatuope.com
repo: /home/gabriel/code/ope/opetests
github: gabrielcardetti/opetests
rama_base: main
estado: activo
puede_pr: true
pr_automatica: true
commit_requiere_ok: false
checks: "npm run typecheck && npm run check:l10n && npm run check:db-layer && npm run test:unit && npm run build"
idioma: "castellano de España, tuteo; leer el repo de marca /home/gabriel/code/ope/redes antes de escribir copy"
rank_tracker: { id: e2077f30-ea5b-4401-9f49-35f5e991619d, intervalo_dias: 7, costo_aprox: 513, keywords: 57, dispositivo: mobile }
auditoria_referencia: { id: 3c1ae162-116d-43e6-af19-05ca4bb2a0d5, fecha: 2026-10-27, maxPages: 6000, nota: "la de 2026-10-27 se hizo con 4000 y llegó al tope (3.996); comparar por issues.common", includePaths: [], excludePaths: ["/bopv/2008", "/bopv/2009", "/bopv/2010", "/bopv/2011", "/bopv/2012", "/bopv/2013", "/bopv/2014", "/bopv/2015", "/bopv/2016", "/bopv/2017", "/bopv/2018", "/bopv/2019", "/bopv/2020", "/bopv/2021", "/bopv/2022", "/bopv/2023", "/bopv/2024", "/bopv/2025", "/bopv/calendario/2023", "/bopv/calendario/2024"], engines: [google] }
```

## Cómo se cambia y se despliega

- Mismo repo y mismo Worker que opeosakidetza.com: los cambios de los dos sitios van en **una sola PR** por corrida.
- Worktree propio desde `origin/main` (`git worktree add`), rama `seo-review/AAAA-MM-DD`, PR. Gabriel mergea y deploya a mano (`npm run deploy`, que corre typecheck, tests unitarios, build y `wrangler deploy`). Borrar el worktree tras el merge.
- El checkout principal está en otra rama con archivos sin trackear: no tocarlo. El código se lee desde `origin/main` (`git archive`).
- CI de GitHub en PR y main: typecheck, l10n, capa de DB, tests unitarios, build.
- Dónde vive lo SEO: `src/server/seo/` (`routes.ts` títulos y descriptions, `feeds.ts` sitemap/robots/archivo de clave IndexNow, `jsonld.ts`), `src/content/` (contenido editorial), `src/client/pages/`, `src/shared/spa-routes.ts` (un test exige actualizarlo al cambiar rutas), `src/shared/regions.ts` (config por dominio y claves IndexNow), redirecciones en `src/server/index.ts`.
- Datos de producción: nada de `--remote` ni migraciones de D1 sin OK explícito; nunca exportar la base. `EMPLEO_INDEXAR` controla si el portal de empleo se indexa.
- `landing-opetests/` es otro sitio (opetests.com): fuera de alcance.

## Reglas de contenido

- Todo contenido nuevo va en apruebatuope.com, nunca en opeosakidetza.com. Evitar canibalizar entre los dos dominios.
- Bug recurrente: el cliente redirige o pone noindex si una API falla durante el render de Google. Revisarlo en cada página nueva.
- Sin contenido de relleno; afirmaciones verificadas contra fuentes oficiales.

## Congelaciones y pausas

- Ninguna en ATP. Mudanza OSK → ATP: D = 15-dic-2026, go/no-go 13-nov (draft PR #127 con el 301 apagado, `OSK_FOLD_IN=false`).

## Estado del repo

- 2026-10-27: `main` en rojo desde la PR #132 (22-oct) por tests de D1 ajenos a SEO (`CHECK constraint failed: ok=1`). `npm run deploy` corre esos tests, así que **#132 está mergeada pero no desplegada** (sus 4 URLs nuevas dan 404). Una PR del ciclo sobre este `main` saldría en rojo.

## Experimentos abiertos

| Cambio | PR | Deploy | Revisar | Métrica y línea base |
| --- | --- | --- | --- | --- |
| Oposiciones SESCAM/SERMAS/SERGAS, pilar /sas, temario del Estado, calculadora del baremo SAS, práctica directa en bolsa-sas, SESPA con la consulta oficial primero | #132 | **no desplegada** (mergeada 22-oct) | al desplegar: post-deploy; luego 7 y 28 días | impresiones de las 4 URLs nuevas; embudo bolsa-sas → demo; CTR de SESPA |
| Guías de bolsas y del Estado al día, tráfico interno a cursos | #126 | 18-oct | 28 d = 15-nov | bolsa-sas 10 → 73 clics/sem (pos 11,3 → 6,8), SESPA 36 → 80 (pos 7,5 → 5,6) a 7 días, con pico de demanda |
| Títulos y descriptions de 9 guías de bolsas para el CTR de Bing | #94 | ~7-oct | 28 d = 4-nov (semana 24–30 oct) | tratado/control de CTR en Bing 0,72 → 0,68 → 1,23 (mezclado con #126). Control: sespa, sanidad-gva, ingesa, rioja, gobierno-vasco, cantabria — **no tocar esas guías antes de la lectura** |
| Ronda 6: fichas de test indexables, snippets, CTR | #95 | 7-oct | 28 d = 4-nov | fichas de Osakidetza en ATP 28 → 91 clics/sem; 85 fichas de Canarias en «Página con redirección» sin re-rastreo |
| Ronda 7: calendario laboral por territorio | #105 | 13-oct | 28 d = 10-nov | posición del calendario (12,6 el 23-oct) tras el pico de los calendarios 2027 |

## Revisiones agendadas

- Al desplegar #132: curl de las 4 URLs nuevas y de los títulos de /sas, /guias/bolsa-sas, /guias/bolsa-sespa y /estado/auxiliar-administrativo-estado; IndexNow; petición manual en GSC de las 4 nuevas; juez de guías. A los 7 días: CTR de SESPA y embudo bolsa-sas → demo.
- 3-nov: `inspect_urls` de las 4 guías de bolsas (si Gabriel pidió la indexación).
- 4-nov: #94 (Bing) y #95 (fichas de Canarias; si siguen sin rastreo, pedir las 3–5 con más impresiones). Con el resultado de #94, decidir el snippet de /guias/bolsa-trabajo-gobierno-vasco (ESPERAR desde 2026-10-27).
- 10-nov: #105. 15-nov: #126. 24-nov: guías indexadas que Google no muestra (sanidad-gva, ics, rioja-salud, principado-asturias, sermas).
- Antes de noviembre: páginas /festivos. ~nov: calendario 2027 con Open Data Euskadi.

## Línea base

- 21-oct (METRICAS-DIARIAS §8): Google 370 clics/semana; Bing 678 clics en 28 días.
- 2026-10-27 (semana 17–23 oct): Google 667 clics/semana; Bing 314/semana; Umami 3.027 visitas (20–26 oct).

## Backlog

- Justicia como próximo curso por demanda.
- Convocatorias duplicadas en el portal de empleo (mismo título o description con slug `-2`): higiene del import. Detectadas en la auditoría 3c1ae162.
- Indexación general: 682 de 1.212 URLs sin indexar (27-oct), indexadas en subida (488 → 530 desde el 21-oct). Vigilar la tendencia antes de actuar.
- Posible causa de Soft 404 en todo el codebase (también OSK): tras un deploy, un trozo de JS viejo da 404 y el `ErrorBoundary` reemplaza la página por «Algo salió mal». Arreglo invisible: recargar al fallar la carga de un chunk. Sin probar; después de la congelación de OSK.
- Marca del proyecto en OpenSEO escrita «Aprubeatuope»: corregirla antes de cualquier AI visibility.
- AI visibility: no hay tracker. Estimación 5 prompts × 3 motores: 0,212 $ por chequeo programado. Decisión de Gabriel.

## Descartado (no volver a proponer sin datos nuevos)

- 2026-10-27: CTR de /boletines/bog — intención navegacional al boletín oficial (la sede ocupa 1.º y 2.º, AI Overview).
- 2026-10-27: caída del calendario laboral (−20 clics 7/7) — demanda tras el pico de los calendarios 2027.

## Ruido propio del sitio

- Umami: un solo website compartido con opeosakidetza.com; filtrar siempre por hostname.
- Modo IA de Google: posiciones 1–3 sin clics (p. ej. `/tests/tcae`).

## Documentos

- En el repo (`origin/main`): `METRICAS-DIARIAS.md` (proceso diario y umbrales), `DAILY-AGENT-PLAYBOOK.md`, `docs/seo/auditoria-2026-09-23/`, `docs/seo/auditoria-2026-09-29/`, `docs/seo/ronda-6/`, `docs/seo/ronda-7/`, `docs/SEO-EMPLEO-BOLETINES.md`.
- Memorias: `~/.claude/projects/-home-gabriel-code-ope/memory/` (`ope-seo-plan`, `seo-ronda-oposiciones-oct22`, `mudanza-osk-atp`, `bloqueo-laliga-cloudflare`) y `opetests-*` en las memorias de open-seo.
