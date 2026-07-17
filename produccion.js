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
    document.getElementById('ma-titulo').textContent = `${m.Lote || 'Lote'} — ${m.Cultivo || ''}`;
    document.getElementById('ma-subtitulo').textContent = `${m.Establecimiento || ''}${m.Campania ? ' · ' + m.Campania : ''}`;

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
            const coord = (p.Lat && p.Long) ? `${(+p.Lat).toFixed(5)}, ${(+p.Long).toFixed(5)}` : 'Sin GPS';
            return `<div class="punto-card" onclick="editarPunto(${i})">
                ${foto}
                <div class="punto-info">
                    <div class="punto-top"><span class="punto-num">#${p.Orden || i + 1}</span><span class="sev-pill" style="background:${sev.color}">${sev.label}</span></div>
                    <div class="punto-obs">${escProd(p.Tipo_Observacion || '—')}${p.Objetivo ? ' · ' + escProd(p.Objetivo) : ''}</div>
                    <div class="punto-meta">${coord}${p.Estado_Fenologico ? ' · ' + escProd(p.Estado_Fenologico) : ''}</div>
                </div>
                <button class="punto-del" onclick="event.stopPropagation(); eliminarPunto(${i})" title="Eliminar punto"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
    }
    drawMapaEnCanvas(document.getElementById('mapa-puntos'));
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

// --- 5. MAPA (scatter en canvas, funciona offline; base cartográfica = fase 2) ---
function drawMapaEnCanvas(canvas) {
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

    const lats = pts.map(p => +p.Lat), longs = pts.map(p => +p.Long);
    let minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    let minLong = Math.min.apply(null, longs), maxLong = Math.max.apply(null, longs);
    const pad = 0.0004;
    if (maxLat - minLat < pad) { minLat -= pad; maxLat += pad; }
    if (maxLong - minLong < pad) { minLong -= pad; maxLong += pad; }

    const m = Math.round(W * 0.06);
    const r = Math.max(9, Math.round(W * 0.018));
    const toX = lon => m + (lon - minLong) / (maxLong - minLong) * (W - 2 * m);
    const toY = lat => (H - m) - (lat - minLat) / (maxLat - minLat) * (H - 2 * m); // norte arriba

    pts.forEach((p, i) => {
        const x = toX(+p.Long), y = toY(+p.Lat);
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
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
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
            fetch(WEB_APP_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
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
            .catch(err => console.error('No se pudo sincronizar el muestreo:', err));
        });
    };
}

function cargarMuestreosDesdeGoogle() {
    if (!navigator.onLine || WEB_APP_URL.includes('AQUÍ_VA')) return;
    fetch(`${WEB_APP_URL}?action=read_muestreos`)
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) historialMuestreos = data.filter(m => m && m.Id_Muestreo);
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
    cont.innerHTML = lista.map((m, i) => {
        const np = (m.Puntos || []).length;
        const pend = (m._local && m._synced === false) ? '<span class="badge-pendiente">Sin sincronizar</span>' : '';
        return `<div class="muestreo-card" onclick="abrirMuestreoDesdeLista(${i})">
            <div class="muestreo-card-top"><strong>${escProd(m.Lote || 'Lote')} · ${escProd(m.Cultivo || '')}</strong><span class="muestreo-fecha">${escProd(m.Fecha || '')}</span></div>
            <div class="muestreo-card-sub">${escProd(m.Establecimiento || '')}${m.Campania ? ' · ' + escProd(m.Campania) : ''}</div>
            <div class="muestreo-card-meta"><i class="fas fa-location-dot"></i> ${np} punto${np === 1 ? '' : 's'}${m.Responsable ? ' · ' + escProd(m.Responsable) : ''} ${pend}</div>
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
        fetch(WEB_APP_URL, {
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _accion: 'eliminar_muestreo', Id_Muestreo: idM })
        }).catch(() => {});
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
function imgProduccionADataUrl(src) {
    return new Promise(resolve => {
        if (!src) { resolve(null); return; }
        if (String(src).startsWith('data:')) { resolve(src); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                resolve(c.toDataURL('image/jpeg', 0.7));
            } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = src;
    });
}

async function generarReporteMuestreo(modo) {
    if (!muestreoActual) return;
    const m = muestreoActual;
    if (!(m.Puntos || []).length) { alert('Agregá al menos un punto antes de generar el reporte.'); return; }
    if (!window.jspdf) { alert('No se pudo cargar el generador de PDF.'); return; }

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
    drawMapaEnCanvas(mapC);
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

    const nombre = `Muestreo_${(m.Lote || 'lote').replace(/\s+/g, '_')}_${m.Fecha || ''}.pdf`;

    if (modo === 'compartir') {
        const blob = doc.output('blob');
        const file = new File([blob], nombre, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Reporte de Muestreo', text: `Muestreo ${m.Lote || ''} — ${m.Cultivo || ''} (${(m.Puntos || []).length} puntos)` });
                return;
            } catch (e) { return; /* el usuario canceló */ }
        }
        // Fallback: descarga el PDF y abre WhatsApp con un resumen
        doc.save(nombre);
        window.open('https://wa.me/?text=' + encodeURIComponent(`Reporte de muestreo ${m.Lote || ''} (${m.Cultivo || ''}) — ${(m.Puntos || []).length} puntos.`), '_blank');
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
