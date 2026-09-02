# Contraseñas personales y recuperación por correo

Cada usuario tiene su propia contraseña y puede recuperarla solo, con un código
que le llega a su casilla. Antes todos compartían una única contraseña genérica
y no había forma de recuperar nada.

---

## 1. Puesta en marcha

### Paso 1 — Subir el archivo nuevo al Apps Script
1. Sheet `BD_BRC` ▸ **Extensiones ▸ Apps Script**.
2. Archivo nuevo llamado **`03_auth`** ▸ pegar el contenido de `03_auth.gs`.

### Paso 2 — Rutear las acciones
En `01_backend_principal.gs` (ya están en la copia del repo):

```javascript
// en doPost
if (accion === "auth_login")           return authLogin(data);
if (accion === "auth_definir")         return authDefinir(data);
if (accion === "auth_reset_pedir")     return authResetPedir(data);
if (accion === "auth_reset_confirmar") return authResetConfirmar(data);

// en doGet
if (e && e.parameter && e.parameter.action === "auth_perfil") {
  return authPerfil(e.parameter.email);
}
```

### Paso 3 — Publicar
**Implementar ▸ Administrar implementaciones ▸ ✏️ ▸ Nueva versión.**

> El correo con el código sale con `MailApp`, que ya está autorizado
> (`script.send_mail`). **No hace falta ningún permiso nuevo.**

### Paso 4 — Subir a GitHub
`auth.js`, `app.js`, `index.html`, `style.css`.

**Las columnas de la hoja `Usuarios` se crean solas** la primera vez que alguien
define su contraseña: `salt`, `verificador_hash`, `reset_hash`, `reset_vence`,
`reset_intentos`, `password_actualizada`.

---

## 2. Cómo se valida una contraseña

**La contraseña nunca sale del dispositivo y no se guarda en ningún lado.**

```
  El usuario escribe su contraseña
        │
        ▼
  ① El navegador pide la SAL de ese usuario      (?action=auth_perfil)
        │   La sal es pública: solo evita que dos personas con la misma
        │   contraseña terminen con el mismo verificador.
        ▼
  ② Deriva un VERIFICADOR en el dispositivo
        │   PBKDF2-SHA256, 150.000 vueltas.
        │   La contraseña NO viaja. Viaja el verificador.
        ▼
  ③ El backend compara SHA-256(verificador) con la hoja "Usuarios"
```

**En el Sheet queda `SHA-256(verificador)`**, no el verificador. La diferencia
importa: si alguien lee la hoja, no obtiene nada que pueda reenviar para entrar.
Y para probar contraseñas a lo bruto tiene que pagar 150.000 vueltas de PBKDF2
por cada intento — un SHA-256 pelado se prueba de a millones por segundo.

**Verificado en las pruebas:** la contraseña no aparece ni en la hoja `Usuarios`
ni en el `localStorage`, y el perfil público solo devuelve `salt`, `nombre`,
`existe` y `tieneClave`.

---

## 3. Por qué la validación se mudó al servidor

Antes el login se resolvía en `auth.js`, comparando contra un hash escrito en el
propio archivo. **Con ese esquema una recuperación es imposible:** para que el
navegador valide una contraseña nueva, tendría que conocerla — y cualquiera que
abre el archivo la conoce también. Era el caso de `Braun123`, que estaba en un
comentario de un repo público.

Ahora el navegador no sabe la contraseña de nadie. Solo sabe derivar el
verificador de la que le tipean y preguntarle al servidor si sirve.

---

## 4. Entrar sin señal

Como los operarios trabajan sin conexión, después de **cada login exitoso con
internet** se guarda en el dispositivo la sal y el `SHA-256(verificador)` de ese
usuario — exactamente lo mismo que tiene el servidor.

| Situación | Qué pasa |
|---|---|
| Sin señal, en un dispositivo donde **ya entró** | ✅ Entra, se valida contra la copia local |
| Sin señal, contraseña incorrecta | ❌ No entra |
| Sin señal, en un dispositivo **nuevo** | ❌ No entra, y el mensaje lo explica |
| Sin señal, usuario que **nunca definió** su clave | ✅ Entra con la genérica |

El último caso es a propósito: hay que poder seguir trabajando durante la
transición.

---

## 5. La recuperación, paso a paso

1. En el login, **"¿Olvidaste tu contraseña?"**.
2. Escribe su correo → el backend genera un código de **6 dígitos** y **lo manda
   a esa casilla**.
3. Escribe el código + la contraseña nueva (dos veces).
4. Listo: ya entra con la nueva.

**Todo el mecanismo de seguridad es que el código llega al correo**, así que solo
puede completar el cambio quien tenga acceso a esa casilla. Por eso el correo se
manda **siempre a la dirección registrada**, nunca a una que se elija en el momento.

### Los frenos, y por qué está cada uno

| Freno | Valor | Para qué |
|---|---|---|
| Vencimiento | 15 min | Un código viejo en la bandeja no sirve más |
| Un solo uso | — | Se borra al consumirlo |
| Intentos | 5 | Sin esto, 6 dígitos se prueban por fuerza bruta |
| Pedidos por hora | 3 por correo | Sin esto se le puede llenar la casilla a alguien |
| Código guardado | `SHA-256(código + email)` | Leer la hoja no alcanza para usarlo |
| Cambio de clave | invalida el código pendiente | Un código viejo no revive |

**Verificado en las pruebas:** el mismo código no se usa dos veces, a los 5
intentos fallidos se invalida, el cuarto pedido en una hora se rechaza, y un
correo no registrado no recibe nada.

---

## 6. La transición

Nadie se queda afuera. Quien todavía no definió su contraseña **sigue entrando
con `Braun123`**, y al entrar la app le ofrece crear la suya.

**No se le fuerza el cambio a nadie**: si un operario está en medio de una carga,
obligarlo lo deja trabado. Se le ofrece una vez al entrar, y siempre puede
hacerlo desde **"Mi contraseña"** en el menú principal.

En cuanto define la suya, **la genérica deja de servirle a él** (verificado en
las pruebas). Con `diagnosticoAuth()` en el editor de Apps Script se ve quién ya
la cambió y quién sigue con la genérica.

### Reglas de la contraseña nueva
Al menos 8 caracteres, con letras y números, distinta de `Braun123`, y las dos
veces iguales.

### Si alguien queda afuera del todo
Sin acceso a su correo no puede recuperarla solo. En el editor de Apps Script:
poner el email en `EMAIL_A_RESETEAR` y ejecutar **`borrarClaveDeUsuario()`**;
ese usuario vuelve a entrar con la genérica y define una nueva.

---

## 7. ⚠️ Lo que esto NO arregla

**El resto del backend sigue sin pedir credenciales.** Quien tenga la URL del
Web App puede leer y escribir sin pasar por el login, así que esto **no protege
los datos**: da contraseñas personales y trazabilidad real de quién hizo qué.

Es el hallazgo 1 de [AUDITORIA_2026-08-28.md](AUDITORIA_2026-08-28.md) y se
arregla aparte.

También queda pendiente sacar `Braun123` del comentario de `auth.js`. Mientras
haya un solo usuario sin contraseña propia, esa puerta sigue abierta.

---

## 8. Si algo falla

| Qué ves | Qué pasó |
|---|---|
| *"El servidor no respondió como se esperaba"* | Falta publicar la **Nueva versión** en Apps Script |
| *"Ese correo no está registrado en la app"* | No está en la hoja `Usuarios` ni entre los 8 base |
| *"Ya se pidieron varios códigos"* | Tope de 3 por hora. Esperar |
| *"El código venció"* | Pasaron los 15 minutos. Pedir otro |
| *"Demasiados intentos"* | 5 fallidos. El código se invalidó, pedir otro |
| *"Sin conexión solo podés entrar en un dispositivo donde ya hayas iniciado sesión"* | Es correcto: no hay contra qué validar. Con señal entra normal |
| *"Este dispositivo no puede verificar la contraseña"* | La app se abrió sin HTTPS. WebCrypto no funciona en HTTP |
| No llega el correo | Revisar correo no deseado. Verificar la cuota de `MailApp` en Apps Script |

### Nota sobre el enumerado de usuarios
`auth_perfil` responde distinto según el correo exista o no, así que se puede
averiguar quién está registrado. Para una app interna de 15 personas es un
intercambio razonable: el navegador **necesita** la sal antes de poder derivar el
verificador. Queda anotado por si el criterio cambia.
