# Documentación — Sistema de Login y Auditoría de Usuarios (Sesión 10/07/2026)

Implementación del login corporativo con lista blanca de usuarios, protección de todas las rutas de la PWA y trazabilidad de quién crea/modifica cada registro (`usuario_registro`).

Archivos afectados: `auth.js` (**nuevo**), `index.html`, `app.js`, `calidad.js`, `style.css`. No se modificó `sw.js` (no cachea archivos, no requiere bump de versión).

---

## 1. Nuevo módulo `auth.js` — autenticación centralizada

Toda la lógica de login/sesión vive en un solo archivo, cargado **antes** de `app.js` y `calidad.js` en `index.html`.

### Usuarios autorizados

Lista blanca `AUTH_USUARIOS` con los 8 correos corporativos:

| Usuario | Email |
|---|---|
| Melisa Braun | melisa.braun@braunrelacionescomerciales.com.ar |
| Alejo Chamorro | alejo.chamorro@braunrelacionescomerciales.com.ar |
| Lucas Ramis | lucas.ramis@braunrelacionescomerciales.com.ar |
| Juan Cavallera | juan.cavallera@braunrelacionescomerciales.com.ar |
| Pablo Suárez | pablo.suarez@braunrelacionescomerciales.com.ar |
| Jonathan Rui | jonathan.rui@braunrelacionescomerciales.com.ar |
| Carla Candoni | carla.candoni@braunrelacionescomerciales.com.ar |
| Santiago Torres | santiago.torres@braunrelacionescomerciales.com.ar |

Los emails se comparan siempre **en minúsculas** (`.trim().toLowerCase()`), así que no importa cómo los tipee el operario.

### Contraseñas (nunca en texto plano)

- Cada usuario tiene un campo `passwordHash` con el **SHA-256** de su contraseña. Hoy todos comparten `AUTH_HASH_GENERICO` (hash de `Braun123`): `9c77eb8f3f0c2e378cefc1169452dd9793b990c0611347a28cdc72f88695c94b`.
- Al iniciar sesión, lo que tipea el usuario se hashea con la **Web Crypto API** (`crypto.subtle.digest('SHA-256', ...)`) y se compara contra el hash almacenado.
- La Web Crypto API requiere **HTTPS o localhost** (donde ya corre cualquier PWA con service worker). Si no está disponible, el login muestra un error explicativo.

### Sesión

- Clave `localStorage`: **`braun_sesion_v1`** → `{ email, nombre, loginAt }`.
- **Vencimiento: 24 horas** (constante `AUTH_SESION_DURACION_HORAS`, configurable). Vencida la sesión, se vuelve a pedir login.
- Si un usuario se **quita de la lista blanca**, su sesión guardada deja de valer automáticamente en la próxima verificación (revocación de acceso sin tocar el dispositivo).
- Al hacer login se elimina la clave legada `usuarioBraun` (del login viejo sin validación real).

### Funciones expuestas (API del módulo)

| Función | Descripción |
|---|---|
| `iniciarSesion(email, password)` | Async. Devuelve `{ ok: true, usuario }` o `{ ok: false, error }`. El error es genérico a propósito ("Correo o contraseña incorrectos") para no revelar qué correos existen. |
| `cerrarSesionAuth()` | Borra la sesión (y la clave legada). |
| `obtenerSesion()` | Devuelve la sesión activa validada (o `null` si no hay / venció / el usuario fue quitado). |
| `haySesionActiva()` | Boolean. Usada por el guard de rutas. |
| `usuarioRegistroActual()` | Email del usuario activo — se estampa en cada registro (auditoría). |
| `nombreUsuarioActual()` | Nombre del usuario activo — usado en el saludo del menú. |

---

## 2. Protección de rutas (guard centralizado)

**Ubicación:** `app.js` → primeras líneas de `cambiarVista()`.

```js
if (idDestino !== 'view-login' && !haySesionActiva()) {
    idDestino = 'view-login';
}
```

**Por qué ahí:** toda la navegación de la app pasa por `cambiarVista()` — Control de Carga, Control de Calidad, Ticketera, Contratos, detalle de carga, botón ← del header y el ruteo por hash de calidad (`#/control-calidad/<grano>`). Un único punto protege el 100% de las vistas; cualquier vista nueva que se agregue en el futuro queda protegida automáticamente sin código extra.

Además:
- `DOMContentLoaded` (en `app.js` y `calidad.js`) usa `haySesionActiva()` en lugar de la vieja clave `usuarioBraun`.
- `cerrarSesion()` (botón del menú principal) delega en `cerrarSesionAuth()` y redirige al login.

---

## 3. Pantalla de Login rediseñada

**Ubicación:** `index.html` → `#view-login` · estilos en `style.css` (clases `login-*`).

- Conserva el logo Braun corregido (`logo-braun.png`) y el fondo institucional existente.
- Nuevo subtítulo: **"Sistema de Control Operativo"** + hint "Acceso exclusivo para personal autorizado" (clases `.login-subtitle` / `.login-hint`).
- **Error inline** en caja roja (`#login-error`, clase `.login-error`) — reemplaza el `alert()` anterior.
- Botón con estado **"Verificando..."** (deshabilitado) mientras se hashea/valida.
- `autocomplete="username"` / `autocomplete="current-password"` para gestores de contraseñas.

El handler (`app.js` → sección "4. AUTENTICACIÓN (LOGIN)") es `async`: llama a `iniciarSesion()`, y ante éxito resetea el formulario y navega al menú. El menú principal ahora saluda por nombre: **"¡Hola, Melisa! Selecciona un módulo"** (se setea en `cambiarVista` al entrar a `view-menu-principal`).

---

## 4. Auditoría de registros — campo `usuario_registro`

El email del usuario logueado viaja automáticamente en cada **creación y modificación**:

| Módulo | Dónde se inyecta | Acciones del backend que lo reciben |
|---|---|---|
| Control de Carga | `app.js` → `construirRegistroDesdeFormulario()` | `guardar` (sync de cola offline), `actualizar`, `enviar_correo` |
| Control de Calidad | `calidad.js` → `construirRegistroCalidad()` | `guardar_calidad`, `actualizar_calidad` |
| Ticketera | `app.js` → objeto `ticket` del submit de `#form-ticketera` | `crear_ticket` |

Como ambos `construirRegistro...()` se usan tanto al crear como al editar, el campo refleja siempre al **último operario que tocó el registro**. Los registros guardados offline en IndexedDB ya llevan el campo incluido, así que se sincroniza igual aunque el guardado haya sido sin conexión.

### ⚠️ Pendiente del lado backend (Google Apps Script + Sheets)

1. Agregar la columna **`usuario_registro`** en las hojas de: Control de Carga, Control de Calidad y Tickets.
2. Mapear el campo en el Apps Script para las acciones listadas arriba (llega en el JSON del POST, mismo nivel que el resto de los campos).

---

## 5. Migración futura a contraseñas individuales

El flujo ya está preparado; hay dos caminos:

- **Camino simple (sigue client-side):** reemplazar el `passwordHash` de cada usuario en `AUTH_USUARIOS` por el SHA-256 de su contraseña individual. Generar un hash: `PowerShell` →
  ```powershell
  $sha=[System.Security.Cryptography.SHA256]::Create()
  ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('LaContraseña')) | % { $_.ToString('x2') }) -join ''
  ```
- **Camino recomendado (validación en servidor):** mover la lista al Apps Script con una acción `_accion: "login"` que valide email+contraseña y devuelva ok/error. En `auth.js` solo hay que cambiar el cuerpo de `iniciarSesion()` por ese `fetch`; el resto de la app (guard, sesión, auditoría) no se toca.

### Límite honesto de seguridad actual

Al ser una PWA sin backend de autenticación, la lista de emails y hashes viaja al navegador. El hash evita que la contraseña quede a la vista en el código, pero **la protección real contra alguien con conocimientos técnicos requiere el camino recomendado** (validar en el Apps Script).

---

## 6. Cómo probar

1. Abrir la app por **HTTPS o localhost** (requisito de la Web Crypto API).
2. Intentar navegar o refrescar sin sesión → siempre cae en el login.
3. Login con correo **no listado** → "Correo o contraseña incorrectos".
4. Login con `melisa.braun@braunrelacionescomerciales.com.ar` / `Braun123` → entra al menú con saludo "¡Hola, Melisa!".
5. Crear una carga / control de calidad / ticket y verificar en el payload (pestaña Red del navegador) o en el Sheet el campo `usuario_registro` con el email del operario.
6. "Cerrar Sesión" → vuelve al login y ya no se puede navegar hacia atrás a ninguna vista.
7. Esperar 24 hs (o borrar `braun_sesion_v1` de localStorage) → pide login de nuevo.
