// ============================================================================
//  PRUEBAS DEL CONTROL DE ACCESO Y DEL ESCAPE (AUDITORIA_2026-10-30.md, 1 a 4)
// ----------------------------------------------------------------------------
//  COMO SE CORRE:   node test_acceso.js     (desde esta carpeta)
//
//  Que se verifica:
//    1. Backend real (01 + 03 + 05 + 06): que en modo "registrar" (el de
//       publicar) NADA cambia para los celulares viejos; que en modo "exigir"
//       sin token no se lee ni se borra nada; que el login da un token que
//       sirve; que la primera contraseña ya no se define sin el código del
//       correo; que cambiar la clave corta las sesiones viejas; que el correo
//       por el backend tiene tope de destinatarios y deja constancia; que los
//       mails de la Ticketera escapan lo que escribe el usuario.
//    2. Frontend (app.js): que escapeHtml, argJs y urlSegura cierran el XSS sin
//       cambiar lo que se ve, y que enviarAlBackend manda el token y no pierde
//       nada cuando el servidor contesta "no autorizado".
//
//  NO toca el Sheet de verdad ni la red: todo pasa en memoria.
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

// --- Sheet falso (lo justo de SpreadsheetApp) ----------------------------
class Hoja {
  constructor(nombre) { this.nombre = nombre; this.filas = []; }
  appendRow(f) { this.filas.push(f.slice()); }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() {
    const h = this, ancho = this.getLastColumn();
    const todo = () => h.filas.map(r => { const c = r.slice(); while (c.length < ancho) c.push(''); return c; });
    return { getValues: todo, getDisplayValues: () => todo().map(r => r.map(v => v instanceof Date ? v.toISOString() : String(v))) };
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
    const mostrar = v => v instanceof Date ? v.toISOString() : String(v);
    return {
      getValues: celdas,
      getDisplayValues: () => celdas().map(r => r.map(mostrar)),
      getDisplayValue: () => mostrar(celdas()[0][0]),
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
let sheetRoto = false;   // simula que el Sheet no responde al validar
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: n => {
      if (sheetRoto && n === 'Sesiones') throw new Error('Servicio no disponible');
      return HOJAS[n] || null;
    },
    insertSheet: n => (HOJAS[n] = new Hoja(n))
  }),
  flush: () => { }
};

const firmados = b => Array.from(b).map(x => (x > 127 ? x - 256 : x));
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, texto) => firmados(crypto.createHash(alg).update(String(texto), 'utf8').digest()),
  getUuid: () => crypto.randomUUID(),
  formatDate: d => new Date(d).toISOString().slice(0, 16),
  base64Decode: b => Buffer.from(b, 'base64'),
  newBlob: (datos, tipo, nombre) => ({ datos, tipo, nombre })
};

let propiedades = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in propiedades ? propiedades[k] : null) }) };

let cache = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: k => (cache.has(k) ? cache.get(k) : null),
    put: (k, v) => { cache.set(k, String(v)); },
    remove: k => { cache.delete(k); }
  })
};

let correos = [];
global.MailApp = { sendEmail: (para, asunto, cuerpo, opciones) => correos.push({ para, asunto, cuerpo, opciones: opciones || {} }) };
global.Session = { getScriptTimeZone: () => 'UTC' };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) };
global.Logger = { log: () => { } };
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
};

// --- Cargar el backend real (como en Apps Script: todo en el mismo ámbito) -
eval(fs.readFileSync(path.join(RAIZ, '01_backend_principal.gs'), 'utf8'));
eval(fs.readFileSync(path.join(RAIZ, '03_auth.gs'), 'utf8'));
eval(fs.readFileSync(path.join(RAIZ, '05_orden_carga.gs'), 'utf8'));
eval(fs.readFileSync(path.join(RAIZ, '06_acceso.gs'), 'utf8'));

const post = obj => JSON.parse(doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
const get = params => JSON.parse(doGet({ parameter: params }).getContent());
const hash = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// Usuarios: Ana ya tiene clave propia (su "verificador" es "verif-ana");
// Beto todavía entra con la genérica.
function reiniciar() {
  Object.keys(HOJAS).forEach(k => delete HOJAS[k]);
  cache = new Map(); correos = []; propiedades = {}; sheetRoto = false;
  const u = HOJAS['Usuarios'] = new Hoja('Usuarios');
  u.appendRow(['nombre', 'email', 'salt', 'verificador_hash', 'reset_hash', 'reset_vence', 'reset_intentos', 'password_actualizada']);
  u.appendRow(['Ana Pérez', 'ana@braun.com', 'sal-ana', hash('verif-ana'), '', '', '', '']);
  u.appendRow(['Beto Gómez', 'beto@braun.com', '', '', '', '', '', '']);
  const o = HOJAS['Orden'] = new Hoja('Orden');
  o.appendRow(['Id_Carga', 'Fecha']);
  HOJAS['Producto'] = new Hoja('Producto'); HOJAS['Producto'].appendRow(['Id', 'Id_Carga']);
  HOJAS['Contrato Comercial'] = new Hoja('Contrato Comercial'); HOJAS['Contrato Comercial'].appendRow(['Id', 'Id_Carga']);
  // Una orden de carga ya guardada, para ver si alguien la puede borrar
  guardarOrdenCarga({ Id_OC: 'OC-1', Nro_OC: '2056', Destino: 'Planta Norte', Camiones: [] });
}
const filasSinToken = () => (HOJAS['Accesos_Sin_Token'] ? HOJAS['Accesos_Sin_Token'].filas.length - 1 : 0);
const login = () => post({ _accion: 'auth_login', email: 'ana@braun.com', verificador: 'verif-ana' });

// ---------------------------------------------------------------------------
console.log('\n--- 1. MODO "registrar" (el de publicar): nada cambia para nadie ---');
reiniciar();
let r = get({ action: 'read_oc' });
ok(Array.isArray(r) && r.length === 1, 'sin token, la lectura sigue devolviendo las órdenes');
ok(filasSinToken() === 1, 'y queda anotada en Accesos_Sin_Token');
get({ action: 'read_oc' });
ok(filasSinToken() === 1, 'el mismo acceso repetido no llena la hoja (una fila cada 15 min)');
r = post({ _accion: 'guardar_oc', Id_OC: 'OC-2', Nro_OC: '2057', usuario_registro: 'beto@braun.com', Camiones: [] });
ok(r.status === 'success', 'sin token, guardar sigue andando (los celulares viejos no se cortan)');
ok(HOJAS['Accesos_Sin_Token'].filas.some(f => f[1] === 'guardar_oc' && f[3] === 'beto@braun.com'),
  'se anota quién fue (el usuario que declara el pedido)');

console.log('\n--- 2. MODO "exigir": sin token no se lee ni se borra nada ---');
reiniciar();
propiedades.ACCESO_MODO = 'exigir';
r = get({ action: 'read_oc' });
ok(r.noAutorizado === true && !Array.isArray(r), 'leer órdenes sin token: rechazado');
r = get({});
ok(r.noAutorizado === true, 'leer el historial de cargas sin token: rechazado');
r = get({ action: 'read_usuarios' });
ok(r.noAutorizado === true, 'leer la lista de usuarios sin token: rechazado');
r = post({ _accion: 'eliminar_oc', Id_OC: 'OC-1' });
ok(r.noAutorizado === true, 'borrar una orden sin token: rechazado');
ok(HOJAS['Orden_Carga'].filas.length === 2, 'y la orden sigue en la hoja');
r = post({ _accion: 'eliminar_oc', Id_OC: 'OC-1', _token: 'inventado' });
ok(r.noAutorizado === true && HOJAS['Orden_Carga'].filas.length === 2, 'con un token inventado: rechazado igual');
r = post({ _accion: 'agregar_usuario', nombre: 'Intruso', email: 'x@mal.com' });
ok(r.noAutorizado === true && HOJAS['Usuarios'].filas.length === 3, 'agregarse como usuario sin token: rechazado');
r = post({ _accion: 'enviar_correo_reporte', Correo: 'victima@otro.com', Correo_Cuerpo_Html: '<a href="http://phish">Pagá acá</a>' });
ok(r.noAutorizado === true && correos.length === 0, 'mandar un correo desde la cuenta de Braun sin token: rechazado');
r = post({ _accion: 'agente_consulta', mensajes: [] });
ok(r.noAutorizado === true, 'usar la clave de Groq sin token: rechazado');
ok(filasSinToken() === 0, 'en "exigir" no se llena la hoja de accesos sin token');
r = get({ action: 'auth_perfil', email: 'ana@braun.com' });
ok(r.ok === true && r.salt === 'sal-ana', 'lo necesario para entrar (auth_perfil) sigue abierto');

console.log('\n--- 3. Login: el token que se recibe sirve ---');
r = login();
ok(r.ok === true && /^[0-9a-f]{64}$/.test(r.token), 'el login con clave propia devuelve un token de 64 caracteres');
const tokenAna = r.token;
ok(HOJAS['Sesiones'].filas.length === 2 && HOJAS['Sesiones'].filas[1][0] === hash(tokenAna),
  'en la hoja Sesiones queda el SHA-256 del token, nunca el token');
ok(!JSON.stringify(HOJAS['Sesiones'].filas).includes(tokenAna), 'el token en claro no está en ninguna celda');
r = get({ action: 'read_oc', _token: tokenAna });
ok(Array.isArray(r) && r.length === 1, 'con el token, la lectura anda');
r = post({ _accion: 'guardar_oc', _token: tokenAna, Id_OC: 'OC-3', Nro_OC: '2058', Camiones: [] });
ok(r.status === 'success', 'con el token, guardar anda');
ok(!JSON.stringify(HOJAS).includes(tokenAna), 'el _token del pedido no se escribió en ninguna hoja');
r = post({ _accion: 'auth_login', email: 'ana@braun.com', verificador: 'otra-cosa' });
ok(r.ok === false && !r.token, 'con la clave equivocada no hay token');
r = post({ _accion: 'auth_login', email: 'beto@braun.com', verificador: 'lo-que-sea' });
ok(r.ok === false && !r.token, 'quien no tiene clave propia no recibe token');

console.log('\n--- 4. La primera contraseña ya no se define sin el código del correo ---');
r = post({ _accion: 'auth_definir', email: 'beto@braun.com', salt: 'sal-mala', verificador: 'del-intruso' });
ok(r.ok === false && r.requiereCodigo === true, 'definir la clave de Beto sin probar nada: rechazado');
ok(HOJAS['Usuarios'].filas[2][3] === '', 'y su verificador sigue vacío');
r = post({ _accion: 'auth_reset_pedir', email: 'beto@braun.com' });
ok(r.ok === true && correos.length === 1 && correos[0].para === 'beto@braun.com', 'el código le llega a Beto, a su correo');
const codigo = (correos[0].asunto.match(/(\d{6})/) || [])[1];
r = post({ _accion: 'auth_reset_confirmar', email: 'beto@braun.com', codigo: codigo, salt: 'sal-beto', verificador: 'verif-beto' });
ok(r.ok === true && /^[0-9a-f]{64}$/.test(r.token), 'con el código, Beto crea su clave y recibe su token');
const tokenBeto = r.token;
ok(get({ action: 'read_oc', _token: r.token }).length >= 1, 'y ese token sirve');

console.log('\n--- 5. Cambiar la clave corta las sesiones viejas ---');
const tokenViejo = login().token;
r = post({ _accion: 'auth_definir', email: 'ana@braun.com', verificador_actual: 'verif-ana', salt: 'sal-2', verificador: 'verif-ana-2' });
ok(r.ok === true && r.token && r.token !== tokenViejo, 'cambio de clave con la actual: anda y da un token nuevo');
cache = new Map(); // pasa el rato que se recuerdan los tokens ya validados
ok(get({ action: 'read_oc', _token: tokenViejo }).noAutorizado === true, 'el token de antes del cambio ya no sirve');
ok(Array.isArray(get({ action: 'read_oc', _token: r.token })), 'el nuevo sí');
const tokenNuevo = r.token;
r = post({ _accion: 'auth_definir', email: 'ana@braun.com', verificador_actual: 'mal', salt: 's', verificador: 'v' });
ok(r.ok === false && !r.token, 'cambiar sin la clave actual correcta: rechazado');

console.log('\n--- 6. Un usuario quitado de la lista pierde el acceso ---');
ok(Array.isArray(get({ action: 'read_oc', _token: tokenBeto })), 'Beto tiene una sesión que anda');
post({ _accion: 'eliminar_usuario', _token: tokenNuevo, email: 'beto@braun.com' });
cache = new Map();
ok(get({ action: 'read_oc', _token: tokenBeto }).noAutorizado === true, 'quitado de la lista, su token ya no sirve aunque no haya vencido');

console.log('\n--- 7. El Sheet no responde al validar ---');
reiniciar();
const t7 = login().token;
cache = new Map();
sheetRoto = true;
propiedades.ACCESO_MODO = 'exigir';
r = get({ action: 'read_oc', _token: t7 });
ok(r.reintentar === true && !r.noAutorizado, 'en "exigir": pide reintentar, NO le cierra la sesión a nadie');
propiedades.ACCESO_MODO = '';
r = get({ action: 'read_oc', _token: t7 });
ok(Array.isArray(r), 'en "registrar": sigue andando como si nada');
sheetRoto = false;

console.log('\n--- 8. Modo "abierto" (emergencia) ---');
reiniciar();
propiedades.ACCESO_MODO = 'abierto';
ok(Array.isArray(get({ action: 'read_oc' })) && filasSinToken() === 0, 'no valida ni anota nada');

console.log('\n--- 9. Correo por el backend ---');
reiniciar();
const t9 = login().token;
const muchos = Array.from({ length: 16 }, (_, i) => 'd' + i + '@x.com').join(',');
r = post({ _accion: 'enviar_correo_reporte', _token: t9, Correo: muchos, Correo_Asunto: 'x', Id_Carga: 'A' });
ok(r.status === 'error' && correos.length === 0, 'más de 15 destinatarios: no sale');
r = post({ _accion: 'enviar_correo_reporte', _token: t9, Correo: 'planta@cliente.com', Correo_Cc: 'otro@cliente.com',
  Correo_Asunto: 'Reporte', Correo_Reply_To: 'desvio@malo.com', Id_Carga: 'B', usuario_registro: 'ana@braun.com' });
ok(r.status === 'success' && correos.length === 1, 'un envío normal sale');
ok(correos[0].opciones.replyTo === 'ana@braun.com', 'las respuestas van a quien lo mandó de verdad, no a lo que diga el pedido');
const reg = HOJAS['Correos_Enviados'].filas[1];
ok(reg[1] === 'ana@braun.com' && reg[2] === 'sí' && reg[3] === 'planta@cliente.com' && reg[4] === 'otro@cliente.com',
  'queda constancia en Correos_Enviados: quién, a quién, con copia');
r = post({ _accion: 'enviar_correo_reporte', Correo: 'planta@cliente.com', Correo_Asunto: 'Otro', Id_Carga: 'C',
  usuario_registro: 'beto@braun.com', Correo_Reply_To: 'beto@braun.com' });
ok(r.status === 'success' && correos[1].opciones.replyTo === 'beto@braun.com',
  'en "registrar", un celular viejo sin token sigue mandando como antes');
ok(HOJAS['Correos_Enviados'].filas[2][2] === 'no', 'y la constancia dice que no venía autenticado');

console.log('\n--- 10. Los mails de la Ticketera escapan lo que escribe el usuario ---');
reiniciar();
const t10 = login().token;
correos = [];
enviarMailTicket('ana@braun.com', 'Ticket', 'Nuevo ticket', 'Hola', {
  id_ticket: 'T-1', nombre_solicitante: '<a href="http://phish">Soporte</a>', correo_solicitante: 'x@y.com',
  responsable_asignado: 'Ana', prioridad: 'Alta', estado_ticket: 'Abierto',
  detalle_solicitud: '<form action="http://phish"><input name="clave"></form>', respuesta: '<script>x()</script>'
}, '', '');
const html = (correos[0] && correos[0].opciones.htmlBody) || '';
ok(html.includes('&lt;form') && !html.includes('<form'), 'el detalle con HTML llega como texto');
ok(html.includes('&lt;a href=') && !html.includes('<a href="http://phish"'), 'el nombre con un link falso llega como texto');
ok(!html.includes('<script>'), 'la respuesta no mete código');
ok(html.includes('Alta</span>'), 'la prioridad se sigue viendo con su etiqueta de color');
ok(t10.length === 64, '(sesión de prueba)');

// ---------------------------------------------------------------------------
//  FRONTEND
// ---------------------------------------------------------------------------
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
const appJs = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');

let tokenEnSesion = 'tok-123';
let avisos = 0;
let enviados = [];
let respuestaServidor = '{"status":"success"}';
const ctx = {
  console: { log() {}, warn() {}, error() {} }, JSON, Object, String, Promise, Error, encodeURIComponent,
  WEB_APP_URL: 'https://script.google.com/macros/s/FALSO/exec',
  tokenSesionActual: () => tokenEnSesion,
  avisarSesionNoAutorizada: () => { avisos++; },
  fetch: (url, opts) => {
    enviados.push({ url, opts, cuerpo: opts && opts.body ? JSON.parse(opts.body) : null });
    if (opts && opts.mode === 'no-cors') return Promise.resolve({ type: 'opaque' });
    return Promise.resolve({ text: () => Promise.resolve(respuestaServidor) });
  }
};
vm.createContext(ctx);
vm.runInContext(['escapeHtml', 'argJs', 'urlSegura', 'enviarAlBackend', 'urlBackend']
  .map(n => extraerFuncion(appJs, n)).join('\n'), ctx);

(async () => {
  console.log('\n--- 11. escapeHtml / argJs / urlSegura ---');
  ok(ctx.escapeHtml('Planta "Norte" <b>') === 'Planta &quot;Norte&quot; &lt;b&gt;', 'escapeHtml escapa < > y comillas');
  ok(ctx.escapeHtml("O'Higgins") === 'O&#39;Higgins', 'y la comilla simple');
  ok(ctx.escapeHtml('Garbanzo 7mm') === 'Garbanzo 7mm', 'un dato normal queda igual');
  ok(ctx.escapeHtml(0) === '' && ctx.escapeHtml(null) === '', 'un 0 o null siguen dando "" (como siempre)');

  // Lo que hace el navegador con onclick="...": decodifica las entidades y
  // corre el código. El dato tiene que llegar intacto, sin escaparse del string.
  const decodificar = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const malos = ["OC-1", "x');alert(1);('", 'x");alert(1);("', '\\\');alert(1)//', '</script><img src=x onerror=alert(1)>', "a&#39;b"];
  malos.forEach(dato => {
    const html = `<button onclick="f(${ctx.argJs(dato)})">`;
    const atributo = html.match(/onclick="([^"]*)"/)[1];   // el atributo no se rompió
    let recibido;
    new Function('f', decodificar(atributo))(x => { recibido = x; });
    ok(recibido === dato, 'argJs: ' + JSON.stringify(dato).slice(0, 40) + ' llega tal cual y no corre nada');
  });

  ok(ctx.urlSegura('https://lh3.googleusercontent.com/d/abc') === 'https://lh3.googleusercontent.com/d/abc', 'urlSegura: una URL de Drive pasa igual');
  ok(ctx.urlSegura('data:image/jpeg;base64,AAA') === 'data:image/jpeg;base64,AAA', 'una foto en base64 pasa');
  ok(ctx.urlSegura('data:application/pdf;base64,AAA') !== '', 'un PDF recién elegido pasa');
  ok(ctx.urlSegura('Contrato Comercial_Files_/cp.pdf') !== '', 'una ruta vieja de AppSheet pasa');
  ok(ctx.urlSegura('javascript:alert(1)') === '', 'javascript: no pasa');
  ok(ctx.urlSegura(' JavaScript:alert(1)') === '', 'ni con mayúsculas o espacios');
  ok(ctx.urlSegura('data:text/html,<script>') === '', 'data:text/html no pasa');
  ok(ctx.urlSegura('data:image/svg+xml,<svg onload=x>') === '', 'un SVG (que puede correr código) no pasa');
  ok(ctx.urlSegura('https://x.com/a"onerror="b') === 'https://x.com/a&quot;onerror=&quot;b', 'una comilla no rompe el atributo');

  console.log('\n--- 12. enviarAlBackend y las lecturas llevan el token ---');
  enviados = [];
  await ctx.enviarAlBackend({ _accion: 'guardar_oc', Id_OC: 'OC-9' });
  ok(enviados[0].cuerpo._token === 'tok-123' && enviados[0].cuerpo.Id_OC === 'OC-9', 'el POST lleva _token y los datos intactos');
  const original = { _accion: 'guardar', Id_Carga: 'A' };
  await ctx.enviarAlBackend(original);
  ok(!('_token' in original), 'no ensucia el registro de la cola (el token se agrega al mandar)');
  ok(ctx.urlBackend('read_oc') === 'https://script.google.com/macros/s/FALSO/exec?action=read_oc&_token=tok-123', 'urlBackend arma la lectura con el token');
  ok(ctx.urlBackend('read_calidad', '_=1') .endsWith('&_=1'), 'y conserva los parámetros extra');
  tokenEnSesion = '';
  ok(ctx.urlBackend('read') === 'https://script.google.com/macros/s/FALSO/exec?action=read', 'sin token (sesión vieja) la URL es la de siempre');
  tokenEnSesion = 'tok-123';

  console.log('\n--- 13. "No autorizado" no pierde nada ---');
  enviados = []; avisos = 0;
  respuestaServidor = '{"status":"error","ok":false,"noAutorizado":true,"message":"Tu sesión no está habilitada"}';
  let error = null;
  try { await ctx.enviarAlBackend({ _accion: 'guardar', Id_Carga: 'B' }); } catch (e) { error = e; }
  ok(error && error.noAutorizado === true, 'se rechaza con noAutorizado');
  ok(error && !error.rechazadoPorBackend, 'y NO como error del dato: la cola no gasta intentos ni lo manda a revisión');
  ok(enviados.length === 1, 'no se reintenta a ciegas con no-cors');
  ok(avisos === 1, 'se le avisa a la persona que vuelva a entrar');
  respuestaServidor = '{"status":"error","ok":false,"reintentar":true}';
  const rr = await ctx.enviarAlBackend({ _accion: 'guardar', Id_Carga: 'C' });
  ok(rr.sinConfirmar === true && rr.confirmado === false, '"reintentar" queda como sin confirmar: la cola lo vuelve a mandar');

  console.log(fallos ? `\n>>> ${fallos} FALLA(S)` : '\n>>> TODO OK');
  process.exit(fallos ? 1 : 0);
})();
