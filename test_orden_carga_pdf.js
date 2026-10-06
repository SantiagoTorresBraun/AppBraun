// ============================================================================
//  PRUEBAS DEL PDF DE LA ORDEN DE CARGA  (la seccion 7 de orden-carga.js)
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_orden_carga_pdf.js     (desde esta carpeta)
//
//  Carga el jsPDF real de vendor/ y los helpers reales de app.js, y genera el
//  informe de camiones con los datos de la OC 2056. Despues audita las
//  COORDENADAS del PDF que salio: que nada se salga de la hoja ni se monte
//  sobre el pie de pagina. Eso es lo que no se ve hasta que alguien imprime.
//
//  No usa navegador ni red. Deja el PDF generado al lado, para poder abrirlo.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;

// --- jsPDF ---------------------------------------------------------------
global.window = global;
global.navigator = { userAgent: 'node' };
global.document = {
  createElementNS: () => ({ getContext: () => null, style: {} }),
  createElement: () => ({ getContext: () => null, style: {}, setAttribute: () => {} })
};
// El bundle es UMD: en node se entrega por module.exports, no por window.
global.jspdf = require(path.join(RAIZ, 'vendor/jspdf.umd.min.js'));
if (!global.jspdf || !global.jspdf.jsPDF) { console.log('>>> no se pudo cargar jsPDF'); process.exit(1); }

// --- Helpers reales de app.js (se extraen por nombre, sin ejecutar el resto) ---
const app = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
function extraerFuncion(nombre) {
  const i = app.indexOf('function ' + nombre + '(');
  if (i === -1) throw new Error('no encontre ' + nombre);
  // El cuerpo arranca en la primera llave DESPUES de cerrar los parentesis de
  // los parametros: dibujarTablaConBordes tiene `opciones = {}` y la busqueda
  // ingenua cortaba ahi.
  let k = app.indexOf('(', i), parens = 0;
  for (; k < app.length; k++) {
    if (app[k] === '(') parens++;
    else if (app[k] === ')') { parens--; if (parens === 0) break; }
  }
  const inicioCuerpo = app.indexOf('{', k);
  let nivel = 0;
  for (let j = inicioCuerpo; j < app.length; j++) {
    if (app[j] === '{') nivel++;
    else if (app[j] === '}') { nivel--; if (nivel === 0) return app.slice(i, j + 1); }
  }
  throw new Error('no cerro ' + nombre);
}
// Un solo eval en el scope del modulo: dentro de un arrow las declaraciones
// quedarian encerradas ahi y el codigo bajo prueba no las veria.
eval(['formatNumeroAR', 'parseNumeroAR', 'pdfNuevaPaginaSiNoEntra', 'dibujarTablaConBordes', 'agregarPiePagina']
  .map(extraerFuncion).join(String.fromCharCode(10)));
global.alert = m => console.log('         [alert] ' + m);
const PDF_Y_LIMITE = 272;
const PDF_Y_INICIO_PAGINA = 22;
// Logo: un PNG 1x1 transparente, para no arrastrar los 100 KB del real.
const LOGO_BRAUN_BLANCO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// --- El codigo bajo prueba ----------------------------------------------
// Se corta en la seccion 7: el resto de orden-carga.js toca el DOM.
const oc = fs.readFileSync(path.join(RAIZ, 'orden-carga.js'), 'utf8');
const desde = oc.indexOf('// --- 8. EL PDF DE LA ORDEN');
if (desde === -1) { console.log('>>> no encontre la seccion del PDF'); process.exit(1); }
eval(oc.slice(oc.lastIndexOf('// ====', desde)));

// --- La OC 2056, tal como la devuelve el backend -------------------------
const OC = {
  Id_OC: 'OC-1', Nro_OC: '2056', Fecha: '2026-07-14',
  Contrato_Encabeza: 'CN26-063', Especie: 'Poroto Mung', Cosecha: '25-26',
  Titular_CP: 'Titular SA',
  Destinatario: 'Destinatario SA', Destinatario_CUIT: '30-00000000-0',
  Destino: 'Planta Destino SA', Destino_CUIT: '30-11111111-1',
  Destino_Planta: '12058', Destino_Direccion: 'Calle 10 N 1',
  Destino_Localidad: 'Localidad', Destino_Provincia: 'Buenos Aires',
  Flete_Intermediario: 'Transporte SRL', Flete_Intermediario_CUIT: '30-22222222-2',
  Flete_Pagador: 'Destinatario SA', Flete_Pagador_CUIT: '30-00000000-0',
  Objetivo_Kg: 75000, Total_Camiones: 2, Total_Bolsas: 3000, Total_Kg: 75000,
  Observaciones: 'Cargar con lona. Controlar precintos antes de salir.',
  Camiones: [
    { transportista: 'Transporte A', transportista_cuit: '30-33333333-3',
      chofer: 'Chofer A', chofer_cuil: '20-44444444-4',
      dominio_camion: 'AA000AA', dominio_acoplado: 'AB000AB', km: 1200, tarifa: 95000,
      CartasPorte: [
        { productor: 'Productor 1', contrato_com: 'CN26-081 B', ctg: '10000000001',
          peso_neto: 26695, observaciones: 'OC 2056 (1069 BLS)',
          Lotes: [
            { lote_brc: '4380', lote_planta: 'LT-556 A', tipo: 'PT', calibre: '3.5mm', bolsas: 737, kg_bolsa: 25, total_kg: 18425 },
            { lote_brc: '4450', lote_planta: 'LT-573', tipo: 'PT', calibre: '4mm', bolsas: 250, kg_bolsa: 25, total_kg: 6250 },
            { lote_brc: '4455', lote_planta: 'LT-578 R', tipo: 'PT', calibre: '3.5mm', bolsas: 82, kg_bolsa: 25, total_kg: 2050 }
          ] },
        { productor: 'Productor 2', contrato_com: 'CN26-081 C', ctg: '',
          peso_neto: 9785, observaciones: 'OC 2056 (391 BLS)',
          Lotes: [{ lote_brc: '4381', lote_planta: 'LT-556 B', tipo: 'PT', calibre: '3.5mm', bolsas: 391, kg_bolsa: 25, total_kg: 9775 }] }
      ] },
    { transportista: 'Transporte B', chofer: 'Chofer B', dominio_camion: 'BB000BB', dominio_acoplado: 'BC000BC',
      CartasPorte: [
        { productor: 'Productor 2', contrato_com: 'CN26-081 C', ctg: '10000000002', peso_neto: 14575,
          observaciones: 'OC 2056 (583 BLS)',
          Lotes: [
            { lote_brc: '4381', lote_planta: 'LT-556 B', tipo: 'PT', calibre: '3.5mm', bolsas: 336, kg_bolsa: 25, total_kg: 8400 },
            { lote_brc: '4450', lote_planta: 'LT-573', tipo: 'PT', calibre: '4mm', bolsas: 247, kg_bolsa: 25, total_kg: 6175 }
          ] },
        { productor: 'Productor 3', contrato_com: 'CN26-081 A', ctg: '', peso_neto: 23925,
          observaciones: 'OC 2056 (957 BLS)',
          Lotes: [
            { lote_brc: '4380', lote_planta: 'LT-556 A', tipo: 'PT', calibre: '3.5mm', bolsas: 645, kg_bolsa: 25, total_kg: 16125 },
            { lote_brc: '4381', lote_planta: 'LT-556 B', tipo: 'PT', calibre: '3.5mm', bolsas: 24, kg_bolsa: 25, total_kg: 600 },
            { lote_brc: '4450', lote_planta: 'LT-573', tipo: 'PT', calibre: '4mm', bolsas: 234, kg_bolsa: 25, total_kg: 5850 },
            { lote_brc: '4469', lote_planta: 'LT-604 R', tipo: 'PT', calibre: '3.5mm', bolsas: 54, kg_bolsa: 25, total_kg: 1350 }
          ] }
      ] }
  ]
};

let fallos = 0;
function chequear(nombre, cond, detalle) {
  if (!cond) fallos++;
  console.log((cond ? '  OK   ' : '  FALLA') + ' ' + nombre + (cond ? '' : '  -> ' + detalle));
}

// --- Se arma el PDF capturando el doc.save() -----------------------------
// save() en node intenta abrir el archivo en el navegador. Se envuelve el
// constructor para quedarse con el documento en vez de guardarlo.
let guardado = null, docFinal = null;
const JsPDFReal = jspdf.jsPDF;
global.jspdf = { jsPDF: function (opciones) {
  const d = new JsPDFReal(opciones);
  d.save = function (nombre) { guardado = nombre; docFinal = d; return d; };
  return d;
} };

console.log('\n--- PDF DE LA ORDEN 2056 ---');
try {
  ocGenerarPDF(OC);
} catch (e) {
  console.log('  EXCEPCION: ' + (e && e.stack ? e.stack : e));
  fallos++;
}

chequear('se genero y se guardo', !!guardado, 'no llamo a save()');
if (guardado) {
  chequear('el nombre del archivo lleva el N de orden', guardado === 'Orden_de_Carga_2056.pdf', guardado);
  const paginas = docFinal.internal.getNumberOfPages();
  chequear('tiene al menos 1 hoja', paginas >= 1, 'paginas=' + paginas);
  chequear('no se desbordo a decenas de hojas', paginas <= 5, 'paginas=' + paginas);
  console.log('         (son ' + paginas + ' hoja/s)');

  const salida = path.join(__dirname, 'orden_2056.pdf');
  fs.writeFileSync(salida, Buffer.from(docFinal.output('arraybuffer')));
  const bytes = fs.statSync(salida).size;
  chequear('el archivo tiene contenido', bytes > 3000, bytes + ' bytes');
  console.log('         guardado en ' + salida + ' (' + Math.round(bytes / 1024) + ' KB)');

  // El texto del PDF tiene que contener lo que la planta necesita leer
  const crudo = fs.readFileSync(salida, 'latin1');
  const textoPlano = docFinal.internal.pages.flat().join(' ');
  [['el numero de orden', '2056'], ['el contrato', 'CN26-063'],
   ['el dominio del camion 1', 'AA000AA'], ['el dominio del camion 2', 'BB000BB'],
   ['un lote de planta', 'LT-556'], ['el CTTO de una CP', 'CN26-081']]
    .forEach(([q, v]) => chequear('aparece ' + q + ' (' + v + ')', textoPlano.indexOf(v) !== -1, 'no esta en el PDF'));
}

// --- Bordes --------------------------------------------------------------
console.log('\n--- BORDES ---');
guardado = null;
try {
  ocGenerarPDF({ Id_OC: 'OC-9', Nro_OC: '2099', Fecha: '2026-07-15', Camiones: [] });
  chequear('una orden sin camiones no rompe', !!guardado, 'no genero nada');
} catch (e) { chequear('una orden sin camiones no rompe', false, String(e)); }

guardado = null;
try {
  const muchos = JSON.parse(JSON.stringify(OC));
  muchos.Camiones = [];
  for (let i = 0; i < 12; i++) muchos.Camiones.push(JSON.parse(JSON.stringify(OC.Camiones[1])));
  muchos.Total_Camiones = 12;
  ocGenerarPDF(muchos);
  const pg = docFinal.internal.getNumberOfPages();
  chequear('12 camiones cortan de hoja como corresponde', !!guardado && pg >= 3 && pg <= 20, 'paginas=' + pg);
  console.log('         (12 camiones -> ' + pg + ' hojas)');
} catch (e) { chequear('12 camiones no rompen', false, String(e)); }

console.log('\n' + (fallos === 0 ? '>>> TODO OK' : '>>> ' + fallos + ' FALLA(S)'));

// --- Auditoria de maqueta -------------------------------------------------
// Sin poder renderizar, se revisan las coordenadas del propio PDF: que ningun
// rectangulo ni ninguna linea de texto se salga de la hoja ni se monte sobre
// el pie de pagina. Es el error que no se ve hasta que alguien imprime.
console.log('\n--- MAQUETA (coordenadas del PDF) ---');
guardado = null;
ocGenerarPDF(OC);
const K = 72 / 25.4;                 // mm -> puntos
const ALTO = 297 * K, ANCHO = 210 * K;
const X_MIN = 10 * K, X_MAX = 200 * K;
let fueraX = [], fueraY = [], sobreElPie = [];
// El pie (linea roja + palabras) vive de 283 mm para abajo.
const Y_PIE = ALTO - 283 * K;

docFinal.internal.pages.forEach((pagina, nro) => {
  if (!pagina || !pagina.length) return;
  const stream = pagina.join('\n');
  // Rectangulos: "x y w h re"
  const res = [...stream.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)];
  res.forEach(m => {
    const x = +m[1], y = +m[2], w = +m[3], h = +m[4];
    // Las bandas de ancho completo (el banner rojo de la cabecera) son a
    // proposito: van de borde a borde, igual que en el reporte de carga.
    const anchoCompleto = w >= ANCHO - 1;
    if (!anchoCompleto && (x < X_MIN - 1 || x + w > X_MAX + 1)) {
      fueraX.push('hoja ' + nro + ' rect x=' + x.toFixed(0) + ' w=' + w.toFixed(0));
    }
    if (y < 0 || y + h > ALTO) fueraY.push('hoja ' + nro + ' rect y=' + y.toFixed(0));
    // El banner rojo de la cabecera arranca arriba de todo y es a proposito.
    if (h < 100 && y + h < Y_PIE - 1 && y > 0) sobreElPie.push('hoja ' + nro + ' rect pisa el pie (y=' + y.toFixed(0) + ')');
  });
  // Texto: "x y Td"
  const tds = [...stream.matchAll(/([-\d.]+) ([-\d.]+) Td/g)];
  tds.forEach(m => {
    const x = +m[1], y = +m[2];
    if (x < X_MIN - 1 || x > X_MAX + 1) fueraX.push('hoja ' + nro + ' texto x=' + x.toFixed(0));
    if (y < 0 || y > ALTO) fueraY.push('hoja ' + nro + ' texto y=' + y.toFixed(0));
  });
});

chequear('nada se sale por los costados', fueraX.length === 0, fueraX.slice(0, 4).join(' | '));
chequear('nada se sale por arriba o abajo', fueraY.length === 0, fueraY.slice(0, 4).join(' | '));
chequear('nada se monta sobre el pie de pagina', sobreElPie.length === 0, sobreElPie.slice(0, 4).join(' | '));
console.log('\n' + (fallos === 0 ? '>>> TODO OK' : '>>> ' + fallos + ' FALLA(S)'));
process.exit(fallos === 0 ? 0 : 1);
