# apruebatuselectividad.com

```yaml
openseo_project_id: bde2082e-098d-4402-bf3d-5e36d5074280
dominio: apruebatuselectividad.com
repo: /home/gabriel/code/ope/apruebatuselectividad
github: ApruebaTuOPE/selectividad
rama_base: main
estado: pausado
puede_pr: true
pr_automatica: false
commit_requiere_ok: true
checks: "pnpm build && pnpm check && pnpm check:ui && pnpm test:integration (Node 24)"
idioma: "castellano de España; catalán en /ca/selectivitat"
rank_tracker: { id: 46e5a7ec-f22f-41a5-a270-c5b88b6c0b51, intervalo_dias: 7, costo_aprox: 760, keywords: 38, dispositivo: mobile }
auditoria_referencia: { id: a9ac701c-5daf-4f93-aff2-8602ebd5263a, fecha: 2026-10-19, maxPages: 400, includePaths: [], excludePaths: [], engines: [google] }
```

## Congelaciones y pausas

- **En pausa desde el 21-oct** ("parar hasta nuevo aviso"). Gabriel mira el tráfico a mano y rechazó un loop de pulso diario (20-oct). En el ciclo: **solo informe**, sin plan ni PR, hasta que la ficha cambie a `activo`.

## Cómo se cambia y se despliega

- Worktree por rama en `/home/gabriel/code/ope/apruebatuselectividad-wt/<rama>`. Desde el 20-oct todo va por PR (con revisión adversarial de GPT). No hay CI en GitHub: los checks se corren en local con Node 24.
- Deploy manual (`bash .alchemy/desplegar.sh`: migraciones, contenido, Worker) y solo después de un "merge y deploy" explícito de Gabriel.
- Contenido servido desde D1: el JSON de `content/` lo cargan importadores; llega a producción como SQL en `.alchemy/contenido-remoto/`. Plantillas en `src/public/*.tsx` y `src/server/controllers/public/`; `src/seo.ts` (robots, sitemap, llms); redirecciones en `src/worker.ts`.
- Post-deploy: `node scripts/seo-check.mjs https://apruebatuselectividad.com --indexable --lanzamiento` y luego IndexNow (`node scripts/indexnow.mjs --enviar`; la clave da 403 el primer minuto tras publicarla).
- D1 rechaza sentencias de más de 100 KB. `grep` es un alias de ugrep: usar `/usr/bin/grep`.

## Revisiones agendadas

- 27-oct (día 7): primer chequeo del rank tracker (~760 créditos; está en manual y nunca se lanzó).
- 3-nov (día 14): segundo chequeo.
- 15-nov: punto de control — ≥150 URL indexadas y ≥20 clics/día.

## Línea base

- En producción desde el 19-oct; 590 URL canónicas enviadas por IndexNow; el 21-oct se sumaron el catalán y el archivo (608 URL). 20-oct: 268 impresiones y 14 clics en GSC.

## Backlog

- "Validar corrección" del aviso de licencia del Dataset en GSC.

## Documentos

- `handoff.md`, `plan/medicion-lanzamiento.md` (bitácora de medición), `plan/encargos/S-seo-aeo-geo.md`, `plan/encargos/T-trafico.md`, `research/seo/estrategia-lanzamiento-2026-09.md`, `research/2026-10/dataforseo/`.
- Memoria: `~/.claude/projects/-home-gabriel-code-ope/memory/apruebatuselectividad-fundador.md`.
