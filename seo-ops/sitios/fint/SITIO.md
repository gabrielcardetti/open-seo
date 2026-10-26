# fint.app

```yaml
openseo_project_id: 76466b9b-55b5-41fa-9347-2848e96222d0
dominio: fint.app
repo: /home/gabriel/code/fint/fint-admin
github: fintdevla/fint-admin
rama_base: main
estado: activo
puede_pr: true
pr_automatica: true
commit_requiere_ok: false
checks: "npm run type-check && npm run lint && npm run build"
idioma: "castellano argentino con voseo (\"Cobrá\")"
rank_tracker: { id: null, intervalo_dias: null, costo_aprox: null }
auditoria_referencia: { id: null, nota: "la última auditoría (d86f6ad9, 19-oct) fue sobre un preview y solo /facturacion-electronica; la primera corrida crea la de producción" }
```

## Cómo se cambia y se despliega

- PR a `main` y **nunca mergear** (ni ofrecerlo): mergear es deployar a producción.
- Vercel no deploya commits de `main` con autor gabrielcardetti: los commits de landings van con autor `fintdevla` (autorizado por el dueño).
- Worktrees en `/home/gabriel/code/fint/worktrees/<nombre>-admin`. No usar `git stash` (es compartido entre worktrees).
- El hook de Husky corre type-check y un `next build` completo en cada commit: los commits son lentos.
- Diffs mínimos ("mantengamos los cambios simples").
- Dónde vive lo SEO: el sitio de marketing está dentro de la app admin, en `app/(marketing)/`. `components/marketing/site.ts` es el registro único de nav, footer, sitemap y llms; `components/marketing/metadata.ts`, `structured-data.tsx`; `app/sitemap.ts` (dinámico, incluye eventos próximos); `app/robots.txt/route.ts`; redirecciones en `next.config.mjs`.
- **Las páginas de eventos** (`*.fint.app/eventos/...`), que traen la mayor parte del tráfico orgánico, están en otro repo: `fintdevla/fint-portal` (`/home/gabriel/code/fint/fint-portal`).

## Reglas de contenido

- No afirmar funciones que no existen (sin canal de WhatsApp, sin features sin lanzar): reglas en la memoria `fint-landings-decisiones`.
- No indexar el preview.

## Revisiones agendadas

- Semana del 11-nov: 28 días post contra 28 días pre, cortado por marca / sin marca / eventos / landings (`reports/seo-post-lanzamiento-2026-10-19/analisis.md`).

## Línea base

- GSC 29-sep a 12-oct (antes del deploy): 247 clics, 5.352 impresiones, casi todo marca y eventos de clientes.

## Backlog

- No hay clave de IndexNow configurada.
- Sin GA4 ni Umami conectados: falta medición de tráfico propio.
- Rank tracker y keywords sin crear.
- Guías de ARCA y herramientas gratis (calculadora de Mercado Pago, generador de recibos, calculadora de IVA): ~10× la demanda de las landings por rubro.
- Decisiones pendientes del dueño: Getnet, autor/revisor de la guía, noindex de organizadores sin eventos.

## Ruido propio del sitio

- Lighthouse: `Content-Signal` "Unknown directive" y "images-missing-dimensions" con `next/image` `fill` son falsos positivos.

## Documentos

- `/home/gabriel/code/fint/reports/seo-post-lanzamiento-2026-10-19/analisis.md`, `/home/gabriel/code/fint/landings-mejora/RETOMAR-CRECIMIENTO.md`, `landings-mejora/PLAN.md`, `MAPA.md` (fuera de git).
- Memorias de los repos de Fint: `feedback-no-mergear-prs`, `fint-vercel-deploy-author`, `fint-landings-decisiones`, `user-cambios-simples`, `fint-event-page-casino-canonical`.
