# Cuentas y despliegue — App Braun

Qué cuenta hace falta para cada cosa y **dónde se sube cada tipo de cambio**.
Ante la duda de "¿esto va a GitHub o a Apps Script?", empezar por acá.

---

## 1. La app tiene DOS mitades que se actualizan distinto

Es la confusión más común. Un cambio en una **no** afecta a la otra.

| | Frontend | Backend |
|---|---|---|
| **Qué es** | Lo que se ve y se toca en el celular | Lo que guarda y lee los datos |
| **Archivos** | `index.html`, `app.js`, `calidad.js`, `produccion.js`, `auth.js`, `style.css`, `sw.js`, `manifest.json` | `01_backend_principal.gs` y los `9x_*.gs` |
| **Dónde vive** | GitHub Pages | Google Apps Script, adentro del Sheet |
| **Cómo se actualiza** | `git commit` + **`git push`** | **Implementar → Nueva versión** |
| **Cuánto tarda** | 1–2 min (GitHub Pages recompila) | Inmediato |
| **Si me olvido** | Los usuarios siguen viendo la versión vieja | El backend sigue corriendo el código viejo |

> **El repo NO despliega el backend.** Pushear un `.gs` a GitHub no cambia nada en producción:
> los `.gs` del repo son **copias de lectura**. La versión que corre es la del editor de Apps Script.
>
> **Y al revés**: editar en Apps Script no actualiza el repo. Hay que copiar el código a
> `01_backend_principal.gs` y hacer commit, si no el repo queda desactualizado
> (ya pasó una vez y casi se pierden mejoras del backend).

---

## 2. Cuentas de Google

| Cuenta | Para qué | Ojo con |
|---|---|---|
| **santiago.torres@braunrelacionescomerciales.com.ar** (Workspace) | Dueña del Sheet `BD_BRC`, del proyecto Apps Script `App_BRC` y de la carpeta `APP_Braun_2026`. Es la que **autorizó el script**, así que el backend corre con su identidad (`executeAs: USER_DEPLOYING`). | Es el **punto único de falla**: si se suspende, dejan de funcionar el guardado, las fotos y los correos de la Ticketera al mismo tiempo. |
| **analistabrc@gmail.com** (Gmail personal) | **Dueña de las 7 carpetas de archivos** dentro de `APP_Braun_2026` — los 3.949 archivos históricos y nuevos. | Google **no permite transferir la propiedad** entre Gmail y Workspace de otro dominio: esto no se puede unificar. Hay que **mantener el acceso a las dos cuentas**. |

---

## 3. Cuentas de GitHub

| Cuenta | Rol |
|---|---|
| **SantiagoTorresBraun** | ✅ **La correcta.** Dueña del repo `AppBraun` y de la publicación en GitHub Pages. |
| **Santitorres66** | ❌ Otra cuenta del mismo usuario. **No tiene permiso de escritura** sobre el repo. |

- **Repositorio**: <https://github.com/SantiagoTorresBraun/AppBraun> (rama `main`)
- **App publicada**: <https://santiagotorresbraun.github.io/AppBraun/>

### Si el push falla con `Permission denied to Santitorres66`

Windows guardó la credencial de la cuenta equivocada. Se arregla así:

```powershell
cmdkey /delete:LegacyGeneric:target=git:https://github.com
git push -u origin main
```

Al reintentar se abre la ventana de GitHub: **iniciar sesión con `SantiagoTorresBraun`**.
Para verificar cuál está guardada: `cmdkey /list | findstr github`

---

## 4. Cómo publicar un cambio del FRONTEND

```powershell
cd "c:\Users\santiago.torres\Documents\DOCUMENTOS\AppBraun-main\AppBraun-main"
git add -A
git commit -m "descripcion del cambio"
git push
```

Esperar 1–2 minutos y recargar <https://santiagotorresbraun.github.io/AppBraun/> con **Ctrl+F5**
(sin eso el navegador muestra la versión cacheada).

---

## 5. Cómo publicar un cambio del BACKEND

1. Abrir el Sheet `BD_BRC` → **Extensiones → Apps Script** (proyecto `App_BRC`).
2. Pegar el código en `01_backend_principal`.
3. **Implementar → Administrar implementaciones → lápiz → Versión: Nueva → Implementar.**
4. Copiar el mismo código a `01_backend_principal.gs` del repo y hacer commit, para que no se
   desincronicen.

> El paso 3 es el que más se olvida. **Guardar no publica.** Sin "Nueva versión", la app en
> producción sigue llamando al código anterior.

---

## 6. Permisos de Google (OAuth) — leer esto si "no se guardan las fotos"

El backend necesita **tres permisos** de la cuenta de Google. Están declarados a mano en
`appsscript.json`, y esa declaración **no es opcional**: sin ella Google los deduce del código, y
si la autorización se otorgó antes de que el código creara archivos, queda congelada con un
permiso insuficiente.

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/script.send_mail"
]
```

| Permiso | Para qué | Si falta |
|---|---|---|
| `spreadsheets` | Leer y escribir el Sheet | No se guarda **nada** |
| `drive` | Crear las fotos y los archivos en Drive | Las fotos **no se guardan** y la celda queda vacía |
| `script.send_mail` | Correos de la Ticketera | No salen las notificaciones |

### El caso real (14/08/2026)

Durante meses las fotos de Control de Calidad no se guardaban. La autorización, otorgada el
**3 de julio**, tenía el permiso de Drive en **"Ver y descargar"** — es decir, **solo lectura**.
`DriveApp.Folder.createFile` fallaba con:

```
You do not have permission to call DriveApp.Folder.createFile.
Required permissions: https://www.googleapis.com/auth/drive
```

Como el código viejo se tragaba ese error y devolvía `""`, la fila se guardaba con las celdas de
imagen **vacías y sin ningún aviso**, y la app borraba la foto del celular. Se perdieron
definitivamente.

### Cómo verificar y arreglar

1. **Diagnosticar**: ejecutar `diagnosticoEscrituraEnDrive()` de [99_diagnostico.gs](99_diagnostico.gs).
   Crea un archivo de prueba y lo borra. Si falla, imprime el motivo exacto.
2. **Declarar los scopes** en `appsscript.json` (bloque de arriba) y guardar.
3. **Revocar la autorización vieja** en <https://myaccount.google.com/permissions> → `App_BRC`
   → *Eliminar todo el acceso*. **Este paso es imprescindible**: cambiar el manifiesto no
   invalida el permiso ya otorgado, y Google no vuelve a preguntar por su cuenta.
4. **Re-autorizar**: ejecutar cualquier función y aceptar. Verificar que el permiso de Drive diga
   **"Ver, modificar, crear y eliminar archivos de Google Drive"** y no "Ver y descargar".
5. **Nueva implementación** (punto 5 de este documento). La Web App usa los permisos vigentes al
   momento de implementar: sin este paso sigue corriendo con la autorización vieja.

> Mientras dura el paso 3, la app **no guarda**. Hacerlo en un momento sin operarios cargando.

---

## 7. Que el reporte salga desde el Gmail de cada usuario (ID de cliente OAuth)

El envío del reporte de Control de Carga ([correo.js](correo.js)) intenta mandar el mail **desde la
cuenta del usuario que inició sesión en la app**: queda en *su* carpeta Enviados y las respuestas
del cliente le llegan a *él*, no a la cuenta del script.

Para eso hace falta **un ID de cliente OAuth**, que se crea una sola vez. **Mientras no esté
configurado la app funciona igual**: manda todo por el backend, desde
`santiago.torres@braunrelacionescomerciales.com.ar`, con el nombre del usuario y "Responder a"
su correo.

### Pasos (una sola vez, con la cuenta dueña del proyecto)

1. Entrar a <https://console.cloud.google.com> con la cuenta Workspace y seleccionar el proyecto
   de Cloud asociado al Apps Script `App_BRC`
   (en Apps Script: **Configuración del proyecto → Proyecto de Google Cloud Platform**).
2. **APIs y servicios → Biblioteca** → buscar **Gmail API** → **Habilitar**.
3. **Pantalla de consentimiento de OAuth** → tipo de usuario: **Interno**.
   Es clave: siendo *Interno* Google **no exige verificación** del permiso `gmail.send`,
   que en apps externas sí la exige y tarda semanas.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   - **Orígenes autorizados de JavaScript**: `https://santiagotorresbraun.github.io`
     (agregar también `http://localhost:5500` si se prueba en local).
   - No hace falta URI de redirección: se usa el flujo de token del navegador.
5. Copiar el ID generado (termina en `.apps.googleusercontent.com`) y pegarlo en la primera
   constante de [correo.js](correo.js):
   ```js
   const GMAIL_CLIENT_ID = "232148254903-qfa138v49uqnjuu32g9kkejmdjnu2ft2.apps.googleusercontent.com";
   ```
6. `git commit` + `git push` (punto 4). Listo.

La primera vez que cada persona toque "Enviar reporte" va a ver **una ventana de Google pidiendo
permiso para enviar correos en su nombre**. Después se renueva sola mientras tenga sesión de
Google abierta en ese navegador.

> **Si el permiso falla o el usuario lo cancela, el correo se manda igual por el backend.**
> El único cambio es de quién figura como remitente. En la ventana de envío se aclara cuál de
> los dos caminos se va a usar.

---

## 8. Datos de referencia

| Qué | Valor |
|---|---|
| Sheet `BD_BRC` | `1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M` |
| Proyecto Apps Script `App_BRC` | `18iIQlwh_9BT_HBnhdUgSUw2oGHqytkEI-7bv8UvwJ4dx4hbsZQPnD-vU` |
| Carpeta `APP_Braun_2026` | `16KZ6y9waJ085okNZtAR9xopGWa392AVN` |
| URL del Web App (en `app.js`) | `https://script.google.com/macros/s/AKfycbxER7E6.../exec` |

El detalle de las carpetas está en [ALMACENAMIENTO_DATOS.md](ALMACENAMIENTO_DATOS.md) y el de los
archivos `.gs` en [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md).

---

## 9. Errores que ya pasaron (para no repetirlos)

| Error | Qué provocó | Cómo se evita |
|---|---|---|
| **Permiso de Drive en solo lectura** | La causa real de que las fotos de calidad no se guardaran. `createFile` fallaba y la celda quedaba vacía. | Punto 6. Diagnosticar con `diagnosticoEscrituraEnDrive()`. |
| Tener dos copias del backend en Apps Script | `Sin titulo 4.gs` duplicaba `doPost` y `guardarFotoCalidadEnDrive`. Los `.gs` se fusionan en un único espacio global y **la última definición gana**: las fotos se subían privadas y, si fallaban, la celda quedaba vacía sin aviso. | Un solo archivo con el backend. Ver [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md). |
| Tragarse los errores con `return ""` | Sin el mensaje de error, el problema del permiso de Drive estuvo invisible desde julio. | Que las funciones **propaguen** el error en vez de devolver vacío. |
| El repo desactualizado respecto de Apps Script | Casi se pisan mejoras del backend con una versión vieja del repo. | Después de tocar Apps Script, copiar el código al repo y commitear. |
| Push con la cuenta de GitHub equivocada | `403 Permission denied`. | Ver punto 3. |
| Buscar las carpetas de Drive **por nombre** | Un renombre hacía que la app creara una carpeta nueva y vacía en la raíz de Mi unidad, y los archivos quedaban huérfanos. | Ahora se buscan **por ID** (`obtenerCarpetaApp()`). |
| Editar el código y no implementar | El arreglo no llega a la app y parece que "no funcionó". | Punto 5, paso 3. |
