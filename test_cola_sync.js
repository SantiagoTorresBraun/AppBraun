// ============================================================================
//  PRUEBAS DE LA COLA OFFLINE  (cola-sync.js + enviarAlBackend de app.js)
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_cola_sync.js     (desde esta carpeta)
//
//  Por que existe: el 27/10/2026 un control de Cosecha cargado en campo con
//  señal entrecortada tardó en llegar. Revisando se encontró que la cola
//  BORRABA del celular lo que el servidor no había confirmado (respuesta
//  ilegible o página de error de Google). Acá se carga el cola-sync.js REAL y
//  el enviarAlBackend REAL con un IndexedDB y un servidor falsos, y se recorre
//  cada situación de campo: que nada se borre sin confirmación.
//
//  NO toca el Sheet de verdad ni la red: todo pasa en memoria.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = __dirname;

// --- IndexedDB falso (solo lo que usa cola-sync.js) -----------------------
function crearDb() {
  const stores = {};
  const pedido = (fn) => {
    const req = {};
    setTimeout(() => { try { req.result = fn(); req.onsuccess && req.onsuccess(); } catch (e) { req.onerror && req.onerror(e); } }, 0);
    return req;
  };
  return {
    stores,
    objectStoreNames: { contains: n => !!stores[n] },
    transaction: () => ({
      objectStore: n => ({
        getAll: () => pedido(() => Object.values(stores[n]).map(x => JSON.parse(JSON.stringify(x)))),
        put: item => pedido(() => { stores[n][item.id] = JSON.parse(JSON.stringify(item)); }),
        delete: id => pedido(() => { delete stores[n][id]; })
      })
    })
  };
}

// --- Servidor falso -------------------------------------------------------
// modo: 'ok' | 'yaExistia' | 'html' | 'cors' | 'red' | 'rechaza'
let modo = 'ok';
let enviados = [];
function fetchFalso(url, opts) {
  const cuerpo = JSON.parse(opts.body);
  const noCors = opts.mode === 'no-cors';
  enviados.push({ accion: cuerpo._accion, noCors, cuerpo });
  if (modo === 'red') return Promise.reject(new TypeError('Load failed'));
  if (noCors) return Promise.resolve({ type: 'opaque' });
  if (modo === 'cors') return Promise.reject(new TypeError('CORS'));
  const textos = {
    ok: '{"ok":true}',
    yaExistia: '{"ok":true,"nota":"ya existía"}',
    html: '<!DOCTYPE html><html><title>Error</title>Se excedió el tiempo máximo de ejecución</html>',
    rechaza: '{"status":"error","message":"Drive rechazó la foto"}'
  };
  return Promise.resolve({ text: () => Promise.resolve(textos[modo]) });
}

// --- Contexto con el código real ------------------------------------------
const appJs = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
const ini = appJs.indexOf('function enviarAlBackend(');
const fin = appJs.indexOf('\n}', ini) + 2;
if (ini === -1) throw new Error('No encontré enviarAlBackend en app.js');
const codigoEnviar = appJs.slice(ini, fin);

const confirmadosCalidad = [];
const cargasConfirmadas = [];
let repintadasTabla = 0;
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, setInterval: () => 1, Promise, JSON, Object, Date, Math, Set, String, Array, Error, TypeError,
  navigator: { onLine: true },
  document: { getElementById: () => null, createElement: () => ({ appendChild() {}, setAttribute() {} }), body: { appendChild() {} }, addEventListener() {}, hidden: false },
  fetch: fetchFalso,
  WEB_APP_URL: 'https://script.google.com/macros/s/FALSO/exec',
  calidadConfirmadaPorServidor: item => confirmadosCalidad.push(item),
  cargaConfirmadaPorServidor: item => cargasConfirmadas.push(item),
  filtrarYRenderizarTabla: () => { repintadasTabla++; },
  filtrarYRenderizarCalidad: () => {},
  renderOfflineCount: () => {},
  window: {}
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('var db = null;\n' + codigoEnviar + '\n' +
  fs.readFileSync(path.join(RAIZ, 'cola-sync.js'), 'utf8') +
  '\nthis.colaPayload = colaPayload; this.COLA_CAMPOS_INTERNOS = COLA_CAMPOS_INTERNOS;', ctx);

let lecturas = 0;
ctx.cargarHistorialCalidadDesdeGoogle = () => { lecturas++; };

// --- Funciones reales de calidad.js, sacadas de a una ---------------------
// calidad.js toca el DOM apenas carga, así que no se puede correr entero: se
// extraen por nombre las funciones que importan y se les pasan dobles.
function extraerFuncion(fuente, nombre) {
  const ini = fuente.indexOf('function ' + nombre + '(');
  if (ini === -1) throw new Error('No encontré ' + nombre);
  let i = fuente.indexOf('{', ini), nivel = 0;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}' && --nivel === 0) break;
  }
  return fuente.slice(ini, i + 1);
}
function cargarCalidad() {
  const fuente = fs.readFileSync(path.join(RAIZ, 'calidad.js'), 'utf8');
  let respuesta = [];
  const c = {
    console: ctx.console, setTimeout, Set, Map, Object, Array, String, Date, JSON,
    navigator: { onLine: true }, WEB_APP_URL: 'https://x/exec',
    fetch: () => Promise.resolve({ json: () => Promise.resolve(respuesta) }),
    normalizarRegistroCalidadRemoto: r => Object.assign({}, r),
    guardarHistorialLocal() {}, avisoHistorialGuardado() {}, filtrarYRenderizarCalidad() {},
    colaConfirmarPorServidor: (s, campo, ids) => { c.idsConfirmados = ids; return Promise.resolve(0); },
    restaurarCalidadGuardada() {}
  };
  vm.createContext(c);
  vm.runInContext('let historialCalidad = []; const calidadConfirmadasRecientes = new Map(); const CALIDAD_INTENTOS = 3, CALIDAD_ESPERA_MS = 1;\n' +
    ['clasificarRespuestaCalidad', 'cargarHistorialCalidadDesdeGoogle', 'calidadConfirmadaPorServidor'].map(n => extraerFuncion(fuente, n)).join('\n') +
    '\nObject.defineProperty(this, "historialCalidad", { get: () => historialCalidad, set: v => { historialCalidad = v; } });' +
    '\nthis.recientes = calidadConfirmadasRecientes;', c);
  c.leer = datos => { respuesta = datos; c.cargarHistorialCalidadDesdeGoogle(); return new Promise(r => setTimeout(r, 5)); };
  return c;
}

function cargarFuncionesCarga() {
  let respuesta = [];
  const c = {
    console: ctx.console, setTimeout, Set, Map, Object, Array, String, JSON, Promise,
    navigator: { onLine: true }, WEB_APP_URL: 'https://x/exec',
    fetch: () => Promise.resolve({ json: () => Promise.resolve(respuesta) }),
    guardarHistorialLocal: (k, lista) => { c.copiaGuardada = lista.slice(); },
    avisoHistorialGuardado() {}, filtrarYRenderizarTabla() {}, restaurarHistorialGuardado() {},
    colaConfirmarPorServidor: () => Promise.resolve(0)
  };
  vm.createContext(c);
  vm.runInContext('let historialGeneral = []; const cargasConfirmadasRecientes = new Map();\n' +
    ['cargarHistorialDesdeGoogle', 'cargaConfirmadaPorServidor'].map(n => extraerFuncion(appJs, n)).join('\n') +
    '\nObject.defineProperty(this, "historialGeneral", { get: () => historialGeneral });' +
    '\nthis.recientes = cargasConfirmadasRecientes;', c);
  c.leer = datos => { respuesta = datos; c.cargarHistorialDesdeGoogle(); return new Promise(r => setTimeout(r, 5)); };
  return c;
}

// guardarCalidad REAL de 01_backend_principal.gs con Sheet, Drive y Lock falsos.
function cargarBackendCalidad() {
  const gs = fs.readFileSync(path.join(RAIZ, '01_backend_principal.gs'), 'utf8');
  const hoja = {
    filas: [['Id_Calidad', 'Grano', 'imagen 1']],
    appendRow(f) { this.filas.push(f.slice()); },
    getLastRow() { return this.filas.length; },
    getLastColumn() { return this.filas[0].length; },
    getRange(fila, col, nFilas, nCols) {
      const h = this;
      return { getDisplayValues: () => h.filas.slice(fila - 1, fila - 1 + nFilas).map(r => r.slice(col - 1, col - 1 + nCols).map(String)) };
    }
  };
  const c = {
    hoja, fotosSubidas: 0, flushes: 0, carrera: false, fallaFoto: false,
    lock: { tomado: 0, liberado: 0 },
    COLUMNAS_IMAGEN_CALIDAD: ['imagen 1'], COLUMNAS_PORCENTAJE_CALIDAD: [],
    String, Object, Array, JSON
  };
  c.obtenerHojaCalidad = () => hoja;
  c.asegurarColumnasCalidad = () => {};
  c.aplicarFormatoPorcentajeCalidad = () => {};
  c.respuestaJsonCalidad = obj => ({ contenido: JSON.stringify(obj) });
  c.LockService = { getScriptLock: () => ({ tryLock: () => { c.lock.tomado++; return true; }, releaseLock: () => { c.lock.liberado++; } }) };
  c.SpreadsheetApp = { flush: () => { c.flushes++; } };
  c.guardarFotoCalidadEnDrive = (id, col) => {
    if (c.fallaFoto) throw new Error('Drive rechazó la foto');
    c.fotosSubidas++;
    if (c.carrera) {            // el pedido B entra y termina mientras A sube su foto
      c.carrera = false;
      c.guardarCalidad({ Id_Calidad: id, Grano: 'GARBANZO', [col]: 'data:image/jpeg;base64,BBBB' });
    }
    return 'Control de Calidad_Images/' + id + '.jpg';
  };
  vm.createContext(c);
  vm.runInContext(extraerFuncion(gs, 'buscarFilaPorIdCalidad') + '\n' + extraerFuncion(gs, 'guardarCalidad') +
    '\nthis.guardarCalidad = guardarCalidad;', c);
  return c;
}

// --- Mini runner ----------------------------------------------------------
let fallas = 0, pasadas = 0;
function ok(cond, nombre) {
  if (cond) { pasadas++; console.log('  ✔ ' + nombre); }
  else { fallas++; console.log('  ✘ ' + nombre); }
}
const CAL = 'controles_calidad';
function preparar(items, store) {
  const d = crearDb();
  ['ordenes_carga', 'controles_carga', CAL, 'ticketera_tickets'].forEach(s => d.stores[s] = {});
  items.forEach(it => d.stores[store || CAL][it.id] = it);
  vm.runInContext('db = __db', Object.assign(ctx, { __db: d }));
  enviados = []; confirmadosCalidad.length = 0; lecturas = 0;
  return d;
}
const control = (id, extra) => Object.assign({ id, Id_Calidad: 'CC-' + id, Grano: 'GARBANZO', 'imagen 1': 'data:image/jpeg;base64,AAAA' }, extra || {});
const cola = () => ctx.colaPorStore(CAL);

(async () => {
  console.log('\n1. Servidor confirma');
  let d = preparar([control(1)]); modo = 'ok';
  await ctx.sincronizarCola(cola());
  ok(!d.stores[CAL][1], 'sale de la cola');
  ok(confirmadosCalidad.length === 1 && confirmadosCalidad[0].Id_Calidad === 'CC-1', 'pasa a la lista del servidor (no desaparece de pantalla)');
  ok(lecturas === 1, 'se vuelve a leer el historial del servidor');
  ok(enviados[0].accion === 'guardar_calidad' && enviados[0].cuerpo.id === undefined, 'viaja como guardar_calidad y sin id local');

  console.log('\n2. Servidor contesta HTML (Apps Script caído / timeout)');
  d = preparar([control(2)]); modo = 'html';
  await ctx.sincronizarCola(cola());
  const r2 = d.stores[CAL][2];
  ok(!!r2, 'NO se borra del celular');
  ok(r2 && r2._sinConfirmar === true && r2._enviosSinConfirmar === 1, 'queda marcado sin confirmar');
  ok(r2 && !r2._intentos && !r2._fallido, 'no gasta intentos ni pasa a fallido');
  ok(r2 && r2._proximoIntento - Date.now() > 110000 && r2._proximoIntento - Date.now() <= 120000, 'se reintenta en 2 min');
  ok(confirmadosCalidad.length === 0 && lecturas === 0, 'no se da por confirmado ni se relee');

  console.log('\n3. No se puede leer la respuesta (CORS) → no-cors');
  d = preparar([control(3)]); modo = 'cors';
  await ctx.sincronizarCola(cola());
  ok(enviados.length === 2 && enviados[1].noCors, 'reintenta con no-cors');
  ok(!!d.stores[CAL][3] && d.stores[CAL][3]._sinConfirmar, 'NO se borra: queda sin confirmar');

  console.log('\n4. Sin señal');
  d = preparar([control(4)]); modo = 'red';
  await ctx.sincronizarCola(cola());
  const r4 = d.stores[CAL][4];
  ok(!!r4 && !r4._sinConfirmar && !r4._intentos, 'queda en cola, sin gastar intentos');

  console.log('\n5. Backend rechaza el dato');
  d = preparar([control(5)]); modo = 'rechaza';
  await ctx.sincronizarCola(cola());
  ok(d.stores[CAL][5] && d.stores[CAL][5]._intentos === 1 && d.stores[CAL][5]._errorDeDatos, 'suma un intento (comportamiento de antes)');

  console.log('\n6. Sin confirmar → reenvío → "ya existía"');
  d = preparar([control(6, { _sinConfirmar: true, _enviosSinConfirmar: 1, _proximoIntento: 0 })]); modo = 'yaExistia';
  await ctx.sincronizarCola(cola());
  ok(!d.stores[CAL][6], 'recién ahora sale de la cola');
  ok(!('_sinConfirmar' in enviados[0].cuerpo) && !('_enviosSinConfirmar' in enviados[0].cuerpo), 'los campos internos no viajan al backend');

  console.log('\n7. Espera creciente si nunca confirma');
  d = preparar([control(7)]); modo = 'html';
  const esperas = [];
  for (let i = 0; i < 6; i++) {
    d.stores[CAL][7]._proximoIntento = 0;
    await ctx.sincronizarCola(cola());
    esperas.push(Math.round((d.stores[CAL][7]._proximoIntento - Date.now()) / 60000));
  }
  ok(JSON.stringify(esperas) === '[2,5,15,30,60,60]', 'esperas 2,5,15,30,60,60 min (' + esperas + ')');
  ok(!!d.stores[CAL][7], 'después de 6 envíos sigue en el celular');

  console.log('\n8. Confirmación por lectura del servidor');
  d = preparar([
    control(8, { _sinConfirmar: true }),                                  // está en el servidor → se borra
    control(9, { _sinConfirmar: true }),                                  // NO está → se queda
    control(10),                                                          // pendiente normal → se queda
    control(11, { _sinConfirmar: true, _accion: 'actualizar_calidad' })   // edición → se queda
  ]);
  const borrados = await ctx.colaConfirmarPorServidor(CAL, 'Id_Calidad', new Set(['CC-8', 'CC-10', 'CC-11']));
  ok(borrados === 1 && !d.stores[CAL][8], 'borra solo el sin confirmar que está en el servidor');
  ok(d.stores[CAL][9] && d.stores[CAL][10] && d.stores[CAL][11], 'no toca los demás');

  console.log('\n9. Edición en cola');
  d = preparar([control(12, { _accion: 'actualizar_calidad' }), control(13)]); modo = 'ok';
  await ctx.sincronizarCola(cola());
  const acciones = enviados.map(e => e.cuerpo.Id_Calidad + ':' + e.accion).sort();
  ok(JSON.stringify(acciones) === '["CC-12:actualizar_calidad","CC-13:guardar_calidad"]', 'la edición viaja como actualizar_calidad, el alta como guardar_calidad');

  console.log('\n10. Las otras colas no cambian su acción');
  d = preparar([{ id: 1, id_ticket: 'T1', _accion: 'otra' }], 'ticketera_tickets');
  ok(ctx.colaPayload(ctx.colaPorStore('ticketera_tickets'), d.stores.ticketera_tickets[1])._accion === 'crear_ticket', 'ticket sigue saliendo como crear_ticket');

  console.log('\n11. Carga (controles_carga) con HTML de error tampoco se pierde');
  d = preparar([{ id: 1, Id_Carga: 'BC-1' }], 'controles_carga'); modo = 'html';
  await ctx.sincronizarCola(ctx.colaPorStore('controles_carga'));
  ok(!!d.stores.controles_carga[1] && d.stores.controles_carga[1]._sinConfirmar, 'la carga queda en el celular');

  console.log('\n12. Calidad: el control confirmado no desaparece de la lista');
  const cal = cargarCalidad();
  cal.historialCalidad = [{ Id_Calidad: 'CC-viejo' }];
  cal.calidadConfirmadaPorServidor(control(20, { _sinConfirmar: true, _accion: 'actualizar_calidad', _intentos: 1 }));
  const enLista = cal.historialCalidad.find(r => r.Id_Calidad === 'CC-20');
  ok(!!enLista, 'entra a historialCalidad');
  ok(enLista && !('id' in enLista) && !('_accion' in enLista) && !('_sinConfirmar' in enLista) && !('_intentos' in enLista), 'sin campos internos');
  // Una lectura del servidor que todavía NO lo trae no lo tiene que borrar...
  await cal.leer([{ Id_Calidad: 'CC-viejo' }]);
  ok(cal.historialCalidad.some(r => r.Id_Calidad === 'CC-20'), 'una lectura sin el control no lo hace desaparecer');
  ok(cal.historialCalidad.length === 2, 'y no lo duplica (' + cal.historialCalidad.length + ')');
  // ...y cuando el servidor ya lo trae, gana la versión del servidor y se olvida el local.
  await cal.leer([{ Id_Calidad: 'CC-20', desdeServidor: true }, { Id_Calidad: 'CC-viejo' }]);
  const veces = cal.historialCalidad.filter(r => r.Id_Calidad === 'CC-20');
  ok(veces.length === 1 && veces[0].desdeServidor, 'cuando el servidor lo trae, queda una sola vez y es la del servidor');
  ok(cal.recientes.size === 0, 'se olvida de la copia local');
  ok(cal.idsConfirmados && cal.idsConfirmados.has('CC-20'), 'le pasa los ids del servidor a la cola');

  console.log('\n13. Carga: edición de una carga ya subida');
  d = preparar([{ id: 1, Id_Carga: 'BC-9', _accion: 'actualizar' }, { id: 2, Id_Carga: 'BC-10' }], 'controles_carga'); modo = 'ok';
  cargasConfirmadas.length = 0; repintadasTabla = 0;
  await ctx.sincronizarCola(ctx.colaPorStore('controles_carga'));
  const accCarga = enviados.map(e => e.cuerpo.Id_Carga + ':' + (e.accion || 'guardar')).sort();
  ok(JSON.stringify(accCarga) === '["BC-10:guardar","BC-9:actualizar"]', 'la edición viaja como actualizar, el alta como guardar');
  ok(cargasConfirmadas.length === 2, 'las dos pasan a la lista del servidor');
  ok(repintadasTabla === 1, 'se repinta la tabla (sin bajar el historial entero)');
  d = preparar([{ id: 1, Id_Carga: 'BC-9', _accion: 'actualizar', _sinConfirmar: true }], 'controles_carga');
  await ctx.colaConfirmarPorServidor('controles_carga', 'Id_Carga', new Set(['BC-9']));
  ok(!!d.stores.controles_carga[1], 'una edición sin confirmar NO se borra porque el id exista en el servidor');

  console.log('\n14. Carga: la confirmada no desaparece de la lista');
  const car = cargarFuncionesCarga();
  car.cargaConfirmadaPorServidor({ id: 5, Id_Carga: 'BC-20', _accion: 'actualizar', _sinConfirmar: true });
  ok(car.historialGeneral.length === 1 && !('_accion' in car.historialGeneral[0]) && !('id' in car.historialGeneral[0]), 'entra a historialGeneral sin campos internos');
  await car.leer([{ Id_Carga: 'BC-viejo' }]);
  ok(car.historialGeneral.some(r => r.Id_Carga === 'BC-20') && car.historialGeneral.length === 2, 'una lectura sin la carga no la hace desaparecer');
  await car.leer([{ Id_Carga: 'BC-20', desdeServidor: true }]);
  ok(car.historialGeneral.length === 1 && car.historialGeneral[0].desdeServidor && car.recientes.size === 0, 'cuando el servidor la trae, queda la del servidor');
  ok(car.copiaGuardada && car.copiaGuardada.length === 1, 'la copia offline se guarda con la lista combinada');

  console.log('\n15. Backend guardarCalidad: dos POST del mismo control a la vez');
  const be = cargarBackendCalidad();
  be.carrera = true;   // mientras A sube fotos, B entra completo
  const resA = JSON.parse(be.guardarCalidad({ Id_Calidad: 'CC-77', Grano: 'GARBANZO', 'imagen 1': 'data:image/jpeg;base64,AAAA' }).contenido);
  ok(be.hoja.filas.length === 2, 'queda UNA sola fila (' + (be.hoja.filas.length - 1) + ')');
  ok(resA.ok === true && resA.nota === 'ya existía', 'el que perdió la carrera contesta ok / ya existía');
  ok(be.lock.tomado === 2 && be.lock.liberado === 2, 'el lock se toma y se libera en los dos pedidos');
  ok(be.flushes === 1, 'flush después de escribir');
  const fotosAntes = be.fotosSubidas;
  const resC = JSON.parse(be.guardarCalidad({ Id_Calidad: 'CC-77', Grano: 'GARBANZO', 'imagen 1': 'data:image/jpeg;base64,AAAA' }).contenido);
  ok(resC.nota === 'ya existía' && be.fotosSubidas === fotosAntes, 'un reintento posterior no vuelve a subir fotos');
  be.fallaFoto = true;
  let tiro = false;
  try { be.guardarCalidad({ Id_Calidad: 'CC-78', Grano: 'GARBANZO', 'imagen 1': 'data:image/jpeg;base64,AAAA' }); } catch (e) { tiro = true; }
  ok(tiro && be.hoja.filas.length === 2, 'si Drive falla no se escribe la fila y el error sube (la app conserva el control)');
  ok(be.lock.tomado === 2, 'y no llega a tomar el lock (las fotos van antes)');

  console.log('\n' + pasadas + ' pasaron, ' + fallas + ' fallaron\n');
  process.exit(fallas ? 1 : 0);
})();
