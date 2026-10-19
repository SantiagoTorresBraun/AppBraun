# Diseño — Control de Calidad dividido en Cosecha y Flujo de Masa

Origen: sección 4 de *Propuesta nuevas vinculaciones.docx*. Decisiones tomadas con Lucas el 15 y 16/10/2026 (respuestas en `PREGUNTAS_PENDIENTES_LUCAS.md`, punto 9).

## Pendientes de la propuesta, en orden

| # | Punto | Estado |
|---|---|---|
| 5 | Fotos que se agrandan al tocarlas | ✅ Hecho (`visor-fotos.js`) — falta probar en el teléfono |
| 1 | Dividir en Control de Cosecha y Control de Flujo de Masa | ✅ Hecho (16/10) — las columnas del Sheet las crea el backend (sección 3) |
| 3 | Campos propios de Cosecha | ✅ Hecho (16/10) |
| 4 | Campos propios de Flujo de Masa | ✅ Hecho (16/10) |
| 2 | Vista por contrato ("carpetas") | ✅ Hecho (18/10) — ver sección 6 |

---

## 1. Decisiones

| Tema | Decisión |
|---|---|
| Dónde se guarda | **Misma hoja** de cada grano (`Control Calidad Garbanzo`, `Control de Calidad Mung`) + columna nueva **`Tipo de Control`** con valor `COSECHA` o `FLUJO DE MASA`. |
| Navegación | **Tipo → Grano**: Control de Calidad → *Cosecha* / *Flujo de Masa* → *Garbanzo* / *Poroto Mung* → historial y formulario. |
| Análisis | No cambia: calibres y defectos siguen siendo los de cada grano (`CALIDAD_CONFIG`). |
| Controles históricos (sin tipo) | **Todos van a Flujo de Masa.** No todos lo son en realidad (hay mercadería mejorada), pero se decidió así. |
| Controles nuevos | Llevan el tipo grabado según el módulo desde el que se cargaron. |
| Contrato | **Obligatorio**: Contrato de Producción en Cosecha, Contrato FM en Flujo de Masa. Es la "carpeta" del punto 2. |
| Rinde/ha | Lo **escribe el operario** (número, kg/ha). No se calcula. |
| `Muestreo en` | Se agrega la opción **Campo**. |
| Título del PDF | **No cambia**: sigue siendo "Reporte de Calidad". |

## 2. Campos del formulario por tipo

**Comunes a los dos tipos:** Fecha Análisis, Cliente, Muestreo en, Calibre, Kg, Peso de muestra y análisis completo, Humedad, Insectos, Olor, Observaciones, 4 fotos.

| Campo en pantalla | Cosecha | Flujo de Masa | Columna en el Sheet |
|---|:-:|:-:|---|
| Campo / Establecimiento | ✔ | — | **nueva** `Campo / Establecimiento` |
| Contrato de Producción | ✔ obligatorio | — | existe: `Contrato Produccion` |
| N° Lote Cliente | ✔ | — | existe: `N° Lote Cliente/Planta` |
| Rinde/ha | ✔ | — | **nueva** `Rinde/ha` (número) |
| Contrato de Flujo de Masa | — | ✔ obligatorio | existe: `Contrato FM` |
| Planta | — | ✔ (lista) | **nueva** `Planta` |
| N° Proceso | — | ✔ | existe: `N° Proceso` |
| ID Planta (partida del lote) | — | ✔ | existe: `N° Lote Cliente/Planta` (misma columna, otro nombre en pantalla) |
| N° Lote BRC | — | ✔ | existe: `N° Lote BRC` |
| N° Lote | — | ✔ | existe: `N° Lote` |
| Envase | — | ✔ | existe: `Envase` |

- **Plantas** (lista fija): Viel, 4Pulse, Tecnocampo, Prosibi. Un valor viejo que no esté en la lista se conserva igual.
- **Identificación de un lote en planta:** el N° de Proceso no se repite (ej. Viel `GI81`, 4Pulse `PR500`), pero el número de lote sí puede repetirse en procesos distintos (`LOT1`, `LOT2`…). Un lote de Flujo de Masa se identifica por **Planta + Proceso + ID Planta**, nunca por el lote solo.
- Los campos que no corresponden al tipo **se ocultan** y **no se mandan** al guardar. Así, editar un control no le borra lo que ya tenía en esas columnas.

## 3. Cambios en el Sheet: automáticos

**No hay que crear nada a mano.** Antes de guardar o editar un control,
`asegurarColumnasCalidad()` (`01_backend_principal.gs`) agrega al final de la
hoja del grano las columnas que le falten: `Tipo de Control`,
`Campo / Establecimiento`, `Rinde/ha`, `Planta`, y también `Peso Muestra (g)` y
`usuario_registro`, que antes había que crear a mano. Nunca mueve ni renombra
columnas existentes. Requiere publicar una versión nueva del Apps Script.

Hacía falta porque el backend escribe por nombre de encabezado: si faltaba una
columna, el dato se perdía sin avisar.

## 4. Controles históricos

Un control sin `Tipo de Control` se trata como **Flujo de Masa** al leerlo, en la app; no se reescribe el Sheet. El tipo queda grabado recién cuando alguien lo edita y lo guarda.

## 5. Dónde quedó cada cosa en el código

| Qué | Dónde |
|---|---|
| Tipos, regla de los históricos (`tipoControlDe`), mostrar u ocultar campos | `calidad.js` (secciones 1-B y 4) |
| Qué campos se mandan según el tipo | `calidad.js` → `construirRegistroCalidad()` |
| Pantallas Tipo → Grano, bloques del formulario, detalle | `index.html` (`view-submenu-calidad`, `view-submenu-calidad-grano`, `.cal-bloque-tipo`) |
| Lista de plantas (`plantaCalidad`) y opción "Campo" | `app.js` → `ENUMS_DEFAULT`. "Campo" se agrega una sola vez a los celulares que ya tenían la lista guardada (`agregarOpcionesNuevasEnums`) |
| PDF: datos del lote según el tipo (el título no cambia) | `calidad.js` → `generarPDFCalidad()` |
| Correo: tipo, contratos, campo y planta | `correo.js` |
| Links viejos `#/control-calidad/garbanzo` | Siguen andando: abren Flujo de Masa |

El Apps Script **no cambia**: escribe por nombre de encabezado.

## 6. Vista por contrato ("carpetas")

El historial de cada tipo y grano arranca **agrupado por contrato**: Cosecha por
Contrato de Producción y Flujo de Masa por Contrato FM. Cada carpeta muestra la
cantidad de controles, los clientes, los campos (Cosecha) o las plantas (FM),
el período y los kg. Las carpetas van de la más reciente a la más vieja, y
"Sin contrato" (donde caen los controles viejos de AppSheet) siempre al final.

- Al tocar una carpeta se ve la tabla de siempre, pero solo con sus controles.
  "← Contratos" vuelve.
- **"Nuevo Control" adentro de una carpeta** trae el contrato ya completado.
- Los filtros de fecha y la búsqueda valen para las dos vistas: con búsqueda,
  solo quedan las carpetas que tienen algún control que coincide.
- El botón **"Lista"** muestra el historial plano de antes. La elección se
  recuerda en cada dispositivo.

Código: `calidad.js`, sección 9-B (`pintarCarpetasCalidad`, `contratoCalidadDe`).
