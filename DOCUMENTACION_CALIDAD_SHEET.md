# Documentación — Historial de Control de Calidad desde Google Sheets (Sesión 10/07/2026)

Conexión del módulo Control de Calidad con las hojas **"Control Calidad Garbanzo"** y **"Control de Calidad Mung"** del mismo Google Sheet que ya usa Control de Carga, para que el historial muestre los registros existentes (cargados originalmente desde AppSheet).

Archivos afectados: `calidad.js`, `index.html`, `Codigo-COMPLETO-para-pegar.gs` (**el Apps Script completo e integrado**: contiene el código original de cargas SIN cambios + el módulo de calidad agregado. Reemplaza al viejo `google-apps-script-calidad.gs`, que fue eliminado).

---

## 1. Cómo funciona la lectura

```
App (calidad.js)                    Apps Script                      Google Sheet
cargarHistorialCalidadDesdeGoogle() ──GET ?action=read_calidad──▶ leerCalidad()
        ◀──────────── JSON [ { encabezado: valor, ... } ] ◀── hoja "Control Calidad Garbanzo"
normalizarRegistroCalidadRemoto()  →  historialCalidad  →  filtrarYRenderizarCalidad()
```

- El frontend **ya llamaba** a `?action=read_calidad`; lo que faltaba era la acción en el Apps Script.
- El backend usa `getDisplayValues()`: devuelve los valores **tal cual se ven** en el Sheet, y la app se encarga de normalizarlos. Así da igual si una celda es número con formato % o texto pegado por AppSheet.
- Las columnas de la hoja ya coinciden 1:1 con `CALIDAD_CONFIG.GARBANZO` (calibres `10mm...Bajo zaranda` y los 13 defectos), así que no hubo que tocar el modelo de datos.

## 2. Normalización en el frontend (`calidad.js`, sección 9)

Los datos de AppSheet vienen en formato "visual" y la app los convierte al entrar:

| Dato del Sheet | Ejemplo | Se convierte a | Función |
|---|---|---|---|
| Fecha `d/m/aaaa` | `8/10/2025` | `2025-10-08` | `normalizarFechaSheet()` |
| Porcentaje texto es-AR | `25,20%` | `25.2` (número) | `normalizarNumeroSheet()` |
| Miles con punto | `250.000` | `250000` | `normalizarNumeroSheet()` |
| Sin campo `Grano` | — | `"GARBANZO"` | `normalizarRegistroCalidadRemoto()` |

Sin esto fallaban: el filtro por rango de fechas, el orden "más reciente primero", los inputs numéricos al editar y los porcentajes del PDF.

**Campos normalizados:** `Fecha Analisis`, `Kg`, `Humedad`, `Materia Extraña`, los 4 totales, y todos los calibres/defectos definidos en `CALIDAD_CONFIG` (de cualquier grano — Poroto Mung quedará cubierto automáticamente al habilitarse).

## 3. Fotos

- AppSheet guarda **rutas de Drive** (`Control de Calidad_Images/83db35d9.imagen 1....jpg`), no imágenes.
- El Apps Script (`resolverImagenDrive()`) busca cada archivo en Drive y devuelve una URL de miniatura (`drive.google.com/thumbnail?id=...`), con **caché de 6 hs** (`CacheService`) para no repetir búsquedas.
- Nueva función `esImagenRenderizable()` en `calidad.js` (reemplaza el viejo chequeo `length > 100`): acepta base64 (`data:image...`, fotos sacadas desde la app) **o** URLs http (fotos de Drive). Se usa en la miniatura del historial, el preview al editar y el filtro de fotos del PDF.
- ⚠️ **Requisito**: la carpeta `Control de Calidad_Images` de Drive debe estar compartida ("cualquiera con el enlace puede ver") o los operarios no verán las miniaturas.
- Límite conocido: las fotos que son URL de Drive pueden no incrustarse en el PDF (jsPDF necesita base64); en ese caso el PDF muestra "(no se pudo incluir la imagen)" y sigue.

## 4. Backend — `Codigo-COMPLETO-para-pegar.gs`

Archivo con el Apps Script **completo** (código original de cargas intacto + módulo de calidad). Se pega reemplazando todo el contenido de `Código.gs`. La parte de calidad incluye:

| Función | Acción que atiende | Qué hace |
|---|---|---|
| `leerCalidad()` | GET `?action=read_calidad` | Lee la hoja completa, mapea por encabezados, resuelve fotos |
| `guardarCalidad(body)` | POST `_accion: "guardar_calidad"` | Agrega fila mapeando por nombre de encabezado; fotos base64 → archivo en Drive con la convención de AppSheet; porcentajes ÷100 para respetar el formato % de las celdas |
| `actualizarCalidad(body)` | POST `_accion: "actualizar_calidad"` | Actualiza la fila por `Id_Calidad` (conserva fotos existentes si no se cambiaron) |
| `eliminarCalidad(body)` | POST `_accion: "eliminar_calidad"` | Borra la fila por `Id_Calidad` |

**Pasos de instalación** (están también comentados en el `.gs`):
1. Pegar el contenido del archivo en el proyecto Apps Script existente.
2. En el `doGet(e)` actual agregar: `if (e.parameter.action === "read_calidad") return leerCalidad();`
3. En el `doPost(e)` actual agregar las 3 ramas de `_accion` (`guardar_calidad`, `actualizar_calidad`, `eliminar_calidad`).
4. **Publicar nueva versión** del deployment (Deploy → Manage deployments → Edit → New version). Sin este paso los cambios no se aplican.
5. Si se quiere auditoría: agregar la columna `usuario_registro` a la hoja — como el guardado mapea por nombre de encabezado, el dato llega solo.

## 5. Segundo grano: Poroto Mung (agregado en la misma sesión)

El módulo de calidad es **multi-grano por diseño**: cada grano se define en `CALIDAD_CONFIG` (`calidad.js`) y el backend mapea cada grano a su hoja.

### Qué se hizo para habilitar Mung

| Pieza | Cambio |
|---|---|
| `calidad.js` → `CALIDAD_CONFIG.POROTO_MUNG` | `habilitado: true` + calibres `4mm, 3,5mm, 3,25mm, 3mm, Bajo zaranda` + los 17 defectos exactos de la hoja (`Descolorido`, `Lev. Descoloridos`, `Otro tipo`, `Lev. Manchados`, `Cascados`, `Pelados/Descorticados`, `Daño Mecanico`, `Arrugados`, `Helados`, etc.) |
| `index.html` | Card "Poroto Mung" activada (se quitó el overlay "Próximamente") |
| Apps Script | `HOJAS_CALIDAD_POR_GRANO`: mapa grano → hoja. Para Mung acepta varios nombres posibles (`Control de Calidad Mung`, `Control Calidad Mung`, `Control Calidad Poroto Mung`) y usa la primera que exista |
| Apps Script → `leerCalidad()` | Recorre las hojas de **todos** los granos y devuelve las filas juntas, cada una con su campo `Grano`; la app filtra por grano en el historial |
| Apps Script → guardar/actualizar/eliminar | Enrutan a la hoja correcta según el campo `Grano` del registro; si no viene, buscan el `Id_Calidad` en todas las hojas |
| `calidad.js` → `eliminarCalidad()` | El POST de borrado ahora incluye `Grano` para que el backend vaya directo a la hoja correcta |

### ⚠️ Ojo con el nombre de la hoja de Mung

El script prueba los tres nombres listados arriba. Si la hoja se llama distinto, agregar el nombre exacto en `HOJAS_CALIDAD_POR_GRANO["POROTO_MUNG"]` (primera posición) y republicar.

### Cómo agregar un tercer grano en el futuro

1. En `calidad.js` → `CALIDAD_CONFIG`: agregar la entrada con `habilitado: true`, `nombre`, `ruta`, `calibres` y `defectos` (los nombres deben coincidir **exactamente** con los encabezados de la hoja).
2. En `index.html`: duplicar una card del submenú de calidad con `onclick="abrirModuloCalidad('CLAVE_NUEVA')"`.
3. En el Apps Script → `HOJAS_CALIDAD_POR_GRANO`: agregar `"CLAVE_NUEVA": ["Nombre de la hoja"]`.
4. Si el grano tiene columnas de porcentaje nuevas: agregarlas a `COLUMNAS_PORCENTAJE_CALIDAD` en el Apps Script.
5. Republicar el deployment (nueva versión).

## 6. PDF del Control de Calidad — réplica del reporte original (agregado en la misma sesión)

Se reescribió `generarPDFCalidad()` (`calidad.js`, sección 11) para replicar el reporte de AppSheet y sumar gráficos:

**Página 1 — Reporte:** header rojo redondeado "Reporte de Calidad" con logo Braun blanco · Cliente y N° Proceso · tabla izquierda "Condición del Lote" (N° Lote, Lote Cliente/Planta, Calibre, Fecha AC, Envase, Kg formato es-AR) con **sello SENASA** debajo (logo embebido en base64, constante `LOGO_SENASA`) · tabla derecha "Análisis" con grupos Granos Buenos / Defectos y Daños / Condiciones y filas de total en barra oscura · Observaciones · nota legal en itálica. Los totales se **recalculan** desde los valores (la hoja no guarda columnas de total).

**Página 2 — Fotos:** grilla 2×2 con banners naranjas ("MUESTRA GENERAL 1:", "FOTO EN MANO 2:", "CALIBRES 3:", "DAÑOS 4:"). Las fotos de Drive ahora **sí se incluyen**: se descargan con `fetch` (Drive envía `Access-Control-Allow-Origin: *`, verificado) y se recortan al aspecto de la celda sin deformarse (`recortarImagenACaja`). Si una foto no se puede descargar, el PDF sigue sin ella.

**Página 3 — Resumen Gráfico:**
- **Torta "Composición de la muestra (%)"**: calibres en tonos de **verde** (asignación fija por posición), Bajo zaranda en **amarillo**, Total de daños en **azul**. Cada porción lleva su % directo (si entra) y todas figuran en la leyenda con nombre + valor — la identidad nunca depende solo del color.
- **Barras "Defectos y daños registrados (%)"**: horizontales, un solo tono azul, solo defectos > 0 ordenados de mayor a menor, con el valor al lado de cada barra.
- Los gráficos se dibujan en un canvas a 3× de resolución y se insertan como imagen (nítidos al imprimir).

Notas: la generación ahora es `async` (descarga las fotos antes de armar el documento; el cursor muestra "espera" mientras tanto). El archivo `logo-senasa.png` quedó también en la carpeta del proyecto como referencia.

## 7. Vista Detalle de un control (solo lectura, agregada en la misma sesión)

Mismo patrón que el detalle de Control de Carga:

- **Click en cualquier fila del historial** de calidad → se abre `#view-detalle-calidad` (nueva vista en `index.html`, reutiliza las clases CSS `detalle-*` existentes, sin CSS nuevo).
- Muestra todo en modo lectura: Información General, Lotes y Contratos, Análisis de Calibre con total, Defectos con total (totales recalculados), Condición de la Muestra (Insectos/Olor con ✓/✕), Observaciones y Registro Fotográfico.
- Botones al pie: **Editar** (deriva a `cargarCalidadParaEditar`, igual que el lápiz ✏), **Descargar PDF**, **Eliminar** (con confirmación) y **Volver**.
- Los botones de la columna Acciones (✏ 🗑 PDF) siguen funcionando igual: esa celda tiene `stopPropagation`, así que no abren el detalle.
- Funciones nuevas en `calidad.js` (sección 10-A): `abrirDetalleCalidad`, `cerrarDetalleCalidad`, `editarDesdeDetalleCalidad`, `pdfDesdeDetalleCalidad`, `eliminarDesdeDetalleCalidad`.

## 8. Cómo probar

1. Instalar el `.gs` y republicar el deployment.
2. Probar en el navegador: `<URL_DEL_WEB_APP>?action=read_calidad` → debe devolver un JSON con las filas de la hoja (ej. el registro `83db35d9` de ASIAGRO).
3. En la app: Menú → Control de Calidad → Garbanzo → el historial debe listar los registros del Sheet con fecha, cliente, lote/variedad y Kg.
4. Probar los filtros Desde/Hasta y la búsqueda rápida (cliente, lote, contrato).
5. Abrir un registro con ✏ → el formulario debe cargar todos los porcentajes como números (ej. `8mm = 25.2`).
6. Descargar el PDF de un registro del Sheet → todas las secciones con sus valores.
