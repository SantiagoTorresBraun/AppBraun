# Modo offline — cómo funciona

**Qué resuelve:** el Hallazgo 3 de la auditoría. Antes, si un operario cerraba
la app en un silo sin señal, no la podía volver a abrir: aparecía la pantalla de
error del navegador. Ahora la app abre igual, sin internet.

Implementado el **09/09/2026**.

> **Leé también la sección "Qué se ve y qué NO, módulo por módulo"** más abajo.
> Que la app *abra* sin señal es una cosa; que *muestre* los historiales es
> otra, y se resolvió aparte (Hallazgo 13).

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

## Qué se ve y qué NO, módulo por módulo

> Actualizado el 09/09/2026, después de resolver el Hallazgo 13.

| Módulo | Sin señal | Cómo lo consigue |
|---|---|---|
| **Producción** | ✅ Todo, **con fotos** | Guarda los muestreos enteros en IndexedDB y **no los borra** al sincronizar |
| **Control de Carga** | ✅ El historial, **sin fotos** | [historial-local.js](historial-local.js) |
| **Control de Calidad** | ✅ El historial | Ídem (Calidad no trae base64: sus imágenes ya son rutas) |
| **Contratos** | ✅ | Se arma desde el mismo historial de Carga |
| **Ticketera** | ✅ | Ídem |

En los cuatro últimos aparece un cartel arriba de la tabla:

> *Sin conexión: estás viendo la copia guardada del 09/09 14:30. Las fotos y
> firmas no se guardan en el celular.*

Ese cartel no es decorativo. Sin él, el operario vería una tabla llena y creería
que está mirando el estado de ahora.

### Por qué la copia va sin fotos

Medido sobre los datos reales del 09/09/2026:

| | Peso |
|---|---|
| Historial de Carga como viene del Sheet | 4,50 MB |
| — de eso, fotos y firmas en base64 | 4,12 MB (**92%**) |
| Lo que se guarda en el celular | **541 KB** |

Y esas fotos son solo de **6 cargas de 253**. Cada una pesa 679 KB de promedio.
Si todos empezaran a sacar fotos como corresponde, guardar el historial completo
serían unos **168 MB** en el teléfono del operario. Por eso van afuera.

El filtro es **por tamaño, no por nombre de campo**: cualquier valor que empiece
con `data:` o pase los 2.000 caracteres se guarda vacío. Si mañana alguien agrega
`Foto_Precinto`, queda cubierto sin tocar nada.

### Producción es la excepción, y ya lo era

Producción guarda sus muestreos con la foto en base64 adentro y nunca los borra.
El comentario en [produccion.js](produccion.js) lo dice:

> *"marca `_synced` sin borrar la copia local, para que siga siendo la copia de
> trabajo del operario"*

Dos cosas para tener presentes:

1. **Solo se ven las fotos de los muestreos cargados en ESE celular.** Uno que
   cargó otra persona llega como link de Drive, y sin señal el link no sirve.
2. **Crece sin límite.** Una foto pesa ~293 KB, y en base64 ocupa ~390 KB en el
   teléfono. Un muestreo de 10 puntos son ~4 MB. Con 3 muestreos no molesta;
   después de unos meses de uso a campo, sí. Cuando llegue el momento: borrar el
   base64 de los muestreos ya sincronizados de más de X días y dejar el link.
   Lo reciente offline, lo viejo online.

### Los detalles que evitan sorpresas

- **El campo de la foto no se borra, queda en `""`.** Así el resto de la app lo
  sigue encontrando.
- **Se marca `_sinFotos`**, y el detalle de la carga dice *"las fotos no se
  guardan en el celular"* en vez de *"no hay fotos registradas"*, que sería
  mentira.
- **Lo viejo nunca pisa lo nuevo:** la copia solo se usa si el historial en
  memoria está vacío. Si la red contestó, gana la red.
- **Tope de 1,5 MB por módulo.** Si no entra, se guardan los más nuevos. Ojo:
  el Sheet **no** manda los registros ordenados por fecha, y Calidad mezcla
  `2026-08-18` con `8/10/2025`, así que hay que ordenar antes de recortar.
- **Si el teléfono está lleno**, se guarda la mitad y se reintenta. Si no entra
  ni así, no queda una copia a medias: se borra y se avisa en consola.

### Herramientas de soporte

```javascript
leerHistorialLocal('cargas')   // ver la copia y de cuándo es
borrarHistorialLocal()         // borrar las copias de los tres módulos
```

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

> **La app hay que abrirla una vez con internet** antes de que el modo offline
> sirva: el navegador tiene que bajar la copia alguna vez. Un celular que nunca
> abrió la app no va a tener modo offline.

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

49 pruebas automáticas que ejecutan el `sw.js` real dentro de un
`ServiceWorkerGlobalScope` simulado:

- La instalación guarda los 20 archivos.
- Un archivo que da 404 **no** arruina el precache de los otros 19 (por eso no
  se usa `cache.addAll()`, que es todo-o-nada).
- La activación borra las cachés de versiones anteriores y no toca las ajenas.
- Los POST al backend, las fotos de Drive, el login de Google y la API de Groq
  pasan derecho a la red.
- Con internet lento (30 s simulados) responde en 3,5 s con la copia guardada.
- Sin internet, abrir la app sirve `index.html` desde la caché.

Dos de esas pruebas **pasaban por la razón equivocada** y hubo que corregirlas:
una comparaba el mismo contenido antes y después, así que habría pasado igual
con la caché rota; la otra no reproducía que `fetch` devuelve `type: 'basic'` en
el navegador, así que el guard del Service Worker nunca se ejecutaba.

La copia del historial tiene sus propias **63 pruebas** sobre los datos reales
(253 cargas de 4,50 MB, 99 de calidad), incluida una de integración que carga
`app.js` entero y comprueba que sin señal el historial se restaure de verdad.

Aparte, se levantó un servidor local **sensible a mayúsculas** (como GitHub
Pages; Windows no lo es) y se pidieron las 20 rutas tal cual están escritas en
`RECURSOS`: las 20 responden 200.

Y una vez desplegado, se verificaron las rutas del precache contra
`santiagotorresbraun.github.io/AppBraun/` comparando el MD5 de cada archivo vivo
contra el del disco.
