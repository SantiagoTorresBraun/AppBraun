// ============================================================================
//  historial-local.js — copia del historial en el celular, para verlo sin señal
// ----------------------------------------------------------------------------
//  Hallazgo 13 de la auditoría. Antes, sin conexión, Control de Carga, Calidad,
//  Contratos y Ticketera mostraban una tabla EN BLANCO y sin ningún mensaje: el
//  operario no podía distinguir "no hay señal" de "no hay registros".
//
//  La causa era que el historial que baja del Sheet vivía solo en memoria y se
//  perdía al cerrar la app. Acá se guarda una copia en el navegador.
//
//  LO IMPORTANTE: la copia va SIN FOTOS NI FIRMAS. Medido sobre los datos
//  reales del 09/09/2026: el historial de Carga pesa 4,50 MB y el 92% de eso
//  son fotos y firmas en base64 metidas adentro del Sheet (Hallazgo 6). Sin
//  ellas son 540 KB. Y esas 6 cargas con foto pesan 679 KB cada una: si todos
//  empezaran a sacar fotos como corresponde, guardar el historial completo
//  serían ~168 MB en el teléfono del operario.
//
//  Producción es la excepción y NO usa este archivo: ya guarda sus muestreos
//  enteros (con la foto en base64) en IndexedDB y nunca los borra. Por eso es
//  el único módulo que hoy funciona bien sin señal.
// ============================================================================

// Cada módulo guarda bajo su propia clave: braun_historial_cargas, etc.
const HL_PREFIJO = 'braun_historial_';

// Techo por módulo. localStorage da unos 5 MB para todo el dominio, y la app ya
// usa una parte (catálogos, sesión, correos enviados). Con 1,5 MB entran unas
// 700 cargas sin fotos; de ahí para arriba se quedan las más nuevas.
const HL_PRESUPUESTO_BYTES = 1500000;

// Un valor de texto más largo que esto es una foto o una firma en base64.
// Se filtra por TAMAÑO y no por nombre de campo a propósito: si mañana alguien
// agrega "Foto_Precinto", queda cubierto sin tocar este archivo.
const HL_LIMITE_CAMPO = 2000;

// ---------------------------------------------------------------------------
// Sacar los adjuntos pesados
// ---------------------------------------------------------------------------
function hlEsAdjunto(valor) {
    if (typeof valor !== 'string') return false;
    return valor.indexOf('data:') === 0 || valor.length > HL_LIMITE_CAMPO;
}

// Devuelve una copia del registro sin las fotos ni las firmas. El campo NO se
// borra: queda en "" para que el resto de la app lo siga encontrando y no
// tenga que preguntarse si existe. Se marca _sinFotos para que la pantalla de
// detalle pueda decir "no están disponibles sin conexión" en vez de mentir con
// "no hay fotos registradas".
function hlSinAdjuntos(registro) {
    if (!registro || typeof registro !== 'object') return registro;
    const limpio = {};
    let saco = false;
    Object.keys(registro).forEach(function (campo) {
        if (hlEsAdjunto(registro[campo])) {
            limpio[campo] = '';
            saco = true;
        } else {
            limpio[campo] = registro[campo];
        }
    });
    if (saco) limpio._sinFotos = true;
    return limpio;
}

// ---------------------------------------------------------------------------
// Ordenar por fecha para saber cuáles son los más nuevos
// ---------------------------------------------------------------------------
// Los registros NO vienen ordenados del Sheet, y las fechas están en dos
// formatos distintos: Carga usa "2026-09-01" y Calidad mezcla ese con
// "8/10/2025". Si se recortara sin ordenar, se guardarían registros al azar.
function hlParsearFecha(texto) {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(texto);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);      // D/M/AAAA, es-AR
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return null;
}

const HL_CAMPOS_FECHA = ['Fecha', 'Fecha Analisis', 'fecha', 'Fecha_Creacion', 'fecha_creacion'];

function hlFechaDe(registro) {
    for (let i = 0; i < HL_CAMPOS_FECHA.length; i++) {
        const valor = registro[HL_CAMPOS_FECHA[i]];
        if (!valor) continue;
        const t = hlParsearFecha(String(valor));
        if (t !== null) return t;
    }
    return -1;   // sin fecha reconocible: al final de la fila
}

// Los más nuevos primero, y se corta cuando se llega al presupuesto.
function hlRecortar(registros) {
    const ordenados = registros.slice().sort(function (a, b) {
        return hlFechaDe(b) - hlFechaDe(a);
    });
    const salida = [];
    let bytes = 2;
    for (let i = 0; i < ordenados.length; i++) {
        const largo = JSON.stringify(ordenados[i]).length + 1;
        if (bytes + largo > HL_PRESUPUESTO_BYTES) break;
        salida.push(ordenados[i]);
        bytes += largo;
    }
    return salida;
}

// ---------------------------------------------------------------------------
// Guardar y leer
// ---------------------------------------------------------------------------
function guardarHistorialLocal(clave, registros) {
    if (!Array.isArray(registros)) return false;
    try {
        let lista = hlRecortar(registros.map(hlSinAdjuntos));

        // Si igual no entra (el teléfono está lleno, o hay otra pestaña que
        // ocupó el espacio), se guarda la mitad y se reintenta. Es preferible
        // tener la mitad del historial que no tener nada.
        //
        // El bucle no tiene tope de intentos a propósito: con un tope, si
        // después del último la lista todavía tenía registros, se salía por
        // abajo devolviendo false SIN AVISAR NADA. Un fallo mudo. Ahora se
        // parte hasta que entra o hasta que ya no queda nada que partir, y
        // en ese caso tira y el catch de abajo lo deja escrito en consola.
        while (true) {
            try {
                localStorage.setItem(HL_PREFIJO + clave, JSON.stringify({
                    fecha: new Date().toISOString(),
                    total: registros.length,
                    registros: lista
                }));
                return true;
            } catch (e) {
                if (lista.length < 2) throw e;
                lista = lista.slice(0, Math.floor(lista.length / 2));
            }
        }
    } catch (e) {
        console.warn('[historial] No se pudo guardar la copia local de "' + clave + '": ' + (e && e.name));
        // Una copia a medias es peor que ninguna: se borra.
        try { localStorage.removeItem(HL_PREFIJO + clave); } catch (e2) { }
    }
    return false;
}

// Devuelve { registros, fecha, total } o null si no hay copia.
function leerHistorialLocal(clave) {
    try {
        const crudo = localStorage.getItem(HL_PREFIJO + clave);
        if (!crudo) return null;
        const dato = JSON.parse(crudo);
        if (!dato || !Array.isArray(dato.registros)) return null;
        return {
            registros: dato.registros,
            fecha: dato.fecha || null,
            total: typeof dato.total === 'number' ? dato.total : dato.registros.length
        };
    } catch (e) {
        return null;
    }
}

function borrarHistorialLocal() {
    ['cargas', 'calidad', 'tickets'].forEach(function (c) {
        try { localStorage.removeItem(HL_PREFIJO + c); } catch (e) { }
    });
    console.log('[historial] Copias locales borradas.');
}

// ---------------------------------------------------------------------------
// El cartel de "estos datos son de antes"
// ---------------------------------------------------------------------------
// Sin esto el arreglo sería medio peligroso: el operario vería una tabla llena
// y creería que está mirando el estado de ahora.
function hlTextoFecha(iso) {
    try {
        // Ojo: new Date(null) no es inválida, es el 1/1/1970. Sin este
        // chequeo el cartel mostraba "31/12 21:00" como fecha de los datos.
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return dd + '/' + mm + ' ' + hh + ':' + mi;
    } catch (e) {
        return '';
    }
}

// Muestra (o saca) el cartel arriba de la tabla del módulo.
//   idCuerpoTabla: el <tbody> de la tabla, que ya existe en el HTML
//   info:          lo que devolvió leerHistorialLocal(), o null para sacarlo
function avisoHistorialGuardado(idCuerpoTabla, info) {
    try {
        const cuerpo = document.getElementById(idCuerpoTabla);
        if (!cuerpo) return;
        const tabla = cuerpo.closest('table') || cuerpo.parentNode;
        if (!tabla || !tabla.parentNode) return;

        const idAviso = 'aviso-guardado-' + idCuerpoTabla;
        let aviso = document.getElementById(idAviso);

        if (!info) {
            if (aviso) aviso.remove();
            return;
        }

        if (!aviso) {
            aviso = document.createElement('div');
            aviso.id = idAviso;
            aviso.className = 'aviso-historial-guardado';
            tabla.parentNode.insertBefore(aviso, tabla);
        }

        const cuando = hlTextoFecha(info.fecha);
        const recortado = info.total > info.registros.length
            ? ' (los ' + info.registros.length + ' más nuevos de ' + info.total + ')'
            : '';
        aviso.innerHTML =
            '<i class="fas fa-wifi" aria-hidden="true"></i> Sin conexión: estás viendo la copia guardada' +
            (cuando ? ' del <strong>' + cuando + '</strong>' : '') + recortado +
            '. Las fotos y firmas no se guardan en el celular.';
    } catch (e) {
        // Un cartel que falla no puede tumbar el historial.
    }
}

window.guardarHistorialLocal = guardarHistorialLocal;
window.leerHistorialLocal = leerHistorialLocal;
window.borrarHistorialLocal = borrarHistorialLocal;
window.avisoHistorialGuardado = avisoHistorialGuardado;
