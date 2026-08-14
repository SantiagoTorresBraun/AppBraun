// ============================================================
// ESPEJO DEL BACKEND EN PRODUCCIÓN
// ============================================================
// Copia fiel del archivo "Código.gs" del proyecto de Apps Script
// "mIGRACION" (ID 18iIQlwh_9BT_HBnhdUgSUw2oGHqytkEI-7bv8UvwJ4dx4hbsZQPnD-vU),
// que está pegado adentro del Sheet BD_BRC.
//
// Sincronizado el 14/08/2026.
//
// La FUENTE DE VERDAD sigue siendo el editor de Apps Script: este archivo es
// una copia para poder leer y revisar el código sin entrar al editor. Si se
// modifica acá, hay que copiarlo al editor y volver a "Implementar → Nueva
// versión" para que la app en producción lo use.
//
// Reemplaza a "Codigo-COMPLETO-para-pegar.gs", que quedó desactualizado.
// ============================================================

// ========================================================
// CONFIGURACIÓN DE CARPETAS DE DRIVE  (ÚNICO LUGAR A TOCAR)
// ========================================================
// Todo vive dentro de "APP_Braun_2026" en el Drive de
// santiago.torres@braunrelacionescomerciales.com.ar
//
// Se identifican por ID y NO por nombre: el ID no cambia nunca, aunque la
// carpeta se renombre, se mueva o cambie de dueño. Antes se buscaban por
// nombre y cualquier renombre hacía que la app creara una carpeta nueva
// vacía en la raíz de Mi unidad.
// Para obtener un ID: abrir la carpeta en Drive y copiarlo de la barra de
// direcciones -> https://drive.google.com/drive/folders/ESTE_ES_EL_ID
var ID_CARPETA_MADRE            = "16KZ6y9waJ085okNZtAR9xopGWa392AVN"; // APP_Braun_2026
var ID_SUBCARPETA_FILE          = "19UR340CNxQzAh1HEghgAKR5KldvAcF4S"; // APP_Braun_2026/File
var ID_SUBCARPETA_IMAGES        = "1I1wrnxYh9Z4IUkiMVTl5Hy2b3t6oF-e-"; // APP_Braun_2026/Images

// Las tres carpetas donde la app GUARDA lo nuevo:
var ID_CARPETA_CALIDAD_IMAGES   = "1H7tnYi-9J4R-XpwHCTzUHN3Iq5mMJqVV"; // fotos de Control de Calidad
var ID_CARPETA_CONTRATO_FILES   = "1LqczuwlcwXYINxHYR61UEQ-DsWaEeV9t"; // archivos de Carta de Porte
var ID_CARPETA_PRODUCCION_FILES = ""; // fotos de muestreo — todavía no existe, se crea sola (ver abajo)

// Nombres de respaldo, por si algún ID queda vacío o falla.
var CARPETA_FOTOS_CALIDAD     = "Control de Calidad_Images";
var CARPETA_ARCHIVOS_CONTRATO = "Contrato Comercial_Files_";
var CARPETA_FOTOS_MUESTREO    = "Produccion_Files_";

// Devuelve la carpeta donde guardar, en este orden de preferencia:
//   1) por ID (lo normal y lo confiable)
//   2) si no hay ID o falla, la busca por nombre en todo el Drive
//   3) si tampoco existe, la CREA dentro de la carpeta padre indicada
//      (nunca en la raíz de Mi unidad, que era el problema anterior)
function obtenerCarpetaApp(idCarpeta, nombreRespaldo, idCarpetaPadre) {
  if (idCarpeta) {
    try {
      return DriveApp.getFolderById(idCarpeta);
    } catch (err) {
      Logger.log("El ID de la carpeta '" + nombreRespaldo + "' no sirve (" + idCarpeta + "): " + err +
                 " — se busca por nombre.");
    }
  }

  var encontradas = DriveApp.getFoldersByName(nombreRespaldo);
  if (encontradas.hasNext()) return encontradas.next();

  // No existe: la creamos DENTRO de la carpeta padre, no suelta en Mi unidad.
  var padre;
  try {
    padre = DriveApp.getFolderById(idCarpetaPadre);
  } catch (err) {
    Logger.log("No se pudo abrir la carpeta padre " + idCarpetaPadre + ": " + err);
    padre = DriveApp.getRootFolder();
  }
  var nueva = padre.createFolder(nombreRespaldo);
  Logger.log("Se creó la carpeta '" + nombreRespaldo + "' con ID " + nueva.getId() +
             " — conviene pegar ese ID en la configuración de arriba.");
  return nueva;
}

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

    // ==================== NUEVO: TICKETERA ====================
    if (accion === "crear_ticket")          return crearTicket(data);
    if (accion === "actualizar_ticket")     return actualizarTicket(data);
    if (accion === "responder_ticket")      return responderTicket(data);
    if (accion === "notificar_responsable") return actualizarTicket(data.ticket || data); // compat versión vieja
    // ==================== NUEVO: USUARIOS ======================
    if (accion === "agregar_usuario")  return agregarUsuario(data);
    if (accion === "eliminar_usuario") return eliminarUsuario(data);
    // ==================== NUEVO: PRODUCCIÓN (muestreo a campo) ====================
    if (accion === "guardar_muestreo")    return guardarMuestreo(data);
    if (accion === "actualizar_muestreo") return actualizarMuestreo(data);
    if (accion === "eliminar_muestreo")   return eliminarMuestreo(data);
    // ===========================================================

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

    // accion === "guardar" (caso normal, registro nuevo de Control de Carga).
    // IMPORTANTE: solo si la acción es exactamente "guardar" — antes cualquier
    // acción desconocida caía acá y escribía filas vacías en la hoja "Orden".
    if (accion === "guardar") {
      guardarRegistroCompleto(data);
      return respuestaOk();
    }

    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "Acción desconocida: " + accion }))
      .setMimeType(ContentService.MimeType.JSON);

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

  // IDEMPOTENCIA: si ya existe una fila con este Id_Carga, no se inserta otra.
  // El mismo POST puede llegar dos veces (cola offline que reintenta, red
  // inestable, doble toque en Guardar, o el reintento del front cuando no pudo
  // leer la respuesta). Los módulos de Calidad, Producción y Ticketera ya tenían
  // este chequeo; Control de Carga era el único que podía duplicar la carga.
  // Ojo: la acción "actualizar" borra la fila vieja ANTES de llamar acá, así que
  // este chequeo no interfiere con las ediciones.
  if (data.Id_Carga && buscarFilaPorId(sheetOrden, data.Id_Carga) !== -1) {
    return;
  }

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
      var idContrato = Utilities.getUuid();
      // El front manda el campo "archivo_cp": o bien un data:...;base64 recién
      // elegido por el usuario (hay que subirlo a Drive), o bien la ruta/URL
      // que ya vino de un archivo existente (se conserva tal cual).
      var archivoCp = c.archivo_cp || "";
      if (archivoCp.indexOf("data:") === 0) {
        archivoCp = guardarArchivoContratoEnDrive(idContrato, archivoCp);
      }
      sheetContrato.appendRow([
        idContrato,
        data.Id_Carga || "",
        c.contrato_com || "",
        c.contrato_cli || "",
        c.carta_porte || "",
        c.destino || "",
        c.kg_cp || "",
        "",                       // Observaciones CP (no la envía el front hoy)
        c.kg_descarga || "",
        archivoCp                 // Columna "CP" real = archivo adjunto Carta de Porte (NO diferencia_carga)
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
    // ==================== NUEVO: TICKETERA ====================
    if (e && e.parameter && e.parameter.action === "read_tickets") {
      return leerTickets();
    }
    // ==================== NUEVO: USUARIOS =====================
    if (e && e.parameter && e.parameter.action === "read_usuarios") {
      return leerUsuarios();
    }
    // ==================== NUEVO: PRODUCCIÓN ====================
    if (e && e.parameter && e.parameter.action === "read_muestreos") {
      return leerMuestreos();
    }
    // ==========================================================

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
            archivo_cp: resolverArchivoDrive(rowsContrato[c][9] || "")
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
      var archivo = archivos.next();
      // Nos aseguramos de que sea visible: las fotos subidas por AppSheet (o por
      // versiones viejas de esta app) pueden estar privadas y devolver 403.
      try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (permErr) { }
      var url = "https://drive.google.com/thumbnail?id=" + archivo.getId() + "&sz=w600";
      cache.put(clave, url, 21600); // 6 horas
      return url;
    }
  } catch (err) {
    Logger.log("No se pudo resolver la imagen " + nombreArchivo + ": " + err);
  }
  // Negativo con vida corta (10 min): una foto recién subida puede tardar en
  // aparecer en la búsqueda de Drive, y cachear el fallo 6 hs la dejaba
  // invisible el resto del día.
  cache.put(clave, "NO_ENCONTRADO", 600);
  return "";
}

// --- MANTENIMIENTO (correr UNA vez a mano desde el editor de Apps Script) ---
// Comparte todas las fotos ya existentes en "Control de Calidad_Images" y limpia
// el caché de resoluciones fallidas. Sirve para recuperar las fotos que se
// subieron mientras faltaba el setSharing.
function repararFotosCalidad() {
  var carpeta = obtenerCarpetaApp(ID_CARPETA_CALIDAD_IMAGES, CARPETA_FOTOS_CALIDAD, ID_SUBCARPETA_IMAGES);
  var cache = CacheService.getScriptCache();
  var archivos = carpeta.getFiles();
  var compartidos = 0, fallidos = 0;
  while (archivos.hasNext()) {
    var archivo = archivos.next();
    try {
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      compartidos++;
    } catch (err) {
      fallidos++;
      Logger.log("No se pudo compartir " + archivo.getName() + ": " + err);
    }
    try { cache.remove("img_" + archivo.getName()); } catch (cacheErr) { }
  }
  Logger.log("Fotos de calidad compartidas: " + compartidos + " (fallidas: " + fallidos + ")");
}

// --- MANTENIMIENTO (correr UNA vez a mano desde el editor de Apps Script) ---
// Aplica el formato de porcentaje a TODAS las filas de las columnas de
// porcentaje, en la hoja de cada grano. Repara de una sola pasada las filas que
// la app insertó sin formato: el 0,88 que estaba guardado ya significaba 88%, y
// al ponerle el formato pasa a verse "88,00%" y se relee como 88.
//
// ⚠️ Las filas que además fueron EDITADAS después quedaron divididas dos veces
// (0,643 → 0,00643). Esas no se pueden reparar automáticamente porque no hay
// forma de saber cuántas veces se dividió cada valor: hay que corregirlas a mano.
function repararFormatoPorcentajesCalidad() {
  Object.keys(HOJAS_CALIDAD_POR_GRANO).forEach(function (grano) {
    var hoja = obtenerHojaCalidad(grano);
    if (!hoja) { Logger.log("Sin hoja para " + grano); return; }

    var ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) { Logger.log(grano + ": hoja sin datos"); return; }

    var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0]
      .map(function (h) { return String(h).trim(); });

    var a1s = [];
    for (var c = 0; c < encabezados.length; c++) {
      if (COLUMNAS_PORCENTAJE_CALIDAD.indexOf(encabezados[c]) === -1) continue;
      var letra = letraColumna(c + 1);
      a1s.push(letra + "2:" + letra + ultimaFila);
    }

    if (a1s.length === 0) { Logger.log(grano + ": no se encontraron columnas de porcentaje"); return; }
    hoja.getRangeList(a1s).setNumberFormat("0.00%");
    Logger.log(grano + ": formato % aplicado a " + a1s.length + " columnas (filas 2 a " + ultimaFila + ")");
  });
}

// --- GUARDADO (_accion: "guardar_calidad") ---
// La app manda un objeto plano cuyas claves coinciden con los encabezados de
// la hoja. Se mapea por nombre de encabezado: si mañana agregás una columna
// (ej. usuario_registro), alcanza con crearla en la hoja y el dato llega solo.
function guardarCalidad(body) {
  var grano = body["Grano"] || "GARBANZO";
  var hoja = obtenerHojaCalidad(grano);
  if (!hoja) return respuestaJsonCalidad({ ok: false, error: "No existe la hoja de calidad del grano " + grano });

  // IDEMPOTENCIA: la app puede reintentar el mismo POST (cola offline que se
  // sincroniza dos veces, red inestable, doble toque en Guardar). Sin este
  // chequeo cada reintento agregaba otra fila con el mismo Id_Calidad.
  if (body["Id_Calidad"] && buscarFilaPorIdCalidad(hoja, body["Id_Calidad"]) !== -1) {
    return respuestaJsonCalidad({ ok: true, nota: "ya existía" });
  }

  var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  var fila = encabezados.map(function (h) {
    var valor = body[h];
    if (valor === undefined || valor === null) return "";

    // Fotos base64 → archivo en Drive + ruta estilo AppSheet en la celda
    if (COLUMNAS_IMAGEN_CALIDAD.indexOf(h) !== -1 && String(valor).indexOf("data:image") === 0) {
      return guardarFotoCalidadEnDrive(body["Id_Calidad"], h, valor);
    }

    // Porcentajes: la app manda 25.2 y en la celda va 0.252, que con el formato
    // de porcentaje se ve "25,20%". El formato se aplica abajo, después de
    // insertar la fila (appendRow no lo hereda de las filas de arriba).
    if (COLUMNAS_PORCENTAJE_CALIDAD.indexOf(h) !== -1 && typeof valor === "number") {
      return valor / 100;
    }

    return valor;
  });

  hoja.appendRow(fila);
  aplicarFormatoPorcentajeCalidad(hoja, hoja.getLastRow(), encabezados, null);
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

  var columnasEscritas = [];

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
    columnasEscritas.push(c);
  }

  // Las filas viejas (o las que quedaron mal formateadas) se normalizan acá:
  // sin el formato %, "0,88" se relee como 0,88 y la próxima edición volvería
  // a dividir por 100.
  aplicarFormatoPorcentajeCalidad(hoja, filaIdx, encabezados, columnasEscritas);

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

// --- ARCHIVO ADJUNTO DE LA CARTA DE PORTE (hoja "Contrato Comercial", columna "CP") ---
// Misma carpeta y convención de nombre de archivo que ya usa AppSheet
// ("Contrato Comercial_Files_/<id>.CP.<timestamp>.<ext>"), para que los
// archivos cargados desde la app web y desde AppSheet convivan sin choques.
// (El nombre y el ID de esta carpeta están arriba, en la CONFIGURACIÓN DE CARPETAS.)

var EXTENSIONES_POR_MIME = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};

// Guarda el archivo (imagen, PDF, Word, etc.) elegido en el form y devuelve
// la ruta relativa que se guarda en la celda "CP".
function guardarArchivoContratoEnDrive(idContrato, base64) {
  try {
    var carpeta = obtenerCarpetaApp(ID_CARPETA_CONTRATO_FILES, CARPETA_ARCHIVOS_CONTRATO, ID_SUBCARPETA_FILE);

    var partes = base64.split(",");
    var tipo = (partes[0].match(/data:([^;]+)/) || [null, "application/octet-stream"])[1];
    var extension = EXTENSIONES_POR_MIME[tipo] || "bin";
    var nombre = (idContrato || Utilities.getUuid()) + ".CP." + new Date().getTime() + "." + extension;

    var blob = Utilities.newBlob(Utilities.base64Decode(partes[1]), tipo, nombre);
    var archivo = carpeta.createFile(blob);
    // Sin esto, el link que le damos al front no se puede abrir/descargar
    // (el archivo quedaría privado, solo visible para el dueño de la carpeta).
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return CARPETA_ARCHIVOS_CONTRATO + "/" + nombre;
  } catch (err) {
    Logger.log("No se pudo guardar el archivo de la Carta de Porte: " + err);
    return "";
  }
}

// Convierte la ruta guardada en la celda ("Contrato Comercial_Files_/xxx.pdf")
// en un link de descarga directa de Drive. Si ya es una URL o un data:
// (archivo recién elegido, todavía no guardado en el Sheet), se devuelve igual.
function resolverArchivoDrive(valor) {
  if (!valor) return "";
  var v = String(valor).trim();
  if (v.indexOf("http") === 0 || v.indexOf("data:") === 0) return v;

  var nombreArchivo = v.split("/").pop();
  if (!nombreArchivo) return "";

  var cache = CacheService.getScriptCache();
  var clave = "arch_" + nombreArchivo;
  var cacheado = cache.get(clave);
  if (cacheado) return cacheado === "NO_ENCONTRADO" ? "" : cacheado;

  try {
    var archivos = DriveApp.getFilesByName(nombreArchivo);
    if (archivos.hasNext()) {
      var archivo = archivos.next();
      try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (permErr) {
        Logger.log("No se pudo compartir " + nombreArchivo + ": " + permErr);
      }
      var url = "https://drive.google.com/uc?export=download&id=" + archivo.getId();
      cache.put(clave, url, 21600); // 6 horas
      return url;
    }
  } catch (err) {
    Logger.log("No se pudo resolver el archivo " + nombreArchivo + ": " + err);
  }
  cache.put(clave, "NO_ENCONTRADO", 21600);
  return "";
}

// ========================================================
// SCRIPT DE MIGRACIÓN ÚNICA: CONVIERTE LAS RUTAS DE APPSHEET
// ("Contrato Comercial_Files_/xxx.pdf") DE LA COLUMNA "CP" EN
// LINKS ESTABLES DE DESCARGA DIRECTA DE DRIVE.
// ========================================================
// Mismo problema que con las fotos de "Orden": resolver el archivo por
// nombre contra Drive en CADA doGet() (una por cada uno de los ~458+
// contratos) es lento e innecesario si el link ya quedó fijo en la celda.
// Corré esta función UNA SOLA VEZ desde el editor de Apps Script
// (seleccionar "convertirArchivosCPAFormatoEstable" en el desplegable de
// funciones y tocar "Ejecutar"). Es segura de correr más de una vez: si una
// celda ya tiene un link http o está vacía, la salta.
//
// Después de correrla, resolverArchivoDrive() ya no necesita buscar nada en
// Drive para esas filas (el "if (v.indexOf('http') === 0) return v;" hace
// que las devuelva tal cual, sin gastar cuota de Drive) — solo sigue
// resolviendo por nombre los contratos nuevos que se suban desde ahora.
function convertirArchivosCPAFormatoEstable() {
  var COLUMNA_CP = 9; // índice 0-based de la columna "CP" en "Contrato Comercial"
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA_CONTRATO);
  var datos = sheet.getDataRange().getValues();

  var celdasActualizadas = 0;
  var celdasSinMatch = [];

  for (var fila = 1; fila < datos.length; fila++) {
    var valorCelda = datos[fila][COLUMNA_CP];
    if (!valorCelda || typeof valorCelda !== "string") continue;

    // Ya es un link http (de una corrida anterior de esta migración, o
    // porque ya se subió desde la app web) o un data: (no debería pasar acá,
    // pero por las dudas) → no tocamos.
    if (valorCelda.indexOf("http") === 0) continue;
    if (valorCelda.indexOf("data:") === 0) continue;

    // La celda trae la ruta estilo AppSheet: "Contrato Comercial_Files_/xxx.pdf"
    var nombreArchivo = valorCelda.split("/").pop();
    if (!nombreArchivo) continue;

    try {
      var archivos = DriveApp.getFilesByName(nombreArchivo);
      if (archivos.hasNext()) {
        var archivo = archivos.next();
        try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (permErr) {
          Logger.log("No se pudo compartir " + nombreArchivo + ": " + permErr);
        }
        var linkEstable = "https://drive.google.com/uc?export=download&id=" + archivo.getId();
        sheet.getRange(fila + 1, COLUMNA_CP + 1).setValue(linkEstable);
        celdasActualizadas++;
      } else {
        celdasSinMatch.push("Fila " + (fila + 1) + ": no se encontró en Drive el archivo \"" + nombreArchivo + "\" (valor original: " + valorCelda + ")");
      }
    } catch (err) {
      celdasSinMatch.push("Fila " + (fila + 1) + ": error buscando \"" + nombreArchivo + "\" → " + err);
    }
  }

  Logger.log("Celdas de CP convertidas a link estable: " + celdasActualizadas);
  Logger.log("Celdas con archivo que no se pudo resolver: " + celdasSinMatch.length);
  if (celdasSinMatch.length > 0) {
    Logger.log(celdasSinMatch.join("\n"));
  }
}

// ========================================================
// MÓDULO PRODUCCIÓN — MUESTREO DE CAMPO
//   Hojas: "Muestreo" (encabezado) + "Muestreo_Puntos" (observaciones).
//   Mismo patrón que Control de Carga (Orden → Producto/Contrato).
// ========================================================
var NOMBRE_HOJA_MUESTREO = "Muestreo";
var NOMBRE_HOJA_MUESTREO_PUNTOS = "Muestreo_Puntos";
// (El nombre y el ID de esta carpeta están arriba, en la CONFIGURACIÓN DE CARPETAS.)

var COLS_MUESTREO = ["Id_Muestreo", "Fecha", "Establecimiento", "Lote", "Campania",
  "Cultivo", "Variedad", "Responsable", "Matricula", "Observaciones",
  "usuario_registro", "Estado"];

var COLS_MUESTREO_PUNTOS = ["Id_Punto", "Id_Muestreo", "Orden", "Lat", "Long",
  "Precision_m", "Timestamp", "Cultivo", "Estado_Fenologico", "Tipo_Observacion",
  "Objetivo", "Severidad", "Incidencia_pct", "Conteo_Valor", "Conteo_Unidad",
  "Nota", "Foto"];

// Devuelve una hoja; si no existe la crea con sus encabezados.
function obtenerHojaConEncabezados(nombre, columnas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(columnas);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function buscarFilaPorId(hoja, idBuscado) {
  if (!idBuscado || hoja.getLastRow() < 2) return -1;
  var ids = hoja.getRange(1, 1, hoja.getLastRow(), 1).getDisplayValues();
  for (var f = 1; f < ids.length; f++) {
    if (String(ids[f][0]).trim() === String(idBuscado).trim()) return f + 1;
  }
  return -1;
}

// --- GUARDAR (_accion: "guardar_muestreo") ---
function guardarMuestreo(data) {
  var hojaM = obtenerHojaConEncabezados(NOMBRE_HOJA_MUESTREO, COLS_MUESTREO);
  var hojaP = obtenerHojaConEncabezados(NOMBRE_HOJA_MUESTREO_PUNTOS, COLS_MUESTREO_PUNTOS);

  // Evita duplicados si el dispositivo reintenta la sincronización.
  if (data.Id_Muestreo && buscarFilaPorId(hojaM, data.Id_Muestreo) !== -1) {
    return respuestaOk();
  }

  hojaM.appendRow([
    data.Id_Muestreo || "", data.Fecha || "", data.Establecimiento || "", data.Lote || "",
    data.Campania || "", data.Cultivo || "", data.Variedad || "", data.Responsable || "",
    data.Matricula || "", data.Observaciones || "", data.usuario_registro || "",
    data.Estado || "Cerrado"
  ]);

  if (data.Puntos && Array.isArray(data.Puntos)) {
    data.Puntos.forEach(function (p, i) {
      var idPunto = p.Id_Punto || Utilities.getUuid();
      var foto = p.Foto || "";
      if (String(foto).indexOf("data:") === 0) foto = guardarFotoMuestreoEnDrive(idPunto, foto);
      hojaP.appendRow([
        idPunto, data.Id_Muestreo || "", (p.Orden || (i + 1)), p.Lat || "", p.Long || "",
        p.Precision_m || "", p.Timestamp || "", p.Cultivo || "", p.Estado_Fenologico || "",
        p.Tipo_Observacion || "", p.Objetivo || "", p.Severidad || "", p.Incidencia_pct || "",
        p.Conteo_Valor || "", p.Conteo_Unidad || "", p.Nota || "", foto
      ]);
    });
  }
  return respuestaOk();
}

function actualizarMuestreo(data) {
  eliminarMuestreoInterno(data.Id_Muestreo);
  return guardarMuestreo(data);
}

function eliminarMuestreo(data) {
  eliminarMuestreoInterno(data.Id_Muestreo);
  return respuestaOk();
}

function eliminarMuestreoInterno(id) {
  if (!id) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaM = ss.getSheetByName(NOMBRE_HOJA_MUESTREO);
  var hojaP = ss.getSheetByName(NOMBRE_HOJA_MUESTREO_PUNTOS);
  if (hojaM) borrarFilasPorColumna(hojaM, 0, id);
  if (hojaP) borrarFilasPorColumna(hojaP, 1, id);
}

// --- LECTURA (?action=read_muestreos) → join de las 2 hojas ---
function leerMuestreos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaM = ss.getSheetByName(NOMBRE_HOJA_MUESTREO);
  var hojaP = ss.getSheetByName(NOMBRE_HOJA_MUESTREO_PUNTOS);
  if (!hojaM) return respuestaJsonCalidad([]);

  var rowsM = hojaM.getDataRange().getValues();
  var rowsP = hojaP ? hojaP.getDataRange().getValues() : [];
  if (rowsM.length <= 1) return respuestaJsonCalidad([]);

  var out = [];
  for (var i = 1; i < rowsM.length; i++) {
    var r = rowsM[i];
    if (!r[0]) continue;

    var puntos = [];
    for (var p = 1; p < rowsP.length; p++) {
      if (rowsP[p][1] == r[0]) {
        puntos.push({
          Id_Punto: rowsP[p][0], Orden: rowsP[p][2], Lat: rowsP[p][3], Long: rowsP[p][4],
          Precision_m: rowsP[p][5], Timestamp: rowsP[p][6], Cultivo: rowsP[p][7],
          Estado_Fenologico: rowsP[p][8], Tipo_Observacion: rowsP[p][9], Objetivo: rowsP[p][10],
          Severidad: rowsP[p][11], Incidencia_pct: rowsP[p][12], Conteo_Valor: rowsP[p][13],
          Conteo_Unidad: rowsP[p][14], Nota: rowsP[p][15], Foto: resolverArchivoDrive(rowsP[p][16] || "")
        });
      }
    }

    out.push({
      Id_Muestreo: r[0],
      Fecha: r[1] ? (r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(r[1])) : "",
      Establecimiento: r[2], Lote: r[3], Campania: r[4], Cultivo: r[5], Variedad: r[6],
      Responsable: r[7], Matricula: r[8], Observaciones: r[9], usuario_registro: r[10],
      Estado: r[11], Puntos: puntos
    });
  }
  return respuestaJsonCalidad(out.reverse());
}

// Guarda una foto base64 del muestreo en Drive y devuelve la ruta relativa.
function guardarFotoMuestreoEnDrive(idPunto, base64) {
  try {
    // Si ID_CARPETA_PRODUCCION_FILES está vacío, la crea dentro de
    // APP_Braun_2026/File y deja el ID nuevo en el log para configurarlo.
    var carpeta = obtenerCarpetaApp(ID_CARPETA_PRODUCCION_FILES, CARPETA_FOTOS_MUESTREO, ID_SUBCARPETA_FILE);

    var partes = base64.split(",");
    var tipo = (partes[0].match(/data:([^;]+)/) || [null, "image/jpeg"])[1];
    var extension = EXTENSIONES_POR_MIME[tipo] || "jpg";
    var nombre = (idPunto || Utilities.getUuid()) + ".foto." + new Date().getTime() + "." + extension;

    var blob = Utilities.newBlob(Utilities.base64Decode(partes[1]), tipo, nombre);
    var archivo = carpeta.createFile(blob);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return CARPETA_FOTOS_MUESTREO + "/" + nombre;
  } catch (err) {
    Logger.log("No se pudo guardar la foto del muestreo: " + err);
    return "";
  }
}

// Guarda una foto base64 en la carpeta de imágenes (misma convención que
// AppSheet) y devuelve la ruta relativa para la celda.
function guardarFotoCalidadEnDrive(idCalidad, columna, base64) {
  try {
    var carpeta = obtenerCarpetaApp(ID_CARPETA_CALIDAD_IMAGES, CARPETA_FOTOS_CALIDAD, ID_SUBCARPETA_IMAGES);

    var partes = base64.split(",");
    var tipo = (partes[0].match(/data:(image\/\w+)/) || [null, "image/jpeg"])[1];
    var extension = tipo.split("/")[1] === "png" ? "png" : "jpg";
    var nombre = idCalidad + "." + columna + "." + new Date().getTime() + "." + extension;

    var blob = Utilities.newBlob(Utilities.base64Decode(partes[1]), tipo, nombre);
    var archivo = carpeta.createFile(blob);
    // Sin este permiso el archivo queda privado: la ruta se graba en la celda,
    // pero la app recibe 403 al pedir la imagen (lh3.googleusercontent.com) y
    // el operario ve "Sin foto" como si nunca se hubiera guardado.
    try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (permErr) {
      Logger.log("No se pudo compartir la foto " + nombre + ": " + permErr);
    }
    // La foto es nueva: si esta ruta quedó cacheada como "NO_ENCONTRADO" en un
    // intento anterior, la limpiamos para que se resuelva en la próxima lectura.
    try { CacheService.getScriptCache().remove("img_" + nombre); } catch (cacheErr) { }
    return "Control de Calidad_Images/" + nombre;
  } catch (err) {
    // NO devolvemos "" a propósito. Antes, si Drive fallaba (típico: el proyecto
    // autorizado sin el scope .../auth/drive, que deja leer pero no crear), la
    // fila se guardaba con las celdas de imagen VACÍAS y la app borraba el
    // registro de su cola: las fotos se perdían sin que nadie se enterara.
    // Propagando el error, doPost responde {status:"error"}, la app conserva el
    // registro (con las fotos en base64) y lo reintenta cuando se arregle.
    Logger.log("No se pudo guardar la foto en Drive: " + err);
    throw new Error("No se pudo guardar la foto '" + columna + "' en Drive: " + err +
      " — revisá que el proyecto esté autorizado con el scope https://www.googleapis.com/auth/drive");
  }
}

// Convierte un índice de columna (1 = A) en su letra de notación A1.
function letraColumna(indice) {
  var letra = "";
  while (indice > 0) {
    var resto = (indice - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    indice = Math.floor((indice - 1) / 26);
  }
  return letra;
}

// Fuerza el formato de porcentaje en las celdas que lo necesitan.
// appendRow() NO hereda el formato de las filas de arriba: sin esto, la app
// mandaba 88, el backend escribía 0.88 y la celda lo mostraba como "0,88" en
// lugar de "88,00%". Al releer la hoja eso volvía como 0,88 y cada edición
// dividía otra vez por 100 (88 → 0,88 → 0,0088).
function aplicarFormatoPorcentajeCalidad(hoja, fila, encabezados, columnasEscritas) {
  var a1s = [];
  for (var c = 0; c < encabezados.length; c++) {
    if (COLUMNAS_PORCENTAJE_CALIDAD.indexOf(encabezados[c]) === -1) continue;
    if (columnasEscritas && columnasEscritas.indexOf(c) === -1) continue;
    a1s.push(letraColumna(c + 1) + fila);
  }
  if (a1s.length > 0) {
    try { hoja.getRangeList(a1s).setNumberFormat("0.00%"); }
    catch (err) { Logger.log("No se pudo aplicar el formato % en la fila " + fila + ": " + err); }
  }
}

// ========================================================
// 4. NUEVO: TICKETERA (hoja "Tickets" + notificaciones por correo)
//    Matriz de notificaciones:
//      crear ticket      → correo al RESPONSABLE
//      responder ticket  → correo al SOLICITANTE (con la respuesta)
//      reasignar         → correo al NUEVO RESPONSABLE
//      cerrar            → correo al SOLICITANTE
// ========================================================

var HOJA_TICKETS = "Tickets";
// URL donde está publicada la app (para el botón "Abrir Ticketera" del correo).
// Antes apuntaba a http://127.0.0.1:5500 — "esta computadora" — así que el botón
// no le funcionaba a ningún destinatario del correo.
var URL_APP_TICKETERA = "https://santiagotorresbraun.github.io/AppBraun/";

var COLUMNAS_TICKETS = [
  "id_ticket", "fecha_creacion", "fecha_cierre",
  "nombre_solicitante", "correo_solicitante",
  "responsable_asignado", "correo_responsable",
  "prioridad", "detalle_solicitud", "estado_ticket",
  "respuesta", "fecha_respuesta", "usuario_registro", "archivo_adjunto"
];

// Devuelve la hoja "Tickets"; si no existe la crea con sus encabezados.
function obtenerHojaTickets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_TICKETS);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_TICKETS);
    hoja.appendRow(COLUMNAS_TICKETS);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// --- LECTURA (?action=read_tickets) ---
function leerTickets() {
  var hoja = obtenerHojaTickets();
  var valores = hoja.getDataRange().getDisplayValues();
  if (valores.length < 2) return respuestaJsonCalidad([]);
  var encabezados = valores[0];
  var tickets = [];
  for (var f = 1; f < valores.length; f++) {
    if (!valores[f][0]) continue;
    var t = {};
    for (var c = 0; c < encabezados.length; c++) t[encabezados[c]] = valores[f][c];
    tickets.push(t);
  }
  return respuestaJsonCalidad(tickets.reverse()); // más recientes primero
}

// --- CREAR (_accion: "crear_ticket") → guarda la fila y notifica al responsable ---
function crearTicket(body) {
  var hoja = obtenerHojaTickets();

  // Evitar duplicados si el dispositivo reintenta la sincronización
  if (body.id_ticket && buscarFilaTicket(hoja, body.id_ticket) !== -1) {
    return respuestaJsonCalidad({ ok: true, nota: "ya existía" });
  }

  var fila = COLUMNAS_TICKETS.map(function (col) {
    var v = body[col];
    if (v === undefined || v === null) return "";
    // El adjunto en base64 puede superar el límite de 50.000 caracteres por celda
    if (col === "archivo_adjunto" && String(v).length > 45000) return "(adjunto demasiado grande: viajó por correo)";
    return v;
  });
  hoja.appendRow(fila);

  // Notificación al responsable
  if (body.correo_responsable) {
    enviarMailTicket(
      body.correo_responsable,
      "Nuevo ticket de " + (body.nombre_solicitante || "un solicitante") + " [" + (body.prioridad || "Baja") + "]",
      "Nuevo Ticket Asignado",
      "<b>" + (body.nombre_solicitante || "") + "</b> te asignó un ticket. Estos son los datos:",
      body,
      body.correo_solicitante,
      body.archivo_adjunto
    );
  }
  return respuestaJsonCalidad({ ok: true });
}

// --- ACTUALIZAR (_accion: "actualizar_ticket") → reasignación / cambio de estado ---
function actualizarTicket(body) {
  var hoja = obtenerHojaTickets();
  var filaIdx = buscarFilaTicket(hoja, body.id_ticket);
  if (filaIdx === -1) return respuestaJsonCalidad({ ok: false, error: "id_ticket no encontrado" });

  var anterior = leerFilaTicket(hoja, filaIdx);
  aplicarPatchTicket(hoja, filaIdx, body);
  var actual = leerFilaTicket(hoja, filaIdx);

  // Reasignación → correo al NUEVO responsable
  if (body.correo_responsable && body.correo_responsable !== anterior.correo_responsable) {
    enviarMailTicket(
      body.correo_responsable,
      "Te reasignaron un ticket de " + (actual.nombre_solicitante || "") + " [" + (actual.prioridad || "Baja") + "]",
      "Ticket Reasignado",
      "Te acaban de asignar este ticket:",
      actual,
      actual.correo_solicitante,
      null
    );
  }

  // Cierre → correo al solicitante
  if (body.estado_ticket === "Cerrado" && anterior.estado_ticket !== "Cerrado" && actual.correo_solicitante) {
    enviarMailTicket(
      actual.correo_solicitante,
      "Tu ticket fue cerrado — " + (actual.id_ticket || ""),
      "Ticket Cerrado",
      "Tu ticket fue marcado como <b>Cerrado</b> por el equipo:",
      actual,
      actual.correo_responsable,
      null
    );
  }
  return respuestaJsonCalidad({ ok: true });
}

// --- RESPONDER (_accion: "responder_ticket") → guarda la respuesta y avisa al solicitante ---
function responderTicket(body) {
  var hoja = obtenerHojaTickets();
  var filaIdx = buscarFilaTicket(hoja, body.id_ticket);
  if (filaIdx === -1) return respuestaJsonCalidad({ ok: false, error: "id_ticket no encontrado" });

  aplicarPatchTicket(hoja, filaIdx, body);
  var actual = leerFilaTicket(hoja, filaIdx);

  if (actual.correo_solicitante) {
    enviarMailTicket(
      actual.correo_solicitante,
      "Respuesta a tu ticket — " + (actual.id_ticket || ""),
      "Tu Ticket Tiene Respuesta",
      "<b>" + (actual.responsable_asignado || "El responsable") + "</b> respondió tu ticket:",
      actual,
      actual.correo_responsable,
      null
    );
  }
  return respuestaJsonCalidad({ ok: true });
}

// --- AUXILIARES TICKETS ---
function buscarFilaTicket(hoja, idTicket) {
  if (!idTicket) return -1;
  var ids = hoja.getRange(1, 1, hoja.getLastRow(), 1).getDisplayValues();
  for (var f = 1; f < ids.length; f++) {
    if (String(ids[f][0]).trim() === String(idTicket).trim()) return f + 1;
  }
  return -1;
}

function leerFilaTicket(hoja, filaIdx) {
  var valores = hoja.getRange(filaIdx, 1, 1, COLUMNAS_TICKETS.length).getDisplayValues()[0];
  var t = {};
  COLUMNAS_TICKETS.forEach(function (col, i) { t[col] = valores[i]; });
  return t;
}

function aplicarPatchTicket(hoja, filaIdx, body) {
  COLUMNAS_TICKETS.forEach(function (col, i) {
    if (col === "id_ticket") return;
    if (body[col] !== undefined) hoja.getRange(filaIdx, i + 1).setValue(body[col]);
  });
}

// ========================================================
// 5. NUEVO: USUARIOS DE LA EMPRESA (hoja "Usuarios")
//    Fuente compartida de la lista de miembros: la app la baja al iniciar
//    (?action=read_usuarios) y la cachea para el login offline.
// ========================================================

var HOJA_USUARIOS = "Usuarios";

// Los 8 usuarios originales: se siembran al crear la hoja por primera vez.
var USUARIOS_SEMILLA = [
  ["Melisa Braun",    "melisa.braun@braunrelacionescomerciales.com.ar"],
  ["Alejo Chamorro",  "alejo.chamorro@braunrelacionescomerciales.com.ar"],
  ["Lucas Ramis",     "lucas.ramis@braunrelacionescomerciales.com.ar"],
  ["Juan Cavallera",  "juan.cavallera@braunrelacionescomerciales.com.ar"],
  ["Pablo Suárez",    "pablo.suarez@braunrelacionescomerciales.com.ar"],
  ["Jonathan Rui",    "jonathan.rui@braunrelacionescomerciales.com.ar"],
  ["Carla Candoni",   "carla.candoni@braunrelacionescomerciales.com.ar"],
  ["Santiago Torres", "santiago.torres@braunrelacionescomerciales.com.ar"]
];

function obtenerHojaUsuarios() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_USUARIOS);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_USUARIOS);
    hoja.appendRow(["nombre", "email"]);
    hoja.setFrozenRows(1);
    USUARIOS_SEMILLA.forEach(function (u) { hoja.appendRow(u); });
  }
  return hoja;
}

function leerUsuarios() {
  var hoja = obtenerHojaUsuarios();
  var valores = hoja.getDataRange().getDisplayValues();
  var usuarios = [];
  for (var f = 1; f < valores.length; f++) {
    if (!valores[f][1]) continue;
    usuarios.push({ nombre: valores[f][0], email: String(valores[f][1]).trim().toLowerCase() });
  }
  return respuestaJsonCalidad(usuarios);
}

function agregarUsuario(body) {
  if (!body.email || !body.nombre) return respuestaJsonCalidad({ ok: false, error: "Faltan nombre o email" });
  var hoja = obtenerHojaUsuarios();
  var email = String(body.email).trim().toLowerCase();
  var valores = hoja.getDataRange().getDisplayValues();
  for (var f = 1; f < valores.length; f++) {
    if (String(valores[f][1]).trim().toLowerCase() === email) {
      return respuestaJsonCalidad({ ok: true, nota: "ya existía" });
    }
  }
  hoja.appendRow([String(body.nombre).trim(), email]);
  return respuestaJsonCalidad({ ok: true });
}

function eliminarUsuario(body) {
  if (!body.email) return respuestaJsonCalidad({ ok: false, error: "Falta el email" });
  var hoja = obtenerHojaUsuarios();
  var email = String(body.email).trim().toLowerCase();
  var valores = hoja.getDataRange().getDisplayValues();
  for (var f = valores.length - 1; f >= 1; f--) {
    if (String(valores[f][1]).trim().toLowerCase() === email) hoja.deleteRow(f + 1);
  }
  return respuestaJsonCalidad({ ok: true });
}

// Correo HTML institucional. replyTo apunta a la contraparte para que
// "Responder" del cliente de correo también funcione como canal directo.
function enviarMailTicket(destinatario, asunto, titulo, intro, t, replyTo, adjuntoBase64) {
  try {
    var colorPrio = t.prioridad === "Alta" ? "#c62828" : (t.prioridad === "Media" ? "#ef6c00" : "#2e7d32");
    var filaHtml = function (et, val) {
      return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#777;white-space:nowrap">' + et + '</td>' +
             '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#333">' + (val || "-") + '</td></tr>';
    };
    var fechaLegible = "";
    try { fechaLegible = Utilities.formatDate(new Date(t.fecha_creacion), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"); } catch (e) { fechaLegible = t.fecha_creacion || ""; }

    var html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">' +
        '<div style="background:#a31e1e;color:#ffffff;padding:14px 20px;font-size:17px;font-weight:bold">Ticketera Braun — ' + titulo + '</div>' +
        '<div style="padding:18px 20px;color:#333333">' +
          '<p style="margin-top:0">' + intro + '</p>' +
          '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
            filaHtml("Ticket", t.id_ticket) +
            filaHtml("Fecha", fechaLegible) +
            filaHtml("Solicitante", (t.nombre_solicitante || "") + " &lt;" + (t.correo_solicitante || "") + "&gt;") +
            filaHtml("Responsable", t.responsable_asignado) +
            filaHtml("Prioridad", '<span style="background:' + colorPrio + ';color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:bold">' + (t.prioridad || "Baja") + '</span>') +
            filaHtml("Estado", t.estado_ticket) +
            filaHtml("Detalle", t.detalle_solicitud) +
          '</table>' +
          (t.respuesta ? '<div style="background:#f5f5f5;border-left:4px solid #a31e1e;padding:10px 14px;margin-top:14px"><b>Respuesta:</b><br>' + t.respuesta + '</div>' : '') +
          '<p style="text-align:center;margin:24px 0 8px">' +
            '<a href="' + URL_APP_TICKETERA + '#/ticketera" style="background:#a31e1e;color:#ffffff;padding:11px 28px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir Ticketera</a>' +
          '</p>' +
          '<p style="color:#999;font-size:12px;text-align:center">También podés responder directamente a este correo.</p>' +
        '</div>' +
      '</div>';

    var opciones = { htmlBody: html, name: "Ticketera Braun" };
    if (replyTo) opciones.replyTo = replyTo;

    // Adjunto (si el ticket se creó con archivo)
    if (adjuntoBase64 && String(adjuntoBase64).indexOf("data:") === 0) {
      try {
        var partes = String(adjuntoBase64).split(",");
        var mime = (partes[0].match(/data:([^;]+)/) || [null, "application/octet-stream"])[1];
        var ext = mime.indexOf("pdf") !== -1 ? "pdf" : (mime.indexOf("png") !== -1 ? "png" : "jpg");
        opciones.attachments = [Utilities.newBlob(Utilities.base64Decode(partes[1]), mime, "adjunto-" + (t.id_ticket || "ticket") + "." + ext)];
      } catch (errAdj) { Logger.log("No se pudo adjuntar el archivo: " + errAdj); }
    }

    MailApp.sendEmail(destinatario, asunto, "Abrí este correo con un cliente que soporte HTML.", opciones);
  } catch (err) {
    Logger.log("No se pudo enviar el correo del ticket: " + err);
  }
}
