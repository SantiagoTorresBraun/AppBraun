# Auditoría del proyecto — 28/08/2026

Revisión completa de App Braun buscando bugs, riesgos y problemas de estructura.

**Todo lo que hay acá está verificado**, no supuesto: cada hallazgo dice cómo se
comprobó. Donde una sospecha no se confirmó, también está anotado.

Ordenado por urgencia. Los cinco primeros son los que atacaría esta semana.

| # | Hallazgo | Gravedad |
|---|---|---|
| 1 | Cualquiera en internet puede leer y borrar todos los datos | 🔴 Crítico |
| 2 | La contraseña está publicada en GitHub, en texto plano | 🔴 Crítico |
| 3 | La app no abre sin internet (el Service Worker nunca se registra) | 🔴 Alto |
| 4 | Un registro que falla bloquea toda la cola offline, para siempre | 🔴 Alto |
| 5 | El historial arma 27 MB de HTML y se rehace en cada tecla | 🟠 Alto |
| 6 | Las fotos van dentro del Sheet: el arranque crece sin techo | 🟠 Alto |
| 7 | `responder_ticket` puede mandar el correo dos veces | 🟠 Medio |
| 8 | Los catálogos son por dispositivo, no compartidos | 🟠 Medio |
| 9 | La hoja `Orden` se lee y escribe por POSICIÓN de columna | 🟠 Medio |
| 10 | El historial de Carga inserta datos del Sheet sin escapar (XSS) | 🟡 Medio |
| 11 | `Kg_Cargados` se escribe a mano y nada lo controla | 🟡 Bajo |
| 12 | Varios menores | 🟡 Bajo |

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

## 3. 🔴 La app no abre sin internet

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

---

## 4. 🔴 Un registro que falla bloquea toda la cola offline

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

## 5. 🟠 El historial arma 27 MB de HTML y se rehace en cada tecla

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

## 6. 🟠 Las fotos van dentro del Sheet: el arranque crece sin techo

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
