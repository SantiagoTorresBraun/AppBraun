# Inventario del proyecto de Apps Script — "mIGRACION"

Qué hay adentro del backend, qué se usa, qué está en desuso y cómo se llama cada archivo
después de la limpieza.

- **Proyecto**: `mIGRACION` (el nombre quedó de una migración vieja; **es el backend real de la app**)
- **ID**: `18iIQlwh_9BT_HBnhdUgSUw2oGHqytkEI-7bv8UvwJ4dx4hbsZQPnD-vU`
- **Editor**: <https://script.google.com/u/0/home/projects/18iIQlwh_9BT_HBnhdUgSUw2oGHqytkEI-7bv8UvwJ4dx4hbsZQPnD-vU/edit>
- **Está pegado adentro del Sheet** `BD_BRC` (usa `getActiveSpreadsheet()`)

> **La fuente de verdad es el editor de Apps Script, no el repo.**
>
> - ✅ **[01_backend_principal.gs](01_backend_principal.gs)** — copia fiel del `Código.gs` de
>   producción, sincronizada el 14/08/2026. Es la que hay que leer.
> - 🗑️ **`Codigo-COMPLETO-para-pegar.gs`** — versión vieja del backend, **borrada del repo el
>   14/08/2026**. Queda en el historial de git por si hiciera falta consultarla. Las bitácoras
>   viejas (`DOCUMENTACION_*.md`) todavía la mencionan por su nombre de entonces.

---

## Configuración actual (`appsscript.json`)

```json
{
  "timeZone": "America/Argentina/Buenos_Aires",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

- `executeAs: USER_DEPLOYING` → el script corre **con la identidad de Santiago Torres**. Por eso
  no hace falta compartir las carpetas de Drive con nadie.
- `access: ANYONE_ANONYMOUS` → cualquiera con la URL del Web App puede llamarlo sin iniciar
  sesión. Es **necesario** para que la app funcione (no pide login de Google), pero implica que
  quien tenga la URL puede escribir en el Sheet.

---

## Estado de los archivos

Leyenda: 🟢 en uso · 🟡 mantenimiento (se corre a mano) · ⚪ histórico (ya cumplió) · 🔴 a borrar

| # | Archivo actual | Estado | Nombre propuesto | Qué es |
|---|---|---|---|---|
| 1 | `Código.gs` | 🟢 **En uso** | `01_backend_principal.gs` | Todo el backend: `doPost`, `doGet`, Control de Carga, Calidad, Producción, Ticketera, Usuarios y las funciones de Drive. **Es el que atiende a la app.** ✅ Copiado al repo el 14/08/2026 (45 funciones, sintaxis verificada). |
| 2 | `Sin titulo.gs` | ⚪ Histórico | `91_migracion_appsheet_orden.gs` | Migración única de rutas AppSheet → links de Drive en la hoja `Orden` (fotos y firmas). **Ya ejecutada.** |
| 3 | `Sin titulo 2.gs` | ⚪ Histórico | `93_migracion_links_lh3_orden.gs` | **Parte 2 de la #2**: convierte los links `uc?export=view&id=…` de la hoja `Orden` al formato `lh3.googleusercontent.com/d/…`. Función `convertirLinksAFormatoEstable()`. **Verificado: no duplica nada** (ojo, existe `convertirArchivosCPAFormatoEstable()` en el backend, pero es otra función, para la columna CP). |
| 4 | `Sin titulo 3.gs` | ⚪ Histórico | `94_migracion_appsheet_calidad_garbanzo.gs` | Gemela de la #6, pero para **Control Calidad Garbanzo**. Función `reemplazarRutasPorLinksCalidad()`. Aporta el ID de `Control de Calidad_Images`: `1H7tnYi-9J4R-XpwHCTzUHN3Iq5mMJqVV`. **Verificado: no duplica nada.** |
| 5 | `Sin titulo 4.gs` | 🔴 **BORRAR** | — | **Copia vieja y completa del backend.** Duplica `doPost`, `doGet`, `guardarCalidad`, `guardarFotoCalidadEnDrive`, `resolverImagenDrive`, toda la Ticketera, Usuarios y todas las variables de config. **Causa raíz del bug de las fotos** (ver abajo). |
| 6 | `mungo.gs` | ⚪ Histórico | `92_migracion_appsheet_calidad_mung.gs` | Gemela de la #2, pero para las columnas `imagen 1..4` de **Control de Calidad Mung**. Función `reemplazarRutasPorLinksCalidadMung()`. **Verificado: no duplica nada** de `01_backend_principal.gs`. |

---

## 🔴 CAUSA RAÍZ ENCONTRADA — `Sin titulo 4.gs` (14/08/2026)

`Sin titulo 4.gs` es una **copia vieja del backend completo**, no una migración. Como todos los
`.gs` de un proyecto se fusionan en un único espacio global, sus funciones **conviven** con las
de `Código.gs` y **la que queda activa es la del archivo que va último en el orden del
proyecto** — que es justamente este.

Resultado: las mejoras de `Código.gs` estaban siendo anuladas.

### Funciones duplicadas y qué versión estaba ganando

| Función | En `Código.gs` (buena) | En `Sin titulo 4.gs` (vieja) |
|---|---|---|
| `guardarFotoCalidadEnDrive` | `setSharing` + `throw` en el error | **sin `setSharing`** + `return ""` |
| `resolverImagenDrive` | `setSharing` defensivo, caché negativo 10 min | sin `setSharing`, caché negativo 6 h |
| `guardarCalidad` | Idempotencia + formato `%` | sin ninguna de las dos |
| `actualizarCalidad` | Aplica formato `%` | no lo aplica |
| `doPost` / `doGet` | **Incluye el módulo Producción** | **NO tiene Producción** |

### Los tres síntomas que esto explica

1. **Fotos de calidad que no se ven** → se subían sin `setSharing`, quedaban privadas.
2. **Celdas de imagen vacías** (caso `CC-1786551649221`) → el `catch` devolvía `""`, la fila se
   guardaba igual y la app borraba su copia local: la foto se perdía sin aviso.
3. **Módulo Producción posiblemente roto** → el `doPost` viejo no conoce `guardar_muestreo`,
   así que responde *"Acción desconocida"*. **Verificar si los muestreos se están guardando.**

### Cronología de las tres versiones del backend

1. `Sin titulo 4.gs` — la más vieja (sin módulo Producción) → **borrar**
2. `Codigo-COMPLETO-para-pegar.gs` (repo, ya borrada) — intermedia (con Producción, sin los arreglos de calidad)
3. `Código.gs` — la más nueva y correcta → **la que se conserva**

---

## Mapa de las migraciones (todas ya ejecutadas)

Vinieron de pasar los datos de **AppSheet** a esta app. En AppSheet las celdas guardaban una
*ruta* (`Control de Calidad_Images/foto.jpg`), no un link, así que hubo que convertirlas.

| Módulo | Hoja | Carpeta de Drive (ID) | Script |
|---|---|---|---|
| Control de Carga | `Orden` | `Orden_Images` — `1q-yxP54ZAlnQJdHYRBpfzKoOaU8brvWU` | `91_` (rutas → `uc?export=view`) y después `93_` (`uc` → `lh3`) |
| Calidad Garbanzo | `Control Calidad Garbanzo` | `Control de Calidad_Images` — `1H7tnYi-9J4R-XpwHCTzUHN3Iq5mMJqVV` | `94_` |
| Calidad Mung | `Control de Calidad Mung` | (histórica de Mung) — `1-z_4e3Qn2r3Dd6n8F6pzcZ2cDUHLG5Xj` | `92_` |
| Cartas de Porte | `Contrato Comercial` | `Contrato Comercial_Files_` | `convertirArchivosCPAFormatoEstable()`, dentro del backend |

**Por qué solo `Orden` tuvo una "parte 2"**: las fotos de Calidad no necesitan convertirse al
formato `lh3` en el Sheet porque el front ya lo hace al vuelo, con
`normalizarUrlImagenDrive()` ([calidad.js:456](calidad.js#L456)). Las de `Orden` no pasan por
esa función, así que hubo que dejarlas convertidas en la propia celda.

---

## Criterio: ¿borrar o archivar?

**Archivar (renombrar con prefijo `9x_` y dejar) cuando:**
- La función no la llama nadie (no está en `doPost` ni `doGet`) → no puede ejecutarse sola.
- Es idempotente: si se corre de nuevo, no rompe nada (saltea lo ya migrado).
- Documenta cómo se migraron datos que hoy están en producción.

**Borrar cuando:**
- Es una copia vieja de una función que ya existe en `01_backend_principal.gs` → **esto no es
  opcional, hay que borrarlo**: los archivos `.gs` comparten un único espacio global y la
  función duplicada pisa a la buena de forma silenciosa.
- Es código de prueba que no se terminó.

> **Antes de borrar cualquier cosa**: guardar una copia del archivo en esta carpeta del repo.
> Apps Script tiene historial de versiones, pero es incómodo de recuperar.

---

## Bugs detectados en el backend (pendientes)

| Bug | Dónde | Estado |
|---|---|---|
| `URL_APP_TICKETERA = "http://127.0.0.1:5500/..."` — el botón "Abrir Ticketera" de los correos apunta a la PC local de quien lo recibe, así que **no le funciona a nadie** | `Código.gs` | 🔴 Sin resolver — falta saber la URL pública de la app |
| La implementación activa puede ser más vieja que el código del editor (editar **no** publica) | Implementaciones | ❓ Verificar en *Implementar → Administrar implementaciones* |
| Posible falta del scope `.../auth/drive`: deja leer pero no crear archivos | Autorización | ❓ Verificar en *Ejecuciones* |

---

## Funciones de mantenimiento (correr a mano, nunca solas)

Ya existen dentro de `Código.gs`. La idea es moverlas a `90_mantenimiento.gs`.

| Función | Para qué |
|---|---|
| `repararFotosCalidad()` | Comparte las fotos de calidad que quedaron privadas y limpia el caché de fallos |
| `repararFormatoPorcentajesCalidad()` | Aplica formato `0.00%` a las columnas de porcentaje |
| `convertirArchivosCPAFormatoEstable()` | Convierte rutas de Carta de Porte en links estables de Drive |
| `diagnosticoDrive()` | Muestra dónde está guardando la app hoy y si hay carpetas duplicadas |
| `revisarFotosDeUnControl()` | Revisa un control de calidad puntual y sus fotos |
