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
auditoria_referencia: { id: 0682f8ed-80d1-4257-bc1c-bbdd461f58b3, fecha: 2026-10-02, maxPages: 4000, includePaths: [], excludePaths: ["/bopv/2008", "/bopv/2009", "/bopv/2010", "/bopv/2011", "/bopv/2012", "/bopv/2013", "/bopv/2014", "/bopv/2015", "/bopv/2016", "/bopv/2017", "/bopv/2018", "/bopv/2019", "/bopv/2020", "/bopv/2021", "/bopv/2022", "/bopv/2023", "/bopv/2024", "/bopv/2025", "/bopv/calendario/2023", "/bopv/calendario/2024"], engines: [google] }
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

- 2026-10-26: `main` con el paso "Unit tests" fallando desde la PR #132 (22-oct). `npm run deploy` también falla. Una PR del ciclo sobre este `main` saldría en rojo: avisar a Gabriel.

## Experimentos abiertos

| Cambio | PR | Deploy | Revisar | Métrica y línea base |
| --- | --- | --- | --- | --- |
| Oposiciones SESCAM/SERMAS/SERGAS, pilar /sas, temario del Estado, calculadora del baremo SAS | #132 | mergeada 22-oct; deploy sin confirmar (main en rojo) | confirmar deploy; luego 7 y 28 días | impresiones y clics de las URLs nuevas; post-deploy (IndexNow, lista GSC, juez) sin evidencia de hecho |
| Títulos y descriptions para CTR de Bing en guías de bolsas | #94 | ~7-oct | ya pasó 2 semanas | CTR de Bing en esas URLs (antes 0,4–1,5 % en posiciones 6–9) |

## Revisiones agendadas

- 28-oct: hipótesis pendientes de METRICAS-DIARIAS — 4 guías de bolsas fuera de Google; bolsa-sas 8 clics → 0 tests; CTR de SESPA.
- Antes de noviembre: páginas /festivos.
- ~nov: calendario 2027 con Open Data Euskadi.

## Línea base

- 21-oct (METRICAS-DIARIAS §8): Google 370 clics/semana; Bing 678 clics en 28 días.

## Backlog

- Justicia como próximo curso por demanda.
- Medir el efecto de la PR #94 en Bing.

## Ruido propio del sitio

- Umami: un solo website compartido con opeosakidetza.com; filtrar siempre por hostname.
- Modo IA de Google: posiciones 1–3 sin clics (p. ej. `/tests/tcae`).

## Documentos

- En el repo (`origin/main`): `METRICAS-DIARIAS.md` (proceso diario y umbrales), `DAILY-AGENT-PLAYBOOK.md`, `docs/seo/auditoria-2026-09-23/`, `docs/seo/auditoria-2026-09-29/`, `docs/seo/ronda-6/`, `docs/seo/ronda-7/`, `docs/SEO-EMPLEO-BOLETINES.md`.
- Memorias: `~/.claude/projects/-home-gabriel-code-ope/memory/` (`ope-seo-plan`, `seo-ronda-oposiciones-oct22`, `mudanza-osk-atp`, `bloqueo-laliga-cloudflare`) y `opetests-*` en las memorias de open-seo.
