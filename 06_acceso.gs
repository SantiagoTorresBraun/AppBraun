// ============================================================================
//  CONTROL DE ACCESO — quién puede leer y escribir en el backend
// ----------------------------------------------------------------------------
//  Hallazgo 1 de AUDITORIA_2026-10-30.md (y de la del 28/08): hasta acá
//  doPost y doGet ejecutaban cualquier acción sin preguntar quién llamaba, y la
//  URL del Web App está en un repo público.
//
//  CÓMO FUNCIONA
//    1. Al entrar con su contraseña personal (auth_login), el backend le da al
//       navegador un TOKEN DE SESIÓN: 64 caracteres al azar.
//    2. El navegador lo manda en cada pedido (_token en el cuerpo del POST, o
//       en la URL de los GET).
//    3. Acá se busca SHA-256(token) en la hoja "Sesiones". En la hoja nunca
//       está el token en sí: quien la lea no obtiene nada que pueda reenviar.
//
//  El token dura SESION_DIAS. Es largo a propósito: la cola offline puede
//  mandar un control días después de cargado, y no puede rebotar por eso.
//
//  TRES MODOS, en la propiedad del script ACCESO_MODO
//  (Configuración del proyecto ▸ Propiedades del script):
//
//    "registrar"  (el de por defecto, si la propiedad no existe)
//                 Valida el token pero NO rechaza a nadie. Lo que llega sin
//                 token válido se anota en la hoja "Accesos_Sin_Token".
//                 Sirve para publicar esto sin cortarle la app a nadie: los
//                 celulares con la versión vieja en caché siguen andando.
//    "exigir"     Lo que llega sin token válido se rechaza.
//    "abierto"    No se valida nada (como antes). Solo para emergencias.
//
//  CUÁNDO PASAR A "exigir": cuando "Accesos_Sin_Token" deje de recibir filas
//  nuevas durante algunos días. Eso quiere decir que todos los celulares
//  tienen la versión nueva y que todos los usuarios tienen contraseña propia
//  (con la genérica no se recibe token). diagnosticoAuth() en 03_auth.gs dice
//  quién falta.
// ============================================================================

var HOJA_SESIONES = "Sesiones";
var COLS_SESIONES = ["token_hash", "email", "creada", "vence"];
var HOJA_ACCESOS_SIN_TOKEN = "Accesos_Sin_Token";
var COLS_ACCESOS_SIN_TOKEN = ["fecha", "accion", "motivo", "usuario_declarado"];

var SESION_DIAS = 30;
var SESION_CACHE_SEG = 600;   // cuánto se recuerda un token ya validado

// Lo que tiene que andar SIN sesión: todo lo que hace falta para iniciarla.
// Cada una de estas tiene su propio control adentro (ver 03_auth.gs).
var ACCIONES_PUBLICAS = {
  auth_perfil: true,
  auth_login: true,
  auth_definir: true,
  auth_reset_pedir: true,
  auth_reset_confirmar: true
};

// Lo que pide token AUNQUE el modo sea "registrar". Ningún celular depende de
// esto para trabajar en el día a día, y abierto deja hacer daño de verdad:
// agregarse como usuario era el primer paso para quedarse con una cuenta que
// sobrevive al paso a "exigir" (SEC-01 de la segunda auditoría del 30/10), y
// agente_consulta gasta la clave de Groq. En "abierto" tampoco se pide.
var ACCIONES_SIEMPRE_CON_TOKEN = {
  agregar_usuario: true,
  eliminar_usuario: true,
  agente_consulta: true,
  // Manda correos a destinatarios de afuera desde la cuenta de Braun: sin
  // token era un relay abierto para cualquiera con la URL (hallazgo 2). Es el
  // plan B de correo.js (el normal sale del Gmail del usuario), así que nadie
  // depende de él sin sesión.
  enviar_correo_reporte: true
};

// ---------------------------------------------------------------------------
// QUÉ CORREOS PUEDEN SER USUARIOS
// ---------------------------------------------------------------------------
// El código de recuperación prueba que alguien controla ESE correo, no que
// trabaja en Braun. Sin este filtro, cualquiera se agregaba con su Gmail, se
// mandaba el código a sí mismo y tenía una sesión válida.
//
// Propiedades del script (opcionales):
//   DOMINIOS_PERMITIDOS  → separados por coma. Si no existe, solo el de Braun.
//   CORREOS_PERMITIDOS   → excepciones puntuales de otros dominios (un
//                          contador, un fletero), separadas por coma.
var DOMINIO_PERMITIDO_POR_DEFECTO = "braunrelacionescomerciales.com.ar";

function listaDePropiedad(nombre) {
  var valor = "";
  try { valor = PropertiesService.getScriptProperties().getProperty(nombre) || ""; }
  catch (err) { Logger.log("No se pudo leer " + nombre + ": " + err); }
  return String(valor).split(",")
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(function (x) { return x; });
}

function emailPermitido(email) {
  email = String(email || "").trim().toLowerCase();
  var arroba = email.lastIndexOf("@");
  if (arroba < 1) return false;
  if (listaDePropiedad("CORREOS_PERMITIDOS").indexOf(email) !== -1) return true;
  var dominios = listaDePropiedad("DOMINIOS_PERMITIDOS");
  if (!dominios.length) dominios = [DOMINIO_PERMITIDO_POR_DEFECTO];
  return dominios.indexOf(email.slice(arroba + 1)) !== -1;
}

function modoAcceso() {
  var modo = "";
  try {
    modo = PropertiesService.getScriptProperties().getProperty("ACCESO_MODO") || "";
  } catch (err) {
    Logger.log("No se pudo leer ACCESO_MODO: " + err);
  }
  modo = String(modo).trim().toLowerCase();
  return (modo === "exigir" || modo === "abierto") ? modo : "registrar";
}

// Devuelve { email, rechazo }.
//   email   → el usuario dueño del token, o "" si no vino uno válido.
//   rechazo → una respuesta para devolver tal cual, o null si se sigue.
//
// En modo "registrar" NUNCA rechaza, ni siquiera si validar falla: publicar
// esto no puede cortarle la app a nadie.
function controlarAcceso(accion, token, usuarioDeclarado) {
  if (ACCIONES_PUBLICAS[accion]) return { email: "", rechazo: null };

  var modo = modoAcceso();
  if (modo === "abierto") return { email: "", rechazo: null };
  if (ACCIONES_SIEMPRE_CON_TOKEN[accion]) modo = "exigir";

  var email = "";
  try {
    email = emailDeToken(token);
  } catch (err) {
    Logger.log("No se pudo validar el token: " + err);
    if (modo !== "exigir") return { email: "", rechazo: null };
    // No se sabe si el token es bueno (se cayó el Sheet, por ejemplo). NO se
    // contesta "no autorizado": eso le cerraría la sesión a alguien que la
    // tiene en regla. Se pide que reintente, y la cola lo hace sola.
    return { email: "", rechazo: respuestaAcceso({
      status: "error", ok: false, reintentar: true,
      message: "No se pudo verificar la sesión. Se reintenta en un momento."
    }) };
  }

  if (email) return { email: email, rechazo: null };

  if (modo === "exigir") {
    return { email: "", rechazo: respuestaAcceso({
      status: "error", ok: false, noAutorizado: true,
      message: "Tu sesión no está habilitada en el servidor. Cerrá sesión y volvé a entrar con tu contraseña."
    }) };
  }

  registrarAccesoSinToken(accion, token ? "token inválido o vencido" : "sin token", usuarioDeclarado);
  return { email: "", rechazo: null };
}

function respuestaAcceso(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// TOKENS
// ---------------------------------------------------------------------------

// Crea un token para el usuario y devuelve el token en claro (es la única vez
// que existe en claro de este lado). Se llama solo después de haber probado la
// contraseña o el código del correo.
function emitirTokenSesion(email) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return "";
  var token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  var vence = new Date(Date.now() + SESION_DIAS * 86400000);
  var hoja = obtenerHojaConEncabezados(HOJA_SESIONES, COLS_SESIONES);
  limpiarSesionesVencidas(hoja);
  hoja.appendRow(filaSegura([sha256Hex(token), email, new Date(), vence.toISOString()]));
  return token;
}

// Email del dueño del token, o "" si no es válido. Lanza error solo si no se
// pudo consultar (el que llama decide qué hacer con eso).
function emailDeToken(token) {
  token = String(token || "").trim();
  if (!token) return "";

  var hash = sha256Hex(token);
  var cache = CacheService.getScriptCache();
  var claveCache = "ses_" + hash.slice(0, 40);
  var enCache = cache.get(claveCache);
  if (enCache) return enCache === "-" ? "" : enCache;

  var email = "";
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SESIONES);
  if (hoja && hoja.getLastRow() >= 2) {
    var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLS_SESIONES.length).getDisplayValues();
    var ahora = Date.now();
    for (var f = 0; f < filas.length; f++) {
      if (filas[f][0] !== hash) continue;
      if (new Date(filas[f][3]).getTime() > ahora) email = String(filas[f][1]).trim().toLowerCase();
      break;
    }
  }

  // Un usuario quitado de la lista pierde el acceso aunque su token no venció.
  if (email && buscarFilaUsuario(obtenerHojaUsuarios(), email) === -1) email = "";
  // Y uno de un dominio no permitido también: corta las cuentas que se hayan
  // creado antes de existir el filtro.
  if (email && !emailPermitido(email)) email = "";

  // Lo inválido se recuerda poco: un token recién emitido tiene que andar ya.
  cache.put(claveCache, email || "-", email ? SESION_CACHE_SEG : 60);
  return email;
}

// Borra todos los tokens de un usuario. Se usa al cambiar la contraseña: si
// alguien más tenía una sesión abierta con la clave vieja, se le corta.
// (Los tokens ya validados pueden seguir andando hasta SESION_CACHE_SEG.)
function revocarSesionesDeUsuario(email) {
  email = String(email || "").trim().toLowerCase();
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SESIONES);
  if (!email || !hoja || hoja.getLastRow() < 2) return;
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getDisplayValues();
  for (var f = filas.length - 1; f >= 0; f--) {
    if (String(filas[f][1]).trim().toLowerCase() === email) hoja.deleteRow(f + 2);
  }
}

// Saca los tokens vencidos para que la hoja no crezca sin techo. Se llama al
// emitir uno nuevo, que pasa pocas veces por día.
function limpiarSesionesVencidas(hoja) {
  if (hoja.getLastRow() < 2) return;
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLS_SESIONES.length).getDisplayValues();
  var ahora = Date.now();
  for (var f = filas.length - 1; f >= 0; f--) {
    var vence = new Date(filas[f][3]).getTime();
    if (!vence || vence < ahora) hoja.deleteRow(f + 2);
  }
}

// Una fila por acción, motivo y usuario cada 15 minutos: con eso alcanza para
// saber quién falta, sin escribir en el Sheet en cada pedido.
function registrarAccesoSinToken(accion, motivo, usuarioDeclarado) {
  try {
    var usuario = String(usuarioDeclarado || "").trim().toLowerCase();
    var cache = CacheService.getScriptCache();
    var clave = "sintoken_" + sha256Hex(accion + "|" + motivo + "|" + usuario).slice(0, 40);
    if (cache.get(clave)) return;
    cache.put(clave, "1", 900);
    obtenerHojaConEncabezados(HOJA_ACCESOS_SIN_TOKEN, COLS_ACCESOS_SIN_TOKEN)
      .appendRow(filaSegura([new Date(), accion, motivo, usuario]));
  } catch (err) {
    Logger.log("No se pudo registrar el acceso sin token: " + err);
  }
}


// ---------------------------------------------------------------------------
// CORREOS QUE SALEN POR EL BACKEND
// ---------------------------------------------------------------------------
// Hallazgo 2: enviar_correo_reporte manda mails desde la cuenta del script con
// lo que diga el pedido. El token cierra la puerta a los de afuera; esto pone
// límites a lo que puede hacer el de adentro y deja constancia de cada envío.

var CORREO_MAX_DESTINATARIOS = 15;   // Para + CC
var HOJA_CORREOS_ENVIADOS = "Correos_Enviados";
var COLS_CORREOS_ENVIADOS = ["fecha", "usuario", "autenticado", "para", "cc", "asunto", "tipo", "id"];

function contarDestinatarios(texto) {
  return String(texto || "").split(/[,;]/).filter(function (d) { return d.trim(); }).length;
}

// Devuelve un mensaje de error, o "" si el pedido se puede mandar.
function problemaDelCorreo(data) {
  var total = contarDestinatarios(data.Correo) + contarDestinatarios(data.Correo_Cc);
  if (total > CORREO_MAX_DESTINATARIOS) {
    return "Demasiados destinatarios (" + total + "). El máximo es " + CORREO_MAX_DESTINATARIOS + ".";
  }
  return "";
}

// --- Reportes (enviar_correo_reporte): van a plantas, clientes y fleteros, así
// que los destinatarios no se pueden limitar a una lista. Lo que sí se fija en
// el servidor (SEC-03 de la segunda auditoría): el nombre del remitente, qué
// HTML puede llevar el cuerpo, que el adjunto sea un PDF y cuántos por día.
var CORREO_MAX_POR_DIA = 60;   // por usuario, solo los que salen por el backend

// Nombre con el que sale el correo. Antes lo elegía el pedido ("Braun
// Tesorería" pasaba igual); ahora sale del usuario autenticado.
function nombreRemitenteCorreo(emailAutenticado) {
  var nombre = "";
  if (emailAutenticado) {
    try {
      var valores = obtenerHojaUsuarios().getDataRange().getDisplayValues();
      for (var f = 1; f < valores.length; f++) {
        if (String(valores[f][1]).trim().toLowerCase() === emailAutenticado) { nombre = String(valores[f][0]).trim(); break; }
      }
    } catch (err) { Logger.log("No se pudo leer el nombre del remitente: " + err); }
  }
  return nombre ? nombre + " (App Braun)" : "App Braun";
}

// Deja pasar SOLO las etiquetas que usa cuerpoHtmlReporte (correo.js) con su
// atributo style, y escapa todo lo demás. Un link, un formulario o una imagen
// remota que venga en el pedido no llega al destinatario; el reporte de la app
// se ve igual que antes.
var ETIQUETAS_HTML_CORREO = { div: true, p: true, table: true, tbody: true, tr: true, td: true, b: true, i: true, br: true, span: true };

function sanearHtmlCorreo(html) {
  var s = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title|iframe|object|embed|form|template|svg|math|textarea|select|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  var etiquetas = [];
  s = s.replace(/<\s*(\/?)\s*([a-z0-9]+)\b([^>]*)>/gi, function (m, cierre, tag, attrs) {
    tag = tag.toLowerCase();
    if (!ETIQUETAS_HTML_CORREO[tag]) return "";
    var armada;
    if (cierre) {
      armada = "</" + tag + ">";
    } else {
      var estilo = (attrs.match(/\sstyle\s*=\s*"([^"]*)"/i) || [])[1] || "";
      if (/url\s*\(|expression|javascript:|@import|behavior|position\s*:/i.test(estilo)) estilo = "";
      armada = "<" + tag + (estilo ? ' style="' + estilo + '"' : "") + ">";
    }
    etiquetas.push(armada);
    return "\u0000" + (etiquetas.length - 1) + "\u0000";
  });
  // Lo que quedó suelto ("<a href=..." sin cerrar, "<!DOCTYPE") pasa a texto.
  s = s.replace(/\u0000/g, "\u0001").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return etiquetas[Number(i)]; });
}

// Base64 de un PDF de verdad (empieza con "%PDF", que en base64 es "JVBER").
// Sin esto, cualquier archivo viajaba como "reporte.pdf".
function esPdfBase64(b64) {
  b64 = String(b64 || "");
  if (b64.indexOf("data:") === 0) b64 = b64.substring(b64.indexOf(",") + 1);
  return b64.indexOf("JVBER") === 0;
}

// Cuántos correos mandó hoy este usuario por el backend, según la constancia.
// Se cuenta en la hoja y no en CacheService porque la caché dura 6 horas como
// mucho y el tope es por día.
function correosEnviadosHoy(usuario) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CORREOS_ENVIADOS);
  if (!usuario || !hoja || hoja.getLastRow() < 2) return 0;
  var zona = Session.getScriptTimeZone();
  var hoy = Utilities.formatDate(new Date(), zona, "yyyy-MM-dd");
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLS_CORREOS_ENVIADOS.length).getValues();
  var total = 0;
  for (var f = filas.length - 1; f >= 0; f--) {
    var fecha = filas[f][0];
    if (!(fecha instanceof Date)) continue;
    var dia = Utilities.formatDate(fecha, zona, "yyyy-MM-dd");
    if (dia < hoy) break;   // la hoja crece hacia abajo: lo de antes ya no cuenta
    if (filas[f][6] === "ticket") continue;   // los avisos internos de la Ticketera no cuentan
    if (dia === hoy && String(filas[f][1]).trim().toLowerCase() === usuario) total++;
  }
  return total;
}

// --- Ticketera: es interna. Solo se le escribe a alguien de la hoja Usuarios.
function esUsuarioDeLaApp(email) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return false;
  try { return buscarFilaUsuario(obtenerHojaUsuarios(), email) !== -1; }
  catch (err) { Logger.log("No se pudo consultar Usuarios: " + err); return false; }
}

var TIPOS_ADJUNTO_TICKET = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
var ADJUNTO_TICKET_MAX_BYTES = 10 * 1024 * 1024;

function registrarCorreoEnviado(data, emailAutenticado) {
  try {
    obtenerHojaConEncabezados(HOJA_CORREOS_ENVIADOS, COLS_CORREOS_ENVIADOS).appendRow(filaSegura([
      new Date(),
      emailAutenticado || String(data.usuario_registro || ""),
      emailAutenticado ? "sí" : "no",
      String(data.Correo || ""),
      String(data.Correo_Cc || ""),
      String(data.Correo_Asunto || ""),
      String(data.Tipo_Reporte || "carga"),
      String(data.Id_Carga || data.Id_Calidad || data.Id_OC || "")
    ]));
  } catch (err) {
    Logger.log("El correo salió pero no se pudo registrar en Correos_Enviados: " + err);
  }
}
