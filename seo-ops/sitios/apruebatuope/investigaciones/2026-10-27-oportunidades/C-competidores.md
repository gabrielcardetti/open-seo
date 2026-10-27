# C. Competidores: qué posicionan ellos y ApruebaTuOPE no

Fecha: 2026-10-27. Mercado: España (2724), español. Proyecto OpenSEO `af3759c8-ef5d-42e1-bbf5-6f988ac7cd0b`. Solo lectura: no se guardó nada en OpenSEO ni se tocó ningún repo.

## Resumen

El hueco grande no está en las bolsas (ahí ATP ya compite de tú a tú) sino en **formatos de práctica** que ATP no publica como página indexable, aunque tiene la materia prima (preguntas oficiales con clave, explicación y cita al BOE):

1. **Test por ley con preguntas de examen oficial**: unas 13.500 búsquedas/mes con KD 0 (test Constitución 6.600, test Ley 39/2015 4.400, Ley 40/2015 1.000, TREBEP 880, Ley General de Sanidad 260, Estatuto Marco 210). opositatest es 1.º o 2.º en la Constitución; testdesanidad.es sale 5.º en la Ley General de Sanidad con una página de pregunta. ATP: 0 impresiones. Las SERP están llenas de YouTube, Scribd, PDF y daypo, así que es lo más fácil de ganar.
2. **Hub paraguas «Test de sanidad»**: test sanidad / tests sanidad 3.600, test de sanidad 2.900, tests oposiciones gratis 1.000, exámenes oposiciones 480. testdesanidad.es (portada) y opositatest (/test-gratis) son 1.º. ATP no tiene índice `/tests` (devuelve 404) y su portada se titula «Tests de oposiciones con preguntas oficiales».
3. **Calculadora de nota del examen** (aciertos, fallos, anuladas, penalización): calculadora ope sas 390, calculadora ope sas 2025 260, calculadora sas 210, calculadora nota oposiciones 880, calculadora nota examen tipo test 320 (≈2.000/mes). testdesanidad.es /calculadora es 7.º, MAD 2.º y sindicatos 1.º, 3.º y 4.º. ATP tiene calculadoras de baremo, pero no de nota: está en la posición 59 para «calculadora ope sas 2025».
4. **Examen oficial por año, resuelto**: es cola larga (70–210 por consulta), pero ATP ya tiene impresiones en las posiciones 7–10 sin una página dedicada («examen tcae sas 2025» pos. 7, «examenes sas auxiliar administrativo» 8, «cuadernillo examen ope sas tcae» 10,5). testdesanidad.es es 1.º en «supuestos prácticos auxiliar enfermería resueltos», y Google pone el PDF oficial de INGESA 2.º en «test tcae».
5. **Una página por pregunta oficial**: testdesanidad.es tiene 70 de sus 206 keywords del top 10 en URLs `/test/<servicio>/<categoría>/<examen>/pregunta/<n>`. El title es el enunciado y la description, la respuesta. Ranquean conceptos sueltos (livor mortis 1.000, decúbito lateral izquierdo 880, RD 208/1996 880, Ley 13/2007 880). Es volátil (con «conato de emergencia» ya no está en el top 10 del 27-oct) y supone un riesgo de indexación para ATP.

Lo que más demanda mueve (test auxiliar de enfermería 2.900, test tcae 1.900, test de celador con respuestas 1.000, test celador 880) **no es un hueco de formato**: ATP ya tiene /tests/tcae y /tests/celador, con la misma estructura que la competencia, pero está entre la posición 30 y la 80. Es un problema de autoridad y antigüedad, no de páginas.

## Competidores elegidos y por qué

Con `find_serp_competitors` sobre 24 consultas núcleo de ATP (tests de sanidad, bolsas, SAS/SESCAM/Osakidetza, Estado), solo orgánico:

| Dominio | Top 10 en las 24 consultas | ETV del set | Modelo | Elegido |
| --- | --- | --- | --- | --- |
| testdesanidad.es | 7 (test sanidad 1, test enfermería 1, test celador 1, test tcae 2, test osakidetza 2, test aux. enfermería 3, test administrativo 3) | 3.155 | Tests oficiales gratis por servicio y categoría, sin explicaciones | Sí |
| opositatest.com (www + blog) | 8 (test auxiliar administrativo 1, test oposiciones 1, test administrativo 1, oposiciones celador 2, test sanidad 6…) | 257 + 492 (blog) | Academia con test y exámenes oficiales gratis en /test-gratis y blog de guías | Sí |
| auxiliar-enfermeria.com | 4 (test tcae 1, test auxiliar de enfermería 1, test enfermería 6, test sanidad 10) | 3.082 | Biblioteca antigua de tests numerados de TCAE y celador, dossiers | Sí |
| mad.es | 9 (temario aux. adm. Estado 1, examen aux. adm. Estado 3, test sanidad 5, test oposiciones 5…) | 225 | Academia que vende temario | No: ya está en los logs del 14 y del 21-oct, y su modelo es temario, no tests oficiales |
| preparaoposiciones.com | 5 en Labs; 1.º en vivo en «test celador» | 899 | Tests gratis por temas en su blog | No (sin presupuesto para más), pero vigilarlo: ver «Publicado hace poco» |
| osasuntest.es | 0 en las 24 | – | Tests de Osakidetza | **Descartado con datos**: solo 15 keywords en el top 10, casi todas de marca («osasuntest» 4.400, con pico de 33.100 en junio por el examen de Osakidetza). Su nicho es el de opeosakidetza.com, no el de ATP |

En las bolsas no hay ninguna guía fuerte que repita: fuera de los portales oficiales, el top 10 de bolsa sas, sespa, sanidad gva, sms y sescam lo ocupan Play Store, YouTube, Facebook, Instagram, expertosandyou (9), laboraliaformacion (10) y formacionalcala (7). ATP ya está en las posiciones 5–7 en sus guías de bolsas. No hay ningún competidor de bolsas que analizar.

## Estado de ATP en estos temas

- **Search Console** (24-jul → 24-oct), consultas con «test»: 70 consultas, 3 clics. Las cabezas están lejos: test auxiliar de enfermería pos. 36, test tcae sas 30, test enfermería 72–80, test scs 30, test celador scs 72, test sas celador 79, test auxiliar administrativo osakidetza 37. Con «ley»: nada de tests de leyes. Con «calcula»: «calculadora ope sas 2025» pos. 59 (1 impresión).
- **DataForSEO Labs** (apruebatuope.com, 178 keywords en total, se leyeron las 100 de más volumen): ninguna consulta de test en el top 20. Lo que posiciona son festivos, calendario, BOPV y Canarias.
- La comparación es con ATP. Muchas consultas de Osakidetza las puede estar cubriendo opeosakidetza.com, que no se miró: hay que comprobarlo antes de crear nada de Osakidetza en ATP (mudanza el 15-dic).

## Tabla de huecos

Posición del competidor: Labs (datos de agosto y septiembre) salvo cuando dice «SERP 27-oct» (escritorio, en vivo). ATP: posición media en GSC a 3 meses; «–» = sin impresiones. Volúmenes: Google Ads da la misma cifra a variantes con y sin tilde o en plural, así que no se suman.

| Keyword | Vol./mes | Competidor: URL (posición) | ATP | Formato |
| --- | --- | --- | --- | --- |
| test constitución española | 6.600 | opositatest.com/oposiciones/constitucion-espanola/test (1); SERP 27-oct: josenrique.es 1, opositatest 2, oposito, testdeley | – | Test por ley |
| test ley 39/2015 | 4.400 | SERP 27-oct: YouTube 1, oposito.es 2, Scribd 3, testdeley 5, linceopositor 6, daypo 8 (ninguno de los 3 elegidos) | – | Test por ley |
| test ley 40/2015 | 1.000 | sin SERP | – | Test por ley |
| test trebep | 880 | SERP 27-oct: YouTube, oposito, Scribd, testdeley, mad.es (blog) 5, opocademy 6 («24 preguntas reales de exámenes oficiales») | – | Test por ley |
| test (de la) ley general de sanidad | 260–320 | testdesanidad.es/test/sas/comun/ley-general-sanidad/recopilatorio-volumen-1 (3–5); SERP 27-oct: pregunta/17 del vol. 2 en 5.º; auxiliar-enfermeria.com/test/test_5015ot.htm (8–10) | – | Test por ley |
| test estatuto marco / estatuto marco 55/2003 | 210 / 110 | testdesanidad.es/test/sas/comun/estatuto-marco/… (5–6) | – | Test por ley |
| test sanidad / tests sanidad | 3.600 | testdesanidad.es/ (1); opositatest.com/test-gratis/sanidad-auxiliares-enfermeria (3); auxiliar-enfermeria.com (5) | – | Hub paraguas |
| test de sanidad | 2.900 | testdesanidad.es/ (1); opositatest /test-gratis/sanidad-celadores (7); auxiliar-enfermeria.com/test_indice.htm (8) | – | Hub paraguas |
| tests oposiciones gratis | 1.000 | opositatest.com/test-gratis (1) | – | Hub paraguas |
| examenes oposiciones / oposiciones examenes | 480 | opositatest.com/test-gratis (1) | – | Hub paraguas |
| calculadora nota oposiciones | 880 | SERP 27-oct: bazanoposiciones 1, administraciondejusticia 3, euroinnova 8 («calculadora notas tipo test») | – | Calculadora de nota |
| calculadora ope sas | 390–480 | testdesanidad.es/calculadora (7); SERP 27-oct: CSIF 1, sas.mad.es 2, UGT 3, CCOO 4, testdesanidad 7 | 59 (variante 2025) | Calculadora de nota |
| calculadora ope sas 2025 | 260 | testdesanidad.es/calculadora (5) | 59 | Calculadora de nota |
| calculadora nota examen tipo test | 320 | sin SERP | – | Calculadora de nota |
| supuestos prácticos auxiliar enfermería resueltos | 90 | testdesanidad.es/test/sas/TCAE/tcae-oep-2022-turno-libre/supuesto-practico/… (1) | – | Examen oficial por año |
| examen tcae sas 2025 | 90 | testdesanidad.es/tests/sas/tcae (5) | 7 | Examen oficial por año |
| examen celador sas 2025 | 140 | sin SERP | – | Examen oficial por año |
| examen auxiliar administrativo sas | 90 | testdesanidad.es/tests/sas/auxiliar-administrativo (7) | 8–10 | Examen oficial por año |
| examen auxiliar administrativo estado resuelto | 170 | 14-oct: inap.es y mad.es arriba | 76–89 (variantes 2024) | Examen oficial por año |
| test tcae con respuestas pdf | 210 | testdesanidad.es/tests/sas/tcae (5) | – | Examen oficial por año |
| livor mortis | 1.000 | testdesanidad.es/test/scs/celador/test-oposicion-celador-2011/…/pregunta/2 (5) | – | Página por pregunta |
| decúbito lateral izquierdo | 880 | testdesanidad.es/test/sas/TCAE/tcae-oep-2022-turno-libre/parte-1/pregunta/49 (2) | – | Página por pregunta |
| rd 208/1996 | 880 | testdesanidad.es/test/salud/administrativo/…/pregunta/40 (2) | – | Página por pregunta |
| ley 13 2007 | 880 | testdesanidad.es/test/sas/celador/celador-2023-centros-sas/…/pregunta/9 (5) | – | Página por pregunta |
| conato de emergencia | 720 | testdesanidad.es/…/celador-2017-turno-libre/…/pregunta/41 (6); **SERP 27-oct: fuera del top 10** (AI Overview, PDF universitarios) | – | Página por pregunta |
| test de auxiliar de enfermería por temas | 260 | auxiliar-enfermeria.com/test_semanales6.htm (4); destilify.com: title «Test TCAE gratis por temas · +1.500» | – | Test por temas |
| test tcae por temas | 140 | (destilify, preparaoposiciones lo usan en el title) | 59 (variante «sas por temas gratis») | Test por temas |
| simulacro examen tcae / simulacros examen celador gratis | 170 / 110 | opositatest /test-gratis/sanidad-celadores (2); testdesanidad /tests/sergas/celador (5) | – | Simulacro |
| test tcae sergas (gratis) | 260–320 | testdesanidad.es/tests/sergas/tcae (1) | – | Test de un servicio sin banco en ATP |
| test celador sescam (gratis) | 170–210 | testdesanidad.es/tests/sescam/celador (1) | – | Test de un servicio sin banco en ATP |
| test celador sespa gratis | 260 | auxiliar-enfermeria.com/test/test_3205c.htm (1) | – | Test de un servicio sin banco en ATP |
| examenes sescam | 210 | testdesanidad.es/tests/sescam/enfermeria (7); SERP 27-oct: cuestionarios oficiales en PDF del SESCAM en 2.º y 8.º | – | Test de un servicio sin banco en ATP |

Páginas que ATP ya tiene pero que no ranquean (no son un formato nuevo; las pongo como referencia):

| Keyword | Vol./mes | Quién gana | ATP |
| --- | --- | --- | --- |
| test auxiliar de enfermería | 2.900 | Labs: auxiliar-enfermeria.com 1, testdesanidad 3. SERP 27-oct: escueladelaoposicion 1, destilify 2, opositatest 3, testdesanidad /tests/sas/tcae 4 | /tests/tcae, pos. 36 |
| test tcae | 1.900 | Labs: auxiliar-enfermeria 1, testdesanidad 2. SERP 27-oct: Play Store 1, PDF oficial de INGESA 2, testsanidad.com 3, formantia («Examen Oficial SAS 2021») 4 | – (test tcae sas: 30) |
| test de celador con respuestas | 1.000 | testdesanidad.es/tests/sms/celador (3) | – |
| test celador | 880 | Labs: testdesanidad 1. SERP 27-oct: preparaoposiciones /blog/test-gratis/celador/ 1, opesalud 2, temasytest 3, testsanidad.com 4, testdesanidad scs 5 y avs 7 | – (test sas celador: 79) |

## Formatos que ATP no tiene

| Formato | Demanda aprox. | Encaje con ATP | Riesgo o condición |
| --- | --- | --- | --- |
| **Test por ley con preguntas de examen oficial** (Constitución, Ley 39/2015, Ley 40/2015, TREBEP, LGS, Estatuto Marco, Igualdad, PRL) | ≈13.500/mes, KD 0 | Alto. Las preguntas ya citan el artículo (`question_references` con URL al BOE). El ángulo que nadie tiene: «preguntas que han caído en exámenes oficiales sobre esta ley, con el artículo enlazado» (opocademy lo intenta con el TREBEP y 24 preguntas) | Hay que contar cuántas preguntas por ley tiene el banco antes de prometer nada. La Constitución y las leyes 39 y 40 salen del curso del Estado C2; la LGS y el Estatuto Marco, del temario común de SAS y Osakidetza |
| **Hub paraguas de test** (`/tests` o «Test de sanidad gratis» con todas las categorías y servicios) | ≈8.000/mes (test sanidad 3.600 + test de sanidad 2.900 + tests oposiciones gratis 1.000 + exámenes oposiciones 480) | Alto. Hoy `/tests` da 404 y los hubs /tests/<categoría> quedan sueltos | Lo ganan dominios con años de antigüedad; sin enlaces externos va a costar. Lo más fácil es convertirlo en la página que reparte el enlazado interno |
| **Calculadora de nota del examen** (aciertos, fallos, anuladas, penalización y comparación con el corte oficial) | ≈2.000/mes, con picos en fechas de examen | Alto. ATP conoce la fórmula de cada examen y el corte oficial; competidores y sindicatos solo dan la fórmula | Encaja dentro de /guias/penalizan-las-respuestas-mal-en-una-oposicion o del pilar /sas. No confundirla con el baremo (ya existe) |
| **Examen oficial por año, resuelto** («Examen TCAE SAS 2025 resuelto», «Examen auxiliar administrativo del Estado 2025 con plantilla») | ≈900/mes repartidos, intención muy alta | Muy alto: es el activo central de ATP. Ya existe un caso: /canarias-administracion/examenes-anteriores-auxiliar-administrativo, que tiene clics | Una página por examen que de verdad esté en el banco (regla de no prometer exámenes que no hay) |
| **Página por pregunta oficial** (title = enunciado, description = respuesta; ATP añadiría la explicación y la cita) | ≈15–20k/mes de cola larga muy repartida (ninguna consulta pasa de 1.000) | Medio. Mejor que la de testdesanidad (allí el contenido carga por AJAX y no hay explicación visible) | Alto: ATP tiene 682 de 1.212 URLs sin indexar. Solo como piloto pequeño (las preguntas con explicación y bibliografía de un examen) y midiendo la indexación antes de escalar. Es volátil |
| Test por temas | ≈400/mes | Medio (existe la taxonomía `topics`) | Poca demanda; mejor como secciones dentro de los hubs que como URLs nuevas |
| Landing de «simulacro de examen» | ≈350/mes | El producto ya tiene el examen cronometrado | Poca demanda; vale más como H2 o enlace en los hubs |
| Tests de servicios sin banco en ATP (SESCAM, SES/SESPA, SERGAS, SACYL, SMS, SERMAS) | ≈5.200/mes | Depende del producto: hacen falta los cuestionarios oficiales (el SESCAM los publica en PDF) | No es una página SEO: es una decisión de curso. Las guías de oposiciones SESCAM, SERMAS y SERGAS salieron hoy (#132) y serían su puerta de entrada |

Formatos con poco o ningún encaje, para no volver a proponerlos sin datos nuevos:

- Esquemas descargables de opositatest (esquema Constitución 1.600, instituciones de la UE 1.900): hace falta un temario propio y ATP no tiene ese modelo.
- Listados de «mejores foros» del blog de opositatest (foro oposiciones justicia 18.100, junta de andalucía 14.800, guardia civil 9.900…): todos fuera de sanidad, y no son el producto.
- «Probabilidad temas oposiciones» 1.600: es el sorteo de temas de las oposiciones docentes; el 27-oct opositatest ya no está en el top 10. No es para exámenes tipo test.
- Dossiers clínicos y glosario de auxiliar-enfermeria.com (efectos secundarios del Sintrom 880): fuera del producto.
- Oposiciones sin curso en ATP que opositatest posiciona (Administrativo del Estado C1 8.100, Auxilio Judicial 9.900, Tramitación Procesal 3.600, Aux. Adm. Comunidad de Madrid 12.100): dependen de abrir curso (Justicia ya está en el backlog).

## Lo que no es hueco

- Bolsas: «bolsa abierta y permanente sacyl» (12.100) la tiene opositatest 5.º con su blog y ATP está a la par en pos. 6,5 (455 impresiones, 0 clics en 3 meses, así que si acaso es un problema de CTR, no de página). «bolsa sacyl» (6.600): opositatest 4.º, ATP 17,6.
- «oposiciones sescam 2026» (2.900): opositatest 9.º con un listado genérico. ATP publicó hoy /guias/oposiciones-sescam: esperar.

## Publicado hace poco por la competencia

- **preparaoposiciones.com**: `/blog/test-gratis/celador/` y `/blog/test-gratis/sanidad/` (dateModified 2026-09-15). El 27-oct es 1.º en «test celador» y 8.º en «test ley general de sanidad». El formato: «Elige tu servicio de salud» (SAS, SERMAS, Osakidetza), test por temas, 200 preguntas por bloque sin registro, respuestas explicadas, «artículos y preceptos que más aparecen» y preguntas de ejemplo. Es el que más se parece a la promesa de ATP (explicaciones) y está subiendo.
- **testdesanidad.es**: Labs marca como nuevas en el top 10 96 de sus 200 filas. Abre servicios nuevos (/tests/sms/tcae, /tests/sms/celador, /tests/sacyl/tcae, /sistema-sermas), publica las baterías de Osakidetza 2026 (bateria-preguntas-tcae-2026, bateria-preguntas-celador-2026, «batería de preguntas osakidetza 2026» 6.º) y recopilatorios por ley (LGS, vol. 2, de abril de 2026). También tiene páginas de pregunta del MIR.
- **opositatest.com**: /test-gratis/sanidad-celadores y /test-gratis/sanidad-auxiliares-enfermeria aparecen como nuevas para «test sanidad» (6.º) y «tests sanidad» (3.º).
- **osasuntest.es**: nuevas /osakidetza/celador/ y /osakidetza/administrativo/ (búsquedas «kaixo»), y un post «cómo es el examen de la OPE de Osakidetza». Es terreno de opeosakidetza.com.
- **destilify.com**: no aparecía en los logs anteriores. Es 2.º en vivo en «test auxiliar de enfermería» con una ficha por oposición: «107 preguntas, penaliza, 90 min», test por temas «+1.500 con respuestas», y luego muro de pago de 14,95 €.

## Límites de los datos

- Las posiciones de Labs son de agosto y septiembre de 2026, y en las cabezas el SERP del 27-oct ya es distinto (testdesanidad y auxiliar-enfermeria han salido del top 10 de «test tcae» en escritorio). Las decisiones de formato se apoyan en los SERP en vivo cuando los hay.
- De testdesanidad.es se leyeron 200 de 206 keywords del top 10 (faltan 6 de ≤70 búsquedas). De opositatest.com, las 100 de más volumen de 2.539 más las 39 de /test-gratis. De auxiliar-enfermeria.com, 100 de 129. De osasuntest.es, 15 de 15.
- Los formatos de la competencia se vieron en la página (title y encabezados con curl), no se dedujeron de las keywords. Que la Constitución y las leyes 39/40 tengan preguntas suficientes en el banco de ATP es una inferencia por el temario del Estado C2: no se ha contado.
- No se miró opeosakidetza.com.

## Gasto

Ninguna herramienta devolvió el coste de cada llamada. Las estimaciones salen de las tarifas públicas de DataForSEO (Labs: 0,01 $ por tarea + 0,0001 $ por fila; SERP en vivo: unos 0,002–0,0025 $ por keyword a profundidad 10).

| # | Llamada | Detalle | Estimado (USD) |
| --- | --- | --- | --- |
| 1 | find_serp_competitors | 24 keywords, 41 dominios | 0,014 |
| 2 | get_ranked_keywords | testdesanidad.es, top 10, 100 filas | 0,020 |
| 3 | get_ranked_keywords | testdesanidad.es, offset 100, 100 filas | 0,020 |
| 4 | get_ranked_keywords | osasuntest.es, top 10, 15 filas | 0,012 |
| 5 | get_ranked_keywords | apruebatuope.com, 100 filas | 0,020 |
| 6 | get_ranked_keywords | opositatest.com, top 10 sin marca, 100 filas | 0,020 |
| 7 | get_ranked_keywords | auxiliar-enfermeria.com, top 10, 100 filas | 0,020 |
| 8 | get_keyword_metrics | 54 keywords de formato | 0,015 |
| 9 | get_serp_results | 6 keywords, profundidad 10 | 0,015 |
| 10 | get_serp_results | 6 keywords, profundidad 10 | 0,015 |
| 11 | get_ranked_keywords | opositatest.com/test-gratis (subfolder), 39 filas | 0,014 |
| 12 | get_ranked_keywords | fallo de validación (target con www), sin coste | 0 |
| – | get_project_context, whoami ×5, Search Console ×5 | gratis | 0 |
| | **Total estimado** | | **≈0,19** |

Control con whoami (saldo DataForSEO): 34,5735 → 33,9507 = **0,6228 USD** en todo el periodo, que incluye al agente que gastaba en paralelo. Por tramos: 0,0168 (solo la llamada 1), 0,2143 (llamadas 2–7) y 0,3917 (llamadas 8–11); el saldo no se movió después. El tope de este trabajo es, por tanto, 0,62 USD, dentro del presupuesto de 1,2.
