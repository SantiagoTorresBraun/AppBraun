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

## 6. Datos de referencia

| Qué | Valor |
|---|---|
| Sheet `BD_BRC` | `1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M` |
| Proyecto Apps Script `App_BRC` | `18iIQlwh_9BT_HBnhdUgSUw2oGHqytkEI-7bv8UvwJ4dx4hbsZQPnD-vU` |
| Carpeta `APP_Braun_2026` | `16KZ6y9waJ085okNZtAR9xopGWa392AVN` |
| URL del Web App (en `app.js`) | `https://script.google.com/macros/s/AKfycbxER7E6.../exec` |

El detalle de las carpetas está en [ALMACENAMIENTO_DATOS.md](ALMACENAMIENTO_DATOS.md) y el de los
archivos `.gs` en [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md).

---

## 7. Errores que ya pasaron (para no repetirlos)

| Error | Qué provocó | Cómo se evita |
|---|---|---|
| Tener dos copias del backend en Apps Script | `Sin titulo 4.gs` duplicaba `doPost` y `guardarFotoCalidadEnDrive`. Los `.gs` se fusionan en un único espacio global y **la última definición gana**: las fotos se subían privadas y, si fallaban, la celda quedaba vacía sin aviso. | Un solo archivo con el backend. Ver [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md). |
| El repo desactualizado respecto de Apps Script | Casi se pisan mejoras del backend con una versión vieja del repo. | Después de tocar Apps Script, copiar el código al repo y commitear. |
| Push con la cuenta de GitHub equivocada | `403 Permission denied`. | Ver punto 3. |
| Buscar las carpetas de Drive **por nombre** | Un renombre hacía que la app creara una carpeta nueva y vacía en la raíz de Mi unidad, y los archivos quedaban huérfanos. | Ahora se buscan **por ID** (`obtenerCarpetaApp()`). |
| Editar el código y no implementar | El arreglo no llega a la app y parece que "no funcionó". | Punto 5, paso 3. |
