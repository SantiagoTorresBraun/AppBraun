# Agente de IA — asistente de datos sobre el Google Sheet

El botón flotante del avatar (abajo a la derecha) ya no dice "próximamente": abre un
chat que responde preguntas en castellano sobre **todo** lo que hay en el Sheet
`BD_BRC` — cargas, productos, contratos, control de calidad, muestreos y tickets.

---

## 1. Puesta en marcha (una sola vez, ~5 minutos)

> ⚠️ **La clave de Groq no va NUNCA en un archivo del repo.**
> Este repositorio es público (es lo que publica GitHub Pages). Una clave escrita en
> `02_agente_ia.gs` quedaría a la vista de todos apenas se haga push, y GitHub o Groq
> la revocarían automáticamente. Por eso se carga a mano en el Apps Script.

### Paso 1 — Sacar la clave gratuita de Groq
1. Entrar a **https://console.groq.com** e iniciar sesión (sirve una cuenta de Google).
2. Ir a **API Keys ▸ Create API Key**, ponerle un nombre (`AppBraun`) y copiar la clave.
   Empieza con `gsk_`. **Se muestra una sola vez**: copiala en ese momento.

No hace falta tarjeta de crédito.

### Paso 2 — Cargar la clave en el Apps Script
1. Abrir el Sheet `BD_BRC` ▸ **Extensiones ▸ Apps Script**.
2. Crear un archivo nuevo llamado **`02_agente_ia`** y pegar adentro el contenido de
   `02_agente_ia.gs` de este repo.
3. Ir a **⚙ Configuración del proyecto** (engranaje, en la barra izquierda).
4. Bajar hasta **Propiedades de la secuencia de comandos** ▸ **Agregar propiedad**:
   - Propiedad: `GROQ_API_KEY`
   - Valor: la clave `gsk_...`
5. **Guardar propiedades de la secuencia de comandos.**
6. Volver al editor, elegir la función **`probarAgente`** y darle **Ejecutar**.
   (La primera vez pide autorización: aceptar.) En el registro tiene que decir `OK`.

Queda guardada del lado del servidor: no viaja al navegador, no está en el repo y no se
ve en el código. Para rotarla se edita esa misma propiedad, sin tocar el código.

### Paso 3 — Habilitar el permiso de salida a internet ⚠️ **el que más se olvida**

El proyecto declara sus permisos **a mano** en `appsscript.json`, así que Google usa esa lista
exacta y no deduce nada del código. Sin este paso, `probarAgente()` falla con:

```
You do not have permission to call UrlFetchApp.fetch.
Required permissions: https://www.googleapis.com/auth/script.external_request
```

1. Apps Script ▸ **⚙ Configuración del proyecto** ▸ tildar
   **"Mostrar el archivo de manifiesto `appsscript.json` en el editor"**.
2. Abrir `appsscript.json` y agregar la última línea del array:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/script.send_mail",
  "https://www.googleapis.com/auth/script.external_request"
]
```

3. Guardar y ejecutar **`probarAgente`**: Google va a pedir autorización de nuevo (ahora aparece
   *"Conectarse a un servicio externo"*). Aceptar.

> Si Google **no** vuelve a preguntar y sigue dando el error de permiso, es el mismo caso del
> 14/08/2026 con Drive: hay que revocar el acceso viejo en
> <https://myaccount.google.com/permissions> → `App_BRC` → *Eliminar todo el acceso*, y volver
> a ejecutar la función para re-autorizar. Ver punto 6 de
> [CUENTAS_Y_DESPLIEGUE.md](CUENTAS_Y_DESPLIEGUE.md).

### Paso 4 — Rutear la acción en el backend
En **`01_backend_principal.gs`**, dentro de `doPost`, tiene que estar esta línea
(ya está puesta en la copia del repo, así que se puede copiar y pegar el archivo entero):

```javascript
if (accion === "agente_consulta") return consultarAgenteIA(data);
```

### Paso 5 — Publicar
- **Apps Script:** Implementar ▸ Administrar implementaciones ▸ ✏️ ▸ Versión: **Nueva versión** ▸ Implementar.
  *Si este paso se saltea, el agente responde "El backend no devolvió una respuesta válida".*
- **GitHub:** subir `agente.js`, `index.html`, `style.css` y `app.js`.

---

## 2. Cómo funciona (por qué aguanta tablas pesadas)

El problema obvio de "una IA que consulta el Sheet" es que las hojas no entran en el
contexto del modelo: mandarle 20.000 filas de Control de Calidad sería carísimo, lentísimo
y directamente imposible. **Acá la IA nunca ve las filas.**

```
  Usuario: "¿cuál es la humedad promedio del garbanzo este año?"
     │
     ▼
  ① agente.js arma el CATÁLOGO ────────────────► ~1.100 tokens SIEMPRE,
     (hojas, columnas, tipos, valores posibles)   tenga el Sheet 100 filas o 100.000
     │
     ▼
  ② Groq recibe catálogo + pregunta
     y devuelve un PLAN en JSON:
     { dataset:"calidad",
       filtros:[{columna:"Grano", op:"=", valor:"GARBANZO"},
                {columna:"Fecha", op:"entre", valor:["2026-01-01","2026-12-31"]}],
       metricas:[{funcion:"promedio", columna:"Humedad", alias:"Humedad prom"}] }
     │
     ▼
  ③ El PLAN lo ejecuta el NAVEGADOR en JavaScript, sobre los datos que la app
     ya tenía cargados (historialCalidad, historialGeneral, …).
     Filtra, agrupa y calcula. Gratis, instantáneo y sin límite de filas.
     │
     ▼
  ④ El RESULTADO (chico: unos totales o un top 20) vuelve a Groq,
     que lo redacta en castellano. La app además muestra la tabla debajo.
```

Las dos consecuencias importantes:

- **La IA no puede inventar números.** No los tiene: los calcula la app. Lo único que
  hace la IA es traducir la pregunta a un plan y después redactar el resultado.
- **El costo no crece con el Sheet.** Crece con la cantidad de *columnas*, no de filas.

### Se adapta solo al Sheet
El catálogo se arma leyendo los datos reales: nombres de columnas, si son número, fecha
o texto, el rango de valores y —cuando son pocos— la lista de valores posibles
(`ACEPTADO | OBSERVADO | RECHAZADO`). **Si mañana agregás una columna al Sheet, el agente
la ve sin tocar una línea de código.**

### Lo que el agente nunca ve
Fotos, firmas y archivos adjuntos se filtran antes de armar el catálogo
(`AGENTE_PATRONES_OCULTOS` en `agente.js`). Son megabytes de base64 que no aportan nada
a una consulta y romperían el límite de tokens.

---

## 3. Qué puede consultar

| Dataset | Hoja del Sheet | Una fila es… |
|---|---|---|
| `cargas` | `Orden` | un camión controlado (con sus totales de productos y contratos ya calculados) |
| `productos` | `Producto` | un producto dentro de una carga |
| `contratos` | `Contrato Comercial` | un contrato / carta de porte, con la diferencia de kilos |
| `calidad` | `Control Calidad Garbanzo` + `Control de Calidad Mung` | un análisis de calidad |
| `muestreos` | `Muestreo` | un muestreo a campo |
| `puntos_muestreo` | `Muestreo_Puntos` | un punto relevado |
| `tickets` | `Tickets` | un ticket de soporte |

Ejemplos que funcionan:

- ¿Cuántas cargas hay por estatus?
- Humedad promedio del garbanzo
- Top 5 destinos por kilos
- ¿Qué chofer tuvo más cargas rechazadas?
- Cargas de abril con diferencia de descarga mayor a 500 kg
- Tickets abiertos por responsable
- Promedio de partidos por grano
- Últimas 10 cargas de Poroto Mung

---

## 4. Archivos que intervienen

| Archivo | Rol |
|---|---|
| **agente.js** | Todo el frontend: catálogo automático, motor de consultas, prompts y chat. |
| **02_agente_ia.gs** | Puente hacia Groq. Guarda la clave en Propiedades del Script; el navegador nunca la ve. |
| **01_backend_principal.gs** | Una línea en `doPost` que rutea `agente_consulta`. |
| **index.html** | El panel del chat + el `<script>` + el FAB que ahora llama a `abrirAgenteIA()`. |
| **style.css** | Estilos del panel (bloque al final del archivo). |

---

## 5. El límite del plan gratuito y el presupuesto de tokens

Esto es lo que más condiciona el diseño, así que conviene tenerlo claro.

Groq gratis da **8.000 tokens por minuto** y 1.000 consultas por día (medido contra la
API en 08/2026; es igual en todos los modelos de texto). Cada pregunta del agente son
dos llamadas: el planificador (~1.630 tokens) y el redactor (~430) → **~2.060 tokens**.

Eso da **3 o 4 preguntas por minuto**, que para uso interno alcanza bien. Pero se llegó
ahí a propósito: la primera versión gastaba 4.400 por pregunta —**una sola pregunta por
minuto**— y se bajó con tres cosas:

| Decisión | Antes | Después |
|---|---|---|
| Catálogo compacto (columnas agrupadas por tipo, línea propia solo para las de valores fijos) | 8.244 car. | 4.805 car. |
| Instrucciones del planificador acortadas | 1.924 car. | 1.210 car. |
| `reasoning_effort: "low"` (estos modelos "piensan" y ese pensamiento se paga) | 334 tokens de salida | 144 |

Por eso **no conviene agregar texto al prompt sin medir**: cada carácter viaja en cada
pregunta. Lo que sí es gratis es agregar filas al Sheet — eso no toca el prompt.

Cuando aún así se toca el techo (dos personas preguntando a la vez), Groq responde 429
diciendo cuántos segundos faltan; `02_agente_ia.gs` espera ese tiempo y reintenta hasta
dos veces, así el usuario ve una respuesta más lenta en lugar de un error.

---

## 6. Cambiar el modelo

En `agente.js`, arriba del todo:

```javascript
const AGENTE_CFG = {
    modelo: "openai/gpt-oss-120b",   // el más capaz del plan gratuito
    esfuerzo: "low",
    ...
};
```

Alternativa: `"openai/gpt-oss-20b"` — algo más rápido, mismos límites, se equivoca un
poco más armando el plan en consultas complicadas.

⚠️ **Groq da de baja modelos cada tanto.** Los `llama-3.x` que se usaban al principio
ya no existen: la API devuelve **404** y el agente deja de responder. Si pasa eso,
ejecutar **`listarModelosGroq()`** desde el editor de Apps Script para ver la lista al
día y actualizar `AGENTE_CFG.modelo`.

---

## 7. Si algo falla

| Mensaje en el chat | Qué pasó |
|---|---|
| *"You do not have permission to call UrlFetchApp.fetch"* | Falta el scope `script.external_request` en `appsscript.json` (Paso 3). |
| *"Falta cargar la clave de Groq…"* | No está la propiedad `GROQ_API_KEY` en Configuración del proyecto (Paso 2). |
| *"Groq rechazó la clave"* | La clave está mal copiada o fue revocada. Volver al Paso 2. |
| *"El modelo … ya no existe en Groq"* | Groq discontinuó el modelo. Ver la sección 6. |
| *"Groq está saturado por el límite…"* | Se tocó el techo de 8.000 tokens/minuto y los dos reintentos no alcanzaron. Esperar un minuto. |
| *"El backend no devolvió una respuesta válida"* | Falta publicar la **Nueva versión** en Apps Script (Paso 4). |
| *"No existe el conjunto de datos…"* | La IA se inventó un nombre de dataset. Reformular la pregunta con más precisión. |
| Responde con datos viejos | El agente lee lo que la app tiene cargado: tocar el botón **Actualizar** del header. |

---

## 8. Límites conocidos

- **Trabaja sobre los datos ya cargados en la app.** Si el historial no se sincronizó,
  el agente ve lo mismo (incompleto) que las pantallas. El botón *Actualizar* resuelve.
- **Un dataset por pregunta.** No cruza hojas por sí solo; para eso `cargas` ya trae
  precalculados los totales de sus productos y contratos.
- **Sin conexión no funciona.** Necesita internet para llegar a Groq.
- **La calidad de la respuesta depende de la pregunta.** Cuanto más se parezca al
  vocabulario de las columnas del Sheet, mejor arma el plan.
