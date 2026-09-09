# Modo offline — cómo funciona

**Qué resuelve:** el Hallazgo 3 de la auditoría. Antes, si un operario cerraba
la app en un silo sin señal, no la podía volver a abrir: aparecía la pantalla de
error del navegador. Ahora la app abre igual, sin internet.

Implementado el **09/09/2026**.

---

## Los archivos

| Archivo | Qué hace |
|---|---|
| [sw.js](sw.js) | El Service Worker. Guarda la copia de la app y decide qué se sirve desde la caché y qué desde la red. |
| [offline.js](offline.js) | Registra el `sw.js`. **Sin este archivo, el `sw.js` es código muerto** — ese era exactamente el bug. |
| [vendor/jspdf.umd.min.js](vendor/jspdf.umd.min.js) | jsPDF 2.5.1, bajado del CDN al repo. |
| [vendor/fontawesome/](vendor/fontawesome/) | Font Awesome 6.4.0: el CSS y las 4 fuentes `.woff2`. |
| [fondo-login.jpg](fondo-login.jpg) | El fondo de campo del login, que antes venía de Unsplash. |

---

## Las dos estrategias, y por qué son dos

No todos los archivos se tratan igual, a propósito.

### Cache primero → `vendor/`, imágenes y fuentes

Estos archivos **no cambian nunca**. Se sirven desde la caché sin siquiera
tocar la red. Es instantáneo y no gasta datos.

### Red primero (con 3,5 segundos de paciencia) → `index.html`, los `.js`, el `.css`

Estos **sí cambian en cada despliegue**. Si fueran cache-first, habría que
acordarse de subir `VERSION` en `sw.js` cada vez que se toca una línea de
código — y la vez que alguien se olvide, todos los operarios se quedan con la
app vieja pegada y no hay forma de darse cuenta.

Con red-primero: si hay internet, siempre llega lo último. Un despliegue se ve
al recargar, igual que antes.

**El límite de 3,5 segundos es la parte importante.** En un silo la señal casi
nunca está "cortada" — está *lenta*. Un navegador esperando a una conexión
agonizante tarda 30 segundos en rendirse, y en esos 30 segundos el operario mira
una pantalla en blanco. Eso, en la práctica, es peor que estar sin internet.
A los 3,5 segundos el Service Worker deja de esperar y sirve la copia guardada.
La red sigue corriendo por atrás y, cuando llegue, igual actualiza la caché
para la próxima vez.

---

## Lo que el Service Worker NUNCA toca

Esto es tan importante como lo que sí cachea:

- **Todos los POST.** Guardar una carga, mandar un correo, consultarle al
  agente. Van a la red siempre.
- **Todo lo que no sea del propio dominio:** el backend de Apps Script, las
  fotos de Drive, el login de Google, la API de Groq. Cachear datos del
  historial sería mostrar información vieja como si fuera de ahora — peor que
  no mostrar nada.

---

## Mantenimiento

**Si agregás o borrás un archivo de la lista `RECURSOS` de `sw.js`, subile el
número a `VERSION`** (`v1` → `v2`). Eso tira la caché vieja y baja todo de nuevo.

Si solo editás código que ya está en la lista, **no hace falta tocar nada**: al
ser red-primero, el cambio se ve al recargar.

---

## Si algo queda raro

Desde la consola del navegador (F12):

```javascript
estadoOffline()        // ¿está activo? ¿qué versión tiene guardada?
borrarCacheOffline()   // borra todo; después recargar para bajar de nuevo
```

Para verificar a mano que funciona: abrir la app con internet, esperar unos
segundos, y después poner el celular en modo avión y volver a abrirla. Tiene
que abrir normal, con los íconos y el fondo del login en su lugar.

---

## Lo que sigue necesitando internet (y está bien que así sea)

| Qué | Por qué no se cachea |
|---|---|
| El ícono del `manifest.json` | Solo se usa al instalar la app en el celular, y para instalarla hace falta internet igual. |
| `accounts.google.com/gsi` | Es el login de Gmail. Sin señal no se puede mandar un correo de todos modos. |
| Guardar cargas, fotos, correos | Van a la cola offline de IndexedDB, que es un mecanismo aparte del Service Worker. |

> **Ojo:** que la app *abra* sin señal no quiere decir que la cola offline esté
> sana. El Hallazgo 4 de la auditoría (un registro que falla bloquea toda la
> cola, para siempre y sin aviso) **sigue abierto** y es el complemento natural
> de este arreglo.

---

## Cómo se verificó

48 pruebas automáticas que ejecutan el `sw.js` real dentro de un
`ServiceWorkerGlobalScope` simulado:

- La instalación guarda los 20 archivos.
- Un archivo que da 404 **no** arruina el precache de los otros 19 (por eso no
  se usa `cache.addAll()`, que es todo-o-nada).
- La activación borra las cachés de versiones anteriores y no toca las ajenas.
- Los POST al backend, las fotos de Drive, el login de Google y la API de Groq
  pasan derecho a la red.
- Con internet lento (30 s simulados) responde en 3,5 s con la copia guardada.
- Sin internet, abrir la app sirve `index.html` desde la caché.

Aparte, se levantó un servidor local **sensible a mayúsculas** (como GitHub
Pages; Windows no lo es) y se pidieron las 20 rutas tal cual están escritas en
`RECURSOS`: las 20 responden 200.
