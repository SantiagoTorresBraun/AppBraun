# Auditoría del proyecto — 28/08/2026

Revisión completa de App Braun buscando bugs, riesgos y problemas de estructura.

**Todo lo que hay acá está verificado**, no supuesto: cada hallazgo dice cómo se
comprobó. Donde una sospecha no se confirmó, también está anotado.

Ordenado por urgencia. Los cinco primeros son los que atacaría esta semana.

| # | Hallazgo | Gravedad |
|---|---|---|
| 1 | Cualquiera en internet puede leer y borrar todos los datos | 🔴 Crítico |
| 2 | La contraseña está publicada en GitHub, en texto plano | 🔴 Crítico |
| 3 | ~~La app no abre sin internet (el Service Worker nunca se registra)~~ | ✅ **Resuelto 09/09/2026** |
| 4 | ~~Un registro que falla bloquea toda la cola offline, para siempre~~ | ✅ **Resuelto 09/09/2026** |
| 5 | ~~El historial arma 27 MB de HTML y se rehace en cada tecla~~ (eran 54,2 MB) | ✅ **Resuelto 10/09/2026** |
| 6 | ~~Las fotos van dentro del Sheet: el arranque crece sin techo~~ | ✅ **Resuelto 10/09/2026** (falta correr la migración) |
| 7 | `responder_ticket` puede mandar el correo dos veces | 🟠 Medio |
| 8 | Los catálogos son por dispositivo, no compartidos | 🟠 Medio |
| 9 | La hoja `Orden` se lee y escribe por POSICIÓN de columna | 🟠 Medio |
| 10 | El historial de Carga inserta datos del Sheet sin escapar (XSS) | 🟡 Medio |
| 11 | `Kg_Cargados` se escribe a mano y nada lo controla | 🟡 Bajo |
| 12 | Varios menores | 🟡 Bajo |
| 13 | ~~Sin señal, Carga / Calidad / Contratos / Ticketera muestran la tabla vacía~~ | ✅ **Resuelto 09/09/2026** |
| **14** | **El historial de Calidad aparece y después se desaparece** (mitigado, causa sin identificar) | 🟠 Alto |

---

## 1. 🔴 Cualquiera en internet puede leer y borrar todos los datos

**El backend no tiene ninguna autenticación.** `doPost()` lee `_accion` y ejecuta,
sin verificar quién llama. Y la URL del Web App está escrita en
[app.js:39](app.js#L39), en un repositorio **público**.

**Verificado:**
- `https://api.github.com/repos/SantiagoTorresBraun/AppBraun` → `"private": false`
- Un `GET` sin credenciales devolvió **las 251 cargas completas** y **la lista de
  usuarios con sus correos**. Sin sesión, sin token, sin nada.
- `doPost` no tiene ni un chequeo de identidad en sus 80 líneas de ruteo.

**Qué puede hacer alguien con la URL** (que está a la vista en GitHub):

| Acción | Efecto |
|---|---|
| `?action=read` | Bajarse todo el historial comercial |
| `_accion: "eliminar"` | **Borrar cualquier carga** con sus productos y contratos |
| `_accion: "guardar"` | Meter registros falsos |
| `_accion: "eliminar_usuario"` | Sacar usuarios del sistema |
| `_accion: "enviar_correo_reporte"` | **Mandar correos desde la cuenta de Braun** a cualquier destinatario |

Ese último es el peor: permite mandar mails que salen de la cuenta corporativa.

> **No lo probé de forma destructiva**: confirmé la lectura, y la escritura la
> deduje de leer el código. No hacía falta borrar nada para saberlo.

**Cómo se arregla.** Un secreto compartido es lo mínimo y se hace en un rato:

```javascript
// En el Apps Script, arriba de doPost:
function verificarAcceso(data) {
  var esperado = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (!esperado || data._token !== esperado) throw new Error('No autorizado');
}
```

El token va en las Propiedades del Script (igual que `GROQ_API_KEY`) y el
frontend lo manda en cada pedido. **Ojo:** si el token queda escrito en `app.js`,
también es público — sirve contra el que encuentra la URL suelta, no contra el
que lee el repo. La solución completa es pasar el repo a **privado** (GitHub
Pages con repo privado necesita cuenta Pro) o mover el frontend a otro hosting.

---

## 2. 🔴 La contraseña está publicada en GitHub, en texto plano

[auth.js:19](auth.js#L19):

```javascript
// Hash SHA-256 de la contraseña genérica actual ("Braun123").
const AUTH_HASH_GENERICO = '9c77eb8f3f0c2e378cefc1169452dd9793b990c0611347a28cdc72f88695c94b';
```

**Verificado:** `SHA-256("Braun123")` da exactamente ese hash. Y el comentario
de al lado dice la contraseña **en texto plano**, en un repo público.

Tres problemas encadenados:

1. La contraseña está escrita en el comentario. No hay que romper nada.
2. Aunque no estuviera: es SHA-256 **sin sal** de una palabra de diccionario;
   cualquier tabla la resuelve al instante.
3. **Los 8 usuarios comparten la misma contraseña**, así que `usuario_registro`
   no prueba nada: cualquiera puede entrar como cualquiera.

Y sobre todo: **el login es puramente decorativo**. Como el backend no valida
nada (hallazgo 1), no hace falta ni pasar por la pantalla de login.

**Cómo se arregla.** Por orden de esfuerzo:
1. Sacar la contraseña del comentario y cambiarla. Diez minutos, tapa lo más obvio.
2. Contraseñas individuales por usuario, con sal, en la hoja `Usuarios`.
3. Lo correcto: login con Google (`Session.getActiveUser()` del lado del Apps
   Script), que además elimina el hallazgo 1 de raíz.

---

## 3. ✅ La app no abre sin internet — RESUELTO el 09/09/2026

La documentación dice "offline-first" y los operarios trabajan en silos y
centros de acopio. Pero:

```javascript
// sw.js completo
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e => { /* Estrategia de red posterior */ });
```

**El `fetch` está vacío: no cachea nada.** Y peor todavía:

**Verificado:** `grep -rn "serviceWorker" *.js *.html` → **cero resultados**.
`sw.js` **nunca se registra**. Es código muerto.

Además, tres recursos vienen de internet y sin señal no cargan:

| Recurso | Si no carga |
|---|---|
| `cdnjs.../jspdf.umd.min.js` | **No se puede generar ningún PDF ni mandar reportes** |
| `cdnjs.../font-awesome` | Desaparecen todos los íconos |
| `accounts.google.com/gsi` | No se puede mandar desde el Gmail del usuario |
| Ícono del `manifest.json` | Apunta a `lh3.googleusercontent.com` (Drive) |

Lo offline hoy funciona **solo si la pestaña ya estaba abierta**: IndexedDB
guarda la cola. Si el operario cierra la app y la vuelve a abrir sin señal, **no
abre nada**.

**Cómo se arregla.** Registrar el SW y cachear el armazón:

```javascript
// en index.html, al final
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

```javascript
// sw.js — cachear el armazón de la app
const CACHE = 'braun-v1';   // subir la versión en CADA despliegue
const ARCHIVOS = ['./', './index.html', './app.js', './auth.js', './correo.js',
  './calidad.js', './produccion.js', './agente.js', './style.css',
  './logo-braun.png', './logo-senasa.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }));
});

// Borra los cachés de versiones anteriores, si no queda la app vieja pegada.
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
  }));
});

self.addEventListener('fetch', function (e) {
  // Solo el armazón sale del caché. Los pedidos al Apps Script NUNCA:
  // servir datos viejos del historial sería peor que no mostrar nada.
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('script.google.com') !== -1) return;
  e.respondWith(
    caches.match(e.request).then(function (r) { return r || fetch(e.request); })
  );
});
```

Y **descargar jsPDF y Font Awesome al repo** en vez de traerlos del CDN.

> Al cachear hay que versionar el `CACHE` en cada despliegue, si no los operarios
> se quedan con la versión vieja pegada.

### ✅ Cómo quedó (09/09/2026)

| Lo que estaba mal | Cómo quedó |
|---|---|
| `sw.js` nunca se registraba | [offline.js](offline.js) lo registra en el evento `load`, con `updateViaCache: none` |
| El `fetch` del SW estaba vacío | [sw.js](sw.js) precachea 20 archivos (1,7 MB) y sirve con dos estrategias |
| jsPDF venía de cdnjs | [vendor/jspdf.umd.min.js](vendor/jspdf.umd.min.js) — local |
| Font Awesome venía de cdnjs | [vendor/fontawesome/](vendor/fontawesome/) — CSS + las 4 fuentes woff2 |
| El fondo del login venía de Unsplash | [fondo-login.jpg](fondo-login.jpg) — local |

Dos detalles que cambian respecto de la receta de arriba, y por qué:

1. **No se usa `cache.addAll()`.** Es todo-o-nada: un solo 404 deja la caché
   vacía y el modo offline muerto, en silencio. Se guarda archivo por archivo.
2. **El armazón NO es cache-first, es red-primero con 3,5 s de paciencia.**
   Cache-first obligaría a subir `VERSION` en cada despliegue (y olvidarse una
   vez deja a todos con la app vieja pegada). Con red-primero un despliegue se
   ve al recargar, y el límite de 3,5 s cubre el caso real del silo: la señal
   no está cortada, está *lenta*. Solo `vendor/`, imágenes y fuentes van
   cache-first, porque no cambian nunca.

Verificado con 48 pruebas automáticas que ejecutan el
`sw.js` real: instalación, limpieza de versiones viejas, que el backend y Drive
nunca se cacheen, y que las 20 rutas respondan 200 con mayúsculas exactas (GitHub
Pages distingue mayúsculas; Windows no).

**Queda afuera, a propósito:** el ícono del `manifest.json` sigue en Drive. Solo
se usa al instalar la app en el celular, y para instalarla hace falta internet
igual. Y `accounts.google.com/gsi`, que es el login de Gmail: sin señal no se
puede mandar un correo de todos modos.

---

## 4. ✅ Un registro que falla bloquea toda la cola offline — RESUELTO el 09/09/2026

[app.js — `sincronizarDatosPendientes()`](app.js) y
[calidad.js — `sincronizarCalidadPendientes()`](calidad.js) tienen el mismo bug:

```javascript
store.openCursor().onsuccess = function(e) {
    const cursor = e.target.result;
    if (cursor) {
        enviarAlBackend(item)
        .then(() => { /* borra y VUELVE A LLAMARSE */ })
        .catch(err => { /* ... y acá NO sigue con el siguiente */ });
    }
};
```

Procesa **un solo registro por llamada** y avanza únicamente cuando ese registro
se guardó bien. **Si el primero falla, los que están atrás no se intentan nunca.**
Y como reintenta siempre el mismo primero, la cola queda trabada para siempre.

**Escenario real:** un operario carga 5 controles sin señal. El primero tiene una
foto que Drive rechaza. Los otros 4 **no se sincronizan jamás**, sin ningún aviso
de que quedaron ahí.

**Que es un olvido y no una decisión** se ve en el mismo archivo:
`eliminarRegistro()` sí usa `cursor.continue()` para recorrer todo. Y
`produccion.js` usa `getAll()` + `forEach`, así que **no tiene el problema**.

**Cómo se arregla.** Seguir con el siguiente aunque uno falle:

```javascript
.catch(err => {
    console.error("No se pudo sincronizar:", err);
    // ... aviso ...
    procesarSiguiente(idKey);   // ← salta este y sigue con los demás
});
```

Hace falta llevar una lista de "ya intentados en esta pasada" para no quedar en
un bucle infinito sobre el mismo registro fallado.

---

### ✅ Cómo quedó (09/09/2026)

Toda la lógica vive ahora en [cola-sync.js](cola-sync.js), un solo motor que
usan las tres colas. `sincronizarDatosPendientes()`, `sincronizarCalidadPendientes()`
y `sincronizarTicketsPendientes()` siguen existiendo con el mismo nombre —las
llaman muchos lugares— pero adentro solo delegan.

**El cambio de fondo:** la cola se recorre entera de a uno, y un fallo NO frena
al resto. El registro que falla se queda donde está y los demás siguen saliendo.

#### Los dos tipos de error, que no son lo mismo

Esta es la decisión de diseño que más importa, y va más allá de lo que pedía el
hallazgo:

| Qué pasó | ¿Suma intento? | Qué hace |
|---|---|---|
| El backend contestó **que no** (dato inválido, Drive rechazó la foto) | **Sí** | A los 3 intentos pasa a revisión manual |
| **No hubo respuesta** (sin señal, timeout, CORS) | **No** | Reintenta siempre, cada 2 minutos |

Si los errores de red contaran, **un día entero en un silo quemaría los 3
intentos de todo lo pendiente**, y el operario se encontraría al volver con
veinte registros marcados como "fallidos" que en realidad estaban perfectos. La
falta de señal es justo lo que la cola tiene que tolerar, no lo que la tiene que
romper.

#### Reintentos con espera

Tras un rechazo del backend: **1 minuto → 5 minutos → 15 minutos**, y al tercero
queda para revisión manual. Un latido cada 60 segundos vuelve a intentar solo;
sin él, un registro en espera se quedaría esperando hasta que algo más disparara
una sincronización.

#### Lo que se ve en pantalla

Aparece una **barra fija abajo**, visible desde cualquier pantalla:

> ⚠️ *2 registros no se pudieron enviar y necesitan que los revises.* **[Revisar]**

Va fija a propósito: el panel `#offline-records` que ya existía está enterrado al
fondo del formulario de Control de Carga, y el operario solo lo ve si baja hasta
el final. Sirve para "tenés cosas en cola", no para algo que necesita atención.

"Revisar" abre una pantalla con cada registro trabado, su motivo, y dos botones:
**Reintentar** y **Descartar**. Descartar pregunta con todas las letras que el
registro nunca llegó al servidor y que se pierde para siempre.

#### Decisiones que vale la pena dejar escritas

- **Un registro fallido NUNCA se borra solo.** Los datos que cargó el operario no
  se tiran sin que él lo decida.
- **Reintentar es seguro:** el backend ya es idempotente (chequea `Id_Carga` /
  `Id_Calidad` adentro de un `LockService` antes de escribir).
- **Una cola por vez.** Si vuelve la señal, se toca refrescar y salta el latido,
  los tres disparos no mandan el mismo registro tres veces.
- **Si se corta la señal a mitad**, la pasada se interrumpe en vez de seguir
  golpeando al vacío.
- **Los campos internos** (`_intentos`, `_fallido`, `_ultimoError`…) nunca viajan
  al backend.
- **Producción no se tocó:** `sincronizarMuestreosPendientes()` ya recorría con
  `getAll()` + `forEach`, así que cada muestreo iba por su cuenta. Ese módulo
  nunca tuvo el bug.

#### Cómo se verificó

**43 pruebas** sobre el `cola-sync.js` real con un IndexedDB simulado. La primera
**reproduce el bug viejo** ejecutando el patrón exacto que tenía `app.js`, para
que quede demostrado que el arreglo arregla algo real: con una cola de 5 y el
primero fallando, el bucle viejo manda 1 solo y deja los otros 4 sin enviar para
siempre.

También se comprueba que un registro cargado **después** del que falló sí se
envía —el corazón del hallazgo—, que 5 fallos de red seguidos no gastan ni un
intento, que dos sincronizaciones simultáneas no duplican nada, y que
`sincronizarDatosPendientes()` de `app.js` llega de verdad al motor.

---

## 5. ✅ El historial arma 27 MB de HTML — RESUELTO el 10/09/2026 (eran 54,2 MB)

[app.js:2139](app.js#L2139) mete el registro **entero** —fotos en base64
incluidas— dentro de los atributos `onclick` de cada fila:

```javascript
const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(item))));
```

Y ese `dataString` se repite en **5 atributos por fila** (fecha, producto,
contrato, estado, peso).

**Medido sobre los datos reales:**

| | |
|---|---|
| Fila sin fotos | 3 KB |
| Fila con fotos | **713 KB** × 5 atributos = **3,5 MB en una sola fila** |
| **Tabla completa (251 filas)** | **27,3 MB de HTML** |

Y se reconstruye **en cada tecla**: `filter-search`, `filter-lote` y
`filter-posicion` escuchan `input` **sin debounce**
([app.js:2074-2079](app.js#L2074)). Escribir "garbanzo" son 8 reconstrucciones de
27 MB. En un celular eso congela la app.

**Cómo se arregla.** Dos cambios independientes, los dos simples:

1. **No meter el registro en el HTML.** Guardar los registros en un `Map` por
   `Id_Carga` y pasar solo el id: `onclick="abrirDetalle('BC-123')"`. La tabla
   pasa de 27 MB a unos pocos KB.
2. **Debounce de 250 ms** en los tres filtros de texto.

---

### ✅ Cómo quedó (10/09/2026)

Primero hubo que medirlo de nuevo, y era **peor de lo que decía este documento**:
no 27 MB sino **54,2 MB**, con una sola fila que llegaba a **12,34 MB**.

**Y el culpable no era la cantidad de filas.** Cada fila hacía esto:

```javascript
const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(item))));
```

Es decir: metía el **registro entero** —con sus fotos en base64 adentro, porque
las fotos viven dentro del Sheet (Hallazgo 6)— convertido otra vez a base64, y
lo pegaba **nueve veces** en el HTML de esa fila, una por cada `onclick`.

Una carga con fotos pesa ~680 KB. En base64, ~900 KB. Por nueve: **8 MB en una
fila de tabla**.

Entonces la solución de fondo no era paginar: era **dejar de meter el dato en el
HTML**. Ahora la fila lleva una clave de dos caracteres (`r7`) y el registro se
queda en memoria, que es donde siempre estuvo.

| | Antes | Ahora |
|---|---|---|
| HTML del historial | **54,23 MB** | **78 KB** |
| La fila más pesada | 12,34 MB | 1.734 caracteres |
| Renders al escribir "garbanzo" | 8 | 1 |

**708 veces menos.** Medido ejecutando el `app.js` real con las 253 cargas.

#### Lo que se hizo, en orden de impacto

1. **El registro sale del HTML** ([render-historial.js](render-historial.js)).
   Una libreta en memoria traduce la clave corta al registro. `resolverRegistro()`
   acepta tres cosas a propósito —un objeto, una clave, o el base64 de antes—
   así no hubo que tocar a ninguno de los que ya la llamaban.

2. **Paginado de a 50**, con un pie que dice *"Mostrando 50 de 251"* y un botón
   *Ver 50 más*. Al agregar una página NO se rehacen las filas que ya están.

3. **`DocumentFragment`**: se arma todo aparte y se cuelga de una sola vez, en
   lugar de un `appendChild` por fila.

4. **Espera de 300 ms** antes de filtrar, en los cinco buscadores: historial,
   lote, posición, contratos y ticketera.

#### Un efecto secundario que valía la pena

Las pantallas de detalle hacían `btoa(JSON.stringify(registro))` para pasarle el
registro a otra función que lo decodificaba enseguida. Con una carga con fotos
eso era casi un mega de ida y otro de vuelta, cada vez que se tocaba "Editar" o
"PDF". Ahora pasan el objeto directo.

#### Una cosa que casi rompe todo

`rebotar()` se llama en el **nivel superior** de `app.js`. Si
`render-historial.js` no cargara, un `ReferenceError` ahí se llevaría puesta la
app entera, login incluido. Quedó con respaldo: si el helper falta, el historial
filtra con cada tecla como antes, pero **la app arranca**. Lo encontró la prueba
de integración, no el navegador.

#### Lo que NO se tocó

El historial de **Control de Calidad** usa el mismo patrón `dataString`, pero sus
registros no tienen fotos en base64 (sus imágenes ya son rutas): las 99 filas dan
alrededor de 1 MB, no 54. Con la espera de 300 ms alcanza por ahora. Conviene
pasarlo a la libreta cuando se toque ese módulo.

#### Cómo se verificó

**35 pruebas** que ejecutan el `app.js` real con las 253 cargas del Sheet y miden
el HTML generado fila por fila. Se comprueba que no quede ni un `data:image` en
las filas, que la clave corta resuelva al registro correcto **con todos sus
campos**, que "Ver más" no invalide las claves de las filas de arriba, y que
`resolverRegistro()` siga aceptando el base64 viejo.

---

## 6. ✅ Las fotos van dentro del Sheet — RESUELTO el 10/09/2026

Las fotos de Control de Carga se guardan **en base64 dentro de la celda**, no en
Drive como hacen Calidad y Producción.

**Medido:**

| | |
|---|---|
| Peso de `?action=read` | **4,1 MB** |
| De eso, fotos y firmas | **92%** |
| Cargas que tienen fotos base64 | **solo 6 de 251** |
| Peso promedio de esas 6 | **613 KB cada una** |

O sea: **6 cargas explican el 86% de lo que se descarga en cada arranque de la
app, para todos los usuarios.** Las otras 245 son livianas porque sus fotos
quedaron como links de Drive en la migración de AppSheet.

Y cada carga nueva suma ~613 KB **para siempre**:

| Cargas nuevas | Se baja en cada arranque |
|---|---|
| 50 | 30 MB |
| 200 | 120 MB |
| 500 | 299 MB |

**Cómo se arregla.** Subir las fotos de Carga a Drive, igual que ya se hace en
Calidad (`guardarFotoCalidadEnDrive` está escrita y probada). Además hay que
migrar las 6 existentes.

### Lo que sospeché y NO se confirmó

Google Sheets documenta un límite de **50.000 caracteres por celda**, y hay
**30 celdas que lo superan** (la mayor: 166.683 caracteres). Parecía corrupción
silenciosa.

**Lo verifiqué decodificando las 33 fotos y mirando su marca de cierre
(`FFD9` en JPEG): las 33 están completas.** No hay datos corruptos. El límite no
está actuando sobre lo que escribe el script.

Vale igual una observación: `crearTicket()` **sí** trunca a 45.000 caracteres
(`"(adjunto demasiado grande...)"`), o sea que el límite se tuvo en cuenta para
los tickets pero no para las fotos de carga. Inconsistente, pero hoy no rompe.

---

### ✅ Cómo quedó (10/09/2026)

**Falta un paso manual: hay que pegar el backend en Apps Script y correr la
migración una vez.** Ver "Qué hacer" al final.

Calidad, Producción y los archivos de Carta de Porte **ya subían a Drive**. El
único que seguía metiendo base64 en el Sheet era Control de Carga. Ahora sube
igual que los demás.

| | Antes | Ahora |
|---|---|---|
| Hoja `Orden` completa | **4,50 MB** | **740 KB** |
| Una carga con sus 8 fotos | **546 KB** | **26 KB** |
| Promedio por carga | — | **3 KB** |
| A 200 cargas/año | ~135 MB/año | **1 MB/año** |

Eso es lo que saca el "sin techo" del título: el crecimiento deja de depender de
cuántas fotos saquen.

#### Por qué se guarda una URL `lh3` y no una ruta relativa

Calidad guarda `"Control de Calidad_Images/xxx.jpg"` y después resuelve esa ruta
a una URL, con caché, una por una. Para Carga eso no sirve: son 8 imágenes por
fila y 253 filas — resolverlas en cada lectura sería eterno.

Acá se guarda **la URL final ya armada**. Y se eligió `lh3.googleusercontent.com`
y no `drive.google.com/uc` porque se verificaron las dos con el `Origin` del
sitio:

```
lh3.googleusercontent.com/d/<id>  ->  200 + Access-Control-Allow-Origin: *
drive.google.com/uc?id=<id>       ->  403
```

Esa diferencia importa: con `lh3` la foto se ve en un `<img>` **y** se puede
bajar con `fetch()` para meterla en el PDF. Con `/uc` no — y es exactamente por
eso que las fotos de Producción no salían en el reporte de muestreo.

#### Las firmas se quedan en la celda, a propósito

Se midió: las firmas son **198 KB de los 4.063 KB, el 5%** (16 KB cada una).
Las fotos son el 95%. Sacando solo las fotos ya se consigue casi todo.

Y moverlas rompía dos cosas del editor de cargas:

1. `restaurarFirmaEnCanvas()` descarta cualquier valor de menos de 100
   caracteres. Una URL `lh3` mide unos 50: **la firma desaparecería al editar**.
2. Dibujar una imagen de otro dominio en un canvas lo *contamina*, y
   `soloPTFirma()` hace `canvas.toDataURL()` al guardar → `SecurityError`.

Se podría arreglar con `crossOrigin="anonymous"`, pero son tres cambios en un
camino que hoy anda, por el 5% del problema. Queda anotado en el código por si
algún día vale la pena.

#### La compresión del cliente ya estaba, y ya da 100 KB

El punto 3 del pedido —comprimir a ~100 KB antes de mandar— **ya estaba hecho**:
[app.js](app.js) redimensiona a 600 px de ancho y guarda JPEG con calidad 0,5.
Medido sobre las 39 fotos reales: **99 KB de promedio**, 163 KB la mayor. No
hacía falta agregar nada.

> Nota para más adelante: Carga usa 600 px / 0,5, mientras que Producción usa
> 1280 px / 0,6. Ahora que las fotos no pesan en el Sheet, se podría subir la
> calidad de Carga sin costo. No se tocó porque nadie lo pidió.

#### Detalles que evitan sorpresas

- **Se sube ANTES del lock.** Subir 8 imágenes tarda segundos y no hay que dejar
  a los demás pedidos esperando.
- **Pero primero se chequea si la carga ya existe.** Sin eso, un reintento de la
  cola offline subiría las 8 fotos otra vez antes de descubrir —ya adentro del
  lock— que la fila estaba, y dejaría 8 archivos huérfanos en Drive **por cada
  reintento**. El chequeo de adentro del lock sigue estando: el de afuera cubre
  el reintento (lo común), el de adentro la carrera real (lo raro).
- **Solo se sube lo que empieza con `data:image`.** Si ya es una URL —una
  edición, un reintento— se deja como está.
- **Si Drive falla, la carga NO se pierde:** la foto queda en base64 en la celda,
  como antes, y queda anotado en el log. Vale más una carga guardada con una
  foto pesada que una carga perdida.
- **Cada archivo se comparte** con `ANYONE_WITH_LINK`. Sin ese permiso la URL se
  graba igual pero la app recibe 403 y el operario ve "Sin foto", como si nunca
  se hubiera guardado. Ya pasó con las fotos de Calidad.

#### El frontend no hubo que tocarlo

Los cuatro caminos que usan las fotos ya aceptaban URLs:

| Camino | Por qué anda |
|---|---|
| El PDF | `obtenerImagenComoBase64()` ya distinguía `data:` de `http` |
| El detalle | pinta con `<img src>` |
| Editar una carga | también usa `<img src>`, y conserva el valor tal cual |
| Guardar una edición | el backend saltea lo que no es `data:image` |

#### Cómo se verificó

**33 pruebas** que ejecutan las funciones reales de `01_backend_principal.gs`
con Drive y Sheets simulados y las **253 cargas reales**: que las 8 fotos suban
y queden como URL, que las firmas y los datos no se toquen, que un reintento no
suba nada de nuevo, que si Drive falla la foto quede en base64 en vez de
perderse, y que una carga sin fotos no toque Drive.

---

### Qué hacer (paso a paso)

1. **Sacar una copia del Sheet** — Archivo → Hacer una copia. Son 5 segundos y
   es la red de seguridad.
2. **Abrir el editor de Apps Script** y reemplazar `01_backend_principal.gs` por
   el de este repo.
3. **Guardar** y volver a desplegar (Implementar → Administrar implementaciones →
   editar → Nueva versión).
4. Antes de migrar, correr **`medirPesoDeLaHojaOrden()`** y anotar el número.
5. Correr **`migrarImagenesDeCargaADrive()`**. Son 39 imágenes en 6 filas:
   alrededor de un minuto. El log dice cuántas movió.
6. Volver a correr **`medirPesoDeLaHojaOrden()`** y comparar.
7. Abrir el historial de Control de Carga y verificar que las fotos de una
   carga vieja se sigan viendo, y que el PDF salga con las fotos.

La migración se puede correr **varias veces sin problema**: lo que ya es URL lo
saltea. Si alguna falla, queda en base64 y se puede reintentar.

**La primera vez** que se guarde una foto, Apps Script va a crear la carpeta
`Control de Carga_Images` dentro de `APP_Braun_2026/Images` y va a dejar su ID
en el log. Conviene copiarlo a `ID_CARPETA_CARGA_IMAGES` para que no la tenga
que buscar por nombre cada vez.

---

## 7. 🟠 `responder_ticket` puede mandar el correo dos veces

Es exactamente la misma causa de los reportes duplicados que arreglamos, en un
lugar donde quedó sin tapar.

- `enviarAlBackend()` **reintenta el POST a ciegas** cuando no puede leer la
  respuesta ([app.js:86](app.js#L86)).
- `responderTicket()` en el backend **no tiene ninguna guarda**: aplica el cambio
  y manda el correo al solicitante, siempre.

Un reintento → **el solicitante recibe la respuesta dos veces**.

**Las otras acciones de ticket sí se salvan**, y conviene entender por qué:

| Acción | Por qué no duplica |
|---|---|
| `crear_ticket` | Chequea `id_ticket`; si ya existe, devuelve "ya existía" sin mandar |
| `actualizar_ticket` | Solo manda si el responsable **cambió** respecto del anterior; en el reintento ya son iguales |
| `responder_ticket` | **Nada. Manda siempre.** |

**Cómo se arregla.** Reusar el antiduplicado que ya existe: la función
`claveEnvioCorreo()` + caché + lock de `enviarReportePorCorreo()` sirve tal cual,
cambiando la clave por `id_ticket + destinatario`.

---

## 8. 🟠 Los catálogos son por dispositivo, no compartidos

Los ENUMS (Producto, Calibre, Envase, Destino, Elaboró) viven **solo en
`localStorage`** ([app.js:96](app.js#L96)). Si Lucas agrega un calibre en su
celular, Santiago no lo ve. Cada dispositivo arma su propia lista.

**El resultado está en los datos:**

| Catálogo | En el catálogo por defecto | Valores realmente usados |
|---|---|---|
| Calibre | 7 | **26** |
| Destino | 1 | **43** |
| Producto | 6 | 7 |

Los 22 calibres que no están en el catálogo incluyen duplicados de escritura del
mismo valor: `8 mm` / `8mm`, `3,5 mm` / `3.5mm` / `3,5mm`, y categorías que no
son calibres (`PRELIMPIEZA`, `DESCARTES`, `MESA 8 mm`, `COLORIMETRICA`).

**Y un error de tipeo que ya está en producción: `Pororo RDK`** (por "Poroto
RDK"). También `Big Bags` conviviendo con `Big Bag`.

**Esto es la causa de fondo de los problemas de datos.** El agente de IA ya
compensa unificando escrituras al agrupar, pero eso es tapar el síntoma.

**Cómo se arregla.** Igual que ya se hizo con **Usuarios**: una hoja `Enums` en
el Sheet, que la app baja al iniciar y cachea en `localStorage` para offline. El
patrón ya está escrito en `sincronizarUsuariosDesdeSheet()`.

---

## 9. 🟠 La hoja `Orden` se lee y escribe por POSICIÓN de columna

`insertarFilaOrden()` arma un array de 37 posiciones y `doGet` lee `row[15]`,
`row[34]`, `row[36]`... Y `marcarEstadoCorreo()` escribe directo en las
**columnas 35 y 36**, con el número escrito a mano.

**Si alguien inserta una columna en el medio de `Orden`, todo se corre y la app
empieza a leer y escribir en el campo equivocado — sin ningún error.** El
ESTATUS pasa a leerse de la firma, el correo se escribe sobre los kilos.

Es especialmente fácil de provocar porque la hoja tiene columnas heredadas de
AppSheet que hoy están vacías (`Archivo`, `PDF`, `Estado`, `CP1`-`CP5`) y a
cualquiera le puede parecer razonable borrarlas para ordenar.

**Las hojas de Calidad no tienen este problema**: se mapean **por nombre de
encabezado**, y por eso agregar una columna ahí funciona sola.

**Cómo se arregla.** Pasar `Orden` al mismo esquema por nombre que Calidad. Es un
trabajo de una tarde y elimina toda una clase de fallas futuras. Mientras tanto,
como mínimo: dejar un aviso arriba de la hoja **"no insertar ni borrar columnas"**.

---

## 10. 🟡 El historial de Carga inserta datos del Sheet sin escapar

[app.js:2153](app.js#L2153) arma las filas con `innerHTML` interpolando datos que
vienen del Sheet **sin pasarlos por `escapeHtml()`**:

```javascript
<span class="badge ${item.ESTATUS ? item.ESTATUS.toLowerCase() : 'sin-dato'}">
```

Son `Fecha`, `ESTATUS`, la lista de productos y la de contratos. El caso de
`ESTATUS` es el peor porque va **adentro de un atributo `class`**: un valor con
comillas se sale del atributo.

**No es teórico**, porque se encadena con el hallazgo 1: cualquiera puede
escribir en el Sheet a través del endpoint público. Un `contrato_com` con
`<img src=x onerror=...>` se ejecuta en el navegador de cada operario que abra el
historial.

**El resto de la app sí lo hace bien**, lo que confirma que es un descuido y no
un criterio: la Ticketera escapa `nombre_solicitante` y `correo_solicitante`, y
Calidad escapa con `escapeHtml(loteVariedad)`.

**Cómo se arregla.** Envolver esos cuatro valores en `escapeHtml()`. Para el
atributo `class`, además, limitarlo a la lista conocida:

```javascript
const clase = ['aceptado','observado','rechazado'].includes(
    String(item.ESTATUS || '').toLowerCase()) ? item.ESTATUS.toLowerCase() : 'sin-dato';
```

---

## 11. 🟡 `Kg_Cargados` se escribe a mano y nada lo controla

El total del encabezado es un campo aparte, sin relación con los productos. El
PDF muestra `Kg_Cargados` arriba y los kilos por producto abajo, **y pueden
contradecirse en el mismo papel**.

**Verificado sobre las 251 cargas: en 11 no coinciden** (más de 2% de diferencia):

| Fecha | Encabezado | Suma de productos |
|---|---|---|
| 2026-07-05 | 785.578 | 50 |
| 2026-03-20 | 30.460 | 30 |
| 2026-01-06 | **4** | 25.000 |
| 2026-01-20 | 35.640 | 30.530 |

El de 4 kg contra 25.000 es claramente un error de tipeo que nadie detectó, y
salió impreso en un reporte.

**Cómo se arregla.** Calcularlo automáticamente como suma de los productos (igual
que ya se hace con `Total Kg` de cada ítem), o dejarlo editable pero avisando en
pantalla cuando se aparta más de un 2%.

---

## 12. 🟡 Menores

| Qué | Dónde | Impacto |
|---|---|---|
| Una carga con `Tipo_Carga` vacío **no se ve ni en el historial PT ni en el MP** | [app.js](app.js) filtro `item.Tipo_Carga !== tipoCargaActual` | Hoy 0 afectadas, pero queda latente. Tratar el vacío como `PT`. |
| `cargarHistorialCalidadDesdeGoogle()` hace `fetch` **sin `.catch`** | [calidad.js:547](calidad.js#L547) | Si falla la red queda una promesa rechazada sin manejar y el historial silenciosamente viejo |
| `#tab-btn-nuevo` y `#tab-btn-historial` no existen en el HTML | [app.js:348](app.js#L348) | Código muerto. Están protegidos con `if`, no rompen |
| El ícono del `manifest.json` es una URL de Drive | `manifest.json` | Sin internet no hay ícono; si el archivo deja de ser público, se rompe |
| 7 cargas sin `ESTATUS` | Datos | Ya no se muestran como "ACEPTADO" (se corrigió), pero siguen sin completar |
| 203 nombres de chofer distintos en 251 cargas | Datos | `Taborda Lucas` / `Lucas Taborda` es la misma persona contada dos veces |
| El agente manda a **Groq** nombres de clientes, destinos y contratos | [agente.js](agente.js) | Es un tercero fuera de Braun. Vale saberlo aunque sea aceptable |
| `escape()` / `unescape()` están obsoletas | varios | Funcionan, pero conviene migrar a `TextEncoder` |

---

## 13. ✅ Sin señal, casi todos los historiales se ven vacíos — RESUELTO el 09/09/2026

*Encontrado el 09/09/2026, al verificar el arreglo del Hallazgo 3.*

Arreglar el Service Worker hizo que la app **abra** sin internet. Pero abrir no
es lo mismo que **mostrar**: hoy, sin señal, el operario entra a Control de
Carga y ve **una tabla en blanco, sin ningún mensaje**. No tiene forma de saber
si es porque no hay señal o porque no hay registros.

| Módulo | Sin señal |
|---|---|
| **Producción** | ✅ Muestra todos los muestreos |
| Control de Carga | ⚠️ Tabla vacía |
| Control de Calidad | ⚠️ Tabla vacía |
| Contratos | ⚠️ Tabla vacía |
| Ticketera | ⚠️ Tabla vacía |

**La causa.** Los cinco módulos arman la lista igual: lo que está en IndexedDB
más lo que vino del Sheet. La diferencia está en qué pasa con la copia local
*después* de sincronizar.

Producción **la conserva**, y el comentario en [produccion.js](produccion.js)
dice explícitamente por qué:

> *"marca `_synced` sin borrar la copia local, para que siga siendo la copia de
> trabajo del operario"*

Los otros **la borran** apenas el backend confirma:

```javascript
// app.js:2533 — Control de Carga
if (cursor.value.Id_Carga === item.Id_Carga) { cursor.delete(); }

// calidad.js:410 — Control de Calidad
delTx.objectStore("controles_calidad").delete(idKey)

// app.js — Ticketera
delTx.objectStore('ticketera_tickets').delete(idKey)
```

Y la otra mitad del historial vive **solo en memoria**:

```javascript
let historialGeneral = [];   // app.js:90 — se pierde al cerrar la app

function cargarHistorialDesdeGoogle() {
    if (!navigator.onLine || ...) return;   // ← sin señal se va sin hacer nada
}
```

**Verificado:** `grep localStorage` sobre los historiales no devuelve nada. No
se persisten en ningún lado. Sin señal, la cola local está vacía (ya sincronizó
todo) y `historialGeneral` es `[]`. Resultado: tabla en blanco.

Tampoco hay estado vacío: el código hace `tbody.innerHTML = ""` y, si no hay
filas, no agrega nada más.

**Cómo se arregla.** Dos niveles:

1. **Un cartel honesto** (10 minutos): si la tabla queda vacía y
   `!navigator.onLine`, decirlo. No arregla el fondo, pero saca la ambigüedad
   entre "no hay señal" y "no hay registros".

2. **Guardar el historial, como ya hace Producción** (unas horas): dejar de
   borrar la copia local al sincronizar (marcarla `_synced` y listo) y persistir
   lo que baja del Sheet. Es un patrón que en este mismo proyecto ya funciona.

> **Ojo:** el Hallazgo 6 (fotos en base64 adentro del Sheet) choca con esto.
> Guardar el historial de Carga completo en el celular arrastraría las fotos.
> Conviene guardarlo **sin fotos**, o resolver el 6 antes.

### ✅ Cómo quedó (09/09/2026)

Se hicieron **los dos** niveles, en [historial-local.js](historial-local.js).

Carga, Calidad, Contratos y Ticketera ahora guardan una copia del historial en
el celular y la muestran cuando no hay señal, con un cartel arriba de la tabla
que dice de cuándo son los datos. Producción queda como estaba: ya guardaba sus
muestreos enteros.

**La copia va sin fotos ni firmas**, y eso es lo que hace viable todo lo demás:

| | Peso |
|---|---|
| Historial de Carga como viene del Sheet | 4,50 MB |
| — de eso, fotos y firmas en base64 | 4,12 MB (**92%**) |
| Lo que se guarda en el celular | **541 KB** |
| Calidad (no tiene base64: sus imágenes ya son rutas) | 123 KB |
| Ticketera | 1 KB |

El filtro es **por tamaño, no por nombre de campo**: cualquier valor que empiece
con `data:` o pase los 2.000 caracteres se guarda vacío. Así, si mañana alguien
agrega `Foto_Precinto`, queda cubierto sin tocar nada.

Detalles que importan:

- **El campo no se borra, queda en `""`.** El resto de la app lo sigue
  encontrando y no hay que revisar cada lugar que lo lee.
- **Se marca `_sinFotos`**, y la pantalla de detalle ahora dice *"las fotos no se
  guardan en el celular"* en vez de *"no hay fotos registradas"*, que sería
  mentira.
- **Lo viejo nunca pisa lo nuevo:** restaurar la copia solo actúa si el historial
  en memoria está vacío. Si la red llegó a contestar, gana la red.
- **Tope de 1,5 MB por módulo.** Si no entra, se guardan los más nuevos. Como el
  Sheet NO manda los registros ordenados por fecha (y Calidad mezcla
  `2026-08-18` con `8/10/2025`), hay que ordenar antes de recortar; si no, se
  guardarían registros al azar y el operario perdería justo los de esta semana.

Verificado con 63 pruebas sobre los **datos reales** (253 cargas de 4,50 MB, 99
de calidad), incluida una de integración que carga `app.js` entero y comprueba
que sin señal el historial se restaure de verdad. Dos bugs salieron de ahí: un
fallo mudo al guardar cuando el teléfono está lleno, y que `new Date(null)` no
es una fecha inválida sino el 1/1/1970 (el cartel mostraba "31/12 21:00").

---

## 14. 🟠 El historial de Calidad aparece y después se desaparece — SIN RESOLVER

*Reportado el 10/09/2026. Mitigado, pero la causa NO está identificada.*

Santiago entra a Control de Calidad — Garbanzo, no ve nada; recarga, los 64
controles aparecen, y al rato **se desaparecen solos**.

### Lo que se descartó, con evidencia

| Revisado | Resultado |
|---|---|
| Los 99 controles en el backend | ✅ están (64 Garbanzo, 35 Poroto Mung) |
| Los 4 endpoints con `Origin` y `Referer` del sitio | ✅ 200 OK |
| Preflight CORS (`OPTIONS`) | ✅ 200 |
| Los 9 archivos JS cargando en el orden real de `index.html` | ✅ sin errores |
| Colisiones de nombres entre archivos | ✅ ninguna |
| `calidad.js` desplegado vs. disco | ✅ idéntico |

Se reprodujo la carga con **tiempos reales medidos** (backend 2,5 s, IndexedDB
5 ms) y se probaron nueve escenarios buscando cuál vacía la tabla: reabrir el
módulo, cambiar de pestaña, el latido de la cola, una cola con pendientes,
escribir y borrar en el buscador, perder la señal, tres renders simultáneos,
cambiar de grano, y no hacer nada. **Ninguno la vacía.**

Pasa algo en el navegador que la simulación no reproduce.

### Lo que sí se hizo (mitigación, no arreglo)

1. **Red de contención** en `filtrarYRenderizarCalidad()`: si `historialCalidad`
   queda vacío pero hay copia guardada en el celular, se usa la copia y se
   muestra el cartel de "estás viendo la copia guardada del…". Verificado en
   los dos sentidos: forzando el vaciado la tabla se mantiene en 64 filas, y
   sin copia guardada sí queda vacía, como corresponde.

2. **Rastro**: si la tabla **tenía** filas y queda vacía, se escribe en consola
   el estado completo (`historialCalidad`, locales, grano, filtros) **y el stack
   de quién la vacío**. Es la única forma de agarrar esto si pasa en el celular
   de un operario y no en la máquina de desarrollo.

3. **Mensaje honesto**: cuando el historial no se puede traer, la tabla ya no
   dice "No hay controles registrados" —que es mentira y puede hacer que alguien
   recargue algo que ya existía— sino el motivo real, en rojo.

### Cómo cerrarlo

Cuando vuelva a pasar, buscar en la consola la línea que empieza con
`[calidad] La tabla TENÍA datos y quedó vacía` y leer el stack: dice exactamente
qué función la vació.

**Pregunta abierta que acorta la búsqueda:** ¿el historial de Control de Carga
también se vacía, o solo Calidad? Separa "falla el backend" de "falla solo
calidad".

---
## Lo que revisé y está BIEN

Para que quede claro qué no hace falta tocar:

- **Sin colisiones de nombres.** 351 nombres globales entre los 6 archivos JS y
  **ninguno se pisa**. El problema que tuvieron en el backend con
  `Sin titulo 4.gs` no existe en el frontend.
- **Ningún `getElementById('x').algo` apunta al vacío**, en los 6 archivos.
- **Sin duplicados en los datos**: 0 `Id_Carga` repetidos, 0 productos o
  contratos repetidos dentro de una carga. El `LockService` funcionó.
- **Las fechas están todas bien** (251 de 251 en formato `aaaa-mm-dd`).
- **La migración de Cartas de Porte está completa**: 365 de 385 ya son links
  estables y **ninguna necesita resolverse contra Drive**, que era lo que hacía
  lento al `doGet`.
- **Las fotos guardadas están íntegras**: las 33 decodifican y cierran bien.
- **El merge de pendientes con el historial está bien hecho**
  (`filtrarYRenderizarTabla` deduplica por `Id_Carga`).
- **`produccion.js` no tiene el bug de la cola** (usa `getAll` + `forEach`).
- **La Ticketera y Calidad escapan el HTML** correctamente.
- **Sin timers colgados** (`setInterval`) en ningún módulo.

---

## Por dónde empezaría

**Esta semana**, en este orden:

1. **Sacar la contraseña del comentario y cambiarla** (10 minutos, hallazgo 2).
2. **Token en el backend** (1-2 horas, hallazgo 1). Aunque sea parcial, hoy
   cualquiera puede borrar todo.
3. **Registrar el Service Worker y bajar jsPDF al repo** (2 horas, hallazgo 3).
   Es lo que más afecta al operario en el silo.
4. **Que la cola offline no se trabe** (1 hora, hallazgo 4). Es pérdida de datos.

**Después:**

5. Sacar el `dataString` del HTML + debounce (hallazgo 5) — la app vuela.
6. Fotos de Carga a Drive (hallazgo 6) — antes de que el arranque sea inusable.
7. Catálogos compartidos (hallazgo 8) — corta el problema de datos de raíz.
8. `Orden` por nombre de columna (hallazgo 9) — evita una falla futura fea.
