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

## 2026-10-27 — primera corrida (solo OPE, plan sin PR)

- `compare_audits` muestra como «introducidos» los issues de reglas nuevas del auditor (p. ej. `structured-data-retired-type`, agregada a OpenSEO el 6-oct): antes de tratar un issue nuevo como regresión, mirar cuándo entró la regla (`git log -S<regla>` en open-seo).
- Una PR mergeada no es una PR desplegada: #132 estaba mergeada pero no en producción (main en rojo bloquea `npm run deploy`). Verificar con `curl` que un cambio está vivo antes de medirlo o de darlo por experimento abierto. Si se repite, pasarlo a la skill (fase 0.5).
- La ventana de 28 días no aplica a una página con menos días de datos: el «28 d» de la guía del Gobierno Vasco eran 12 (primera impresión el 12-oct). Mirar la primera impresión antes de usar la ventana larga.
- Los experimentos con grupo de control (#94) también bloquean las páginas de control: anotarlas en el `SITIO.md` para no tocarlas antes de la lectura.
- El revisor adversarial tumbó 1 de 3 GO y le cambió las condiciones a los otros 2: vale el costo.
- `inspect_urls` y el monitor de indexación no coinciden para URLs nunca rastreadas («Discovered» contra «URL is unknown», y cambian entre llamadas): lo fiable es la ausencia de `lastCrawlTime`.
- Las fichas necesitaban secciones «Decisiones pendientes de Gabriel» y «Descartado» (para que la corrida siguiente no vuelva a proponer lo ya rechazado): agregadas a la plantilla.
- Los cambios del propio auditor también se ven como regresiones: la auditoría del 2-oct no guardaba la profundidad de las páginas sembradas desde el sitemap y la de hoy sí (+1.880 `deep-page`). Segunda vez en la misma corrida (con la regla de tipos retirados): **propuesta para la skill** — en la fase 1 (auditoría ligera), antes de leer `issues.new`, filtrar los tipos de issue cuyo «antes» es 0 en todas las plantillas y comprobar si es una regla o medición nueva.
- La auditoría de ATP llegó al tope de `maxPages` (3.996 de 4.000) porque el sitio crece ~50 páginas por semana: subir el tope con margen y comparar siempre por `issues.common`.

