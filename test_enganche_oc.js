// ============================================================================
//  PRUEBAS DEL ENGANCHE ORDEN DE CARGA → CONTROL DE TRANSPORTE
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_enganche_oc.js     (desde esta carpeta)
//
//  Que se verifica:
//    1. Backend (01_backend_principal.gs + 05_orden_carga.gs): que el camion
//       de la OC conserve su clave al editar la orden, y que la hoja `Orden`
//       guarde y devuelva el vinculo (Id_OC, Nro_OC, Id_Camion_OC,
//       Nro_Camion_OC) POR NOMBRE de columna, sin correr las 37 de siempre.
//    2. Frontend (orden-carga.js, seccion 9): que un camion de la OC 2056 real
//       se convierta en los productos y contratos del Control de Transporte
//       como se definio (Lote BRC -> N° Lote, Lote Planta -> Posicion, Kg CP
//       vacio con el declarado aparte), y que se sepa que camiones ya tienen
//       control.
//
//  NO toca el Sheet de verdad ni la red: todo pasa en memoria.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;

let fallos = 0;
function ok(cond, nombre) {
  if (!cond) fallos++;
  console.log((cond ? '  ✔ ' : '  ✘ FALLA: ') + nombre);
}

// --- Sheet falso (lo justo de SpreadsheetApp) ----------------------------
class Hoja {
  constructor(nombre) { this.nombre = nombre; this.filas = []; }
  appendRow(f) { this.filas.push(f.slice()); }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() {
    const h = this, ancho = this.getLastColumn();
    return { getValues: () => h.filas.map(r => { const c = r.slice(); while (c.length < ancho) c.push(''); return c; }) };
  }
  getRange(fila, col, nFilas, nCols) {
    const h = this;
    const celdas = () => {
      const out = [];
      for (let i = fila - 1; i < fila - 1 + (nFilas || 1); i++) {
        const r = h.filas[i] || [];
        const fil = [];
        for (let j = col - 1; j < col - 1 + (nCols || 1); j++) fil.push(r[j] === undefined ? '' : r[j]);
        out.push(fil);
      }
      return out;
    };
    return {
      getValues: celdas,
      getDisplayValues: () => celdas().map(r => r.map(v => String(v))),
      setValue: v => { const r = h.filas[fila - 1] || (h.filas[fila - 1] = []); r[col - 1] = v; },
      setValues: valores => valores.forEach((fv, i) => {
        const r = h.filas[fila - 1 + i] || (h.filas[fila - 1 + i] = []);
        fv.forEach((v, j) => { r[col - 1 + j] = v; });
      })
    };
  }
  deleteRow(n) { this.filas.splice(n - 1, 1); }
  setFrozenRows() { }
}

const HOJAS = {};
function hojaNueva(nombre, encabezados) { HOJAS[nombre] = new Hoja(nombre); HOJAS[nombre].appendRow(encabezados); return HOJAS[nombre]; }

// La hoja `Orden` real: 37 columnas, con Tipo_Carga al final.
const ENCABEZADOS_ORDEN = ['Id_Carga', 'Fecha', 'Archivo', 'PDF', 'Nombre y Apellido del chofer', 'Patente Chasis',
  'Patente Acoplado', 'Firma Chofer', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'ESTATUS', 'Firma Control',
  'Elaboró', 'Indicaciones', 'Foto1', 'Foto2', 'Foto3', 'Foto4', 'Foto5', 'Foto6', 'Foto7', 'Foto8', 'Kg Cargados',
  'Estado', 'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'Correo', 'Estado_Correo', 'Tipo_Carga'];

function reiniciarHojas() {
  Object.keys(HOJAS).forEach(k => delete HOJAS[k]);
  hojaNueva('Orden', ENCABEZADOS_ORDEN);
  hojaNueva('Producto', ['Id', 'Id_Carga', 'Producto', 'Calibre', 'Tipo', 'Lote', 'Posicion', 'Envase', 'Cantidad', 'Kg_Envase', 'Total_Kg']);
  hojaNueva('Contrato Comercial', ['Id', 'Id_Carga', 'Contrato', 'Contrato Cliente', 'CP', 'Destino', 'Kg CP', 'Obs CP', 'Kg Descarga', 'Archivo']);
}

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: n => HOJAS[n] || null,
    insertSheet: n => (HOJAS[n] = new Hoja(n))
  }),
  flush: () => { }
};
let uuid = 0;
global.Utilities = {
  getUuid: () => 'uuid-' + (++uuid),
  formatDate: d => new Date(d).toISOString().slice(0, 10)
};
global.Session = { getScriptTimeZone: () => 'UTC' };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) };
global.Logger = { log: () => { } };
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
};

// --- Cargar el backend real (como en Apps Script: todo en el mismo ámbito) -
eval(fs.readFileSync(path.join(RAIZ, '01_backend_principal.gs'), 'utf8'));
eval(fs.readFileSync(path.join(RAIZ, '05_orden_carga.gs'), 'utf8'));

const leerCargas = () => JSON.parse(doGet({ parameter: {} }).getContent());
const leerOrdenes = () => JSON.parse(leerOrdenesCarga().getContent());

// --- La OC 2056 real (dos camiones, cuatro CP), como la manda el front ----
function oc2056() {
  return {
    Id_OC: 'OC-2056', Nro_OC: '2056', Fecha: '2026-07-14', Especie: 'Poroto Mung',
    Destino: 'CAP. CORTES', Total_Camiones: 2, Total_Bolsas: 3000, Total_Kg: 75000,
    Camiones: [
      {
        Id_Camion: 'CAM-1', especie: 'Poroto Mung', transportista: 'Transporte A',
        chofer: 'Chofer A', dominio_camion: 'AA000AA', dominio_acoplado: 'AC000AA',
        CartasPorte: [
          { productor: 'ACIAGRO', contrato_com: 'CN26-081 B', peso_neto: 26695, observaciones: 'OC 2056 (1069 BLS)',
            Lotes: [
              { lote_brc: '4380', lote_planta: 'LT-556 A', tipo: 'PT', bolsas: 737, kg_bolsa: 25, total_kg: 18425, calibre: '3.5mm' },
              { lote_brc: '4450', lote_planta: 'LT-573', tipo: 'PT', bolsas: 250, kg_bolsa: 25, total_kg: 6250, calibre: '4mm' },
              { lote_brc: '4455', lote_planta: 'LT-578 R', tipo: 'PT', bolsas: 82, kg_bolsa: 25, total_kg: 2050, calibre: '3.5mm' }
            ] },
          { productor: 'ARGAN', contrato_com: 'CN26-081 C', peso_neto: 9785, observaciones: 'OC 2056 (391 BLS)',
            Lotes: [{ lote_brc: '4381', lote_planta: 'LT-556 B', tipo: 'PT', bolsas: 391, kg_bolsa: 25, total_kg: 9775, calibre: '3.5mm' }] }
        ]
      },
      {
        // Sin especie: es una orden de antes del 16/10 que la tenía en la cabecera
        Id_Camion: 'CAM-2', transportista: 'Transporte B', chofer: 'Chofer B', dominio_camion: 'BB000BB',
        CartasPorte: [
          { productor: 'ARGAN', contrato_com: 'CN26-081 C', peso_neto: 14575, observaciones: 'OC 2056 (583 BLS)',
            Lotes: [
              { lote_brc: '4381', lote_planta: 'LT-556 B', bolsas: 336, kg_bolsa: 25, total_kg: 8400, calibre: '3.5mm' },
              { lote_brc: '4450', lote_planta: 'LT-573', bolsas: 247, kg_bolsa: 25, total_kg: 6175, calibre: '4mm' }
            ] },
          { productor: 'BRAUN', contrato_com: 'CN26-081 A', peso_neto: 23925, observaciones: 'OC 2056 (957 BLS)',
            Lotes: [
              { lote_brc: '4380', lote_planta: 'LT-556 A', bolsas: 645, kg_bolsa: 25, total_kg: 16125, calibre: '3.5mm' },
              { lote_brc: '4469', lote_planta: 'LT-604 R', bolsas: 54, kg_bolsa: 25, total_kg: 1350, calibre: '3.5mm' }
            ] }
        ]
      }
    ]
  };
}

function control(id, extra) {
  return Object.assign({
    Id_Carga: id, Fecha: '2026-07-14', Tipo_Carga: 'PT', Nombre_Chofer: 'Chofer A', ESTATUS: 'ACEPTADO',
    Productos: [{ producto: 'Poroto Mung', lote: '4380', posicion: 'LT-556 A', cantidad: 737, kg_envase: 25, total_kg: 18425 }],
    Contratos: [{ contrato_com: 'CN26-081 B', kg_cp: 26695 }]
  }, extra || {});
}
const VINCULO_CAM1 = { Id_OC: 'OC-2056', Nro_OC: '2056', Id_Camion_OC: 'CAM-1', Nro_Camion_OC: 1 };

// ===========================================================================
console.log('\n--- 1. LA CLAVE DEL CAMIÓN SOBREVIVE A LA EDICIÓN DE LA ORDEN ---');
reiniciarHojas();
guardarOrdenCarga(oc2056());
let leida = leerOrdenes()[0];
ok(leida.Camiones[0].Id_Camion === 'CAM-1' && leida.Camiones[1].Id_Camion === 'CAM-2',
  'al guardar, los camiones quedan con la clave que mandó la app');

const editada = oc2056();
editada.Camiones[0].chofer = 'Otro chofer';
actualizarOrdenCarga(editada);
leida = leerOrdenes()[0];
ok(leida.Camiones[0].Id_Camion === 'CAM-1' && leida.Camiones[0].chofer === 'Otro chofer',
  'al editar la orden (borrar y reinsertar), el camión conserva su clave');

// Una orden guardada ANTES de este cambio: el backend le inventó la clave.
reiniciarHojas();
const vieja = oc2056();
vieja.Camiones.forEach(c => delete c.Id_Camion);
guardarOrdenCarga(vieja);
const claveInventada = leerOrdenes()[0].Camiones[0].Id_Camion;
ok(/^uuid-/.test(claveInventada), 'una orden vieja sin clave recibe una del backend');
// La app la vuelve a mandar tal como la leyó
actualizarOrdenCarga(leerOrdenes()[0]);
ok(leerOrdenes()[0].Camiones[0].Id_Camion === claveInventada,
  'y al volver a guardarla desde la app, esa clave ya no cambia');

// ===========================================================================
console.log('\n--- 2. LA HOJA `Orden` GUARDA EL VÍNCULO POR NOMBRE ---');
reiniciarHojas();
guardarRegistroCompleto(control('BC-1'));
ok(HOJAS['Orden'].filas[0].length === 37, 'un control SIN orden no agrega columnas a la hoja');
let c1 = leerCargas()[0];
ok(c1.Id_OC === '' && c1.Nro_OC === '' && c1.Id_Camion_OC === '',
  'y al leerlo, el vínculo viene vacío (no undefined)');

guardarRegistroCompleto(control('BC-2', VINCULO_CAM1));
const enc = HOJAS['Orden'].filas[0];
ok(enc.slice(37).join(',') === 'Id_OC,Nro_OC,Id_Camion_OC,Nro_Camion_OC',
  'un control CON orden crea las 4 columnas al final, después de Tipo_Carga');
ok(enc.slice(0, 37).join(',') === ENCABEZADOS_ORDEN.join(','), 'las 37 columnas de siempre no se movieron');
const fila2 = HOJAS['Orden'].filas[2];
ok(fila2[0] === 'BC-2' && fila2[36] === 'PT' && fila2[37] === 'OC-2056' && fila2[39] === 'CAM-1',
  'la fila tiene el vínculo en su columna y Tipo_Carga sigue en la 37');

const cargas = leerCargas();
const c2 = cargas.find(c => c.Id_Carga === 'BC-2');
ok(c2.Id_OC === 'OC-2056' && String(c2.Nro_OC) === '2056' && c2.Id_Camion_OC === 'CAM-1' && String(c2.Nro_Camion_OC) === '1',
  'doGet devuelve el vínculo');
ok(cargas.find(c => c.Id_Carga === 'BC-1').Id_OC === '', 'el control viejo, que tiene la fila más corta, sigue sin vínculo');
ok(c2.Tipo_Carga === 'PT' && c2.Kg_Cargados !== undefined, 'lo que se lee por posición no se corrió');

console.log('\n--- 3. REINTENTOS Y EDICIONES ---');
guardarRegistroCompleto(control('BC-2', VINCULO_CAM1));
ok(HOJAS['Orden'].filas.filter(f => f[0] === 'BC-2').length === 1, 'el mismo POST dos veces deja una sola fila');

// "actualizar" = eliminarPorIdCarga + guardarRegistroCompleto
eliminarPorIdCarga('BC-2');
guardarRegistroCompleto(control('BC-2', Object.assign({}, VINCULO_CAM1, { ESTATUS: 'OBSERVADO' })));
const c2b = leerCargas().find(c => c.Id_Carga === 'BC-2');
ok(c2b.ESTATUS === 'OBSERVADO' && c2b.Id_Camion_OC === 'CAM-1', 'editar el control conserva el vínculo');
ok(HOJAS['Orden'].filas[0].length === 41, 'y no vuelve a crear las columnas');

eliminarPorIdCarga('BC-2');
guardarRegistroCompleto(control('BC-2'));
const c2c = leerCargas().find(c => c.Id_Carga === 'BC-2');
ok(c2c.Id_OC === '' && c2c.Id_Camion_OC === '', 'desvincular y guardar deja el control sin orden');

// Alguien movió las columnas del vínculo en el Sheet: igual se encuentran.
reiniciarHojas();
HOJAS['Orden'].filas[0].push('Nro_Camion_OC', 'Otra cosa', 'Id_Camion_OC', 'Nro_OC', 'Id_OC');
guardarRegistroCompleto(control('BC-3', VINCULO_CAM1));
const c3 = leerCargas()[0];
ok(c3.Id_OC === 'OC-2056' && c3.Id_Camion_OC === 'CAM-1' && String(c3.Nro_Camion_OC) === '1',
  'con las columnas en otro orden, se escribe y se lee cada una por su nombre');
ok(!HOJAS['Orden'].filas[1][38], 'y la columna ajena del medio no se toca');

// ===========================================================================
console.log('\n--- 4. DE LA ORDEN AL CONTROL (orden-carga.js, sección 9) ---');
const app = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
const oc = fs.readFileSync(path.join(RAIZ, 'orden-carga.js'), 'utf8');
function cortar(src, inicio) {
  const i = src.indexOf(inicio);
  if (i === -1) throw new Error('No encontré ' + inicio);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(i, j + 1);
}
const front = {};
new Function('front', [
  cortar(app, 'function parseNumeroAR'),
  cortar(oc, 'function ocNumero'),
  cortar(oc, 'function ocAdaptarOrdenVieja'),
  cortar(oc, 'function ocDatosParaControl'),
  cortar(oc, 'function ocControlesPorCamion'),
  cortar(oc, 'function ocTextoCamion'),
  'Object.assign(front, { ocDatosParaControl, ocControlesPorCamion, ocTextoCamion });'
].join('\n'))(front);

const d1 = front.ocDatosParaControl(oc2056(), 'CAM-1');
ok(d1.chofer === 'Chofer A' && d1.patente_chasis === 'AA000AA' && d1.patente_acoplado === 'AC000AA',
  'chofer y patentes salen del camión');
ok(d1.productos.length === 4, 'un producto por cada lote de sus dos cartas de porte (3 + 1)');
const p0 = d1.productos[0];
ok(p0.lote === '4380' && p0.posicion === 'LT-556 A', 'N° Lote = Lote BRC y Posición Planta = Lote Planta');
ok(p0.producto === 'Poroto Mung' && p0.calibre === '3.5mm' && p0.tipo === 'PT' && p0.envase === 'Bolsas',
  'producto, calibre, tipo y envase');
ok(p0.cantidad === 737 && p0.kg_envase === 25, 'bolsas y kg por bolsa (el total lo calcula el formulario)');
ok(d1.contratos.length === 2, 'un contrato por cada carta de porte');
const k0 = d1.contratos[0];
ok(k0.contrato_com === 'CN26-081 B' && k0.destino === 'CAP. CORTES' && k0.observaciones_cp === 'OC 2056 (1069 BLS)',
  'contrato comercial, destino y observaciones CP');
ok(k0.kg_cp === undefined && k0.kg_oc === 26695, 'Kg CP NO se completa: el declarado viaja aparte, de referencia');
ok(k0.contrato_cli === undefined, 'Contrato Cliente no existe en la orden: lo completa planta');
ok(JSON.stringify(d1.vinculo) === JSON.stringify(VINCULO_CAM1), 'el vínculo lleva las dos claves y los dos números');

const d2 = front.ocDatosParaControl(oc2056(), 'CAM-2');
ok(d2.vinculo.Nro_Camion_OC === 2 && d2.productos.length === 4, 'el segundo camión es el N° 2, con sus 4 lotes');
ok(d2.productos.every(p => p.producto === 'Poroto Mung'), 'una orden vieja sin grano por camión toma el de la cabecera');
ok(d2.productos[0].tipo === '', 'si el lote no dice el tipo, queda vacío (el formulario pone PT)');

ok(front.ocDatosParaControl(oc2056(), 'CAM-9') === null, 'un camión que ya no está en la orden devuelve null');
ok(front.ocDatosParaControl(oc2056(), '') === null, 'sin camión elegido, null');
ok(front.ocDatosParaControl(null, 'CAM-1') === null, 'sin orden, null');
const ocOriginal = oc2056();
front.ocDatosParaControl(ocOriginal, 'CAM-2');
ok(ocOriginal.Camiones[1].especie === undefined, 'no modifica la orden que recibe');

console.log('\n--- 5. QUÉ CAMIONES YA TIENEN CONTROL ---');
const controles = [
  control('BC-10', VINCULO_CAM1),
  control('BC-11', { Id_OC: 'OC-OTRA', Id_Camion_OC: 'CAM-2' }),
  control('BC-12'),
  control('BC-13', Object.assign({}, VINCULO_CAM1, { Fecha: '2026-07-15', ESTATUS: 'RECHAZADO' }))
];
const porCamion = front.ocControlesPorCamion('OC-2056', controles);
ok(Object.keys(porCamion).join(',') === 'CAM-1', 'solo cuenta los controles de ESA orden');
ok(porCamion['CAM-1'].Id_Carga === 'BC-13', 'si hay dos para el mismo camión, gana el más nuevo');
ok(Object.keys(front.ocControlesPorCamion('OC-2056', [])).length === 0, 'sin controles, ningún camión');
ok(front.ocTextoCamion({ dominio_camion: 'AA000AA', chofer: 'Chofer A' }, 1) === 'Camión 1 · AA000AA · Chofer A',
  'el texto del camión para la lista');
ok(front.ocTextoCamion({}, 3) === 'Camión 3', 'sin dominio ni chofer, solo el número');

// ===========================================================================
console.log('\n--- 6. EL CORREO DE LA ORDEN (constancia en Orden_Carga) ---');
const MAILS = [];
const CACHE = {};
global.MailApp = { sendEmail: (para, asunto, texto, opciones) => MAILS.push({ para, asunto, opciones }) };
global.CacheService = { getScriptCache: () => ({ get: k => CACHE[k] || null, put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) };
global.Utilities.computeDigest = (alg, texto) => Array.from(Buffer.from(require('crypto').createHash('md5').update(texto).digest()));
global.Utilities.DigestAlgorithm = { MD5: 'md5' };
global.Utilities.base64Decode = b64 => Array.from(Buffer.from(b64, 'base64'));
global.Utilities.newBlob = (bytes, tipo, nombre) => ({ bytes, tipo, nombre });

reiniciarHojas();
guardarOrdenCarga(oc2056());
ok(leerOrdenes()[0].Correo === '' && leerOrdenes()[0].Estado_Correo === '', 'una orden recién guardada no tiene correo');

const resp = JSON.parse(actualizarEstadoCorreoDeOC({ Id_OC: 'OC-2056', Correo: 'planta@ejemplo.com', Estado_Correo: 'Enviado 30/10/2026 10:00 a planta@ejemplo.com (vía app)' }).getContent());
let ordenLeida = leerOrdenes()[0];
ok(resp.status === 'success' && ordenLeida.Correo === 'planta@ejemplo.com' && /^Enviado/.test(ordenLeida.Estado_Correo),
  'salió por Gmail: queda la constancia en la orden');

// Editar la orden: la app manda de vuelta Correo y Estado_Correo (ocArmarObjeto)
const conCorreo = Object.assign(oc2056(), { Correo: ordenLeida.Correo, Estado_Correo: ordenLeida.Estado_Correo });
conCorreo.Camiones[0].chofer = 'Chofer corregido';
actualizarOrdenCarga(conCorreo);
ordenLeida = leerOrdenes()[0];
ok(ordenLeida.Correo === 'planta@ejemplo.com' && ordenLeida.Camiones[0].chofer === 'Chofer corregido',
  'editar la orden no pierde a quién se mandó');

const noEsta = JSON.parse(actualizarEstadoCorreoDeOC({ Id_OC: 'OC-NO-SUBIO', Correo: 'x@y.com', Estado_Correo: 'Enviado' }).getContent());
ok(noEsta.status !== 'success', 'una orden que todavía no subió contesta "no encontrada" (la constancia viaja con ella)');

// Una hoja Orden_Carga de antes, sin las columnas de correo
reiniciarHojas();
hojaNueva('Orden_Carga', COLS_OC.slice(0, COLS_OC.indexOf('Correo')));
guardarOrdenCarga(oc2056());
marcarEstadoCorreoOC('OC-2056', 'planta@ejemplo.com', 'Enviado');
ok(HOJAS['Orden_Carga'].filas[0].slice(-2).join(',') === 'Correo,Estado_Correo' && leerOrdenes()[0].Correo === 'planta@ejemplo.com',
  'en una hoja vieja, las columnas de correo se crean solas al final');

// Plan B: el correo sale por el backend, con el PDF adjunto
reiniciarHojas();
guardarOrdenCarga(oc2056());
const envio = {
  _accion: 'enviar_correo_reporte', Tipo_Reporte: 'oc', Id_Carga: 'OC-2056', Id_Calidad: 'OC-2056', Id_OC: 'OC-2056',
  Correo: 'planta@ejemplo.com', Correo_Asunto: 'Orden de Carga N° 2056 — Poroto Mung — CAP. CORTES — 2026-07-14',
  Correo_Cuerpo_Html: '<p>hola</p>', Correo_Nombre_Remitente: 'Santiago (App Braun)', Correo_Reply_To: 'santi@braun',
  Pdf_Base64: Buffer.from('%PDF-1.3 prueba').toString('base64'), Pdf_Nombre: 'Orden_de_Carga_2056.pdf',
  Estado_Correo: 'Enviado 30/10/2026 10:05 a planta@ejemplo.com (vía app)'
};
enviarReportePorCorreo(envio);
ok(MAILS.length === 1 && MAILS[0].para === 'planta@ejemplo.com' && MAILS[0].opciones.attachments[0].nombre === 'Orden_de_Carga_2056.pdf',
  'por el backend sale un correo, con el PDF de la orden adjunto');
ordenLeida = leerOrdenes()[0];
ok(/^Enviado 30\/10\/2026 10:05/.test(ordenLeida.Estado_Correo), 'y la constancia queda en la orden, no en la hoja de controles');
ok(HOJAS['Orden'].filas.length === 1, 'la hoja Orden (Control de Transporte) no se toca');
const dup = JSON.parse(enviarReportePorCorreo(envio).getContent());
ok(MAILS.length === 1 && dup.duplicado === true, 'el mismo envío repetido no manda un segundo correo');

console.log('\n' + (fallos === 0 ? '>>> TODO OK' : '>>> ' + fallos + ' FALLA(S)'));
process.exit(fallos ? 1 : 0);
