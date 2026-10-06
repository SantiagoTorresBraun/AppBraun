// ============================================================================
//  PRUEBAS DE LAS SUGERENCIAS DE LA ORDEN DE CARGA  (seccion 7 de orden-carga.js)
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_orden_carga_sugerencias.js    (desde esta carpeta)
//
//  Que se verifica: que las listas se armen con lo ya cargado, que al elegir un
//  dato se completen los que van con el (CUIT, acoplado, lote de planta) y
//  -lo mas importante- que NUNCA se pise lo que el usuario ya escribio.
//
//  Simula lo justo del DOM: no usa navegador ni red.
// ============================================================================
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;

// --- DOM minimo ----------------------------------------------------------
class Elemento {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.atributos = attrs;
    this.value = attrs.value || '';
    this.dataset = {};
    this.hijos = [];
    this.innerHTML = '';
    this.id = attrs.id || '';
    if (attrs['data-field']) this.dataset.field = attrs['data-field'];
    if (attrs['data-enum']) this.dataset.enum = attrs['data-enum'];
  }
  getAttribute(n) { return this.atributos[n] !== undefined ? this.atributos[n] : null; }
  agregar(hijo) { hijo.padre = this; this.hijos.push(hijo); return hijo; }
  todos() { return this.hijos.reduce((a, h) => a.concat([h], h.todos()), []); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    // Solo se usa ':scope > .dynamic-card-body [data-field="X"]'
    const m = sel.match(/data-field="([^"]+)"/);
    if (!m) return [];
    return this.todos().filter(e => e.dataset.field === m[1]);
  }
  closest(sel) {
    const clase = sel.replace('.', '');
    let n = this;
    while (n) { if ((n.atributos.class || '').split(' ').indexOf(clase) !== -1) return n; n = n.padre; }
    return null;
  }
}

const porId = {};
global.document = {
  getElementById: id => porId[id] || null,
  querySelectorAll: () => []
};
global.poblarSelect = (sel, _enumKey, valor) => { sel.value = valor; };
global.ocRecalcularTodo = () => {};
global.ocHistorialRemoto = [];

// --- El codigo bajo prueba ----------------------------------------------
const oc = fs.readFileSync(path.join(RAIZ, 'orden-carga.js'), 'utf8');
const ini = oc.indexOf('// --- 7. SUGERENCIAS');
const fin = oc.indexOf('// --- 8. EL PDF DE LA ORDEN');
if (ini === -1 || fin === -1) { console.log('>>> no encontre la seccion de sugerencias'); process.exit(1); }
eval(oc.slice(oc.lastIndexOf('// ====', ini), oc.lastIndexOf('// ====', fin)));

// --- Las listas y los campos de la cabecera ------------------------------
['oc-lista-contratos-fm', 'oc-lista-cosechas', 'oc-lista-destinatarios', 'oc-lista-destinos',
 'oc-lista-titulares', 'oc-lista-fletes', 'oc-lista-transportistas', 'oc-lista-choferes',
 'oc-lista-dominios', 'oc-lista-acoplados', 'oc-lista-productores', 'oc-lista-contratos-com',
 'oc-lista-lotes-brc', 'oc-lista-lotes-planta']
  .forEach(id => { porId[id] = new Elemento('datalist', { id }); });

function campoCabecera(id, lista) {
  const el = new Elemento('input', Object.assign({ id }, lista ? { list: lista } : {}));
  porId[id] = el;
  return el;
}
const destino = campoCabecera('oc-destino', 'oc-lista-destinos');
campoCabecera('oc-destino-cuit'); campoCabecera('oc-destino-planta');
campoCabecera('oc-destino-direccion'); campoCabecera('oc-destino-localidad');
campoCabecera('oc-destino-provincia');
const fleteInt = campoCabecera('oc-flete-intermediario', 'oc-lista-fletes');
campoCabecera('oc-flete-intermediario-cuit');
const fletePag = campoCabecera('oc-flete-pagador', 'oc-lista-fletes');
campoCabecera('oc-flete-pagador-cuit');

// --- Dos ordenes ya cargadas --------------------------------------------
const ORDENES = [
  { Nro_OC: '2056', Contrato_Encabeza: 'CN26-063', Cosecha: '25-26', Titular_CP: 'Titular SA',
    Destino: 'Planta Norte', Destino_CUIT: '30-11111111-1', Destino_Planta: '12058',
    Destino_Direccion: 'Calle 10 N 1', Destino_Localidad: 'Tapiales', Destino_Provincia: 'Buenos Aires',
    Flete_Intermediario: 'Fletes SRL', Flete_Intermediario_CUIT: '30-22222222-2',
    Camiones: [
      { transportista: 'Transporte A', transportista_cuit: '30-33333333-3',
        chofer: 'Chofer A', chofer_cuil: '20-44444444-4',
        dominio_camion: 'AA000AA', dominio_acoplado: 'AB000AB',
        CartasPorte: [{ productor: 'Productor 1', contrato_com: 'CN26-081 B',
          Lotes: [{ lote_brc: '4380', lote_planta: 'LT-556 A', tipo: 'PT', calibre: '3.5mm', kg_bolsa: 25 }] }] }
    ] },
  // Mas nueva: al chofer A le cambio el acoplado. Tiene que ganar esta.
  { Nro_OC: '2057', Contrato_Encabeza: 'CN26-070', Cosecha: '25-26',
    Destino: 'Planta Sur', Destino_CUIT: '30-55555555-5',
    Camiones: [
      { transportista: 'Transporte A', transportista_cuit: '30-33333333-3',
        chofer: 'Chofer A', chofer_cuil: '20-44444444-4',
        dominio_camion: 'AA000AA', dominio_acoplado: 'ZZ999ZZ',
        CartasPorte: [{ productor: 'Productor 2', contrato_com: 'CN26-081 C', Lotes: [] }] }
    ] }
];
// ocConstruirMaestros espera las remotas de la mas nueva a la mas vieja.
global.ocHistorialRemoto = ORDENES.slice().reverse();

let fallos = 0;
function chequear(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? '  OK   ' : '  FALLA') + ' ' + nombre + (ok ? '' : '  -> esperaba ' + JSON.stringify(esperado) + ', vino ' + JSON.stringify(real)));
}
const opciones = id => (porId[id].innerHTML.match(/value="([^"]*)"/g) || [])
  .map(v => v.slice(7, -1));

console.log('\n--- 1. LAS LISTAS SE ARMAN SOLAS ---');
ocConstruirMaestros([]);
chequear('destinos', opciones('oc-lista-destinos'), ['Planta Norte', 'Planta Sur']);
chequear('transportistas (sin repetir)', opciones('oc-lista-transportistas'), ['Transporte A']);
chequear('choferes', opciones('oc-lista-choferes'), ['Chofer A']);
chequear('dominios', opciones('oc-lista-dominios'), ['AA000AA']);
chequear('productores', opciones('oc-lista-productores'), ['Productor 1', 'Productor 2']);
chequear('contratos comerciales', opciones('oc-lista-contratos-com'), ['CN26-081 B', 'CN26-081 C']);
chequear('lotes BRC', opciones('oc-lista-lotes-brc'), ['4380']);
chequear('cosechas (sin repetir)', opciones('oc-lista-cosechas'), ['25-26']);

console.log('\n--- 2. LA CABECERA SE COMPLETA SOLA ---');
destino.value = 'Planta Norte';
ocAutocompletarCabecera(destino);
chequear('CUIT del destino', porId['oc-destino-cuit'].value, '30-11111111-1');
chequear('N de planta', porId['oc-destino-planta'].value, '12058');
chequear('localidad', porId['oc-destino-localidad'].value, 'Tapiales');

console.log('\n--- 3. NO SE PISA LO ESCRITO A MANO ---');
porId['oc-destino-cuit'].value = '30-99999999-9';   // corregido a mano
destino.value = 'Planta Sur';
ocAutocompletarCabecera(destino);
chequear('el CUIT escrito a mano se respeta', porId['oc-destino-cuit'].value, '30-99999999-9');
porId['oc-destino-cuit'].value = '';
ocAutocompletarCabecera(destino);
chequear('vacio si se completa con el nuevo', porId['oc-destino-cuit'].value, '30-55555555-5');

console.log('\n--- 4. LOS DOS FLETES COMPARTEN LISTA PERO NO CAMPO ---');
fleteInt.value = 'Fletes SRL';
ocAutocompletarCabecera(fleteInt);
chequear('el intermediario completa SU cuit', porId['oc-flete-intermediario-cuit'].value, '30-22222222-2');
chequear('el del pagador queda vacio', porId['oc-flete-pagador-cuit'].value, '');
fletePag.value = 'Fletes SRL';
ocAutocompletarCabecera(fletePag);
chequear('el pagador completa el suyo', porId['oc-flete-pagador-cuit'].value, '30-22222222-2');

console.log('\n--- 5. EL DOMINIO TRAE TODO EL CAMION ---');
const tarjeta = new Elemento('div', { class: 'dynamic-item-card' });
const cuerpo = tarjeta.agregar(new Elemento('div', { class: 'dynamic-card-body' }));
const dom = cuerpo.agregar(new Elemento('input', { 'data-field': 'dominio_camion', list: 'oc-lista-dominios' }));
const acop = cuerpo.agregar(new Elemento('input', { 'data-field': 'dominio_acoplado' }));
const transp = cuerpo.agregar(new Elemento('input', { 'data-field': 'transportista' }));
const tcuit = cuerpo.agregar(new Elemento('input', { 'data-field': 'transportista_cuit' }));
const chof = cuerpo.agregar(new Elemento('input', { 'data-field': 'chofer' }));
const ccuil = cuerpo.agregar(new Elemento('input', { 'data-field': 'chofer_cuil' }));

dom.value = 'AA000AA';
ocAutocompletarTarjeta(dom);
chequear('acoplado (gana la orden mas nueva)', acop.value, 'ZZ999ZZ');
chequear('transportista', transp.value, 'Transporte A');
chequear('CUIT del transportista', tcuit.value, '30-33333333-3');
chequear('chofer', chof.value, 'Chofer A');
chequear('CUIL del chofer', ccuil.value, '20-44444444-4');

console.log('\n--- 6. EL LOTE BRC TRAE SU LOTE DE PLANTA ---');
const tLote = new Elemento('div', { class: 'dynamic-item-card' });
const cLote = tLote.agregar(new Elemento('div', { class: 'dynamic-card-body' }));
const brc = cLote.agregar(new Elemento('input', { 'data-field': 'lote_brc', list: 'oc-lista-lotes-brc' }));
const planta = cLote.agregar(new Elemento('input', { 'data-field': 'lote_planta' }));
const calibre = cLote.agregar(new Elemento('select', { 'data-field': 'calibre', 'data-enum': 'calibre' }));
const kgBolsa = cLote.agregar(new Elemento('input', { 'data-field': 'kg_bolsa' }));

brc.value = '4380';
ocAutocompletarTarjeta(brc);
chequear('lote de planta', planta.value, 'LT-556 A');
chequear('calibre (es un select)', calibre.value, '3.5mm');
chequear('kg por bolsa', kgBolsa.value, 25);

console.log('\n--- 7. BORDES ---');
const desconocido = new Elemento('input', { 'data-field': 'dominio_camion', list: 'oc-lista-dominios' });
cuerpo.agregar(desconocido);
desconocido.value = 'XX111XX';
ocAutocompletarTarjeta(desconocido);
chequear('un dominio nuevo no rompe ni borra nada', transp.value, 'Transporte A');
ocConstruirMaestros([]);
chequear('sin ordenes pendientes sigue andando', opciones('oc-lista-dominios'), ['AA000AA']);
global.ocHistorialRemoto = [];
ocConstruirMaestros([]);
chequear('sin ninguna orden las listas quedan vacias', opciones('oc-lista-dominios'), []);

console.log('\n' + (fallos === 0 ? '>>> TODO OK' : '>>> ' + fallos + ' FALLA(S)'));
process.exit(fallos === 0 ? 0 : 1);
