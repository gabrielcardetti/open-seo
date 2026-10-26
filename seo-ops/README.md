# seo-ops

Historia del ciclo de revisión SEO de los sitios que sigue este OpenSEO (open-seo.cafecafe.dev). Lo escribe la skill `seo-review-cycle` (`.agents/skills/seo-review-cycle/`); se lee al empezar cada corrida para comparar contra la anterior.

Solo del fork: nada de esto va a upstream.

## Cómo se corre

- **A mano:** en este repo, `/seo-review-cycle`. Pregunta qué sitios y qué pasos opcionales (auditoría completa, competidores, keywords nuevas, rank tracker, AI visibility) y si termina en informe, plan o PR.
- **En loop:** `/seo-review-cycle auto` (por ejemplo desde Loopany cada 2–3 días). No pregunta: usa `config.yaml`, y solo abre PR en los sitios con `pr_automatica: true`.

Requisitos: el MCP `openseo` logueado en la sesión (`/mcp`), `gh` autenticado, y que open-seo.cafecafe.dev responda (durante partidos de LaLiga puede estar bloqueado desde casa).

## Qué hay

- `config.yaml`: opciones por defecto de una corrida.
- `APRENDIZAJES.md`: lo que cada corrida enseñó sobre el proceso. Si algo se repite, se cambia la skill.
- `corridas/AAAA-MM-DD.md`: resumen de cada corrida (todos los sitios).
- `sitios/<slug>/SITIO.md`: ficha del sitio — repo, reglas de PR, idioma, congelaciones, experimentos abiertos, revisiones agendadas, backlog. Se actualiza en cada corrida.
- `sitios/<slug>/corridas/AAAA-MM-DD.md`: log del sitio en esa corrida — métricas contra la anterior, señales, candidatos con su validación, PR y pendientes.

## Sitios

| Slug | Dominio | Repo | Notas |
| --- | --- | --- | --- |
| apruebatuope | apruebatuope.com | gabrielcardetti/opetests | comparte repo y PR con opeosakidetza |
| opeosakidetza | opeosakidetza.com | gabrielcardetti/opetests | se va fundiendo en apruebatuope |
| apruebatuselectividad | apruebatuselectividad.com | ApruebaTuOPE/selectividad | en pausa |
| maxagente | maxagente.com | Ginoleg/Max | commit solo con OK |
| fint | fint.app | fintdevla/fint-admin | nunca mergear; autor fintdevla |
| convertix | convertixapp.com | Ginoleg/convertix | commit solo con OK |
| indiezurriola | indiezurriola.com | solo en la MacBook | sin PR desde este servidor |
