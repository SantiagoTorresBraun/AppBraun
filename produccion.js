// =========================================================================
// MÓDULO: PRODUCCIÓN — Muestreo de campo georreferenciado
// Reutiliza la infraestructura global de app.js:
//   db (IndexedDB), WEB_APP_URL, ENUMS/poblarSelect, cambiarVista,
//   parseNumeroAR/valorPlanoParaEditar, escapeHtml, obtenerSesion,
//   usuarioRegistroActual y jsPDF (window.jspdf).
// Modelo: Muestreo (encabezado) → Puntos (observaciones georreferenciadas).
// Cada muestreo se guarda como UN registro en IndexedDB con su array Puntos,
// y el Apps Script lo reparte en las hojas "Muestreo" y "Muestreo_Puntos".
// =========================================================================

// --- Constantes ---
const TIPOS_OBSERVACION = [
    "Plaga", "Enfermedad", "Maleza", "Deficiencia", "Daño climático",
    "Daño mecánico", "Stand", "Otro"
];

// Escala de severidad unificada, con color para el mapa y el reporte.
const SEVERIDADES = [
    { v: 0, label: "Sin daño",  color: "#2e7d32" },
    { v: 1, label: "Leve",      color: "#e0a32e" },
    { v: 2, label: "Moderado",  color: "#ef6c00" },
    { v: 3, label: "Alto",      color: "#c62828" },
    { v: 4, label: "Crítico",   color: "#6a1b1b" }
];

// --- Estado del módulo ---
let muestreoActual = null;        // registro en edición (con .Puntos y, si ya se guardó, .id de IndexedDB)
let historialMuestreos = [];      // muestreos leídos del backend
let muestreosRenderizados = [];   // lista filtrada que se ve en el historial (para abrir por índice)
let puntoEnEdicionIdx = null;     // índice del punto que se edita (null = punto nuevo)
let puntoFotoBase64 = "";         // foto del punto en edición (con watermark) o URL remota
let puntoGPS = null;              // { lat, long, precision, timestamp } del punto en edición
let puntoTipoSel = "";            // tipo de observación elegido (chip)
let puntoSevSel = 0;              // severidad elegida (chip)

const escProd = (typeof escapeHtml === 'function') ? escapeHtml : (s => (s === undefined || s === null) ? '' : String(s));

// --- 1. APERTURA DEL MÓDULO ---
function abrirModuloProduccion() {
    resetFormMuestreo();
    switchTabProduccion('historial');
    cambiarVista('view-modulo-produccion');
    if (navigator.onLine) cargarMuestreosDesdeGoogle();
    renderListaMuestreos();
}

function switchTabProduccion(tab) {
    const hist = document.getElementById('tab-content-historial-prod');
    const nuevo = document.getElementById('tab-content-nuevo-prod');
    if (!hist || !nuevo) return;
    if (tab === 'nuevo') {
        hist.classList.add('hidden');
        nuevo.classList.remove('hidden');
        resetFormMuestreo();
    } else {
        nuevo.classList.add('hidden');
        hist.classList.remove('hidden');
        renderListaMuestreos();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetFormMuestreo() {
    const f = document.getElementById('form-muestreo');
    if (f) f.reset();
    const fecha = document.getElementById('mu-fecha');
    if (fecha) fecha.valueAsDate = new Date();
    poblarSelect(document.getElementById('mu-cultivo'), 'cultivoCampo', '');
    const respSel = document.getElementById('mu-responsable');
    poblarSelect(respSel, 'personal', '');
    // Preseleccionar al usuario logueado si figura en la lista de personal
    const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
    if (sesion && respSel) {
        const opt = Array.from(respSel.options).find(o => (o.value || '').trim().toLowerCase() === (sesion.nombre || '').trim().toLowerCase());
        if (opt) respSel.value = opt.value;
    }
}

// --- 2. CREAR EL MUESTREO (encabezado) ---
document.getElementById('form-muestreo').addEventListener('submit', function (e) {
    e.preventDefault();
    muestreoActual = {
        Id_Muestreo: 'MU-' + Date.now(),
        Fecha: document.getElementById('mu-fecha').value,
        Establecimiento: document.getElementById('mu-establecimiento').value.trim(),
        Lote: document.getElementById('mu-lote').value.trim(),
        Campania: document.getElementById('mu-campania').value.trim(),
        Cultivo: document.getElementById('mu-cultivo').value,
        Variedad: document.getElementById('mu-variedad').value.trim(),
        Responsable: document.getElementById('mu-responsable').value,
        Matricula: document.getElementById('mu-matricula').value.trim(),
        Observaciones: '',
        usuario_registro: (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : '',
        Estado: 'En curso',
        Puntos: []
    };
    guardarMuestreoLocal(function () {
        renderMuestreoActivo();
        cambiarVista('view-muestreo-activo');
    });
});

// --- 3. VISTA DEL MUESTREO ACTIVO (mapa + lista de puntos) ---
function renderMuestreoActivo() {
    const m = muestreoActual;
    if (!m) return;
    // El titulo arranca por el CAMPO, no por el lote. Antes decia "1 — Soja":
    // el "1" era el numero de lote y no se entendia de que campo era el recorrido.
    document.getElementById('ma-titulo').textContent =
        `${m.Establecimiento || 'Campo'}${m.Lote ? ' · Lote ' + m.Lote : ''}`;
    document.getElementById('ma-subtitulo').textContent =
        [m.Cultivo, m.Campania, fechaLegibleMuestreo(m.Fecha)].filter(Boolean).join(' · ');

    renderFichaMuestreo();

    const pts = m.Puntos || [];
    document.getElementById('ma-contador').textContent = `${pts.length} punto${pts.length === 1 ? '' : 's'}`;

    const cont = document.getElementById('lista-puntos');
    if (pts.length === 0) {
        cont.innerHTML = '<p class="lista-vacia">Todavía no agregaste puntos. Tocá <b>“Nuevo Punto”</b>.</p>';
    } else {
        cont.innerHTML = pts.map((p, i) => {
            const sev = SEVERIDADES[+p.Severidad || 0] || SEVERIDADES[0];
            const foto = p.Foto
                ? `<div class="punto-thumb" style="background-image:url('${p.Foto}')"></div>`
                : `<div class="punto-thumb sin-foto"><i class="fas fa-image"></i></div>`;
            // La coordenada no es solo texto: abre el punto en Google Maps.
            // Es la forma de "georreferenciar de verdad" sin depender de una
            // clave de API — el mapa de adentro es Leaflet, pero el que quiere
            // ir hasta el punto lo abre en la app que ya tiene en el celular.
            const coord = (p.Lat && p.Long)
                ? `<a class="punto-coord" href="https://www.google.com/maps?q=${+p.Lat},${+p.Long}" target="_blank" rel="noopener"
                       onclick="event.stopPropagation()" title="Abrir en Google Maps"><i class="fas fa-location-dot"></i> ${(+p.Lat).toFixed(5)}, ${(+p.Long).toFixed(5)}</a>`
                : '<span class="punto-sin-gps"><i class="fas fa-location-crosshairs"></i> Sin GPS</span>';
            const precision = p.Precision_m ? ` ±${Math.round(+p.Precision_m)} m` : '';
            const medicion = [
                p.Incidencia_pct ? `Incidencia ${p.Incidencia_pct}%` : '',
                (p.Conteo_Valor && +p.Conteo_Valor) ? `${p.Conteo_Valor} ${p.Conteo_Unidad || ''}`.trim() : ''
            ].filter(Boolean).join(' · ');

            return `<div class="punto-card" onclick="editarPunto(${i})">
                ${foto}
                <div class="punto-info">
                    <div class="punto-top"><span class="punto-num">#${p.Orden || i + 1}</span><span class="sev-pill" style="background:${sev.color}">${sev.label}</span></div>
                    <div class="punto-obs">${escProd(p.Tipo_Observacion || '—')}${p.Objetivo ? ' · ' + escProd(p.Objetivo) : ''}</div>
                    ${medicion ? `<div class="punto-medicion">${escProd(medicion)}</div>` : ''}
                    <div class="punto-meta">${coord}${precision}${p.Estado_Fenologico ? ' · ' + escProd(p.Estado_Fenologico) : ''}</div>
                </div>
                <button class="punto-del" onclick="event.stopPropagation(); eliminarPunto(${i})" title="Eliminar punto"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
    }
    renderMapaMuestreo();
}

// --- 4. CAPTURA DE UN PUNTO ---
function nuevoPunto() {
    if (!muestreoActual) return;
    puntoEnEdicionIdx = null;
    puntoFotoBase64 = '';
    puntoGPS = null;
    puntoTipoSel = '';
    puntoSevSel = 0;
    document.getElementById('pc-titulo').textContent = `Nuevo Punto #${(muestreoActual.Puntos || []).length + 1}`;
    const f = document.getElementById('form-punto'); if (f) f.reset();
    document.getElementById('pc-foto-preview').innerHTML = '';
    document.getElementById('pc-objetivo').value = '';
    document.getElementById('pc-incidencia').value = '0';
    document.getElementById('pc-conteo').value = '0';
    document.getElementById('pc-nota').value = '';
    poblarSelect(document.getElementById('pc-fenologia'), 'fenologia', '');
    poblarSelect(document.getElementById('pc-conteo-unidad'), 'conteoUnidad', '');
    renderChipsTipo();
    renderChipsSeveridad();
    cambiarVista('view-punto-captura');
    capturarGPS();
}

function editarPunto(idx) {
    const p = muestreoActual && muestreoActual.Puntos[idx];
    if (!p) return;
    puntoEnEdicionIdx = idx;
    puntoFotoBase64 = p.Foto || '';
    puntoGPS = (p.Lat && p.Long) ? { lat: +p.Lat, long: +p.Long, precision: +p.Precision_m || 0, timestamp: p.Timestamp } : null;
    puntoTipoSel = p.Tipo_Observacion || '';
    puntoSevSel = +p.Severidad || 0;
    document.getElementById('pc-titulo').textContent = `Editar Punto #${p.Orden || idx + 1}`;
    const f = document.getElementById('form-punto'); if (f) f.reset();
    poblarSelect(document.getElementById('pc-fenologia'), 'fenologia', p.Estado_Fenologico || '');
    poblarSelect(document.getElementById('pc-conteo-unidad'), 'conteoUnidad', p.Conteo_Unidad || '');
    document.getElementById('pc-objetivo').value = p.Objetivo || '';
    document.getElementById('pc-incidencia').value = valorPlanoParaEditar(p.Incidencia_pct || 0);
    document.getElementById('pc-conteo').value = valorPlanoParaEditar(p.Conteo_Valor || 0);
    document.getElementById('pc-nota').value = p.Nota || '';
    document.getElementById('pc-foto-preview').innerHTML = p.Foto ? `<img src="${p.Foto}" alt="foto">` : '';
    renderChipsTipo();
    renderChipsSeveridad();
    const coordsEl = document.getElementById('gps-coords');
    const precEl = document.getElementById('gps-precision');
    if (puntoGPS) {
        coordsEl.textContent = `${puntoGPS.lat.toFixed(6)}, ${puntoGPS.long.toFixed(6)}`;
        precEl.textContent = `Precisión ±${Math.round(puntoGPS.precision)} m`;
    } else {
        coordsEl.textContent = 'Sin coordenada guardada';
        precEl.textContent = '—';
    }
    cambiarVista('view-punto-captura');
}

function cancelarPunto() {
    cambiarVista('view-muestreo-activo');
}

function renderChipsTipo() {
    const cont = document.getElementById('pc-tipo-chips');
    if (!cont) return;
    cont.innerHTML = TIPOS_OBSERVACION.map(t =>
        `<button type="button" class="chip ${t === puntoTipoSel ? 'chip-sel' : ''}" onclick="seleccionarTipoObs('${t}')">${t}</button>`
    ).join('');
}
function seleccionarTipoObs(t) { puntoTipoSel = t; renderChipsTipo(); }

function renderChipsSeveridad() {
    const cont = document.getElementById('pc-severidad-chips');
    if (!cont) return;
    cont.innerHTML = SEVERIDADES.map(s =>
        `<button type="button" class="chip-sev ${s.v === puntoSevSel ? 'chip-sev-sel' : ''}" style="--sev:${s.color}" onclick="seleccionarSeveridad(${s.v})">${s.label}</button>`
    ).join('');
}
function seleccionarSeveridad(v) { puntoSevSel = v; renderChipsSeveridad(); }

// GPS: pide la posición con alta precisión y muestra la exactitud (±m).
function capturarGPS() {
    const coordsEl = document.getElementById('gps-coords');
    const precEl = document.getElementById('gps-precision');
    const box = document.getElementById('gps-box');
    if (!coordsEl) return;
    coordsEl.textContent = 'Obteniendo ubicación…';
    precEl.textContent = '—';
    if (box) box.classList.remove('gps-ok', 'gps-bad');
    if (!navigator.geolocation) { coordsEl.textContent = 'GPS no disponible en este dispositivo'; return; }
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            puntoGPS = {
                lat: pos.coords.latitude,
                long: pos.coords.longitude,
                precision: pos.coords.accuracy || 0,
                timestamp: new Date().toISOString()
            };
            coordsEl.textContent = `${puntoGPS.lat.toFixed(6)}, ${puntoGPS.long.toFixed(6)}`;
            const p = Math.round(puntoGPS.precision);
            precEl.textContent = `Precisión ±${p} m · ${new Date().toLocaleTimeString('es-AR')}`;
            if (box) box.classList.add(p <= 10 ? 'gps-ok' : 'gps-bad');
        },
        function (err) {
            coordsEl.textContent = 'No se pudo obtener la ubicación';
            precEl.textContent = err && err.message ? err.message : 'Revisá los permisos de ubicación';
            if (box) box.classList.add('gps-bad');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// Foto: comprime a ~1280 px y estampa la coordenada/fecha/lote abajo (watermark).
function handleFotoPunto(input) {
    const file = input.files[0];
    if (!file) return;
    const prev = document.getElementById('pc-foto-preview');
    if (prev) prev.innerHTML = '<span class="foto-cargando">⏳ Procesando…</span>';
    const reader = new FileReader();
    reader.onload = function (ev) {
        const img = new Image();
        img.onload = function () {
            const maxW = 1280;
            const scale = Math.min(1, maxW / img.width);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            // Watermark con coordenada, precisión, lote y fecha/hora
            const barH = Math.max(40, Math.round(h * 0.11));
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, h - barH, w, barH);
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'middle';
            const fs = Math.max(13, Math.round(barH * 0.30));
            ctx.font = `600 ${fs}px Arial, sans-serif`;
            const l1 = puntoGPS
                ? `GPS ${puntoGPS.lat.toFixed(6)}, ${puntoGPS.long.toFixed(6)}  (±${Math.round(puntoGPS.precision)} m)`
                : 'Sin coordenada GPS';
            ctx.fillText(l1, 12, h - barH + barH * 0.32);
            ctx.font = `400 ${Math.round(fs * 0.82)}px Arial, sans-serif`;
            const lote = muestreoActual ? (muestreoActual.Lote || '') : '';
            ctx.fillText(`${lote}  ·  ${new Date().toLocaleString('es-AR')}`, 12, h - barH + barH * 0.72);

            puntoFotoBase64 = canvas.toDataURL('image/jpeg', 0.6);
            if (prev) prev.innerHTML = `<img src="${puntoFotoBase64}" alt="foto del punto">`;
        };
        img.onerror = function () { if (prev) prev.innerHTML = '<span class="foto-cargando">⚠️ No se pudo procesar la foto</span>'; };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

// Guardar el punto en el muestreo activo
document.getElementById('form-punto').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!muestreoActual) return;
    if (!puntoTipoSel) { alert('Elegí el tipo de observación.'); return; }

    const orden = (puntoEnEdicionIdx !== null && muestreoActual.Puntos[puntoEnEdicionIdx])
        ? (muestreoActual.Puntos[puntoEnEdicionIdx].Orden || puntoEnEdicionIdx + 1)
        : (muestreoActual.Puntos.length + 1);

    const punto = {
        Id_Punto: (puntoEnEdicionIdx !== null && muestreoActual.Puntos[puntoEnEdicionIdx] && muestreoActual.Puntos[puntoEnEdicionIdx].Id_Punto) || ('PT-' + Date.now()),
        Orden: orden,
        Lat: puntoGPS ? puntoGPS.lat : '',
        Long: puntoGPS ? puntoGPS.long : '',
        Precision_m: puntoGPS ? Math.round(puntoGPS.precision) : '',
        Timestamp: puntoGPS ? puntoGPS.timestamp : new Date().toISOString(),
        Cultivo: muestreoActual.Cultivo || '',
        Estado_Fenologico: document.getElementById('pc-fenologia').value,
        Tipo_Observacion: puntoTipoSel,
        Objetivo: document.getElementById('pc-objetivo').value.trim(),
        Severidad: puntoSevSel,
        Incidencia_pct: parseNumeroAR(document.getElementById('pc-incidencia').value),
        Conteo_Valor: parseNumeroAR(document.getElementById('pc-conteo').value),
        Conteo_Unidad: document.getElementById('pc-conteo-unidad').value,
        Nota: document.getElementById('pc-nota').value.trim(),
        Foto: puntoFotoBase64 || ''
    };

    if (puntoEnEdicionIdx !== null) muestreoActual.Puntos[puntoEnEdicionIdx] = punto;
    else muestreoActual.Puntos.push(punto);

    guardarMuestreoLocal(function () {
        renderMuestreoActivo();
        cambiarVista('view-muestreo-activo');
    });
});

function eliminarPunto(idx) {
    if (!muestreoActual) return;
    if (!confirm('¿Eliminar este punto del muestreo?')) return;
    muestreoActual.Puntos.splice(idx, 1);
    muestreoActual.Puntos.forEach((p, i) => { p.Orden = i + 1; });
    guardarMuestreoLocal(renderMuestreoActivo);
}

// --- 4.bis FICHA DEL MUESTREO -------------------------------------------
// Los datos del recorrido, de un vistazo. Antes esta pantalla arrancaba
// directo con el mapa y la lista de puntos: para saber de que campo, que
// campaña o quien lo habia hecho, habia que volver al listado.

function fechaLegibleMuestreo(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso);
}

function renderFichaMuestreo() {
    const m = muestreoActual;
    const cont = document.getElementById('ma-ficha');
    if (!m || !cont) return;

    const pts = m.Puntos || [];
    const conGps = pts.filter(p => p.Lat && p.Long);

    const filas = [
        ['Campo', m.Establecimiento],
        ['Lote', m.Lote],
        ['Cultivo', [m.Cultivo, m.Variedad].filter(Boolean).join(' / ')],
        ['Campaña', m.Campania],
        ['Fecha', fechaLegibleMuestreo(m.Fecha)],
        ['Responsable', [m.Responsable, m.Matricula ? 'Mat. ' + m.Matricula : ''].filter(Boolean).join(' · ')],
        ['Puntos', `${pts.length}${conGps.length !== pts.length ? ` (${conGps.length} con GPS)` : ''}`],
        ['Estado', m.Estado || 'Cerrado']
    ];

    cont.innerHTML = filas.map(f => `
        <div class="ficha-item">
            <span class="ficha-label">${escProd(f[0])}</span>
            <span class="ficha-valor">${escProd(f[1] || '—')}</span>
        </div>`).join('');

    // Ubicacion del recorrido: el centro de los puntos y que tan fino esta el GPS.
    const box = document.getElementById('ma-ubicacion');
    if (!box) return;
    if (conGps.length === 0) {
        box.innerHTML = '<i class="fas fa-location-crosshairs"></i> Ningún punto tiene coordenada guardada.';
        return;
    }
    const lat = conGps.reduce((t, p) => t + (+p.Lat), 0) / conGps.length;
    const lon = conGps.reduce((t, p) => t + (+p.Long), 0) / conGps.length;
    const precs = conGps.map(p => +p.Precision_m || 0).filter(Boolean);
    const precProm = precs.length ? Math.round(precs.reduce((t, x) => t + x, 0) / precs.length) : null;

    box.innerHTML = `
        <i class="fas fa-location-dot"></i>
        <span>Centro del recorrido: <b>${lat.toFixed(5)}, ${lon.toFixed(5)}</b>${precProm ? ` · precisión media ±${precProm} m` : ''}</span>
        <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener" class="ficha-link-maps">
            <i class="fas fa-up-right-from-square"></i> Abrir en Google Maps
        </a>`;
}

// --- 5. MAPA -------------------------------------------------------------
// Dos mapas, y los dos hacen falta:
//
//   - EN PANTALLA: Leaflet con imagen satelital. Es el que pidieron: sobre la
//     foto del lote se ve si el punto cayo en la cabecera, en la huella de la
//     monotolva o en el medio del cultivo. Un scatter sobre fondo verde no
//     dice nada de eso.
//
//   - EN CANVAS: el scatter de siempre. Sigue siendo necesario por dos
//     motivos: es el que se mete en el PDF (jsPDF necesita una imagen, no un
//     mapa interactivo) y es lo unico que se puede dibujar sin señal.
//
// POR QUE NO LA API DE GOOGLE MAPS: pide una clave con facturacion activa, y
// la clave quedaria a la vista en el repo, que es publico (GitHub Pages).
// Leaflet no necesita clave. Para el que quiere ir hasta el punto, cada
// coordenada tiene su link "Abrir en Google Maps", que usa la app del celular.

// Fuentes de tiles. Las dos son gratuitas y sin clave.
const TILES_SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATRIB_SATELITE = 'Imagen: Esri, Maxar, Earthstar Geographics';
const TILES_CALLES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIB_CALLES = '&copy; OpenStreetMap';

let mapaMuestreo = null;      // instancia de Leaflet (se reusa entre muestreos)
let capaPuntos = null;        // capa con los marcadores del muestreo abierto

function renderMapaMuestreo() {
    const divMapa = document.getElementById('mapa-muestreo');
    const canvas = document.getElementById('mapa-puntos');
    const aviso = document.getElementById('mapa-aviso-offline');
    if (!divMapa || !canvas) return;

    const pts = ((muestreoActual && muestreoActual.Puntos) || []).filter(p => p.Lat && p.Long);

    // Sin Leaflet (no cargo el vendor) o sin señal: el mapa satelital no puede
    // funcionar. Se cae al canvas, que no necesita nada.
    if (typeof L === 'undefined' || !navigator.onLine) {
        divMapa.classList.add('hidden');
        canvas.classList.remove('hidden');
        if (aviso) aviso.classList.toggle('hidden', navigator.onLine);
        drawMapaEnCanvas(canvas, false);
        return;
    }

    divMapa.classList.remove('hidden');
    canvas.classList.add('hidden');
    if (aviso) aviso.classList.add('hidden');

    if (!mapaMuestreo) {
        const satelite = L.tileLayer(TILES_SATELITE, { maxZoom: 19, attribution: ATRIB_SATELITE });
        const calles = L.tileLayer(TILES_CALLES, { maxZoom: 19, attribution: ATRIB_CALLES });
        mapaMuestreo = L.map('mapa-muestreo', {
            center: [-31.4, -64.2], zoom: 13, layers: [satelite],
            scrollWheelZoom: false   // en el celular se navega con los dedos; en la
                                     // compu, la rueda tiene que seguir haciendo scroll
                                     // de la pagina y no zoom del mapa sin querer.
        });
        L.control.layers({ 'Satélite': satelite, 'Calles': calles }, null, { position: 'topright' }).addTo(mapaMuestreo);
        L.control.scale({ imperial: false }).addTo(mapaMuestreo);
        capaPuntos = L.layerGroup().addTo(mapaMuestreo);
        // Un solo tile que no carga ya alcanza para avisar: sin base, el mapa
        // queda gris y el operario no entiende por que.
        mapaMuestreo.on('tileerror', function () {
            if (aviso) { aviso.classList.remove('hidden'); }
        });
    }

    capaPuntos.clearLayers();

    if (pts.length === 0) {
        setTimeout(() => mapaMuestreo.invalidateSize(), 60);
        return;
    }

    pts.forEach((p, i) => {
        const sev = SEVERIDADES[+p.Severidad || 0] || SEVERIDADES[0];
        const n = p.Orden || i + 1;
        const marcador = L.marker([+p.Lat, +p.Long], {
            icon: L.divIcon({
                className: 'marcador-punto',
                html: `<span style="background:${sev.color}">${n}</span>`,
                iconSize: [30, 30], iconAnchor: [15, 15]
            })
        });
        marcador.bindPopup(popupPunto(p, n, sev));
        capaPuntos.addLayer(marcador);

        // El circulo de precision no es decorativo: si el GPS reporto ±40 m, el
        // punto puede estar en cualquier lado de ese circulo, y eso cambia como
        // se lee el dato.
        const prec = +p.Precision_m || 0;
        if (prec > 0) {
            capaPuntos.addLayer(L.circle([+p.Lat, +p.Long], {
                radius: prec, color: sev.color, weight: 1, opacity: .5, fillOpacity: .08
            }));
        }
    });

    // invalidateSize: el mapa se arma mientras la vista todavia esta oculta y
    // Leaflet lo mide en 0x0. Sin esto, se ve un cuadrado gris hasta que alguien
    // cambia el tamaño de la ventana.
    setTimeout(function () {
        mapaMuestreo.invalidateSize();
        const bounds = L.latLngBounds(pts.map(p => [+p.Lat, +p.Long]));
        mapaMuestreo.fitBounds(bounds, { padding: [35, 35], maxZoom: 17 });
    }, 60);
}

function popupPunto(p, n, sev) {
    const foto = p.Foto ? `<img src="${p.Foto}" alt="foto del punto" class="popup-foto">` : '';
    const filas = [
        ['Observación', [p.Tipo_Observacion, p.Objetivo].filter(Boolean).join(' · ')],
        ['Severidad', sev.label],
        ['Fenología', p.Estado_Fenologico],
        ['Incidencia', p.Incidencia_pct ? p.Incidencia_pct + '%' : ''],
        ['Conteo', (p.Conteo_Valor && +p.Conteo_Valor) ? `${p.Conteo_Valor} ${p.Conteo_Unidad || ''}`.trim() : ''],
        ['Nota', p.Nota]
    ].filter(f => f[1]);

    return `<div class="popup-punto">
        <div class="popup-titulo">Punto #${n}</div>
        ${foto}
        ${filas.map(f => `<div class="popup-fila"><b>${escProd(f[0])}:</b> ${escProd(f[1])}</div>`).join('')}
        <div class="popup-fila popup-coord">${(+p.Lat).toFixed(6)}, ${(+p.Long).toFixed(6)}${p.Precision_m ? ` (±${Math.round(+p.Precision_m)} m)` : ''}</div>
        <a href="https://www.google.com/maps?q=${+p.Lat},${+p.Long}" target="_blank" rel="noopener">Abrir en Google Maps</a>
    </div>`;
}

// --- 5.bis MAPA EN CANVAS (para el PDF y para cuando no hay señal) ---
// El mapa que va al PDF y el que se ve cuando no hay señal.
//
// `conTiles` trae la imagen satelital de fondo. Se usa para el PDF: un reporte
// con los puntos sobre la foto del lote se entiende; el mismo reporte con los
// puntos sobre un rectangulo verde, no.
//
// Los tiles se piden con crossOrigin="anonymous" A PROPOSITO: una imagen de
// otro dominio dibujada sin eso "contamina" el canvas y despues toDataURL()
// tira SecurityError — el PDF se quedaria sin mapa. Con crossOrigin, el tile
// que no da permiso simplemente no carga y se lo saltea; los puntos se dibujan
// igual sobre el fondo liso.
async function drawMapaEnCanvas(canvas, conTiles) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#eef3ea';
    ctx.fillRect(0, 0, W, H);

    const pts = ((muestreoActual && muestreoActual.Puntos) || []).filter(p => p.Lat && p.Long);
    if (pts.length === 0) {
        ctx.fillStyle = '#9aa79a';
        ctx.font = `${Math.round(H * 0.06)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('Sin puntos georreferenciados todavía', W / 2, H / 2);
        ctx.textAlign = 'start';
        return;
    }

    const proy = proyectarPuntos(pts, W, H);
    let hayFondo = false;
    if (conTiles && navigator.onLine) {
        try { hayFondo = await dibujarTilesEnCanvas(ctx, proy, W, H); }
        catch (err) { console.warn('[muestreo] No se pudieron dibujar los tiles:', err); }
    }

    const r = Math.max(9, Math.round(W * 0.018));
    pts.forEach((p, i) => {
        const x = proy.toX(+p.Long), y = proy.toY(+p.Lat);
        const sev = SEVERIDADES[+p.Severidad || 0] || SEVERIDADES[0];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = sev.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(r)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.Orden || i + 1), x, y);
    });

    if (hayFondo) {
        // Credito obligatorio de la fuente de imagenes.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = `${Math.max(10, Math.round(W * 0.014))}px Arial, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(ATRIB_SATELITE, W - 6, H - 5);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

// --- Proyeccion Web Mercator, la misma que usan los tiles ---------------
// Antes los puntos se ubicaban con una regla de tres entre el minimo y el
// maximo. Sirve para un scatter suelto, pero NO coincide con ningun mapa: para
// poder poner la imagen satelital abajo hay que usar la proyeccion de verdad.
function lonAX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z) * 256; }
function latAY(lat, z) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256;
}

// Elige el zoom mas cercano donde entran todos los puntos, y devuelve las
// funciones que pasan de lat/long a pixel del canvas.
function proyectarPuntos(pts, W, H) {
    const lats = pts.map(p => +p.Lat), lons = pts.map(p => +p.Long);
    const minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    const minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    const margen = Math.round(W * 0.08);

    // Tope en 17: con un punto solo, el zoom maximo mostraria cuatro matas y
    // nada de contexto. 17 deja ver el lote alrededor.
    let z = 17;
    for (; z > 2; z--) {
        const dx = lonAX(maxLon, z) - lonAX(minLon, z);
        const dy = latAY(minLat, z) - latAY(maxLat, z);
        if (dx <= W - 2 * margen && dy <= H - 2 * margen) break;
    }

    const originX = (lonAX(minLon, z) + lonAX(maxLon, z)) / 2 - W / 2;
    const originY = (latAY(minLat, z) + latAY(maxLat, z)) / 2 - H / 2;

    return {
        z: z, originX: originX, originY: originY,
        toX: lon => lonAX(lon, z) - originX,
        toY: lat => latAY(lat, z) - originY
    };
}

// Baja los tiles que cubren el canvas y los dibuja. Devuelve true si entro
// aunque sea uno (para saber si hay que poner el credito).
function dibujarTilesEnCanvas(ctx, proy, W, H) {
    const z = proy.z;
    const maxTile = Math.pow(2, z) - 1;
    const tx0 = Math.floor(proy.originX / 256), tx1 = Math.floor((proy.originX + W) / 256);
    const ty0 = Math.floor(proy.originY / 256), ty1 = Math.floor((proy.originY + H) / 256);

    const cargas = [];
    for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
            if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) continue;
            const url = TILES_SATELITE.replace('{z}', z).replace('{y}', ty).replace('{x}', tx);
            cargas.push(cargarTile(url, tx * 256 - proy.originX, ty * 256 - proy.originY));
        }
    }

    return Promise.all(cargas).then(function (resultados) {
        let dibujados = 0;
        resultados.forEach(function (t) {
            if (!t) return;                      // tile que no cargo: se saltea
            ctx.drawImage(t.img, t.x, t.y, 256, 256);
            dibujados++;
        });
        return dibujados > 0;
    });
}

// Un tile que falla NO rompe el mapa: se resuelve en null y el fondo queda liso
// en ese pedazo. Tambien hay un tope de tiempo, porque en el campo la conexion
// puede quedar colgada y el PDF no puede esperar para siempre.
function cargarTile(url, x, y) {
    return new Promise(function (resolve) {
        const img = new Image();
        let listo = false;
        const terminar = valor => { if (!listo) { listo = true; resolve(valor); } };
        setTimeout(() => terminar(null), 8000);
        img.crossOrigin = 'anonymous';
        img.onload = () => terminar({ img: img, x: x, y: y });
        img.onerror = () => terminar(null);
        img.src = url;
    });
}

// --- 6. PERSISTENCIA LOCAL (IndexedDB) + SINCRONIZACIÓN ---
function guardarMuestreoLocal(cb) {
    if (!db || !muestreoActual) { if (cb) cb(); return; }
    muestreoActual._synced = false;
    const tx = db.transaction(['muestreos'], 'readwrite');
    const store = tx.objectStore('muestreos');
    const req = (muestreoActual.id !== undefined) ? store.put(muestreoActual) : store.add(muestreoActual);
    req.onsuccess = function (e) {
        if (muestreoActual.id === undefined) muestreoActual.id = e.target.result;
        if (navigator.onLine) sincronizarMuestreosPendientes();
        if (cb) cb();
    };
    req.onerror = function (ev) {
        console.error('Error guardando el muestreo en este dispositivo:', ev.target.error);
        alert('⚠️ No se pudo guardar el muestreo localmente. Puede que las fotos ocupen demasiado espacio.');
        if (cb) cb();
    };
}

function obtenerMuestreosLocales() {
    return new Promise(resolve => {
        if (!db || !db.objectStoreNames.contains('muestreos')) { resolve([]); return; }
        try {
            const tx = db.transaction(['muestreos'], 'readonly');
            const req = tx.objectStore('muestreos').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}

// Sube los muestreos con cambios pendientes. Usa "actualizar_muestreo"
// (borra+reinserta en el Sheet, idempotente) y marca _synced sin borrar la
// copia local, para que siga siendo la copia de trabajo del operario.
function sincronizarMuestreosPendientes() {
    if (!db || !navigator.onLine || WEB_APP_URL.includes('AQUÍ_VA')) return;
    const tx = db.transaction(['muestreos'], 'readonly');
    tx.objectStore('muestreos').getAll().onsuccess = function (e) {
        const pendientes = (e.target.result || []).filter(m => m._synced === false);
        pendientes.forEach(function (item) {
            const payload = Object.assign({ _accion: 'actualizar_muestreo' }, item);
            delete payload.id;
            delete payload._synced;
            // Solo se marca como sincronizado si el backend lo confirmó. Si falla
            // (por ejemplo, no puede subir la foto del punto a Drive), queda con
            // _synced:false y se reintenta en la próxima pasada.
            enviarAlBackend(payload)
            .then(function () {
                const up = db.transaction(['muestreos'], 'readwrite');
                const store = up.objectStore('muestreos');
                store.get(item.id).onsuccess = function (ev) {
                    const rec = ev.target.result;
                    if (!rec) return;
                    rec._synced = true;
                    store.put(rec);
                };
            })
            .catch(function (err) {
                console.error('No se pudo sincronizar el muestreo:', err);
                if (err && err.rechazadoPorBackend) {
                    alert('⚠️ El muestreo no se pudo guardar en el servidor y quedó pendiente en este dispositivo.\n\n' +
                          'Motivo: ' + err.message + '\n\n' +
                          'No borres los datos del navegador: se va a reintentar solo.');
                }
            });
        });
    };
}

function cargarMuestreosDesdeGoogle() {
    if (!navigator.onLine || WEB_APP_URL.includes('AQUÍ_VA')) return;
    fetch(`${WEB_APP_URL}?action=read_muestreos`)
        .then(res => res.json())
        .then(data => {
            // Mismo cuidado que en Calidad (hallazgo 14): un filtro que da cero
            // puede ser "no hay muestreos" o "me mandaron otra cosa".
            const pareceMuestreos = Array.isArray(data) &&
                (data.length === 0 || data.some(m => m && m.Id_Muestreo));
            if (pareceMuestreos) historialMuestreos = data.filter(m => m && m.Id_Muestreo);
            else console.warn("[produccion] El servidor devolvió algo que no son muestreos; se conserva lo que había.");
            const vista = document.getElementById('view-modulo-produccion');
            if (vista && !vista.classList.contains('hidden')) renderListaMuestreos();
        })
        .catch(err => console.error('Error cargando muestreos:', err));
}

// --- 7. HISTORIAL DE MUESTREOS (local + remoto, deduplicado) ---
async function renderListaMuestreos() {
    const cont = document.getElementById('lista-muestreos');
    if (!cont) return;
    const locales = await obtenerMuestreosLocales();
    const idsLocales = new Set(locales.map(m => m.Id_Muestreo));
    const remotos = (historialMuestreos || []).filter(m => !idsLocales.has(m.Id_Muestreo));
    let lista = locales.map(m => Object.assign({}, m, { _local: true })).concat(remotos);

    const txt = (document.getElementById('filter-prod-search').value || '').toLowerCase();
    const fd = document.getElementById('filter-prod-fecha-desde').value;
    const fh = document.getElementById('filter-prod-fecha-hasta').value;
    lista = lista.filter(m => {
        if (fd && m.Fecha && m.Fecha < fd) return false;
        if (fh && m.Fecha && m.Fecha > fh) return false;
        if (txt) {
            const s = `${m.Establecimiento || ''} ${m.Lote || ''} ${m.Cultivo || ''} ${m.Campania || ''}`.toLowerCase();
            if (!s.includes(txt)) return false;
        }
        return true;
    });
    lista.sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));
    muestreosRenderizados = lista;

    if (lista.length === 0) {
        cont.innerHTML = '<p class="lista-vacia">No hay muestreos que coincidan con los filtros.</p>';
        return;
    }
    // AGRUPADO POR CAMPO.
    // Antes era una lista plana de tarjetas que arrancaban con el numero de
    // lote: "1 · Soja", "1 · Soja", "1 · Soja"... tres recorridos distintos que
    // se veian iguales. El trabajo se organiza por CAMPO: se entra a La Lucila
    // y ahi estan sus lotes, con su fecha y sus puntos.
    const porCampo = {};
    lista.forEach((m, i) => {
        const campo = (m.Establecimiento || 'Sin campo').trim();
        if (!porCampo[campo]) porCampo[campo] = [];
        porCampo[campo].push({ m: m, i: i });   // `i` es el indice en muestreosRenderizados
    });

    cont.innerHTML = Object.keys(porCampo).sort().map(campo => {
        const items = porCampo[campo];
        const lotes = Array.from(new Set(items.map(x => x.m.Lote).filter(Boolean)));
        const puntos = items.reduce((t, x) => t + ((x.m.Puntos || []).length), 0);
        const ultima = items.map(x => x.m.Fecha || '').sort().slice(-1)[0] || '';

        const tarjetas = items.map(({ m, i }) => {
            const np = (m.Puntos || []).length;
            const pend = (m._local && m._synced === false) ? '<span class="badge-pendiente">Sin sincronizar</span>' : '';
            const conGps = (m.Puntos || []).filter(p => p.Lat && p.Long).length;
            return `<div class="muestreo-card" onclick="abrirMuestreoDesdeLista(${i})">
                <div class="muestreo-card-top">
                    <strong>${m.Lote ? 'Lote ' + escProd(m.Lote) : 'Sin lote'}</strong>
                    <span class="muestreo-fecha">${escProd(fechaLegibleMuestreo(m.Fecha))}</span>
                </div>
                <div class="muestreo-card-sub">${escProd([m.Cultivo, m.Variedad, m.Campania].filter(Boolean).join(' · '))}</div>
                <div class="muestreo-card-meta">
                    <i class="fas fa-location-dot"></i> ${np} punto${np === 1 ? '' : 's'}${conGps < np ? ` (${conGps} con GPS)` : ''}${m.Responsable ? ' · ' + escProd(m.Responsable) : ''} ${pend}
                </div>
            </div>`;
        }).join('');

        return `<div class="campo-grupo">
            <div class="campo-grupo-header">
                <div class="campo-grupo-nombre"><i class="fas fa-tractor"></i> ${escProd(campo)}</div>
                <div class="campo-grupo-meta">
                    ${items.length} recorrida${items.length === 1 ? '' : 's'} ·
                    ${lotes.length ? escProd(lotes.length === 1 ? 'lote ' + lotes[0] : lotes.length + ' lotes') : 'sin lotes'} ·
                    ${puntos} punto${puntos === 1 ? '' : 's'}${ultima ? ' · última ' + escProd(fechaLegibleMuestreo(ultima)) : ''}
                </div>
            </div>
            <div class="campo-grupo-body">${tarjetas}</div>
        </div>`;
    }).join('');
}

function abrirMuestreoDesdeLista(i) {
    const m = muestreosRenderizados[i];
    if (!m) return;
    muestreoActual = JSON.parse(JSON.stringify(m)); // copia de trabajo
    if (!Array.isArray(muestreoActual.Puntos)) muestreoActual.Puntos = [];
    renderMuestreoActivo();
    cambiarVista('view-muestreo-activo');
}

function eliminarMuestreoActual() {
    if (!muestreoActual) return;
    if (!confirm('¿Eliminar todo este muestreo y sus puntos? Esta acción no se puede deshacer.')) return;
    const id = muestreoActual.id;
    const idM = muestreoActual.Id_Muestreo;
    if (db && id !== undefined) {
        const tx = db.transaction(['muestreos'], 'readwrite');
        tx.objectStore('muestreos').delete(id);
    }
    if (navigator.onLine && !WEB_APP_URL.includes('AQUÍ_VA')) {
        enviarAlBackend({ _accion: 'eliminar_muestreo', Id_Muestreo: idM })
            .catch(function (err) {
                console.error('No se pudo notificar el borrado del muestreo:', err);
                if (err && err.rechazadoPorBackend) {
                    alert('⚠️ El muestreo se borró de este dispositivo pero NO del servidor.\n\n' +
                          'Motivo: ' + err.message + '\n\n' +
                          'Va a volver a aparecer la próxima vez que se recargue el historial.');
                }
            });
    }
    historialMuestreos = (historialMuestreos || []).filter(m => m.Id_Muestreo !== idM);
    muestreoActual = null;
    cambiarVista('view-modulo-produccion');
    switchTabProduccion('historial');
}

// --- 8. REPORTE PDF + WHATSAPP ---
function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Convierte una foto (dataURL o URL de Drive) a dataURL para el PDF.
//
// POR QUÉ ESTO DELEGA EN CALIDAD
// La versión propia que había acá cargaba la foto en un <img> con
// crossOrigin="anonymous" apuntando al link que guarda el backend
// (drive.google.com/uc?export=download). Ese link devuelve la imagen, pero
// SIN el encabezado Access-Control-Allow-Origin, así que el navegador aborta
// la carga, salta onerror y el PDF salía con "sin foto" en todos los puntos.
//
// calidad.js ya había resuelto exactamente esto: hay que bajar del CDN final
// (lh3.googleusercontent.com/d/<id>), que responde la imagen directo y con
// CORS abierto. En vez de repetir esa lógica, se reusa la que ya está probada.
//
// La dependencia es segura: index.html carga calidad.js ANTES de produccion.js,
// igual que produccion.js ya depende de escapeHtml y parseNumeroAR de app.js.
function imgProduccionADataUrl(src) {
    if (typeof cargarImagenParaPDF === 'function') return cargarImagenParaPDF(src);

    // Solo se llega acá si calidad.js no se cargó. Se resuelve en null para que
    // el reporte salga igual, con el recuadro de "sin foto".
    console.warn('cargarImagenParaPDF no está disponible: el reporte sale sin fotos.');
    return Promise.resolve(String(src || '').startsWith('data:') ? src : null);
}

// Envoltorio con manejo de error. Sin esto, cualquier excepción adentro de la
// función async se convertía en una promesa rechazada que nadie escuchaba: el
// botón no hacía NADA y no aparecía ningún mensaje. Pasó de verdad con un
// muestreo cuyo Lote era el número 1 (ver armarReporteMuestreo).
async function generarReporteMuestreo(modo) {
    try {
        await armarReporteMuestreo(modo);
    } catch (err) {
        console.error('No se pudo generar el reporte del muestreo:', err);
        alert('No se pudo generar el reporte.\n\nMotivo: ' + ((err && err.message) || err) +
              '\n\nSi se repite, avisá con este mensaje.');
    }
}

async function armarReporteMuestreo(modo) {
    if (!muestreoActual) return;
    const m = muestreoActual;
    if (!(m.Puntos || []).length) { alert('Agregá al menos un punto antes de generar el reporte.'); return; }
    if (!window.jspdf) { alert('No se pudo cargar el generador de PDF (vendor/jspdf.umd.min.js). Probá recargar la app.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const W = 210, M = 14;
    let y = 16;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(167, 29, 29);
    doc.text('Reporte de Muestreo de Campo', M, y); y += 7;
    doc.setDrawColor(167, 29, 29); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 6;

    // Encabezado
    doc.setTextColor(40); doc.setFontSize(10);
    const enc = [
        ['Establecimiento', m.Establecimiento || '-', 'Lote', m.Lote || '-'],
        ['Campaña', m.Campania || '-', 'Cultivo', (m.Cultivo || '-') + (m.Variedad ? (' / ' + m.Variedad) : '')],
        ['Responsable', m.Responsable || '-', 'Matrícula', m.Matricula || '-'],
        ['Fecha', m.Fecha || '-', 'Puntos', String((m.Puntos || []).length)]
    ];
    enc.forEach(row => {
        doc.setFont('helvetica', 'bold'); doc.text(row[0] + ':', M, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(row[1]), M + 32, y);
        doc.setFont('helvetica', 'bold'); doc.text(row[2] + ':', W / 2, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(row[3]), W / 2 + 26, y);
        y += 6;
    });
    y += 2;

    // Mapa
    const mapC = document.createElement('canvas');
    mapC.width = 900; mapC.height = 500;
    // Con señal, el mapa del reporte sale sobre la imagen satelital.
    await drawMapaEnCanvas(mapC, true);
    try {
        const mapImg = mapC.toDataURL('image/jpeg', 0.85);
        const mw = W - 2 * M, mh = mw * 500 / 900;
        doc.addImage(mapImg, 'JPEG', M, y, mw, mh);
        y += mh + 6;
    } catch (e) { /* sin mapa */ }

    // Resumen por severidad
    const conteoSev = [0, 0, 0, 0, 0];
    (m.Puntos || []).forEach(p => { conteoSev[+p.Severidad || 0]++; });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(167, 29, 29);
    doc.text('Resumen por severidad', M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
    doc.text(SEVERIDADES.map((s, i) => `${s.label}: ${conteoSev[i]}`).join('    |    '), M, y);
    y += 8;

    // Fichas por punto
    const pts = m.Puntos || [];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const cardH = 30;
        if (y + cardH > 285) { doc.addPage(); y = 16; }
        const sev = SEVERIDADES[+p.Severidad || 0] || SEVERIDADES[0];
        doc.setDrawColor(225); doc.setFillColor(250, 250, 250);
        doc.roundedRect(M, y, W - 2 * M, cardH, 2, 2, 'FD');
        const c = hexToRgb(sev.color);
        doc.setFillColor(c.r, c.g, c.b); doc.rect(M, y, 2.5, cardH, 'F');

        const fx = M + 6, fy = y + 3, fsz = 24;
        const fdata = await imgProduccionADataUrl(p.Foto);
        if (fdata) {
            try { doc.addImage(fdata, 'JPEG', fx, fy, fsz, fsz); }
            catch (e) { doc.setDrawColor(210); doc.rect(fx, fy, fsz, fsz); }
        } else {
            doc.setDrawColor(210); doc.rect(fx, fy, fsz, fsz);
            doc.setFontSize(7); doc.setTextColor(150); doc.text('sin foto', fx + 6, fy + 13); doc.setTextColor(40);
        }

        const tx = fx + fsz + 5; let ty = y + 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(40);
        doc.text(`Punto #${p.Orden || i + 1} — ${p.Tipo_Observacion || ''}${p.Objetivo ? ' · ' + p.Objetivo : ''}`, tx, ty); ty += 5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        const coord = (p.Lat && p.Long) ? `${(+p.Lat).toFixed(6)}, ${(+p.Long).toFixed(6)} (±${p.Precision_m || '?'} m)` : 'Sin GPS';
        doc.text(`Coord.: ${coord}`, tx, ty); ty += 4.5;
        doc.text(`Fenología: ${p.Estado_Fenologico || '-'}   Severidad: ${sev.label}   Incidencia: ${p.Incidencia_pct || 0}%`, tx, ty); ty += 4.5;
        if (p.Conteo_Valor) { doc.text(`Conteo: ${p.Conteo_Valor} ${p.Conteo_Unidad || ''}`, tx, ty); ty += 4.5; }
        if (p.Nota) { doc.text(doc.splitTextToSize('Nota: ' + p.Nota, W - 2 * M - fsz - 14), tx, ty); }
        y += cardH + 4;
    }

    // Recomendaciones / observaciones generales
    if (m.Observaciones) {
        if (y > 270) { doc.addPage(); y = 16; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(167, 29, 29);
        doc.text('Recomendaciones', M, y); y += 5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
        doc.text(doc.splitTextToSize(m.Observaciones, W - 2 * M), M, y);
    }

    // ACÁ ESTABA EL BUG DEL REPORTE QUE NO SALÍA.
    // El Sheet devuelve un NÚMERO cuando la celda tiene un número, así que un
    // muestreo con el lote "1" llegaba con m.Lote = 1, y los números no tienen
    // .replace(): TypeError. Como la función es async y no atrapaba nada, el
    // botón no hacía absolutamente nada y no aparecía ningún error.
    // Los muestreos con lote "Lote1" o "ddd" funcionaban, y por eso parecía
    // que el reporte "andaba a veces".
    const loteTexto = String(m.Lote === undefined || m.Lote === null || m.Lote === '' ? 'lote' : m.Lote);
    const nombre = `Muestreo_${loteTexto.replace(/\s+/g, '_')}_${m.Fecha || ''}.pdf`;

    if (modo === 'compartir') {
        const blob = doc.output('blob');
        const file = new File([blob], nombre, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Reporte de Muestreo', text: `Muestreo ${m.Lote || ''} — ${m.Cultivo || ''} (${(m.Puntos || []).length} puntos)` });
                return;
            } catch (e) { return; /* el usuario canceló */ }
        }
        // Plan B (típicamente escritorio, donde no se puede compartir archivos):
        // se descarga el PDF y se abre WhatsApp con un resumen para adjuntarlo a mano.
        doc.save(nombre);
        const resumen = `Reporte de muestreo ${loteTexto} (${m.Cultivo || ''}) — ${(m.Puntos || []).length} puntos.`;
        const enlace = 'https://wa.me/?text=' + encodeURIComponent(resumen);

        // OJO: esto corre DESPUÉS de varios await, así que el navegador ya no lo
        // considera parte del clic del usuario y el bloqueador de pop-ups lo puede
        // frenar sin decir nada. Si eso pasa, window.open devuelve null y hay que
        // avisar, porque si no el operario ve que se descargó el PDF y cree que
        // WhatsApp no funciona.
        const ventana = window.open(enlace, '_blank');
        if (!ventana) {
            alert('El PDF se descargó: "' + nombre + '".\n\n' +
                  'El navegador bloqueó la ventana de WhatsApp. Abrilo vos y adjuntá el archivo.');
        }
    } else {
        doc.save(nombre);
    }
}

// --- 9. FILTROS DEL HISTORIAL ---
['filter-prod-search', 'filter-prod-fecha-desde', 'filter-prod-fecha-hasta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.type === 'text' ? 'input' : 'change', renderListaMuestreos);
});

// --- 10. EXPOSICIÓN GLOBAL (para los onclick del HTML) ---
window.abrirModuloProduccion = abrirModuloProduccion;
window.switchTabProduccion = switchTabProduccion;
window.nuevoPunto = nuevoPunto;
window.editarPunto = editarPunto;
window.eliminarPunto = eliminarPunto;
window.cancelarPunto = cancelarPunto;
window.capturarGPS = capturarGPS;
window.handleFotoPunto = handleFotoPunto;
window.seleccionarTipoObs = seleccionarTipoObs;
window.seleccionarSeveridad = seleccionarSeveridad;
window.abrirMuestreoDesdeLista = abrirMuestreoDesdeLista;
window.eliminarMuestreoActual = eliminarMuestreoActual;
window.generarReporteMuestreo = generarReporteMuestreo;
window.cargarMuestreosDesdeGoogle = cargarMuestreosDesdeGoogle;
window.sincronizarMuestreosPendientes = sincronizarMuestreosPendientes;
