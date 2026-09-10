// ============================================================================
//  render-historial.js — que los historiales no maten al celular
// ----------------------------------------------------------------------------
//  Hallazgo 5 de la auditoría. Medido sobre los datos reales del 09/09/2026:
//  el historial de Control de Carga generaba **54,2 MB de HTML**, y una sola
//  fila llegaba a **12,34 MB**. Y todo eso se rehacía entero con CADA TECLA que
//  el operario tocaba en el buscador.
//
//  EL CULPABLE NO ERA LA CANTIDAD DE FILAS
//  ----------------------------------------
//  Cada fila hacía esto:
//
//      const dataString = btoa(... JSON.stringify(item) ...);
//
//  o sea: metía el REGISTRO ENTERO —con sus fotos en base64 adentro, porque
//  las fotos viven dentro del Sheet (Hallazgo 6)— convertido otra vez a base64,
//  y lo pegaba NUEVE VECES en el HTML de esa fila, una por cada onclick.
//
//  Una carga con fotos pesa ~680 KB. En base64, ~900 KB. Por nueve, 8 MB.
//  En una fila de tabla.
//
//  La solución no es paginar: es no meter el dato en el HTML. Las filas
//  guardan una clave corta ("r7") y el registro queda en memoria, que es donde
//  siempre estuvo. Sin las fotos embebidas, las 253 filas ocupan ~296 KB:
//  **187 veces menos**.
//
//  Además: paginado de a 50, DocumentFragment en vez de mil appendChild, y
//  medio segundo de espera antes de filtrar para no rehacer la tabla con cada
//  tecla.
// ============================================================================

// Cuántas filas se dibujan de entrada y cuántas suma cada "Ver más".
const FILAS_POR_PAGINA = 50;

// Cuánto se espera después de la última tecla antes de filtrar.
const ESPERA_FILTRO_MS = 300;

// ---------------------------------------------------------------------------
// 1. Debounce: no filtrar con cada tecla
// ---------------------------------------------------------------------------
// "braun" son 5 teclas = 5 renders completos del historial. Con esto es uno
// solo, 300 ms después de que el operario dejó de escribir.
function rebotar(fn, ms) {
    let reloj = null;
    return function () {
        const args = arguments;
        const esto = this;
        clearTimeout(reloj);
        reloj = setTimeout(function () { fn.apply(esto, args); }, ms || ESPERA_FILTRO_MS);
    };
}

// ---------------------------------------------------------------------------
// 2. El registro se queda en memoria, no en el HTML
// ---------------------------------------------------------------------------
// Cada tabla tiene su propia libreta. La fila solo lleva la clave.
const LIBRETAS = {};
let contadorClaves = 0;

function libretaDe(tabla) {
    if (!LIBRETAS[tabla]) LIBRETAS[tabla] = new Map();
    return LIBRETAS[tabla];
}

// Se vacía al empezar un render completo. Ojo: NO al agregar una página más,
// porque las filas que ya están en pantalla siguen apuntando a sus claves.
function vaciarLibreta(tabla) {
    libretaDe(tabla).clear();
}

// Devuelve la clave corta que va en el onclick de la fila.
function anotarEnLibreta(tabla, item) {
    const clave = 'r' + (++contadorClaves);
    libretaDe(tabla).set(clave, item);
    return clave;
}

// Traduce lo que llegó desde un onclick al registro de verdad.
//
// Acepta tres cosas a propósito, para no romper nada de lo que ya existía:
//   - un objeto        -> se devuelve tal cual (las pantallas de detalle ya
//                         tienen el registro; no tiene sentido que lo pasen a
//                         base64 para que acá se lo vuelva a decodificar)
//   - una clave "r7"   -> se busca en la libreta
//   - un base64        -> se decodifica, como se hacía antes
function resolverRegistro(entrada) {
    if (!entrada) return null;
    if (typeof entrada === 'object') return entrada;

    const texto = String(entrada);

    const claves = Object.keys(LIBRETAS);
    for (let i = 0; i < claves.length; i++) {
        const libreta = LIBRETAS[claves[i]];
        if (libreta.has(texto)) return libreta.get(texto);
    }

    // Compatibilidad con el formato viejo.
    try {
        return JSON.parse(decodeURIComponent(escape(atob(texto))));
    } catch (e) {
        console.error('[historial] No se pudo leer el registro:', e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// 3. Paginado
// ---------------------------------------------------------------------------
const filasVisibles = {};

function visiblesDe(tabla) {
    if (!filasVisibles[tabla]) filasVisibles[tabla] = FILAS_POR_PAGINA;
    return filasVisibles[tabla];
}

function reiniciarPaginado(tabla) {
    filasVisibles[tabla] = FILAS_POR_PAGINA;
}

function verMasFilas(tabla) {
    filasVisibles[tabla] = visiblesDe(tabla) + FILAS_POR_PAGINA;
    return filasVisibles[tabla];
}

// Dibuja debajo de la tabla el "Mostrando 50 de 253" y el botón de Ver más.
//   idCuerpo: el <tbody>, que ya existe en el HTML
//   total:    cuántas filas hay después de filtrar
//   mostradas: cuántas se dibujaron
//   alVerMas: qué hacer cuando tocan el botón
function pieDeTabla(idCuerpo, total, mostradas, alVerMas) {
    try {
        const cuerpo = document.getElementById(idCuerpo);
        if (!cuerpo) return;
        const tabla = cuerpo.closest('table') || cuerpo.parentNode;
        if (!tabla || !tabla.parentNode) return;

        const idPie = 'pie-tabla-' + idCuerpo;
        let pie = document.getElementById(idPie);

        // Nada que paginar: no se muestra nada.
        if (total <= FILAS_POR_PAGINA) {
            if (pie) pie.remove();
            return;
        }

        if (!pie) {
            pie = document.createElement('div');
            pie.id = idPie;
            pie.className = 'pie-tabla-historial';
            tabla.parentNode.insertBefore(pie, tabla.nextSibling);
        }
        pie.innerHTML = '';

        const cuenta = document.createElement('span');
        cuenta.className = 'pie-tabla-cuenta';
        cuenta.textContent = 'Mostrando ' + mostradas + ' de ' + total;
        pie.appendChild(cuenta);

        if (mostradas < total) {
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'pie-tabla-vermas';
            const faltan = total - mostradas;
            const proximas = Math.min(FILAS_POR_PAGINA, faltan);
            boton.textContent = 'Ver ' + proximas + ' más';
            boton.onclick = alVerMas;
            pie.appendChild(boton);
        }
    } catch (e) {
        console.warn('[historial] No se pudo dibujar el pie de la tabla:', e);
    }
}

window.rebotar = rebotar;
window.resolverRegistro = resolverRegistro;
window.anotarEnLibreta = anotarEnLibreta;
window.vaciarLibreta = vaciarLibreta;
window.visiblesDe = visiblesDe;
window.reiniciarPaginado = reiniciarPaginado;
window.verMasFilas = verMasFilas;
window.pieDeTabla = pieDeTabla;
