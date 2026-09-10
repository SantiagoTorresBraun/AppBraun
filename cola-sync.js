// ============================================================================
//  cola-sync.js — el motor que vacía las colas offline sin trabarse
// ----------------------------------------------------------------------------
//  Hallazgo 4 de la auditoría. Los tres módulos con cola (Carga, Calidad y
//  Ticketera) tenían el mismo bug, escrito tres veces:
//
//      store.openCursor().onsuccess = function (e) {
//          const cursor = e.target.result;
//          if (cursor) {
//              enviarAlBackend(item)
//              .then(()  => { borrar; VOLVER A LLAMARSE; })   // sigue
//              .catch(() => { /* ...y acá NO sigue */ });     // SE FRENA
//          }
//      };
//
//  La recursión vivía solo en el .then(). Si un registro fallaba, la cola se
//  frenaba ahí y NUNCA MÁS avanzaba: como openCursor() arranca siempre desde el
//  principio, el registro fallado quedaba adelante bloqueando a todos los que
//  venían atrás. Sin ningún aviso. Un operario podía cargar diez controles
//  arriba de uno roto y perderlos todos.
//
//  Acá se procesa la cola de a uno, en orden, y un fallo NO frena al resto.
//
//  LOS DOS TIPOS DE ERROR (esto es lo importante del diseño)
//  ---------------------------------------------------------
//  No todos los fallos son iguales, y tratarlos igual haría daño:
//
//   1. El backend contestó y dijo QUE NO (datos inválidos, Drive rechazó la
//      foto). Es culpa del registro: reintentar no lo va a arreglar solo.
//      Suma un intento, y a los 3 se marca como fallido para revisión manual.
//
//   2. No hubo respuesta (sin señal, timeout, CORS). NO es culpa del registro.
//      NO suma intentos y se reintenta siempre.
//
//  Si los errores de red contaran, un día entero en un silo quemaría los 3
//  intentos de TODO lo pendiente y el operario se encontraría con veinte
//  registros marcados como "fallidos" que en realidad estaban perfectos. La
//  falta de señal es justo lo que la cola tiene que tolerar, no lo que la
//  tiene que romper.
//
//  Reintentar es seguro: el backend es idempotente. Antes de escribir chequea
//  si ya existe una fila con ese Id_Carga / Id_Calidad, y lo hace adentro de un
//  LockService para que dos POST simultáneos no inserten los dos.
//
//  Producción NO usa este archivo: sincronizarMuestreosPendientes() ya recorre
//  con getAll() + forEach, así que cada muestreo va por su cuenta y un fallo
//  nunca frenó a los demás. Ese módulo no tenía el bug.
// ============================================================================

// Cuántas veces se reintenta un registro que el BACKEND rechazó.
const COLA_MAX_INTENTOS = 3;

// Cuánto se espera antes de cada reintento, en minutos.
const COLA_ESPERAS_MIN = [1, 5, 15];

// Espera cuando el problema fue de red. No suma intentos.
const COLA_ESPERA_RED_MIN = 2;

// Cada tanto se reintenta solo: si no, un registro en espera se quedaría
// esperando hasta que algo más dispare una sincronización.
const COLA_LATIDO_MS = 60000;

// Campos que usa este archivo para llevar la cuenta. NUNCA viajan al backend.
const COLA_CAMPOS_INTERNOS = [
    '_intentos', '_ultimoError', '_ultimoIntento', '_proximoIntento',
    '_fallido', '_errorDeDatos'
];

// Las tres colas. Producción queda afuera a propósito (ver el encabezado).
const COLAS = [
    {
        store: 'controles_carga',
        etiqueta: 'Control de Carga',
        accion: null,              // el backend asume "guardar" si no viene _accion
        quitarId: false,           // la carga siempre viajó con su id local
        idVisible: item => item.Id_Carga || '(sin id)',
        fecha: item => item.Fecha || '',
        despues: function () { if (typeof renderOfflineCount === 'function') renderOfflineCount(); }
    },
    {
        store: 'controles_calidad',
        etiqueta: 'Control de Calidad',
        accion: 'guardar_calidad',
        quitarId: true,            // el id de IndexedDB no va al Sheet
        idVisible: item => item['Id_Calidad'] || '(sin id)',
        fecha: item => item['Fecha Analisis'] || '',
        despues: function () { if (typeof filtrarYRenderizarCalidad === 'function') filtrarYRenderizarCalidad(); }
    },
    {
        store: 'ticketera_tickets',
        etiqueta: 'Ticketera',
        accion: 'crear_ticket',
        quitarId: true,
        idVisible: item => item.id_ticket || '(sin id)',
        fecha: item => item.fecha_creacion || item.fecha || '',
        despues: function () {
            if (typeof cargarTicketsDesdeGoogle === 'function') setTimeout(cargarTicketsDesdeGoogle, 2500);
        }
    }
];

function colaPorStore(store) {
    for (let i = 0; i < COLAS.length; i++) if (COLAS[i].store === store) return COLAS[i];
    return null;
}

// ---------------------------------------------------------------------------
// IndexedDB, envuelto en promesas
// ---------------------------------------------------------------------------
// Cada operación abre su propia transacción y la cierra enseguida. Una
// transacción de IndexedDB muere sola si se la deja abierta esperando un
// fetch, así que nunca hay una abierta mientras se habla con el backend.
function colaLeerTodo(store) {
    return new Promise(function (resolve) {
        try {
            if (!db || !db.objectStoreNames.contains(store)) { resolve([]); return; }
            const pedido = db.transaction([store], 'readonly').objectStore(store).getAll();
            pedido.onsuccess = function () { resolve(pedido.result || []); };
            pedido.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
    });
}

function colaGuardar(store, item) {
    return new Promise(function (resolve) {
        try {
            const pedido = db.transaction([store], 'readwrite').objectStore(store).put(item);
            pedido.onsuccess = function () { resolve(true); };
            pedido.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
    });
}

function colaBorrar(store, idLocal) {
    return new Promise(function (resolve) {
        try {
            const pedido = db.transaction([store], 'readwrite').objectStore(store).delete(idLocal);
            pedido.onsuccess = function () { resolve(true); };
            pedido.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
    });
}

// ---------------------------------------------------------------------------
// El procesamiento
// ---------------------------------------------------------------------------
// Una cola por vez: si dos cosas disparan la sincronización a la vez (volvió la
// señal + el botón de refrescar), la segunda se va y deja trabajar a la primera.
const colaEnCurso = {};

function colaPayload(cfg, item) {
    const payload = Object.assign({}, item);
    COLA_CAMPOS_INTERNOS.forEach(function (campo) { delete payload[campo]; });
    if (cfg.quitarId) delete payload.id;
    if (cfg.accion) payload._accion = cfg.accion;
    return payload;
}

async function sincronizarCola(cfg) {
    if (!cfg) return;                     // colaPorStore() no encontro esa cola
    if (!db || !navigator.onLine) return;
    if (typeof WEB_APP_URL === 'undefined' || WEB_APP_URL.indexOf('AQUÍ_VA') !== -1) return;
    if (colaEnCurso[cfg.store]) return;

    colaEnCurso[cfg.store] = true;
    let huboCambios = false;

    try {
        const todos = await colaLeerTodo(cfg.store);
        const ahora = Date.now();

        // Se saltean los que ya se dieron por fallidos (esperan revisión manual)
        // y los que están cumpliendo su espera de reintento.
        const aEnviar = todos.filter(function (item) {
            if (item._fallido) return false;
            if (item._proximoIntento && item._proximoIntento > ahora) return false;
            return true;
        });

        for (let i = 0; i < aEnviar.length; i++) {
            if (!navigator.onLine) break;          // se cortó la señal a mitad
            const ok = await colaEnviarUno(cfg, aEnviar[i]);
            huboCambios = true;
            if (ok && cfg.store === 'controles_carga' && typeof renderOfflineCount === 'function') {
                renderOfflineCount();
            }
        }
    } catch (e) {
        console.error('[cola] Error inesperado procesando ' + cfg.etiqueta + ':', e);
    } finally {
        colaEnCurso[cfg.store] = false;
    }

    actualizarAvisoCola();
    if (huboCambios && cfg.despues) { try { cfg.despues(); } catch (e) { } }
}

// Manda UN registro. Devuelve true si se fue y salió de la cola.
// Pase lo que pase, no propaga: el que llama tiene que poder seguir con el
// siguiente. Ese es todo el punto del arreglo.
async function colaEnviarUno(cfg, item) {
    const idLocal = item.id;
    try {
        await enviarAlBackend(colaPayload(cfg, item));
        await colaBorrar(cfg.store, idLocal);
        return true;
    } catch (err) {
        await colaAnotarFallo(cfg, item, err);
        return false;
    }
}

async function colaAnotarFallo(cfg, item, err) {
    // ¿El backend contestó que no, o directamente no hubo respuesta?
    const culpaDelDato = !!(err && err.rechazadoPorBackend);

    const registro = Object.assign({}, item);
    registro._ultimoError = (err && err.message) ? String(err.message) : 'No se pudo contactar al servidor';
    registro._ultimoIntento = new Date().toISOString();
    registro._errorDeDatos = culpaDelDato;

    if (culpaDelDato) {
        registro._intentos = (registro._intentos || 0) + 1;
        if (registro._intentos >= COLA_MAX_INTENTOS) {
            // Se acabaron los intentos: pasa a revisión manual. NO se borra:
            // los datos del operario no se tiran nunca sin que él lo decida.
            registro._fallido = true;
            registro._proximoIntento = 0;
            console.warn('[cola] ' + cfg.etiqueta + ' ' + cfg.idVisible(item) +
                ' quedó para revisión manual tras ' + registro._intentos + ' intentos: ' + registro._ultimoError);
        } else {
            const espera = COLA_ESPERAS_MIN[registro._intentos - 1] || 15;
            registro._proximoIntento = Date.now() + espera * 60000;
        }
    } else {
        // Sin señal: no es culpa del registro, no gasta intentos.
        registro._proximoIntento = Date.now() + COLA_ESPERA_RED_MIN * 60000;
    }

    await colaGuardar(cfg.store, registro);
}

// Vacía las tres colas.
function sincronizarTodasLasColas() {
    COLAS.forEach(function (cfg) { sincronizarCola(cfg); });
}

// ---------------------------------------------------------------------------
// Latido: reintenta solo cada minuto
// ---------------------------------------------------------------------------
// Sin esto, un registro que quedó esperando 5 minutos se quedaría esperando
// para siempre, porque nada volvería a disparar la sincronización.
let colaLatido = null;
function arrancarLatidoCola() {
    if (colaLatido) return;
    colaLatido = setInterval(function () {
        if (navigator.onLine) sincronizarTodasLasColas();
    }, COLA_LATIDO_MS);
}

// ---------------------------------------------------------------------------
// Contar lo que hay
// ---------------------------------------------------------------------------
async function colaResumen() {
    const resumen = { esperando: 0, fallidos: 0, porCola: [] };
    for (let i = 0; i < COLAS.length; i++) {
        const cfg = COLAS[i];
        const todos = await colaLeerTodo(cfg.store);
        const fallidos = todos.filter(function (r) { return r._fallido; });
        resumen.esperando += todos.length - fallidos.length;
        resumen.fallidos += fallidos.length;
        resumen.porCola.push({ cfg: cfg, total: todos.length, fallidos: fallidos });
    }
    return resumen;
}

// ---------------------------------------------------------------------------
// El aviso en pantalla
// ---------------------------------------------------------------------------
// Va fijo abajo y se ve desde cualquier pantalla. El panel que ya existía
// (#offline-records) está enterrado al fondo del formulario de Control de
// Carga: el operario solo lo ve si baja hasta el final, así que no sirve para
// avisar de algo que necesita su atención.
// Se guarda la referencia al <span> del texto en vez de volver a buscarlo por
// id: acabamos de crearlo, buscarlo de nuevo es frágil y si fallara el catch
// de abajo se lo tragaría y la barra quedaría sin texto.
let avisoColaTexto = null;

async function actualizarAvisoCola() {
    try {
        const resumen = await colaResumen();
        let barra = document.getElementById('aviso-cola-fallida');

        if (!resumen.fallidos) {
            if (barra) barra.remove();
            avisoColaTexto = null;
            return;
        }

        // Si perdimos la referencia, se rehace la barra entera.
        if (barra && !avisoColaTexto) { barra.remove(); barra = null; }

        if (!barra) {
            barra = document.createElement('div');
            barra.id = 'aviso-cola-fallida';
            barra.className = 'aviso-cola-fallida';
            barra.setAttribute('role', 'alert');

            const icono = document.createElement('i');
            icono.className = 'fas fa-triangle-exclamation';
            icono.setAttribute('aria-hidden', 'true');

            const texto = document.createElement('span');
            texto.id = 'aviso-cola-texto';

            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'aviso-cola-btn';
            boton.textContent = 'Revisar';
            boton.onclick = abrirRevisionCola;

            barra.appendChild(icono);
            barra.appendChild(texto);
            barra.appendChild(boton);
            document.body.appendChild(barra);
            avisoColaTexto = texto;
        }

        avisoColaTexto.textContent = resumen.fallidos === 1
            ? '1 registro no se pudo enviar y necesita que lo revises.'
            : resumen.fallidos + ' registros no se pudieron enviar y necesitan que los revises.';
    } catch (e) {
        // Un aviso que falla no puede tumbar la app, pero tampoco puede
        // desaparecer sin dejar rastro: ya nos pasó con la cola.
        console.warn('[cola] No se pudo mostrar el aviso de registros trabados:', e);
    }
}

// ---------------------------------------------------------------------------
// La pantalla de revisión
// ---------------------------------------------------------------------------
// Ojo: todo lo que viene del registro se pone con textContent, nunca con
// innerHTML. Son datos que tipeó una persona y podrían traer < o >.
async function abrirRevisionCola() {
    const resumen = await colaResumen();

    let fondo = document.getElementById('modal-cola-fallida');
    if (fondo) fondo.remove();

    fondo = document.createElement('div');
    fondo.id = 'modal-cola-fallida';
    fondo.className = 'modal-cola-fondo';
    fondo.onclick = function (ev) { if (ev.target === fondo) fondo.remove(); };

    const caja = document.createElement('div');
    caja.className = 'modal-cola-caja';

    const titulo = document.createElement('h3');
    titulo.textContent = 'Registros que no se pudieron enviar';
    caja.appendChild(titulo);

    const ayuda = document.createElement('p');
    ayuda.className = 'modal-cola-ayuda';
    ayuda.textContent = 'Estos quedaron guardados en este celular. El servidor los rechazó ' +
        COLA_MAX_INTENTOS + ' veces, así que dejaron de reintentarse solos. ' +
        'Los demás registros siguieron sincronizándose normalmente.';
    caja.appendChild(ayuda);

    let hubo = false;
    resumen.porCola.forEach(function (grupo) {
        grupo.fallidos.forEach(function (item) {
            hubo = true;
            caja.appendChild(filaRevisionCola(grupo.cfg, item, fondo));
        });
    });

    if (!hubo) {
        const nada = document.createElement('p');
        nada.textContent = 'No quedó ningún registro con problemas.';
        caja.appendChild(nada);
    }

    const pie = document.createElement('div');
    pie.className = 'modal-cola-pie';

    if (hubo) {
        const todos = document.createElement('button');
        todos.type = 'button';
        todos.className = 'modal-cola-reintentar';
        todos.textContent = 'Reintentar todos';
        todos.onclick = async function () {
            todos.disabled = true;
            todos.textContent = 'Reintentando...';
            await reintentarTodosLosFallidos();
            fondo.remove();
        };
        pie.appendChild(todos);
    }

    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'modal-cola-cerrar';
    cerrar.textContent = 'Cerrar';
    cerrar.onclick = function () { fondo.remove(); };
    pie.appendChild(cerrar);

    caja.appendChild(pie);
    fondo.appendChild(caja);
    document.body.appendChild(fondo);
}

function filaRevisionCola(cfg, item, fondo) {
    const fila = document.createElement('div');
    fila.className = 'modal-cola-item';

    const cabecera = document.createElement('div');
    cabecera.className = 'modal-cola-item-cab';

    const nombre = document.createElement('strong');
    nombre.textContent = cfg.etiqueta + ' · ' + cfg.idVisible(item);
    cabecera.appendChild(nombre);

    const fecha = cfg.fecha(item);
    if (fecha) {
        const cuando = document.createElement('span');
        cuando.className = 'modal-cola-fecha';
        cuando.textContent = String(fecha);
        cabecera.appendChild(cuando);
    }
    fila.appendChild(cabecera);

    const motivo = document.createElement('p');
    motivo.className = 'modal-cola-motivo';
    motivo.textContent = 'Motivo: ' + (item._ultimoError || 'desconocido');
    fila.appendChild(motivo);

    const acciones = document.createElement('div');
    acciones.className = 'modal-cola-acciones';

    const reintentar = document.createElement('button');
    reintentar.type = 'button';
    reintentar.className = 'modal-cola-reintentar';
    reintentar.textContent = 'Reintentar';
    reintentar.onclick = async function () {
        reintentar.disabled = true;
        reintentar.textContent = 'Enviando...';
        await reintentarDeCola(cfg.store, item.id);
        fondo.remove();
        abrirRevisionCola();
    };
    acciones.appendChild(reintentar);

    const descartar = document.createElement('button');
    descartar.type = 'button';
    descartar.className = 'modal-cola-descartar';
    descartar.textContent = 'Descartar';
    descartar.onclick = async function () {
        // Esto borra datos que el operario cargó y que NUNCA llegaron al
        // servidor. No hay vuelta atrás, así que se pregunta con todas las letras.
        const seguro = confirm(
            'Vas a BORRAR este registro de este celular.\n\n' +
            cfg.etiqueta + ' · ' + cfg.idVisible(item) + '\n\n' +
            'Nunca llegó al servidor, así que se pierde para siempre. ' +
            'Esto no se puede deshacer.\n\n¿Seguro?'
        );
        if (!seguro) return;
        await colaBorrar(cfg.store, item.id);
        if (typeof renderOfflineCount === 'function') renderOfflineCount();
        fondo.remove();
        abrirRevisionCola();
        actualizarAvisoCola();
    };
    acciones.appendChild(descartar);

    fila.appendChild(acciones);
    return fila;
}

// Le devuelve los intentos a un registro y lo manda de nuevo.
async function reintentarDeCola(store, idLocal) {
    const cfg = colaPorStore(store);
    if (!cfg) return;
    const todos = await colaLeerTodo(store);
    const item = todos.filter(function (r) { return r.id === idLocal; })[0];
    if (!item) return;

    delete item._fallido;
    delete item._intentos;
    delete item._proximoIntento;
    await colaGuardar(store, item);
    await sincronizarCola(cfg);
}

async function reintentarTodosLosFallidos() {
    const resumen = await colaResumen();
    for (let i = 0; i < resumen.porCola.length; i++) {
        const grupo = resumen.porCola[i];
        for (let k = 0; k < grupo.fallidos.length; k++) {
            const item = grupo.fallidos[k];
            delete item._fallido;
            delete item._intentos;
            delete item._proximoIntento;
            await colaGuardar(grupo.cfg.store, item);
        }
    }
    for (let i = 0; i < COLAS.length; i++) await sincronizarCola(COLAS[i]);
}

window.colaPorStore = colaPorStore;
window.sincronizarCola = sincronizarCola;
window.sincronizarTodasLasColas = sincronizarTodasLasColas;
window.actualizarAvisoCola = actualizarAvisoCola;
window.abrirRevisionCola = abrirRevisionCola;
window.reintentarDeCola = reintentarDeCola;
window.reintentarTodosLosFallidos = reintentarTodosLosFallidos;
window.colaResumen = colaResumen;
window.arrancarLatidoCola = arrancarLatidoCola;
