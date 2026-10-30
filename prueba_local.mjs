// ============================================================================
//  PROBAR LA APP EN LA COMPU, SIN TOCAR PRODUCCIÓN
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node prueba_local.mjs        (desde esta carpeta)
//  y se abre        http://localhost:8080
//
//  Levanta la app tal como está en esta carpeta (con los cambios sin publicar)
//  y le pone adelante un BACKEND SIMULADO: nada sale al Apps Script ni al
//  Sheet. Lo que se guarda (órdenes de carga y controles de transporte) queda
//  en el navegador, así que sobrevive a recargar la página.
//
//  - Arranca con la sesión de Santiago iniciada (no pide contraseña).
//  - Trae de ejemplo la OC 2056 con dos camiones, y el camión 1 ya controlado.
//  - Para volver a empezar de cero: http://localhost:8080/?reiniciar
//  - Arriba se ve una franja amarilla "MODO PRUEBA": si no está, NO es esto.
//
//  Lo que no se simula: Calidad, Producción, Ticketera, correo y agente
//  devuelven listas vacías u "ok". Sirve para Orden de Carga y Transporte.
//  NO es parte de la app: no va en el service worker ni lo carga index.html.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO) || 8080;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};

// Corre en el navegador ANTES que la app.
const BACKEND_SIMULADO = String.raw`
(function () {
  var CLAVE = '__prueba_backend';
  if (location.search.indexOf('reiniciar') !== -1) {
    localStorage.clear();
    indexedDB.deleteDatabase && ['BraunDB', 'braun_db', 'AppBraunDB'].forEach(function (n) { try { indexedDB.deleteDatabase(n); } catch (e) {} });
    if (indexedDB.databases) indexedDB.databases().then(function (l) { l.forEach(function (d) { indexedDB.deleteDatabase(d.name); }); });
    history.replaceState(null, '', '/');
  }

  // Sesión iniciada: se entra directo.
  if (!localStorage.getItem('braun_sesion_v1')) {
    localStorage.setItem('braun_sesion_v1', JSON.stringify({
      email: 'santiago.torres@braunrelacionescomerciales.com.ar', nombre: 'Santiago Torres', loginAt: new Date().toISOString()
    }));
  }
  // Sin service worker: en localhost dejaría la app vieja guardada entre pruebas.
  try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (e) {}

  function inicial() {
    var lote = function (brc, planta, bolsas, cal) { return { lote_brc: brc, lote_planta: planta, tipo: 'PT', bolsas: bolsas, kg_bolsa: 25, total_kg: bolsas * 25, calibre: cal }; };
    return {
      ordenes: [{
        Id_OC: 'OC-PRUEBA-2056', Nro_OC: 2056, Fecha: '2026-10-30', Destino: 'CAP. CORTES',
        Titular_CP: 'TITULAR DE PRUEBA', Total_Camiones: 2, Total_Bolsas: 3000, Total_Kg: 75000, Estado: 'Generada',
        Camiones: [
          { Id_Camion: 'CAM-PRUEBA-1', especie: 'Poroto Mung', cosecha: '25-26', transportista: 'Transporte A', chofer: 'Chofer A',
            dominio_camion: 'AA000AA', dominio_acoplado: 'AC000AA', flete: 'No', flete_pagador: 'Pagador SA',
            CartasPorte: [
              { productor: 'PRODUCTOR B', contrato_com: 'CN26-081 B', peso_neto: 26695, observaciones: 'OC 2056 (1069 BLS)',
                Lotes: [lote('4380', 'LT-556 A', 737, '3.5mm'), lote('4450', 'LT-573', 250, '4mm'), lote('4455', 'LT-578 R', 82, '3.5mm')] },
              { productor: 'PRODUCTOR C', contrato_com: 'CN26-081 C', peso_neto: 9785, observaciones: 'OC 2056 (391 BLS)',
                Lotes: [lote('4381', 'LT-556 B', 391, '3.5mm')] }] },
          { Id_Camion: 'CAM-PRUEBA-2', especie: 'Poroto Mung', cosecha: '25-26', transportista: 'Transporte B', chofer: 'Chofer B',
            dominio_camion: 'BB000BB', dominio_acoplado: 'BC000BB', flete: 'No', flete_pagador: 'Pagador SA',
            CartasPorte: [
              { productor: 'PRODUCTOR C', contrato_com: 'CN26-081 C', peso_neto: 14575, observaciones: 'OC 2056 (583 BLS)',
                Lotes: [lote('4381', 'LT-556 B', 336, '3.5mm'), lote('4450', 'LT-573', 247, '4mm')] },
              { productor: 'PRODUCTOR A', contrato_com: 'CN26-081 A', peso_neto: 23925, observaciones: 'OC 2056 (957 BLS)',
                Lotes: [lote('4380', 'LT-556 A', 645, '3.5mm'), lote('4469', 'LT-604 R', 312, '3.5mm')] }] }
        ]
      }],
      cargas: [{
        Id_Carga: 'BC-PRUEBA-1', Fecha: '2026-10-30', Tipo_Carga: 'PT', Nombre_Chofer: 'Chofer A', Patente_Chasis: 'AA000AA',
        Patente_Acoplado: 'AC000AA', ESTATUS: 'ACEPTADO', Kg_Cargados: 36475, Elaboro: 'Lucas Ramis',
        Id_OC: 'OC-PRUEBA-2056', Nro_OC: 2056, Id_Camion_OC: 'CAM-PRUEBA-1', Nro_Camion_OC: 1,
        Productos: [{ producto: 'Poroto Mung', calibre: '3.5mm', tipo: 'PT', lote: '4380', posicion: 'LT-556 A', envase: 'Bolsas', cantidad: 737, kg_envase: 25, total_kg: 18425 }],
        Contratos: [{ contrato_com: 'CN26-081 B', destino: 'CAP. CORTES', kg_cp: 26700, kg_descarga: 0, diferencia_carga: '0' }]
      }]
    };
  }
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE)) || inicial(); } catch (e) { return inicial(); } }
  function guardar(e) { localStorage.setItem(CLAVE, JSON.stringify(e)); }
  // Las fotos y firmas no se guardan: no entrarían en el navegador.
  function sinAdjuntos(r) {
    var c = JSON.parse(JSON.stringify(r));
    Object.keys(c).forEach(function (k) { if (typeof c[k] === 'string' && c[k].indexOf('data:') === 0) c[k] = ''; });
    delete c._accion; delete c.id;
    return c;
  }
  if (!localStorage.getItem(CLAVE)) guardar(inicial());

  function responder(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  var fetchReal = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url && url.url || url);
    if (u.indexOf('script.google.com') === -1) return fetchReal(url, opts);
    var e = leer();

    if (opts && opts.method === 'POST') {
      var d = {}; try { d = JSON.parse(opts.body); } catch (err) {}
      var accion = d._accion || 'guardar';
      console.log('%c[backend simulado] ' + accion, 'color:#b8860b', d.Id_Carga || d.Id_OC || '');
      if (accion === 'guardar' || accion === 'actualizar' || accion === 'enviar_correo') {
        e.cargas = e.cargas.filter(function (c) { return c.Id_Carga !== d.Id_Carga; });
        e.cargas.unshift(sinAdjuntos(d));
      } else if (accion === 'eliminar') {
        e.cargas = e.cargas.filter(function (c) { return c.Id_Carga !== d.Id_Carga; });
      } else if (accion === 'guardar_oc' || accion === 'actualizar_oc') {
        e.ordenes = e.ordenes.filter(function (o) { return o.Id_OC !== d.Id_OC; });
        var o = sinAdjuntos(d);
        // Como el backend real: un camión sin clave recibe una
        (o.Camiones || []).forEach(function (c, i) { if (!c.Id_Camion) c.Id_Camion = 'uuid-' + Date.now() + '-' + i; });
        e.ordenes.unshift(o);
      } else if (accion === 'eliminar_oc') {
        e.ordenes = e.ordenes.filter(function (o) { return o.Id_OC !== d.Id_OC; });
      }
      guardar(e);
      return responder({ status: 'success', ok: true });
    }

    if (u.indexOf('action=read_oc') !== -1) return responder(e.ordenes);
    if (/action=read(&|$)/.test(u)) return responder(e.cargas);
    return responder([]);
  };

  // Que nunca se confunda con producción.
  document.addEventListener('DOMContentLoaded', function () {
    var f = document.createElement('div');
    f.textContent = 'MODO PRUEBA — backend simulado, nada llega al Sheet  ·  empezar de cero: /?reiniciar';
    f.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#ffd54f;color:#3e2723;' +
      'font:600 12px system-ui,sans-serif;text-align:center;padding:4px 8px;pointer-events:none';
    document.body.appendChild(f);
  });
})();
`;

http.createServer((req, res) => {
  const ruta = decodeURIComponent(req.url.split('?')[0]);
  if (ruta === '/__backend_simulado.js') {
    res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-store' });
    res.end(BACKEND_SIMULADO);
    return;
  }
  const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ)) { res.writeHead(403); res.end(); return; }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404); res.end('No existe: ' + ruta); return; }
    let cuerpo = datos;
    // El backend simulado va primero que todo lo demás.
    if (path.basename(archivo) === 'index.html') {
      cuerpo = String(datos).replace('<head>', '<head>\n    <script src="/__backend_simulado.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  });
}).listen(PUERTO, () => {
  console.log('\n  App Braun en MODO PRUEBA (backend simulado, nada llega al Sheet)');
  console.log('  → http://localhost:' + PUERTO);
  console.log('  → para empezar de cero: http://localhost:' + PUERTO + '/?reiniciar');
  console.log('  (Ctrl+C para cortar)\n');
});
