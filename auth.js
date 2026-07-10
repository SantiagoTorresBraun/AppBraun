// =============================================================================
// AUTH.JS — Autenticación y sesión de usuarios de la App Braun
// -----------------------------------------------------------------------------
// - Lista blanca de usuarios autorizados (solo correos corporativos).
// - Las contraseñas NUNCA se guardan en texto plano: se compara el hash SHA-256
//   de lo que tipea el usuario contra el hash almacenado en la lista.
// - Hoy todos comparten el hash de la contraseña genérica; el día que se migre
//   a contraseñas individuales, solo hay que reemplazar el campo passwordHash
//   de cada usuario (o traer la lista desde el backend con _accion: "login").
// - La sesión activa se guarda en localStorage (braun_sesion_v1) con email,
//   nombre y fecha de inicio, y la lee el resto de la app para auditoría
//   (campo usuario_registro en cada registro enviado al backend).
// =============================================================================

const AUTH_SESSION_KEY = 'braun_sesion_v1';
const AUTH_SESION_DURACION_HORAS = 24; // vencida la sesión, se vuelve a pedir login

// Hash SHA-256 de la contraseña genérica actual ("Braun123").
const AUTH_HASH_GENERICO = '9c77eb8f3f0c2e378cefc1169452dd9793b990c0611347a28cdc72f88695c94b';

// Lista blanca de usuarios autorizados. Los emails se comparan siempre en
// minúsculas, así que da igual cómo los tipee el operario.
const AUTH_USUARIOS = [
    { email: 'melisa.braun@braunrelacionescomerciales.com.ar',    nombre: 'Melisa Braun',    passwordHash: AUTH_HASH_GENERICO },
    { email: 'alejo.chamorro@braunrelacionescomerciales.com.ar',  nombre: 'Alejo Chamorro',  passwordHash: AUTH_HASH_GENERICO },
    { email: 'lucas.ramis@braunrelacionescomerciales.com.ar',     nombre: 'Lucas Ramis',     passwordHash: AUTH_HASH_GENERICO },
    { email: 'juan.cavallera@braunrelacionescomerciales.com.ar',  nombre: 'Juan Cavallera',  passwordHash: AUTH_HASH_GENERICO },
    { email: 'pablo.suarez@braunrelacionescomerciales.com.ar',    nombre: 'Pablo Suárez',    passwordHash: AUTH_HASH_GENERICO },
    { email: 'jonathan.rui@braunrelacionescomerciales.com.ar',    nombre: 'Jonathan Rui',    passwordHash: AUTH_HASH_GENERICO },
    { email: 'carla.candoni@braunrelacionescomerciales.com.ar',   nombre: 'Carla Candoni',   passwordHash: AUTH_HASH_GENERICO },
    { email: 'santiago.torres@braunrelacionescomerciales.com.ar', nombre: 'Santiago Torres', passwordHash: AUTH_HASH_GENERICO }
];

// --- HASHING ---------------------------------------------------------------
// Usa la Web Crypto API (disponible en HTTPS y en localhost, que es donde
// corre cualquier PWA con service worker).
async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// --- LOGIN / LOGOUT ----------------------------------------------------------
// Devuelve { ok: true, usuario } o { ok: false, error } (mensaje para mostrar).
// El mensaje de error es genérico a propósito: no conviene revelar si el email
// existe o no en la lista.
async function iniciarSesion(email, password) {
    const emailNormalizado = (email || '').trim().toLowerCase();
    const usuario = AUTH_USUARIOS.find(u => u.email === emailNormalizado);

    if (!usuario) {
        return { ok: false, error: 'Correo o contraseña incorrectos.' };
    }

    let hashIngresado;
    try {
        hashIngresado = await hashPassword(password || '');
    } catch (e) {
        console.error('Web Crypto no disponible (¿la app corre sin HTTPS?):', e);
        return { ok: false, error: 'No se pudo verificar la contraseña en este dispositivo. La app debe abrirse por HTTPS.' };
    }

    if (hashIngresado !== usuario.passwordHash) {
        return { ok: false, error: 'Correo o contraseña incorrectos.' };
    }

    const sesion = {
        email: usuario.email,
        nombre: usuario.nombre,
        loginAt: new Date().toISOString()
    };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sesion));
    // Limpieza de la clave del login viejo (versión sin validación real)
    localStorage.removeItem('usuarioBraun');

    return { ok: true, usuario: sesion };
}

function cerrarSesionAuth() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('usuarioBraun'); // legado
}

// --- LECTURA DE SESIÓN -------------------------------------------------------
function obtenerSesion() {
    try {
        const sesion = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
        if (!sesion || !sesion.email) return null;

        // Sesión vencida → forzar nuevo login
        const horas = (Date.now() - new Date(sesion.loginAt).getTime()) / 3600000;
        if (isNaN(horas) || horas > AUTH_SESION_DURACION_HORAS) {
            cerrarSesionAuth();
            return null;
        }

        // Si el usuario fue quitado de la lista blanca, su sesión deja de valer
        if (!AUTH_USUARIOS.some(u => u.email === sesion.email)) {
            cerrarSesionAuth();
            return null;
        }

        return sesion;
    } catch (e) {
        return null;
    }
}

function haySesionActiva() {
    return obtenerSesion() !== null;
}

// Email del usuario activo, para estampar en cada registro (auditoría).
function usuarioRegistroActual() {
    const sesion = obtenerSesion();
    return sesion ? sesion.email : '';
}

function nombreUsuarioActual() {
    const sesion = obtenerSesion();
    return sesion ? sesion.nombre : '';
}
