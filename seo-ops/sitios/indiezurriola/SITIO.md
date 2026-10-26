# indiezurriola.com

```yaml
openseo_project_id: 5f40746e-f699-460b-a338-eb79d2df472c
dominio: indiezurriola.com
repo: null            # solo en la MacBook: /Users/gabrielcardetti/work/indiezurriola/site, sin remoto conocido
github: null
rama_base: main
estado: activo
puede_pr: false       # desde este servidor no hay repo: la salida máxima es "plan"
pr_automatica: false
commit_requiere_ok: true
checks: null
idioma: "ES, EN y FR"
rank_tracker: { id: null, intervalo_dias: null, costo_aprox: null }
auditoria_referencia: { id: null, nota: "nunca se auditó; la primera corrida crea la línea base" }
```

## Cómo se cambia y se despliega

- El código vive solo en la MacBook. Se trabaja en una rama (`rediseno`), se mergea a `main` en local y se deploya a mano el Worker con `APP_ENV=production`. Staging: `indie-zurriola-staging` en test.indiezurriola.com (noindex). El Worker solo permite indexar en el host `indiezurriola.com`.
- El plan del ciclo se deja en el log para aplicarlo desde la Mac.

## Diagnóstico vigente (19-oct)

- Crece por la marca ("INDIE"); no aparece en "alquiler tablas surf"; los asistentes de IA ya lo recomiendan.
- Error en la ficha de Google Maps que cuesta visitas: arreglarlo es lo primero (fuera del sitio, no es una PR).

## Backlog

- Verificar que el 301 de indiebasquesurfing.com (reenvío de GoDaddy, configurado el 30-sep) funciona.
- Datos legales reales pendientes.

## Ruido propio del sitio

- Está en el par de IPs de Cloudflare que bloquea LaLiga: un fetch fallido puede ser el bloqueo, no el sitio.
