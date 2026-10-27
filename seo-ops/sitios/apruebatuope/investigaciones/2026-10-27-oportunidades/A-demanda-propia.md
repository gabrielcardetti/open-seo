# A · Demanda propia de apruebatuope.com (27-oct-2026)

Objetivo: encontrar crecimiento en las búsquedas donde ATP **ya** recibe impresiones y está entre la posición 5 y la 20, o donde no hay una página que responda a esa intención. Fuentes gratuitas: Search Console, Bing (historia guardada en OpenSEO), `get_search_opportunities` y los sitemaps en vivo. Solo lectura: no se tocaron el repo, el contexto del proyecto ni la configuración de OpenSEO. Las cifras son impresiones y posiciones de GSC o Bing. No hay volúmenes de búsqueda, que trae el informe B.

Ventanas:

- **28 d**: del 26-sep al 23-oct, con `dataState: final`.
- **90 d**: del 26-jul al 23-oct, para ver patrones de poco volumen.

En casi todas las consultas, la cifra de 90 d es casi igual a la de 28 d: el sitio es joven y casi todas sus impresiones son de las últimas cuatro semanas.

## Resumen

- **Candidatas a página nueva (a): solo dos, y las dos son de la Administración General de Canarias.** Google posiciona el hub `/canarias-administracion` entre el 28 y el 53 para «auxiliar administrativo gobierno de canarias» y «administrativo gobierno de canarias» (unas 370 impresiones en 90 d). No hay una ficha por cuerpo, pero ATP sí tiene el producto: el repertorio oficial de C2 (200 preguntas) y el de C1 (300). Fuera de esto, la demanda propia no pide páginas nuevas, porque todas las intenciones con volumen ya tienen su URL.
- **Mejorar lo existente (b): casi todo está bloqueado por experimentos.** Las mayores bolsas de impresiones con CTR bajo son estas:
  - SESPA: 10.184 impresiones en 28 d, CTR 0,37 %. Esperar a 24-nov.
  - Bolsa del Gobierno Vasco: 4.195 impresiones y 0 clics. Esperar a 4-nov.
  - ICS en Bing: 4.852 impresiones y 5 clics. Esperar a 4-nov.
  - SERMAS en Bing: 5.455 impresiones. Esperar a 24-nov.
  - SACYL y SMS: esperar a 15-nov.
  - Hub UPV/EHU: 321 impresiones y 0 clics, en subida. Esperar a 4-nov.
- **Canibalización (c), tres casos reales:**
  - `/bopv` frente a `/bopv/hoy`: las dos consultas están cruzadas, 781 impresiones. No está en ningún experimento: es lo único accionable ya.
  - «OPE UPV administrativo»: Google lleva estas búsquedas a la página de **auxiliar de promoción interna** en vez de a `/upv-ehu/administrativo`. Esperar a 4-nov.
  - «empleo público / OPE Gipuzkoa»: reparte unas 101 impresiones entre las páginas de territorio y de organismo. Esperar a 10-nov.
- **Ruido (d):**
  - El BOG (6.271 impresiones), ya descartado.
  - La VEC del SAS en Bing (2.541 impresiones, navegacional).
  - Ikasiker, un ISBN y las marcas ajenas «aprueba test» y «quiz de opo».

## Páginas en experimento abierto (no proponer cambios antes de la fecha)

Comprobado con la lista de archivos de cada PR (`gh pr view`).

| Página(s) | PR | Esperar a |
| --- | --- | --- |
| `/guias/bolsa-sespa`, `/guias/bolsa-sas`, `/guias/bolsa-sermas` | #94 (tratado o control), #126, #132 | **24-nov** |
| `/sas*`, `/estado*`, `/guias/oposiciones-{sescam,sermas,sergas}`, plantilla `NacionalGuia` de `/guias/*` | #126, #132 | **24-nov** |
| `/guias/bolsa-sescam`, `/guias/bolsa-sacyl`, `/guias/bolsa-sms-murcia`, guías de `/canarias-administracion/*` | #94, #126 | **15-nov** |
| Calendarios laborales, `/empleo/territorio/*`, `/empleo/organismo/*` (títulos) | #105 | **10-nov** |
| `/guias/bolsa-ics`, `/guias/bolsa-ib-salut`, `/guias/bolsa-salud-aragon`, `/guias/bolsa-ses-extremadura` | #94 (tratado) | **4-nov** |
| `/guias/bolsa-ingesa`, `/guias/bolsa-trabajo-gobierno-vasco`, sanidad-gva, rioja, cantabria (y SESPA) | #94 (control) | **4-nov** |
| Hubs `/upv-ehu*`, `/canarias*`, `/canarias-administracion`, `/canarias/listas-de-empleo`, `/osakidetza/desarrollo-profesional`, `/festivos/*`, fichas de test | #95 | **4-nov** |

Las páginas sin experimento son `/bopv`, `/bopv/hoy`, `/osakidetza/listas-de-contratacion`, `/osakidetza/simulador-baremo-listas`, `/osakidetza/concurso-de-traslados` y `/boletines/*` (el BOG ya está descartado).

## (a) Candidatas a página nueva

| # | Página propuesta | Evidencia (GSC) | Página que posiciona hoy | ¿Hay producto? | Cuándo |
| --- | --- | --- | --- | --- | --- |
| A1 | `/canarias-administracion/auxiliar-administrativo` (Cuerpo Auxiliar C2: plazas, examen, temario y práctica) | ≈189 impr. en 90 d en posiciones 25–53; 84 visibles en 28 d (detalle abajo) | Hub `/canarias-administracion` (pos. 43–53) y `/canarias-administracion/examenes-anteriores-auxiliar-administrativo` (pos. 34) | Sí: repertorio oficial C2 (200 preguntas, BOC nº 119/2023) cargado en ATP. OEP 2026: 296 plazas C2 (BOC nº 57/2026, según el hub) | Prepararla ya. Publicarla y enlazarla desde el hub después del **4-nov**. No editar `examenes-anteriores` antes del **15-nov** |
| A2 | `/canarias-administracion/administrativo` (Cuerpo Administrativo C1) | ≈183 impr. en 90 d en posiciones 17–37 | Hub `/canarias-administracion` (pos. 28–37) | Sí: repertorio oficial C1 (300 preguntas). OEP 2026: 57 plazas C1 | Igual que A1 |

Por qué son nuevas y no «mejorar el hub»:

- El hub mezcla cinco cuerpos (A1, A2, C1, C2 y E) y dos procesos.
- Google lo lleva a la posición 28–53 justo en las consultas que nombran un cuerpo concreto.
- En cambio, las páginas de un solo cuerpo del mismo sitio funcionan:
  - `/canarias-administracion/examenes-anteriores-auxiliar-administrativo`: 82 clics, 789 impresiones, CTR 10,4 % en 90 d.
  - `/canarias/auxiliar-administrativo`, del SCS: 365 impresiones, pos. 11,9.
- El patrón ya existe en el SCS (`/canarias/<categoría>`) y en el Estado (`/estado/auxiliar-administrativo-estado`).

Riesgo: «… gobierno de canarias» puede ser navegacional (gobiernodecanarias.org). Antes de construir, conviene mirar la SERP de las dos cabeceras con `get_serp_results`. Le toca al agente de DataForSEO (informe B) o a una llamada suelta. El volumen tampoco sale de aquí.

Evidencia A1 (Auxiliar C2):

| Consulta | Impr. 90 d | Pos. 90 d | Impr. 28 d | Pos. 28 d | URL |
| --- | --- | --- | --- | --- | --- |
| auxiliar administrativo gobierno de canarias | 92 | 52,8 | 36 | 43,4 | hub (27, pos. 46,5) y examenes-anteriores (9, pos. 34) |
| oposiciones auxiliar administrativo gobierno de canarias 2024 | 25 | 25,1 | – | – | hub |
| ope canarias auxiliar administrativo | 23 | 41,1 | – | – | hub |
| oposiciones auxiliar administrativo canarias 2019 | 19 | 37,1 | – | – | hub |
| 70 plazas auxiliar administrativo gobierno de canarias | 11 | 25,8 | – | – | hub |
| oposiciones canarias 2024 auxiliar administrativo | 9 | 41,4 | – | – | hub |
| oposicion auxiliar administrativo gobierno de canarias | 5 | 51,6 | 2 | 39,5 | hub |
| examen auxiliar administrativo gobierno de canarias | 5 | 47,4 | – | – | hub |
| *(contexto, ya bien servido)* examen c2 auxiliar administrativo gobierno de canarias | 37 | 8,8 | 37 | 8,8 | examenes-anteriores, 2 clics |

Evidencia A2 (Administrativo C1):

| Consulta | Impr. 90 d | Pos. 90 d | Impr. 28 d | Pos. 28 d | URL |
| --- | --- | --- | --- | --- | --- |
| administrativo gobierno de canarias | 163 | 28,1 | 37 | 37,0 | hub |
| oposiciones canarias 2021 administrativo | 18 | 17,4 | – | – | hub |
| oposiciones administrativo gobierno de canarias | – | – | 2 | 27,5 | hub |
| *(vecina)* administradores generales canarias (A1) | 24 | 15,9 | 2 | 25,0 | hub |

Descartadas como página nueva (la intención ya tiene URL o no hay producto):

| Intención | Evidencia | Por qué no |
| --- | --- | --- |
| Oposiciones u OPE SCS | ≈340 impr. en 90 d, pos. 26–59 («ope scs 2026» 34 en pos. 11,1; «oposiciones scs» 24 en pos. 41,8; «servicio canario de salud oposiciones» 14 en pos. 48,9…) | La cubre `/canarias` («OPE SCS Canarias 2025: proceso selectivo, plazas y examen»). Una `/guias/oposiciones-scs` al estilo de #132 la canibalizaría. Va a (b) |
| OPE u oposiciones SAS 2026 | «ope sas 2026» 16 en pos. 51,6 y «oposiciones sas 2026» 12 en pos. 57,3, las dos hacia `/guias/bolsa-sas` | La resuelve el pilar `/sas` de #132, desplegado hoy. Medir el 24-nov |
| Bolsa por categoría (TCAE, enfermería, celador, auxiliar administrativo) del SERMAS y el SESPA | Bing SERMAS: TCAE 851, enfermería y «bolsa enfermería madrid» 1.081, auxiliar administrativo 87. GSC SESPA: celadores 239, auxiliar administrativo 268 (+60 en «busca»), enfermería 159 en «busca» | Es la misma intención que la guía de la bolsa, con un filtro, y hoy la posiciona una sola URL en la pos. 6–8. Primero conviene probar anclas o secciones por categoría dentro de la guía, enlazadas a `/tests/tcae` y `/tests/enfermeria`, tras el 24-nov |
| «¿Es festivo hoy en Euskadi?» | ≈62 impr. en 90 d, pos. ≈10 («hoy es fiesta en euskadi» 32, «hoy es festivo en euskadi» 15…) | La responde `/calendario-laboral-euskadi`, y es poco volumen |
| Agrupación profesional de personal de apoyo (Euskadi) | ≈35 impr. en 90 d, pos. 21–29, hacia una ficha de `/empleo/convocatoria` | Sin producto para practicar y por debajo del umbral |

## (b) Mejorar lo existente

Las impresiones son las de las consultas visibles en la franja 5–20. En la página, Google anonimiza la mayor parte del total: `bolsa-sespa` suma 16.698 impresiones y solo se ven unas 10.200.

| Grupo | Consultas de muestra | GSC 28 d (impr. / clics / pos. / CTR) | Bing 28 d | URL | Esperar a | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| Bolsa SESPA | busca sespa 2.763 (pos. 5,2); bolsa sespa 1.286; sespa bolsa 578; bolsa empleo sespa 494; listado bolsa sespa 484; bolsa sespa asturias 303; astursalud bolsa 283… | **10.184 / 38 / 5,4–7,5 / 0,37 %**. Por subgrupo: «busca» 3.765, genérica 4.491, «demandantes / registro» 1.421 (CTR 0,14 %), por categoría 507 | bolsa sespa 113 (pos. 7,8), busca sespa 36 | `/guias/bolsa-sespa` (página: 16.698 impr., 116 clics, pos. 6,1) | **24-nov** | Candidata de CTR clara (≥1.000/mes, pos. 3–15, CTR <1 %). La guía ya usa «demandantes» y «busca». La consulta oficial primero llegó con #132: medir antes de tocar nada |
| Bolsa del Gobierno Vasco | bolsas de trabajo gobierno vasco 1.575 (pos. 8,9); bolsas gobierno vasco 978; bolsa de trabajo gobierno vasco 315; bolsa trabajo… 183; gobierno vasco bolsas de trabajo 146… | **4.195 / 0 / 8,9 / 0 %** | bolsas de trabajo gobierno vasco 307, bolsas gobierno vasco 225 → 569 impr., 0 clics, pos. 6,6 | `/guias/bolsa-trabajo-gobierno-vasco` (5.595 impr., 14 clics) | **4-nov** (control de #94; la decisión del snippet ya está agendada) | «empleo publico gobierno vasco» (150, pos. 10,2) llega a la guía de la bolsa, pero su intención es la de `/empleo/organismo/gobierno-vasco` (113 impr., pos. 6,3). Revisar el enlace interno entre las dos |
| Borsa de treball ICS | borsa de treball ics 1.813; ics borsa de treball 703; bolsa ics 686; borsa ics 665; borsa treball ics 585… | La página no sale en GSC (en SITIO, entre las «indexadas que Google no muestra») | **4.852 / 5 / 7,3 / 0,10 %** (página: 8.930 impr., 83 clics) | `/guias/bolsa-ics` | **4-nov** (#94) | La consulta va en catalán. El title ya dice «Borsa de treball ICS» |
| Bolsa SERMAS | bolsa sermas 1.593; bolsa única sermas 785 + 568; bolsa tcae sermas 392… | 417 impr., pos. 9,8, CTR 0,7 % (página) | Genérica 3.436 (11 clics, pos. 7,2); TCAE 851 (pos. 6,6); enfermería y Madrid 1.081 (pos. 7,2). Página: 19.095 impr., 201 clics | `/guias/bolsa-sermas` | **24-nov** | Google infraexpone la guía frente a Bing. Revisión de «indexadas que Google no muestra» el 24-nov |
| Bolsa SAS | cuadro evolución bolsa sas 2026 63 (pos. 5,5, CTR 6,3 %) y variantes ≈70; listado definitivo bolsa sas 2026 19 (pos. 8,3); bolsa sas 2026 19 (**pos. 43**) | ≈190 visibles; la página tiene 1.441 impr., CTR 5,8 % | bolsa sas 592 (pos. 8,4); «VEC» 2.541 (navegacional, ver d) | `/guias/bolsa-sas` | **24-nov** | La cabecera «bolsa sas 2026» queda lejos aunque la cola funciona |
| Bolsa SACYL | bolsa abierta y permanente sacyl 237 (pos. 6,7); bape sacyl 142; bape bolsa sacyl 68 | **447 / 0 / 7,8 / 0 %** | bolsa abierta y permanente sacyl 869, bolsa sacyl 115, bape sacyl 103 → 1.087, 1 clic, pos. 7,9 | `/guias/bolsa-sacyl` | **15-nov** | En GSC, «bolsa sacyl» sale en la pos. 25,8 |
| Bolsa SMS Murcia | ultimos llamamientos sms 301 (pos. 5,9); llamamientos sms 132; últimos llamamientos sms 53; sms ultimos llamamientos 47 (+≈90 de cola) | **563 / 0 / 7,0 / 0 %** | bolsa sms 36 | `/guias/bolsa-sms-murcia` | **15-nov** | Intención casi navegacional (la lista oficial de llamamientos). El title ya dice «últimos llamamientos» |
| Bolsa SESCAM | cuándo se abre o actualiza la bolsa del sescam 34 + 14 + 17 + 5 (pos. 5,9–9,4); **bolsa sescam 11 (pos. 62)**, sescam bolsa 12 (49), selecta 27 (48), selecta sescam 14 (45) | Página: 1.190 impr., pos. 10,5, CTR 1,5 % | selecta sescam 105 (pos. 9,2) | `/guias/bolsa-sescam` | **15-nov** (bolsa); **24-nov** para la familia SESCAM (`/guias/oposiciones-sescam` es nueva) | Las cabeceras están fuera del top 40 en Google y no en Bing |
| Bolsa INGESA | bolsa ingesa melilla 2026 122; bolsa ingesa 57; bolsa ingesa ceuta 2026 48; bolsa unica ingesa 35 | **262 / 2 / 7,3** | bolsa ingesa 45 (pos. 5) | `/guias/bolsa-ingesa` | **4-nov** (control) | |
| IB-Salut y Aragón | bolsa unica ibsalut 23 (pos. 10,8); salud bolsa 15, bolsa del salud 11 | IB-Salut: 329 impr., pos. 8,7, CTR 0,3 % (página). Aragón: 1.033 impr., pos. 7,6, CTR 2,7 % | IB-Salut 256, Aragón 252 | `/guias/bolsa-ib-salut`, `/guias/bolsa-salud-aragon` | **4-nov** (#94) | |
| OPE UPV/EHU | upv ope 192 (pos. 8,6); ope upv 129 (9,3); oposiciones upv/ehu 2026 17; ope upv 2026 13 | **351 / 1 / 8,9 / 0,3 %**. Entre el 14 y el 23-oct solo «upv ope» y «ope upv» sumaron 221: **en subida** | ope ehu 2026 105 + 44; ope upv/ehu 2026 104 (pos. 6,6) | `/upv-ehu` (página: 2.489 impr., 42 clics, pos. 6,8) | **4-nov** (#95 cambió el title a «OPE UPV/EHU 2026…») | Las búsquedas de administrativo, ver (c) |
| Proceso selectivo y OPE del SCS | proceso selectivo scs 62, procesos selectivos scs 35, scs proceso selectivo 28 (pos. 10–14); ope scs 2026 34 (11,1); oposiciones u OPE SCS y variantes ≈300 (pos. 26–59); ope enfermería canarias o scs ≈49 (pos. 38–59) | `/canarias`: 1.184 impr. en 90 d, pos. 15,8, CTR 0,8 % | listas supletorias scs 92 en 90 d → `/canarias/listas-de-empleo` (pos. 9) | `/canarias` (existen `/canarias/que-proceso-scs` y `/canarias/enfermeria`, sin estas impresiones) | **4-nov** (#95) | Google no usa las subpáginas para sus intenciones. Tras el 4-nov, revisar el enlazado del hub hacia `que-proceso-scs` y `enfermeria` |
| Desarrollo profesional de Osakidetza | desarrollo profesional osakidetza 70 (pos. 6,4); carrera profesional osakidetza 46 (7,6) y 13; desarrollo profesional osakidetza 2026 27… | ≈170 en 90 d; la página tiene 586 impr. y CTR 1,2 % | – | `/osakidetza/desarrollo-profesional` | **4-nov** (#95) | Comprobar la página gemela en opeosakidetza.com antes de reforzar ATP (mudanza el 15-dic) |
| Estado: INAP C2 | inap c2 17 (pos. 7,9); inap c2 auxiliar administrativo 7 + 5; inap auxiliar administrativo 7 | ≈40 | – | `/estado`, `/estado/auxiliar-administrativo-estado` | **24-nov** | |
| Calendario laboral | calendario laboral alava 2027 37 (pos. 9,6); alava 2027 botha 23 (2,3); vitoria 2027 20 (9,1) | `/calendario-laboral-euskadi`: 1.619 impr. en 90 d, pos. 17,4, CTR 0,19 % | calendario laboral 2027 euskadi 40; `/calendario-laboral-euskadi/2027` 142 | Calendarios por territorio | **10-nov** (#105) | Las consultas de 2027 suben, sin acción antes de la lectura |
| Festivos | por qué es festivo el 12 de octubre (≈500 en 90 d, pos. 6–9, 3 clics); el 2 de noviembre es festivo (≈190 visibles en 28 d, pos. 4,5–10,5) | `todos-los-santos`: 3.922 impr. y 73 clics, en pico ahora | – | `/festivos/*` | **4-nov** (#95) | Estacional: el 12-oct ya pasó y el 2-nov pasa antes de poder medir. Revisarlo en la temporada siguiente |
| Guías de fondo sin consultas visibles | – | `que-es-una-bolsa-de-empleo-sanitario` 424 impr. en 90 d (pos. 6,7, CTR 0,7 %); `penalizan-las-respuestas-mal…` 254 (pos. 6,1, CTR 0,4 %); `como-se-calcula-la-nota-de-corte…` 262 (pos. 5,8, CTR 1,1 %) | – | `/guias/*` | **24-nov** (plantilla `NacionalGuia` tocada en #126 y #132) | Sin consultas, no se puede diagnosticar más |

Sin experimento, pero sin una oportunidad clara:

- `/osakidetza/listas-de-contratacion`: 364 impr., pos. 9,8, CTR 0,55 %.
- `/osakidetza/simulador-baremo-listas`: 705 impr. en 90 d, pos. 6,3, CTR 3,7 %.

Las dos son de Osakidetza, así que antes de nada hay que mirar el par en OSK. Ver además «lanpoltsa» en (c).

## (c) Canibalización

Umbral de `senales.md`: unas 100 impresiones de la misma intención repartidas entre páginas en 28 días, y en dos observaciones. Todas las de abajo son la **primera** observación con `query + page`.

| Consulta(s) | URLs que compiten (28 d) | Impr. | Diagnóstico | Cuál se queda | Cuándo |
| --- | --- | --- | --- | --- | --- |
| «bopv hoy» y «bopv» | «bopv hoy»: `/bopv` 331 (pos. 8,5) y `/bopv/hoy` 47 (pos. 8,2). «bopv»: `/bopv/hoy` 385 (pos. 10,5) y `/bopv` 18 (pos. 25,8) | 781 | Las dos consultas están cruzadas. Los dos títulos empiezan por «BOPV hoy» («BOPV hoy: buscador del Boletín…» y «BOPV hoy: resumen del 27 de octubre»). La intención es sobre todo navegacional (el boletín oficial) | `/bopv` para «bopv» y el buscador; `/bopv/hoy` para «bopv hoy» (quitar «hoy» del title de `/bopv`) | **Sin experimento**: accionable tras confirmar en la próxima corrida. Ganancia esperada baja o media (Bing: `/bopv` 1.209 impr., pos. 7) |
| «ope upv administrativo» y variantes: «upv ope administrativo» 9, «ope ehu 2026 administrativo» 21, «ope administrativo upv» 6, «upv administrativo ope» 6, «ope upv administrativos» 4, «upv oposiciones administrativo 2026» 4, «examen administrativo upv» 2 | Todas van a `/upv-ehu/auxiliar-administrativo-promocion-interna` (pos. ≈10). `/upv-ehu/administrativo` solo tiene 46 impr. en 28 d (pos. 5,4) | ≈55 visibles en 90 d (34 entre el 14 y el 23-oct); la página de promoción interna tiene 1.041 impr. y CTR 0,58 % | Página equivocada: el Administrativo (Escala Administrativa, 37 plazas, turno libre) pierde ante el Auxiliar de promoción interna (4 plazas). En Bing, `/upv-ehu/administrativo` sí recibe las búsquedas de «batería de preguntas administrativo» | `/upv-ehu/administrativo` para «administrativo»; la de promoción interna solo para «auxiliar» y «promoción interna» | **4-nov** (#95 tocó el contenido de UPV/EHU) |
| «empleo publico gipuzkoa», «empleo público gipuzkoa», «gipuzkoa empleo publico», «ope gipuzkoa», «gipuzkoa ope» | `/empleo/territorio/gipuzkoa` 17 + 6 + 6 + 18 + 9 (pos. 14–27) y `/empleo/organismo/diputacion-foral-de-gipuzkoa` 9 + 6 + 11 + 8 + 11 (pos. 28–39) | ≈101 | Las genéricas se reparten. Las de «diputación» («ope diputacion gipuzkoa», «oposiciones diputacion gipuzkoa», «diputacion gipuzkoa empleo»…) sí deben ir al organismo | Territorio para las genéricas; organismo para «diputación» | **10-nov** (#105 cambió los títulos de empleo) |
| «lanpoltsa osakidetza» | `/osakidetza/listas-de-contratacion` 79 y `/osakidetza/simulador-baremo-listas` 79, las dos en pos. 9,8 | 158 | Misma posición y mismas impresiones: lo más probable es que Google muestre las dos juntas, en doble resultado. «Lanpoltsa» es la aplicación oficial (navegacional) | Listas de contratación | Sin experimento. Prioridad baja; vigilar si se separan |
| Por debajo del umbral | «calendario laboral alava 2027 botha»: Álava 23 (pos. 2,3) y Vitoria 11 (pos. 9). «calendario laboral bilbao 2027 bob»: Bilbao 11 y Bizkaia 11 | 34 y 22 | Ciudad frente a territorio, por diseño | – | 10-nov |
| Resuelto | «calendario laboral gipuzkoa»: 104 impr. en 90 d hacia `/calendario-laboral-euskadi` (pos. 41) antes de #105; desde el 14-oct van a `/calendario-laboral-gipuzkoa` | – | #105 lo resolvió | – | Confirmar el 10-nov |

En las guías de bolsas no hay canibalización: en GSC y en Bing cada consulta de bolsa cae en una sola URL.

## (d) Ruido, navegacional o fuera de posicionamiento

| Grupo | Evidencia | Motivo |
| --- | --- | --- |
| BOG Gipuzkoa | bog 4.582 (pos. 8,7) y boletín oficial de gipuzkoa con variantes ≈1.690 → 6.271 impr. y 2 clics en 28 d | Descartado el 27-oct: es navegacional, con la sede 1.ª y 2.ª y AI Overview |
| Boletines forales en Bing | bog 531, botha 154, bob 54, bob bizkaia hoy 42 | Navegacional |
| VEC del SAS (Bing) | vec sas 904, vec 843, vec bolsa sas 468, sas vec 193… → 2.541 impr. y 3 clics | La Ventanilla Electrónica del Candidato es un acceso con usuario. `bolsa-sas` ya la explica (33 menciones) |
| «busca sespa» | 2.763 impr., pos. 5,2, CTR 0,4 % | Medio navegacional (la aplicación BUSCA del SESPA). Queda en (b) porque la guía la nombra en el title |
| Becas Ikasiker | ikasiker 2026, beca y becas → 91 impr. en `/bopv/2026/09/3920` | Fuera del posicionamiento (no son oposiciones) |
| ISBN | 978-84-614023-4-2: 146 impr. en 90 d, pos. 11,7 | Ruido |
| Marcas ajenas | aprueba test 74, aprueba test gestión de examenes 88, apruebatest gestión de exámenes 19, apruebatest 17 (90 d); «quiz de opo» 59 en Bing | Navegacional hacia otras marcas |
| Consultas sin intención | «si», «respuestas», «seguro?» → `/tests/tcae` en pos. 1–2; «eb2-2971/23-lc-000»; «decreto 140/2026»; «c211l24» | Ruido o modo IA |
| `bopv.apruebatuope.com` | «boletin oficial del pais vasco» y otras, ≈33 impr. en 90 d | Host residual: hace 301 a `/bopv` |

## Lo que la demanda propia no puede decir

- Google anonimiza casi toda la cola. Por eso no se ve casi ninguna consulta con «test» u «oposiciones <servicio>» fuera de Canarias, UPV/EHU y Osakidetza. La demanda de páginas nuevas de tests o de oposiciones por servicio sale del informe B (DataForSEO), no de aquí.
- `get_search_opportunities` (con Umami como analítica) pone arriba `/`, `/upv-ehu` (85), `/boletines/bog` (82), `bolsa-sespa` (81), `todos-los-santos` (80) y `examenes-anteriores-auxiliar-administrativo` (79). Ninguna queda libre: están en experimento o descartadas, salvo la home.
- Bing guarda los clics por página pero los reparte poco por consulta: `bolsa-sermas` tiene 201 clics de página y unos 15 visibles por consulta.

## Cómo se hizo

- `get_project_context`: posicionamiento, cursos y reglas de redacción.
- `get_search_console_performance`:
  - `[query]` y `[query, page]` con posición 5–20, ≥30 impresiones (28 d) y ≥80 (90 d), paginando el top de 1.000 filas.
  - Las mismas dimensiones sin filtro de posición y con umbrales de 3 a 15 impresiones, filtradas por página (`/canarias`, `/canarias-administracion`, `upv-ehu`, `/osakidetza`, `/guias/`, `/empleo`, `/tests/`) para ver la cola que no aparece en el top global.
  - `[page]` a 28 y 90 d, y la ventana del 14 al 23-oct para UPV/EHU y Gipuzkoa.
- `get_bing_search_performance`:
  - Consultas a 28 y 90 d (≥30 y ≥80 impresiones).
  - Páginas a 28 d.
  - Detalle en vivo de 7 consultas y 2 páginas.
- `get_search_opportunities` (28 d).
- Sitemaps en vivo con curl: `sitemap.xml` (280 URLs), `sitemap-empleo.xml` (239), `sitemap-boletines.xml` (108) y `bopv/sitemap.xml` (3).
- Títulos y H1 en vivo de 29 páginas.
- `gh pr view` y `gh pr diff` de #94, #95, #105, #126 y #132, para saber qué páginas toca cada experimento.
- `git show origin/main` del hub de Canarias Administración, para confirmar el producto (repertorio C1 y C2).
- Sin créditos gastados.
