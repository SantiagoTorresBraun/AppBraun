// =============================================================================
// AUTH.JS — Autenticación, contraseñas personales y recuperación por correo
// -----------------------------------------------------------------------------
// CÓMO SE VALIDA UNA CONTRASEÑA
//
// La contraseña NUNCA sale del dispositivo y NUNCA se guarda en ningún lado.
// El flujo es:
//
//   1. Se le pide al backend la SAL del usuario (?action=auth_perfil).
//   2. Con la contraseña + la sal se deriva un VERIFICADOR:
//      PBKDF2-SHA256, 150.000 vueltas. Eso es lo que viaja.
//   3. El backend compara SHA-256(verificador) contra la hoja "Usuarios".
//
// La sal es pública por diseño: solo evita que dos personas con la misma
// contraseña tengan el mismo verificador. Lo que se guarda en el Sheet es
// SHA-256(verificador), que no se puede reenviar para entrar.
//
// La validación está en el SERVIDOR y no acá. Antes estaba en este archivo,
// contra un hash escrito en el código, y así no se puede recuperar nada: para
// que el navegador valide una contraseña nueva tendría que conocerla, y
// cualquiera que abre el archivo la conoce también.
//
// LOGIN SIN SEÑAL
// Después de un login exitoso se guarda en el dispositivo la sal y el
// SHA-256(verificador) de ESE usuario. Si más tarde no hay internet, se valida
// contra esa copia. Un usuario que nunca entró en este dispositivo no puede
// entrar offline: no hay contra qué comparar.
//
// USUARIOS HEREDADOS
// Quien todavía no definió su contraseña personal entra con la genérica (como
// hasta ahora) y la app le ofrece crear la suya. Ver AUTH_HASH_GENERICO.
// =============================================================================

const AUTH_SESSION_KEY = 'braun_sesion_v1';
const AUTH_SESION_DURACION_HORAS = 24; // vencida la sesión, se vuelve a pedir login

// Parámetros de derivación. Si algún día se suben las vueltas, hay que dejar
// que los verificadores viejos sigan validando o forzar el cambio de clave.
const AUTH_PBKDF2_VUELTAS = 150000;
const AUTH_PBKDF2_BYTES = 32;

// Contraseña genérica HEREDADA. Solo sirve para los usuarios que todavía no
// definieron la suya; en cuanto la definen, deja de valer para ellos.
//
// OJO: este repositorio es público, así que este hash y esta contraseña los ve
// cualquiera. Es transitorio, y es justamente lo que este módulo viene a
// reemplazar. Ver AUDITORIA_2026-08-28.md, hallazgo 2.
const AUTH_HASH_GENERICO = '9c77eb8f3f0c2e378cefc1169452dd9793b990c0611347a28cdc72f88695c94b';

// Lista blanca de los 8 usuarios base. Los agregados desde la app viven en la
// hoja "Usuarios" del Sheet (ver USUARIOS_EXTRA_KEY más abajo).
const AUTH_USUARIOS = [
    { email: 'melisa.braun@braunrelacionescomerciales.com.ar',    nombre: 'Melisa Braun' },
    { email: 'alejo.chamorro@braunrelacionescomerciales.com.ar',  nombre: 'Alejo Chamorro' },
    { email: 'lucas.ramis@braunrelacionescomerciales.com.ar',     nombre: 'Lucas Ramis' },
    { email: 'juan.cavallera@braunrelacionescomerciales.com.ar',  nombre: 'Juan Cavallera' },
    { email: 'pablo.suarez@braunrelacionescomerciales.com.ar',    nombre: 'Pablo Suárez' },
    { email: 'jonathan.rui@braunrelacionescomerciales.com.ar',    nombre: 'Jonathan Rui' },
    { email: 'carla.candoni@braunrelacionescomerciales.com.ar',   nombre: 'Carla Candoni' },
    { email: 'santiago.torres@braunrelacionescomerciales.com.ar', nombre: 'Santiago Torres' }
];

// --- USUARIOS AGREGADOS DESDE LA APP -----------------------------------------
const USUARIOS_EXTRA_KEY = 'braun_usuarios_extra_v1';

function obtenerUsuariosExtra() {
    try {
        const lista = JSON.parse(localStorage.getItem(USUARIOS_EXTRA_KEY) || '[]');
        return Array.isArray(lista) ? lista : [];
    } catch (e) { return []; }
}

function guardarUsuariosExtra(lista) {
    localStorage.setItem(USUARIOS_EXTRA_KEY, JSON.stringify(lista || []));
}

// Lista completa de usuarios de la empresa (base + agregados), sin duplicados.
// Los base llevan esBase: true (no se pueden borrar desde la app).
function obtenerUsuariosApp() {
    const lista = AUTH_USUARIOS.map(u => ({ email: u.email, nombre: u.nombre, esBase: true }));
    const emails = new Set(lista.map(u => u.email));
    obtenerUsuariosExtra().forEach(u => {
        if (!u || !u.email) return;
        const email = String(u.email).trim().toLowerCase();
        if (emails.has(email)) return;
        emails.add(email);
        lista.push({ email: email, nombre: u.nombre || email, esBase: false });
    });
    return lista;
}

// Baja del Sheet la lista de usuarios y actualiza la caché local.
function sincronizarUsuariosDesdeSheet() {
    if (typeof WEB_APP_URL === 'undefined' || !navigator.onLine || WEB_APP_URL.includes("AQUÍ_VA")) return;
    fetch(`${WEB_APP_URL}?action=read_usuarios`)
        .then(res => res.json())
        .then(data => {
            if (!Array.isArray(data)) return;
            const emailsBase = new Set(AUTH_USUARIOS.map(u => u.email));
            const extras = data
                .filter(u => u && u.email && !emailsBase.has(String(u.email).trim().toLowerCase()))
                .map(u => ({ nombre: u.nombre || u.email, email: String(u.email).trim().toLowerCase() }));
            guardarUsuariosExtra(extras);
        })
        .catch(err => console.warn('No se pudo sincronizar la lista de usuarios:', err));
}

// =============================================================================
// DERIVACIÓN DE LA CONTRASEÑA
// =============================================================================

function hexDeBuffer(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// SHA-256 simple. Se sigue usando para la contraseña genérica heredada y para
// calcular lo que se guarda en la caché offline.
async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    return hexDeBuffer(await crypto.subtle.digest('SHA-256', data));
}

function generarSal() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return hexDeBuffer(bytes.buffer);
}

// El verificador: lo único que viaja al servidor.
//
// PBKDF2 con 150.000 vueltas hace que probar contraseñas al por mayor sea caro:
// un SHA-256 pelado se prueba de a millones por segundo, esto no.
async function derivarVerificador(password, sal) {
    const clave = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: new TextEncoder().encode(sal),
            iterations: AUTH_PBKDF2_VUELTAS,
            hash: 'SHA-256'
        },
        clave, AUTH_PBKDF2_BYTES * 8
    );
    return hexDeBuffer(bits);
}

// =============================================================================
// CACHÉ PARA ENTRAR SIN SEÑAL
// =============================================================================
// Guarda, por usuario que YA entró bien en este dispositivo, su sal y el
// SHA-256 del verificador. Es lo mismo que tiene el servidor: alcanza para
// validar, no para reconstruir la contraseña.
const AUTH_CACHE_KEY = 'braun_auth_local_v1';

function leerCacheAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
}

function guardarCacheAuth(email, sal, hashVerificador, nombre) {
    const cache = leerCacheAuth();
    cache[email] = { sal: sal, hash: hashVerificador, nombre: nombre || email };
    try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cache)); } catch (e) { }
}

function olvidarCacheAuth(email) {
    const cache = leerCacheAuth();
    delete cache[email];
    try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cache)); } catch (e) { }
}

// =============================================================================
// CONSULTAS AL BACKEND
// =============================================================================

function authBackendDisponible() {
    return typeof WEB_APP_URL !== 'undefined' && !WEB_APP_URL.includes('AQUÍ_VA') && navigator.onLine;
}

// Trae la sal del usuario y si ya definió contraseña propia.
async function pedirPerfilAuth(email) {
    const url = `${WEB_APP_URL}?action=auth_perfil&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    return await res.json();
}

// POST al backend leyendo la respuesta. No usa enviarAlBackend() de app.js a
// propósito: ese reintenta a ciegas cuando no puede leer la respuesta, y acá un
// reintento silencioso sobre "definir contraseña" es justo lo que no queremos.
async function postAuth(payload) {
    const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    const texto = await res.text();
    try { return JSON.parse(texto); }
    catch (e) { throw new Error('El servidor no respondió como se esperaba. ¿Está publicada la última versión del Apps Script?'); }
}

// =============================================================================
// LOGIN
// =============================================================================
// Devuelve { ok: true, usuario, debeDefinirClave } o { ok: false, error }.
async function iniciarSesion(email, password) {
    const emailNormalizado = (email || '').trim().toLowerCase();
    const usuarioLista = obtenerUsuariosApp().find(u => u.email === emailNormalizado);
    const generico = { ok: false, error: 'Correo o contraseña incorrectos.' };

    if (typeof crypto === 'undefined' || !crypto.subtle) {
        return { ok: false, error: 'Este dispositivo no puede verificar la contraseña. La app debe abrirse por HTTPS.' };
    }

    // --- SIN CONEXIÓN: contra la copia local de quien ya entró acá ---
    if (!authBackendDisponible()) {
        return await loginOffline(emailNormalizado, password, usuarioLista);
    }

    // --- CON CONEXIÓN: manda el verificador al backend ---
    let perfil;
    try {
        perfil = await pedirPerfilAuth(emailNormalizado);
    } catch (e) {
        console.warn('No se pudo consultar el perfil, se intenta offline:', e);
        return await loginOffline(emailNormalizado, password, usuarioLista);
    }

    if (!perfil || !perfil.existe) return generico;

    // Usuario heredado: todavía no definió contraseña propia → entra con la
    // genérica y la app le va a pedir que cree la suya.
    if (!perfil.tieneClave) {
        const hash = await hashPassword(password || '');
        if (hash !== AUTH_HASH_GENERICO) return generico;
        return abrirSesion(emailNormalizado, perfil.nombre || (usuarioLista && usuarioLista.nombre), true);
    }

    const verificador = await derivarVerificador(password || '', perfil.salt);
    const r = await postAuth({ _accion: 'auth_login', email: emailNormalizado, verificador: verificador });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Correo o contraseña incorrectos.' };

    // Login bueno: se deja la copia local para poder entrar sin señal.
    guardarCacheAuth(emailNormalizado, perfil.salt, await hashPassword(verificador), r.nombre);
    return abrirSesion(emailNormalizado, r.nombre || (usuarioLista && usuarioLista.nombre), false);
}

async function loginOffline(email, password, usuarioLista) {
    const generico = { ok: false, error: 'Correo o contraseña incorrectos.' };
    const guardado = leerCacheAuth()[email];

    if (guardado && guardado.sal && guardado.hash) {
        const verificador = await derivarVerificador(password || '', guardado.sal);
        if (await hashPassword(verificador) !== guardado.hash) return generico;
        return abrirSesion(email, guardado.nombre, false);
    }

    // Nunca entró en este dispositivo. Si además es un usuario heredado, la
    // genérica lo deja pasar; si ya tiene clave propia, no hay con qué validar.
    if (!usuarioLista) return generico;
    const hash = await hashPassword(password || '');
    if (hash !== AUTH_HASH_GENERICO) {
        return { ok: false, error: 'Sin conexión solo podés entrar en un dispositivo donde ya hayas iniciado sesión antes.' };
    }
    return abrirSesion(email, usuarioLista.nombre, true);
}

function abrirSesion(email, nombre, debeDefinirClave) {
    const sesion = {
        email: email,
        nombre: nombre || email,
        loginAt: new Date().toISOString()
    };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sesion));
    localStorage.removeItem('usuarioBraun'); // legado del login viejo
    return { ok: true, usuario: sesion, debeDefinirClave: !!debeDefinirClave };
}

function cerrarSesionAuth() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('usuarioBraun'); // legado
}

// =============================================================================
// DEFINIR O CAMBIAR LA CONTRASEÑA (con la sesión abierta)
// =============================================================================
async function definirPasswordPropia(email, passwordActual, passwordNueva) {
    if (!authBackendDisponible()) {
        return { ok: false, error: 'Necesitás conexión para cambiar la contraseña.' };
    }

    const emailNormalizado = (email || '').trim().toLowerCase();
    const perfil = await pedirPerfilAuth(emailNormalizado);
    if (!perfil || !perfil.existe) return { ok: false, error: 'Ese usuario no está registrado.' };

    // Si ya tiene clave propia hay que probar la actual. Si no la tiene, se
    // valida la genérica acá mismo para no dejar que otro le defina la clave.
    let verificadorActual = '';
    if (perfil.tieneClave) {
        verificadorActual = await derivarVerificador(passwordActual || '', perfil.salt);
    } else {
        const hash = await hashPassword(passwordActual || '');
        if (hash !== AUTH_HASH_GENERICO) {
            return { ok: false, error: 'La contraseña actual no es correcta.' };
        }
    }

    const sal = generarSal();
    const verificador = await derivarVerificador(passwordNueva, sal);
    const r = await postAuth({
        _accion: 'auth_definir',
        email: emailNormalizado,
        verificador_actual: verificadorActual,
        salt: sal,
        verificador: verificador
    });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'No se pudo guardar la contraseña.' };

    guardarCacheAuth(emailNormalizado, sal, await hashPassword(verificador), perfil.nombre);
    return { ok: true };
}

// =============================================================================
// RECUPERACIÓN POR CORREO
// =============================================================================

// Paso 1: pedir el código. El backend lo manda a la casilla del usuario.
async function pedirCodigoRecuperacion(email) {
    if (!authBackendDisponible()) {
        return { ok: false, error: 'Necesitás conexión para recuperar la contraseña.' };
    }
    const r = await postAuth({ _accion: 'auth_reset_pedir', email: (email || '').trim().toLowerCase() });
    return r || { ok: false, error: 'No se pudo pedir el código.' };
}

// Paso 2: confirmar con el código y la contraseña nueva.
async function confirmarRecuperacion(email, codigo, passwordNueva) {
    if (!authBackendDisponible()) {
        return { ok: false, error: 'Necesitás conexión para recuperar la contraseña.' };
    }
    const emailNormalizado = (email || '').trim().toLowerCase();
    const sal = generarSal();
    const verificador = await derivarVerificador(passwordNueva, sal);
    const r = await postAuth({
        _accion: 'auth_reset_confirmar',
        email: emailNormalizado,
        codigo: String(codigo || '').trim(),
        salt: sal,
        verificador: verificador
    });
    if (!r || !r.ok) return r || { ok: false, error: 'No se pudo cambiar la contraseña.' };

    // La clave cambió: la copia local vieja ya no sirve, se reemplaza.
    guardarCacheAuth(emailNormalizado, sal, await hashPassword(verificador), r.nombre);
    return { ok: true, nombre: r.nombre };
}

// Reglas mínimas de la contraseña nueva. Devuelve null si está bien.
function validarPasswordNueva(password, repetida) {
    const p = String(password || '');
    if (p.length < 8) return 'La contraseña tiene que tener al menos 8 caracteres.';
    if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'La contraseña tiene que combinar letras y números.';
    if (p !== String(repetida || '')) return 'Las dos contraseñas no coinciden.';
    if (p.toLowerCase() === 'braun123') return 'Elegí una contraseña distinta de la genérica.';
    return null;
}

// =============================================================================
// LECTURA DE SESIÓN
// =============================================================================
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

        // Si el usuario fue quitado de la lista (base o agregados), su sesión deja de valer
        if (!obtenerUsuariosApp().some(u => u.email === sesion.email)) {
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
