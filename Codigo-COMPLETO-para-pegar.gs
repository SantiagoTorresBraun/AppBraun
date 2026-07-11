// ========================================================
// CONFIGURACIÓN DE HOJAS
// ========================================================
var NOMBRE_HOJA_ORDEN = "Orden";
var NOMBRE_HOJA_PRODUCTO = "Producto";
var NOMBRE_HOJA_CONTRATO = "Contrato Comercial";
// NUEVO: módulo Control de Calidad — una hoja por grano.
// Se aceptan varios nombres posibles por si la hoja se llama distinto:
// se usa la primera que exista en el Sheet.
var HOJAS_CALIDAD_POR_GRANO = {
  "GARBANZO":    ["Control Calidad Garbanzo"],
  "POROTO_MUNG": ["Control de Calidad Mung", "Control Calidad Mung", "Control Calidad Poroto Mung"]
};

// ========================================================
// 1. GUARDAR / ACTUALIZAR / ELIMINAR / ENVIAR CORREO (POST)
// ========================================================
function doPost(e) {
  try {
    var rawContent = e.postData.contents;
    var data;
    try {
      data = JSON.parse(rawContent);
    } catch (jsonError) {
      var dec = decodeURIComponent(rawContent);
      if (dec.endsWith('=')) dec = dec.substring(0, dec.length - 1);
      data = JSON.parse(dec);
    }

    var accion = data._accion || "guardar";

    // ==================== NUEVO: CONTROL DE CALIDAD ====================
    if (accion === "guardar_calidad")    return guardarCalidad(data);
    if (accion === "actualizar_calidad") return actualizarCalidad(data);
    if (accion === "eliminar_calidad")   return eliminarCalidad(data);
    // ===================================================================

    if (accion === "eliminar") {
      eliminarPorIdCarga(data.Id_Carga);
      return respuestaOk();
    }

    if (accion === "actualizar") {
      eliminarPorIdCarga(data.Id_Carga); // borra fila vieja + productos/contratos viejos
      guardarRegistroCompleto(data);      // vuelve a insertar con los datos actuales
      return respuestaOk();
    }

    if (accion === "enviar_correo") {
      guardarRegistroCompleto(data); // si no existía, lo guarda; si existía, igual lo actualizamos abajo con "actualizar" desde el front
      enviarCorreoReporte(data);
      return respuestaOk();
    }

    // accion === "guardar" (caso normal, registro nuevo)
    guardarRegistroCompleto(data);
    return respuestaOk();

  } catch (error) {
    Logger.log("Error crítico: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function respuestaOk() {
  return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Inserta la fila en "Orden" + filas relacionadas en "Producto" y "Contrato Comercial" ---
function guardarRegistroCompleto(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetOrden = ss.getSheetByName(NOMBRE_HOJA_ORDEN);
  var sheetProducto = ss.getSheetByName(NOMBRE_HOJA_PRODUCTO);
  var sheetContrato = ss.getSheetByName(NOMBRE_HOJA_CONTRATO);

  // ---- Fila principal en "Orden" ----
  // Mapeo EXACTO al orden real de columnas de tu hoja "Orden".
  // Archivo, PDF, CP1-CP5 y "Estado" no los envía el frontend hoy: quedan vacíos.
  // Tipo_Carga se agrega al FINAL (columna 37) — ver nota más abajo sobre agregarla en la hoja.
  sheetOrden.appendRow([
    data.Id_Carga || "",
    data.Fecha || "",
    "",                              // Archivo (no usado por el front actualmente)
    "",                              // PDF (no usado por el front actualmente)
    data.Nombre_Chofer || "",
    data.Patente_Chasis || "",
    data.Patente_Acoplado || "",
    data.Firma_Chofer || "",
    data.Aplica_Etiqueta || "",
    data.Lona_Protege || "",
    data.Piso_Libre_Suciedad || "",
    data.Libre_Oxido || "",
    data.Chasis_Secos_Insectos || "",
    data.Exentos_Hongos || "",
    data.Aislante_Piso || "",
    data.ESTATUS || "",
    data.Firma_Control || "",
    data.Elaboro || "",
    data.Indicaciones_Descarga || "",
    data.Foto_Frente || "",          // Foto1
    data.Foto_Culo || "",            // Foto2
    data.Foto_Interior_Chasis || "", // Foto3
    data.Foto_Interior_Acoplado || "",// Foto4
    data.Foto_Proceso_Carga || "",   // Foto5
    data.Foto_Etiqueta_Bolsa || "",  // Foto6
    data.Foto_Camion_Cargado || "",  // Foto7
    data.Foto_Ticket_Balanza || "",  // Foto8
    data.Kg_Cargados || 0,
    "",                              // Estado (columna separada de ESTATUS, no usada por el front hoy)
    "", "", "", "", "",              // CP1..CP5 (reemplazados por la hoja "Contrato Comercial")
    data.Correo || "",
    data.Estado_Correo || "",
    data.Tipo_Carga || ""            // Columna extra: agregarla al final de "Orden" (ver nota)
  ]);

  // ---- Productos ----
  if (data.Productos && Array.isArray(data.Productos)) {
    data.Productos.forEach(function(p) {
      sheetProducto.appendRow([
        Utilities.getUuid(),
        data.Id_Carga || "",
        p.producto || "",
        p.calibre || "",
        p.tipo || "",
        p.lote || "",
        p.posicion || "",
        p.envase || "",
        p.cantidad || "",
        p.kg_envase || "",
        p.total_kg || ""
      ]);
    });
  }

  // ---- Contratos ----
  if (data.Contratos && Array.isArray(data.Contratos)) {
    data.Contratos.forEach(function(c) {
      sheetContrato.appendRow([
        Utilities.getUuid(),
        data.Id_Carga || "",
        c.contrato_com || "",
        c.contrato_cli || "",
        c.carta_porte || "",
        c.destino || "",
        c.kg_cp || "",
        "",                       // Observaciones CP (no la envía el front hoy)
        c.kg_descarga || "",
        c.link_cp || ""           // Columna "CP" real = archivo adjunto Carta de Porte (NO diferencia_carga)
      ]);
    });
  }
}

// --- Elimina todas las filas relacionadas a un Id_Carga en las 3 hojas ---
function eliminarPorIdCarga(idCarga) {
  if (!idCarga) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  borrarFilasPorColumna(ss.getSheetByName(NOMBRE_HOJA_ORDEN), 0, idCarga);
  borrarFilasPorColumna(ss.getSheetByName(NOMBRE_HOJA_PRODUCTO), 1, idCarga);
  borrarFilasPorColumna(ss.getSheetByName(NOMBRE_HOJA_CONTRATO), 1, idCarga);
}

function borrarFilasPorColumna(sheet, indiceColumna, valorBuscado) {
  var datos = sheet.getDataRange().getValues();
  // Recorremos de abajo hacia arriba para poder borrar sin romper los índices
  for (var i = datos.length - 1; i >= 1; i--) {
    if (datos[i][indiceColumna] == valorBuscado) {
      sheet.deleteRow(i + 1); // +1 porque las filas de sheet arrancan en 1, no en 0
    }
  }
}

// --- Envío de correo simple con los datos del reporte ---
function enviarCorreoReporte(data) {
  if (!data.Correo) return;
  var asunto = "Reporte de Carga - " + (data.Id_Carga || "");
  var cuerpo = "Chofer: " + (data.Nombre_Chofer || "-") + "\n" +
               "Fecha: " + (data.Fecha || "-") + "\n" +
               "Patente Chasis: " + (data.Patente_Chasis || "-") + "\n" +
               "Kg Cargados: " + (data.Kg_Cargados || "0") + "\n" +
               "Estatus: " + (data.ESTATUS || "-");
  MailApp.sendEmail(data.Correo, asunto, cuerpo);
}

// ========================================================
// 2. LEER HISTORIAL (GET) - hace el "join" de las 3 hojas
// ========================================================
function doGet(e) {
  try {
    // ==================== NUEVO: CONTROL DE CALIDAD ====================
    // Si la app pide ?action=read_calidad, respondemos la hoja de calidad
    // y NO el historial de cargas.
    if (e && e.parameter && e.parameter.action === "read_calidad") {
      return leerCalidad();
    }
    // ===================================================================

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetOrden = ss.getSheetByName(NOMBRE_HOJA_ORDEN);
    var sheetProducto = ss.getSheetByName(NOMBRE_HOJA_PRODUCTO);
    var sheetContrato = ss.getSheetByName(NOMBRE_HOJA_CONTRATO);

    var rowsOrden = sheetOrden.getDataRange().getValues();
    var rowsProducto = sheetProducto.getDataRange().getValues();
    var rowsContrato = sheetContrato.getDataRange().getValues();

    if (rowsOrden.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = [];

    for (var i = 1; i < rowsOrden.length; i++) {
      var row = rowsOrden[i];
      var idCarga = row[0];

      var productos = [];
      for (var p = 1; p < rowsProducto.length; p++) {
        if (rowsProducto[p][1] == idCarga) {
          productos.push({
            producto: rowsProducto[p][2],
            calibre: rowsProducto[p][3],
            tipo: rowsProducto[p][4],
            lote: rowsProducto[p][5],
            posicion: rowsProducto[p][6],
            envase: rowsProducto[p][7],
            cantidad: rowsProducto[p][8],
            kg_envase: rowsProducto[p][9],
            total_kg: rowsProducto[p][10]
          });
        }
      }

      var contratos = [];
      for (var c = 1; c < rowsContrato.length; c++) {
        if (rowsContrato[c][1] == idCarga) {
          var kgCpValor = parseFloat(rowsContrato[c][6]) || 0;
          var kgDescargaValor = parseFloat(rowsContrato[c][8]) || 0;
          contratos.push({
            contrato_com: rowsContrato[c][2],
            contrato_cli: rowsContrato[c][3],
            carta_porte: rowsContrato[c][4],
            destino: rowsContrato[c][5],
            kg_cp: rowsContrato[c][6],
            kg_descarga: rowsContrato[c][8],
            // La diferencia NO se guarda en el Sheet, se calcula acá.
            // (La columna 9, "CP", es el archivo adjunto de la Carta de Porte, no una diferencia)
            diferencia_carga: (kgDescargaValor - kgCpValor).toFixed(2),
            link_cp: rowsContrato[c][9] || ""
          });
        }
      }

      data.push({
        Id_Carga: row[0],
        Fecha: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), "yyyy-MM-dd") : "",
        Nombre_Chofer: row[4],
        Patente_Chasis: row[5],
        Patente_Acoplado: row[6],
        Firma_Chofer: row[7],
        Aplica_Etiqueta: row[8],
        Lona_Protege: row[9],
        Piso_Libre_Suciedad: row[10],
        Libre_Oxido: row[11],
        Chasis_Secos_Insectos: row[12],
        Exentos_Hongos: row[13],
        Aislante_Piso: row[14],
        ESTATUS: row[15],
        Firma_Control: row[16],
        Elaboro: row[17],
        Indicaciones_Descarga: row[18],
        Foto_Frente: row[19],
        Foto_Culo: row[20],
        Foto_Interior_Chasis: row[21],
        Foto_Interior_Acoplado: row[22],
        Foto_Proceso_Carga: row[23],
        Foto_Etiqueta_Bolsa: row[24],
        Foto_Camion_Cargado: row[25],
        Foto_Ticket_Balanza: row[26],
        Kg_Cargados: row[27],
        Correo: row[34],
        Estado_Correo: row[35],
        Tipo_Carga: row[36], // requiere la columna nueva al final de "Orden" (ver nota)
        Productos: productos,
        Contratos: contratos
      });
    }

    return ContentService.createTextOutput(JSON.stringify(data.reverse()))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"error": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================================
// 3. NUEVO: MÓDULO CONTROL DE CALIDAD
//    (hoja "Control Calidad Garbanzo")
// ========================================================

// Columnas cuyo valor es un porcentaje en el Sheet (formato de celda %).
// Incluye los calibres/defectos de TODOS los granos (Garbanzo + Poroto Mung).
var COLUMNAS_PORCENTAJE_CALIDAD = [
  // Calibres Garbanzo
  "10mm", "9mm", "8mm", "7mm",
  // Calibres Poroto Mung
  "4mm", "3,5mm", "3,25mm", "3mm",
  // Compartido
  "Bajo zaranda",
  // Defectos Garbanzo
  "Verdes", "Lavados", "Blanqueados", "Tocados", "Pelados/Decorticados",
  // Defectos Poroto Mung
  "Descolorido", "Lev. Descoloridos", "Otro tipo", "Lev. Manchados",
  "Cascados", "Pelados/Descorticados", "Daño Mecanico", "Arrugados", "Helados",
  // Defectos compartidos
  "Partidos", "Roidos", "Picados", "Moho", "Brotados", "Ardidos y Chuzos",
  "Sucios", "Manchados",
  // Condición y totales
  "Humedad", "Materia Extraña",
  "Total Granos Buenos", "Total de Daños", "Total Muestra %"
];

var COLUMNAS_IMAGEN_CALIDAD = ["imagen 1", "imagen 2", "imagen 3", "imagen 4"];

function respuestaJsonCalidad(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Devuelve la hoja de un grano (prueba los nombres candidatos en orden).
function obtenerHojaCalidad(grano) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var candidatas = HOJAS_CALIDAD_POR_GRANO[grano] || [];
  for (var i = 0; i < candidatas.length; i++) {
    var hoja = ss.getSheetByName(candidatas[i]);
    if (hoja) return hoja;
  }
  return null;
}

// --- LECTURA DEL HISTORIAL (?action=read_calidad) ---
// Recorre la hoja de CADA grano y devuelve todas las filas juntas como
// objetos { encabezado: valor }, cada una con su campo "Grano" para que la
// app filtre. Los valores van tal cual se ven en el Sheet ("8/10/2025",
// "25,20%"); la app los normaliza en calidad.js.
function leerCalidad() {
  var registros = [];

  Object.keys(HOJAS_CALIDAD_POR_GRANO).forEach(function (grano) {
    var hoja = obtenerHojaCalidad(grano);
    if (!hoja) return;

    var valores = hoja.getDataRange().getDisplayValues();
    if (valores.length < 2) return;

    var encabezados = valores[0].map(function (h) { return String(h).trim(); });

    for (var f = 1; f < valores.length; f++) {
      var fila = valores[f];
      if (!fila[0]) continue; // sin Id_Calidad → fila vacía

      var reg = { "Grano": grano };
      for (var c = 0; c < encabezados.length; c++) {
        reg[encabezados[c]] = fila[c];
      }

      // Rutas de AppSheet → URL de miniatura de Drive (con caché)
      for (var i = 0; i < COLUMNAS_IMAGEN_CALIDAD.length; i++) {
        var col = COLUMNAS_IMAGEN_CALIDAD[i];
        reg[col] = resolverImagenDrive(reg[col]);
      }

      registros.push(reg);
    }
  });

  return respuestaJsonCalidad(registros.reverse()); // más recientes primero
}

// Convierte "Control de Calidad_Images/xxx.jpg" en una URL visible.
// Si ya es una URL o base64 (registro creado desde la app), se devuelve igual.
function resolverImagenDrive(valor) {
  if (!valor) return "";
  var v = String(valor).trim();
  if (v.indexOf("http") === 0 || v.indexOf("data:image") === 0) return v;

  var nombreArchivo = v.split("/").pop();
  if (!nombreArchivo) return "";

  var cache = CacheService.getScriptCache();
  var clave = "img_" + nombreArchivo;
  var cacheado = cache.get(clave);
  if (cacheado) return cacheado === "NO_ENCONTRADO" ? "" : cacheado;

  try {
    var archivos = DriveApp.getFilesByName(nombreArchivo);
    if (archivos.hasNext()) {
      var url = "https://drive.google.com/thumbnail?id=" + archivos.next().getId() + "&sz=w600";
      cache.put(clave, url, 21600); // 6 horas
      return url;
    }
  } catch (err) {
    Logger.log("No se pudo resolver la imagen " + nombreArchivo + ": " + err);
  }
  cache.put(clave, "NO_ENCONTRADO", 21600);
  return "";
}

// --- GUARDADO (_accion: "guardar_calidad") ---
// La app manda un objeto plano cuyas claves coinciden con los encabezados de
// la hoja. Se mapea por nombre de encabezado: si mañana agregás una columna
// (ej. usuario_registro), alcanza con crearla en la hoja y el dato llega solo.
function guardarCalidad(body) {
  var grano = body["Grano"] || "GARBANZO";
  var hoja = obtenerHojaCalidad(grano);
  if (!hoja) return respuestaJsonCalidad({ ok: false, error: "No existe la hoja de calidad del grano " + grano });

  var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  var fila = encabezados.map(function (h) {
    var valor = body[h];
    if (valor === undefined || valor === null) return "";

    // Fotos base64 → archivo en Drive + ruta estilo AppSheet en la celda
    if (COLUMNAS_IMAGEN_CALIDAD.indexOf(h) !== -1 && String(valor).indexOf("data:image") === 0) {
      return guardarFotoCalidadEnDrive(body["Id_Calidad"], h, valor);
    }

    // Porcentajes: la app manda 25.2; si la columna tiene formato %, en la
    // celda debe escribirse 0.252 para que se vea "25,20%"
    if (COLUMNAS_PORCENTAJE_CALIDAD.indexOf(h) !== -1 && typeof valor === "number") {
      return valor / 100;
    }

    return valor;
  });

  hoja.appendRow(fila);
  return respuestaJsonCalidad({ ok: true });
}

// --- ACTUALIZACIÓN (_accion: "actualizar_calidad") ---
function actualizarCalidad(body) {
  var ubicacion = buscarRegistroCalidad(body);
  if (!ubicacion) return respuestaJsonCalidad({ ok: false, error: "Id_Calidad no encontrado" });
  var hoja = ubicacion.hoja;
  var filaIdx = ubicacion.fila;

  var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  for (var c = 0; c < encabezados.length; c++) {
    var h = encabezados[c];
    var valor = body[h];
    if (valor === undefined) continue; // campo que la app no manda → no se pisa

    if (COLUMNAS_IMAGEN_CALIDAD.indexOf(h) !== -1) {
      if (String(valor).indexOf("data:image") === 0) {
        valor = guardarFotoCalidadEnDrive(body["Id_Calidad"], h, valor);
      } else {
        continue; // URL o ruta existente → se conserva la foto original
      }
    } else if (COLUMNAS_PORCENTAJE_CALIDAD.indexOf(h) !== -1 && typeof valor === "number") {
      valor = valor / 100;
    }

    hoja.getRange(filaIdx, c + 1).setValue(valor);
  }

  return respuestaJsonCalidad({ ok: true });
}

// --- BORRADO (_accion: "eliminar_calidad") ---
function eliminarCalidad(body) {
  var ubicacion = buscarRegistroCalidad(body);
  if (!ubicacion) return respuestaJsonCalidad({ ok: false, error: "Id_Calidad no encontrado" });

  ubicacion.hoja.deleteRow(ubicacion.fila);
  return respuestaJsonCalidad({ ok: true });
}

// --- AUXILIARES CALIDAD ---

// Busca un Id_Calidad: primero en la hoja de su grano (si el body lo trae),
// y si no, en las hojas de todos los granos. Devuelve { hoja, fila } o null.
function buscarRegistroCalidad(body) {
  var granos = body["Grano"] ? [body["Grano"]] : Object.keys(HOJAS_CALIDAD_POR_GRANO);
  for (var i = 0; i < granos.length; i++) {
    var hoja = obtenerHojaCalidad(granos[i]);
    if (!hoja) continue;
    var fila = buscarFilaPorIdCalidad(hoja, body["Id_Calidad"]);
    if (fila !== -1) return { hoja: hoja, fila: fila };
  }
  // Si vino un Grano pero no se encontró ahí, probamos en el resto por las dudas
  if (body["Grano"]) {
    var restantes = Object.keys(HOJAS_CALIDAD_POR_GRANO).filter(function (g) { return g !== body["Grano"]; });
    for (var j = 0; j < restantes.length; j++) {
      var hoja2 = obtenerHojaCalidad(restantes[j]);
      if (!hoja2) continue;
      var fila2 = buscarFilaPorIdCalidad(hoja2, body["Id_Calidad"]);
      if (fila2 !== -1) return { hoja: hoja2, fila: fila2 };
    }
  }
  return null;
}
function buscarFilaPorIdCalidad(hoja, idCalidad) {
  if (!idCalidad) return -1;
  var ids = hoja.getRange(1, 1, hoja.getLastRow(), 1).getDisplayValues();
  for (var f = 1; f < ids.length; f++) { // arranca en 1: la fila 0 es el encabezado
    if (String(ids[f][0]).trim() === String(idCalidad).trim()) return f + 1;
  }
  return -1;
}

// Guarda una foto base64 en la carpeta de imágenes (misma convención que
// AppSheet) y devuelve la ruta relativa para la celda.
function guardarFotoCalidadEnDrive(idCalidad, columna, base64) {
  try {
    var carpeta;
    var carpetas = DriveApp.getFoldersByName("Control de Calidad_Images");
    carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder("Control de Calidad_Images");

    var partes = base64.split(",");
    var tipo = (partes[0].match(/data:(image\/\w+)/) || [null, "image/jpeg"])[1];
    var extension = tipo.split("/")[1] === "png" ? "png" : "jpg";
    var nombre = idCalidad + "." + columna + "." + new Date().getTime() + "." + extension;

    var blob = Utilities.newBlob(Utilities.base64Decode(partes[1]), tipo, nombre);
    carpeta.createFile(blob);
    return "Control de Calidad_Images/" + nombre;
  } catch (err) {
    Logger.log("No se pudo guardar la foto en Drive: " + err);
    return "";
  }
}
