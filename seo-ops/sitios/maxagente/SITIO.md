# maxagente.com

```yaml
openseo_project_id: ef4f7b21-22b4-417f-a89e-068c29c7e104
dominio: maxagente.com
repo: /home/gabriel/code/Max
github: Ginoleg/Max
rama_base: main
estado: activo
puede_pr: true
pr_automatica: false
commit_requiere_ok: true
checks: "bun test && npm run lint && npm run build"
idioma: "español latinoamericano neutro, tuteo, en positivo; reglas del sitio en el contexto del proyecto de OpenSEO"
rank_tracker: { id: null, intervalo_dias: null, costo_aprox: null }
auditoria_referencia: { id: null, nota: "la última auditoría (1b9c1805, 14-oct) fue sobre el preview max.antonanton.dev; la primera corrida crea la de producción" }
```

## Cómo se cambia y se despliega

- Nunca push a `main`: rama y PR; Gabriel mergea y Vercel deploya `main`.
- **No commitear hasta que Gabriel revise en local**: el ciclo deja la rama lista con los cambios y pide el OK en el resumen. Un solo PR al final.
- Cada página nueva pasa el juez de guías de OpenSEO antes de la PR.
- El checkout principal está en otra rama: no tocarlo. Sin CI en GitHub.
- Dónde vive lo SEO: `app/(marketing)/<slug>/page.tsx` (cada página exporta su `metadata`), `app/_marketing/site-pages.ts` (registro que alimenta sitemap, `llms.txt`, hubs y footer), `lib/site.ts`, `app/sitemap.ts`, `app/robots.txt/route.ts`, `app/llms.txt/route.ts`, redirecciones en `next.config.js`. Clave IndexNow: `public/50e65af7cd52516952bcb41a4620b021.txt`.

## Trabajo en curso de Gabriel (no pisar)

- PR #13 `seo/tecnico-y-registro-mcp` (SEO técnico, OG, registro MCP) abierta desde el 14-oct.
- Worktree `/home/gabriel/code/Max-seo-oct` (rama `seo/mejoras-octubre`) con 21 archivos sin commitear.

## Reglas de contenido

- Las comparativas no le hacen publicidad a la competencia. Páginas sin demanda se fusionan (Cal.com/Calendly → /turnos).

## Diagnóstico vigente (13-oct)

- Todo el tráfico es de marca, los dos únicos backlinks son spam y no aparece en respuestas de IA: **autoridad antes que más páginas**. No proponer páginas nuevas sin demanda medida.

## Revisiones agendadas

- Cuando se deploye #13: publicar el registro MCP.

## Backlog

- 6 directorios enviados el 14-oct, esperando aprobación.
- 5 URLs para pedir indexación (13-oct).

## Documentos

- Memorias en `~/.claude/projects/` del repo Max (`max-siempre-por-pr`, `commits-despues-de-revision`, `seo-contenido-calidad`). Sin docs SEO en el repo.
