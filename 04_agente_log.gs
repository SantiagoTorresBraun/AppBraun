// ============================================================
// REGISTRO DE CONSULTAS AL AGENTE DE IA  (hoja "Agente_Log")
// ============================================================
// Hasta ahora las preguntas al asistente no quedaban en ningún lado: vivían en
// una variable del navegador (agenteConversacion) y se perdían al recargar.
// No había forma de saber qué le pregunta la gente ni de revisar si lo que
// contesta está bien.
//
// Este archivo guarda UNA FILA POR PREGUNTA con todo lo necesario para juzgar
// la respuesta sin tener que reproducirla:
//
//   - la pregunta tal cual la escribió el usuario, y quién la hizo
//   - la respuesta que le dio el asistente
//   - el PLAN que armó la IA (qué dataset miró, qué filtró, qué calculó) y
//     una MUESTRA del resultado real: con eso se ve si el número que dijo sale
//     de los datos o si la IA entendió mal la pregunta
//   - el voto del propio usuario (👍/👎) y dos columnas vacías para la
//     revisión a mano
//
// POR QUÉ SE GUARDA EL PLAN Y NO SOLO LA RESPUESTA
// -------------------------------------------------
// El asistente se equivoca de dos maneras distintas y hay que poder separarlas:
//   a) el PLAN está mal (consultó el dataset equivocado, filtró de más) → el
//      número es correcto para lo que consultó, pero no era lo que se preguntó.
//      Se arregla tocando el prompt del planificador en agente.js.
//   b) el plan está bien pero el REDACTOR dijo otra cosa (inventó, redondeó
//      mal, mezcló columnas) → se arregla tocando el prompt del redactor.
// Mirando solo la respuesta las dos se ven igual. Con el plan y la muestra
// del resultado al lado, se distinguen de un vistazo.
//
// ES UN REGISTRO, NO UN CONTROL: si falla, la consulta del usuario NO se cae.
// El frontend lo manda "y se olvida" (ver agenteRegistrarConsulta en agente.js).
// ============================================================

var HOJA_AGENTE_LOG = "Agente_Log";

var COLUMNAS_AGENTE_LOG = [
  "Id_Consulta",      // para poder volver sobre esta fila (el voto llega después)
  "Fecha_Hora",
  "Usuario",
  "Pregunta",
  "Respuesta",
  "Tipo",             // consulta | charla | error
  "Dataset",          // sobre qué registros consultó
  "Que_Consulto",     // la explicación en una frase que da la propia IA
  "Filas_Resultado",  // cuántas filas devolvió la consulta (0 = no encontró nada)
  "Resultado_Muestra",// los primeros datos reales, para contrastar con la respuesta
  "Plan_JSON",        // el plan completo que armó la IA
  "Duracion_ms",
  "Error",
  "Voto",             // 👍 / 👎, lo pone el usuario desde el chat
  "Comentario_Voto",
  "Revision",         // ↓ estas dos se completan A MANO en la planilla
  "Nota_Revision"
];

// Una celda de Google Sheets no admite más de 50.000 caracteres: si se pasa,
// el appendRow entero falla y se pierde la fila. Se recorta con margen.
var MAX_CARACTERES_CELDA_LOG = 45000;

function recortarParaCelda(valor) {
  if (valor === undefined || valor === null) return "";
  var s = (typeof valor === "string") ? valor : JSON.stringify(valor);
  if (s.length <= MAX_CARACTERES_CELDA_LOG) return s;
  return s.substring(0, MAX_CARACTERES_CELDA_LOG) + "\n…(recortado)";
}

function obtenerHojaAgenteLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_AGENTE_LOG);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_AGENTE_LOG);
    hoja.appendRow(COLUMNAS_AGENTE_LOG);
    hoja.setFrozenRows(1);
    // Sin esto la columna Pregunta/Respuesta estira la fila a lo ancho de la
    // pantalla y la planilla se vuelve ilegible.
    hoja.setColumnWidth(4, 320); // Pregunta
    hoja.setColumnWidth(5, 420); // Respuesta
    hoja.setColumnWidth(10, 300); // Resultado_Muestra
    hoja.setColumnWidth(11, 300); // Plan_JSON
  }
  return hoja;
}

// --- GUARDAR UNA CONSULTA (_accion: "log_agente") ---
function registrarConsultaAgente(data) {
  try {
    var hoja = obtenerHojaAgenteLog();

    // Idempotencia, igual que el resto del backend: si el navegador reintenta
    // el mismo POST no queremos la pregunta dos veces en el registro.
    if (data.Id_Consulta && buscarFilaPorId(hoja, data.Id_Consulta) !== -1) {
      return respuestaAgente({ status: "ok", nota: "ya estaba" });
    }

    hoja.appendRow([
      data.Id_Consulta || Utilities.getUuid(),
      data.Fecha_Hora || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
      data.Usuario || "(sin sesión)",
      recortarParaCelda(data.Pregunta),
      recortarParaCelda(data.Respuesta),
      data.Tipo || "",
      data.Dataset || "",
      recortarParaCelda(data.Que_Consulto),
      (data.Filas_Resultado === undefined || data.Filas_Resultado === null) ? "" : data.Filas_Resultado,
      recortarParaCelda(data.Resultado_Muestra),
      recortarParaCelda(data.Plan_JSON),
      data.Duracion_ms || "",
      recortarParaCelda(data.Error),
      "", "", "", ""   // Voto, Comentario_Voto, Revision, Nota_Revision
    ]);

    return respuestaAgente({ status: "ok" });
  } catch (err) {
    // Que el registro falle NO puede romperle la consulta a nadie: el frontend
    // ignora esta respuesta, pero igual devolvemos algo bien formado.
    Logger.log("No se pudo registrar la consulta del agente: " + err);
    return respuestaAgente({ status: "error", message: String(err) });
  }
}

// --- VOTO DEL USUARIO (_accion: "votar_agente") ---
// El 👍/👎 de cada respuesta en el chat. Llega DESPUÉS de la fila (el usuario
// vota cuando lee la respuesta), por eso se busca por Id_Consulta.
function votarConsultaAgente(data) {
  try {
    var hoja = obtenerHojaAgenteLog();
    var fila = buscarFilaPorId(hoja, data.Id_Consulta);
    if (fila === -1) return respuestaAgente({ status: "error", message: "No encontré esa consulta en el registro." });

    var colVoto = COLUMNAS_AGENTE_LOG.indexOf("Voto") + 1;
    var colComentario = COLUMNAS_AGENTE_LOG.indexOf("Comentario_Voto") + 1;

    hoja.getRange(fila, colVoto).setValue(data.Voto || "");
    if (data.Comentario_Voto !== undefined) {
      hoja.getRange(fila, colComentario).setValue(recortarParaCelda(data.Comentario_Voto));
    }
    return respuestaAgente({ status: "ok" });
  } catch (err) {
    Logger.log("No se pudo guardar el voto del agente: " + err);
    return respuestaAgente({ status: "error", message: String(err) });
  }
}

// ============================================================
// RESUMEN — se corre A MANO desde el editor de Apps Script
// ------------------------------------------------------------
// Contesta de una las dos preguntas que importan: qué preguntan y si el
// asistente está contestando bien. Elegir "resumenAgenteLog" en el desplegable
// de funciones, Ejecutar, y mirar Ver ▸ Registros.
// ============================================================
function resumenAgenteLog() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_AGENTE_LOG);
  if (!hoja || hoja.getLastRow() < 2) { Logger.log("Todavía no hay consultas registradas."); return; }

  var filas = hoja.getDataRange().getDisplayValues();
  var enc = filas[0];
  var col = function (nombre) { return enc.indexOf(nombre); };

  var total = 0, errores = 0, charlas = 0, vacias = 0, pulgarArriba = 0, pulgarAbajo = 0;
  var porUsuario = {}, porDataset = {}, preguntas = [];
  var sumaMs = 0, conMs = 0;

  for (var f = 1; f < filas.length; f++) {
    if (!filas[f][0]) continue;
    total++;

    var tipo = filas[f][col("Tipo")];
    if (tipo === "error") errores++;
    if (tipo === "charla") charlas++;
    if (String(filas[f][col("Filas_Resultado")]) === "0") vacias++;

    var voto = filas[f][col("Voto")];
    if (voto === "👍") pulgarArriba++;
    if (voto === "👎") pulgarAbajo++;

    var u = filas[f][col("Usuario")] || "(sin sesión)";
    porUsuario[u] = (porUsuario[u] || 0) + 1;

    var d = filas[f][col("Dataset")];
    if (d) porDataset[d] = (porDataset[d] || 0) + 1;

    var ms = parseInt(filas[f][col("Duracion_ms")], 10);
    if (ms > 0) { sumaMs += ms; conMs++; }

    preguntas.push({
      pregunta: filas[f][col("Pregunta")],
      voto: voto,
      tipo: tipo,
      filas: filas[f][col("Filas_Resultado")]
    });
  }

  var ordenarDesc = function (obj) {
    return Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; })
      .map(function (k) { return "    " + k + ": " + obj[k]; }).join("\n");
  };

  Logger.log("=== CONSULTAS AL ASISTENTE ===");
  Logger.log("  total de preguntas: " + total);
  Logger.log("  fallaron (error):   " + errores);
  Logger.log("  eran charla (saludo, 'qué podés hacer'): " + charlas);
  Logger.log("  consultas que no encontraron NINGÚN dato: " + vacias +
             "   <- mirar estas: o el dato no existe, o la IA filtró mal");
  Logger.log("  votos 👍 " + pulgarArriba + "   👎 " + pulgarAbajo);
  if (conMs) Logger.log("  tarda en promedio: " + Math.round(sumaMs / conMs) + " ms");
  Logger.log("");
  Logger.log("  quién pregunta:\n" + ordenarDesc(porUsuario));
  Logger.log("");
  Logger.log("  sobre qué registros consulta:\n" + ordenarDesc(porDataset));
  Logger.log("");
  Logger.log("=== LAS QUE HAY QUE REVISAR (votadas 👎, con error, o sin resultados) ===");
  var revisar = preguntas.filter(function (p) {
    return p.voto === "👎" || p.tipo === "error" || String(p.filas) === "0";
  });
  if (!revisar.length) {
    Logger.log("  ninguna — por ahora viene contestando bien");
  } else {
    revisar.slice(0, 40).forEach(function (p) {
      Logger.log("  [" + (p.voto || p.tipo || "sin datos") + "] " + p.pregunta);
    });
    if (revisar.length > 40) Logger.log("  …y " + (revisar.length - 40) + " más (están en la hoja)");
  }
  Logger.log("");
  Logger.log("=== ÚLTIMAS 20 PREGUNTAS ===");
  preguntas.slice(-20).reverse().forEach(function (p) { Logger.log("  " + p.pregunta); });
}
