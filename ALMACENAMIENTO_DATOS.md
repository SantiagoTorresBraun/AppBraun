# Dónde se guardan los datos — App Braun

Mapa único de persistencia: qué dato vive dónde, con qué ID/nombre, y quién lo escribe.
Si algún dato "desaparece" o no se sincroniza, se empieza a buscar acá.

---

## Resumen en una línea

La app **no tiene servidor propio ni base de datos**. Todo termina en **un Google Sheet**
(las tablas) y en **carpetas de Google Drive** (los archivos), a través de un **Google Apps
Script** publicado como Web App. En el celular hay una copia temporal en **IndexedDB** para
poder trabajar sin señal.

```
Celular / navegador                    Google (cuenta corporativa)
┌────────────────────────┐             ┌──────────────────────────────────┐
│ IndexedDB (offline)    │  fetch      │ Apps Script (Web App /exec)      │
│ localStorage (sesión)  │ ──────────► │        │                         │
└────────────────────────┘             │        ├──► Google Sheet (hojas) │
                                       │        └──► Google Drive (files) │
                                       └──────────────────────────────────┘
```

---

## 0. La cuenta dueña de todo

**`santiago.torres@braunrelacionescomerciales.com.ar`** (Santiago Torres) es el owner del Sheet,
del Drive y la cuenta que autorizó el Apps Script.

- **Sheet**: <https://docs.google.com/spreadsheets/d/1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M/edit>
- Las carpetas de archivos están en **Mi unidad** de esa misma cuenta.

> Es el **punto único de falla** de toda la app: si esa cuenta se suspende o se da de baja,
> dejan de funcionar el guardado, las fotos y los correos de la Ticketera al mismo tiempo.

---

## 1. Los tres lugares de almacenamiento

| Lugar | Qué guarda | Persistencia |
|---|---|---|
| **Google Sheet** | Todos los registros (tablas) | Definitiva — es la fuente de verdad |
| **Google Drive** | Fotos de calidad y producción, archivos de Carta de Porte | Definitiva |
| **IndexedDB / localStorage** (en el dispositivo) | Cola offline + sesión + listas desplegables | Temporal — se borra al limpiar datos del navegador |
| **Propiedades del Script** (Apps Script) | Secretos del backend: hoy solo `GROQ_API_KEY` | Definitiva — no viaja al navegador ni está en el repo |

> **Ningún secreto va en un archivo del repo.** El repositorio es público (es lo que publica
> GitHub Pages), así que una clave escrita en un `.gs` o un `.js` quedaría a la vista de todos
> apenas se haga push. Van en *Apps Script ▸ ⚙ Configuración del proyecto ▸ Propiedades del
> script*. Ver [DOCUMENTACION_AGENTE_IA.md](DOCUMENTACION_AGENTE_IA.md).

---

## 2. Google Apps Script (el intermediario)

- **URL del Web App** (constante `WEB_APP_URL` en [app.js:39](app.js#L39)):
  `https://script.google.com/macros/s/AKfycbxER7E6CJhddVOrP7gaTDSM1albRvEAGUHnWcdBM7SoXzDJeklCvZDY_Aj0Cd1Xv6znyA/exec`
- **Código fuente**: [01_backend_principal.gs](01_backend_principal.gs) (y
  [02_agente_ia.gs](02_agente_ia.gs) para el Agente de IA) — estos archivos del repo
  **no se ejecutan solos**. Son copias para pegar en el editor de Apps Script.
- **Dónde vive realmente**: adentro del Google Sheet → *Extensiones → Apps Script*.
- El script usa `SpreadsheetApp.getActiveSpreadsheet()`, o sea escribe **en el Sheet que lo contiene**.
  No hay un ID de Sheet escrito en el `.gs`: el vínculo es "el script está pegado adentro de ese Sheet".

> **Cada vez que se toca el `.gs` hay que volver a "Implementar → Nueva implementación"**, si no,
> la app en producción sigue usando la versión vieja. Si se genera una URL nueva, hay que
> actualizarla en [app.js:39](app.js#L39).

---

## 3. Google Sheet — hojas y qué guarda cada una

**ID del Sheet conocido**: `1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M`
(constante `CALIDAD_SHEET_ID` en [calidad.js:494](calidad.js#L494))
→ `https://docs.google.com/spreadsheets/d/1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M`

| Hoja | Qué guarda | Escrita por | Definida en |
|---|---|---|---|
| **Orden** | Cabecera de cada Control de Carga: chofer, patentes, checklist, firmas, las 8 fotos, kg, correo | `guardarRegistroCompleto()` | `NOMBRE_HOJA_ORDEN` |
| **Producto** | Renglones de productos de cada carga (producto, calibre, lote, envase, kg) — 1:N con Orden vía `Id_Carga` | `guardarRegistroCompleto()` | `NOMBRE_HOJA_PRODUCTO` |
| **Contrato Comercial** | Contratos asociados a cada carga + link al archivo de Carta de Porte | `guardarRegistroCompleto()` | `NOMBRE_HOJA_CONTRATO` |
| **Control Calidad Garbanzo** | Análisis de calidad de garbanzo (calibres, defectos, fotos) | `guardarCalidad()` | `HOJAS_CALIDAD_POR_GRANO` |
| **Control de Calidad Mung** | Ídem poroto mung. Acepta también los nombres `Control Calidad Mung` / `Control Calidad Poroto Mung` | `guardarCalidad()` | `HOJAS_CALIDAD_POR_GRANO` |
| **Muestreo** | Cabecera de cada muestreo a campo (módulo Producción) | `guardarMuestreo()` | `NOMBRE_HOJA_MUESTREO` |
| **Muestreo_Puntos** | Puntos individuales de cada muestreo (conteos, notas, foto) — 1:N con Muestreo | `guardarMuestreo()` | `NOMBRE_HOJA_MUESTREO_PUNTOS` |
| **Tickets** | Ticketera compartida (creación, reasignación, respuestas, cierre) | `crearTicket()` | `HOJA_TICKETS` |
| **Usuarios** | Usuarios "extra" agregados desde la app | `agregarUsuario()` | `HOJA_USUARIOS` |

Las hojas **Tickets** y **Usuarios** se **crean solas** si no existen (`ss.insertSheet(...)`).
Las demás **deben existir con ese nombre exacto**, si no el guardado falla.

### Nota sobre permisos de lectura del Sheet

El historial de calidad **no** pasa por el Apps Script: [calidad.js:498](calidad.js#L498) lee el Sheet
directamente con el endpoint público `gviz/tq`. Eso obliga a que el Sheet esté compartido como
**"Cualquiera con el enlace: Lector"**. Si alguien restringe ese permiso, el módulo de Calidad
deja de mostrar historial (el resto de la app sigue funcionando).

---

## 4. Google Drive — mapa real (relevado el 14/08/2026)

Todo cuelga de **`APP_Braun_2026`** (ID `16KZ6y9waJ085okNZtAR9xopGWa392AVN`), en *Mi unidad* de
`santiago.torres@braunrelacionescomerciales.com.ar`. La carpeta madre está en **PRIVATE**, que es
lo correcto: los permisos de lectura se ponen archivo por archivo, no en el contenedor.

```
APP_Braun_2026                      16KZ6y9waJ085okNZtAR9xopGWa392AVN   PRIVATE
├── BD_BRC  (el Sheet)              1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M
├── File                            19UR340CNxQzAh1HEghgAKR5KldvAcF4S
│   ├── Contrato Comercial_Files_   1LqczuwlcwXYINxHYR61UEQ-DsWaEeV9t     453 arch.  🟢 ACTIVA
│   ├── Orden_Files_                1RpdWDtbWRhYfyuyKrdTj90kg3PkyxV8w     182 arch.  ⚪ histórica
│   ├── Control de CargaMP CP_Files_ 1jFR8o8wSIL99AHp6a7hh0J94nyBWJZJz      2 arch.  ⚪ histórica
│   └── Produccion_Files_           (NO EXISTE — se crea sola acá)          0 arch.  🟢 ACTIVA
└── Images                          1I1wrnxYh9Z4IUkiMVTl5Hy2b3t6oF-e-
    ├── Control de Calidad_Images   1H7tnYi-9J4R-XpwHCTzUHN3Iq5mMJqVV     252 arch.  🟢 ACTIVA
    ├── Orden_Images                1q-yxP54ZAlnQJdHYRBpfzKoOaU8brvWU    2920 arch.  ⚪ histórica
    ├── Control de CalidadMUNG_Images 1-z_4e3Qn2r3Dd6n8F6pzcZ2cDUHLG5Xj   137 arch.  ⚪ histórica
    └── Contrato Comercial_Images   1YEhGMBs-fN2JvYnDHngzjFJnQhDuHWy8       3 arch.  ⚪ histórica
```

**Total: 3.949 archivos.**

### Las 3 carpetas donde la app escribe HOY

| Carpeta | ID | Qué guarda |
|---|---|---|
| `Control de Calidad_Images` | `1H7tnYi-9J4R-XpwHCTzUHN3Iq5mMJqVV` | Fotos de Control de Calidad (nuevas + históricas de Garbanzo) |
| `Contrato Comercial_Files_` | `1LqczuwlcwXYINxHYR61UEQ-DsWaEeV9t` | Archivos de Carta de Porte |
| `Produccion_Files_` | *(pendiente — se crea sola en `File/`)* | Fotos de muestreo a campo |

### Las 5 históricas — NO se tocan

No las busca el código, pero **las celdas del Sheet apuntan a esos archivos**. Además,
`resolverImagenDrive()` y `resolverArchivoDrive()` buscan archivos **por nombre en todo el
Drive**, así que igual los encuentran estén donde estén. Se pueden **mover**, nunca **borrar**.

### ⚠️ Propiedad de las carpetas

Las 7 carpetas de datos son propiedad de **`analistabrc@gmail.com`** (cuenta personal de
Santiago, distinta de la corporativa). Solo `File` e `Images` son de la cuenta corporativa.

Google **no permite transferir propiedad** entre una cuenta `@gmail.com` y una de Workspace de
otro dominio, así que esto **no se puede cambiar** y no hace falta intentarlo. Consecuencia
operativa: hay que **mantener el acceso a las dos cuentas**. Si se pierde la de Gmail, se pierden
los 3.949 archivos aunque el Sheet siga intacto.

### Identificación por ID (desde el 14/08/2026)

Antes las carpetas se buscaban **por nombre** con `DriveApp.getFoldersByName(...)`: cualquier
renombre hacía que la app creara una carpeta nueva y vacía **en la raíz de Mi unidad**, y los
archivos viejos quedaban huérfanos.

Ahora se buscan **por ID** ([01_backend_principal.gs](01_backend_principal.gs), bloque
`CONFIGURACIÓN DE CARPETAS`). El ID no cambia nunca: ni al renombrar, ni al mover, ni al cambiar
de dueño. La función `obtenerCarpetaApp()` intenta en este orden:

1. Por **ID** (lo normal).
2. Si el ID falla o está vacío, por **nombre**.
3. Si no existe, la **crea dentro de `File/` o `Images/`** — nunca suelta en la raíz.

Todo archivo subido queda con permiso **"cualquiera con el enlace puede ver"**
(`DriveApp.Access.ANYONE_WITH_LINK`) para que la app pueda mostrarlo sin pedir login de Google.

**Cómo se referencian desde el Sheet**: en la celda se guarda una ruta estilo AppSheet
(`Contrato Comercial_Files_/<id>.CP.<timestamp>.<ext>`), no una URL. Al leer, el script la
resuelve a un link real con `resolverImagenDrive()` / `resolverArchivoDrive()`, con caché.

### 4.1 Cómo ordenar todo en una carpeta madre SIN romper nada

**Estructura destino** (carpeta creada en agosto de 2026):

```
Mi unidad/
└── APP_Braun_2026/            ← PRIVADA, no compartir con nadie
    ├── BD_BRC   (el Sheet)    ← conserva su propio permiso de lectura pública
    ├── Contrato Comercial_Files_
    ├── Produccion_Files_
    ├── Control de Calidad_Images
    └── Orden_Images           ← histórica de AppSheet, NO borrar
```

> **La carpeta madre NO se comparte.** El Apps Script corre con la identidad del dueño
> (`executeAs: USER_DEPLOYING`), así que ya tiene acceso total sin compartir nada. Y como en
> Drive los permisos se **heredan hacia abajo**, hacerla pública expondría el Sheet entero con
> todos los datos de la empresa. Los permisos de lectura se ponen **archivo por archivo**, y de
> eso se encarga el script solo (`setSharing`).

El **nombre del archivo Sheet** se puede cambiar libremente (el backend lo encuentra con
`getActiveSpreadsheet()` y el front por ID, nunca por nombre). Lo que **no** se puede tocar son
los **nombres de las pestañas** ni los de las carpetas de archivos.

Los pasos, en orden:

**Paso 1 — Mover (esto solo ya es seguro).**
En Drive, crear una carpeta, por ejemplo **`App Braun - Datos`**, y arrastrar adentro las tres
carpetas existentes.

- ✅ **Mover NO rompe nada.** El código busca por nombre en todo el Drive, sin importar en qué
  carpeta esté. Los links de las fotos ya guardadas tampoco se rompen: apuntan al archivo por
  su ID, que no cambia al moverlo.
- ❌ **NO renombrar las carpetas.** Los nombres (`Contrato Comercial_Files_`, `Produccion_Files_`,
  `Control de Calidad_Images`) son los que el código busca. Si se cambian, la app crea carpetas
  nuevas vacías y deja de encontrar los archivos viejos.
- ❌ **NO dejar duplicados.** Si aparecen dos carpetas con el mismo nombre, el script usa la
  primera que encuentra y la otra queda invisible. Verificarlo con `diagnosticoDrive()`.

**Paso 2 — Fijar la carpeta madre (opcional, pero recomendado).**
Una vez movidas, abrir la carpeta madre en Drive y copiar el ID de la barra de direcciones:

```
https://drive.google.com/drive/folders/1AbCdEfGh...  ← esta última parte es el ID
```

Pegarlo en `ID_CARPETA_MADRE` al principio del `.gs` y volver a implementar. Desde ese momento
la app trabaja **siempre adentro de esa carpeta** y deja de depender de los nombres: ahí sí se
pueden renombrar las subcarpetas o tener nombres repetidos en otro lado sin consecuencias.

> Mientras `ID_CARPETA_MADRE` esté en `""`, todo sigue funcionando como siempre (búsqueda por
> nombre). Es un cambio que se puede hacer con calma, sin apuro.

---

## 5. Las fotos de Control de Carga NO van a Drive

Diferencia importante respecto de Calidad y Producción:

| Módulo | Dónde terminan las fotos |
|---|---|
| Control de Calidad | Archivo en Drive (`Control de Calidad_Images`) + ruta en la celda |
| Producción / Muestreo | Archivo en Drive (`Produccion_Files_`) + ruta en la celda |
| **Control de Carga** | **Base64 completo dentro de la celda del Sheet** (hoja `Orden`, cols. Foto1–Foto8 + firmas) |

En `guardarRegistroCompleto()` de [01_backend_principal.gs](01_backend_principal.gs) las 8 fotos y las dos firmas se escriben tal
cual llegan desde el front ([app.js:1522](app.js#L1522)), sin pasar por Drive.

> ⚠️ **Riesgo a verificar**: Google Sheets limita cada celda a **50.000 caracteres**. Una foto en
> base64 puede superar ese límite según la compresión que aplique el celular, y la escritura
> falla o se trunca. Conviene revisar si conviene migrar estas fotos a Drive como ya se hace en
> los otros dos módulos.

---

## 6. Almacenamiento local (en el dispositivo)

### IndexedDB — base `AppBraunDB_v4`, versión 3 ([app.js:3](app.js#L3))

| Object store | Qué guarda |
|---|---|
| `controles_carga` | Cargas pendientes de sincronizar + caché del historial |
| `controles_calidad` | Controles de calidad pendientes |
| `muestreos` | Muestreos de producción pendientes |
| `ticketera_tickets` | Tickets cacheados localmente |

Todos con `keyPath: "id", autoIncrement: true`. Es una **cola de salida**: lo que se carga sin
señal queda acá hasta que se sincroniza con el Sheet.

> Si se sube la versión de la base (el `3` en `indexedDB.open`), hay que contemplar la migración
> en `onupgradeneeded` — si no, se pierden los registros pendientes de los dispositivos.

### localStorage

| Clave | Qué guarda | Definida en |
|---|---|---|
| `braun_sesion_v1` | Sesión del usuario logueado (vence a las 24 hs) | [auth.js:15](auth.js#L15) |
| `braun_usuarios_extra_v1` | Usuarios agregados desde la app (espejo de la hoja `Usuarios`) | [auth.js:40](auth.js#L40) |
| `braun_enums_v1` | Listas desplegables editables (productos, calibres, destinos…) | [app.js:46](app.js#L46) |

> Los **ENUMS viven solo en el dispositivo**. Si un usuario agrega un producto nuevo a la lista,
> ese cambio **no se comparte** con los demás ni sobrevive a un borrado de datos del navegador.

---

## 7. Checklist si algo deja de guardarse

1. ¿El Apps Script está **implementado** con la última versión del `.gs`?
2. ¿La `WEB_APP_URL` de [app.js:39](app.js#L39) coincide con la implementación activa?
3. ¿Existen las hojas con el **nombre exacto** (`Orden`, `Producto`, `Contrato Comercial`, …)?
4. ¿El Sheet sigue compartido como **"cualquiera con el enlace: Lector"**? (afecta a Calidad)
5. ¿Alguien renombró/duplicó las carpetas de Drive?
6. ¿El registro quedó atascado en IndexedDB? (revisar la cola de pendientes en la app)
7. ¿La cuenta que autorizó el Apps Script sigue activa y con cuota de Drive?

---

## 8. Herramientas de diagnóstico (ejecutar a mano en Apps Script)

Al final del `.gs` hay tres funciones que **no** las llama la app: se corren a mano desde
*Extensiones → Apps Script*, eligiéndolas en el desplegable de arriba y tocando **Ejecutar**.
El resultado sale en **Registro de ejecución**.

| Función | Para qué sirve |
|---|---|
| `diagnosticoDrive()` | Dice el ID/URL del Sheet, sus hojas, y para cada carpeta: dónde está, cuántos archivos tiene y **si hay carpetas duplicadas** con el mismo nombre. |
| `revisarFotosDeUnControl()` | Revisa un control puntual (por defecto `CC-1786551649221`, se cambia adentro de la función) y dice columna por columna si la foto se guardó y si el archivo existe en Drive. |
| `repararPermisosFotosCalidad()` | Pone en "cualquiera con el enlace puede ver" todas las fotos de calidad que quedaron privadas por el bug del punto 9. Se puede correr varias veces sin riesgo. |

---

## 9. Bug corregido: las fotos de Calidad quedaban privadas

**Síntoma**: en `Control Calidad Garbanzo` había registros con las columnas
`imagen 1..4` vacías o con links que no abrían.

**Causa**: `guardarFotoCalidadEnDrive()` subía el archivo a Drive pero **nunca llamaba a
`setSharing(ANYONE_WITH_LINK)`**, a diferencia de las otras dos funciones equivalentes
(`guardarArchivoContratoEnDrive` y `guardarFotoMuestreoEnDrive`, que sí lo hacían). La foto
quedaba privada y la app no podía mostrarla.

**Agravante**: el `catch` devolvía `""`, así que si la subida fallaba la celda quedaba vacía
**sin ningún aviso**. Y como el front borra el registro de IndexedDB apenas el POST responde
(usa `mode: "no-cors"`, que no permite leer si el guardado salió bien), la foto se perdía
definitivamente. Ahora la celda queda con `ERROR_SUBIDA: <motivo>` para poder detectarlo.

### ✅ Resuelto: el front ahora sabe si el guardado salió bien

Hasta el 14/08/2026 **todos** los envíos usaban `mode: "no-cors"`. Con esa opción el navegador no
deja leer la respuesta, así que el `.then()` se cumplía **siempre** — aunque el backend hubiera
fallado — y la app borraba el registro de su cola local igual. Esa es la razón por la que las
fotos se perdían **sin que nadie se enterara**.

Ahora todos los envíos pasan por **`enviarAlBackend()`** ([app.js](app.js), arriba de todo):

- Manda el POST con `Content-Type: text/plain`, que **no dispara preflight** (Apps Script no sabe
  responder `OPTIONS`), y así se puede usar CORS normal y **leer la respuesta**.
- Si el backend responde error, la promesa **se rechaza** y el registro **no se borra**: queda en
  el dispositivo y se reintenta. Además se le avisa al operario con un mensaje concreto.
- Si el navegador o la red impiden leer la respuesta, **reintenta con `no-cors`** como antes, para
  no dejar a nadie sin poder guardar. En ese caso devuelve `{ sinConfirmar: true }`.

Como el reintento podría llegar a mandar el mismo POST dos veces, `guardarRegistroCompleto()`
recibió el mismo chequeo de idempotencia que ya tenían Calidad, Producción y Ticketera: si el
`Id_Carga` ya existe en la hoja `Orden`, no se inserta otra fila.

---

## 10. Pendientes

- [ ] **Copia de seguridad**: hoy no hay ninguna rutina de backup del Sheet ni del Drive.
- [x] ~~`mode: "no-cors"`~~ — resuelto el 14/08/2026 con `enviarAlBackend()`.
- [ ] **Fotos de Control de Carga en base64 dentro de la celda** (ver punto 5): migrarlas a Drive.
      **Ojo**: no es solo un cambio de backend. Hoy `app.js` arma el PDF del reporte con
      `doc.addImage(base64)`, que necesita la imagen embebida; si las celdas pasaran a guardar un
      link, **el PDF de Control de Carga dejaría de mostrar las fotos** hasta adaptarlo para que
      las descargue primero (como ya hace `calidad.js` con `cargarImagenParaPDF()`).
- [ ] **Confirmar que el Sheet `1RXqKN0E…` es el mismo** donde está pegado el Apps Script.
      Se verifica corriendo `diagnosticoDrive()` y comparando el ID que imprime.
