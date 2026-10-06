// ============================================================================
//  PRUEBAS DEL BACKEND DE ORDEN DE CARGA  (05_orden_carga.gs)
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_orden_carga.js     (desde esta carpeta)
//
//  Por que existe: el backend es Apps Script y no se puede correr en la
//  compu. Sin esto, la unica forma de probar un cambio en 05_orden_carga.gs es
//  pegarlo en el editor, desplegar y tocar la app en produccion. Aca se simula
//  lo justo del Sheet (appendRow, deleteRow, getDataRange) y se hace el viaje
//  completo con los datos de la OC 2056 real: guardar, reintentar el mismo
//  POST, leer, editar, convivir con otra orden, borrar y los bordes.
//
//  NO toca el Sheet de verdad ni la red: todo pasa en memoria.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;

// --- Sheet falso ---------------------------------------------------------
class Hoja {
  constructor(nombre) { this.nombre = nombre; this.filas = []; }
  appendRow(f) { this.filas.push(f.slice()); }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas.length ? this.filas[0].length : 0; }
  getDataRange() { const h = this; return { getValues: () => h.filas.map(r => r.slice()) }; }
  getRange(fila, col, nFilas, nCols) {
    const h = this;
    return {
      getDisplayValues: () => {
        const out = [];
        for (let i = fila - 1; i < fila - 1 + (nFilas || 1); i++) {
          const r = h.filas[i] || [];
          out.push(r.slice(col - 1, col - 1 + (nCols || r.length)).map(v => String(v === undefined ? '' : v)));
        }
        return out;
      }
    };
  }
  deleteRow(n) { this.filas.splice(n - 1, 1); }
  setFrozenRows() { }
}

const HOJAS = {};
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
  formatDate: (d) => d.toISOString().slice(0, 10)
};
global.Session = { getScriptTimeZone: () => 'UTC' };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) };
global.Logger = { log: () => { } };
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
};

// --- Helpers que viven en 01_backend_principal.gs -------------------------
global.obtenerHojaConEncabezados = function (nombre, columnas) {
  if (!HOJAS[nombre]) { HOJAS[nombre] = new Hoja(nombre); HOJAS[nombre].appendRow(columnas); }
  return HOJAS[nombre];
};
global.buscarFilaPorId = function (hoja, id) {
  if (!id || hoja.getLastRow() < 2) return -1;
  for (let f = 1; f < hoja.filas.length; f++) {
    if (String(hoja.filas[f][0]).trim() === String(id).trim()) return f + 1;
  }
  return -1;
};
global.borrarFilasPorColumna = function (hoja, idx, valor) {
  for (let i = hoja.filas.length - 1; i >= 1; i--) {
    if (hoja.filas[i][idx] == valor) hoja.deleteRow(i + 1);
  }
};
global.respuestaOk = () => ({ status: 'success' });
global.respuestaJsonCalidad = obj => ({ _json: obj, getContent: () => JSON.stringify(obj) });

// --- Cargar el archivo bajo prueba ---------------------------------------
const codigo = fs.readFileSync(path.join(RAIZ, '05_orden_carga.gs'), 'utf8');
eval(codigo);   // deja sus `var` y `function` a mano, como en Apps Script

// --- La OC 2056 real, en el formato que manda el front -------------------
const OC = {
  Id_OC: 'OC-1', Nro_OC: '2056', Fecha: '2026-07-14',
  Contrato_Encabeza: 'CN26-063', Especie: 'Poroto Mung', Cosecha: '25-26',
  Destino: 'Planta destino', Destino_Planta: '12058',
  Objetivo_Kg: 75000, Total_Camiones: 2, Total_Bolsas: 3000, Total_Kg: 75000,
  Camiones: [
    {
      transportista: 'Transporte A', chofer: 'Chofer A', dominio_camion: 'AA000AA',
      CartasPorte: [
        { productor: 'ACIAGRO', contrato_com: 'CN26-081 B', ctg: '10000000001', peso_neto: 26695,
          observaciones: 'OC 2056 (1069 BLS)',
          Lotes: [
            { lote_brc: '4380', lote_planta: 'LT-556 A', bolsas: 737, kg_bolsa: 25, total_kg: 18425, calibre: '3.5mm' },
            { lote_brc: '4450', lote_planta: 'LT-573', bolsas: 250, kg_bolsa: 25, total_kg: 6250, calibre: '4mm' },
            { lote_brc: '4455', lote_planta: 'LT-578 R', bolsas: 82, kg_bolsa: 25, total_kg: 2050, calibre: '3.5mm' }
          ] },
        { productor: 'ARGAN', contrato_com: 'CN26-081 C', ctg: '', peso_neto: 9785,
          observaciones: 'OC 2056 (391 BLS)',
          Lotes: [{ lote_brc: '4381', lote_planta: 'LT-556 B', bolsas: 391, kg_bolsa: 25, total_kg: 9775, calibre: '3.5mm' }] }
      ]
    },
    {
      transportista: 'Transporte B', chofer: 'Chofer B', dominio_camion: 'BB000BB',
      CartasPorte: [
        { productor: 'ARGAN', contrato_com: 'CN26-081 C', ctg: '10000000002', peso_neto: 14575,
          observaciones: 'OC 2056 (583 BLS)',
          Lotes: [
            { lote_brc: '4381', lote_planta: 'LT-556 B', bolsas: 336, kg_bolsa: 25, total_kg: 8400, calibre: '3.5mm' },
            { lote_brc: '4450', lote_planta: 'LT-573', bolsas: 247, kg_bolsa: 25, total_kg: 6175, calibre: '4mm' }
          ] },
        { productor: 'BRAUN', contrato_com: 'CN26-081 A', ctg: '', peso_neto: 23925,
          observaciones: 'OC 2056 (957 BLS)',
          Lotes: [
            { lote_brc: '4380', lote_planta: 'LT-556 A', bolsas: 645, kg_bolsa: 25, total_kg: 16125, calibre: '3.5mm' },
            { lote_brc: '4381', lote_planta: 'LT-556 B', bolsas: 24, kg_bolsa: 25, total_kg: 600, calibre: '3.5mm' },
            { lote_brc: '4450', lote_planta: 'LT-573', bolsas: 234, kg_bolsa: 25, total_kg: 5850, calibre: '4mm' },
            { lote_brc: '4469', lote_planta: 'LT-604 R', bolsas: 54, kg_bolsa: 25, total_kg: 1350, calibre: '3.5mm' }
          ] }
      ]
    }
  ]
};

let fallos = 0;
function chequear(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? '  OK   ' : '  FALLA') + ' ' + nombre + (ok ? '' : '  -> esperaba ' + JSON.stringify(esperado) + ', vino ' + JSON.stringify(real)));
}

console.log('\n--- 1. GUARDAR ---');
guardarOrdenCarga(OC);
chequear('las 4 hojas se crearon solas', Object.keys(HOJAS).sort(), ['OC_CartaPorte', 'OC_Camion', 'OC_Lote', 'Orden_Carga'].sort());
chequear('1 fila en Orden_Carga', HOJAS['Orden_Carga'].filas.length - 1, 1);
chequear('2 camiones', HOJAS['OC_Camion'].filas.length - 1, 2);
chequear('4 cartas de porte', HOJAS['OC_CartaPorte'].filas.length - 1, 4);
chequear('10 renglones de lote', HOJAS['OC_Lote'].filas.length - 1, 10);

console.log('\n--- 2. IDEMPOTENCIA (el mismo POST dos veces) ---');
guardarOrdenCarga(OC);
chequear('sigue habiendo 1 sola orden', HOJAS['Orden_Carga'].filas.length - 1, 1);
chequear('sigue habiendo 2 camiones', HOJAS['OC_Camion'].filas.length - 1, 2);
chequear('siguen habiendo 10 lotes', HOJAS['OC_Lote'].filas.length - 1, 10);

console.log('\n--- 3. LEER ---');
const leidas = leerOrdenesCarga()._json;
chequear('devuelve 1 orden', leidas.length, 1);
const o = leidas[0];
chequear('Nro_OC', o.Nro_OC, '2056');
chequear('Contrato_Encabeza', o.Contrato_Encabeza, 'CN26-063');
chequear('Total_Kg', o.Total_Kg, 75000);
chequear('2 camiones', o.Camiones.length, 2);
chequear('camion 1: 2 CP', o.Camiones[0].CartasPorte.length, 2);
chequear('camion 2: 2 CP', o.Camiones[1].CartasPorte.length, 2);
chequear('CP 1 del camion 1: 3 lotes', o.Camiones[0].CartasPorte[0].Lotes.length, 3);
chequear('CP 2 del camion 2: 4 lotes', o.Camiones[1].CartasPorte[1].Lotes.length, 4);
chequear('productor de la CP 1', o.Camiones[0].CartasPorte[0].productor, 'ACIAGRO');
chequear('CTTO de la CP 1', o.Camiones[0].CartasPorte[0].contrato_com, 'CN26-081 B');
chequear('Observaciones CP armadas', o.Camiones[0].CartasPorte[0].observaciones, 'OC 2056 (1069 BLS)');
chequear('lote BRC del primer renglon', String(o.Camiones[0].CartasPorte[0].Lotes[0].lote_brc), '4380');
chequear('bolsas del primer renglon', o.Camiones[0].CartasPorte[0].Lotes[0].bolsas, 737);
chequear('el lote NO se mezcla entre CP (CP2 del cam.1 tiene solo el 4381)',
  o.Camiones[0].CartasPorte[1].Lotes.map(l => String(l.lote_brc)), ['4381']);
const bolsasTotales = o.Camiones.reduce((t, c) => t + c.CartasPorte.reduce((t2, cp) => t2 + cp.Lotes.reduce((t3, l) => t3 + Number(l.bolsas), 0), 0), 0);
chequear('las bolsas leidas suman 3000', bolsasTotales, 3000);

console.log('\n--- 4. ACTUALIZAR (se saca un camion) ---');
const editada = JSON.parse(JSON.stringify(OC));
editada.Camiones.pop();
editada.Total_Camiones = 1;
actualizarOrdenCarga(editada);
chequear('sigue habiendo 1 orden', HOJAS['Orden_Carga'].filas.length - 1, 1);
chequear('ahora 1 camion', HOJAS['OC_Camion'].filas.length - 1, 1);
chequear('ahora 2 cartas de porte', HOJAS['OC_CartaPorte'].filas.length - 1, 2);
chequear('ahora 4 lotes', HOJAS['OC_Lote'].filas.length - 1, 4);
chequear('no quedaron lotes huerfanos del camion borrado',
  leerOrdenesCarga()._json[0].Camiones.length, 1);

console.log('\n--- 5. DOS ORDENES CONVIVIENDO ---');
const otra = JSON.parse(JSON.stringify(OC));
otra.Id_OC = 'OC-2'; otra.Nro_OC = '2057';
guardarOrdenCarga(otra);
const dos = leerOrdenesCarga()._json;
chequear('hay 2 ordenes', dos.length, 2);
chequear('la mas reciente primero', dos[0].Nro_OC, '2057');
chequear('la 2057 tiene sus 2 camiones', dos.find(x => x.Nro_OC === '2057').Camiones.length, 2);
chequear('la 2056 conserva el suyo', dos.find(x => x.Nro_OC === '2056').Camiones.length, 1);

console.log('\n--- 6. ELIMINAR ---');
eliminarOrdenCarga({ Id_OC: 'OC-2' });
const queda = leerOrdenesCarga()._json;
chequear('queda 1 orden', queda.length, 1);
chequear('la que queda es la 2056', queda[0].Nro_OC, '2056');
chequear('no quedaron camiones huerfanos', HOJAS['OC_Camion'].filas.length - 1, 1);
chequear('no quedaron CP huerfanas', HOJAS['OC_CartaPorte'].filas.length - 1, 2);
chequear('no quedaron lotes huerfanos', HOJAS['OC_Lote'].filas.length - 1, 4);

console.log('\n--- 7. BORDES ---');
eliminarOrdenCarga({ Id_OC: 'no-existe' });
chequear('borrar algo que no esta no rompe nada', leerOrdenesCarga()._json.length, 1);
guardarOrdenCarga({ Id_OC: 'OC-3', Nro_OC: '2058', Fecha: '2026-07-15', Camiones: [] });
chequear('una orden sin camiones se guarda igual', leerOrdenesCarga()._json.length, 2);
chequear('y se lee con Camiones vacio', leerOrdenesCarga()._json.find(x => x.Nro_OC === '2058').Camiones, []);

console.log('\n' + (fallos === 0 ? '>>> TODO OK' : '>>> ' + fallos + ' FALLA(S)'));
process.exit(fallos === 0 ? 0 : 1);
