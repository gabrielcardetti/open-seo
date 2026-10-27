# B · Demanda nueva para apruebatuope.com (27-oct-2026)

Objetivo: búsquedas de España (2724/es) que ATP aún no captura y que podría ganar con páginas nuevas que lleven a su producto. Solo lectura: no se guardaron keywords ni se tocó el contexto del proyecto ni el repo.

## Resumen

| # | Página candidata | Demanda (vol/mes) | SERP | ¿Existe? | Producto al que lleva |
| --- | --- | --- | --- | --- | --- |
| 1 | `/guias/oposiciones-sespa` | oposiciones sespa 1.300 (KD 10), sespa 2025 1.000, ope sespa 480, ope sespa 2026 390, oposiciones sespa 2026 390; pico 4.400 en nov-25 | **Ganable**: sin portal oficial en el top 10 (prensa, MAD, sindicatos, Facebook, academias) | No (sí `/guias/bolsa-sespa`, la 2.ª guía con más clics) | Hubs `/tests/<categoría>` con exámenes de otros servicios |
| 2 | `/guias/oposiciones-sms` | oposiciones sms 5.400 (KD 0), sms oposiciones 2.400, oposiciones servicio murciano de salud 1.900, ope sms 880, sms 2026 590; pico 12.100–22.200 en dic-ene | **Ganable**: oficial 1.º, AI Overview, luego academias, SATSE, prensa y Facebook | No (sí `/guias/bolsa-sms-murcia`) | Hubs `/tests/<categoría>` |
| 3 | `/guias/oposiciones-ses` | oposiciones ses 1.900, ope ses 1.900 (mismo cubo), ses 2026 210; pico 2.900 en ene–mar | **Ganable**: el 1.º oficial es la página de la centralita; prensa y academias detrás | No (sí `/guias/bolsa-ses-extremadura`) | Hubs `/tests/<categoría>` |
| 4 | Tests por ley con preguntas oficiales (Constitución, Ley 39/2015, TREBEP, Estatuto Marco…) | ≈17.000 en total, KD 0 (detalle en §4) | **Ganable el formato**, pero hay mucha competencia: está fragmentado entre quizzes y PDFs, sin ningún dominio fuerte | No | **Falta producto**: filtrar el banco por ley en todos los cursos |
| 5 | Exámenes oficiales resueltos por convocatoria (Estado Aux 2024/2025, SAS Celador y TCAE 2025) | examen auxiliar administrativo del estado 1.600 (KD 13), examen aux. estado 2024 140, 2025 110; test celador sas 210, examen celador sas 2025 140, examen tcae sas 2025 90 | **Medio**: inap.es, MAD, redopositor y gokoan con «examen resuelto»; ATP no aparece | Hubs `/estado/*`, `/sas/*`; no hay una página por examen | Exacto: el examen oficial con clave y explicación |
| 6 | `/guias/oposiciones-sacyl` | sacyl 480 + sacyl oposiciones 480 + ope sacyl 390 + 2026 260+260; celador, aux. adm. y administrativo sacyl 390 c/u | **Difícil**: saludcastillayleon.es ocupa 9 de 17 | No (sí `/guias/bolsa-sacyl`) | Hubs `/tests/<categoría>` |
| 7 | `/guias/oposiciones-ib-salut` | 1.600 (KD 23; «ibsalut» es el mismo cubo); pico 3.600–5.400 en nov-dic | **Navegacional**: ibsalut.es ocupa 11 de 17 | No (sí `/guias/bolsa-ib-salut`) | Hubs `/tests/<categoría>` |

Calendario: SESPA tuvo el pico en noviembre, IB-Salut en noviembre y diciembre, SMS en diciembre y enero, y SES de enero a marzo. Las guías 1 y 2 tienen que estar publicadas e indexadas antes de diciembre.

**Restricción del experimento #94.** `bolsa-sespa`, `bolsa-ingesa`, `bolsa-rioja-salud`, `bolsa-scs-cantabria`, `bolsa-sanidad-gva` y la guía del Gobierno Vasco son el grupo de control hasta la lectura del 4-nov. Las guías nuevas pueden enlazar a ellas. Lo que no se puede, hasta después del 4-nov, es editar esas seis guías para añadir el enlace de vuelta.

## Fuentes y reutilización

- Se reutilizan, sin volver a comprarlos:
  - El censo de demanda del 13-oct (`~/orca/workspaces/opetests/expansion-hub/expansion/censo-2026-10/demanda/*.json`): 1.115 keywords con volumen, KD, intención y tendencia mensual. Incluye la investigación de las semillas oposiciones sas, tcae, enfermería, celador y auxiliar administrativo.
  - El log del 14-oct, con las SERP de «test celador gratis» y «examen auxiliar administrativo estado».
  - El log del 21-oct, con las cabeceras de SESCAM, Osakidetza, Justicia y Correos y la SERP de «test sanidad».
- Compras nuevas: 160 keywords en 8 lotes de métricas, 3 semillas de research y 27 SERP a profundidad 20.
- Search Console de ATP (28 días hasta el 24-oct, gratis): **ninguna** consulta «oposiciones <servicio>» fuera de Canarias, UPV/EHU y Osakidetza. Ninguna consulta con «test» llega a 5 impresiones, salvo anatomía patológica. ATP no aparece en ninguna de las 27 SERP.
- Las variantes cercanas comparten volumen: «oposiciones ses» y «ope ses», o «oposiciones ib-salut» e «ibsalut», salen de un mismo cubo de Google Ads. No hay que sumarlas.

## 1. Servicios de salud sin guía «oposiciones <servicio>»

Ya existen en ATP SESCAM, SERMAS y SERGAS (familia `src/content/nacional/oposiciones/`, desplegada hoy), `/sas` (pilar «Oposiciones SAS 2026»), `/canarias` (hub del SCS con fechas, plazas, temario…) y `/osakidetza`. Las guías nuevas repetirían la receta de SERMAS: «práctica de la categoría con exámenes de otros servicios». Así se evita prometer exámenes del servicio que ATP no tiene.

| Servicio | Keywords (vol · KD · intención) | Fuente | SERP (top 20, desktop) | Veredicto |
| --- | --- | --- | --- | --- |
| **SESPA** | oposiciones sespa 1.300 · 10 · inf; oposiciones sespa 2025 1.000 · 0; ope sespa 480 · 28 · nav; ope sespa 2026 390 · 1; oposiciones sespa 2026 390 · 1; auxiliar administrativo sespa 880 · 0; oposiciones celador sespa 140 · 0; tcae sespa 90 | 13-oct + hoy | AI Overview. 1 lavozdeasturias (prensa), 2 saludasturias.mad.es, 3 opobusca, 4 usipa (sindicato), 5 Facebook, 6–7 sicepa, 8 campustraining, 9 oposicionesia, después csisanidad (blog), opositaformacion, Facebook, scribd, vence (test), ondacero, testsanidad, forpe. **Sin astursalud en el top 17.** «auxiliar administrativo sespa»: MAD, usipa, campustraining, laboralia (test), forpe, vence, agorastur | **Ganable** (el mejor del cluster) |
| **SMS (Murcia)** | oposiciones sms 5.400 · 0; sms oposiciones 2.400 · 0; oposiciones servicio murciano de salud 1.900 · 10; oposiciones murcia 1.900 · 0 (genérica); ope sms 880 · 5; oposiciones sms 2026 590 · 0; oposiciones sms 2025 320 · 9; oposiciones enfermeria murcia 480 · 0; oposiciones sms murcia 170 · 2; listado admitidos sms 210 · nav; ope sms 2026 50 | 13-oct + hoy + research | 1 sms.carm.es, AI Overview, 2 alcformacion, 3 sede.carm.es, 4 laverdad (convocatoria de 1.500 plazas, dic-25), 5 SATSE, 6 murciasalud, 7 MAD, 8 redopositor, 9 Facebook, 10 gmoposiciones, youtube, MAD, laopinion, sps-rm, oponova, opomurciasalud (tests SMS) | **Ganable** a partir del 2.º puesto, con el mayor volumen |
| **SES (Extremadura)** | oposiciones ses 1.900 · 0; ope ses 1.900 · 0 · nav; oposiciones ses 2026 210; oposiciones ses extremadura 70; celador ses 170; test celador ses 170; aux. adm. ses 140; test tcae ses 140 | 13-oct + hoy | 1 saludextremadura.ses.es (**centralita de contacto**), AI Overview, PAA, 2 elperiodicoextremadura, 3 hoy.es, 4 formacion-sanidad, 5 aulacem, 6 Facebook, 7 cumlaude, 8 portalparados, 9 tutoriales del SES, después comeca, Facebook UGT, acadex, masterd, MAD, opobusca | **Ganable** |
| SACYL | oposiciones sacyl 480 · 4; sacyl oposiciones 480 · 4; ope sacyl 390 · nav; ope sacyl 2026 260 · 0; oposiciones sacyl 2026 260 · 0; celador sacyl 390; aux. adm. sacyl 390; administrativo sacyl 390 · nav; oposiciones enfermeria sacyl 260; oposiciones celador sacyl 170 | 13-oct + hoy | AI Overview. saludcastillayleon.es en 1, 2, 4, 5, 8, 9, 11, 12 y 14; oposicionesia, enfermeriasalamanca, sacyl.mad.es, veropo, mundopositor, youtube | **Difícil**: el portal oficial lo copa |
| IB-Salut | oposiciones ib-salut 1.600 · 23; oposiciones ibsalut 1.600 · 2 (mismo cubo); ope ibsalut 110 · 21; 2026 110; ope ib-salut sin dato | 13-oct + hoy | AI Overview. ibsalut.es en 11 de los 17 orgánicos, infermeriabalear, mundopositor, davantesanidad | **Navegacional** |
| Osasunbidea | oposiciones osasunbidea 210 · 14; ope osasunbidea 140 · 14; oposiciones salud navarra 50; oposiciones navarra 1.600 · 37 (genérica, Gobierno de Navarra) | 13-oct + hoy | empleosalud.navarra.es, colegio de enfermería de Burgos, okdiario, typedai, opobusca, SATSE, foro, laboralia | Ganable, pero con poco volumen |
| SCS Cantabria | oposiciones servicio cantabro de salud 210 · 9; ope scs cantabria 70 · nav; oposiciones cantabria 720 (genérica); sanidad cantabria 10 | 13-oct + hoy | 1 mundopositor, scsalud (procesos), MAD, 3catorce, preparaoposiciones, laboralia | Ganable, pero con poco volumen |
| Ingesa | ope ingesa 210; ope ingesa 2026 70; oposiciones ingesa melilla 50; «oposiciones ingesa» sin dato | 13-oct + hoy | ingesa.sanidad.gob.es, Facebook, SATSE Ceuta, sindicatotecnos, mundopositor. Según el snippet de coemel.es, la convocatoria de Enfermería de la OPE 2026 salió en el BOE del 5-oct-2026 | Ganable, pero con muy poco volumen |
| GVA sanidad | san gva oposiciones 320 · 5; oposiciones gva sanidad 140 · 0; ope gva sanidad 70 · nav; oposiciones enfermeria gva 170 | 13-oct + research | 1 grupo de Facebook, san.gva.es, gokoan, adams, blog de opositatest, campustraining, mundopositor | Ganable, pero con poco volumen. Cuidado: los cursos GVA de ATP son de la Generalitat (administración), no de sanidad |
| ICS | oposicions ics 320; oposiciones ics 2026 210; oposicions ics 2026 170; oposiciones ics 90 | 13-oct + hoy | SERP en catalán: gencat (convocatòries, talics), oposics.cat, adams, forumformat, COIB | **Navegacional y en catalán**: descartar |
| Rioja Salud, Salud Aragón | rioja salud 40 + ope 40 · 13; sanidad la rioja 10; «oposiciones salud aragon» sin volumen (13-oct y hoy) | hoy | (sin SERP) | Descartar |
| «<servicio> oposiciones fechas» | sms, sas, sergas y sescam fechas: 10 cada una; sacyl, ses, sespa e ib-salut: sin dato | hoy | (sin SERP) | Sin demanda propia: la fecha cabe como sección de cada guía |

## 2. Categoría × servicio (donde ATP tiene tests)

| Keyword | Vol · KD · intención | ¿Página ATP? | SERP / nota |
| --- | --- | --- | --- |
| test auxiliar de enfermeria | 2.900 · 0 (13-oct) | `/tests/tcae` | escueladelaoposicion, destilify, auxiliar-enfermeria.com (×8), testdesanidad (SAS y SESCAM TCAE), opositatest, somossanitarios. ATP ausente. **Es un problema de una página que ya existe, no demanda nueva** |
| test tcae | 1.900 · 0 (13-oct) | `/tests/tcae` | Igual que la anterior |
| test celador / gratis / de celador / online | 880 / 880 / 590 / **320** · 0 | `/tests/celador` | 14-oct: testdesanidad y opositatest. «test celador online» es nueva (320). Sin impresiones en GSC |
| test celador sas | **210** · 0 · inf | `/sas/celador` | gokoan (exámenes oficiales en PDF), celadoresonline, inafe («Celador SAS 2022: examen, respuestas y tests»), testdesanidad (¡SERGAS!), blog de opositatest, testsanidad, temasytest, destilify, youtube «Examen Oficial Celador SAS 2025». **Ganable con una página por examen** |
| examen celador sas 2025 | **140** · 0 | `/sas/celador` | Cuadernillos y plantillas del SAS en 1 y 2, AI Overview, nota de prensa de la plantilla, MAD, youtube, redopositor «examen resuelto», opositatest, vence, gokoan, testdesanidad. **Ganable** como «examen resuelto con explicación» |
| examen tcae sas 2025 | **90** · 0 | `/sas/tcae` | (sin SERP) Mismo formato |
| test celador scs | **140** · 0 | `/canarias/tests/celador` | studocu, MAD, laboralia, opesalud, scribd, vence, testonlineope, testsconstitucionblog, testdesanidad. **ATP tiene la página exacta y no sale**: está ligado a #95 (85 fichas de Canarias en «Página con redirección») |
| oposiciones celador sas 2026 | 480 · 0 (13-oct) | `/sas/celador` | Página existente |
| oposiciones tcae sas 2026 | **210** · 0 · comercial, CPC 2,78 | `/sas/tcae` | Página existente |
| oposiciones celador servicio canario de salud 2026 | 480 (13-oct) | `/canarias/celador` | Página existente |
| oposiciones enfermeria sescam / sermas / murcia / sergas / sacyl | 480 / 480 / 480 / 210 / 260 (13-oct) | Guías SESCAM y SERMAS (hoy) | «enfermeria sescam»: grupocto, sanidad.castillalamancha, DOCM, academias, on-enfermeria, Facebook, colegio de Burgos. **Mejor como sección** de cada guía de servicio que como página aparte |
| oposiciones enfermeria osakidetza | **390** · 3 | OSK / `/osakidetza/proceso/enfermeria` | Página existente |
| auxiliar administrativo sermas | 880 · 0 (13-oct); oposiciones aux. adm. sermas 2025 480; 2026 210 | Guía SERMAS (hoy) | 1 opositatest (test gratis), preparaoposiciones (guía), comunidad.madrid, grafton, sede, orion, Facebook, temariosenpdf, adams, masterd, vence. **Ganable a medias**: sin producto SERMAS, solo `/tests/auxiliar-administrativo` |
| auxiliar administrativo sespa | 880 · 0 (13-oct) | No | Ver SESPA. Sección de la futura guía SESPA |
| oposiciones celador sespa / celador canarias | **140** / **110** · 0 | No / `/canarias/celador` | Sección |
| test tcae online, test celador canarias, test tcae canarias, test aux. adm. gva, examen administrativo sas, examen aux. adm. gva | 50 / 10 / 10 / 10 / 40 / 30 | | Residuales |
| Sin volumen | | | test tcae scs, test enfermeria scs, test administrativo gva, examen celador sas resuelto, examenes sas resueltos, examenes oficiales sas, plantilla examen tcae sas, examen celador/tcae scs, examenes scs/gva resueltos, examen celador/tcae resuelto, oposiciones enfermeria sms/sespa/2026, preguntas examen tcae |

Conclusión: la demanda «categoría × servicio» es de cientos al mes y casi siempre cae en páginas que ATP ya tiene (`/sas/*`, `/canarias/*`, `/tests/*`). El problema es de posicionamiento e indexación de esas páginas, no de páginas nuevas. La única forma nueva con encaje claro es **una página por examen oficial** («Examen Celador SAS 2025 resuelto»). Es lo que usan redopositor, gokoan e inafe, y ATP tiene ese mismo contenido con clave y explicación.

## 3. Estado / AGE

| Keyword | Vol · KD · intención | ¿Página ATP? | SERP / veredicto |
| --- | --- | --- | --- |
| auxiliar administrativo del estado | 5.400 (21-oct) | `/estado/auxiliar-administrativo-estado` | Existe |
| auxiliar administrativo estado | **2.400** · 9 | ídem | Existe (variante) |
| temario auxiliar administrativo estado | **2.900** · 0 · competencia alta | `/estado/temario-auxiliar-administrativo` | Existe. 21-oct: academias y tiendas |
| examen auxiliar administrativo del estado | **1.600** · 13 | Ninguna página «exámenes» | 14-oct: inap.es y mad.es. **Candidata**: «Exámenes oficiales de Auxiliar Administrativo del Estado 2008–2024», con los 6 exámenes del INAP del curso. Ya hay un precedente en `/canarias-administracion/examenes-anteriores-auxiliar-administrativo` |
| examen aux. adm. estado 2024 / 2025 | **140** · 0 / **110** · 2 | | Misma página o una por año |
| test auxiliar administrativo estado / del estado | 260 (13-oct) / **210** · 0 | `/estado/*` | Página existente |
| cuando es el examen de auxiliar administrativo del estado | **110** · 0 | `/estado/auxiliar-administrativo-estado` | FAQ |
| psicotecnico auxiliar administrativo estado | **110** · 0 · transaccional | Tema de psicotécnicos en el temario | Existe un enlace a la práctica |
| plantilla examen aux. adm. estado / nota de corte 2025 / ofimática | 30 / 10 / 20 | `/estado/despues-del-examen` | Residual |
| **oposiciones administrativo del estado** (C1) | **8.100** · 26 · CPC 3,14 | No | AI Overview. 1 MAD, 2 gokoan, 3 blog de opositatest, administracion.gob.es, MAD (test PDF), formacion.ninja, youtube, flou, administraciondejusticia, supera, esfera, josenrique. **Difícil**: academias fuertes |
| administrativo del estado / administrativo estado | **6.600** · 26 / **6.600** · 27 | No | Mismo cubo |
| oposiciones administrativo del estado 2026 | **1.300** · 5 | No | Página nueva |
| temario administrativo del estado | **2.400** · 0 · competencia alta | No | skr, adams, opoinnova, josenrique, repasandosinpapeles, redopositor, innotest, BOE, oposicionesgratis, modocheto: **SERP de tiendas de temario**, difícil |
| examen administrativo (del) estado | 590 · 0 / **480** · 0 | No | (sin SERP) |
| sueldo administrativo del estado | **590** · 0 | No | (sin SERP) |
| test administrativo del estado | **170** · 0 | No | Página nueva |

Veredicto C1: **no es página hoy**. ATP no tiene curso de Administrativo del Estado y la regla de contenido prohíbe prometer exámenes que no tiene. Es una **señal de curso futuro**: unas 15.000 búsquedas de cabecera al mes. El INAP publica los exámenes, con un temario compartido en gran parte con el C2 (bloque I).

## 4. Hallazgo: tests por ley (cluster nuevo)

| Keyword | Vol · KD | Fuente |
| --- | --- | --- |
| test constitucion española | 6.600 · 0 | 14-oct / research |
| test ley 39/2015 | **4.400** · 0 | hoy |
| test constitucion | **1.600** · 0 | hoy |
| test ley 40/2015 | **1.000** · 0 | hoy |
| test trebep | **880** · 0 | hoy |
| test ley 39 | 480 · 0 | research |
| test constitucion española gratis / gratis constitución | **320** / 320 · 0 | hoy / research |
| test constitucion española por titulos · test ley 39/2015 por titulos | 320 · 260 | research |
| test ley 39 2015 exámenes oficiales pdf | 320 · 0 | research (intención «oficial», encaje directo) |
| test ley general de sanidad | **260** · 0 | hoy |
| test estatuto marco · test ley 3/2007 | **210** · **210** | hoy |
| test proteccion de datos · test ley 19/2013 · test ley 39/2015 gratis · test ley 31/1995 · test ley 55/2003 | 140 · 110 · 90 · 70 · 50 | hoy |
| test de ley | 8.100 · 0 | research: **marca** (testdeley.com, app «Test de Leyes»). No se cuenta |

SERP:

- «test constitucion española»: josenrique, entrenatests, el quiz de elmundo, opositatest, oposito, flou, un PDF de academia, scribd, youtube, testdeley y mjusticia (examen oficial en PDF).
- «test ley 39/2015»: youtube, oposito, PDF, testdeley ×4, linceopositor, daypo ×4, scribd y la tienda de Rodio.
- «test trebep»: preparandalus, youtube, MAD, examinatest, linceopositor, josenrique, daypo y testdeley.
- «test estatuto marco»: youtube, temasytest, testdeley, auxiliar-enfermeria, linceopositor, opomarket, scribd, celadoresonline ×4 y **testdesanidad.es (pregunta oficial TCAE SAS 2015)**.
- «test ley general de sanidad»: preparaoposiciones, leyesdeoposiciones, scribd, **opositatest «exámenes oficiales de Sanidad · Legislación»**, testparaopos, daypo ×6 y **testdesanidad.es/test/sas/comun/ley-general-sanidad/recopilatorio**.

Veredicto: hay unas **17.000 búsquedas al mes, con KD 0**, y SERP fragmentadas de quizzes, PDFs y daypo, sin un dominio que mande. testdesanidad y opositatest ya rankean con recopilatorios de preguntas oficiales por ley, lo que prueba que el formato funciona. Diferencial de ATP: preguntas oficiales de varios cuerpos (Estado, SAS, GVA, Osakidetza, Canarias), cada una con su artículo del BOE.

**Producto**: hoy no existe un filtro por ley que cruce cursos. El curso del Estado filtra por tema, pero hay pocas preguntas: I.1 Constitución tiene 10 e I.11 Procedimiento, 23. Hacen falta etiquetado y un hub, no solo una página. Un buen primer paso para la audiencia de sanidad: Constitución, Ley 39/2015, Estatuto Marco y Ley General de Sanidad.

## 5. Justicia y Correos (sin producto: señales de curso futuro)

| Keyword | Vol · KD | Fuente |
| --- | --- | --- |
| auxilio judicial | 9.900 · 0 | 21-oct (re-medida hoy, igual) |
| oposiciones auxilio judicial | 4.400 · 15 (pico 9.900 en ene) | 13-oct |
| tramitacion procesal · gestion procesal | 3.600 · 1 · **2.400** · 1 | 21-oct · hoy |
| temario auxilio judicial · temario tramitacion procesal | **2.400** · 0 · **1.300** · 0 (competencia alta) | hoy |
| oposiciones tramitacion procesal · justicia · gestion procesal | 1.900 · 1.900 · 1.600 | 13-oct |
| auxilio judicial sueldo · oposiciones justicia 2026 | **1.000** · 0 · **1.000** · 10 | hoy |
| oposiciones auxilio judicial 2026 · examen auxilio judicial · examen auxilio judicial 2025 | **720** · **390** · **320** | hoy |
| examen tramitacion procesal · test auxilio judicial · test auxilio judicial gratis · plazas 2026 | **260** · 210 (13-oct) · **110** · **110** | hoy / 13-oct |
| oposiciones correos 2026 · test correos | 6.600 · 0 · 390 · 0 | 21-oct / hoy |

SERP:

- «auxilio judicial»: mjusticia.gob.es en 1 y 2, CEF, administraciondejusticia, ruthgalvan, MAD, supera, opositer, adams. **Difícil.**
- «examen auxilio judicial»: youtube, bazan, eficienciayoposicion (examen de sep-2024), supera, startlaj, cejusticia, vence, opositajusticia, el examen oficial de 2024 en opositatest y el blog de la plantilla. **Medio**, con intención de examen oficial.

Un curso de Justicia con los exámenes oficiales del Ministerio encajaría en el modelo de ATP. Hoy no hay página posible.

## Gasto (DataForSEO, self-hosted)

| # | Llamada | Detalle | Coste USD |
| --- | --- | --- | --- |
| 1 | whoami | inicio: 34,573491 | 0 |
| 2 | get_keyword_metrics | 20 kw de servicios, lote 1 | ≈0,013 (estimado; la diferencia de whoami fue 0,164 con otro agente gastando a la vez) |
| 3 | get_keyword_metrics | 20 kw de servicios, lote 2 | 0,0133 (medido) |
| 4–9 | get_keyword_metrics ×6 | categoría×servicio ×2, Estado ×2, legislación ×1, Justicia/otros ×1 | 0,0985 en bloque (≈0,016 por llamada) |
| 10 | research_keywords | 3 semillas: test constitucion española, test ley 39/2015, oposiciones sms (150 c/u) | 0,138 |
| 11–12 | get_serp_results ×2 | 20 SERP, profundidad 20 | 0,1087 (medido) |
| 13 | get_serp_results | 7 SERP (osasunbidea, cantabro, ingesa, gva sanidad, test aux. enfermería, examen celador sas 2025, test LGS) | ≈0,038 (estimado; whoami marcó 0,100 con gasto en paralelo) |
| — | get_search_console_performance ×2, get_project_context, whoami ×7 | | 0 |
| | **Total propio (estimado)** | | **≈0,41** |
| | Diferencia de whoami | 34,573491 → 33,950703 | 0,6228 (incluye unos 0,21 de otro agente en paralelo) |

Re-compra por descuido: 4 keywords del 21-oct (auxilio judicial, tramitacion procesal, oposiciones correos 2026, oposiciones auxiliar administrativo) entraron en el lote de Justicia. Costaron menos de 0,001 $ y salieron con los mismos valores.

## Notas

- Los volúmenes son medias de 12 meses de Google Ads y muy estacionales: SMS va de 1.300 a 22.200 según el mes. Hay que leerlos con la tendencia de §1.
- «ope ses», «oposiciones ses» y similares son un solo cubo: no se suman.
- Las SERP son de desktop. El rank tracker es de móvil.
- Datos crudos de esta corrida (efímeros): `/tmp/atpB/` (prior.json, research.json, serp1-3.json).
