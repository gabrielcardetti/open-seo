# Aprendizajes del proceso

Lo que cada corrida enseña sobre el ciclo en sí (no sobre un sitio: eso va en su `SITIO.md`). Una línea por aprendizaje, con fecha. Si algo aparece dos veces, se propone el cambio a la skill o a `senales.md`.

## Antes del ciclo (revisiones a mano, sep–oct 2026)

- 2026-10: la mayoría de las "caídas" que se vieron eran fin de semana o el último día parcial de GSC/Bing. De ahí las ventanas cerradas en D-4 y alineadas por día de la semana.
- 2026-10: lo que más problemas reales destapó fue el monitor de indexación agrupado por plantilla, los avisos de Bing (descriptions duplicadas, CTR bajo en posiciones 6–9) y los avisos de datos estructurados de GSC.
- 2026-10: dos veces un cliente redirigió o puso noindex cuando una API falló durante el render de Google (OPE). Revisarlo en cada página nueva.
- 2026-10: se perdieron cambios por mezclar código local sin deployar con producción → leer siempre `origin/main`.
- 2026-10: un agente mergeó PRs sin permiso (Fint) → el ciclo nunca mergea.
- 2026-10: el loop diario de Search Console murió en silencio (token de una app OAuth en Testing). Todo pasa ahora por OpenSEO; si una corrida no puede leer datos, tiene que decirlo, no seguir con datos viejos.
- 2026-10-25: durante partidos de LaLiga, desde casa no se llega a las IPs de Cloudflare (OpenSEO, el relay de Bing/IndexNow, el state store de Alchemy). Chequear conectividad antes de empezar.
