// =============================================================================
// NOVEDADES — la campanita del encabezado
// -----------------------------------------------------------------------------
// Lo que cambió en cada versión, contado para los usuarios (no para nosotros).
// Para avisar algo nuevo: agregar una entrada ARRIBA DE TODO en NOVEDADES y
// subir VERSION en sw.js en el mismo commit.
//
//   id         → único y creciente; conviene usar la misma VERSION de sw.js.
//   importante → true: se abre sola una vez, al entrar, para cada usuario.
//                false: solo suma al contador de la campanita.
//
// Qué vio cada usuario se guarda en este dispositivo (localStorage), por email.
// =============================================================================

const NOVEDADES = [
    {
        id: 31,
        version: 'v31',
        fecha: '2026-11-11',
        titulo: 'Nueva imagen de la app',
        importante: true,
        items: [
            'Pantalla de inicio renovada y el logo de Braun en alta calidad.',
            'Nueva letra, más clara para leer en el celular.',
            'Esta campanita: acá vas a ver lo nuevo de cada versión.',
            'La app se actualiza sola en la pantalla de inicio. Si ya escribiste tu contraseña, se actualiza apenas entrás.'
        ]
    },
    {
        id: 30,
        version: 'v30',
        fecha: '2026-11-11',
        titulo: 'Más seguridad en los correos',
        importante: false,
        items: [
            'Los reportes que salen por el servidor llevan tu nombre como remitente.',
            'Al iniciar sesión, la app trae todo lo nuevo y sube lo que tenías pendiente.'
        ]
    },
    {
        id: 29,
        version: 'v29',
        fecha: '2026-11-11',
        titulo: 'Tus datos, más seguros con mala señal',
        importante: false,
        items: [
            'Si corregís un registro que todavía no terminó de subir, la corrección ya no se pierde.',
            'Las fotos de los muestreos se reintentan solas si Drive falla.',
            'Editar un control de calidad viejo ya no borra su PDF.'
        ]
    },
    {
        id: 28,
        version: 'v28',
        fecha: '2026-11-03',
        titulo: 'Copia de seguridad diaria',
        importante: false,
        items: [
            'Todos los días se guarda automáticamente una copia de los datos.',
            'El asistente de IA está disponible solo con la sesión iniciada.'
        ]
    }
];

const NOVEDADES_VISTAS_KEY = 'braun_novedades_vistas_v1';

function novedadesUltimaVista() {
    try {
        const vistas = JSON.parse(localStorage.getItem(NOVEDADES_VISTAS_KEY) || '{}');
        const email = (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : '';
        return Number(vistas[email || '-']) || 0;
    } catch (e) { return 0; }
}

function novedadesMarcarVistas() {
    try {
        const vistas = JSON.parse(localStorage.getItem(NOVEDADES_VISTAS_KEY) || '{}');
        const email = (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : '';
        vistas[email || '-'] = NOVEDADES.length ? NOVEDADES[0].id : 0;
        localStorage.setItem(NOVEDADES_VISTAS_KEY, JSON.stringify(vistas));
    } catch (e) { /* sin localStorage: el contador vuelve a aparecer, nada más */ }
    actualizarContadorNovedades();
}

function novedadesSinVer() {
    const ultima = novedadesUltimaVista();
    return NOVEDADES.filter(n => n.id > ultima);
}

function actualizarContadorNovedades() {
    const contador = document.getElementById('novedades-contador');
    if (!contador) return;
    const n = novedadesSinVer().length;
    contador.textContent = n > 9 ? '9+' : String(n);
    contador.classList.toggle('hidden', n === 0);
}

function fechaNovedad(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return d + ' ' + meses[(m || 1) - 1] + ' ' + a;
}

function renderNovedades() {
    const lista = document.getElementById('novedades-lista');
    if (!lista) return;
    const ultima = novedadesUltimaVista();
    lista.innerHTML = NOVEDADES.map(n => `
        <article class="novedad${n.id > ultima ? ' novedad-nueva' : ''}">
            <div class="novedad-cabecera">
                <span class="novedad-version">${escapeHtml(n.version)}</span>
                <span class="novedad-fecha">${escapeHtml(fechaNovedad(n.fecha))}</span>
                ${n.id > ultima ? '<span class="novedad-pill">Nuevo</span>' : ''}
            </div>
            <h4 class="novedad-titulo">${escapeHtml(n.titulo)}</h4>
            <ul class="novedad-items">
                ${n.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
            </ul>
        </article>`).join('');
}

function abrirNovedades() {
    renderNovedades();
    document.getElementById('modal-novedades').classList.add('active');
}

function cerrarNovedades() {
    document.getElementById('modal-novedades').classList.remove('active');
    novedadesMarcarVistas();
}

// Al entrar al menú: si hay una novedad importante sin ver, se muestra una vez.
function mostrarNovedadesImportantes() {
    actualizarContadorNovedades();
    if (typeof haySesionActiva === 'function' && !haySesionActiva()) return;
    if (novedadesSinVer().some(n => n.importante)) setTimeout(abrirNovedades, 600);
}

// Versión visible en la pantalla de login (la de la novedad más nueva).
function versionActualApp() {
    return NOVEDADES.length ? NOVEDADES[0].version : '';
}

document.addEventListener('DOMContentLoaded', function () {
    const v = document.getElementById('login-version');
    if (v) v.textContent = versionActualApp();
    actualizarContadorNovedades();
});

window.abrirNovedades = abrirNovedades;
window.cerrarNovedades = cerrarNovedades;
