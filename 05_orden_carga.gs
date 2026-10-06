// ============================================================================
//  ORDEN DE CARGA — persistencia en el Sheet
// ----------------------------------------------------------------------------
//  La OC es el paso previo al Control de Transporte: la arma la oficina y se le
//  manda a planta como informe de los camiones que van. Ver
//  DOCUMENTACION_ORDEN_CARGA.md.
//
//  CUATRO NIVELES, cuatro hojas. Es un nivel más que Control de Transporte, y
//  esa es toda la diferencia que importa:
//
//      Orden_Carga        1 fila = 1 orden        (destino, especie, fletes)
//        └ OC_Camion      1 fila = 1 camión       (transportista, chofer, dominios)
//            └ OC_CartaPorte  1 fila = 1 CP       (productor, CTG, peso neto, CTTO)
//                └ OC_Lote    1 fila = 1 lote     (lote BRC, bolsas, kg)
//
//  En la hoja `Orden` (Control de Transporte), `Producto` y `Contrato Comercial`
//  cuelgan los DOS de `Id_Carga`, como hermanos: los lotes no saben a qué carta
//  de porte pertenecen. Acá sí, y tiene que ser así, porque cada CP declara un
//  peso neto que se compone de lotes concretos.
//
//  LAS HOJAS SE CREAN SOLAS la primera vez, con obtenerHojaConEncabezados()
//  (está en 01_backend_principal.gs). No hay que crear nada a mano en el Sheet.
//
//  A DIFERENCIA de la hoja `Orden`, que se escribe POR POSICIÓN con appendRow y
//  por eso no se le pueden mover las columnas nunca, acá las cuatro hojas se
//  escriben desde estas listas de encabezados. Agregar una columna es agregarla
//  al final de la lista que corresponda.
//
//  TODAVÍA NO SE TOCA la hoja `Orden`: el enganche OC → Control de Transporte
//  (que necesita Id_OC + N° de camión al final de esa hoja) es el paso
//  siguiente, y depende de definir qué campos vienen de la OC y cuáles carga
//  planta. Ver PREGUNTAS_PENDIENTES_LUCAS.md, punto 3.1.
// ============================================================================

var NOMBRE_HOJA_OC         = "Orden_Carga";
var NOMBRE_HOJA_OC_CAMION  = "OC_Camion";
var NOMBRE_HOJA_OC_CP      = "OC_CartaPorte";
var NOMBRE_HOJA_OC_LOTE    = "OC_Lote";

// Id_OC es la clave técnica que genera la app ("OC-" + timestamp).
// Nro_OC es el número que usa la gente (2056): se puede corregir y hasta
// repetir, así que NO sirve como clave.
var COLS_OC = ["Id_OC", "Nro_OC", "Fecha", "Contrato_Encabeza", "Especie", "Cosecha",
  "Titular_CP", "Remitente_Productor", "Remitente_Venta",
  "Destinatario", "Destinatario_CUIT",
  "Destino", "Destino_CUIT", "Destino_Planta", "Destino_Direccion",
  "Destino_Localidad", "Destino_Provincia",
  "Flete_Intermediario", "Flete_Intermediario_CUIT",
  "Flete_Pagador", "Flete_Pagador_CUIT",
  "Objetivo_Kg", "Observaciones",
  "Total_Camiones", "Total_Bolsas", "Total_Kg",
  "Estado", "usuario_registro", "Fecha_Registro"];

var COLS_OC_CAMION = ["Id_Camion", "Id_OC", "Nro_Camion",
  "Transportista", "Transportista_CUIT", "Chofer", "Chofer_CUIL",
  "Dominio_Camion", "Dominio_Acoplado", "Km", "Tarifa"];

// Id_OC se repite en las hojas hijas aunque ya esté en la madre: así se puede
// borrar una orden entera con un solo barrido por hoja, y una consulta por
// orden no tiene que ir encadenando tablas.
var COLS_OC_CP = ["Id_CP", "Id_Camion", "Id_OC", "Nro_CP",
  "Productor", "Contrato_Comercial", "CTG", "Carta_Porte",
  "Peso_Neto", "Observaciones_CP"];

var COLS_OC_LOTE = ["Id_Lote_OC", "Id_CP", "Id_OC", "Nro_Lote",
  "Lote_BRC", "Lote_Planta", "Tipo", "Calibre",
  "Bolsas", "Kg_Bolsa", "Total_Kg"];


// ---------------------------------------------------------------------------
// GUARDAR  (_accion: "guardar_oc")
// ---------------------------------------------------------------------------
// IDEMPOTENTE: si ya existe una fila con ese Id_OC no se inserta otra. El mismo
// POST puede llegar dos veces (la cola offline que reintenta, red inestable,
// doble toque en Guardar, o el reintento a ciegas de enviarAlBackend cuando no
// pudo leer la respuesta). Es el mismo cuidado que ya tienen Carga, Calidad,
// Producción y Ticketera.
//
// El chequeo va adentro de un LOCK porque Apps Script atiende varios POST a la
// vez: sin él, dos pedidos con el mismo Id_OC leen "no existe" ANTES de que
// cualquiera escriba, y terminan insertando los dos. Así se duplicó una carga
// real en su momento (BC-1787247191230, 3 filas para una sola carga).
function guardarOrdenCarga(data) {
  var hojaOC = obtenerHojaConEncabezados(NOMBRE_HOJA_OC, COLS_OC);

  var lock = LockService.getScriptLock();
  var conLock = false;
  try { conLock = lock.tryLock(30000); } catch (errLock) { conLock = false; }

  try {
    if (data.Id_OC && buscarFilaPorId(hojaOC, data.Id_OC) !== -1) {
      return respuestaOk(); // ya estaba: no se duplica
    }
    hojaOC.appendRow(filaDesdeColumnas(COLS_OC, cabeceraOCaFila(data)));
    // Sin flush, el pedido que entra atrás nuestro puede no ver todavía la fila
    // recién agregada, y volveríamos a tener dos.
    SpreadsheetApp.flush();
  } finally {
    if (conLock) lock.releaseLock();
  }

  guardarHijosDeLaOC(data);
  return respuestaOk();
}

// Los camiones, sus cartas de porte y sus lotes. Va FUERA del lock: son muchos
// appendRow y no hay que tener a los demás pedidos esperando. Solo llega acá el
// pedido que realmente insertó la orden.
function guardarHijosDeLaOC(data) {
  var hojaCam  = obtenerHojaConEncabezados(NOMBRE_HOJA_OC_CAMION, COLS_OC_CAMION);
  var hojaCp   = obtenerHojaConEncabezados(NOMBRE_HOJA_OC_CP, COLS_OC_CP);
  var hojaLote = obtenerHojaConEncabezados(NOMBRE_HOJA_OC_LOTE, COLS_OC_LOTE);

  var camiones = data.Camiones || [];
  for (var i = 0; i < camiones.length; i++) {
    var cam = camiones[i] || {};
    var idCamion = cam.Id_Camion || Utilities.getUuid();

    hojaCam.appendRow(filaDesdeColumnas(COLS_OC_CAMION, {
      Id_Camion: idCamion,
      Id_OC: data.Id_OC || "",
      Nro_Camion: i + 1,
      Transportista: cam.transportista,
      Transportista_CUIT: cam.transportista_cuit,
      Chofer: cam.chofer,
      Chofer_CUIL: cam.chofer_cuil,
      Dominio_Camion: cam.dominio_camion,
      Dominio_Acoplado: cam.dominio_acoplado,
      Km: cam.km,
      Tarifa: cam.tarifa
    }));

    var cps = cam.CartasPorte || [];
    for (var j = 0; j < cps.length; j++) {
      var cp = cps[j] || {};
      var idCp = cp.Id_CP || Utilities.getUuid();

      hojaCp.appendRow(filaDesdeColumnas(COLS_OC_CP, {
        Id_CP: idCp,
        Id_Camion: idCamion,
        Id_OC: data.Id_OC || "",
        Nro_CP: j + 1,
        Productor: cp.productor,
        Contrato_Comercial: cp.contrato_com,
        CTG: cp.ctg,
        Carta_Porte: cp.carta_porte,
        Peso_Neto: cp.peso_neto,
        Observaciones_CP: cp.observaciones
      }));

      var lotes = cp.Lotes || [];
      for (var k = 0; k < lotes.length; k++) {
        var lote = lotes[k] || {};
        hojaLote.appendRow(filaDesdeColumnas(COLS_OC_LOTE, {
          Id_Lote_OC: lote.Id_Lote_OC || Utilities.getUuid(),
          Id_CP: idCp,
          Id_OC: data.Id_OC || "",
          Nro_Lote: k + 1,
          Lote_BRC: lote.lote_brc,
          Lote_Planta: lote.lote_planta,
          Tipo: lote.tipo,
          Calibre: lote.calibre,
          Bolsas: lote.bolsas,
          Kg_Bolsa: lote.kg_bolsa,
          Total_Kg: lote.total_kg
        }));
      }
    }
  }
}

// Pasa la cabecera que manda la app a los nombres de columna de la hoja.
// Los ids del formulario ("oc-destino-cuit") NO se usan como encabezados a
// propósito: la hoja la lee gente, y los guiones del HTML no pintan nada ahí.
function cabeceraOCaFila(data) {
  return {
    Id_OC: data.Id_OC || "",
    Nro_OC: data.Nro_OC || "",
    Fecha: data.Fecha || "",
    Contrato_Encabeza: data.Contrato_Encabeza || "",
    Especie: data.Especie || "",
    Cosecha: data.Cosecha || "",
    Titular_CP: data.Titular_CP || "",
    Remitente_Productor: data.Remitente_Productor || "",
    Remitente_Venta: data.Remitente_Venta || "",
    Destinatario: data.Destinatario || "",
    Destinatario_CUIT: data.Destinatario_CUIT || "",
    Destino: data.Destino || "",
    Destino_CUIT: data.Destino_CUIT || "",
    Destino_Planta: data.Destino_Planta || "",
    Destino_Direccion: data.Destino_Direccion || "",
    Destino_Localidad: data.Destino_Localidad || "",
    Destino_Provincia: data.Destino_Provincia || "",
    Flete_Intermediario: data.Flete_Intermediario || "",
    Flete_Intermediario_CUIT: data.Flete_Intermediario_CUIT || "",
    Flete_Pagador: data.Flete_Pagador || "",
    Flete_Pagador_CUIT: data.Flete_Pagador_CUIT || "",
    Objetivo_Kg: data.Objetivo_Kg || "",
    Observaciones: data.Observaciones || "",
    Total_Camiones: data.Total_Camiones || 0,
    Total_Bolsas: data.Total_Bolsas || 0,
    Total_Kg: data.Total_Kg || 0,
    Estado: data.Estado || "Generada",
    usuario_registro: data.usuario_registro || "",
    Fecha_Registro: new Date()
  };
}

// Arma el array de la fila en el orden de los encabezados. Así agregar una
// columna es agregarla a la lista COLS_*, sin tocar ningún appendRow.
function filaDesdeColumnas(columnas, valores) {
  return columnas.map(function (col) {
    var v = valores[col];
    return (v === undefined || v === null) ? "" : v;
  });
}


// ---------------------------------------------------------------------------
// ACTUALIZAR  (_accion: "actualizar_oc")
// ---------------------------------------------------------------------------
// Borra y reinserta, igual que hacen Muestreo e Informes de Campo. Una OC se
// edita muchas veces mientras se arma —se suma un camión, se saca una CP, se
// reparten de nuevo las bolsas entre lotes— y reinsertar entera evita tener que
// resolver qué se agregó, qué se borró y qué cambió de número.
function actualizarOrdenCarga(data) {
  eliminarOrdenCargaInterno(data.Id_OC);
  return guardarOrdenCarga(data);
}

function eliminarOrdenCarga(data) {
  eliminarOrdenCargaInterno(data.Id_OC);
  return respuestaOk();
}

function eliminarOrdenCargaInterno(idOC) {
  if (!idOC) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaOC   = ss.getSheetByName(NOMBRE_HOJA_OC);
  var hojaCam  = ss.getSheetByName(NOMBRE_HOJA_OC_CAMION);
  var hojaCp   = ss.getSheetByName(NOMBRE_HOJA_OC_CP);
  var hojaLote = ss.getSheetByName(NOMBRE_HOJA_OC_LOTE);

  // Id_OC está en la columna 1 de la madre y en una columna distinta en cada
  // hija: por eso cada barrido lleva su propio índice (0-based).
  if (hojaOC)   borrarFilasPorColumna(hojaOC, 0, idOC);
  if (hojaCam)  borrarFilasPorColumna(hojaCam, 1, idOC);
  if (hojaCp)   borrarFilasPorColumna(hojaCp, 2, idOC);
  if (hojaLote) borrarFilasPorColumna(hojaLote, 2, idOC);
}


// ---------------------------------------------------------------------------
// LEER  (?action=read_oc)  → devuelve las órdenes ya armadas, con sus niveles
// ---------------------------------------------------------------------------
// Se arman TRES índices de una pasada y después se ensambla. El bucle anidado
// —por cada orden recorrer todos los camiones, por cada camión todas las CP,
// por cada CP todos los lotes— crece al cubo: es el mismo error que ya se
// corrigió en el historial de cargas (258.060 comparaciones para armar 253
// filas) y en los informes de campo. No lo repetimos.
function leerOrdenesCarga() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaOC = ss.getSheetByName(NOMBRE_HOJA_OC);
  if (!hojaOC || hojaOC.getLastRow() < 2) return respuestaJsonCalidad([]);

  var filasOC   = hojaOC.getDataRange().getValues();
  var filasCam  = filasDeHoja(ss, NOMBRE_HOJA_OC_CAMION);
  var filasCp   = filasDeHoja(ss, NOMBRE_HOJA_OC_CP);
  var filasLote = filasDeHoja(ss, NOMBRE_HOJA_OC_LOTE);

  var colOC   = indicePorNombre(filasOC[0]);
  var colCam  = filasCam.length  ? indicePorNombre(filasCam[0])  : {};
  var colCp   = filasCp.length   ? indicePorNombre(filasCp[0])   : {};
  var colLote = filasLote.length ? indicePorNombre(filasLote[0]) : {};

  // Lotes agrupados por carta de porte
  var lotesPorCp = {};
  for (var l = 1; l < filasLote.length; l++) {
    var idCpDelLote = String(filasLote[l][colLote["Id_CP"]] || "");
    if (!idCpDelLote) continue;
    if (!lotesPorCp[idCpDelLote]) lotesPorCp[idCpDelLote] = [];
    lotesPorCp[idCpDelLote].push({
      lote_brc: filasLote[l][colLote["Lote_BRC"]],
      lote_planta: filasLote[l][colLote["Lote_Planta"]],
      tipo: filasLote[l][colLote["Tipo"]],
      calibre: filasLote[l][colLote["Calibre"]],
      bolsas: filasLote[l][colLote["Bolsas"]],
      kg_bolsa: filasLote[l][colLote["Kg_Bolsa"]],
      total_kg: filasLote[l][colLote["Total_Kg"]]
    });
  }

  // Cartas de porte agrupadas por camión, cada una con sus lotes ya colgados
  var cpsPorCamion = {};
  for (var c = 1; c < filasCp.length; c++) {
    var idCamionDeLaCp = String(filasCp[c][colCp["Id_Camion"]] || "");
    if (!idCamionDeLaCp) continue;
    var idCp = String(filasCp[c][colCp["Id_CP"]] || "");
    if (!cpsPorCamion[idCamionDeLaCp]) cpsPorCamion[idCamionDeLaCp] = [];
    cpsPorCamion[idCamionDeLaCp].push({
      Id_CP: idCp,
      productor: filasCp[c][colCp["Productor"]],
      contrato_com: filasCp[c][colCp["Contrato_Comercial"]],
      ctg: filasCp[c][colCp["CTG"]],
      carta_porte: filasCp[c][colCp["Carta_Porte"]],
      peso_neto: filasCp[c][colCp["Peso_Neto"]],
      observaciones: filasCp[c][colCp["Observaciones_CP"]],
      Lotes: lotesPorCp[idCp] || []
    });
  }

  // Camiones agrupados por orden, cada uno con sus cartas de porte
  var camionesPorOC = {};
  for (var m = 1; m < filasCam.length; m++) {
    var idOcDelCamion = String(filasCam[m][colCam["Id_OC"]] || "");
    if (!idOcDelCamion) continue;
    var idCamion = String(filasCam[m][colCam["Id_Camion"]] || "");
    if (!camionesPorOC[idOcDelCamion]) camionesPorOC[idOcDelCamion] = [];
    camionesPorOC[idOcDelCamion].push({
      Id_Camion: idCamion,
      transportista: filasCam[m][colCam["Transportista"]],
      transportista_cuit: filasCam[m][colCam["Transportista_CUIT"]],
      chofer: filasCam[m][colCam["Chofer"]],
      chofer_cuil: filasCam[m][colCam["Chofer_CUIL"]],
      dominio_camion: filasCam[m][colCam["Dominio_Camion"]],
      dominio_acoplado: filasCam[m][colCam["Dominio_Acoplado"]],
      km: filasCam[m][colCam["Km"]],
      tarifa: filasCam[m][colCam["Tarifa"]],
      CartasPorte: cpsPorCamion[idCamion] || []
    });
  }

  var salida = [];
  for (var f = 1; f < filasOC.length; f++) {
    var fila = filasOC[f];
    var idOC = String(fila[colOC["Id_OC"]] || "");
    if (!idOC) continue;

    salida.push({
      Id_OC: idOC,
      Nro_OC: fila[colOC["Nro_OC"]],
      Fecha: fechaISO(fila[colOC["Fecha"]]),
      Contrato_Encabeza: fila[colOC["Contrato_Encabeza"]],
      Especie: fila[colOC["Especie"]],
      Cosecha: fila[colOC["Cosecha"]],
      Titular_CP: fila[colOC["Titular_CP"]],
      Remitente_Productor: fila[colOC["Remitente_Productor"]],
      Remitente_Venta: fila[colOC["Remitente_Venta"]],
      Destinatario: fila[colOC["Destinatario"]],
      Destinatario_CUIT: fila[colOC["Destinatario_CUIT"]],
      Destino: fila[colOC["Destino"]],
      Destino_CUIT: fila[colOC["Destino_CUIT"]],
      Destino_Planta: fila[colOC["Destino_Planta"]],
      Destino_Direccion: fila[colOC["Destino_Direccion"]],
      Destino_Localidad: fila[colOC["Destino_Localidad"]],
      Destino_Provincia: fila[colOC["Destino_Provincia"]],
      Flete_Intermediario: fila[colOC["Flete_Intermediario"]],
      Flete_Intermediario_CUIT: fila[colOC["Flete_Intermediario_CUIT"]],
      Flete_Pagador: fila[colOC["Flete_Pagador"]],
      Flete_Pagador_CUIT: fila[colOC["Flete_Pagador_CUIT"]],
      Objetivo_Kg: fila[colOC["Objetivo_Kg"]],
      Observaciones: fila[colOC["Observaciones"]],
      Total_Camiones: fila[colOC["Total_Camiones"]],
      Total_Bolsas: fila[colOC["Total_Bolsas"]],
      Total_Kg: fila[colOC["Total_Kg"]],
      Estado: fila[colOC["Estado"]],
      usuario_registro: fila[colOC["usuario_registro"]],
      Camiones: camionesPorOC[idOC] || []
    });
  }

  return respuestaJsonCalidad(salida.reverse()); // más recientes primero
}

function filasDeHoja(ss, nombre) {
  var hoja = ss.getSheetByName(nombre);
  return (hoja && hoja.getLastRow() >= 1) ? hoja.getDataRange().getValues() : [];
}

// { "Id_OC": 0, "Nro_OC": 1, ... } a partir de la fila de encabezados.
// Se lee POR NOMBRE y no por posición a propósito: la hoja `Orden` ya arrastra
// el problema de leerse por posición y no hay que agregarle uno más.
function indicePorNombre(encabezados) {
  var indice = {};
  for (var c = 0; c < encabezados.length; c++) {
    indice[String(encabezados[c]).trim()] = c;
  }
  return indice;
}

function fechaISO(valor) {
  if (!valor) return "";
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(valor);
}
