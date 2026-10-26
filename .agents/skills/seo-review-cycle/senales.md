# Señales y ruido

Doctrina para decidir si un número merece diagnóstico. Sale de las revisiones que ya se hicieron a mano (métricas diarias de OPE, el loop de Search Console de septiembre, las revisiones de Fint, Convertix, Max y Selectividad). Si una corrida demuestra que un umbral está mal, corregilo acá y anotalo en `seo-ops/APRENDIZAJES.md`.

## Ventanas

- Search Console: terminá las ventanas en **D-4** con datos finales (`dataState: "final"` cuando la herramienta lo permita). Los datos frescos infra-cuentan y nunca disparan una alerta por sí solos.
- Compará **periodos completos e iguales**: 7 días contra los 7 anteriores, 28 contra 28, alineados por día de la semana. Un fin de semana contra días hábiles parece una caída.
- No compares contra un pico estacional (p. ej. junio o el arranque de temporada de septiembre). Si hay estacionalidad conocida, usá además la misma ventana del año pasado cuando exista.
- Bing: su historia diaria la guarda OpenSEO; `get_bing_overview` ya trae el periodo anterior. Tiene días de retraso: los últimos 2–3 días no cuentan.

## Umbrales para abrir diagnóstico

| Señal | Umbral |
| --- | --- |
| Tráfico de un día | ≥30 % **y** ≥20 visitas frente al mismo día de la semana anterior |
| Caída de una página o grupo en Google | ≥20 % y ≥20 clics (7 contra 7), o ≥50 clics (28 contra 28) |
| Caída sostenida del sitio | último día >40 % abajo de su línea base de día de semana, o 3 días seguidos >25 % abajo |
| Pérdida de posición | query o página del top 10 que pierde >3 posiciones de forma sostenida (dos observaciones) |
| Candidata de CTR | ≥300 impresiones/semana o ≥1.000/mes, posición 3–15, CTR <1 % o caída de CTR ≥30 % |
| Embudo | −10 puntos con ≥100 visitantes de entrada |
| Página nueva sin indexar | sin rastrear o indexar a 7–14 días del deploy → proponer pedido manual en GSC |
| Canibalización | ~100 impresiones de la misma intención repartidas entre páginas en 28 días, en dos observaciones |
| Indexación | URL **con clics en los últimos 7 días** cuyo estado deja de ser indexada; crecimiento de URLs plegadas por canonical |
| Sitemap | errores, o sin lectura de Google en >10 días |
| Subida | >60 % también se reporta, como oportunidad a reforzar |
| Campaña o diseño | nada se juzga con menos de 30 personas por paso |

## Ruido conocido (no dispara nada)

- **Fin de semana y último día parcial** de GSC o Bing: casi todas las "caídas" repentinas que se vieron fueron esto.
- **Septiembre** (arranque de temporada en OPE y Selectividad): suben las impresiones y baja el CTR. Posición ponderada que baja con impresiones arriba y clics estables es mezcla de consultas, no un aviso.
- **Queries de ≤6 impresiones/día:** sus cambios de posición son ruido.
- **Propiedades residuales** (p. ej. la vieja propiedad de opetests) que salen en −100 % todos los días.
- **Modo IA de Google:** posiciones 1–3 sin clics no son un problema de snippet.
- **Rank tracker:** posición nula puede ser "fuera del top" **o** un fallo del proveedor; confirmá con `get_serp_results` antes de reportar una caída.
- **Umami:** el desglose por canal no trae "directo" ni suma el total; el rebote puede pasar del 100 %; `auth_completed` no es un alta (mirá `is_new_user`).
- **Lighthouse:** `Content-Signal` "Unknown directive" (Google lo ignora), "images-missing-dimensions" con `next/image` `fill`, SEO bajo en previews con noindex.
- **"Excluida por noindex" con 0 clics:** es una decisión del sitio salvo que la URL tuviera clics.
- **Canonical cruzado entre dominios en mudanza** (OSK → ATP): que se plieguen URLs es lo esperado; lo que se vigila es que el tráfico migre y no se evapore.

## Causas que ya aparecieron (buscalas primero)

- **Cliente que redirige o pone noindex cuando falla una API durante el render de Google.** Pasó dos veces en OPE (fichas de tests "con redirección", convocatorias "excluidas por noindex"). Revisalo en toda página nueva que dependa de una API.
- **robots.txt bloqueando una ruta de API** que el render necesita.
- **Página sin SSR ni canonical:** Google eligió como canónica una URL de otro dominio (Fint).
- **Caída con impresiones estables y posición perdida = competencia de formato** (en la SERP aparecieron calculadoras o herramientas), no penalización: la respuesta es igualar el formato, no reescribir texto.
- **Descriptions duplicadas en variantes filtradas** de un listado (Bing lo marca primero).
- **Avisos de datos estructurados** en GSC (campos faltantes en Dataset, Event).
- **Problemas fuera del sitio:** dominio viejo secuestrado, ficha de Google Maps con errores, backlinks de spam. Se reportan; no se arreglan con una PR.

## Lo que ya se descartó (no volver a proponer sin datos nuevos)

- Ampliar FAQPage (el rich result de FAQ está muerto), `llms.txt` para Google, SearchAction.
- Páginas comparativas contra competidores con poco volumen; landings por rubro con 80–190 visitas/mes estimadas cuando hay guías con 10× más demanda.
- Páginas de afirmaciones sin verificar (títulos tipo "resueltos 2020–2026" que el contenido no cumple).

## Horizontes de medición

- Cambios de title/description/CTR: revisar a 7 y 28 días; para Bing, 2 semanas antes y después.
- Páginas nuevas: indexación a 7–14 días; impresiones a 2 semanas y 1 mes; sin impresiones a los 3 meses → consolidar o noindex.
- Mudanzas y consolidaciones grandes: 3–6 meses.
- Un experimento por página a la vez; como mucho 3 decisiones por sitio por corrida.

## Cuotas y presupuesto

- Pedido manual de indexación en GSC: ~10 URL por día y propiedad, repartidas en días; no repetir URLs ya pedidas; para errores corregidos, "Validar corrección".
- API de envío de Bing: 100 URL/día y 1.300/mes; el resto por IndexNow.
- Rank tracker: semanal como mucho (ATP ~513 créditos por chequeo, Selectividad ~760).
- DataForSEO: preguntar antes de pasar de 2.000 créditos en una corrida; anotar `whoami` al principio y al final.
- `get_keyword_metrics` da timeout con más de ~20 keywords por llamada: partí en tandas.
