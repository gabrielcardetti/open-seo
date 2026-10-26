# convertixapp.com

```yaml
openseo_project_id: 35392677-c903-4b9c-a145-7b2c76686e79
dominio: www.convertixapp.com
repo: /home/gabriel/code/ayudante/convertix-front
github: Ginoleg/convertix
rama_base: main
estado: activo
puede_pr: true
pr_automatica: false
commit_requiere_ok: true
checks: "pnpm build"
idioma: "español neutro con tuteo, en positivo, sin jerga técnica"
rank_tracker: { id: null, intervalo_dias: null, costo_aprox: null }
auditoria_referencia: { id: 80ab35cb-55da-4211-88f1-14611e476a6a, fecha: 2026-10-20, maxPages: 60, includePaths: [], excludePaths: ["/page", "/link", "/login", "/signup", "/forgot-password", "/join", "/verify-email", "/project", "/projects", "/account"], engines: [google] }
```

## Cómo se cambia y se despliega

- Primero se discute; rama, y commit y push **solo después de un "confirmo/dale" de Gabriel**: el ciclo deja la rama lista y pide el OK en el resumen. Después PR a `main`; Vercel deploya al mergear.
- Dependencias nuevas: actualizar `pnpm-lock.yaml` a mano o el build de Vercel falla (`ERR_PNPM_OUTDATED_LOCKFILE`).
- El checkout principal tiene cambios sin commitear (`package.json`, `bun.lock`, `tsconfig.json`, `.gitignore`): no tocarlo. Nunca commitear `tsconfig.json`.
- Dónde vive lo SEO: `app/(site)/` (home, `/precios`, `/lineas/[slug]`, `/whatsapp-api`, `/generador-link-whatsapp`…), `lib/site.ts` (registro con title, description y `updated`; canonical `https://www.convertixapp.com`), `app/sitemap.ts`, `app/llms.txt/route.ts`, `app/md/` (versiones markdown para agentes vía `middleware.ts`), `public/robots.txt`, headers de noindex en `next.config.js`.

## Reglas de contenido

- Nada de casino ni apuestas. Nunca nombrar ni enlazar a Max.
- Las ~2.000 landings de clientes (`/page/*`, `/link/*`) son noindex y tienen que seguir así.

## Revisiones agendadas

- ~3-nov y ~20-nov: repetir los 3 prompts GEO de la línea base (0/9).

## Línea base

- Auditoría 80ab35cb (20-oct): 15 páginas indexables, SEO 100, agent readiness 8/8. Sitemap enviado a GSC y Bing.

## Backlog

- Pedir indexación a mano en GSC (~10/día, por demanda).
- PR de rendimiento/LCP (en espera).
- Redirección del apex 307 → 308.
- Rank tracker sin crear. Sin clave de IndexNow. Sin GA4 ni Umami conectados.

## Documentos

- `/home/gabriel/code/ayudante/convertix-seo/` (fuera de git): `RESUMEN.md`, `producto.md` (hechos verificados del producto), `dudas.md`, `revision-r3.md`, `cambios-landing.md`.
- Memorias: `convertix-workflow`, `convertix-seo-initiative`.
