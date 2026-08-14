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
