# Plantillas

## Log de un sitio — `seo-ops/sitios/<slug>/corridas/AAAA-MM-DD.md`

```markdown
# <dominio> — revisión AAAA-MM-DD

Corrida: seo-ops/corridas/AAAA-MM-DD.md · Anterior: <ruta o "primera">
Opciones: auditoría <ninguna|ligera|completa> · competidores <sí|no> · keywords <sí|no> · rank tracker <no|si_toca|forzar> · salida <informe|plan|pr>

## Veredicto
<Sin cambios | Plan sin PR | PR <url>> — una frase con el porqué.

## Métricas (ventanas <fechas>, datos finales hasta D-4)
| Métrica | Esta corrida | Anterior | Cambio | ¿Pasa umbral? |
| --- | --- | --- | --- | --- |
| GSC clics 7d / 28d | | | | |
| GSC impresiones 7d / 28d | | | | |
| GSC CTR / posición media | | | | |
| Bing clics / impresiones (overview) | | | | |
| Visitas orgánicas (Umami/GA4) | | | | |
| URLs indexadas / problemas de indexación | | | | |
| Rank tracker: top 3 / top 10 / sin posición | | | | |
| Auditoría: issues nuevos / resueltos (id) | | | | |

## Señales
- <señal real>: <números> → <causa verificada y cómo se verificó>
- Ruido: <qué se descartó y por qué>

## Experimentos abiertos
| Cambio (PR) | Deploy | Revisión | Resultado |
| --- | --- | --- | --- |

## Candidatos y validación
| Candidato | Evidencia | Veredicto | Motivo / revisor adversarial |
| --- | --- | --- | --- |
| | | GO / NO-GO / ESPERAR (fecha) | |

## Ejecución
Rama, PR, checks corridos, URLs tocadas. Tareas post-deploy pendientes (IndexNow, lista para GSC).

## Para la próxima corrida
- Qué revisar y cuándo.

## Costos
Créditos: <n> (<qué>). Herramientas que fallaron: <ninguna|cuáles>.
```

## Resumen de la corrida — `seo-ops/corridas/AAAA-MM-DD.md`

```markdown
# Revisión SEO AAAA-MM-DD

Modo: <interactivo|auto> · Opciones: … · Saldo DataForSEO: <inicio> → <fin> (<gastado>)

| Sitio | Veredicto | PR | Decisión pendiente de Gabriel |
| --- | --- | --- | --- |

## Lo importante (5–10 líneas)

## Aprendizajes del proceso
- (también van a seo-ops/APRENDIZAJES.md)
```

## Ficha de un sitio — `seo-ops/sitios/<slug>/SITIO.md`

~~~markdown
# <dominio>

```yaml
openseo_project_id: <uuid>
dominio: <dominio>
repo: <ruta local o null>
github: <owner/repo o null>
rama_base: main
estado: activo | pausado          # pausado: salida máxima "informe"
puede_pr: true | false            # false si no hay repo accesible desde esta máquina
pr_automatica: true | false       # en modo auto, ¿se abre PR sin preguntar?
commit_requiere_ok: true | false  # true: dejar la rama lista y pedir OK antes de commitear
checks: "<comandos de validación local>"
idioma: "<registro y reglas de copy>"
rank_tracker: { id: <id o null>, intervalo_dias: <n>, costo_aprox: <créditos> }
auditoria_referencia: { id: <id o null>, maxPages: <n>, includePaths: [], excludePaths: [], engines: [google] }
```

## Cómo se cambia y se despliega
## Reglas de contenido
## Congelaciones y pausas
## Experimentos abiertos
| Cambio | PR | Deploy | Revisar | Métrica y línea base |
## Revisiones agendadas
## Backlog
## Ruido propio del sitio
## Documentos
~~~
