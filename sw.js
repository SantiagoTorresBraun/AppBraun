// ============================================================================
//  SERVICE WORKER - App Braun
// ----------------------------------------------------------------------------
//  Que hace: guarda una copia de la app (HTML, CSS, JS, logos y las librerias
//  de vendor/) adentro del navegador, para que la app abra aunque el celular
//  no tenga senal. Es lo que arregla el Hallazgo 3 de la auditoria.
//
//  Dos estrategias, segun el tipo de archivo:
//
//   - Archivos que NO cambian nunca (vendor/, imagenes, fuentes)
//     -> CACHE PRIMERO. Ni se molesta en pedirlos por red. Instantaneo.
//
//   - Archivos de la app que SI cambian en cada deploy (index.html, *.js, .css)
//     -> RED PRIMERO, con 3,5 segundos de paciencia. Si hay internet trae lo
//        ultimo (asi un deploy se ve al recargar, sin tener que tocar nada
//        aca). Si la red no contesta en 3,5 s o directamente falla, sirve la
//        copia guardada. Esto es a proposito: en un silo la senal no suele
//        estar "cortada", esta *lenta*, y esperar 30 s a que el navegador se
//        rinda es lo mismo que estar sin internet.
//
//  Lo que NUNCA toca:
//   - Los POST (guardar una carga, mandar un correo) pasan derecho a la red.
//   - Todo lo que sea de otro dominio (el backend de Apps Script, las fotos de
//     Drive, el login de Google) pasa derecho a la red. Cachear eso romperia
//     los datos y la sesion.
//
//  MANTENIMIENTO: si agregas o borras un archivo de RECURSOS, subile el numero
//  a VERSION. Eso tira la cache vieja y fuerza a bajar todo de nuevo.
// ============================================================================

const VERSION = 'v6';
const CACHE = 'braun-' + VERSION;

// Cuanto esperamos a la red antes de servir la copia guardada.
const TIEMPO_ESPERA_RED = 3500;

// Todo lo que la app necesita para arrancar sin internet.
// Las rutas son relativas al sw.js a proposito: la app vive en
// santiagotorresbraun.github.io/AppBraun/ (un subdirectorio, no la raiz).
const RECURSOS = [
    './',
    './index.html',
    './style.css',
    './manifest.json',

    './offline.js',
    './render-historial.js',
    './historial-local.js',
    './cola-sync.js',
    './auth.js',
    './app.js',
    './correo.js',
    './calidad.js',
    './produccion.js',
    './agente.js',

    './logo-braun.png',
    './logo-senasa.png',
    './fondo-login.jpg',

    './vendor/jspdf.umd.min.js',
    './vendor/fontawesome/css/all.min.css',
    './vendor/fontawesome/webfonts/fa-solid-900.woff2',
    './vendor/fontawesome/webfonts/fa-brands-400.woff2',
    './vendor/fontawesome/webfonts/fa-regular-400.woff2',
    './vendor/fontawesome/webfonts/fa-v4compatibility.woff2'
];

// ---------------------------------------------------------------------------
// INSTALACION: bajar y guardar todo
// ---------------------------------------------------------------------------
// OJO: aca NO se usa cache.addAll(). addAll es todo-o-nada: si UN archivo de la
// lista da 404, tira todo abajo y el Service Worker no se instala nunca, en
// silencio. Se guarda uno por uno para que un archivo que falta no deje a la
// app entera sin modo offline.
self.addEventListener('install', evento => {
    evento.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        const fallaron = [];

        await Promise.all(RECURSOS.map(async ruta => {
            try {
                // cache:'reload' evita guardar una version vieja que el
                // navegador ya tuviera dando vueltas en su cache HTTP.
                const resp = await fetch(new Request(ruta, { cache: 'reload' }));
                if (!resp || !resp.ok) throw new Error('HTTP ' + (resp && resp.status));
                await cache.put(ruta, resp);
            } catch (e) {
                fallaron.push(ruta + ' (' + e.message + ')');
            }
        }));

        if (fallaron.length) {
            console.warn('[SW] No se pudieron guardar ' + fallaron.length + ' archivo(s):', fallaron);
        } else {
            console.log('[SW] ' + RECURSOS.length + ' archivos guardados. La app abre sin senal.');
        }

        // Que la version nueva tome el control sin esperar a que se cierren
        // todas las pestanas.
        await self.skipWaiting();
    })());
});

// ---------------------------------------------------------------------------
// ACTIVACION: borrar las caches de versiones anteriores
// ---------------------------------------------------------------------------
self.addEventListener('activate', evento => {
    evento.waitUntil((async () => {
        const nombres = await caches.keys();
        await Promise.all(
            nombres
                .filter(n => n.indexOf('braun-') === 0 && n !== CACHE)
                .map(n => caches.delete(n))
        );
        await self.clients.claim();
        console.log('[SW] Activo (' + CACHE + ')');
    })());
});

// ---------------------------------------------------------------------------
// FETCH: cada pedido que hace la app pasa por aca
// ---------------------------------------------------------------------------
self.addEventListener('fetch', evento => {
    const pedido = evento.request;

    // Guardar una carga, mandar un correo, consultarle al agente: todo eso es
    // POST y tiene que ir a la red si o si. Nunca se cachea.
    if (pedido.method !== 'GET') return;

    let url;
    try { url = new URL(pedido.url); } catch (e) { return; }

    // Backend de Apps Script, fotos de Drive, login de Google, la API de Groq:
    // otro dominio, pasa derecho. Cachear esto romperia datos y sesiones.
    if (url.origin !== self.location.origin) return;

    // Pedidos parciales de video/audio: mejor no meterse.
    if (pedido.headers.has('range')) return;

    if (esInmutable(url.pathname)) {
        evento.respondWith(cachePrimero(pedido, evento));
    } else {
        evento.respondWith(redPrimero(pedido, evento));
    }
});

// Archivos que no cambian: librerias de vendor/, imagenes y fuentes.
function esInmutable(ruta) {
    if (ruta.indexOf('/vendor/') !== -1) return true;
    return /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(ruta);
}

// Guarda en la cache SIN que el navegador pueda matar al worker a mitad de
// camino. Sin el waitUntil, la escritura es "la mando y me olvido": el worker
// se puede apagar apenas responde y la copia nunca queda guardada.
function guardarEnCache(evento, pedido, resp) {
    const tarea = caches.open(CACHE)
        .then(cache => cache.put(pedido, resp))
        .catch(() => { });
    try { evento.waitUntil(tarea); } catch (e) { /* el evento ya se cerro */ }
    return tarea;
}

// ---------------------------------------------------------------------------
// Estrategia 1: CACHE PRIMERO
// ---------------------------------------------------------------------------
async function cachePrimero(pedido, evento) {
    const guardado = await caches.match(pedido, { ignoreSearch: true });
    if (guardado) return guardado;

    try {
        const resp = await fetch(pedido);
        if (resp && resp.ok) guardarEnCache(evento, pedido, resp.clone());
        return resp;
    } catch (e) {
        return respuestaSinRed(pedido);
    }
}

// ---------------------------------------------------------------------------
// Estrategia 2: RED PRIMERO, con limite de paciencia
// ---------------------------------------------------------------------------
async function redPrimero(pedido, evento) {
    return new Promise(resolve => {
        let yaRespondimos = false;
        const responder = r => {
            if (!yaRespondimos) { yaRespondimos = true; resolve(r); }
        };

        // Plan B: si la red tarda mas de TIEMPO_ESPERA_RED y tenemos copia,
        // se sirve la copia. La red sigue corriendo por atras y, cuando
        // llegue, igual actualiza la cache para la proxima vez.
        const reloj = setTimeout(async () => {
            const guardado = await caches.match(pedido, { ignoreSearch: true });
            if (guardado) responder(guardado);
        }, TIEMPO_ESPERA_RED);

        fetch(pedido).then(async resp => {
            clearTimeout(reloj);
            if (resp && resp.ok && resp.type === 'basic') {
                await guardarEnCache(evento, pedido, resp.clone());
            }
            responder(await sinRedireccion(resp, pedido));
        }).catch(async () => {
            clearTimeout(reloj);
            const guardado = await caches.match(pedido, { ignoreSearch: true });
            responder(guardado || await respuestaSinRed(pedido));
        });
    });
}

// Una respuesta redirigida no se le puede devolver a una navegacion: el
// navegador la rechaza con un error raro. Se la vuelve a armar sin la marca.
async function sinRedireccion(resp, pedido) {
    if (!resp || !resp.redirected || pedido.mode !== 'navigate') return resp;
    const cuerpo = await resp.blob();
    return new Response(cuerpo, {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers
    });
}

// ---------------------------------------------------------------------------
// Ultimo recurso: no hay red y tampoco hay copia guardada
// ---------------------------------------------------------------------------
async function respuestaSinRed(pedido) {
    // Si lo que se pidio es una pagina, se devuelve la app igual. Asi el
    // operario ve la app y no la pantalla de dinosaurio del navegador.
    if (pedido.mode === 'navigate') {
        const app = await caches.match('./index.html', { ignoreSearch: true });
        if (app) return app;
    }
    return new Response('Sin conexion y sin copia guardada de este recurso.', {
        status: 503,
        statusText: 'Sin conexion',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// ---------------------------------------------------------------------------
// Mensajes desde la app (offline.js)
// ---------------------------------------------------------------------------
self.addEventListener('message', evento => {
    const dato = evento.data || {};

    if (dato.tipo === 'ACTUALIZAR_YA') {
        self.skipWaiting();
    }

    if (dato.tipo === 'VERSION') {
        evento.source && evento.source.postMessage({ tipo: 'VERSION', version: CACHE });
    }

    // Valvula de escape para soporte: borra todo y vuelve a bajar.
    if (dato.tipo === 'BORRAR_CACHE') {
        evento.waitUntil((async () => {
            const nombres = await caches.keys();
            await Promise.all(nombres.map(n => caches.delete(n)));
            evento.source && evento.source.postMessage({ tipo: 'CACHE_BORRADA' });
        })());
    }
});
