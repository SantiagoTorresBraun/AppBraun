// ========================================================
// 99_diagnostico.gs — HERRAMIENTAS DE DIAGNÓSTICO
// ========================================================
// Archivo INDEPENDIENTE: no lo llama la app, no se ejecuta solo.
// Solo se corre a mano desde el editor de Apps Script.
//
// Todos los nombres llevan el prefijo DIAG_ o diag para que no puedan
// chocar con nada de 01_backend_principal.gs.
// ========================================================

// Las carpetas donde la app GUARDA lo nuevo (las busca por nombre exacto).
var DIAG_CARPETAS_ACTIVAS = [
  "Control de Calidad_Images",  // fotos de Control de Calidad
  "Contrato Comercial_Files_",  // archivos de Carta de Porte
  "Produccion_Files_"           // fotos de muestreo a campo
];

// Carpeta madre donde se quiere tener todo ordenado.
var DIAG_CARPETA_MADRE = "APP_Braun_2026";


// --------------------------------------------------------
// 1) ¿DÓNDE GUARDA LA APP LO NUEVO?
//    Busca por nombre igual que lo hace el backend y reporta
//    ubicación, dueño, cantidad de archivos y duplicados.
// --------------------------------------------------------
function diagnosticoCarpetasApp() {
  var out = [];
  out.push("========================================");
  out.push("  DÓNDE GUARDA LA APP (carpetas activas)");
  out.push("========================================");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  out.push("");
  out.push("SHEET: " + ss.getName());
  out.push("  ID  : " + ss.getId());
  out.push("  URL : " + ss.getUrl());

  DIAG_CARPETAS_ACTIVAS.forEach(function (nombre) {
    out.push("");
    out.push("----------------------------------------");
    out.push('CARPETA: "' + nombre + '"');

    var it = DriveApp.getFoldersByName(nombre);
    var encontradas = [];
    while (it.hasNext()) encontradas.push(it.next());

    if (encontradas.length === 0) {
      out.push("  ESTADO: *** NO EXISTE ***");
      out.push("  La app la va a CREAR sola en la RAÍZ de Mi unidad");
      out.push("  la primera vez que se guarde algo (fuera de " + DIAG_CARPETA_MADRE + ").");
      return;
    }

    if (encontradas.length > 1) {
      out.push("  ESTADO: *** ATENCIÓN: hay " + encontradas.length + " carpetas con este nombre ***");
      out.push("  La app usa SOLO la primera; el resto queda invisible.");
    } else {
      out.push("  ESTADO: OK (una sola)");
    }

    encontradas.forEach(function (c, i) {
      var cant = 0;
      var fs = c.getFiles();
      while (fs.hasNext()) { fs.next(); cant++; }

      var ruta = diagRutaDeCarpeta(c);
      var duenio = "?";
      try { duenio = c.getOwner() ? c.getOwner().getEmail() : "(unidad compartida)"; } catch (e) { duenio = "(no visible)"; }

      out.push("");
      out.push("  [" + (i + 1) + "] ID       : " + c.getId());
      out.push("      Ubicación: " + ruta);
      out.push("      Dueño    : " + duenio);
      out.push("      Archivos : " + cant);
      out.push("      Acceso   : " + c.getSharingAccess());
    });
  });

  var texto = out.join("\n");
  Logger.log(texto);
  return texto;
}


// --------------------------------------------------------
// 2) ÁRBOL COMPLETO DE APP_Braun_2026 CON LOS IDs
//    Sirve para copiar los IDs y dejar de depender de los nombres.
// --------------------------------------------------------
function diagnosticoArbolCarpetaMadre() {
  var out = [];
  out.push("========================================");
  out.push("  ÁRBOL DE " + DIAG_CARPETA_MADRE);
  out.push("========================================");

  var it = DriveApp.getFoldersByName(DIAG_CARPETA_MADRE);
  if (!it.hasNext()) {
    out.push("No se encontró ninguna carpeta llamada " + DIAG_CARPETA_MADRE);
    Logger.log(out.join("\n"));
    return out.join("\n");
  }

  while (it.hasNext()) {
    var madre = it.next();
    out.push("");
    out.push("[RAÍZ] " + madre.getName());
    out.push("       ID: " + madre.getId());
    out.push("       Acceso: " + madre.getSharingAccess());
    diagRecorrer(madre, "   ", out, 0);
  }

  var texto = out.join("\n");
  Logger.log(texto);
  return texto;
}

// Recorre subcarpetas hasta 3 niveles e imprime nombre + ID + cantidad de archivos.
function diagRecorrer(carpeta, sangria, out, nivel) {
  if (nivel > 3) return;
  var subs = carpeta.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    var cant = 0;
    var fs = s.getFiles();
    while (fs.hasNext()) { fs.next(); cant++; }

    var duenio = "?";
    try { duenio = s.getOwner() ? s.getOwner().getEmail() : "(unidad compartida)"; } catch (e) { duenio = "(no visible)"; }

    out.push(sangria + "|- " + s.getName() + "   (" + cant + " archivos)");
    out.push(sangria + "     ID    : " + s.getId());
    out.push(sangria + "     Dueño : " + duenio);
    diagRecorrer(s, sangria + "   ", out, nivel + 1);
  }
}

// --------------------------------------------------------
// 3) ¿PUEDE LA APP ESCRIBIR EN DRIVE?  <-- LA PRUEBA CLAVE
//    Intenta crear una foto de prueba igual que cuando se guarda
//    un control de calidad, y despues la borra.
//    Si esto falla, NINGUNA foto se puede guardar y el motivo
//    aparece escrito abajo con todas las letras.
// --------------------------------------------------------
function diagnosticoEscrituraEnDrive() {
  var out = [];
  out.push("========================================");
  out.push("  PRUEBA DE ESCRITURA EN DRIVE");
  out.push("========================================");

  // 1) ¿Podemos abrir la carpeta de fotos de calidad?
  var carpeta;
  try {
    var it = DriveApp.getFoldersByName("Control de Calidad_Images");
    if (!it.hasNext()) {
      out.push("FALLO: no se encontro la carpeta 'Control de Calidad_Images'.");
      Logger.log(out.join("\n"));
      return out.join("\n");
    }
    carpeta = it.next();
    out.push("Carpeta encontrada: " + carpeta.getName());
    out.push("  ID: " + carpeta.getId());
  } catch (err) {
    out.push("FALLO al buscar la carpeta: " + err);
    out.push("");
    out.push(">>> Suele significar que el proyecto NO esta autorizado para Drive.");
    Logger.log(out.join("\n"));
    return out.join("\n");
  }

  // 2) ¿Podemos CREAR un archivo? (esto es lo que falla si falta el permiso)
  var archivo = null;
  try {
    // Un PNG de 1x1 px en base64: lo mismo que hace la app, pero minusculo.
    var base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), "image/png", "PRUEBA_BORRAR.png");
    archivo = carpeta.createFile(blob);
    out.push("");
    out.push("CREAR ARCHIVO: OK");
    out.push("  " + archivo.getUrl());
  } catch (err) {
    out.push("");
    out.push("*** FALLO AL CREAR EL ARCHIVO ***");
    out.push("  " + err);
    out.push("");
    out.push(">>> ESTA ES LA CAUSA de que las fotos no se guarden.");
    out.push(">>> Lo mas comun: el proyecto quedo autorizado SOLO para leer Drive.");
    out.push(">>> Solucion: en el editor, ejecutar cualquier funcion a mano y");
    out.push(">>> ACEPTAR TODOS los permisos que pida (incluido el de Drive).");
    Logger.log(out.join("\n"));
    return out.join("\n");
  }

  // 3) ¿Podemos darle permiso de lectura publica? (sin esto la foto no se ve)
  try {
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    out.push("COMPARTIR (link publico): OK");
  } catch (err) {
    out.push("COMPARTIR: FALLO -> " + err);
    out.push(">>> El archivo se crea pero queda PRIVADO: la app lo va a mostrar vacio.");
  }

  // 4) Limpieza
  try {
    archivo.setTrashed(true);
    out.push("Archivo de prueba borrado: OK");
  } catch (err) {
    out.push("No se pudo borrar el archivo de prueba: " + err);
    out.push("(borralo a mano de la carpeta: se llama PRUEBA_BORRAR.png)");
  }

  out.push("");
  out.push("RESULTADO: Drive funciona. Si igual no se guardan las fotos,");
  out.push("el problema NO esta en los permisos de Drive.");

  var texto = out.join("\n");
  Logger.log(texto);
  return texto;
}


// Devuelve la ruta de una carpeta, tipo "Mi unidad / APP_Braun_2026 / Images".
function diagRutaDeCarpeta(carpeta) {
  var partes = [carpeta.getName()];
  var actual = carpeta;
  for (var i = 0; i < 6; i++) { // tope para no colgarse
    var padres = actual.getParents();
    if (!padres.hasNext()) break;
    actual = padres.next();
    partes.unshift(actual.getName());
  }
  return "Mi unidad / " + partes.join(" / ");
}
