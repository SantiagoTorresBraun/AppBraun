# Envío de reportes por correo — cómo funciona y qué se arregló

Todo lo que hay que saber del envío de reportes por mail: los dos caminos por
los que puede salir, por qué llegaban duplicados, y qué protege cada capa.

Código: [correo.js](correo.js) (frontend) y `enviarReportePorCorreo()` en
[01_backend_principal.gs](01_backend_principal.gs) (backend).

---

## 1. Los dos caminos de salida

```
                        ┌──────────────────────────────┐
    Tocás "Enviar" ───▶ │  ¿Está configurado Gmail?    │
                        └──────────┬───────────────────┘
                                   │
              ┌────────────────────┴───────────────────┐
              ▼ SÍ                                     ▼ NO
   ┌─────────────────────────┐            ┌──────────────────────────┐
   │ 1) API de Gmail         │            │ 2) Backend (Apps Script) │
   │    Sale de TU cuenta    │  si falla  │    Sale de la cuenta del │
   │    Queda en tus         │ ─────────▶ │    script, con TU nombre │
   │    Enviados             │  (ver §3)  │    y "Responder a" vos   │
   └─────────────────────────┘            └──────────────────────────┘
```

La diferencia importa para entender los bugs: **un envío por Gmail nunca pasa
por el servidor.** Por eso una protección puesta solo en el backend es ciega
ante la mitad de los envíos.

---

## 2. Por qué llegaban duplicados (28/08/2026)

Cada reporte llegaba **dos veces**, con remitentes distintos: uno como
*"Lucas Ramis (App Braun)"* y otro como *"yo"*. Ese detalle era la pista: eran
los dos caminos mandando **el mismo correo**.

Hubo **tres causas distintas**, y se fueron descubriendo una por vez porque cada
arreglo destapaba la siguiente.

### Causa A — el backend no tenía guarda de idempotencia

`enviarReportePorCorreo()` era la **única acción de escritura del backend sin
ninguna protección**. Todas las demás ya tenían la suya:

| Acción | Guarda |
|---|---|
| `guardarRegistroCompleto` | `Id_Carga` + `LockService` |
| `guardarCalidad` | `Id_Calidad` |
| `crearTicket` | `id_ticket` |
| `guardarMuestreo` | `Id_Muestreo` |
| **`enviarReportePorCorreo`** | **ninguna** ❌ |

Y el pedido le llegaba repetido porque **`enviarAlBackend()` reintenta el POST a
ciegas** cuando no puede leer la respuesta ([app.js:86](app.js#L86)). Ese
reintento se diseñó para *guardar*, que es idempotente; el envío de correo se
sumó después al mismo helper y **heredó el reintento sin heredar la protección**.

**Arreglado:** el backend recuerda 5 minutos qué mandó (reporte + destinatario +
asunto, hasheado) y descarta el repetido. El chequeo y la marca van dentro de un
`LockService` para que dos pedidos simultáneos no pasen los dos.

### Causa B — el automático y el botón del modal se pisaban

El envío automático al guardar corre en segundo plano y tarda (arma el PDF, pide
token). Si mientras tanto alguien manda desde el modal, salen los dos — **uno
tras otro, no a la vez**, así que un candado en memoria no los ve.

**Arreglado:** registro en `localStorage` de reporte + destinatario ya enviados,
con ventana de 10 minutos. Sobrevive a un F5 y **cubre los dos caminos**, que es
lo que el backend no puede hacer.

### Causa C — la que realmente lo causaba

```js
respuesta = await fetch('https://gmail.googleapis.com/upload/...')  // se corta
catch (errorGmail) { via = 'backend'; }                             // manda igual
```

Si el `fetch` se rompía **después** de que Google aceptó el mensaje, la app
creía que Gmail había fallado y mandaba por el backend. Gmail ya lo había
enviado → **dos correos, uno de cada camino**.

**Arreglado en dos pasos:**

1. Los errores de Gmail ahora distinguen **"seguro no salió"** (sin token, 4xx)
   de **"no se sabe"** (se cortó el `fetch`, 5xx). Solo se cae al backend en el
   primer caso.
2. Se atacó la raíz: **el endpoint estaba mal elegido** (§3).

---

## 3. El endpoint de Gmail y el `Failed to fetch`

Aun sin duplicados, cada envío mostraba *"Se cortó la conexión con Gmail"* — pero
**el correo llegaba igual**.

**Causa:** se usaba el endpoint de *subida*:

```
/upload/gmail/v1/users/me/messages/send?uploadType=media
```

Aguanta 35 MB, pero Google deriva esos envíos a otro host **cuya respuesta no
habilita CORS** para el origen de la app. El mensaje sale; el navegador no puede
leer la respuesta y `fetch` tira `Failed to fetch`.

**Por qué se podía cambiar.** El comentario del código decía que el endpoint
común *"se queda corto apenas el PDF trae las fotos"*. Se midió sobre las 251
cargas reales:

| | |
|---|---|
| Fotos por carga (mediana) | 0,62 MB |
| Peor caso medido | 1,03 MB |
| Cargas que superarían el límite de 5 MB | **0** |

O sea: **entran todas con muchísimo margen**.

**Arreglado:** se usa `messages/send` (el común, con CORS correcto) siempre que
el mensaje entre en 5 MB, y el de subida queda solo para un reporte
excepcionalmente grande.

> ⚠️ En el endpoint común el mensaje va en el campo `raw` codificado en
> **base64url**: `-` y `_` en lugar de `+` y `/`, y sin los `=` finales. Con
> base64 normal Gmail devuelve **400**.

---

## 4. El estado "Sin confirmar"

Si aun así se corta la conexión, la app **no manda por el backend** y no dice
que falló, porque lo más probable es que el correo haya salido. Deja este
estado, que no es ni una cosa ni la otra:

```
Sin confirmar 28/08 01:00 a fulano@... — revisá Enviados de Gmail
```

**Por qué importa:** antes ese caso escribía `Error` en `Estado_Correo` de un
correo que el cliente sí había recibido, e invitaba a mandarlo de nuevo.

Misma lógica en el backend: `marcarEstadoCorreo()` corre **después** de que el
mail salió, así que va en su propio `try`. Si falla al escribir la constancia,
el error **no se propaga** — si se propagara, se borraría la marca del
antiduplicado y el reintento mandaría un segundo correo. *Perder la anotación es
molesto; mandar el reporte dos veces al cliente es peor.*

---

## 5. Las tres capas, y qué cubre cada una

| Capa | Dónde | Qué evita | Qué NO puede ver |
|---|---|---|---|
| `enviosEnCurso` (Set) | navegador | dos envíos exactamente simultáneos | nada secuencial, ni un F5 |
| `localStorage` (10 min) | navegador | automático + modal, doble clic, recargas | otro dispositivo o navegador |
| Caché + lock (5 min) | backend | el reintento a ciegas, POST simultáneos | **los envíos por Gmail** |

Ninguna alcanza sola. La del navegador es la única que ve los dos caminos; la
del backend es la única que sobrevive a que se cierre el navegador.

**Un reenvío a propósito sigue siendo posible:** el modal pregunta *"¿Querés
mandarlo igual?"*. El envío automático nunca fuerza.

---

## 6. Qué NO va en el PDF del reporte

**`Kg Descarga` y `Diferencia` se sacaron de la tabla de Contrato Comercial**
del PDF (28/08/2026).

El control de carga se emite **cuando el camión sale**; la descarga se pesa en
destino, días después. En el reporte esas columnas salían siempre `Pendiente` y
`-`, o peor: una diferencia de `-90.000` que se leía como un faltante enorme
cuando en realidad todavía no se había descargado nada.

Los datos **se siguen cargando y viendo** en la pantalla de Contratos y en el
Sheet. Lo único que cambia es que no se imprimen en el PDF.

> Los anchos de las columnas del PDF tienen que sumar `anchoContenido` (**182 mm**).
> Los 38 mm que liberaron esas dos se repartieron entre las que quedaron, con la
> mayor parte para *Destino de Mercadería*, que era la que más se cortaba.
> **Si agregás o sacás una columna, reajustá los anchos o la tabla queda torcida.**

---

## 7. Si algo falla

| Qué ves | Qué pasó |
|---|---|
| *"El envío quedó SIN CONFIRMAR"* | Se cortó la conexión con Gmail. Mirá tu carpeta Enviados: si está, ya salió. |
| *"Este reporte ya se envió a X hace N minutos"* | La guarda antiduplicado. Si querés mandarlo igual, aceptá el cartel. |
| *"Ese reporte ya se está enviando en este momento"* | Hay otro envío del mismo reporte en curso. Esperá. |
| Llega **dos veces** | Volvió alguna de las causas de §2. **Anotá los dos remitentes**: si uno dice *"yo"* y el otro *"Lucas Ramis (App Braun)"*, es el camino Gmail + backend (§2-C); si los dos dicen lo mismo, es el backend duplicando. |
| Sale desde la cuenta del script y no desde tu Gmail | Falta `GMAIL_CLIENT_ID` o no diste el permiso. Ver punto 7 de [CUENTAS_Y_DESPLIEGUE.md](CUENTAS_Y_DESPLIEGUE.md). |
| *"El PDF pesa X MB y supera el límite"* | Tope de 22 MB (`CORREO_MAX_MB`). Descargalo y mandalo por otro medio. |

---

## 8. Al tocar este módulo, tener presente

1. **Mandar un mail no se puede deshacer.** Todo lo que corra después de
   `MailApp.sendEmail` o del `fetch` a Gmail tiene que ir en su propio `try`:
   si se propaga, alguien va a reintentar y el cliente recibe el reporte dos veces.
2. **Un reintento a ciegas es seguro solo si la operación es idempotente.**
   `enviarAlBackend()` reintenta; cualquier acción nueva que se rutee por ahí
   necesita su propia guarda del lado del backend.
3. **Una protección en el backend no ve los envíos por Gmail.** Si el chequeo
   tiene que cubrir los dos caminos, va en el navegador.
4. **Ante la duda, no mandar.** Es preferible avisar y que una persona revise, a
   mandar "por las dudas" y duplicar.
