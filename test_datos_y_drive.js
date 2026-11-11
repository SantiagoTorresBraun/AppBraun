// ============================================================================
//  PRUEBAS DEL PRIMER BLOQUE DE LA SEGUNDA AUDITORÍA (30/10/2026), 10/11/2026
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_datos_y_drive.js     (desde esta carpeta)
//
//  Que se verifica:
//    1. SEC-02: las fotos y archivos se buscan SOLO en la carpeta de la app. Un
//       nombre que existe en otro lugar del Drive no se encuentra ni se hace
//       público.
//    2. DAT-04: si Drive no puede guardar la foto de un muestreo, el guardado
//       falla entero y el Sheet queda como estaba (alta y edición).
//    3. DAT-01: una edición sobre un alta "sin confirmar" viaja como edición,
//       y actualizar_calidad da de alta el control si no lo encuentra.
//    4. DAT-02: Producción no marca como sincronizado lo que el servidor no
//       confirmó, ni lo que se editó mientras viajaba el envío.
//    5. SEC-08: un texto que empieza con "=" no se guarda como fórmula.
//    6. P3-04: urlSegura no deja pasar "//otro-sitio.com".
//
//  NO toca el Sheet de verdad, ni Drive, ni la red: todo pasa en memoria.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const RAIZ = __dirname;

let fallos = 0;
function ok(cond, nombre) {
  if (!cond) fallos++;
  console.log((cond ? '  ✔ ' : '  ✘ FALLA: ') + nombre);
}

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

// --- Sheet falso (lo justo de SpreadsheetApp) ----------------------------
class Hoja {
  constructor(nombre, filas) { this.nombre = nombre; this.filas = filas || []; }
  getName() { return this.nombre; }
  appendRow(f) { this.filas.push(f.slice()); }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() {
    const h = this, ancho = this.getLastColumn();
    const todo = () => h.filas.map(r => { const c = r.slice(); while (c.length < ancho) c.push(''); return c; });
    return { getValues: todo, getDisplayValues: () => todo().map(r => r.map(String)) };
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
      getDisplayValues: () => celdas().map(r => r.map(String)),
      setValue: v => { const r = h.filas[fila - 1] || (h.filas[fila - 1] = []); r[col - 1] = v; },
      setValues: valores => valores.forEach((fv, i) => {
        const r = h.filas[fila - 1 + i] || (h.filas[fila - 1 + i] = []);
        fv.forEach((v, j) => { r[col - 1 + j] = v; });
      })
    };
  }
  getRangeList() { return { setNumberFormat: () => { } }; }
  deleteRow(n) { this.filas.splice(n - 1, 1); }
  setFrozenRows() { }
}

let HOJAS = {};
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: n => HOJAS[n] || null,
    insertSheet: n => (HOJAS[n] = new Hoja(n))
  }),
  flush: () => { }
};

// --- Drive falso -----------------------------------------------------------
// Un archivo por carpeta; getFilesByName GLOBAL se registra para comprobar que
// ya nadie lo usa.
let archivosDrive = [];
let busquedasGlobales = 0;
let driveRoto = false;
const iterador = lista => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
const archivoFalso = (nombre, carpeta) => {
  const a = {
    nombre, carpeta, id: 'ID_' + nombre, compartido: false,
    getName: () => a.nombre, getId: () => a.id,
    setSharing: () => { a.compartido = true; }
  };
  return a;
};
const carpetaFalsa = id => ({
  getId: () => id,
  getFilesByName: n => iterador(archivosDrive.filter(a => a.carpeta === id && a.nombre === n)),
  getFiles: () => iterador(archivosDrive.filter(a => a.carpeta === id)),
  createFile: blob => {
    if (driveRoto) throw new Error('Drive no disponible');
    const a = archivoFalso(blob.nombre, id);
    archivosDrive.push(a);
    return a;
  }
});
global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW' },
  getFolderById: id => carpetaFalsa(id),
  getFoldersByName: n => iterador([carpetaFalsa('CARPETA_' + n)]),
  getFilesByName: n => { busquedasGlobales++; return iterador(archivosDrive.filter(a => a.nombre === n)); }
};

global.Utilities = {
  getUuid: () => crypto.randomUUID(),
  base64Decode: b => Buffer.from(b, 'base64'),
  newBlob: (datos, tipo, nombre) => ({ datos, tipo, nombre })
};
let cache = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: k => (cache.has(k) ? cache.get(k) : null),
    put: (k, v) => { cache.set(k, String(v)); },
    remove: k => { cache.delete(k); }
  })
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.MailApp = { sendEmail: () => { } };
global.Session = { getScriptTimeZone: () => 'UTC' };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) };
global.Logger = { log: () => { } };
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
};

// --- Backend real (como en Apps Script: todo en el mismo ámbito) -----------
eval(fs.readFileSync(path.join(RAIZ, '01_backend_principal.gs'), 'utf8'));

function reiniciar() {
  HOJAS = {};
  archivosDrive = [];
  busquedasGlobales = 0;
  driveRoto = false;
  cache = new Map();
}

// ============================================================================
console.log('\n1. SEC-02: archivos solo dentro de la carpeta de la app');
reiniciar();
archivosDrive.push(archivoFalso('Sueldos 2026.xlsx', 'CARPETA_PERSONAL'));
archivosDrive.push(archivoFalso('CC-1.imagen 1.123.jpg', ID_CARPETA_CALIDAD_IMAGES));
archivosDrive.push(archivoFalso('OC-9.CP.1.pdf', ID_CARPETA_CONTRATO_FILES));

ok(resolverImagenDrive('Sueldos 2026.xlsx') === '', 'un archivo de afuera puesto en una celda de foto no se encuentra');
ok(resolverImagenDrive('Control de Calidad_Images/Sueldos 2026.xlsx') === '', '…tampoco con el prefijo de la carpeta de fotos');
ok(resolverArchivoDrive('Sueldos 2026.xlsx', ID_CARPETA_CONTRATO_FILES, CARPETA_ARCHIVOS_CONTRATO) === '',
   '…ni en la columna de Carta de Porte');
ok(!archivosDrive[0].compartido, 'y nunca se le cambia el permiso a "cualquiera con el enlace"');
ok(busquedasGlobales === 0, 'no se hace ninguna búsqueda por nombre en todo el Drive');

ok(resolverImagenDrive('Control de Calidad_Images/CC-1.imagen 1.123.jpg').indexOf('ID_CC-1.imagen 1.123.jpg') !== -1,
   'una foto de AppSheet que está en la carpeta de Calidad se sigue viendo');
ok(resolverArchivoDrive('Contrato Comercial_Files_/OC-9.CP.1.pdf', ID_CARPETA_CONTRATO_FILES, CARPETA_ARCHIVOS_CONTRATO)
   .indexOf('ID_OC-9.CP.1.pdf') !== -1, 'un archivo de Carta de Porte de su carpeta se sigue resolviendo');
ok(resolverImagenDrive('https://drive.google.com/thumbnail?id=X') === 'https://drive.google.com/thumbnail?id=X',
   'una URL guardada se devuelve tal cual, sin tocar Drive');

// ============================================================================
console.log('\n2. DAT-04: foto de muestreo que falla en Drive');
reiniciar();
const muestreo = (nota, foto) => ({
  _accion: 'guardar_muestreo', Id_Muestreo: 'M-1', Fecha: '2026-11-10', Lote: 'L1',
  Puntos: [{ Id_Punto: 'P-1', Orden: 1, Nota: nota, Foto: foto }]
});
const FOTO = 'data:image/jpeg;base64,' + Buffer.from('foto').toString('base64');

driveRoto = true;
let fallo = null;
try { guardarMuestreo(muestreo('alta', FOTO)); } catch (e) { fallo = e; }
ok(fallo && /Drive/.test(fallo.message), 'el alta lanza el error en vez de guardar el punto sin foto');
const filasM = () => (HOJAS[NOMBRE_HOJA_MUESTREO] ? HOJAS[NOMBRE_HOJA_MUESTREO].filas.length - 1 : 0);
const filasP = () => (HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS] ? HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas.length - 1 : 0);
ok(filasM() === 0 && filasP() === 0, 'y no deja una cabecera sin puntos (que el reintento daría por "ya existe")');
const r1 = JSON.parse(doPost({ postData: { contents: JSON.stringify(muestreo('alta', FOTO)) } }).getContent());
ok(r1.status === 'error', 'doPost responde status:"error", así el celular lo conserva y reintenta');

driveRoto = false;
guardarMuestreo(muestreo('original', FOTO));
ok(filasM() === 1 && filasP() === 1, 'con Drive andando, el alta guarda cabecera y punto');
const fotoGuardada = HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas[1][16];
ok(String(fotoGuardada).indexOf(CARPETA_FOTOS_MUESTREO + '/P-1.foto.') === 0, 'con la ruta de la foto en Drive');

driveRoto = true;
fallo = null;
try { actualizarMuestreo(muestreo('editado', FOTO)); } catch (e) { fallo = e; }
ok(!!fallo, 'una edición con foto nueva que falla en Drive lanza el error');
ok(filasM() === 1 && filasP() === 1 && HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas[1][15] === 'original',
   'y el muestreo anterior queda entero (antes se borraba primero)');

driveRoto = false;
actualizarMuestreo(muestreo('editado', fotoGuardada));
ok(filasP() === 1 && HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas[1][15] === 'editado' &&
   HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas[1][16] === fotoGuardada,
   'una edición sin foto nueva conserva la ruta que ya tenía');

// ============================================================================
console.log('\n3. DAT-01: edición sobre un alta "sin confirmar"');
const colaJs = fs.readFileSync(path.join(RAIZ, 'cola-sync.js'), 'utf8');
const ctxCola = vm.createContext({});
vm.runInContext(extraerFuncion(colaJs, 'colaAccionAlEditar'), ctxCola);
const accionAlEditar = (item, a) => vm.runInContext('colaAccionAlEditar', ctxCola)(item, a);
ok(accionAlEditar({ Id_Carga: 'C1' }, 'actualizar') === undefined, 'un alta que nunca salió sigue siendo alta');
ok(accionAlEditar({ Id_Carga: 'C1', _sinConfirmar: true }, 'actualizar') === 'actualizar',
   'un alta que salió sin confirmar pasa a ser edición');
ok(accionAlEditar({ Id_Carga: 'C1', _enviosSinConfirmar: 2 }, 'actualizar') === 'actualizar', '…también si solo quedó el contador');
ok(accionAlEditar({ Id_Calidad: 'Q1', _accion: 'actualizar_calidad', _sinConfirmar: true }, 'actualizar_calidad') === 'actualizar_calidad',
   'una edición sigue siendo edición');

const appJs = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
const calJs = fs.readFileSync(path.join(RAIZ, 'calidad.js'), 'utf8');
ok(extraerFuncion(appJs, 'actualizarRegistroExistente').indexOf('colaAccionAlEditar(cursor.value, "actualizar")') !== -1,
   'Transporte usa colaAccionAlEditar al editar algo que sigue en cola');
ok(extraerFuncion(calJs, 'actualizarCalidadExistente').indexOf('colaAccionAlEditar(cursor.value, "actualizar_calidad")') !== -1,
   'Calidad usa colaAccionAlEditar al editar algo que sigue en cola');

reiniciar();
HOJAS['Control Calidad Garbanzo'] = new Hoja('Control Calidad Garbanzo', [['Id_Calidad', 'Grano', 'observaciones', 'PDF Control Calidad']]);
const rCal = JSON.parse(actualizarCalidad({ Id_Calidad: 'CC-77', Grano: 'GARBANZO', observaciones: 'corregido' }).getContent());
const filaCal = HOJAS['Control Calidad Garbanzo'].filas.find(f => f[0] === 'CC-77');
ok(rCal.ok === true && filaCal && filaCal[2] === 'corregido',
   'actualizar_calidad de un control que no llegó lo da de alta con los datos corregidos');

// ============================================================================
console.log('\n4. DAT-06: editar Calidad no borra el PDF de AppSheet');
ok(/delete registro\["PDF Control Calidad"\]/.test(extraerFuncion(calJs, 'sinCamposDeAppSheet')),
   'sinCamposDeAppSheet saca "PDF Control Calidad" (y "Archivo2")');
ok(extraerFuncion(calJs, 'encolarEdicionCalidad').indexOf('sinCamposDeAppSheet(') !== -1,
   'la edición de un control ya sincronizado se encola sin esos campos');
HOJAS['Control Calidad Garbanzo'].filas.push(['CC-VIEJO', 'GARBANZO', 'obs', 'Control_PDF/viejo.pdf']);
const ctxCal = vm.createContext({});
vm.runInContext(extraerFuncion(calJs, 'sinCamposDeAppSheet'), ctxCal);
const edicion = vm.runInContext('sinCamposDeAppSheet', ctxCal)({ Id_Calidad: 'CC-VIEJO', Grano: 'GARBANZO', observaciones: 'nueva', Archivo2: 0, 'PDF Control Calidad': '' });
actualizarCalidad(edicion);
const filaVieja = HOJAS['Control Calidad Garbanzo'].filas.find(f => f[0] === 'CC-VIEJO');
ok(filaVieja[2] === 'nueva' && filaVieja[3] === 'Control_PDF/viejo.pdf', 'la edición cambia la observación y el link al PDF sigue');

// ============================================================================
console.log('\n5. DAT-02: Producción solo marca _synced lo confirmado');
function probarSyncMuestreo(respuesta, editarMientrasViaja) {
  const prodJs = fs.readFileSync(path.join(RAIZ, 'produccion.js'), 'utf8');
  const guardado = { id: 1, Id_Muestreo: 'M-1', Lote: 'L1', _synced: false };
  const store = {
    getAll: () => { const req = {}; setImmediate(() => req.onsuccess({ target: { result: [Object.assign({}, guardado)] } })); return req; },
    get: () => { const req = {}; setImmediate(() => req.onsuccess({ target: { result: Object.assign({}, guardado) } })); return req; },
    put: rec => Object.assign(guardado, rec)
  };
  const ctx = vm.createContext({
    db: { transaction: () => ({ objectStore: () => store }) },
    navigator: { onLine: true },
    WEB_APP_URL: 'https://script.google.com/x',
    console: { error: () => { }, warn: () => { }, log: () => { } },
    alert: () => { },
    enviarAlBackend: () => {
      if (editarMientrasViaja) guardado.Lote = 'L2';
      return Promise.resolve(respuesta);
    }
  });
  vm.runInContext(extraerFuncion(prodJs, 'sincronizarMuestreosPendientes'), ctx);
  vm.runInContext('sincronizarMuestreosPendientes()', ctx);
  return new Promise(res => setTimeout(() => res(guardado), 20));
}

(async () => {
  let g = await probarSyncMuestreo({ confirmado: true, respuesta: { status: 'success' } }, false);
  ok(g._synced === true, 'confirmado por el servidor → _synced:true');
  g = await probarSyncMuestreo({ confirmado: false, sinConfirmar: true }, false);
  ok(g._synced === false, 'sin confirmar (respuesta ilegible, no-cors) → sigue pendiente');
  g = await probarSyncMuestreo({ confirmado: true, respuesta: { status: 'success' } }, true);
  ok(g._synced === false && g.Lote === 'L2', 'editado mientras viajaba el envío → sigue pendiente con lo nuevo');
  const infJs = fs.readFileSync(path.join(RAIZ, 'produccion-informes.js'), 'utf8');
  ok(/if \(!r \|\| !r\.confirmado\) return;/.test(extraerFuncion(infJs, 'sincronizarInformesPendientes')),
     'Informes de campo tiene el mismo control');

  // ==========================================================================
  console.log('\n6. SEC-08: texto que empieza con "=" no es fórmula');
  ok(celdaSegura('=IMPORTDATA("https://x")') === '\'=IMPORTDATA("https://x")', 'se le antepone el apóstrofo');
  ok(celdaSegura('-5') === '-5' && celdaSegura('+54 9 11') === '+54 9 11', '"-" y "+" no se tocan (números, teléfonos)');
  ok(celdaSegura(0) === 0 && celdaSegura('') === '' && celdaSegura(null) === null, 'números y vacíos quedan igual');
  reiniciar();
  guardarMuestreo({ Id_Muestreo: 'M-9', Lote: '=HYPERLINK("http://x")', Puntos: [{ Id_Punto: 'P-9', Nota: '=1+1' }] });
  ok(HOJAS[NOMBRE_HOJA_MUESTREO].filas[1][3] === '\'=HYPERLINK("http://x")', 'appendRow del muestreo lo guarda como texto');
  ok(HOJAS[NOMBRE_HOJA_MUESTREO_PUNTOS].filas[1][15] === '\'=1+1', '…y el de los puntos también');

  // ==========================================================================
  console.log('\n7. P3-04: urlSegura y las URL relativas al protocolo');
  const ctxApp = vm.createContext({});
  vm.runInContext(extraerFuncion(appJs, 'escapeHtml') + '\n' + extraerFuncion(appJs, 'urlSegura'), ctxApp);
  const urlSegura = vm.runInContext('urlSegura', ctxApp);
  ok(urlSegura('//otro-sitio.com/x.js') === '', '"//otro-sitio.com" se rechaza');
  ok(urlSegura('/\\otro-sitio.com') === '', '"/\\otro-sitio.com" también');
  ok(urlSegura('Control de Calidad_Images/a.jpg') === 'Control de Calidad_Images/a.jpg', 'una ruta relativa de AppSheet sigue pasando');
  ok(urlSegura('https://drive.google.com/x') === 'https://drive.google.com/x', 'una https sigue pasando');

  console.log(fallos ? '\n✘ ' + fallos + ' FALLA(S)' : '\n✔ Todo OK');
  process.exit(fallos ? 1 : 0);
})();
