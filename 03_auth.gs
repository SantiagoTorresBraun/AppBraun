// =========================================================================
// AUTENTICACIÓN Y RECUPERACIÓN DE CONTRASEÑA
//
// Va en el MISMO proyecto de Apps Script que 01_backend_principal.gs.
// Necesita las líneas de ruteo en doPost y doGet (ver el final de este archivo).
//
// -------------------------------------------------------------------------
// POR QUÉ ESTO VIVE EN EL SERVIDOR
// -------------------------------------------------------------------------
// Antes la contraseña se validaba en el navegador, contra un hash escrito en
// auth.js. Con ese esquema no se puede recuperar nada: para que el navegador
// valide una contraseña nueva, tendría que conocerla, y entonces cualquiera
// que abra el archivo la conoce también.
//
// Ahora el navegador NUNCA ve la contraseña de nadie. El flujo es:
//
//   1. El navegador pide la SAL del usuario (?action=auth_perfil).
//      La sal es pública por diseño: solo sirve para que dos personas con la
//      misma contraseña no tengan el mismo verificador.
//   2. Con la contraseña + la sal, el navegador deriva un VERIFICADOR
//      (PBKDF2-SHA256, 150.000 vueltas). La contraseña no sale del dispositivo.
//   3. Manda el verificador. Acá se compara SHA-256(verificador) contra lo
//      guardado en la hoja "Usuarios".
//
// Se guarda SHA-256(verificador) y NO el verificador: si alguien lee la hoja,
// no obtiene nada que pueda reenviar para entrar. Y para probar contraseñas
// tiene que pagar 150.000 vueltas de PBKDF2 por cada intento.
//
// -------------------------------------------------------------------------
// LO QUE ESTO **NO** ARREGLA
// -------------------------------------------------------------------------
// El resto del backend sigue sin pedir credenciales: quien tenga la URL del
// Web App puede leer y escribir sin pasar por acá. Esto da contraseñas
// personales y trazabilidad real de quién hizo qué, pero NO protege los datos.
// Eso es el hallazgo 1 de AUDITORIA_2026-08-28.md y se arregla aparte.
// =========================================================================

// Columnas que este módulo necesita en la hoja "Usuarios". Se crean solas.
var COL_AUTH = {
  salt: "salt",
  verificador: "verificador_hash",
  resetHash: "reset_hash",
  resetVence: "reset_vence",
  resetIntentos: "reset_intentos",
  actualizada: "password_actualizada"
};

var RESET_MINUTOS_VALIDEZ = 15;   // cuánto vive el código que se manda por mail
var RESET_MAX_INTENTOS = 5;       // intentos de código antes de invalidarlo
var RESET_MAX_PEDIDOS_HORA = 3;   // pedidos de código por correo, por hora

// ------------------------------------------------------------------------
// AUXILIARES
// ------------------------------------------------------------------------

function respuestaAuth(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sha256Hex(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8);
  return bytes.reduce(function (t, b) { return t + ("0" + (b & 0xFF).toString(16)).slice(-2); }, "");
}

// Compara sin cortar en la primera diferencia, para no filtrar información
// por el tiempo que tarda. Con un Sheet de por medio el ruido es enorme y esto
// es casi simbólico, pero no cuesta nada hacerlo bien.
function igualesEnTiempoConstante(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var dif = 0;
  for (var i = 0; i < a.length; i++) dif |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return dif === 0;
}

// Devuelve la fila del usuario (1-based) o -1. La columna 2 es el email.
function buscarFilaUsuario(hoja, email) {
  var buscado = String(email || "").trim().toLowerCase();
  if (!buscado) return -1;
  var valores = hoja.getDataRange().getDisplayValues();
  for (var f = 1; f < valores.length; f++) {
    if (String(valores[f][1] || "").trim().toLowerCase() === buscado) return f + 1;
  }
  return -1;
}

// Lee una celda de la fila del usuario por nombre de columna. Si la columna no
// existe todavía, obtenerColumnaPorNombre() la crea (está en 01_backend_principal).
function leerCampoUsuario(hoja, fila, nombreColumna) {
  var col = obtenerColumnaPorNombre(hoja, nombreColumna);
  return String(hoja.getRange(fila, col).getDisplayValue() || "").trim();
}

function escribirCampoUsuario(hoja, fila, nombreColumna, valor) {
  var col = obtenerColumnaPorNombre(hoja, nombreColumna);
  hoja.getRange(fila, col).setValue(valor);
}

// Deja el registro de reset en blanco: se usa al consumirlo y al invalidarlo.
function limpiarReset(hoja, fila) {
  escribirCampoUsuario(hoja, fila, COL_AUTH.resetHash, "");
  escribirCampoUsuario(hoja, fila, COL_AUTH.resetVence, "");
  escribirCampoUsuario(hoja, fila, COL_AUTH.resetIntentos, "");
}

// ------------------------------------------------------------------------
// 1. PERFIL: la sal del usuario (?action=auth_perfil&email=...)
// ------------------------------------------------------------------------
// El navegador necesita la sal ANTES de poder derivar el verificador, así que
// este dato tiene que ser público. No devuelve nada sensible.
//
// tieneClave:false significa que ese usuario todavía nunca definió una
// contraseña personal; el navegador lo trata como usuario heredado (entra con
// la genérica) y le ofrece crear la suya.
function authPerfil(email) {
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, email);
  if (fila === -1) return respuestaAuth({ ok: true, existe: false });

  var salt = leerCampoUsuario(hoja, fila, COL_AUTH.salt);
  var verif = leerCampoUsuario(hoja, fila, COL_AUTH.verificador);
  return respuestaAuth({
    ok: true,
    existe: true,
    nombre: String(hoja.getRange(fila, 1).getDisplayValue() || "").trim(),
    salt: salt,
    tieneClave: !!(salt && verif)
  });
}

// ------------------------------------------------------------------------
// 2. LOGIN (_accion: "auth_login")
// ------------------------------------------------------------------------
function authLogin(body) {
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, body.email);
  // Mensaje único a propósito: no se distingue "no existe" de "clave incorrecta".
  var generico = { ok: false, error: "Correo o contraseña incorrectos." };
  if (fila === -1) return respuestaAuth(generico);

  var guardado = leerCampoUsuario(hoja, fila, COL_AUTH.verificador);
  if (!guardado) return respuestaAuth({ ok: false, sinClave: true, error: "Este usuario todavía no definió su contraseña." });

  if (!igualesEnTiempoConstante(sha256Hex(body.verificador || ""), guardado)) {
    return respuestaAuth(generico);
  }

  return respuestaAuth({
    ok: true,
    email: String(body.email).trim().toLowerCase(),
    nombre: String(hoja.getRange(fila, 1).getDisplayValue() || "").trim()
  });
}

// ------------------------------------------------------------------------
// 3. DEFINIR O CAMBIAR LA CONTRASEÑA (_accion: "auth_definir")
// ------------------------------------------------------------------------
// Dos caminos válidos para llegar acá:
//   a) el usuario ya tiene clave y manda la actual (cambio voluntario);
//   b) el usuario todavía no tiene clave (primera vez).
// Un usuario CON clave que no manda la actual no pasa: si no, cualquiera con la
// URL del Web App podría cambiarle la contraseña a otro.
function authDefinir(body) {
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, body.email);
  if (fila === -1) return respuestaAuth({ ok: false, error: "Ese usuario no está registrado." });

  if (!body.salt || !body.verificador) {
    return respuestaAuth({ ok: false, error: "Faltan datos para guardar la contraseña." });
  }

  var actualGuardado = leerCampoUsuario(hoja, fila, COL_AUTH.verificador);
  if (actualGuardado) {
    if (!igualesEnTiempoConstante(sha256Hex(body.verificador_actual || ""), actualGuardado)) {
      return respuestaAuth({ ok: false, error: "La contraseña actual no es correcta." });
    }
  }

  escribirCampoUsuario(hoja, fila, COL_AUTH.salt, body.salt);
  escribirCampoUsuario(hoja, fila, COL_AUTH.verificador, sha256Hex(body.verificador));
  escribirCampoUsuario(hoja, fila, COL_AUTH.actualizada, fechaHoraCorreo());
  limpiarReset(hoja, fila); // un cambio de clave invalida cualquier código pendiente
  return respuestaAuth({ ok: true });
}

// ------------------------------------------------------------------------
// 4. PEDIR EL CÓDIGO DE RECUPERACIÓN (_accion: "auth_reset_pedir")
// ------------------------------------------------------------------------
// Manda un código de 6 dígitos AL CORREO DEL USUARIO. Ese es todo el
// mecanismo de seguridad: el código llega a la casilla, así que solo puede
// completar el cambio quien tenga acceso a ese correo.
function authResetPedir(body) {
  var email = String(body.email || "").trim().toLowerCase();
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, email);
  if (fila === -1) return respuestaAuth({ ok: false, error: "Ese correo no está registrado en la app." });

  // Freno de pedidos: sin esto se le puede llenar la casilla a alguien.
  var cache = CacheService.getScriptCache();
  var clavePedidos = "reset_pedidos_" + sha256Hex(email).slice(0, 24);
  var pedidos = parseInt(cache.get(clavePedidos) || "0", 10);
  if (pedidos >= RESET_MAX_PEDIDOS_HORA) {
    return respuestaAuth({ ok: false, error: "Ya se pidieron varios códigos para ese correo. Esperá una hora." });
  }
  cache.put(clavePedidos, String(pedidos + 1), 3600);

  // Código de 6 dígitos. Se guarda HASHEADO junto con el email: si alguien lee
  // la hoja, no puede usar el código para cambiar la contraseña.
  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  var vence = new Date(Date.now() + RESET_MINUTOS_VALIDEZ * 60000);

  escribirCampoUsuario(hoja, fila, COL_AUTH.resetHash, sha256Hex(codigo + "|" + email));
  escribirCampoUsuario(hoja, fila, COL_AUTH.resetVence, vence.toISOString());
  escribirCampoUsuario(hoja, fila, COL_AUTH.resetIntentos, "0");

  var nombre = String(hoja.getRange(fila, 1).getDisplayValue() || "").trim();
  try {
    enviarMailRecuperacion(email, nombre, codigo);
  } catch (err) {
    limpiarReset(hoja, fila); // no quedó código usable: se limpia para poder reintentar
    Logger.log("No se pudo mandar el código de recuperación: " + err);
    return respuestaAuth({ ok: false, error: "No se pudo enviar el correo. Probá de nuevo en un rato." });
  }

  return respuestaAuth({ ok: true, minutos: RESET_MINUTOS_VALIDEZ });
}

// ------------------------------------------------------------------------
// 5. CONFIRMAR EL CÓDIGO Y GUARDAR LA CLAVE NUEVA (_accion: "auth_reset_confirmar")
// ------------------------------------------------------------------------
function authResetConfirmar(body) {
  var email = String(body.email || "").trim().toLowerCase();
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, email);
  if (fila === -1) return respuestaAuth({ ok: false, error: "Ese correo no está registrado en la app." });

  if (!body.salt || !body.verificador) {
    return respuestaAuth({ ok: false, error: "Faltan datos para guardar la contraseña." });
  }

  var guardado = leerCampoUsuario(hoja, fila, COL_AUTH.resetHash);
  var vence = leerCampoUsuario(hoja, fila, COL_AUTH.resetVence);
  if (!guardado || !vence) {
    return respuestaAuth({ ok: false, error: "No hay ningún código pendiente. Pedí uno nuevo." });
  }

  if (new Date(vence).getTime() < Date.now()) {
    limpiarReset(hoja, fila);
    return respuestaAuth({ ok: false, error: "El código venció. Pedí uno nuevo." });
  }

  // Cada intento fallido cuenta: sin esto, 6 dígitos se prueban por fuerza bruta.
  var intentos = parseInt(leerCampoUsuario(hoja, fila, COL_AUTH.resetIntentos) || "0", 10);
  if (intentos >= RESET_MAX_INTENTOS) {
    limpiarReset(hoja, fila);
    return respuestaAuth({ ok: false, error: "Demasiados intentos. Pedí un código nuevo." });
  }

  if (!igualesEnTiempoConstante(sha256Hex(String(body.codigo || "").trim() + "|" + email), guardado)) {
    escribirCampoUsuario(hoja, fila, COL_AUTH.resetIntentos, String(intentos + 1));
    return respuestaAuth({ ok: false, error: "El código no es correcto. Te quedan " + (RESET_MAX_INTENTOS - intentos - 1) + " intentos." });
  }

  escribirCampoUsuario(hoja, fila, COL_AUTH.salt, body.salt);
  escribirCampoUsuario(hoja, fila, COL_AUTH.verificador, sha256Hex(body.verificador));
  escribirCampoUsuario(hoja, fila, COL_AUTH.actualizada, fechaHoraCorreo());
  limpiarReset(hoja, fila); // el código es de un solo uso

  return respuestaAuth({
    ok: true,
    email: email,
    nombre: String(hoja.getRange(fila, 1).getDisplayValue() || "").trim()
  });
}

// ------------------------------------------------------------------------
// EL CORREO CON EL CÓDIGO
// ------------------------------------------------------------------------
function enviarMailRecuperacion(email, nombre, codigo) {
  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">' +
      '<div style="background:#b71c1c;color:#fff;padding:16px 22px;font-size:17px;font-weight:bold">App Braun — Recuperar contraseña</div>' +
      '<div style="padding:22px;color:#333">' +
        '<p style="margin-top:0">Hola' + (nombre ? ' <b>' + nombre + '</b>' : '') + ',</p>' +
        '<p>Pediste cambiar tu contraseña de App Braun. Este es tu código:</p>' +
        '<p style="text-align:center;margin:26px 0">' +
          '<span style="display:inline-block;background:#f5f5f7;border:2px dashed #b71c1c;border-radius:8px;' +
          'padding:14px 30px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#b71c1c">' + codigo + '</span>' +
        '</p>' +
        '<p>Escribilo en la app junto con tu contraseña nueva. Vence en <b>' + RESET_MINUTOS_VALIDEZ + ' minutos</b> ' +
        'y se puede usar una sola vez.</p>' +
        '<p style="color:#c62828"><b>Si no pediste esto, ignorá este correo.</b> Tu contraseña actual sigue funcionando ' +
        'y nadie puede cambiarla sin este código.</p>' +
        '<p style="color:#999;font-size:12px;margin-bottom:0">Este correo se envía solo. No hace falta responderlo.</p>' +
      '</div>' +
    '</div>';

  MailApp.sendEmail(email, "App Braun — tu código para cambiar la contraseña: " + codigo,
    "Tu código para cambiar la contraseña de App Braun es: " + codigo +
    "\n\nVence en " + RESET_MINUTOS_VALIDEZ + " minutos y se usa una sola vez." +
    "\n\nSi no pediste esto, ignorá este correo.",
    { htmlBody: html, name: "App Braun" });
}

// ------------------------------------------------------------------------
// MANTENIMIENTO — correr a mano desde el editor
// ------------------------------------------------------------------------

// Muestra el estado de contraseñas de todos los usuarios.
function diagnosticoAuth() {
  var hoja = obtenerHojaUsuarios();
  var valores = hoja.getDataRange().getDisplayValues();
  var colSalt = obtenerColumnaPorNombre(hoja, COL_AUTH.salt) - 1;
  var colVerif = obtenerColumnaPorNombre(hoja, COL_AUTH.verificador) - 1;
  var colAct = obtenerColumnaPorNombre(hoja, COL_AUTH.actualizada) - 1;
  valores = hoja.getDataRange().getDisplayValues(); // releer: las columnas pueden haberse creado recién
  Logger.log("usuario | tiene clave propia | ultima actualizacion");
  for (var f = 1; f < valores.length; f++) {
    if (!valores[f][1]) continue;
    var tiene = !!(valores[f][colSalt] && valores[f][colVerif]);
    Logger.log(valores[f][1] + " | " + (tiene ? "SI" : "no (usa la genérica)") + " | " + (valores[f][colAct] || "-"));
  }
}

// Le borra la contraseña a un usuario para que vuelva a definirla.
// Cambiar el email de abajo antes de ejecutar.
var EMAIL_A_RESETEAR = "";
function borrarClaveDeUsuario() {
  if (!EMAIL_A_RESETEAR) throw new Error("Poné el email en EMAIL_A_RESETEAR antes de ejecutar.");
  var hoja = obtenerHojaUsuarios();
  var fila = buscarFilaUsuario(hoja, EMAIL_A_RESETEAR);
  if (fila === -1) throw new Error("No existe ese usuario: " + EMAIL_A_RESETEAR);
  escribirCampoUsuario(hoja, fila, COL_AUTH.salt, "");
  escribirCampoUsuario(hoja, fila, COL_AUTH.verificador, "");
  limpiarReset(hoja, fila);
  Logger.log("Clave borrada. " + EMAIL_A_RESETEAR + " vuelve a entrar con la genérica y define una nueva.");
}

// =========================================================================
// RUTEO — estas líneas van en 01_backend_principal.gs
// =========================================================================
// En doPost, junto a las demás acciones:
//
//     if (accion === "auth_login")            return authLogin(data);
//     if (accion === "auth_definir")          return authDefinir(data);
//     if (accion === "auth_reset_pedir")      return authResetPedir(data);
//     if (accion === "auth_reset_confirmar")  return authResetConfirmar(data);
//
// En doGet, junto a las demás lecturas:
//
//     if (e && e.parameter && e.parameter.action === "auth_perfil") {
//       return authPerfil(e.parameter.email);
//     }
// =========================================================================
