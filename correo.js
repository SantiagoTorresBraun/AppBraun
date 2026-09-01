// =============================================================================
// CORREO.JS — Envío de reportes por correo electrónico (Carga y Calidad)
// -----------------------------------------------------------------------------
// QUÉ HACE
//   Manda el PDF del reporte por mail, con el cuerpo ya armado con los datos
//   generales, en un solo clic desde la columna "Acciones" del historial.
//   Sirve para CONTROL DE CARGA y para CONTROL DE CALIDAD: el motor de envío es
//   el mismo y lo propio de cada módulo se describe en REPORTES_CORREO (más
//   abajo). En Control de Carga, además, puede salir solo al guardar.
//
// DESDE QUÉ CUENTA SALE (importante)
//   1) PRIMERO intenta enviarlo desde el Gmail del usuario que inició sesión en
//      la app (API de Gmail, con permiso otorgado por el propio usuario). El mail
//      queda en la carpeta "Enviados" de esa persona y las respuestas le llegan
//      a ella. Para que esto funcione hay que completar GMAIL_CLIENT_ID (abajo).
//   2) SI ESO NO SE PUEDE (sin ID configurado, sin permiso, sin sesión de Google
//      o error de la API) lo manda igual por el backend de Apps Script, que sale
//      desde la cuenta dueña del script pero con el NOMBRE del usuario y con
//      "Responder a" apuntando a su correo. Nunca se queda sin enviar.
//
// El PDF se genera en el navegador con la MISMA función que el botón de descarga
// de cada módulo (generarPDFReporte de app.js / generarPDFCalidad de calidad.js,
// en modo 'blob'), así el adjunto es idéntico al que ya conocen los operarios.
// =============================================================================

// --- CONFIGURACIÓN OAUTH DE GMAIL -------------------------------------------
// Pegar acá el "ID de cliente de OAuth 2.0" (tipo Aplicación web) del proyecto
// de Google Cloud. Pasos en CUENTAS_Y_DESPLIEGUE.md, punto 7.
// Mientras esté vacío, la app envía todo por el backend (opción 2 de arriba).
const GMAIL_CLIENT_ID = "232148254903-qfa138v49uqnjuu32g9kkejmdjnu2ft2.apps.googleusercontent.com";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_DOMINIO = "braunrelacionescomerciales.com.ar";

// Tope de tamaño del adjunto. Gmail rebota los mails de más de 25 MB.
const CORREO_MAX_MB = 22;

// --- PREFERENCIAS GUARDADAS EN EL DISPOSITIVO --------------------------------
const CORREO_AUTO_KEY      = 'braun_correo_auto_v1';      // { "email@usuario": true }
const CORREO_RECIENTES_KEY = 'braun_correo_recientes_v1'; // ["destinatario@...", ...]

function correoAutoActivo() {
    try {
        const mapa = JSON.parse(localStorage.getItem(CORREO_AUTO_KEY) || '{}');
        return mapa[usuarioRegistroActual()] === true;
    } catch (e) { return false; }
}

function setCorreoAuto(valor) {
    try {
        const mapa = JSON.parse(localStorage.getItem(CORREO_AUTO_KEY) || '{}');
        mapa[usuarioRegistroActual()] = !!valor;
        localStorage.setItem(CORREO_AUTO_KEY, JSON.stringify(mapa));
    } catch (e) { /* localStorage lleno o bloqueado: no es crítico */ }
}

function destinatariosRecientes() {
    try {
        const lista = JSON.parse(localStorage.getItem(CORREO_RECIENTES_KEY) || '[]');
        return Array.isArray(lista) ? lista.slice(0, 6) : [];
    } catch (e) { return []; }
}

function recordarDestinatario(email) {
    if (!email) return;
    const limpio = String(email).trim().toLowerCase();
    const lista = destinatariosRecientes().filter(e => e !== limpio);
    lista.unshift(limpio);
    try { localStorage.setItem(CORREO_RECIENTES_KEY, JSON.stringify(lista.slice(0, 6))); } catch (e) {}
}

// --- AVISOS NO BLOQUEANTES (toast) -------------------------------------------
// El resto de la app usa alert(), pero para el envío automático un cartel modal
// obligaría al operario a tocar "Aceptar" en medio de la carga del camión.
function avisoCorreo(texto, tipo) {
    let cont = document.getElementById('toast-correo-cont');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'toast-correo-cont';
        document.body.appendChild(cont);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-correo ' + (tipo || 'info');
    const icono = tipo === 'error' ? 'fa-triangle-exclamation'
                : tipo === 'ok'    ? 'fa-circle-check'
                : 'fa-paper-plane';
    toast.innerHTML = '<i class="fas ' + icono + '"></i><span></span>';
    toast.querySelector('span').textContent = texto; // el texto puede traer el error crudo de Gmail
    cont.appendChild(toast);
    setTimeout(function () {
        toast.classList.add('saliendo');
        setTimeout(function () { toast.remove(); }, 400);
    }, tipo === 'error' ? 7000 : 4500);
}

// =============================================================================
// 1. ESTADO DEL ENVÍO DE CADA REGISTRO (lo que pinta el ícono del historial)
// =============================================================================
function estadoCorreoDeItem(item) {
    const estado = String((item && item.Estado_Correo) || '').toLowerCase();
    if (estado.indexOf('enviado') === 0) return 'enviado';
    if (estado.indexOf('error') !== -1 || estado.indexOf('rechaz') !== -1) return 'error';
    return 'pendiente';
}

// Botón de sobre para la columna "Acciones" del historial (de cualquier módulo).
function botonCorreoHistorialHtml(item, dataString, tipo) {
    const estado = estadoCorreoDeItem(item);
    const limpio = function (t) { return String(t || '').replace(/["<>&]/g, ' '); };
    const config = {
        enviado:   { icono: 'fa-envelope-circle-check', color: '#2e7d32', titulo: limpio(item.Estado_Correo) || 'Reporte enviado' },
        error:     { icono: 'fa-envelope-open-text',    color: '#c62828', titulo: limpio(item.Estado_Correo) || 'El último envío falló — tocá para reintentar' },
        pendiente: { icono: 'fa-envelope',              color: '#5f6368', titulo: 'Enviar reporte por correo' }
    }[estado];
    return '<button class="btn-table-action btn-correo-' + estado + '" onclick="abrirModalCorreoDesdeTabla(\'' + dataString + '\', \'' + (tipo || 'carga') + '\')" title="' + config.titulo + '">'
         +     '<i class="fas ' + config.icono + '" style="color:' + config.color + '; font-size:1.15rem; cursor:pointer;"></i>'
         + '</button>';
}

// =============================================================================
// 2. TIPOS DE REPORTE QUE SE PUEDEN ENVIAR
// -----------------------------------------------------------------------------
// El motor de envío (PDF + Gmail + plan B por backend + constancia del estado)
// es el mismo para todos. Lo único que cambia entre un Control de Carga y un
// Control de Calidad son estos datos, así que cada módulo se describe acá y no
// hay que duplicar nada más.
// =============================================================================
const REPORTES_CORREO = {
    carga: {
        etiqueta: 'Control de Carga',
        campoId: 'Id_Carga',
        accionEstado: 'actualizar_estado_correo',
        // Genera el PDF con la MISMA función que el botón de descarga
        generarPdf: function (dataString) { return generarPDFReporte(dataString, 'blob'); },
        asunto: function (item) {
            const referencia = resumenContratos(item) !== '-' ? resumenContratos(item) : resumenProductos(item);
            return ['Control de Carga ' + (item.Tipo_Carga || ''), referencia, item.Fecha || '']
                .map(function (p) { return String(p).trim(); }).filter(Boolean).join(' — ');
        },
        introMensaje: function (item) {
            return 'Te envío el reporte de control de carga correspondiente al ' + (item.Fecha || 'día de la fecha') + '.\n'
                 + 'El detalle completo, las verificaciones y el registro fotográfico están en el PDF adjunto.';
        },
        // Filas de la tabla de datos generales del cuerpo del mail
        filas: function (item) {
            const kg = (typeof fmtKg === 'function' ? fmtKg(item.Kg_Cargados) : (item.Kg_Cargados || '0')) + ' kg';
            const estatus = item.ESTATUS || 'ACEPTADO';
            const color = String(estatus).toUpperCase() === 'RECHAZADO' ? '#c62828' : '#2e7d32';
            return [
                ['Fecha', item.Fecha],
                ['Tipo de carga', item.Tipo_Carga],
                ['Producto/s', resumenProductos(item)],
                ['Contrato/s comercial', resumenContratos(item)],
                ['Chofer', item.Nombre_Chofer],
                ['Patente chasis', item.Patente_Chasis],
                ['Patente acoplado', item.Patente_Acoplado],
                ['Total Kg cargados', kg],
                ['Estatus', '<span style="background:' + color + ';color:#ffffff;padding:2px 10px;border-radius:10px;font-size:12px">' + estatus + '</span>'],
                ['Elaboró', item.Elaboro],
                ['Indicaciones de descarga', item.Indicaciones_Descarga],
                ['N° de registro', item.Id_Carga]
            ];
        },
        pieAdjunto: 'Se adjunta el reporte completo en PDF (verificaciones, firmas y el registro fotográfico del control).'
    },

    calidad: {
        etiqueta: 'Control de Calidad',
        campoId: 'Id_Calidad',
        accionEstado: 'actualizar_estado_correo_calidad',
        generarPdf: function (dataString) { return generarPDFCalidad(dataString, 'blob'); },
        asunto: function (item) {
            const grano = (typeof nombreGranoCalidad === 'function') ? nombreGranoCalidad(item.Grano) : (item.Grano || '');
            const referencia = item['N° Lote'] ? 'Lote ' + item['N° Lote'] : (item['Cliente'] || '');
            return ['Control de Calidad ' + grano, referencia, item['Fecha Analisis'] || '']
                .map(function (p) { return String(p).trim(); }).filter(Boolean).join(' — ');
        },
        introMensaje: function (item) {
            return 'Te envío el reporte de control de calidad del análisis del ' + (item['Fecha Analisis'] || 'día de la fecha') + '.\n'
                 + 'El detalle de calibres, defectos, los gráficos y las fotos de la muestra están en el PDF adjunto.';
        },
        filas: function (item) {
            const grano = (typeof nombreGranoCalidad === 'function') ? nombreGranoCalidad(item.Grano) : (item.Grano || '-');
            const pct = function (v) {
                if (v === undefined || v === null || v === '') return '';
                return (typeof formatNumeroAR === 'function' ? formatNumeroAR(v, 2) : v) + ' %';
            };
            const lotes = [item['N° Lote'], item['N° Lote BRC'], item['N° Lote Cliente/Planta']].filter(Boolean).join(' / ');
            return [
                ['Fecha de análisis', item['Fecha Analisis']],
                ['Grano', grano],
                ['Cliente', item['Cliente']],
                ['Variedad', item['Variedad']],
                ['Lote', lotes],
                ['Contrato comercial', item['Contrato Comercial']],
                ['Muestreo en', item['Muestreo en']],
                ['Kg', item['Kg'] ? (typeof fmtKg === 'function' ? fmtKg(item['Kg']) : item['Kg']) + ' kg' : ''],
                ['Humedad', pct(item['Humedad'])],
                ['Materia extraña', pct(item['Materia Extraña'])],
                ['Total granos buenos', pct(item['Total Granos Buenos'])],
                ['Total de daños', pct(item['Total de Daños'])],
                ['Insectos', item['Insectos Vivos o Muertos']],
                ['Olor', item['Olor']],
                ['Observaciones', item['observaciones']],
                ['N° de registro', item['Id_Calidad']]
            ];
        },
        pieAdjunto: 'Se adjunta el reporte completo en PDF (calibres, defectos, gráficos y fotos de la muestra).'
    }
};

function reporteDe(tipo) {
    return REPORTES_CORREO[tipo] || REPORTES_CORREO.carga;
}

// =============================================================================
// 2-B. ARMADO DEL CORREO (asunto + cuerpo con los datos generales)
// =============================================================================
function resumenProductos(item) {
    const productos = Array.isArray(item.Productos) ? item.Productos : [];
    const nombres = [...new Set(productos.map(p => p.producto).filter(Boolean))];
    return nombres.join(', ') || '-';
}

function resumenContratos(item) {
    const contratos = Array.isArray(item.Contratos) ? item.Contratos : [];
    const nombres = [...new Set(contratos.map(c => c.contrato_com).filter(Boolean))];
    return nombres.join(', ') || '-';
}

function asuntoReporte(item, tipo) {
    return reporteDe(tipo).asunto(item);
}

// Mensaje por defecto que el usuario puede editar antes de enviar.
function mensajeReportePorDefecto(item, tipo) {
    return 'Buen día,\n\n'
         + reporteDe(tipo).introMensaje(item) + '\n\n'
         + 'Cualquier consulta quedo a disposición.\n\n'
         + 'Saludos,\n' + (nombreUsuarioActual() || '');
}

// Cuerpo HTML institucional: el mensaje del usuario + una tabla con los datos
// generales, para que el destinatario no dependa de abrir el PDF para lo básico.
function cuerpoHtmlReporte(item, tipo, mensajeUsuario) {
    const reporte = reporteDe(tipo);
    const escapar = function (t) {
        return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    };
    const fila = function (etiqueta, valor) {
        // Los valores que ya vienen como HTML (el badge de estatus) se dejan pasar
        const contenido = (typeof valor === 'string' && valor.indexOf('<span') === 0) ? valor : escapar(valor);
        return '<tr><td style="padding:7px 12px;border-bottom:1px solid #eeeeee;color:#777777;white-space:nowrap">' + etiqueta + '</td>'
             + '<td style="padding:7px 12px;border-bottom:1px solid #eeeeee;color:#333333"><b>' + (contenido || '-') + '</b></td></tr>';
    };

    const mensajeHtml = escapar(mensajeUsuario).replace(/\n/g, '<br>');
    // Solo se muestran las filas que tienen dato: un control de calidad sin
    // observaciones no tiene por qué mostrar una fila vacía.
    const filasHtml = reporte.filas(item)
        .filter(function (f) { return f[1] !== undefined && f[1] !== null && String(f[1]).trim() !== ''; })
        .map(function (f) { return fila(f[0], f[1]); })
        .join('');

    return ''
    + '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">'
    +   '<div style="background:#a31e1e;color:#ffffff;padding:16px 22px;font-size:18px;font-weight:bold">Braun — ' + reporte.etiqueta + '</div>'
    +   '<div style="padding:20px 22px;color:#333333;font-size:14px;line-height:1.5">'
    +     '<p style="margin-top:0">' + mensajeHtml + '</p>'
    +     '<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:18px">' + filasHtml + '</table>'
    +     '<p style="margin-top:18px;color:#555555"><i>' + reporte.pieAdjunto + '</i></p>'
    +   '</div>'
    +   '<div style="background:#fafafa;border-top:1px solid #eeeeee;padding:12px 22px;color:#999999;font-size:11px;text-align:center">'
    +     'Correo generado automáticamente por la App Braun — ' + reporte.etiqueta
    +   '</div>'
    + '</div>';
}

// =============================================================================
// 3. GENERACIÓN DEL PDF ADJUNTO (reutiliza el generador del botón "Descargar")
// =============================================================================
async function generarAdjuntoPdf(item, tipo) {
    const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(item))));
    const resultado = await reporteDe(tipo).generarPdf(dataString);
    if (!resultado || !resultado.doc) throw new Error('No se pudo generar el PDF del reporte.');

    const dataUri = resultado.doc.output('datauristring');
    const base64 = dataUri.substring(dataUri.indexOf(',') + 1);
    const megas = (base64.length * 0.75) / (1024 * 1024);
    if (megas > CORREO_MAX_MB) {
        throw new Error('El PDF pesa ' + megas.toFixed(1) + ' MB y supera el límite de ' + CORREO_MAX_MB + ' MB que acepta Gmail. Descargalo y compartilo por otro medio.');
    }
    return { base64: base64, nombre: resultado.nombreArchivo, megas: megas };
}

// =============================================================================
// 4. ENVÍO POR LA API DE GMAIL (sale desde la cuenta del usuario logueado)
// =============================================================================
let gmailToken = null;       // { valor, vence } — solo en memoria, nunca se persiste
let gmailTokenClient = null;

function gmailConfigurado() {
    return !!GMAIL_CLIENT_ID
        && typeof google !== 'undefined'
        && !!google.accounts
        && !!google.accounts.oauth2;
}

// Pide (o renueva) el permiso de envío. Con interactivo=false intenta en
// silencio: si el usuario ya tiene sesión de Google y dio permiso antes, no ve
// ninguna ventana.
function obtenerTokenGmail(interactivo) {
    return new Promise(function (resolve, reject) {
        if (!gmailConfigurado()) return reject(new Error('Gmail no configurado en este dispositivo'));
        if (gmailToken && gmailToken.vence > Date.now() + 60000) return resolve(gmailToken.valor);

        if (!gmailTokenClient) {
            gmailTokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GMAIL_CLIENT_ID,
                scope: GMAIL_SCOPE,
                hd: GMAIL_DOMINIO,
                callback: function () {} // se reemplaza en cada pedido
            });
        }

        gmailTokenClient.callback = function (respuesta) {
            if (!respuesta || respuesta.error || !respuesta.access_token) {
                return reject(new Error(respuesta && respuesta.error ? respuesta.error : 'Permiso de Gmail no otorgado'));
            }
            gmailToken = {
                valor: respuesta.access_token,
                vence: Date.now() + ((respuesta.expires_in || 3600) * 1000)
            };
            resolve(gmailToken.valor);
        };
        gmailTokenClient.error_callback = function (err) {
            reject(new Error((err && err.type) || 'No se pudo abrir el permiso de Gmail'));
        };

        gmailTokenClient.requestAccessToken({
            prompt: interactivo ? 'consent' : '',
            login_hint: usuarioRegistroActual() || ''
        });
    });
}

// Base64 de un texto UTF-8 (mismo truco que usa el resto de la app).
function b64Utf8(texto) {
    return btoa(unescape(encodeURIComponent(texto)));
}

// Los encabezados MIME solo aceptan ASCII: los acentos van codificados
// (RFC 2047). Cada "palabra codificada" no puede pasar de 75 caracteres, así que
// el asunto se parte en varios trozos —cuidando de no cortar un carácter UTF-8
// por la mitad— y se pliega con un salto de línea + espacio.
function encabezadoMime(texto) {
    const original = String(texto || '');
    if (!/[^\x00-\x7F]/.test(original)) return original;

    const bytes = unescape(encodeURIComponent(original)); // 1 caracter = 1 byte
    const MAX_BYTES = 45; // 45 bytes -> 60 caracteres de base64 + 12 de envoltura
    const partes = [];
    let i = 0;
    while (i < bytes.length) {
        let fin = Math.min(i + MAX_BYTES, bytes.length);
        // No cortar en medio de una secuencia UTF-8 (los bytes 0x80-0xBF son continuación)
        while (fin > i && fin < bytes.length && bytes.charCodeAt(fin) >= 0x80 && bytes.charCodeAt(fin) < 0xC0) fin--;
        partes.push('=?UTF-8?B?' + btoa(bytes.substring(i, fin)) + '?=');
        i = fin;
    }
    return partes.join('\r\n ');
}

// Base64 cortado en líneas de 76 caracteres, como pide el estándar MIME.
function base64EnLineas(base64) {
    return (base64.match(/.{1,76}/g) || []).join('\r\n');
}

function armarMensajeMime(datos) {
    const limite = '----braun_' + String(datos.idCarga || 'reporte').replace(/[^A-Za-z0-9]/g, '');
    // Sin encabezado "From": lo completa Gmail con la cuenta que autorizó el
    // envío. Ponerlo a mano es riesgoso — si el usuario elige en la ventana de
    // Google una cuenta distinta a la de la app, Gmail rechaza el mensaje.
    const lineas = [
        'To: ' + datos.para
    ];
    if (datos.cc) lineas.push('Cc: ' + datos.cc);
    lineas.push(
        'Subject: ' + encabezadoMime(datos.asunto),
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' + limite + '"',
        '',
        '--' + limite,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        base64EnLineas(b64Utf8(datos.html)),
        '--' + limite,
        'Content-Type: application/pdf; name="' + datos.nombreAdjunto + '"',
        'Content-Disposition: attachment; filename="' + datos.nombreAdjunto + '"',
        'Content-Transfer-Encoding: base64',
        '',
        base64EnLineas(datos.pdfBase64),
        '--' + limite + '--',
        ''
    );
    return lineas.join('\r\n');
}

// Error de Gmail, marcado con si el mensaje PUDO haber salido igual.
//
// Toda la diferencia está acá: solo se puede reintentar por el backend cuando
// estamos SEGUROS de que Gmail no mandó nada. Si no lo sabemos y mandamos por
// las dudas, al destinatario le llega el reporte dos veces.
function errorDeGmail(mensaje, enviadoIncierto) {
    const err = new Error(mensaje);
    err.enviadoIncierto = !!enviadoIncierto;
    return err;
}

async function enviarConGmail(datos) {
    // Primero en silencio; si Google pide interacción, se abre la ventana de permiso.
    // Sin token el mensaje NO salió: es seguro caer al backend.
    let token;
    try {
        token = await obtenerTokenGmail(false);
    } catch (e) {
        try {
            token = await obtenerTokenGmail(true);
        } catch (e2) {
            throw errorDeGmail('No se pudo obtener permiso de Gmail: ' + (e2.message || e2), false);
        }
    }

    const mime = armarMensajeMime(datos);
    const megasMime = mime.length / (1024 * 1024);
    const arranque = Date.now();
    // Endpoint de subida (uploadType=media): admite hasta 35 MB de mensaje;
    // el endpoint común se queda corto apenas el PDF trae las fotos.
    let respuesta;
    try {
        respuesta = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'message/rfc822' },
            body: mime
        });
    } catch (errorRed) {
        // Se anotan el tamaño y cuánto tardó en cortarse: si siempre revienta
        // con mensajes grandes, el problema es de tamaño (proxy o antivirus de
        // la red); si corta enseguida y con cualquier tamaño, es otra cosa.
        console.warn('Gmail: se corto el envio. MIME=' + megasMime.toFixed(2) + ' MB, ' +
            (Date.now() - arranque) + ' ms, error=' + (errorRed && errorRed.name));
        // ACÁ NACÍAN LOS CORREOS DUPLICADOS.
        // El fetch se rompió sin respuesta: puede que no haya salido, o que Google
        // ya lo haya aceptado y la conexión se haya cortado al volver. Con un PDF
        // de varios MB es justo donde pasa. Antes esto contaba como "Gmail falló"
        // y se mandaba por el backend: si Gmail sí lo había mandado, al
        // destinatario le llegaban DOS, uno desde el Gmail del usuario y otro
        // desde la cuenta del script. No hay forma de saberlo, así que no se
        // reintenta solo.
        throw errorDeGmail('Se cortó la conexión con Gmail (' + megasMime.toFixed(1) + ' MB, ' +
            Math.round((Date.now() - arranque) / 1000) + 's) y no se pudo confirmar si el correo salió', true);
    }

    if (!respuesta.ok) {
        let detalle = '';
        try { const j = await respuesta.json(); detalle = (j.error && j.error.message) || ''; } catch (e) {}
        if (respuesta.status === 401 || respuesta.status === 403) gmailToken = null; // token vencido o revocado
        // 4xx: Google lo rechazó, seguro no salió → se puede usar el backend.
        // 5xx: se cayó del lado de Google, pudo haberlo tomado igual → no se reintenta.
        throw errorDeGmail(('Gmail rechazó el envío (' + respuesta.status + ') ' + detalle).trim(),
            respuesta.status >= 500);
    }
    return true;
}

// =============================================================================
// 5. ENVÍO POR EL BACKEND (plan B: sale desde la cuenta del script)
// =============================================================================
function enviarConBackend(datos) {
    return enviarAlBackend({
        _accion: 'enviar_correo_reporte',
        // De qué módulo es el reporte: define en qué hoja se deja la constancia
        Tipo_Reporte: datos.tipo || 'carga',
        Id_Carga: datos.idCarga,
        Id_Calidad: datos.idCarga,
        Grano: datos.grano || '',
        Correo: datos.para,
        Correo_Cc: datos.cc || '',
        Correo_Asunto: datos.asunto,
        Correo_Cuerpo_Html: datos.html,
        Correo_Nombre_Remitente: datos.deNombre + ' (App Braun)',
        Correo_Reply_To: datos.deEmail,
        Pdf_Base64: datos.pdfBase64,
        Pdf_Nombre: datos.nombreAdjunto,
        Estado_Correo: datos.estado,
        usuario_registro: datos.deEmail
    });
}

// =============================================================================
// 6. ORQUESTADOR: intenta Gmail y, si no puede, cae al backend
// =============================================================================
// Reportes que se están mandando AHORA MISMO, por clave "tipo:id".
//
// Sin esto se pueden solapar dos envíos del mismo reporte: el automático al
// guardar arranca en segundo plano (tarda: arma el PDF, pide token de Gmail) y,
// mientras tanto, el usuario abre el modal y toca "Enviar reporte". Los dos
// terminan mandando, y como cada uno puede resolver por un camino distinto
// (uno por Gmail, otro por el backend), llegan dos correos con distinto
// remitente. El chequeo de estado no alcanza: cuando el segundo arranca, el
// primero todavía no escribió "Enviado" en ningún lado.
const enviosEnCurso = new Set();

// --- REGISTRO DE LO QUE YA SE MANDÓ (en el dispositivo) ----------------------
// El Set de arriba solo cubre dos envíos que se pisan EN EL MISMO INSTANTE.
// No cubre el caso real: el automático al guardar termina y, un minuto después,
// alguien manda lo mismo desde el modal. Tampoco sobrevive a un F5.
//
// Y sobre todo: la guarda del backend NO PUEDE VER un correo que salió por el
// Gmail del usuario, porque ese envío nunca pasa por el servidor. Esta capa es
// la única que cubre los dos caminos, porque vive del lado del navegador.
const CORREO_ENVIADOS_KEY = 'braun_correo_enviados_v1';
const VENTANA_REENVIO_MIN = 10;

function claveReporte(tipo, id, correo) {
    return (tipo || 'carga') + '|' + (id || '') + '|' + String(correo || '').trim().toLowerCase();
}

function enviosRegistrados() {
    try { return JSON.parse(localStorage.getItem(CORREO_ENVIADOS_KEY)) || {}; }
    catch (e) { return {}; }
}

// Minutos desde que se mandó este mismo reporte al mismo destinatario, o null
// si no se mandó o si ya pasó la ventana.
function minutosDesdeEnvio(clave) {
    const marca = enviosRegistrados()[clave];
    if (!marca) return null;
    const minutos = (Date.now() - marca) / 60000;
    return (minutos >= 0 && minutos < VENTANA_REENVIO_MIN) ? minutos : null;
}

function registrarEnvioHecho(clave) {
    const previos = enviosRegistrados();
    const vigentes = {};
    // Se aprovecha para tirar lo viejo y que no crezca para siempre.
    Object.keys(previos).forEach(function (k) {
        if ((Date.now() - previos[k]) / 60000 < VENTANA_REENVIO_MIN) vigentes[k] = previos[k];
    });
    vigentes[clave] = Date.now();
    try { localStorage.setItem(CORREO_ENVIADOS_KEY, JSON.stringify(vigentes)); } catch (e) { }
}

async function enviarReportePorMail(item, tipo, opciones) {
    opciones = opciones || {};
    const reporte = reporteDe(tipo);
    const para = String(opciones.para || item.Correo || '').trim();
    if (!para || para.indexOf('@') === -1) throw new Error('Falta un correo de destino válido.');
    if (!navigator.onLine) throw new Error('No hay conexión a internet. El reporte no se puede enviar en este momento.');

    const claveEnvio = claveReporte(tipo, item[reporte.campoId], para);

    if (enviosEnCurso.has(claveEnvio)) {
        throw new Error('Ese reporte ya se está enviando en este momento. Esperá a que termine.');
    }

    // Ya salió hace poco por cualquiera de los dos caminos: no se repite solo.
    // El modal ofrece mandarlo igual (opciones.forzar); el envío automático no.
    const minutos = minutosDesdeEnvio(claveEnvio);
    if (minutos !== null && !opciones.forzar) {
        const err = new Error('Este reporte ya se envió a ' + para + ' hace ' +
            (minutos < 1 ? 'menos de un minuto' : Math.round(minutos) + ' minuto(s)') + '.');
        err.yaEnviado = true;
        err.minutos = minutos;
        err.para = para;
        throw err;
    }

    enviosEnCurso.add(claveEnvio);
    try {
        return await enviarReportePorMailInterno(item, tipo, opciones, reporte, para, claveEnvio);
    } finally {
        enviosEnCurso.delete(claveEnvio);
    }
}

async function enviarReportePorMailInterno(item, tipo, opciones, reporte, para, claveEnvio) {
    const adjunto = await generarAdjuntoPdf(item, tipo);
    const mensaje = opciones.mensaje || mensajeReportePorDefecto(item, tipo);
    const datos = {
        tipo: tipo || 'carga',
        idCarga: item[reporte.campoId] || '',
        grano: item.Grano || '',
        para: para,
        cc: String(opciones.cc || '').trim(),
        asunto: opciones.asunto || asuntoReporte(item, tipo),
        html: cuerpoHtmlReporte(item, tipo, mensaje),
        pdfBase64: adjunto.base64,
        nombreAdjunto: adjunto.nombre,
        deEmail: usuarioRegistroActual(),
        deNombre: nombreUsuarioActual() || 'App Braun'
    };

    // El texto del estado se arma ANTES de enviar y viaja también al backend,
    // para que la planilla y la pantalla digan exactamente lo mismo.
    let via = 'gmail';
    let estado = 'Enviado ' + fechaHoraCorta() + ' a ' + para;
    datos.estado = estado + ' (vía app)';

    if (gmailConfigurado()) {
        try {
            await enviarConGmail(datos);
        } catch (err) {
            if (err.enviadoIncierto) {
                // Mandar por el backend "por las dudas" es exactamente lo que le
                // hacía llegar el reporte dos veces al cliente. Ante la duda no se
                // manda: se avisa y que la persona decida mirando sus Enviados.
                const aviso = new Error((err.message || 'No se pudo confirmar el envío') +
                    '. Fijate en tu carpeta Enviados de Gmail: si el correo está, ya salió y no hay nada que hacer. ' +
                    'Si no está, volvé a tocar Enviar.');
                aviso.envioIncierto = true;
                throw aviso;
            }
            console.warn('No se pudo enviar desde el Gmail del usuario, se usa el backend:', err);
            via = 'backend';
        }
    } else {
        via = 'backend';
    }

    let duplicado = false;
    if (via === 'backend') {
        const respuesta = await enviarConBackend(datos);
        // El backend descarta un envío idéntico repetido dentro de unos minutos
        // y avisa con duplicado:true en vez de mandar el correo dos veces.
        duplicado = !!(respuesta && respuesta.respuesta && respuesta.respuesta.duplicado);
        estado = datos.estado + (respuesta && respuesta.sinConfirmar ? ' (sin confirmar)' : '');
    }

    // Llegar acá significa que el correo SALIÓ (por Gmail o por el backend).
    // Se anota antes que nada: si algo falla más abajo (la constancia en la
    // planilla, por ejemplo) y alguien reintenta, no se manda un segundo correo.
    registrarEnvioHecho(claveEnvio);

    recordarDestinatario(para);
    await registrarEstadoCorreo(item, tipo, para, estado, via);
    return { via: via, estado: estado, megas: adjunto.megas, duplicado: duplicado };
}

// Compatibilidad: el envío automático de Control de Carga sigue llamando así.
function enviarReporteDeCarga(item, opciones) {
    return enviarReportePorMail(item, 'carga', opciones);
}

function fechaHoraCorta() {
    const d = new Date();
    const dos = function (n) { return String(n).padStart(2, '0'); };
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
}

// Deja constancia del envío: en la planilla, en la lista en memoria y en la cola
// local (si el registro todavía no se sincronizó), y repinta el historial.
async function registrarEstadoCorreo(item, tipo, correo, estado, via) {
    const reporte = reporteDe(tipo);
    const id = item[reporte.campoId];
    item.Correo = correo;
    item.Estado_Correo = estado;

    // El envío por backend ya actualiza la planilla del lado del servidor.
    if (via !== 'backend' && !item._pendienteSync) {
        try {
            await enviarAlBackend({
                _accion: reporte.accionEstado,
                Id_Carga: id,          // Control de Carga
                Id_Calidad: id,        // Control de Calidad
                Grano: item.Grano || '',
                Correo: correo,
                Estado_Correo: estado
            });
        } catch (e) {
            console.warn('El correo salió, pero no se pudo dejar constancia en la planilla:', e);
        }
    }

    // Lista en memoria del módulo que corresponda
    const listaEnMemoria = (tipo === 'calidad')
        ? (typeof historialCalidad !== 'undefined' ? historialCalidad : null)
        : (typeof historialGeneral !== 'undefined' ? historialGeneral : null);
    if (Array.isArray(listaEnMemoria)) {
        const enMemoria = listaEnMemoria.find(r => r[reporte.campoId] === id);
        if (enMemoria) { enMemoria.Correo = correo; enMemoria.Estado_Correo = estado; }
    }

    actualizarEstadoCorreoEnColaLocal(tipo, id, correo, estado);

    if (typeof sincronizarEstadoCorreoFormulario === 'function' && tipo !== 'calidad') {
        sincronizarEstadoCorreoFormulario(id, correo, estado);
    }
    repintarHistorial(tipo);
}

function repintarHistorial(tipo) {
    if (tipo === 'calidad') {
        if (typeof filtrarYRenderizarCalidad === 'function') filtrarYRenderizarCalidad();
    } else if (typeof filtrarYRenderizarTabla === 'function') {
        filtrarYRenderizarTabla();
    }
}

function actualizarEstadoCorreoEnColaLocal(tipo, id, correo, estado) {
    if (!db || !id) return;
    const reporte = reporteDe(tipo);
    const almacen = (tipo === 'calidad') ? 'controles_calidad' : 'controles_carga';
    try {
        const store = db.transaction([almacen], 'readwrite').objectStore(almacen);
        store.openCursor().onsuccess = function (e) {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value[reporte.campoId] === id) {
                cursor.update(Object.assign({}, cursor.value, { Correo: correo, Estado_Correo: estado }));
            }
            cursor.continue();
        };
    } catch (e) { console.warn('No se pudo actualizar el estado del correo en la cola local:', e); }
}

// =============================================================================
// 7. MODAL DE ENVÍO (un clic desde el historial → revisar → enviar)
// =============================================================================
let registroCorreoActual = null;
let tipoCorreoActual = 'carga';

function abrirModalCorreoDesdeTabla(dataString, tipo) {
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(dataString))));
        abrirModalCorreo(item, tipo);
    } catch (e) {
        console.error('No se pudo leer el registro para enviarlo por correo:', e);
        alert('No se pudo abrir el envío por correo de este registro.');
    }
}

function abrirModalCorreo(item, tipo) {
    if (!item) return;
    if (!usuarioRegistroActual()) { alert('Iniciá sesión para poder enviar el reporte por correo.'); return; }

    registroCorreoActual = item;
    tipoCorreoActual = tipo || 'carga';
    const reporte = reporteDe(tipoCorreoActual);

    document.getElementById('correo-titulo').textContent = 'Enviar reporte de ' + reporte.etiqueta;
    document.getElementById('correo-de').textContent = nombreUsuarioActual() + ' <' + usuarioRegistroActual() + '>';
    document.getElementById('correo-para').value = item.Correo || '';
    document.getElementById('correo-cc').value = '';
    document.getElementById('correo-copia-mia').checked = false;
    document.getElementById('correo-asunto').value = asuntoReporte(item, tipoCorreoActual);
    document.getElementById('correo-mensaje').value = mensajeReportePorDefecto(item, tipoCorreoActual);
    document.getElementById('correo-auto').checked = correoAutoActivo();
    document.getElementById('correo-adjunto').innerHTML =
        '<i class="fas fa-file-pdf"></i> ' + nombreArchivoPdf(item, tipoCorreoActual);

    // El envío automático al guardar hoy existe solo en Control de Carga
    document.getElementById('correo-auto').closest('.correo-auto-box').classList.toggle('hidden', tipoCorreoActual === 'calidad');
    document.getElementById('correo-via').textContent = gmailConfigurado()
        ? 'El correo sale desde tu Gmail y queda en tu carpeta Enviados.'
        : 'El correo sale desde la app, con tu nombre y "Responder a" tu correo.';

    // Estado del último envío de este registro
    const aviso = document.getElementById('correo-ultimo-envio');
    const estado = estadoCorreoDeItem(item);
    const detalle = String(item.Estado_Correo || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (estado === 'enviado') {
        aviso.className = 'correo-aviso enviado';
        aviso.innerHTML = '<i class="fas fa-circle-check"></i> Este reporte ya se envió: ' + detalle;
    } else if (estado === 'error') {
        aviso.className = 'correo-aviso error';
        aviso.innerHTML = '<i class="fas fa-triangle-exclamation"></i> El último intento falló: ' + detalle;
    } else {
        aviso.className = 'correo-aviso hidden';
    }

    // Accesos rápidos a los últimos destinatarios usados
    const chips = document.getElementById('correo-chips');
    const recientes = destinatariosRecientes();
    chips.innerHTML = recientes.length
        ? recientes.map(function (e) {
            return '<button type="button" class="correo-chip" onclick="usarDestinatario(\'' + e + '\')">' + e + '</button>';
          }).join('')
        : '';

    document.getElementById('modal-envio-correo').classList.add('active');
    // Recién ahora el modal es visible: hasta que no lo es, scrollHeight da 0 y
    // no se puede medir cuánto ocupa el texto.
    ajustarAltoMensaje();
}

// El campo "Mensaje" crece con su contenido, así se ve el cuerpo entero del
// correo sin scrollear adentro de un cuadrito.
//
// Una altura fija no alcanzaba: el mensaje por defecto son ocho renglones
// (saludo, presentación, cierre y firma) y quedaban cortados. Y como el modal
// es un contenedor flex en columna, sus hijos se achican solos cuando el
// contenido no entra — por eso el rows="6" del HTML no servía de nada.
function ajustarAltoMensaje() {
    const caja = document.getElementById('correo-mensaje');
    if (!caja) return;
    caja.style.height = 'auto';              // sin esto solo podría crecer, nunca achicarse
    const alto = caja.scrollHeight + 2;      // +2 por los bordes, para que no quede un renglón cortado
    caja.style.height = Math.min(Math.max(alto, 140), 400) + 'px';
}

function usarDestinatario(email) {
    document.getElementById('correo-para').value = email;
}

// Nombre del PDF que se muestra en el chip de "Adjunto" del modal.
function nombreArchivoPdf(item, tipo) {
    if (tipo === 'calidad') {
        const grano = (typeof nombreGranoCalidad === 'function') ? nombreGranoCalidad(item.Grano) : (item.Grano || '');
        return 'Calidad_' + String(grano).replace(/\s+/g, '_') + '_' + (item['Fecha Analisis'] || '') + '_' + (item['Id_Calidad'] || '') + '.pdf';
    }
    return 'Reporte_Carga_' + (item.Tipo_Carga || 'PT') + '_' + (item.Id_Carga || 'Braun') + '.pdf';
}

function cerrarModalCorreo() {
    document.getElementById('modal-envio-correo').classList.remove('active');
    registroCorreoActual = null;
}

async function confirmarEnvioCorreo() {
    if (!registroCorreoActual) return;

    const para = document.getElementById('correo-para').value.trim();
    if (!para || para.indexOf('@') === -1) { alert('Ingresá un correo de destino válido.'); return; }

    let cc = document.getElementById('correo-cc').value.trim();
    if (document.getElementById('correo-copia-mia').checked) {
        const yo = usuarioRegistroActual();
        cc = cc ? cc + ', ' + yo : yo;
    }

    setCorreoAuto(document.getElementById('correo-auto').checked);

    const boton = document.getElementById('btn-confirmar-correo');
    const textoOriginal = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando PDF y enviando...';

    const item = registroCorreoActual;
    const opcionesEnvio = {
        para: para,
        cc: cc,
        asunto: document.getElementById('correo-asunto').value.trim(),
        mensaje: document.getElementById('correo-mensaje').value
    };
    try {
        let resultado;
        try {
            resultado = await enviarReportePorMail(item, tipoCorreoActual, opcionesEnvio);
        } catch (err) {
            // Ya se mandó hace poco. No se decide por el usuario: se le pregunta,
            // porque puede querer reenviarlo a propósito (corrigió el mensaje,
            // el destinatario no lo recibió, etc.).
            if (!err.yaEnviado) throw err;
            const seguir = confirm(err.message + '\n\n¿Querés mandarlo igual?');
            if (!seguir) {
                cerrarModalCorreo();
                avisoCorreo('No se envió: el reporte ya había salido a ' + para + '.', 'info');
                return;
            }
            opcionesEnvio.forzar = true;
            resultado = await enviarReportePorMail(item, tipoCorreoActual, opcionesEnvio);
        }
        cerrarModalCorreo();
        if (resultado.duplicado) {
            avisoCorreo('Ese reporte ya se había enviado a ' + para + ' hace instantes: no se mandó de nuevo.', 'info');
        } else {
            avisoCorreo(resultado.via === 'gmail'
                ? 'Reporte enviado a ' + para + ' desde tu Gmail.'
                : 'Reporte enviado a ' + para + '.', 'ok');
        }
    } catch (error) {
        if (error.envioIncierto) {
            // NO es un fallo: Gmail probablemente lo mandó y lo único que se
            // perdió fue la confirmación. Decir "no se pudo enviar" y dejar
            // "Error" en la planilla de un correo que el cliente sí recibió es
            // peor que admitir que no lo sabemos.
            console.warn('Envío sin confirmar:', error);
            marcarEnvioSinConfirmar(item, tipoCorreoActual, para);
            cerrarModalCorreo();
            avisoCorreo('El envío a ' + para + ' quedó SIN CONFIRMAR. Revisá tu carpeta Enviados de Gmail: ' +
                'si el correo está, ya salió. Si no está, volvé a mandarlo.', 'info');
        } else {
            console.error('Error al enviar el reporte por correo:', error);
            marcarErrorCorreo(item, tipoCorreoActual, para, error);
            avisoCorreo('No se pudo enviar el reporte: ' + (error.message || 'error desconocido'), 'error');
        }
    } finally {
        boton.disabled = false;
        boton.innerHTML = textoOriginal;
    }
}

// El envío no se pudo confirmar: probablemente salió. Se deja constancia con
// ese texto exacto, ni "Enviado" ni "Error", para que quien mire la planilla
// sepa que hay que verificarlo y no vuelva a mandarlo a ciegas.
function marcarEnvioSinConfirmar(item, tipo, para) {
    const reporte = reporteDe(tipo);
    const id = item[reporte.campoId];
    const estado = 'Sin confirmar ' + fechaHoraCorta() + ' a ' + para + ' — revisá Enviados de Gmail';
    item.Correo = para;
    item.Estado_Correo = estado;

    const listaEnMemoria = (tipo === 'calidad')
        ? (typeof historialCalidad !== 'undefined' ? historialCalidad : null)
        : (typeof historialGeneral !== 'undefined' ? historialGeneral : null);
    if (Array.isArray(listaEnMemoria)) {
        const enMemoria = listaEnMemoria.find(r => r[reporte.campoId] === id);
        if (enMemoria) { enMemoria.Correo = para; enMemoria.Estado_Correo = estado; }
    }

    actualizarEstadoCorreoEnColaLocal(tipo, id, para, estado);
    if (typeof sincronizarEstadoCorreoFormulario === 'function' && tipo !== 'calidad') {
        sincronizarEstadoCorreoFormulario(id, para, estado);
    }
    repintarHistorial(tipo);
}

function marcarErrorCorreo(item, tipo, para, error) {
    const reporte = reporteDe(tipo);
    const id = item[reporte.campoId];
    const estado = ('Error ' + fechaHoraCorta() + ': ' + ((error && error.message) || 'no se pudo enviar')).substring(0, 180);
    item.Estado_Correo = estado;

    const listaEnMemoria = (tipo === 'calidad')
        ? (typeof historialCalidad !== 'undefined' ? historialCalidad : null)
        : (typeof historialGeneral !== 'undefined' ? historialGeneral : null);
    if (Array.isArray(listaEnMemoria)) {
        const enMemoria = listaEnMemoria.find(r => r[reporte.campoId] === id);
        if (enMemoria) enMemoria.Estado_Correo = estado;
    }

    actualizarEstadoCorreoEnColaLocal(tipo, id, item.Correo || para, estado);
    if (typeof sincronizarEstadoCorreoFormulario === 'function' && tipo !== 'calidad') {
        sincronizarEstadoCorreoFormulario(id, item.Correo || para, estado);
    }
    repintarHistorial(tipo);
}

// =============================================================================
// 8. ENVÍO AUTOMÁTICO AL GUARDAR (opcional, lo activa cada usuario)
// =============================================================================
// Se dispara solo con registros NUEVOS que ya traen destinatario cargado.
// Nunca reenvía un reporte que ya salió.
function intentarEnvioAutomatico(registro) {
    if (!correoAutoActivo()) return;
    if (!registro || !registro.Correo || registro.Correo.indexOf('@') === -1) return;
    if (estadoCorreoDeItem(registro) === 'enviado') return;
    if (!navigator.onLine) {
        avisoCorreo('Sin conexión: el reporte no se envió por correo. Mandalo desde el historial cuando vuelva la señal.', 'error');
        return;
    }

    avisoCorreo('Enviando el reporte a ' + registro.Correo + '...', 'info');
    enviarReporteDeCarga(registro, {})
        .then(function (res) {
            avisoCorreo('Reporte enviado a ' + registro.Correo + (res.via === 'gmail' ? ' desde tu Gmail' : '') + '.', 'ok');
        })
        .catch(function (err) {
            // Que la guarda antiduplicado lo frene NO es un error: el reporte ya
            // salió. Marcarlo como fallido dejaría "Error" en la planilla de un
            // correo que el cliente sí recibió, que es peor que no decir nada.
            if (err.yaEnviado) {
                console.info('Envío automático omitido: el reporte ya había salido.', err.message);
                return;
            }
            console.error('Envío automático fallido:', err);
            marcarErrorCorreo(registro, 'carga', registro.Correo, err);
            avisoCorreo('El control se guardó, pero el correo no salió: ' + (err.message || '') + ' Reintentá desde el historial.', 'error');
        });
}
