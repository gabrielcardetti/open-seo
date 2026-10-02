# Plantilla del brief común

Copiala al scratchpad, completá lo que está entre `<...>` y pasales la ruta a los subagentes. Cada uno la lee entera antes de empezar. Lo que sale del contexto del proyecto (producto, reglas) se copia de ahí, no se reescribe de memoria.

---

# <Sitio>: brief de la ronda <n> (leelo entero)

Repo `<ruta>`, rama `<rama>`. Checkpoint `<commit>`: si rompés algo, compará contra él. Servidor de desarrollo en `<url local>`: si no responde, levantalo en segundo plano con `<comando> > <log> 2>&1`, y si responde no lo reinicies. Sin commits ni push. Informe final en <idioma>.

<Producto en un párrafo: qué hace, para quién, qué lo diferencia. Copiado de `positioning`.>

## Objetivo de esta ronda

<Qué páginas, por qué búsquedas (keyword y volumen por mercado) y qué se reutiliza. Ejemplo: "reorganizar el sitio alrededor de búsquedas con demanda real para que cada página venda; reutilizar textos, visuales y conversaciones que ya funcionan".>

## Reglas del dueño (todas obligatorias)

<Copiadas de `writing_preferences` y `decisiones`, agrupadas en Foco, Escritura, Verdad, Visuales y Proceso.>

## Diseño

- Bloques de `<archivo de bloques>`: <lista>. Componentes visuales: <lista con ruta y un ejemplo de uso>.
- Superficies alternadas entre secciones, sin dos iguales seguidas.
- Diagramas en código. Fotos generadas solo dentro de chats, con datos ficticios, en WebP de menos de 120 KB, con nombre nuevo en `<carpeta>`. <Runner de imágenes, si hay uno.>
- Celular a 390 px sin scroll horizontal.

## SEO / GEO / AEO

- Title de hasta 60 caracteres, con la búsqueda principal primero. Description de 120 a 155. Un solo H1 con la keyword. H2 que respondan búsquedas reales. La primera oración de cada sección es la respuesta directa.
- JSON-LD: breadcrumb, más `WebPage` o `Article` con `dateModified` del registro, más `FAQPage` solo si hay FAQ visible. Sin ratings.
- "Sigue con": 3 tarjetas a páginas que existen en `<registro>`. Páginas que se eliminan en esta ronda: <lista>, no enlazarlas.

## Código

<Convenciones del repo que importan: estilo de comentarios, cosas prohibidas, alias de imports.>

## Coordinación

- Editá SOLO los archivos de tu asignación. No toques `<registro>`, `<nav/footer>`, `<sitemap>`, `<llms.txt>`, `<landing>` ni los hubs: los conecta el coordinador al final. Si querés cambiar el título o el resumen de tu página en el registro, proponelo en el informe.
- Un componente compartido solo se cambia agregando props opcionales, y después capturás otra página que lo use para confirmar que no se rompió.

## Verificación antes de informar

1. Typecheck y lint sin errores en tus archivos.
2. Cada ruta tuya responde 200 y el HTML del servidor contiene el H1, los textos y la FAQ.
3. Capturas con Playwright a 1440 y a 390 px, miradas una por una. Las animaciones, cuando terminaron.
4. Una pasada final buscando dos cosas: la misma idea en dos secciones, y frases que enseñen a usar el producto de otro.

## Informe (corto)

Estructura de la página (secciones y su respuesta directa), keywords cubiertas, afirmaciones verificadas con su archivo o fuente, qué reutilizaste y qué sacaste, propuestas fuera de tu alcance (archivo exacto y cambio), capturas y dudas para el dueño.
