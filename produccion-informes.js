// =========================================================================
// PRODUCCIÓN → SUBMÓDULO "INFORMES DE CAMPO"
// -------------------------------------------------------------------------
// Qué resuelve: hoy el equipo de producción escribe a mano, en el celular y a
// pleno sol, mensajes de 40 líneas en un grupo de WhatsApp (siembra, conteo de
// nacimiento, estadios). Este submódulo los arma solo, a partir de datos que
// además quedan GUARDADOS Y ESTRUCTURADOS — que es lo que WhatsApp nunca va a
// poder dar: la evolución de un lote a lo largo de la campaña.
//
// El otro submódulo (produccion.js, "Muestreo de Campo") NO se toca: es otro
// modelo de trabajo, el de monitoreo punto por punto con GPS.
//
// Diseño completo y análisis de límites: DOCUMENTACION_PRODUCCION_V2.md
//
// DOS DECISIONES QUE NO SON DETALLE:
//
//   1. La media se guarda como Blob en un store APARTE ("informes_media"),
//      nunca como base64 adentro del informe. Base64 infla 33% y obliga a
//      tener el archivo entero como string de JavaScript: una foto aguanta,
//      un video de 60 MB tira abajo el navegador. Y al estar en otro store,
//      listar los informes no carga ni un byte de video.
//
//   2. El informe (texto) y la media se sincronizan por separado. El texto son
//      2 KB y sube aunque haya una sola barra de señal. Si se mandara todo
//      junto, una foto que falla haría fallar el informe entero — que es
//      exactamente lo que le pasa hoy al submódulo de Muestreo.
//
// Reutiliza de app.js: db, WEB_APP_URL, enviarAlBackend, cambiarVista,
// poblarSelect, ENUMS, parseNumeroAR, escapeHtml, obtenerSesion,
// usuarioRegistroActual.
// =========================================================================

// ---------------------------------------------------------------------------
// 1. CATÁLOGOS
// ---------------------------------------------------------------------------

// Los seis tipos que se mandan hoy por WhatsApp. Cada uno pide campos
// DISTINTOS: ese es todo el secreto de que el formulario sea simple. No es un
// formulario más chico, es un formulario distinto por tipo.
const TIPOS_INFORME = [
    {
        id: 'gira', label: 'Gira previa', emoji: '🔎',
        titulo: 'Gira de recorrida — lotes a sembrar',
        camposLote: ['humedad', 'nota'],
        bloques: ['condicion', 'malezas', 'observaciones', 'acciones']
    },
    {
        id: 'semilla', label: 'Envío de semilla', emoji: '🚛',
        titulo: 'Envío de semilla',
        camposLote: ['kg', 'nota'],
        bloques: ['semilla', 'observaciones', 'acciones']
    },
    {
        id: 'siembra', label: 'Siembra', emoji: '🌱',
        titulo: 'Siembra',
        camposLote: ['sem_m', 'distribucion', 'prof_cm'],
        bloques: ['condicion', 'sembradoras', 'malezas', 'observaciones', 'acciones']
    },
    {
        id: 'nacimiento', label: 'Post-siembra / Nacimiento', emoji: '📏',
        titulo: 'Conteo de plantas y nacimiento',
        camposLote: ['plantas_m', 'estadio', 'dano_pct'],
        bloques: ['desarrollo', 'plagas', 'malezas', 'observaciones', 'acciones']
    },
    {
        id: 'vegetativo', label: 'Estadio vegetativo', emoji: '🌿',
        titulo: 'Recorrida — estadio vegetativo',
        camposLote: ['estadio', 'nota'],
        bloques: ['desarrollo', 'plagas', 'malezas', 'observaciones', 'acciones']
    },
    {
        id: 'reproductivo', label: 'Estadio reproductivo', emoji: '🌻',
        titulo: 'Recorrida — estadio reproductivo',
        camposLote: ['estadio', 'nota'],
        bloques: ['desarrollo', 'plagas', 'malezas', 'observaciones', 'acciones']
    }
];

// Los campos que puede tener la medición de un lote. `unidad` va en el mensaje.
const CAMPOS_LOTE = {
    sem_m:        { label: 'Semillas por metro', tipo: 'num', unidad: '', etiquetaMsg: 'Semillas por metro' },
    plantas_m:    { label: 'Plantas por metro',  tipo: 'num', unidad: '', etiquetaMsg: 'Plantas por metro' },
    prof_cm:      { label: 'Profundidad',        tipo: 'num', unidad: 'cm', etiquetaMsg: 'Profundidad de siembra' },
    dano_pct:     { label: '% de daño',          tipo: 'num', unidad: '%', etiquetaMsg: 'Daño' },
    kg:           { label: 'Kg enviados',        tipo: 'num', unidad: 'kg', etiquetaMsg: 'Kg' },
    distribucion: { label: 'Distribución',       tipo: 'select', etiquetaMsg: 'Distribución',
                    opciones: ['Muy buena', 'Buena', 'Regular', 'Despareja'] },
    humedad:      { label: 'Humedad',            tipo: 'select', etiquetaMsg: 'Humedad',
                    opciones: ['Muy buena', 'Buena', 'Justa', 'Escasa'] },
    estadio:      { label: 'Estadío fenológico', tipo: 'texto', etiquetaMsg: 'Estadío',
                    placeholder: 'Ej. V6-V7, R1' },
    nota:         { label: 'Nota',               tipo: 'texto', etiquetaMsg: '', placeholder: 'Opcional' }
};

// Bloques narrados. Los chips son las frases que más se repiten en los mensajes
// reales: se tocan y la app arma la oración, en vez de tipearla con el sol de frente.
const BLOQUES_TEXTO = {
    condicion: {
        label: 'Condición general', emoji: '🫧',
        chips: ['Humedad muy buena', 'Humedad buena', 'Humedad justa', 'Piso firme', 'Lote parejo', 'Buena cama de siembra']
    },
    desarrollo: {
        label: 'Estado del cultivo', emoji: '🌱',
        chips: ['Excelente desarrollo aéreo', 'Buen desarrollo radicular', 'Buena ramificación',
                'Nodulación muy buena', 'Sin nodulación significativa', 'Distribución de plantas muy buena']
    },
    sembradoras: {
        label: 'Funcionamiento de sembradoras', emoji: '⚙️',
        chips: ['Trabajando bien', 'Se tranca el ingreso de semilla al dosificador',
                'Paradas frecuentes para corregir', 'Carga con pinche del bigbag a la tolva']
    },
    semilla: {
        label: 'Detalle del envío', emoji: '🚛',
        chips: ['Inoculado en planta', 'Inoculado a campo', 'Semilla curada', 'Entregado en bigbag']
    },
    plagas: {
        label: 'Plagas y enfermedades', emoji: '🐛', listado: true,
        chips: ['Sin plagas de importancia económica', 'Sin enfermedades', 'Orugas cortadoras',
                'Isoca bolillera', 'Isoca medidora', 'Chinches', 'Defoliación leve',
                'Fusarium', 'Alternaria', 'Rizoctonia']
    },
    malezas: {
        label: 'Malezas', emoji: '🌿', listado: true,
        chips: ['Lote limpio', 'Parietaria', 'Peludilla', 'Malva', 'Girasol guacho', 'Soja guacha',
                'Rama negra', 'Yuyo colorado', 'Sorgo de Alepo', 'Chloris']
    },
    observaciones: { label: 'Observaciones', emoji: '📝', chips: [] },
    acciones: {
        label: 'Acciones y seguimiento', emoji: '🔎',
        chips: ['Aplicar posterior a la siembra', 'Continuar monitoreando', 'Nueva evaluación esta semana',
                'Evaluar carpida manual en sectores', 'Sin acciones pendientes']
    }
};

const CLAVE_CONTRATOS_PROD = 'braun_contratos_prod';

// ---------------------------------------------------------------------------
// 2. ESTADO DEL SUBMÓDULO
// ---------------------------------------------------------------------------
let informeActual = null;        // el informe en edición (con .Lotes y .Textos)
let mediaActual = [];            // media del informe abierto: metadatos + objectURL (el Blob queda en IndexedDB)
let informesRemotos = [];        // lo que devolvió el backend
let informesRenderizados = [];   // la lista filtrada que se está viendo
let tipoInformeSel = 'siembra';  // tipo elegido en el formulario de arranque

const escInf = (typeof escapeHtml === 'function')
    ? escapeHtml
    : (s => (s === undefined || s === null) ? '' : String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

function tipoInforme(id) {
    return TIPOS_INFORME.find(t => t.id === id) || TIPOS_INFORME[2];
}

// Número al estilo argentino (coma decimal), sin ceros al pedo: 14,3 y no 14,30.
function numAR(v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function fechaCortaAR(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    return `${p[2]}/${p[1]}/${p[0]}`;
}

// ---------------------------------------------------------------------------
// 3. CONTRATOS (catálogo local)
// ---------------------------------------------------------------------------
// Viven en localStorage, como el resto de los catálogos de la app: son pocos,
// los edita una sola persona y así el agrónomo los tiene aunque salga sin señal.
// Cuando haya más de un cargador, pasan al Sheet.
function obtenerContratosProd() {
    try {
        const g = JSON.parse(localStorage.getItem(CLAVE_CONTRATOS_PROD) || '[]');
        return Array.isArray(g) ? g : [];
    } catch (e) { return []; }
}

function guardarContratosProd(lista) {
    localStorage.setItem(CLAVE_CONTRATOS_PROD, JSON.stringify(lista));
}

function abrirGestorContratos() {
    renderGestorContratos();
    document.getElementById('modal-gestor-contratos').classList.add('active');
}

function cerrarGestorContratos() {
    document.getElementById('modal-gestor-contratos').classList.remove('active');
    poblarSelectContratos();
}

function renderGestorContratos() {
    const ul = document.getElementById('gestor-lista-contratos');
    if (!ul) return;
    const lista = obtenerContratosProd();
    if (lista.length === 0) {
        ul.innerHTML = '<li class="lista-vacia">Todavía no hay contratos. Cargá el primero abajo.</li>';
        return;
    }
    ul.innerHTML = lista.map((c, i) => `
        <li>
            <span>
                <b>${escInf(c.Codigo)}</b> — ${escInf(c.Descripcion || '')}
                <small style="display:block;color:#888">${escInf(c.Campania || '')} · ${(c.Lotes || []).length} lote(s)</small>
            </span>
            <button type="button" class="gestor-btn-quitar" onclick="eliminarContratoProd(${i})" title="Eliminar"><i class="fas fa-trash"></i></button>
        </li>`).join('');
}

function guardarContratoProd() {
    const codigo = document.getElementById('gc-codigo').value.trim();
    if (!codigo) { alert('Poné al menos el código del contrato.'); return; }

    // "Don Manuel/9F, Ronchi/L1" → [{Campo:'Don Manuel', Lote:'9F'}, ...]
    const lotes = document.getElementById('gc-lotes').value.split(',')
        .map(s => s.trim()).filter(Boolean)
        .map(s => {
            const partes = s.split('/');
            return partes.length > 1
                ? { Campo: partes[0].trim(), Lote: partes.slice(1).join('/').trim() }
                : { Campo: '', Lote: partes[0].trim() };
        });

    const lista = obtenerContratosProd();
    const nuevo = {
        Id_Contrato: 'CT-' + Date.now(),
        Codigo: codigo,
        Descripcion: document.getElementById('gc-descripcion').value.trim(),
        Campania: document.getElementById('gc-campania').value.trim(),
        Cultivo: document.getElementById('gc-cultivo').value.trim(),
        Lotes: lotes
    };

    // Mismo código = se reemplaza, no se duplica.
    const idx = lista.findIndex(c => (c.Codigo || '').toLowerCase() === codigo.toLowerCase());
    if (idx !== -1) nuevo.Id_Contrato = lista[idx].Id_Contrato;
    if (idx !== -1) lista[idx] = nuevo; else lista.push(nuevo);

    guardarContratosProd(lista);
    ['gc-codigo', 'gc-descripcion', 'gc-campania', 'gc-cultivo', 'gc-lotes']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderGestorContratos();
    poblarSelectContratos();
}

function eliminarContratoProd(i) {
    const lista = obtenerContratosProd();
    if (!lista[i]) return;
    if (!confirm(`¿Eliminar el contrato ${lista[i].Codigo}?\n\nLos informes ya cargados no se borran.`)) return;
    lista.splice(i, 1);
    guardarContratosProd(lista);
    renderGestorContratos();
    poblarSelectContratos();
}

function poblarSelectContratos() {
    const lista = obtenerContratosProd();
    const sel = document.getElementById('inf-contrato');
    if (sel) {
        const previo = sel.value;
        sel.innerHTML = lista.length
            ? lista.map(c => `<option value="${escInf(c.Id_Contrato)}">${escInf(c.Codigo)}${c.Descripcion ? ' — ' + escInf(c.Descripcion) : ''}</option>`).join('')
            : '<option value="">— Cargá un contrato con el engranaje —</option>';
        if (previo) sel.value = previo;
    }
    const filtro = document.getElementById('filter-inf-contrato');
    if (filtro) {
        const previo = filtro.value;
        filtro.innerHTML = '<option value="">Todos</option>' +
            lista.map(c => `<option value="${escInf(c.Codigo)}">${escInf(c.Codigo)}</option>`).join('');
        filtro.value = previo || '';
    }
}

// ---------------------------------------------------------------------------
// 4. APERTURA DEL SUBMÓDULO
// ---------------------------------------------------------------------------
function abrirInformesCampo() {
    poblarSelectContratos();
    poblarFiltroTipos();
    renderChipsTipoInforme();
    resetFormInforme();
    switchTabInformes('lista');
    cambiarVista('view-informes-campo');
    pedirAlmacenamientoPersistente();
    mostrarEspacioDisponible();
    if (navigator.onLine) cargarInformesDesdeGoogle();
    renderListaInformes();
}

function switchTabInformes(tab) {
    const lista = document.getElementById('tab-content-lista-inf');
    const nuevo = document.getElementById('tab-content-nuevo-inf');
    if (!lista || !nuevo) return;
    if (tab === 'nuevo') {
        lista.classList.add('hidden');
        nuevo.classList.remove('hidden');
        resetFormInforme();
    } else {
        nuevo.classList.add('hidden');
        lista.classList.remove('hidden');
        renderListaInformes();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function poblarFiltroTipos() {
    const sel = document.getElementById('filter-inf-tipo');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos</option>' +
        TIPOS_INFORME.map(t => `<option value="${t.id}">${t.emoji} ${escInf(t.label)}</option>`).join('');
}

function renderChipsTipoInforme() {
    const cont = document.getElementById('inf-chips-tipo');
    if (!cont) return;
    cont.innerHTML = TIPOS_INFORME.map(t => `
        <button type="button" class="chip-tipo ${t.id === tipoInformeSel ? 'activo' : ''}"
                onclick="seleccionarTipoInforme('${t.id}')">${t.emoji} ${escInf(t.label)}</button>`).join('');
}

function seleccionarTipoInforme(id) {
    tipoInformeSel = id;
    renderChipsTipoInforme();
}

function resetFormInforme() {
    const f = document.getElementById('form-informe');
    if (f) f.reset();
    const fecha = document.getElementById('inf-fecha');
    if (fecha) fecha.valueAsDate = new Date();
    const resp = document.getElementById('inf-responsable');
    poblarSelect(resp, 'personal', '');
    const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
    if (sesion && resp) {
        const opt = Array.from(resp.options)
            .find(o => (o.value || '').trim().toLowerCase() === (sesion.nombre || '').trim().toLowerCase());
        if (opt) resp.value = opt.value;
    }
    poblarSelectContratos();
    renderChipsTipoInforme();
}

// ---------------------------------------------------------------------------
// 5. ESPACIO EN EL DISPOSITIVO
// ---------------------------------------------------------------------------
// Un agrónomo que sale a recorrer con el celular lleno tiene que enterarse ANTES
// de salir, no al volver con 40 fotos que no se pudieron guardar.
function pedirAlmacenamientoPersistente() {
    // Sin esto, lo que guarda la app es "best effort": el sistema lo puede
    // borrar bajo presión de espacio. En iPhone, además, Safari purga a los 7
    // días si la app NO está instalada en la pantalla de inicio.
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(ya => {
            if (!ya) navigator.storage.persist().catch(() => { });
        }).catch(() => { });
    }
}

function mostrarEspacioDisponible() {
    const box = document.getElementById('inf-storage-box');
    if (!box || !navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(est => {
        const usado = est.usage || 0;
        const total = est.quota || 0;
        if (!total) return;
        const pct = Math.min(100, Math.round(usado / total * 100));
        const gb = b => (b / 1073741824).toFixed(b > 1073741824 ? 1 : 2) + ' GB';
        document.getElementById('inf-storage-detalle').textContent =
            `${gb(usado)} usados · ${gb(total - usado)} libres en este dispositivo`;
        const relleno = document.getElementById('inf-storage-relleno');
        relleno.style.width = pct + '%';
        box.classList.remove('hidden', 'inf-storage-alerta');
        if (pct >= 80) {
            box.classList.add('inf-storage-alerta');
            document.getElementById('inf-storage-detalle').textContent =
                `⚠️ Queda poco espacio: ${gb(total - usado)} libres. Sincronizá antes de salir al campo.`;
        }
    }).catch(() => { });
}

// ---------------------------------------------------------------------------
// 6. CREAR EL INFORME
// ---------------------------------------------------------------------------
const _formInforme = document.getElementById('form-informe');
if (_formInforme) _formInforme.addEventListener('submit', function (e) {
    e.preventDefault();
    const contratos = obtenerContratosProd();
    const contrato = contratos.find(c => c.Id_Contrato === document.getElementById('inf-contrato').value);
    if (!contrato) { alert('Elegí un contrato. Si no hay ninguno, cargalo con el engranaje.'); return; }

    informeActual = {
        Id_Informe: 'IC-' + Date.now(),
        Id_Contrato: contrato.Id_Contrato,
        Codigo: contrato.Codigo,
        Descripcion: contrato.Descripcion || '',
        Campania: contrato.Campania || '',
        Cultivo: contrato.Cultivo || '',
        Fecha: document.getElementById('inf-fecha').value,
        Tipo: tipoInformeSel,
        Responsable: document.getElementById('inf-responsable').value,
        Matricula: document.getElementById('inf-matricula').value.trim(),
        Variedad: document.getElementById('inf-variedad').value.trim(),
        Lotes: [],
        Textos: {},
        Estado: 'Borrador',
        usuario_registro: (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : ''
    };
    mediaActual = [];

    guardarInformeLocal(function () {
        renderInformeActivo();
        cambiarVista('view-informe-activo');
    });
});

// ---------------------------------------------------------------------------
// 7. VISTA DEL INFORME ABIERTO
// ---------------------------------------------------------------------------
function renderInformeActivo() {
    const inf = informeActual;
    if (!inf) return;
    const t = tipoInforme(inf.Tipo);

    document.getElementById('ia-titulo').textContent = `${t.emoji} ${t.label}`;
    document.getElementById('ia-subtitulo').textContent =
        `${inf.Codigo || ''} · ${fechaCortaAR(inf.Fecha)}${inf.Campania ? ' · ' + inf.Campania : ''}`;

    renderLotesInforme();
    renderBloquesTexto();
    renderMediaInforme();
}

// --- 7.1 Mediciones por lote ---
function renderLotesInforme() {
    const inf = informeActual;
    const t = tipoInforme(inf.Tipo);
    const cont = document.getElementById('ia-lotes');
    document.getElementById('ia-contador-lotes').textContent = (inf.Lotes || []).length;

    if (!inf.Lotes || inf.Lotes.length === 0) {
        cont.innerHTML = '<p class="lista-vacia">Sin lotes todavía. Tocá <b>“+ Lote”</b>.</p>';
        return;
    }

    const contrato = obtenerContratosProd().find(c => c.Id_Contrato === inf.Id_Contrato);
    const lotesCatalogo = (contrato && contrato.Lotes) || [];

    cont.innerHTML = inf.Lotes.map((l, i) => {
        const opcionesLote = lotesCatalogo.map(x => {
            const valor = (x.Campo ? x.Campo + ' / ' : '') + x.Lote;
            return `<option value="${escInf(valor)}" ${valor === l.Lote ? 'selected' : ''}>${escInf(valor)}</option>`;
        }).join('');

        const campos = t.camposLote.map(k => {
            const def = CAMPOS_LOTE[k];
            if (!def) return '';
            const val = l[k] === undefined ? '' : l[k];
            if (def.tipo === 'select') {
                return `<div class="form-group">
                    <label>${escInf(def.label)}</label>
                    <select onchange="setCampoLote(${i},'${k}',this.value)">
                        <option value="">—</option>
                        ${def.opciones.map(o => `<option ${o === val ? 'selected' : ''}>${escInf(o)}</option>`).join('')}
                    </select></div>`;
            }
            if (def.tipo === 'num') {
                return `<div class="form-group">
                    <label>${escInf(def.label)}${def.unidad ? ' (' + def.unidad + ')' : ''}</label>
                    <input type="text" inputmode="decimal" value="${escInf(val)}"
                           onchange="setCampoLote(${i},'${k}',this.value)" placeholder="0"></div>`;
            }
            return `<div class="form-group">
                <label>${escInf(def.label)}</label>
                <input type="text" value="${escInf(val)}" placeholder="${escInf(def.placeholder || '')}"
                       onchange="setCampoLote(${i},'${k}',this.value)"></div>`;
        }).join('');

        return `<div class="inf-lote-card">
            <div class="inf-lote-head">
                <select class="inf-lote-select" onchange="setCampoLote(${i},'Lote',this.value)">
                    <option value="">— Elegí el lote —</option>
                    ${opcionesLote}
                    ${l.Lote && !lotesCatalogo.some(x => ((x.Campo ? x.Campo + ' / ' : '') + x.Lote) === l.Lote)
                        ? `<option value="${escInf(l.Lote)}" selected>${escInf(l.Lote)}</option>` : ''}
                </select>
                <button type="button" class="btn-inf-borrar" onclick="eliminarLoteInforme(${i})" title="Quitar lote">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="inf-lote-campos">${campos}</div>
        </div>`;
    }).join('');
}

function agregarLoteInforme() {
    if (!informeActual) return;
    informeActual.Lotes = informeActual.Lotes || [];
    informeActual.Lotes.push({ Lote: '' });
    guardarInformeLocal(renderLotesInforme);
}

function eliminarLoteInforme(i) {
    if (!informeActual) return;
    informeActual.Lotes.splice(i, 1);
    guardarInformeLocal(renderLotesInforme);
}

function setCampoLote(i, campo, valor) {
    if (!informeActual || !informeActual.Lotes[i]) return;
    informeActual.Lotes[i][campo] = valor;
    // Sin re-render: el usuario puede estar tipeando en el campo de al lado.
    guardarInformeLocal();
}

// --- 7.2 Bloques narrados ---
function renderBloquesTexto() {
    const inf = informeActual;
    const t = tipoInforme(inf.Tipo);
    const cont = document.getElementById('ia-bloques-texto');
    inf.Textos = inf.Textos || {};

    const hayVoz = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    cont.innerHTML = t.bloques.map(k => {
        const def = BLOQUES_TEXTO[k];
        if (!def) return '';
        const estado = inf.Textos[k] || { chips: [], texto: '' };
        const chips = def.chips.map(c => `
            <button type="button" class="chip-frase ${estado.chips.includes(c) ? 'activo' : ''}"
                    onclick="toggleChipBloque('${k}', this.dataset.frase)" data-frase="${escInf(c)}">${escInf(c)}</button>`).join('');

        return `<div class="inf-bloque">
            <div class="inf-bloque-header">
                <h3>${def.emoji} ${escInf(def.label)}</h3>
                ${hayVoz ? `<button type="button" class="btn-inf-voz" onclick="dictarBloque('${k}', this)" title="Dictar">
                    <i class="fas fa-microphone"></i></button>` : ''}
            </div>
            ${chips ? `<div class="chips-frases">${chips}</div>` : ''}
            <textarea id="txt-bloque-${k}" class="inf-textarea" rows="2"
                      placeholder="Agregá lo que no esté en los botones…"
                      onchange="setTextoBloque('${k}', this.value)">${escInf(estado.texto)}</textarea>
        </div>`;
    }).join('');
}

function toggleChipBloque(k, frase) {
    if (!informeActual) return;
    informeActual.Textos = informeActual.Textos || {};
    const estado = informeActual.Textos[k] || { chips: [], texto: '' };
    const i = estado.chips.indexOf(frase);
    if (i === -1) estado.chips.push(frase); else estado.chips.splice(i, 1);
    informeActual.Textos[k] = estado;
    guardarInformeLocal(renderBloquesTexto);
}

function setTextoBloque(k, valor) {
    if (!informeActual) return;
    informeActual.Textos = informeActual.Textos || {};
    const estado = informeActual.Textos[k] || { chips: [], texto: '' };
    estado.texto = valor;
    informeActual.Textos[k] = estado;
    guardarInformeLocal();
}

// Dictado por voz. Necesita señal (el reconocimiento corre en el servidor del
// navegador), así que es un extra: sin internet los chips y el teclado siguen.
function dictarBloque(k, boton) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = 'es-AR';
    rec.interimResults = false;
    rec.continuous = false;
    boton.classList.add('grabando');
    rec.onresult = function (ev) {
        const texto = ev.results[0][0].transcript;
        const ta = document.getElementById('txt-bloque-' + k);
        const nuevo = (ta.value ? ta.value.trim() + ' ' : '') + texto;
        ta.value = nuevo;
        setTextoBloque(k, nuevo);
    };
    rec.onerror = function () { alert('No se pudo escuchar. Probá de nuevo o escribilo.'); };
    rec.onend = function () { boton.classList.remove('grabando'); };
    rec.start();
}

// ---------------------------------------------------------------------------
// 8. MEDIA (foto / video / audio)
// ---------------------------------------------------------------------------
// Las fotos se comprimen a 1280 px y se les estampa la etiqueta del lote, que
// es lo que hoy hacen a mano con otra app. Los videos y audios se guardan tal
// cual: recomprimir video en el navegador es lento y de calidad dudosa, y el
// archivo se va a WhatsApp desde acá igual.
function agregarMediaInforme(input) {
    if (!informeActual || !input.files || !input.files.length) return;
    const archivos = Array.from(input.files);
    input.value = ''; // permite volver a elegir el mismo archivo

    const etiqueta = etiquetaSugerida();
    let pendientes = archivos.length;

    archivos.forEach(file => {
        const esImagen = file.type.indexOf('image/') === 0;
        const seguir = blob => {
            guardarMediaEnDB({
                Id_Informe: informeActual.Id_Informe,
                Tipo: esImagen ? 'foto' : (file.type.indexOf('video/') === 0 ? 'video' : 'audio'),
                Nombre: file.name || ('archivo.' + (file.type.split('/')[1] || 'bin')),
                MimeType: blob.type || file.type,
                Etiqueta: etiqueta,
                Lote: (informeActual.Lotes && informeActual.Lotes.length === 1) ? informeActual.Lotes[0].Lote : '',
                Tamanio: blob.size,
                Blob: blob,
                Estado_Subida: 'solo_local'
            }, () => {
                if (--pendientes === 0) cargarMediaDelInforme(renderMediaInforme);
            });
        };
        if (esImagen) comprimirYEtiquetar(file, etiqueta, seguir);
        else seguir(file);
    });
}

// La etiqueta que se estampa en la foto: "Don Manuel / 9F · 14,3 sem/m".
// Es exactamente el rótulo que hoy ponen a mano en las fotos del grupo.
function etiquetaSugerida() {
    const inf = informeActual;
    if (!inf) return '';
    const l = (inf.Lotes || [])[0];
    if (!l || !l.Lote) return inf.Codigo || '';
    const t = tipoInforme(inf.Tipo);
    const claveNum = t.camposLote.find(k => CAMPOS_LOTE[k] && CAMPOS_LOTE[k].tipo === 'num');
    const dato = claveNum && l[claveNum]
        ? ` · ${numAR(parseNumeroAR(l[claveNum]))} ${claveNum === 'sem_m' ? 'sem/m' : (claveNum === 'plantas_m' ? 'pl/m' : (CAMPOS_LOTE[claveNum].unidad || ''))}`
        : '';
    return `${l.Lote}${dato}`;
}

function comprimirYEtiquetar(file, etiqueta, cb) {
    const reader = new FileReader();
    reader.onload = function (ev) {
        const img = new Image();
        img.onload = function () {
            const maxW = 1280;
            const escala = Math.min(1, maxW / img.width);
            const w = Math.round(img.width * escala);
            const h = Math.round(img.height * escala);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            if (etiqueta) {
                const fs = Math.max(14, Math.round(h * 0.035));
                ctx.font = `700 ${fs}px Arial, sans-serif`;
                const texto = etiqueta;
                const ancho = ctx.measureText(texto).width + fs;
                const alto = fs * 1.9;
                const x = w - ancho - fs * 0.6;
                const y = h - alto - fs * 0.6;
                ctx.fillStyle = 'rgba(255,255,255,0.92)';
                ctx.fillRect(x, y, ancho, alto);
                ctx.fillStyle = '#1a1a1a';
                ctx.textBaseline = 'middle';
                ctx.fillText(texto, x + fs * 0.5, y + alto / 2);
            }

            canvas.toBlob(b => cb(b || file), 'image/jpeg', 0.72);
        };
        img.onerror = function () { cb(file); }; // si no se puede procesar, va el original
        img.src = ev.target.result;
    };
    reader.onerror = function () { cb(file); };
    reader.readAsDataURL(file);
}

function guardarMediaEnDB(registro, cb) {
    if (!db || !db.objectStoreNames.contains('informes_media')) { if (cb) cb(); return; }
    const tx = db.transaction(['informes_media'], 'readwrite');
    const req = tx.objectStore('informes_media').add(registro);
    req.onsuccess = function () { if (cb) cb(); };
    req.onerror = function (ev) {
        console.error('[informes] No se pudo guardar la media:', ev.target.error);
        alert('⚠️ No se pudo guardar el archivo en este celular.\n\nPuede que no quede espacio. Fijate la barra de arriba.');
        if (cb) cb();
    };
}

function cargarMediaDelInforme(cb) {
    mediaActual.forEach(m => { if (m.url) URL.revokeObjectURL(m.url); });
    mediaActual = [];
    if (!db || !informeActual || !db.objectStoreNames.contains('informes_media')) { if (cb) cb(); return; }
    const tx = db.transaction(['informes_media'], 'readonly');
    const idx = tx.objectStore('informes_media').index('por_informe');
    idx.getAll(informeActual.Id_Informe).onsuccess = function (e) {
        mediaActual = (e.target.result || []).map(m => {
            // objectURL solo para mostrar: el Blob sigue viviendo en IndexedDB,
            // no se duplica en memoria.
            const copia = Object.assign({}, m);
            copia.url = m.Blob ? URL.createObjectURL(m.Blob) : '';
            return copia;
        });
        if (cb) cb();
    };
}

function renderMediaInforme() {
    const cont = document.getElementById('ia-media');
    if (!cont) return;
    document.getElementById('ia-contador-media').textContent = mediaActual.length;

    if (mediaActual.length === 0) {
        cont.innerHTML = '<p class="lista-vacia">Sin fotos ni videos todavía.</p>';
        return;
    }

    const kb = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

    cont.innerHTML = mediaActual.map((m, i) => {
        const vista = m.Tipo === 'foto'
            ? `<img src="${m.url}" alt="${escInf(m.Etiqueta)}">`
            : (m.Tipo === 'video'
                ? `<video src="${m.url}" controls preload="metadata"></video>`
                : `<div class="inf-media-audio"><i class="fas fa-microphone-lines"></i><audio src="${m.url}" controls></audio></div>`);
        return `<div class="inf-media-item">
            ${vista}
            <div class="inf-media-pie">
                <span>${escInf(m.Etiqueta || m.Nombre)} · ${kb(m.Tamanio || 0)}</span>
                <button type="button" class="btn-inf-borrar" onclick="eliminarMediaInforme(${m.id})" title="Quitar"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}

function eliminarMediaInforme(id) {
    if (!db) return;
    if (!confirm('¿Quitar este archivo del informe?')) return;
    const tx = db.transaction(['informes_media'], 'readwrite');
    tx.objectStore('informes_media').delete(id).onsuccess = function () {
        cargarMediaDelInforme(renderMediaInforme);
        mostrarEspacioDisponible();
    };
}

// ---------------------------------------------------------------------------
// 9. EL MENSAJE DE WHATSAPP  ← el producto final del submódulo
// ---------------------------------------------------------------------------
function generarMensajeInforme(inf) {
    const t = tipoInforme(inf.Tipo);
    const L = [];

    // Encabezado: igual al que ya usan en el grupo.
    L.push(`👇🏻 CTTO ${inf.Codigo}${inf.Descripcion ? ' — ' + inf.Descripcion.toUpperCase() : ''}`);
    L.push('');
    L.push(`${t.emoji} ${t.titulo}${inf.Cultivo ? ' — ' + inf.Cultivo : ''}`);
    L.push('');
    L.push(`📅 ${fechaCortaAR(inf.Fecha)}`);
    if (inf.Variedad) { L.push(''); L.push(`🌱 Variedad: ${inf.Variedad}`); }

    // Mediciones por lote
    (inf.Lotes || []).filter(l => l.Lote).forEach(l => {
        const campos = t.camposLote.filter(k => l[k] !== undefined && String(l[k]).trim() !== '');
        if (campos.length === 0) { L.push(''); L.push(`🔹 ${l.Lote}`); return; }

        const principal = campos[0];
        const defP = CAMPOS_LOTE[principal];
        const valP = defP.tipo === 'num' ? numAR(parseNumeroAR(l[principal])) : l[principal];
        L.push('');
        L.push(`🔹 ${l.Lote} • ${defP.etiquetaMsg || defP.label}: ${conUnidad(valP, defP.unidad)}`);

        campos.slice(1).forEach(k => {
            const def = CAMPOS_LOTE[k];
            const val = def.tipo === 'num' ? numAR(parseNumeroAR(l[k])) : l[k];
            const etiqueta = def.etiquetaMsg || def.label;
            L.push(etiqueta ? `* ${etiqueta}: ${conUnidad(val, def.unidad)}` : `* ${val}`);
        });
    });

    // Bloques narrados: los chips elegidos + lo que se escribió a mano.
    t.bloques.forEach(k => {
        const def = BLOQUES_TEXTO[k];
        const estado = (inf.Textos || {})[k];
        if (!estado) return;
        const partes = [];
        if (estado.chips && estado.chips.length) partes.push(unirFrases(estado.chips, def.listado));
        if (estado.texto && estado.texto.trim()) partes.push(estado.texto.trim());
        if (partes.length === 0) return;
        L.push('');
        L.push(`${def.emoji} ${def.label}: ${partes.join(' ')}`);
    });

    if (inf.Responsable) {
        L.push('');
        L.push(`👤 ${inf.Responsable}${inf.Matricula ? ' — Mat. ' + inf.Matricula : ''}`);
    }

    return L.join('\n');
}

// Los bloques de enumeración (malezas, plagas) se leen como lista —
// "parietaria, peludilla, malva y girasol guacho" — igual que los escriben hoy.
// Los demás son afirmaciones sueltas y van separadas por punto.
// "6 cm" lleva espacio; "3%" no. Detalle chico que se nota en el mensaje.
function conUnidad(valor, unidad) {
    if (!unidad) return String(valor);
    return unidad === '%' ? valor + '%' : valor + ' ' + unidad;
}

function unirFrases(chips, esListado) {
    if (!chips.length) return '';
    if (!esListado) return chips.join('. ') + '.';
    const items = chips.map((c, i) => i === 0 ? c : c.charAt(0).toLowerCase() + c.slice(1));
    if (items.length === 1) return items[0] + '.';
    return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1] + '.';
}

function armarMensajeInforme() {
    if (!informeActual) return;
    document.getElementById('inf-mensaje-texto').value = generarMensajeInforme(informeActual);
    document.getElementById('modal-mensaje-informe').classList.add('active');
}

function cerrarMensajeInforme() {
    document.getElementById('modal-mensaje-informe').classList.remove('active');
}

function copiarMensajeInforme() {
    const ta = document.getElementById('inf-mensaje-texto');
    const texto = ta.value;
    const exito = () => alert('✅ Mensaje copiado. Pegalo en el grupo.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(exito).catch(() => { ta.select(); document.execCommand('copy'); exito(); });
    } else {
        ta.select(); document.execCommand('copy'); exito();
    }
}

// Compartir: el texto + los archivos, en una sola hoja de compartir del celular.
// Si el navegador no sabe compartir archivos, va el texto solo y se avisa.
async function compartirInforme() {
    const texto = document.getElementById('inf-mensaje-texto').value;
    const archivos = mediaActual
        .filter(m => m.Blob)
        .map(m => new File([m.Blob], nombreArchivoMedia(m), { type: m.MimeType || m.Blob.type }));

    try {
        if (archivos.length && navigator.canShare && navigator.canShare({ files: archivos })) {
            await navigator.share({ text: texto, files: archivos });
            return;
        }
        if (navigator.share) {
            await navigator.share({ text: texto });
            if (archivos.length) alert('Se compartió el texto. Este navegador no puede mandar los archivos juntos: adjuntalos a mano desde la galería.');
            return;
        }
        copiarMensajeInforme();
    } catch (err) {
        if (err && err.name === 'AbortError') return; // el usuario canceló: no es un error
        console.error('[informes] No se pudo compartir:', err);
        copiarMensajeInforme();
    }
}

function nombreArchivoMedia(m) {
    const ext = (m.MimeType || '').split('/')[1] || 'jpg';
    const base = (m.Etiqueta || m.Nombre || 'archivo').replace(/[^\w\-]+/g, '_').slice(0, 40);
    return `${base}_${m.id}.${ext}`;
}

// ---------------------------------------------------------------------------
// 10. PERSISTENCIA LOCAL Y SINCRONIZACIÓN
// ---------------------------------------------------------------------------
// Guardar en el dispositivo es instantáneo y va en CADA cambio: nunca hay un
// "guardar" que se pueda olvidar. Subir al servidor, en cambio, va con retraso.
//
// Por qué el retraso: cargar un informe son decenas de cambios (cada número de
// cada lote, cada chip). Un POST por cambio serían decenas de ejecuciones de
// Apps Script para un informe, y la cuota de runtime es de 6 h por DÍA para
// toda la app — correos y guardado de cargas incluidos. Con 4 segundos de
// espera, una carga entera termina siendo un par de subidas.
let _timerSyncInformes = null;
function agendarSyncInformes() {
    if (!navigator.onLine) return;
    clearTimeout(_timerSyncInformes);
    _timerSyncInformes = setTimeout(sincronizarInformesPendientes, 4000);
}

function guardarInformeLocal(cb) {
    if (!db || !informeActual || !db.objectStoreNames.contains('informes_campo')) { if (cb) cb(); return; }
    informeActual._synced = false;
    const tx = db.transaction(['informes_campo'], 'readwrite');
    const store = tx.objectStore('informes_campo');
    const req = (informeActual.id !== undefined) ? store.put(informeActual) : store.add(informeActual);
    req.onsuccess = function (e) {
        if (informeActual.id === undefined) informeActual.id = e.target.result;
        agendarSyncInformes();
        if (cb) cb();
    };
    req.onerror = function (ev) {
        console.error('[informes] No se pudo guardar el informe:', ev.target.error);
        if (cb) cb();
    };
}

function obtenerInformesLocales() {
    return new Promise(resolve => {
        if (!db || !db.objectStoreNames.contains('informes_campo')) { resolve([]); return; }
        try {
            const tx = db.transaction(['informes_campo'], 'readonly');
            const req = tx.objectStore('informes_campo').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}

// Sube SOLO el texto del informe (2 KB). La media se queda en el dispositivo
// hasta la Fase 3 (subida directa a Drive). Ver DOCUMENTACION_PRODUCCION_V2.md §6.
function sincronizarInformesPendientes() {
    if (!db || !navigator.onLine || typeof WEB_APP_URL === 'undefined' || WEB_APP_URL.includes('AQUÍ_VA')) return;
    if (!db.objectStoreNames.contains('informes_campo')) return;

    const tx = db.transaction(['informes_campo'], 'readonly');
    tx.objectStore('informes_campo').getAll().onsuccess = function (e) {
        (e.target.result || []).filter(x => x._synced === false).forEach(function (item) {
            const payload = Object.assign({ _accion: 'actualizar_informe' }, item);
            delete payload.id;
            delete payload._synced;
            // El backend guarda los bloques narrados ya resueltos a texto: el
            // Sheet es para leer, no para volver a armar la frase.
            payload.Textos_Plano = JSON.stringify(item.Textos || {});
            payload.Mensaje = generarMensajeInforme(item);

            enviarAlBackend(payload)
                .then(function () {
                    const up = db.transaction(['informes_campo'], 'readwrite');
                    const store = up.objectStore('informes_campo');
                    store.get(item.id).onsuccess = function (ev) {
                        const rec = ev.target.result;
                        if (!rec) return;
                        rec._synced = true;
                        store.put(rec);
                        if (informeActual && informeActual.id === item.id) informeActual._synced = true;
                    };
                })
                .catch(function (err) {
                    // Queda con _synced:false y se reintenta en la próxima pasada.
                    console.error('[informes] No se pudo sincronizar:', err);
                });
        });
    };
}

function cargarInformesDesdeGoogle() {
    if (!navigator.onLine || typeof WEB_APP_URL === 'undefined' || WEB_APP_URL.includes('AQUÍ_VA')) return;
    fetch(`${WEB_APP_URL}?action=read_informes`)
        .then(res => res.json())
        .then(data => {
            // Mismo cuidado que en Calidad y Producción: un filtro que da cero
            // puede ser "no hay informes" o "me mandaron otra cosa".
            const pareceInformes = Array.isArray(data) && (data.length === 0 || data.some(x => x && x.Id_Informe));
            if (pareceInformes) informesRemotos = data.filter(x => x && x.Id_Informe);
            else console.warn('[informes] El servidor devolvió algo que no son informes; se conserva lo que había.');
            const vista = document.getElementById('view-informes-campo');
            if (vista && !vista.classList.contains('hidden')) renderListaInformes();
        })
        .catch(err => console.error('[informes] Error cargando informes:', err));
}

// ---------------------------------------------------------------------------
// 11. LISTADO
// ---------------------------------------------------------------------------
async function renderListaInformes() {
    const cont = document.getElementById('lista-informes');
    if (!cont) return;

    const locales = await obtenerInformesLocales();
    // Local pisa a remoto: la copia del dispositivo es la de trabajo y puede
    // tener cambios que todavía no subieron.
    const porId = {};
    informesRemotos.forEach(r => { porId[r.Id_Informe] = r; });
    locales.forEach(l => { porId[l.Id_Informe] = l; });

    const fContrato = (document.getElementById('filter-inf-contrato') || {}).value || '';
    const fTipo = (document.getElementById('filter-inf-tipo') || {}).value || '';
    const fDesde = (document.getElementById('filter-inf-desde') || {}).value || '';
    const fHasta = (document.getElementById('filter-inf-hasta') || {}).value || '';

    informesRenderizados = Object.values(porId)
        .filter(x => !fContrato || x.Codigo === fContrato)
        .filter(x => !fTipo || x.Tipo === fTipo)
        .filter(x => !fDesde || (x.Fecha || '') >= fDesde)
        .filter(x => !fHasta || (x.Fecha || '') <= fHasta)
        .sort((a, b) => String(b.Fecha || '').localeCompare(String(a.Fecha || '')));

    if (informesRenderizados.length === 0) {
        cont.innerHTML = '<p class="lista-vacia">No hay informes con esos filtros.</p>';
        return;
    }

    cont.innerHTML = informesRenderizados.map((x, i) => {
        const t = tipoInforme(x.Tipo);
        const lotes = (x.Lotes || []).filter(l => l.Lote).map(l => l.Lote).join(' · ');
        const pendiente = x._synced === false;
        return `<div class="informe-card" onclick="abrirInformeDesdeLista(${i})">
            <div class="informe-card-top">
                <span class="informe-tipo">${t.emoji} ${escInf(t.label)}</span>
                <span class="informe-fecha">${fechaCortaAR(x.Fecha)}</span>
            </div>
            <div class="informe-card-body">
                <b>${escInf(x.Codigo || '')}</b>
                ${lotes ? `<span class="informe-lotes">${escInf(lotes)}</span>` : ''}
            </div>
            <div class="informe-card-pie">
                <span>${escInf(x.Responsable || '')}</span>
                ${pendiente ? '<span class="informe-badge-pendiente"><i class="fas fa-cloud-arrow-up"></i> Sin sincronizar</span>' : ''}
            </div>
        </div>`;
    }).join('');
}

function abrirInformeDesdeLista(i) {
    const x = informesRenderizados[i];
    if (!x) return;
    informeActual = JSON.parse(JSON.stringify(x));
    informeActual.Lotes = informeActual.Lotes || [];
    informeActual.Textos = informeActual.Textos || {};
    if (x.id !== undefined) informeActual.id = x.id;
    cargarMediaDelInforme(function () {
        renderInformeActivo();
        cambiarVista('view-informe-activo');
    });
}

// Borra el informe en los tres lados: el Sheet, el store local y su media.
// La media va primero: si se borrara el informe y fallara lo otro, quedarían
// gigabytes de video huérfanos en el celular sin ninguna pantalla que los muestre.
function eliminarInformeActual() {
    if (!informeActual) return;
    if (!confirm('¿Eliminar este informe?\n\nSe borran también las fotos y videos guardados en este celular. No se puede deshacer.')) return;

    const id = informeActual.Id_Informe;
    const idLocal = informeActual.id;

    if (db && db.objectStoreNames.contains('informes_media')) {
        const txM = db.transaction(['informes_media'], 'readwrite');
        const store = txM.objectStore('informes_media');
        store.index('por_informe').getAllKeys(id).onsuccess = function (e) {
            (e.target.result || []).forEach(k => store.delete(k));
        };
    }

    const seguir = function () {
        if (navigator.onLine && typeof enviarAlBackend === 'function') {
            enviarAlBackend({ _accion: 'eliminar_informe', Id_Informe: id })
                .catch(err => console.error('[informes] No se pudo borrar en el servidor:', err));
        }
        informesRemotos = informesRemotos.filter(x => x.Id_Informe !== id);
        informeActual = null;
        volverAListaInformes();
    };

    if (db && idLocal !== undefined && db.objectStoreNames.contains('informes_campo')) {
        const tx = db.transaction(['informes_campo'], 'readwrite');
        tx.objectStore('informes_campo').delete(idLocal).onsuccess = seguir;
    } else {
        seguir();
    }
}

function volverAListaInformes() {
    mediaActual.forEach(m => { if (m.url) URL.revokeObjectURL(m.url); });
    mediaActual = [];
    switchTabInformes('lista');
    cambiarVista('view-informes-campo');
    mostrarEspacioDisponible();
}

// Reintento cuando vuelve la señal, igual que el resto de la app.
window.addEventListener('online', function () {
    sincronizarInformesPendientes();
    cargarInformesDesdeGoogle();
});
