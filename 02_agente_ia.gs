// =========================================================================
// AGENTE DE IA — PUENTE HACIA GROQ
//
// Este archivo va en el MISMO proyecto de Apps Script que 01_backend_principal.gs
// (Extensiones ▸ Apps Script del Google Sheet).
//
// -------------------------------------------------------------------------
// LA CLAVE DE GROQ NO VA EN ESTE ARCHIVO. NUNCA.
// -------------------------------------------------------------------------
// Este repo es PÚBLICO (github.com/SantiagoTorresBraun/AppBraun, que es lo que
// publica GitHub Pages). Cualquier clave escrita acá quedaría a la vista de
// todos en cuanto se haga push, y GitHub o Groq la revocarían sola.
//
// La clave se carga a mano, una sola vez, desde el editor de Apps Script:
//
//   Apps Script ▸ ⚙ Configuración del proyecto ▸ Propiedades del script
//   ▸ Agregar propiedad de secuencia de comandos
//        Propiedad: GROQ_API_KEY
//        Valor:     gsk_...(tu clave)
//   ▸ Guardar propiedades de secuencia de comandos
//
// Ahí queda guardada del lado del servidor: no viaja al navegador, no está en
// el repo y no se ve en el código. Después ejecutá probarAgente() para
// verificar, y publicá con Implementar ▸ Nueva versión.
//
// Para rotarla, se edita esa misma propiedad. No hace falta tocar el código.
//
// -------------------------------------------------------------------------
// DOS COSAS MÁS, SIN LAS CUALES ESTO NO ARRANCA
// -------------------------------------------------------------------------
// 1) PERMISO DE SALIDA A INTERNET. Este proyecto declara sus scopes A MANO en
//    appsscript.json, así que Google usa esa lista exacta y no deduce nada del
//    código. Hay que agregar:
//
//        "https://www.googleapis.com/auth/script.external_request"
//
//    Sin eso, UrlFetchApp no puede llamar a Groq y falla con
//    "You do not have permission to call UrlFetchApp.fetch".
//
// 2) En 01_backend_principal.gs, dentro de doPost, tiene que estar la línea
//    que rutea la acción "agente_consulta" hacia acá:
//
//        if (accion === "agente_consulta") return consultarAgenteIA(data);
// =========================================================================

var GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Verificado contra la API de Groq en 08/2026. Los llama-3.x que se usaban antes
// fueron dados de baja: si algún día este modelo también se discontinúa, la API
// devuelve 404 y la lista al día se consulta con listarModelosGroq().
var GROQ_MODELO_POR_DEFECTO = "openai/gpt-oss-120b";

function obtenerClaveGroq() {
  var clave = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if (!clave) {
    throw new Error("Falta cargar la clave de Groq en Configuración del proyecto ▸ Propiedades del script ▸ GROQ_API_KEY.");
  }
  return clave;
}

/**
 * Prueba rápida desde el editor: tiene que loguear "OK".
 */
function probarAgente() {
  var r = llamarGroq({
    modelo: GROQ_MODELO_POR_DEFECTO,
    temperatura: 0,
    json: false,
    esfuerzo: "low",
    mensajes: [{ role: "user", content: "Respondé solamente: OK" }]
  });
  Logger.log(r);
}

/**
 * Lista los modelos disponibles hoy con tu clave. Útil si algún día el modelo
 * configurado deja de existir y el agente empieza a tirar error 404.
 */
function listarModelosGroq() {
  var resp = UrlFetchApp.fetch("https://api.groq.com/openai/v1/models", {
    headers: { "Authorization": "Bearer " + obtenerClaveGroq() },
    muteHttpExceptions: true
  });
  var data = JSON.parse(resp.getContentText());
  (data.data || []).forEach(function (m) { Logger.log(m.id); });
}

/**
 * Acción "agente_consulta" del doPost. Recibe los mensajes que armó agente.js,
 * los reenvía a Groq y devuelve el texto de la respuesta.
 *
 * Entrada:  { _accion:"agente_consulta", mensajes:[...], modelo, temperatura, json, esfuerzo }
 * Salida:   { status:"ok", contenido:"..." }  |  { status:"error", message:"..." }
 */
function consultarAgenteIA(body) {
  try {
    var contenido = llamarGroq({
      modelo: body.modelo || GROQ_MODELO_POR_DEFECTO,
      temperatura: typeof body.temperatura === "number" ? body.temperatura : 0.2,
      json: !!body.json,
      esfuerzo: body.esfuerzo || "low",
      mensajes: body.mensajes || []
    });
    return respuestaAgente({ status: "ok", contenido: contenido });
  } catch (err) {
    return respuestaAgente({ status: "error", message: String(err && err.message ? err.message : err) });
  }
}

function llamarGroq(opciones) {
  var mensajes = opciones.mensajes || [];
  if (!mensajes.length) throw new Error("No llegó ningún mensaje para consultar.");

  var payload = {
    model: opciones.modelo || GROQ_MODELO_POR_DEFECTO,
    messages: mensajes,
    temperature: opciones.temperatura,
    max_tokens: 1600
  };
  // Modo JSON: obliga al modelo a devolver un objeto JSON válido (lo usa el
  // planificador para que el plan de consulta nunca venga con texto alrededor).
  if (opciones.json) payload.response_format = { type: "json_object" };
  // Estos modelos razonan antes de contestar y ese razonamiento se paga en
  // tokens de salida. En "low" el plan sale igual de bien gastando la mitad.
  if (opciones.esfuerzo) payload.reasoning_effort = opciones.esfuerzo;

  var opcionesFetch = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + obtenerClaveGroq() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // El plan gratuito de Groq permite 8.000 tokens por minuto y cada pregunta
  // gasta entre 1.500 y 3.000. Con dos personas preguntando al mismo tiempo se
  // toca el techo, y Groq contesta 429 diciendo exactamente cuántos segundos
  // hay que esperar. En vez de hacer fallar la consulta, esperamos y
  // reintentamos: el usuario ve el mismo "Consultando el Sheet…", solo que
  // tarda unos segundos más.
  var intentos = 0;
  while (true) {
    var respuesta = UrlFetchApp.fetch(GROQ_URL, opcionesFetch);
    var codigo = respuesta.getResponseCode();
    var texto = respuesta.getContentText();

    if (codigo >= 200 && codigo < 300) {
      var data = JSON.parse(texto);
      var elegido = data.choices && data.choices[0];
      if (!elegido || !elegido.message) throw new Error("Groq no devolvió contenido.");
      return String(elegido.message.content || "");
    }

    if (codigo === 429 && intentos < 2) {
      intentos++;
      Utilities.sleep(segundosDeEsperaGroq(texto) * 1000);
      continue;
    }

    if (codigo === 429) {
      throw new Error("Groq está saturado por el límite del plan gratuito. Probá de nuevo en un minuto.");
    }
    if (codigo === 401 || codigo === 403) {
      throw new Error("Groq rechazó la clave. Revisá la propiedad GROQ_API_KEY en Configuración del proyecto.");
    }
    if (codigo === 404) {
      throw new Error('El modelo "' + payload.model + '" ya no existe en Groq. Ejecutá listarModelosGroq() y actualizá AGENTE_CFG.modelo en agente.js.');
    }

    var detalle = texto;
    try { detalle = JSON.parse(texto).error.message; } catch (e) { /* se deja el texto crudo */ }
    throw new Error("Groq devolvió un error (" + codigo + "): " + detalle);
  }
}

// Groq avisa en el mensaje del 429 cuánto falta: "Please try again in 10.36s".
// Se le suma un segundo de colchón y se topea para no colgar la petición.
function segundosDeEsperaGroq(texto) {
  var espera = 8;
  var m = String(texto).match(/try again in ([\d.]+)s/i);
  if (m) espera = parseFloat(m[1]) + 1;
  if (!(espera > 0)) espera = 8;
  return Math.min(espera, 30);
}

function respuestaAgente(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
