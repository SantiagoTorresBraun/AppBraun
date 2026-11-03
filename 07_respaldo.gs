// ============================================================================
//  RESPALDO DIARIO DEL SHEET
// ----------------------------------------------------------------------------
//  OPS-01 de la segunda auditoría del 30/10/2026: no había ninguna copia de
//  seguridad, y cualquier usuario puede borrar registros (las ediciones además
//  borran y reinsertan). El historial de versiones de Sheets existe, pero se
//  restaura a mano, hoja por hoja.
//
//  QUÉ HACE: exporta el Sheet entero como .xlsx a la carpeta
//  "Respaldos_AppBraun", dentro de APP_Braun_2026, y borra los respaldos de
//  más de RESPALDO_DIAS_CONSERVAR días.
//
//  POR QUÉ .xlsx Y NO "Hacer una copia": copiar el Sheet copia también el
//  proyecto de Apps Script que vive adentro. Serían 30 copias del backend, con
//  el código y la configuración, dando vueltas por Drive. El .xlsx trae solo
//  los datos.
//
//  CÓMO SE ACTIVA (una sola vez, desde el editor de Apps Script):
//    1. Elegir "respaldarSheet" y Ejecutar. Aceptar los permisos si los pide.
//       Mirar el log: tiene que decir "Respaldo guardado".
//    2. Activadores (el reloj de la izquierda) ▸ Añadir activador:
//         función respaldarSheet · basado en tiempo · diario · 3 a 4 a. m.
//       Se hace a mano a propósito: crearlo por código necesita un permiso
//       más (script.scriptapp) que el proyecto no tiene declarado.
//
//  CÓMO SE RESTAURA: abrir el .xlsx con Google Sheets, copiar las filas
//  de la hoja que haga falta y pegarlas en BD_BRC. Nunca reemplazar el Sheet
//  entero: tiene el script adentro.
// ============================================================================

var CARPETA_RESPALDOS = "Respaldos_AppBraun";
var RESPALDO_DIAS_CONSERVAR = 30;

function respaldarSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var carpeta = carpetaDeRespaldos();

  // Usa los permisos que el proyecto ya tiene: drive (leer el Sheet y crear
  // el archivo) y script.external_request (el mismo del agente de IA).
  var url = "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=xlsx";
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    // Que falle a la vista: así llega el correo de "error en el activador"
    // que manda Google, en vez de pasar días sin respaldo sin que nadie lo sepa.
    throw new Error("No se pudo exportar el Sheet (HTTP " + resp.getResponseCode() + "): " +
      resp.getContentText().slice(0, 300));
  }

  var nombre = ss.getName() + "_respaldo_" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HHmm") + ".xlsx";
  var archivo = carpeta.createFile(resp.getBlob().setName(nombre));
  Logger.log("Respaldo guardado: " + nombre + " (" + Math.round(archivo.getSize() / 1024) + " KB)");

  borrarRespaldosViejos(carpeta);
}

// La carpeta se busca DENTRO de APP_Braun_2026, no en todo el Drive: un
// nombre suelto podría coincidir con una carpeta de otra cosa.
function carpetaDeRespaldos() {
  var madre = DriveApp.getFolderById(ID_CARPETA_MADRE);   // 01_backend_principal.gs
  var encontradas = madre.getFoldersByName(CARPETA_RESPALDOS);
  return encontradas.hasNext() ? encontradas.next() : madre.createFolder(CARPETA_RESPALDOS);
}

// Solo toca los .xlsx que generó esta función (por el nombre), nunca otra cosa
// que alguien haya dejado en la carpeta.
function borrarRespaldosViejos(carpeta) {
  var limite = Date.now() - RESPALDO_DIAS_CONSERVAR * 86400000;
  var archivos = carpeta.getFiles();
  var borrados = 0;
  while (archivos.hasNext()) {
    var a = archivos.next();
    if (a.getName().indexOf("_respaldo_") === -1) continue;
    if (a.getDateCreated().getTime() < limite) { a.setTrashed(true); borrados++; }
  }
  if (borrados) Logger.log("Respaldos de más de " + RESPALDO_DIAS_CONSERVAR + " días enviados a la papelera: " + borrados);
}
