// ============================================================================
//  offline.js - Registro del Service Worker
// ----------------------------------------------------------------------------
//  Este archivo es el que "prende" el modo offline. Sin el, sw.js existe pero
//  el navegador no lo usa nunca: ese era exactamente el Hallazgo 3.
//
//  Se registra despues del evento 'load' a proposito, para no competir con la
//  carga inicial de la app. Todo esta envuelto en try/catch: si algo falla
//  (navegador viejo, modo incognito, permisos), la app tiene que seguir
//  andando igual, solo que sin modo offline.
// ============================================================================

(function () {
    'use strict';

    // Ultimo estado conocido, para poder consultarlo desde la consola.
    var estado = {
        soportado: false,
        contextoSeguro: false,
        registrado: false,
        controlando: false,
        version: null,
        error: null
    };

    // ------------------------------------------------------------------
    // 1. Chequeos previos
    // ------------------------------------------------------------------
    estado.soportado = ('serviceWorker' in navigator);

    // Los Service Workers solo funcionan en https o en localhost. En
    // GitHub Pages estamos en https, asi que va bien; pero si alguien abre el
    // index.html con doble clic (file://) esto evita un error feo en consola.
    estado.contextoSeguro = (window.isSecureContext === true) ||
        location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1';

    if (!estado.soportado) {
        console.warn('[offline] Este navegador no soporta Service Workers: la app va a necesitar internet.');
        return;
    }
    if (!estado.contextoSeguro) {
        console.warn('[offline] La pagina no esta en https (esta en "' + location.protocol +
            '"): el modo offline queda desactivado. Es una regla del navegador, no un error de la app.');
        return;
    }

    // ------------------------------------------------------------------
    // 2. Registro
    // ------------------------------------------------------------------
    window.addEventListener('load', function () {
        try {
            navigator.serviceWorker.register('./sw.js', {
                scope: './',
                // No dejar que el navegador sirva un sw.js viejo desde su cache
                // HTTP: siempre que chequee actualizaciones, que lo pida de red.
                updateViaCache: 'none'
            }).then(function (registro) {
                estado.registrado = true;
                console.log('[offline] Service Worker registrado. Alcance: ' + registro.scope);

                vigilarActualizaciones(registro);

                // Buscar version nueva al arrancar y cada 30 minutos, por si la
                // app queda abierta todo el dia en una tablet de planta.
                registro.update().catch(function () { });
                setInterval(function () {
                    registro.update().catch(function () { });
                }, 30 * 60 * 1000);

            }).catch(function (err) {
                estado.error = String(err && err.message ? err.message : err);
                console.warn('[offline] No se pudo registrar el Service Worker: ' + estado.error +
                    '. La app funciona igual, pero va a necesitar internet.');
            });
        } catch (err) {
            estado.error = String(err && err.message ? err.message : err);
            console.warn('[offline] Error inesperado al registrar: ' + estado.error);
        }
    });

    // ------------------------------------------------------------------
    // 3. Avisar cuando hay una version nueva
    // ------------------------------------------------------------------
    // Con la sesion abierta NO se recarga sola: si un operario esta a mitad de
    // una carga, recargarle la pagina de prepo le borra todo lo que tipeo. Se
    // avisa y listo.
    //
    // En la pantalla de login, en cambio, no hay nada que perder: se aplica
    // sola (antes aparecia el cartel "Actualizar" ahi, que no tenia sentido).
    // Si la persona ya esta escribiendo la contraseña, no se le borra: se
    // aplica apenas entra (app.js mira window.braunVersionPendiente).
    function vigilarActualizaciones(registro) {
        registro.addEventListener('updatefound', function () {
            var nuevo = registro.installing;
            if (!nuevo) return;

            nuevo.addEventListener('statechange', function () {
                if (nuevo.state !== 'installed') return;

                if (navigator.serviceWorker.controller) {
                    // Ya habia una version andando: esta es una actualizacion.
                    console.log('[offline] Hay una version nueva de la app lista para usarse.');
                    avisarVersionNueva();
                } else {
                    // Primera instalacion.
                    console.log('[offline] App guardada. Desde ahora abre sin senal.');
                }
            });
        });
    }

    // Cartelito discreto abajo. Si el proyecto ya tiene una funcion de avisos,
    // se usa esa; si no, se arma uno simple a mano.
    function enPantallaDeLogin() {
        var login = document.getElementById('view-login');
        return !!login && !login.classList.contains('hidden');
    }

    function avisarVersionNueva() {
        try {
            if (enPantallaDeLogin()) {
                var escribiendo = document.activeElement &&
                    document.activeElement.closest && document.activeElement.closest('#form-login');
                var clave = document.getElementById('login-password');
                if (escribiendo || (clave && clave.value)) {
                    window.braunVersionPendiente = true;
                    return;
                }
                location.reload();
                return;
            }

            if (typeof window.mostrarToast === 'function') {
                window.mostrarToast('Hay una version nueva. Se aplica al volver a abrir la app.');
                return;
            }

            if (document.getElementById('aviso-version-nueva')) return;

            // El estilo esta en diseno.css (.aviso-version).
            var caja = document.createElement('div');
            caja.id = 'aviso-version-nueva';
            caja.className = 'aviso-version';
            caja.setAttribute('role', 'status');

            var texto = document.createElement('span');
            texto.textContent = 'Hay una versión nueva de la app. Guardá lo que estés cargando y actualizá.';

            var boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'aviso-version-boton';
            boton.textContent = 'Actualizar';
            boton.onclick = function () { location.reload(); };

            var cerrar = document.createElement('button');
            cerrar.type = 'button';
            cerrar.className = 'aviso-version-cerrar';
            cerrar.innerHTML = '&times;';
            cerrar.setAttribute('aria-label', 'Cerrar aviso');
            cerrar.onclick = function () { caja.remove(); };

            caja.appendChild(texto);
            caja.appendChild(boton);
            caja.appendChild(cerrar);
            document.body.appendChild(caja);
        } catch (e) {
            // Un aviso que falla no puede tumbar la app.
        }
    }

    // ------------------------------------------------------------------
    // 4. Herramientas para soporte (desde la consola del navegador)
    // ------------------------------------------------------------------
    navigator.serviceWorker.addEventListener('message', function (evento) {
        var dato = evento.data || {};
        if (dato.tipo === 'VERSION') {
            estado.version = dato.version;
            console.log('[offline] Version guardada: ' + dato.version);
        }
        if (dato.tipo === 'CACHE_BORRADA') {
            console.log('[offline] Cache borrada. Recarga la pagina para bajar todo de nuevo.');
        }
    });

    // estadoOffline()  -> ver si el modo offline esta activo
    window.estadoOffline = function () {
        estado.controlando = !!navigator.serviceWorker.controller;
        if (estado.controlando) {
            navigator.serviceWorker.controller.postMessage({ tipo: 'VERSION' });
        }
        return estado;
    };

    // borrarCacheOffline()  -> si algo quedo raro, se limpia y se recarga
    window.borrarCacheOffline = function () {
        if (!navigator.serviceWorker.controller) {
            console.warn('[offline] No hay Service Worker activo, no hay nada que borrar.');
            return;
        }
        navigator.serviceWorker.controller.postMessage({ tipo: 'BORRAR_CACHE' });
    };
})();
