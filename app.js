// --- 1. CONFIGURACIÓN BASE DE DATOS LOCAL (IndexedDB) ---
let db;
const request = indexedDB.open("AppBraunDB_v4", 1);

request.onupgradeneeded = function(e) {
    db = e.target.result;
    if (!db.objectStoreNames.contains("controles_carga")) {
        db.createObjectStore("controles_carga", { keyPath: "id", autoIncrement: true });
    }
    // Crear store para la ticketera si no existe
    if (!db.objectStoreNames.contains("ticketera_tickets")) {
        db.createObjectStore("ticketera_tickets", { keyPath: "id", autoIncrement: true });
    }
};

request.onsuccess = function(e) { 
    db = e.target.result; 
    renderOfflineCount(); 
    cargarHistorialDesdeGoogle();
};
request.onerror = function(e) { console.error("Error IndexedDB", e); };

// --- CONFIGURACIÓN DE CONEXIÓN Y VARIABLES GLOBALES ---
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxER7E6CJhddVOrP7gaTDSM1albRvEAGUHnWcdBM7SoXzDJeklCvZDY_Aj0Cd1Xv6znyA/exec";
let historialGeneral = []; 
let tipoCargaActual = "PT"; 
let vistaHistorialNavegacion = []; 
let idRegistroEnEdicion = null; // Id_Carga del registro que se está editando (null = registro nuevo)

// --- 1-B. ENUMS EDITABLES (Producto, Calibre, Tipo, Envase, Elaboró, Destino) ---
const ENUM_STORAGE_KEY = "braun_enums_v1";
const ENUMS_DEFAULT = {
    producto: ["Garbanzo", "Lenteja", "Poroto Mung", "Poroto DRK", "Descarte Garbanzo", "Descarte Poroto Mung"],
    calibre: ["9mm", "8mm", "7mm", "3.5mm", "3.25mm", "3mm", "split"],
    tipoCarga: ["MP", "PT"],
    envase: ["Bolsas", "Big Bag", "Granel", "Silo Bolsa"],
    elaboro: ["Lucas Ramis", "Jonathan Rui", "Alejo Chamorro"],
    destino: ["CAP. CORTES"],
    responsables: ["Soporte", "Operaciones", "Administración"],
    personal: ["Santiago Torres", "Melisa Braun", "Jonathan Rui", "Lucas Ramis", "Carla Candoni", "Alejo Chamorro"]
};

function cargarEnums() {
    try {
        const guardado = JSON.parse(localStorage.getItem(ENUM_STORAGE_KEY) || "{}");
        const resultado = {};
        Object.keys(ENUMS_DEFAULT).forEach(key => {
            resultado[key] = (Array.isArray(guardado[key]) && guardado[key].length > 0)
                ? guardado[key]
                : ENUMS_DEFAULT[key].slice();
        });
        return resultado;
    } catch (e) {
        const copia = {};
        Object.keys(ENUMS_DEFAULT).forEach(k => copia[k] = ENUMS_DEFAULT[k].slice());
        return copia;
    }
}

let ENUMS = cargarEnums();

function guardarEnums() {
    localStorage.setItem(ENUM_STORAGE_KEY, JSON.stringify(ENUMS));
}

function poblarSelect(select, enumKey, valorSeleccionado) {
    if (!select || !ENUMS[enumKey]) return;
    select.innerHTML = "";
    const opciones = ENUMS[enumKey].slice();
    // Si el valor guardado no está en la lista (viene de un registro viejo o de Sheets), lo agregamos igual para no perderlo
    if (valorSeleccionado && !opciones.includes(valorSeleccionado)) {
        opciones.push(valorSeleccionado);
    }
    opciones.forEach(op => {
        const opt = document.createElement('option');
        opt.value = op;
        opt.textContent = op;
        if (op === valorSeleccionado) opt.selected = true;
        select.appendChild(opt);
    });
}

function agregarOpcionEnum(select, enumKey) {
    const nueva = prompt("Escribí la nueva opción a agregar:");
    if (!nueva || !nueva.trim()) return;
    const valor = nueva.trim();
    if (!ENUMS[enumKey].includes(valor)) {
        ENUMS[enumKey].push(valor);
        guardarEnums();
    }
    poblarSelect(select, enumKey, valor);
}

function quitarOpcionEnum(select, enumKey) {
    const actual = select.value;
    if (!actual) return;
    const confirmado = confirm(`¿Quitar "${actual}" de la lista de opciones?\n(esto no borra los registros ya guardados que usan ese valor)`);
    if (!confirmado) return;
    ENUMS[enumKey] = ENUMS[enumKey].filter(v => v !== actual);
    guardarEnums();
    poblarSelect(select, enumKey, ENUMS[enumKey][0] || "");
}

// Wrappers para conectar los botones +/- del HTML con el select hermano
function agregarOpcionEnumUI(boton) {
    const select = boton.parentElement.querySelector('select.enum-select');
    if (select) agregarOpcionEnum(select, select.dataset.enum);
}
function quitarOpcionEnumUI(boton) {
    const select = boton.parentElement.querySelector('select.enum-select');
    if (select) quitarOpcionEnum(select, select.dataset.enum);
}

const fotosBase64 = {};
// Orden fijo de las 8 fotos (coincide con los ids usados en index.html)
const PHOTO_KEYS = [
    "Foto_Frente",
    "Foto_Culo",
    "Foto_Interior_Chasis",
    "Foto_Interior_Acoplado",
    "Foto_Proceso_Carga",
    "Foto_Etiqueta_Bolsa",
    "Foto_Camion_Cargado",
    "Foto_Ticket_Balanza"
];
const LOGO_BRAUN_BLANCO = "data:image/png;base64,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";

// --- 2. SISTEMA DE NAVEGACIÓN Y VISTAS ---
function cambiarVista(idDestino) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const vistaDestino = document.getElementById(idDestino);
    vistaDestino.classList.remove('hidden');

    const header = document.getElementById('main-header');
    const btnBack = document.getElementById('btn-back');

    if (idDestino === 'view-login') {
        header.classList.add('hidden');
        vistaHistorialNavegacion = [];
    } else {
        header.classList.remove('hidden');
        if (idDestino === 'view-menu-principal') {
            document.getElementById('header-title').textContent = "Braun - Panel de Control";
            btnBack.classList.add('hidden');
            vistaHistorialNavegacion = ['view-menu-principal'];
        } else if (idDestino === 'view-submenu-carga') {
            document.getElementById('header-title').textContent = "Control de Carga";
            btnBack.classList.remove('hidden');
            if(vistaHistorialNavegacion.slice(-1)[0] !== idDestino) vistaHistorialNavegacion.push(idDestino);
        } else if (idDestino === 'view-modulo-carga') {
            document.getElementById('header-title').textContent = `Carga ${tipoCargaActual}`;
            btnBack.classList.remove('hidden');
            if(vistaHistorialNavegacion.slice(-1)[0] !== idDestino) vistaHistorialNavegacion.push(idDestino);
        } else if (idDestino === 'view-contratos') {
            document.getElementById('header-title').textContent = "Contratos";
            btnBack.classList.remove('hidden');
            if(vistaHistorialNavegacion.slice(-1)[0] !== idDestino) vistaHistorialNavegacion.push(idDestino);
        } else if (idDestino === 'view-ticketera') {
            document.getElementById('header-title').textContent = "Ticketera";
            btnBack.classList.remove('hidden');
            if(vistaHistorialNavegacion.slice(-1)[0] !== idDestino) vistaHistorialNavegacion.push(idDestino);
        }
    }
}

document.getElementById('btn-back').addEventListener('click', () => {
    if (vistaHistorialNavegacion.length > 1) {
        vistaHistorialNavegacion.pop();
        const pantallaAnterior = vistaHistorialNavegacion[vistaHistorialNavegacion.length - 1];
        cambiarVista(pantallaAnterior);
    }
});

function switchTab(tabName) {
    // Ocultar todas las pestañas de contenido
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    
    // Actualizar botones de pestaña si existen
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    if (tabName === 'nuevo') {
        const btnNuevo = document.getElementById('tab-btn-nuevo');
        if (btnNuevo) btnNuevo.classList.add('active');
        document.getElementById('tab-content-nuevo').classList.remove('hidden');
    } else {
        const btnHistorial = document.getElementById('tab-btn-historial');
        if (btnHistorial) btnHistorial.classList.add('active');
        document.getElementById('tab-content-historial').classList.remove('hidden');
        filtrarYRenderizarTabla();
    }
}

function abrirModuloCarga(tipo) {
    tipoCargaActual = tipo;
    document.getElementById('lbl-tipo-carga-actual').textContent = tipo;

    // Reset TOTAL del formulario para que el operario arranque limpio (punto 1 del pedido)
    document.getElementById('form-carga').reset();
    document.getElementById("fecha").valueAsDate = new Date();
    document.querySelectorAll(".preview").forEach(div => {
        div.innerHTML = "📸 Sin foto";
        div.style.backgroundImage = '';
        const box = div.closest('.photo-box'); if (box) box.classList.remove('has-photo');
    });
    Object.keys(fotosBase64).forEach(k => fotosBase64[k] = "");
    document.getElementById('estado-correo').value = "Sin enviar";

    document.getElementById('wrapper-productos-dinamicos').innerHTML = "";
    document.getElementById('wrapper-contratos-dinamicos').innerHTML = "";
    agregarFilaProducto();
    agregarFilaContrato();

    const selectElaboro = document.getElementById('elaboro');
    if (selectElaboro) poblarSelect(selectElaboro, 'elaboro', '');

    switchTab('historial');
    cambiarVista('view-modulo-carga');

    setTimeout(() => {
        initCanvasFirma("canvas-firma-chofer");
        initCanvasFirma("canvas-firma-control");
    }, 150);
}

// --- 3. FUNCIONES DINÁMICAS (AGREGAR PRODUCTOS Y CONTRATOS) ---
function agregarFilaProducto() {
    const wrapper = document.getElementById('wrapper-productos-dinamicos');
    const index = wrapper.children.length;

    const card = document.createElement('div');
    card.className = 'dynamic-item-card';
    card.innerHTML = `
        <div class="dynamic-card-header">
            <span>Item de Producto #${index + 1}</span>
            ${index > 0 ? `<button type="button" class="btn-eliminar-item" onclick="eliminarItemProducto(this)" title="Eliminar este ítem"><i class="fas fa-trash-alt"></i> Eliminar</button>` : ''}
        </div>
        <div class="form-group-row">
            <div class="form-group">
                <label>Producto</label>
                <select class="prod-item enum-select" data-field="producto" data-enum="producto" required></select>
            </div>
            <div class="form-group">
                <label>Calibre</label>
                <select class="prod-item enum-select" data-field="calibre" data-enum="calibre"></select>
            </div>
        </div>
        <div class="form-group-row">
            <div class="form-group">
                <label>Tipo</label>
                <select class="prod-item enum-select" data-field="tipo" data-enum="tipoCarga"></select>
            </div>
            <div class="form-group"><label>N° Lote</label><input type="text" class="prod-item" data-field="lote" placeholder="4639" required></div>
        </div>
        <div class="form-group-row">
            <div class="form-group"><label>Posición Planta</label><input type="text" class="prod-item" data-field="posicion" placeholder="LT-3"></div>
            <div class="form-group">
                <label>Tipo Envase</label>
                <select class="prod-item enum-select" data-field="envase" data-enum="envase"></select>
            </div>
        </div>
        <div class="form-group-row">
            <div class="form-group"><label>Cant. Envases</label><input type="number" class="prod-item campo-cantidad" data-field="cantidad" value="1"></div>
            <div class="form-group"><label>Kg Envase</label><input type="number" class="prod-item campo-kgenvase" data-field="kg_envase" value="25"></div>
            <div class="form-group"><label>Total Kg</label><input type="text" class="prod-item campo-calculado campo-total-kg" data-field="total_kg" readonly></div>
        </div>
    `;
    wrapper.appendChild(card);

    // Poblar los selects tipo enum recién creados
    card.querySelectorAll('.enum-select').forEach(sel => poblarSelect(sel, sel.dataset.enum, ''));

    // Cálculo automático de Total Kg = Cantidad x Kg Envase
    const inputCantidad = card.querySelector('.campo-cantidad');
    const inputKgEnvase = card.querySelector('.campo-kgenvase');
    const inputTotal = card.querySelector('.campo-total-kg');
    function recalcularTotalProducto() {
        const cant = parseFloat(inputCantidad.value) || 0;
        const kgEnv = parseFloat(inputKgEnvase.value) || 0;
        inputTotal.value = (cant * kgEnv).toFixed(2);
    }
    inputCantidad.addEventListener('input', recalcularTotalProducto);
    inputKgEnvase.addEventListener('input', recalcularTotalProducto);
    recalcularTotalProducto();
}

// Función para eliminar un ítem de producto específico
function eliminarItemProducto(button) {
    button.closest('.dynamic-item-card').remove();
}

// --- GESTOR CENTRALIZADO DE OPCIONES (Productos, Calibres, Tipos de Carga, Envases) ---
let gestorEnumActivo = 'producto';

function abrirGestorOpciones() {
    cambiarTabGestor(gestorEnumActivo);
    document.getElementById('modal-gestor-opciones').classList.add('active');
}

function cerrarGestorOpciones() {
    document.getElementById('modal-gestor-opciones').classList.remove('active');
}

function cambiarTabGestor(enumKey) {
    gestorEnumActivo = enumKey;
    document.querySelectorAll('#modal-gestor-opciones .gestor-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.enum === enumKey);
    });
    document.getElementById('gestor-input-nueva').value = '';
    renderizarListaGestor();
}

function renderizarListaGestor() {
    const lista = document.getElementById('gestor-lista-opciones');
    lista.innerHTML = '';
    const opciones = ENUMS[gestorEnumActivo] || [];

    if (opciones.length === 0) {
        const li = document.createElement('li');
        li.className = 'gestor-vacio';
        li.textContent = 'No hay opciones. Agregá la primera abajo.';
        lista.appendChild(li);
        return;
    }

    opciones.forEach(valor => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = valor;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gestor-btn-quitar';
        btn.title = `Quitar "${valor}"`;
        btn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        btn.addEventListener('click', () => quitarOpcionGestor(valor));
        li.appendChild(span);
        li.appendChild(btn);
        lista.appendChild(li);
    });
}

function agregarOpcionGestor() {
    const input = document.getElementById('gestor-input-nueva');
    const valor = input.value.trim();
    if (!valor) { input.focus(); return; }
    if (ENUMS[gestorEnumActivo].some(v => v.toLowerCase() === valor.toLowerCase())) {
        alert(`"${valor}" ya existe en esta lista.`);
        input.select();
        return;
    }
    ENUMS[gestorEnumActivo].push(valor);
    guardarEnums();
    input.value = '';
    input.focus();
    renderizarListaGestor();
    refrescarSelectsEnum(gestorEnumActivo);
}

function quitarOpcionGestor(valor) {
    const confirmado = confirm(`¿Quitar "${valor}" de la lista de opciones?\n(esto no borra los registros ya guardados que usan ese valor)`);
    if (!confirmado) return;
    ENUMS[gestorEnumActivo] = ENUMS[gestorEnumActivo].filter(v => v !== valor);
    guardarEnums();
    renderizarListaGestor();
    refrescarSelectsEnum(gestorEnumActivo);
}

// Repuebla en vivo todos los selects del formulario que usan el enum modificado, conservando la selección actual
function refrescarSelectsEnum(enumKey) {
    document.querySelectorAll(`select.enum-select[data-enum="${enumKey}"]`).forEach(sel => {
        poblarSelect(sel, enumKey, sel.value);
    });
    // Los selects de responsable dentro del historial de tickets también usan la lista de personal
    if (enumKey === 'personal' && db && typeof renderTicketsTicketera === 'function') {
        renderTicketsTicketera();
    }
}

// Agregar con Enter y cerrar con Escape
document.addEventListener('DOMContentLoaded', function() {
    const inputNueva = document.getElementById('gestor-input-nueva');
    if (inputNueva) {
        inputNueva.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); agregarOpcionGestor(); }
        });
    }
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('modal-gestor-opciones');
        if (e.key === 'Escape' && modal && modal.classList.contains('active')) cerrarGestorOpciones();
    });
});

// Abre el gestor de opciones directo en la pestaña Personal (usado desde la Ticketera)
function abrirGestorPersonal() {
    cambiarTabGestor('personal');
    document.getElementById('modal-gestor-opciones').classList.add('active');
}

// --- VISTA DE CONTRATOS (solo lectura sobre los datos de Control de Carga) ---
function abrirVistaContratos() {
    cambiarVista('view-contratos');
    renderizarTablaContratos();
}

// Filtros de la vista de Contratos: refrescan la tabla en vivo
document.getElementById('filter-cont-search').addEventListener('input', renderizarTablaContratos);
document.getElementById('filter-cont-fecha-desde').addEventListener('change', renderizarTablaContratos);
document.getElementById('filter-cont-fecha-hasta').addEventListener('change', renderizarTablaContratos);

async function renderizarTablaContratos() {
    const tbody = document.getElementById('tabla-contratos-body');
    const contador = document.getElementById('contratos-contador');
    if (!tbody) return;

    // Valores actuales de los filtros
    const txt = (document.getElementById('filter-cont-search').value || '').toLowerCase();
    const fechaDesde = document.getElementById('filter-cont-fecha-desde').value;
    const fechaHasta = document.getElementById('filter-cont-fecha-hasta').value;

    // Misma combinación de fuentes que el historial: locales pendientes + sincronizados con Sheets
    const registrosLocales = await obtenerRegistrosLocales();
    const idsLocales = new Set(registrosLocales.map(r => r.Id_Carga));
    const remotosNoDuplicados = historialGeneral.filter(r => !idsLocales.has(r.Id_Carga));
    const listaCombinada = registrosLocales.concat(remotosNoDuplicados);

    // Aplanamos: cada contrato de cada registro es una fila, heredando la fecha y observaciones del registro
    const filas = [];
    listaCombinada.forEach(registro => {
        let contratos = registro.Contratos || [];
        if (typeof contratos === 'string') { try { contratos = JSON.parse(contratos); } catch (e) { contratos = []; } }
        if (!Array.isArray(contratos)) return;
        contratos.forEach(c => {
            filas.push({
                fecha: registro.Fecha || '-',
                contrato_com: c.contrato_com || '-',
                contrato_cli: c.contrato_cli || '-',
                carta_porte: c.carta_porte || '-',
                kg_cp: parseFloat(c.kg_cp) || 0,
                kg_descarga: parseFloat(c.kg_descarga) || 0,
                observaciones: registro.Indicaciones_Descarga || '-'
            });
        });
    });

    // Filtrado por rango de fechas y búsqueda rápida (contrato comercial, cliente o carta de porte)
    const filtradas = filas.filter(f => {
        if (fechaDesde && f.fecha && f.fecha < fechaDesde) return false;
        if (fechaHasta && f.fecha && f.fecha > fechaHasta) return false;
        if (txt) {
            const textoFila = `${f.contrato_com} ${f.contrato_cli} ${f.carta_porte} ${f.observaciones}`.toLowerCase();
            if (!textoFila.includes(txt)) return false;
        }
        return true;
    });

    // Más recientes primero
    filtradas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    if (contador) contador.textContent = `${filtradas.length} contrato${filtradas.length === 1 ? '' : 's'}`;

    if (filtradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">No hay contratos que coincidan con los filtros.</td></tr>`;
        return;
    }

    const fmt = n => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    tbody.innerHTML = '';
    filtradas.forEach(f => {
        // Diferencia solicitada: Kg CP - Kg Descarga (calculada en vivo, no se toca el dato guardado)
        const diferencia = f.kg_cp - f.kg_descarga;
        const claseDif = diferencia < 0 ? 'dif-negativa' : (diferencia > 0 ? 'dif-positiva' : '');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Fecha">${f.fecha}</td>
            <td data-label="Contrato Comercial">${f.contrato_com}</td>
            <td data-label="Contrato Cliente">${f.contrato_cli}</td>
            <td data-label="Carta de Porte">${f.carta_porte}</td>
            <td data-label="Kg CP">${fmt(f.kg_cp)}</td>
            <td data-label="Kg Descarga">${fmt(f.kg_descarga)}</td>
            <td data-label="Diferencia KG" class="${claseDif}"><b>${fmt(diferencia)}</b></td>
            <td data-label="Observaciones CP">${f.observaciones}</td>
        `;
        tbody.appendChild(tr);
    });
}

function agregarFilaContrato() {
    const wrapper = document.getElementById('wrapper-contratos-dinamicos');
    const index = wrapper.children.length;

    const card = document.createElement('div');
    card.className = 'dynamic-item-card';
    card.innerHTML = `
        <div class="dynamic-card-header">
            <span>Contrato Comercial #${index + 1}</span>
            ${index > 0 ? `<button type="button" class="btn-remove-item" onclick="this.closest('.dynamic-item-card').remove()"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <div class="form-group-row">
            <div class="form-group"><label>Contrato Comercial</label><input type="text" class="cont-item" data-field="contrato_com" placeholder="CN26-057 B"></div>
            <div class="form-group"><label>Contrato Cliente</label><input type="text" class="cont-item" data-field="contrato_cli" placeholder="OC19147"></div>
        </div>
        <div class="form-group-row">
            <div class="form-group"><label>Carta de Porte</label><input type="text" class="cont-item" data-field="carta_porte" placeholder="10233036961"></div>
            <div class="form-group">
                <label>Destino de Mercadería</label>
                <div class="enum-row">
                    <select class="cont-item enum-select" data-field="destino" data-enum="destino"></select>
                    <button type="button" class="btn-enum-add" onclick="agregarOpcionEnumUI(this)" title="Agregar opción">+</button>
                    <button type="button" class="btn-enum-remove" onclick="quitarOpcionEnumUI(this)" title="Quitar opción">−</button>
                </div>
            </div>
        </div>
        <div class="form-group">
            <label>Carta de Porte (archivo adjunto)</label>
            <input type="file" class="cont-archivo-input" accept="image/*,.pdf" onchange="handleArchivoCP(this)">
            <input type="hidden" class="cont-item" data-field="archivo_cp">
            <div class="archivo-preview">Sin archivo</div>
        </div>
        <div class="form-group-row">
            <div class="form-group"><label>Kg CP</label><input type="number" class="cont-item campo-kgcp" data-field="kg_cp" value="0"></div>
            <div class="form-group"><label>Kg Descarga</label><input type="number" class="cont-item campo-kgdescarga" data-field="kg_descarga" value="0"></div>
            <div class="form-group"><label>Diferencia de Carga</label><input type="text" class="cont-item campo-calculado campo-diferencia" data-field="diferencia_carga" readonly></div>
        </div>
    `;
    wrapper.appendChild(card);

    card.querySelectorAll('.enum-select').forEach(sel => poblarSelect(sel, sel.dataset.enum, ''));

    // Cálculo automático de Diferencia de Carga = Kg Descarga - Kg CP
    const inputKgCP = card.querySelector('.campo-kgcp');
    const inputKgDescarga = card.querySelector('.campo-kgdescarga');
    const inputDiferencia = card.querySelector('.campo-diferencia');
    function recalcularDiferencia() {
        const kgCP = parseFloat(inputKgCP.value) || 0;
        const kgDesc = parseFloat(inputKgDescarga.value) || 0;
        inputDiferencia.value = (kgDesc - kgCP).toFixed(2);
    }
    inputKgCP.addEventListener('input', recalcularDiferencia);
    inputKgDescarga.addEventListener('input', recalcularDiferencia);
    recalcularDiferencia();
}

// --- 4. AUTENTICACIÓN (LOGIN) ---
document.getElementById('form-login').addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (email.includes('@') && password.length >= 4) {
        localStorage.setItem('usuarioBraun', email);
        cambiarVista('view-menu-principal');
    } else {
        alert('Credenciales inválidas.');
    }
});

function cerrarSesion() {
    localStorage.removeItem('usuarioBraun');
    cambiarVista('view-login');
}

// --- 5. CONTROL DE CONEXIÓN ---
function updateOnlineStatus() {
    const badge = document.getElementById("status-badge");
    if (navigator.onLine) {
        badge.textContent = "Online";
        badge.className = "online";
        sincronizarDatosPendientes();
        cargarHistorialDesdeGoogle();
    } else {
        badge.textContent = "Offline";
        badge.className = "offline";
    }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// --- BOTÓN "ACTUALIZAR" SIEMPRE VISIBLE EN EL HEADER ---
document.getElementById('btn-refrescar').addEventListener('click', actualizarManualmente);

function actualizarManualmente() {
    const boton = document.getElementById('btn-refrescar');
    const icono = boton ? boton.querySelector('i') : null;
    if (icono) icono.classList.add('fa-spin');

    renderOfflineCount();

    const terminar = () => {
        filtrarYRenderizarTabla();
        if (icono) icono.classList.remove('fa-spin');
    };

    if (navigator.onLine && !WEB_APP_URL.includes("AQUÍ_VA")) {
        sincronizarDatosPendientes();
        fetch(`${WEB_APP_URL}?action=read`)
            .then(res => res.json())
            .then(data => { if (Array.isArray(data)) historialGeneral = data; })
            .catch(err => console.error("No se pudo actualizar desde el servidor:", err))
            .finally(terminar);
    } else {
        // Sin conexión: al menos refrescamos la vista con lo que haya en la cola local
        setTimeout(terminar, 300);
    }
}


// --- 6. MANEJO DE FIRMAS DIGITALES ---
function initCanvasFirma(id) {
    const canvas = document.getElementById(id);
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    let drawing = false;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight || 150;
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 3;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDraw(e) { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); }
    function draw(e) { if(!drawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    function stopDraw() { drawing = false; }

    canvas.addEventListener("mousedown", startDraw); canvas.addEventListener("mousemove", draw); window.addEventListener("mouseup", stopDraw);
    canvas.addEventListener("touchstart", startDraw); canvas.addEventListener("touchmove", draw); window.addEventListener("touchend", stopDraw);
}

function limpiarFirma(id) {
    const canvas = document.getElementById(id);
    if(canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

// --- 7. CONFIGURACIÓN Y COMPRESIÓN DE LAS FOTOS ---
let fotosEnProceso = 0;

function configurarFoto(inputId, previewId, keyName) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", function(e) {
        const file = e.target.files[0];
        if (file) {
            fotosEnProceso++;
            document.getElementById(previewId).innerHTML = "⏳ Procesando...";

            const reader = new FileReader();
            reader.onload = function(event) {
                const img = new Image();
                img.onload = function() {
                    try {
                        const canvas = document.createElement("canvas");
                        const max_width = 600;
                        let width = img.width;
                        let height = img.height;
                        if (width > max_width) {
                            height *= max_width / width;
                            width = max_width;
                        }
                        canvas.width = width;
                        canvas.height = height;
                        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                        const compressed = canvas.toDataURL("image/jpeg", 0.5);
                        fotosBase64[keyName] = compressed;
                        const previewDiv = document.getElementById(previewId);
                        previewDiv.innerHTML = '';
                        previewDiv.style.backgroundImage = `url(${compressed})`;
                        previewDiv.style.backgroundSize = 'cover';
                        previewDiv.style.backgroundPosition = 'center center';
                        const box = previewDiv.closest('.photo-box'); if (box) box.classList.add('has-photo');
                        // Hacer clickable la preview para abrir modal ampliado
                        previewDiv.style.cursor = 'pointer';
                        previewDiv.onclick = function() { openImageSlider(keyName); };
                    } catch (err) {
                        console.error("Error al comprimir la foto:", keyName, err);
                        document.getElementById(previewId).innerHTML = "⚠️ Error, reintentá la foto";
                    } finally {
                        fotosEnProceso--;
                    }
                };
                img.onerror = function() {
                    console.error("La imagen no pudo cargarse:", keyName);
                    const previewDiv = document.getElementById(previewId);
                    previewDiv.innerHTML = "⚠️ Error, reintentá la foto";
                    previewDiv.style.backgroundImage = '';
                    const boxErr = previewDiv.closest('.photo-box'); if (boxErr) boxErr.classList.remove('has-photo');
                    fotosEnProceso--;
                };
                img.src = event.target.result;
            };
            reader.onerror = function() {
                console.error("No se pudo leer el archivo:", keyName);
                const previewDiv = document.getElementById(previewId);
                previewDiv.innerHTML = "⚠️ Error, reintentá la foto";
                previewDiv.style.backgroundImage = '';
                const boxErr2 = previewDiv.closest('.photo-box'); if (boxErr2) boxErr2.classList.remove('has-photo');
                fotosEnProceso--;
            };
            reader.readAsDataURL(file);
        }
    });
}

// --- 7-B. MODAL SIMPLE PARA VISTA AMPLIADA DE IMÁGENES ---
function createImageModal() {
    if (document.querySelector('.image-modal')) return;
    const modal = document.createElement('div');
    modal.className = 'image-modal';
        tr.innerHTML = `
            <td>${item.Fecha || '-'}</td>
            <td><b>${listaProductos}</b>${etiquetaPendiente}</td>
            <td>${listaContratos}</td>
            <td><span class="badge ${item.ESTATUS ? item.ESTATUS.toLowerCase() : 'aceptado'}">${item.ESTATUS || 'ACEPTADO'}</span></td>
            <td>${item.Kg_Cargados || '0'} kg</td>
            <td>
                <button class="btn-table-action" onclick="cargarRegistroParaEditar('${dataString}')" title="Editar registro" aria-label="Editar registro">
                    <i class="fas fa-pen" style="color:#ef6c00; font-size: 1.1rem;"></i>
                </button>
                <button class="btn-table-action" onclick="eliminarRegistro('${dataString}')" title="Eliminar registro" aria-label="Eliminar registro">
                    <i class="fas fa-trash" style="color:#c62828; font-size: 1.1rem;"></i>
                </button>
            </td>
        `;

        // Añadir etiquetas legibles a cada celda para la vista móvil (data-label)
        const headerLabels = ['Fecha','Producto/s','Contrato/s Comercial','Estatus','Kg','Acciones'];
        tr.querySelectorAll('td').forEach((td, i) => {
            td.setAttribute('data-label', headerLabels[i] || '');
        });
    const navPrev = modal.querySelector('.nav-prev');
    const navNext = modal.querySelector('.nav-next');
    const imgInner = modal.querySelector('.img-inner');
    const counter = modal.querySelector('.counter');
    const dots = modal.querySelector('.dots');

    let currentIndex = 0;

    function showImageAtIndex(i) {
        currentIndex = (i + PHOTO_KEYS.length) % PHOTO_KEYS.length;
        const key = PHOTO_KEYS[currentIndex];
        const dataUrl = fotosBase64[key] || '';
        if (dataUrl) {
            imgInner.style.backgroundImage = `url(${dataUrl})`;
            imgInner.textContent = '';
        } else {
            imgInner.style.backgroundImage = '';
            imgInner.textContent = 'Sin foto disponible';
            imgInner.style.color = '#fff';
            imgInner.style.display = 'flex';
            imgInner.style.alignItems = 'center';
            imgInner.style.justifyContent = 'center';
        }
        counter.textContent = `${currentIndex + 1} / ${PHOTO_KEYS.length}`;
        // update dots
        dots.innerHTML = '';
        PHOTO_KEYS.forEach((k, idx) => {
            const d = document.createElement('div'); d.className = 'dot'; if (idx === currentIndex) d.classList.add('active'); dots.appendChild(d);
        });
    }

    function openAtIndex(i) {
        showImageAtIndex(i);
        modal.classList.add('active');
    }

    function close() {
        modal.classList.remove('active');
        imgInner.style.backgroundImage = '';
        imgInner.textContent = '';
    }

    navPrev.addEventListener('click', function(e){ e.stopPropagation(); showImageAtIndex(currentIndex - 1); });
    navNext.addEventListener('click', function(e){ e.stopPropagation(); showImageAtIndex(currentIndex + 1); });
    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);

    // swipe support
    let startX = 0, endX = 0;
    imgInner.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; }, {passive:true});
    imgInner.addEventListener('touchmove', function(e){ endX = e.touches[0].clientX; }, {passive:true});
    imgInner.addEventListener('touchend', function(){ const dx = endX - startX; if (Math.abs(dx) > 40) { if (dx < 0) showImageAtIndex(currentIndex + 1); else showImageAtIndex(currentIndex - 1); } startX = endX = 0; });

    // keyboard navigation
    window.addEventListener('keydown', function(e){
        if (!modal.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') showImageAtIndex(currentIndex - 1);
        if (e.key === 'ArrowRight') showImageAtIndex(currentIndex + 1);
    });

    // expose helper on modal element for external calls
    modal._openAtIndex = openAtIndex;
}

function openImageSlider(keyName) {
    createImageModal();
    const modal = document.querySelector('.image-modal');
    const idx = PHOTO_KEYS.indexOf(keyName);
    const startIndex = idx >= 0 ? idx : 0;
    if (modal && modal._openAtIndex) modal._openAtIndex(startIndex);
}

// Inicializar modal en carga del script
document.addEventListener('DOMContentLoaded', function() { createImageModal(); });

// =========================================================================
// --- APARTADO NUEVO: SISTEMA DE TICKETERA SIMPLE -------------------------
// =========================================================================

// Inicializar elementos de la ticketera
function abrirTicketera() {
    // Mostrar vista
    cambiarVista('view-ticketera');
    // Poblar selects de solicitante y responsable desde la lista centralizada de personal
    const selNombre = document.getElementById('ticket-nombre');
    if (selNombre) poblarSelect(selNombre, 'personal', '');
    const sel = document.getElementById('ticket-responsable');
    if (sel) poblarSelect(sel, 'personal', '');
    // Limpiar formulario y cargar tabla
    resetTicketForm();
    renderTicketsTicketera();
}

function resetTicketForm() {
    const form = document.getElementById('form-ticketera');
    if (form) form.reset();
    const preview = document.getElementById('ticket-preview');
    if (preview) preview.textContent = 'Sin archivo';
    // limpiar base64 temporal
    form && (form._archivoBase64 = '');
}

// Manejo del archivo adjunto: preview y guardado temporal en el form
document.addEventListener('change', function(e){
    if (e.target && e.target.id === 'ticket-archivo') {
        const input = e.target;
        const file = input.files[0];
        const preview = document.getElementById('ticket-preview');
        const form = document.getElementById('form-ticketera');
        if (!file) { if (preview) preview.textContent = 'Sin archivo'; if (form) form._archivoBase64 = ''; return; }
        const reader = new FileReader();
        reader.onload = function(ev){
            const data = ev.target.result;
            if (preview) {
                if (file.type.startsWith('image/')) {
                    preview.innerHTML = '';
                    preview.style.backgroundImage = `url(${data})`;
                    preview.style.backgroundSize = 'cover';
                    preview.style.height = '80px';
                    preview.style.borderRadius = '6px';
                } else {
                    preview.style.backgroundImage = '';
                    preview.textContent = `📎 ${file.name}`;
                }
            }
            if (form) form._archivoBase64 = data;
        };
        reader.readAsDataURL(file);
    }
});

// Guardar nuevo ticket en IndexedDB y notificar backend
document.getElementById('form-ticketera').addEventListener('submit', function(e){
    e.preventDefault();
    const nombre = document.getElementById('ticket-nombre').value.trim();
    const correo = document.getElementById('ticket-correo').value.trim();
    const responsable = document.getElementById('ticket-responsable').value;
    const prioridad = document.querySelector('input[name="ticket-prioridad"]:checked').value;
    const detalle = document.getElementById('ticket-detalle').value.trim();
    const form = document.getElementById('form-ticketera');
    const archivo = form && form._archivoBase64 ? form._archivoBase64 : '';

    if (!nombre || !correo) { alert('Completá nombre y correo del solicitante.'); return; }

    const ticket = {
        fecha_creacion: new Date().toISOString(),
        fecha_cierre: '',
        nombre_solicitante: nombre,
        correo_solicitante: correo,
        responsable_asignado: responsable || '',
        prioridad: prioridad,
        detalle_solicitud: detalle,
        archivo_adjunto: archivo,
        estado_ticket: 'Abierto'
    };

    const tx = db.transaction(['ticketera_tickets'], 'readwrite');
    const store = tx.objectStore('ticketera_tickets');
    const req = store.add(ticket);
    req.onsuccess = function() {
        // notificar creación al backend para enviar correo
        try {
            fetch(WEB_APP_URL, {
                method: 'POST', mode: 'no-cors', headers: {'Content-Type':'application/json'},
                body: JSON.stringify(Object.assign({ _accion: 'crear_ticket' }, ticket))
            });
        } catch (err) { console.error('Error al notificar backend crear_ticket', err); }
        resetTicketForm();
        renderTicketsTicketera();
        alert('Ticket creado correctamente.');
    };
    req.onerror = function(e){ console.error('Error al guardar ticket:', e); alert('No se pudo guardar el ticket.'); };
});

// Renderizar tickets desde IndexedDB en la tabla
function renderTicketsTicketera() {
    const tbody = document.getElementById('ticketera-body');
    if (!tbody) return;
    const tx = db.transaction(['ticketera_tickets'], 'readonly');
    const store = tx.objectStore('ticketera_tickets');
    const req = store.getAll();
    req.onsuccess = function() {
        let items = req.result || [];

        // Filtros del historial (estado, prioridad y búsqueda rápida)
        const filtroEstado = (document.getElementById('filter-ticket-estado') || {}).value || '';
        const filtroPrioridad = (document.getElementById('filter-ticket-prioridad') || {}).value || '';
        const filtroTxt = ((document.getElementById('filter-ticket-search') || {}).value || '').toLowerCase();
        items = items.filter(item => {
            if (filtroEstado && (item.estado_ticket || 'Abierto') !== filtroEstado) return false;
            if (filtroPrioridad && (item.prioridad || 'Baja') !== filtroPrioridad) return false;
            if (filtroTxt) {
                const texto = `${item.nombre_solicitante || ''} ${item.correo_solicitante || ''} ${item.responsable_asignado || ''} ${item.detalle_solicitud || ''}`.toLowerCase();
                if (!texto.includes(filtroTxt)) return false;
            }
            return true;
        });

        if (items.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">No hay tickets que coincidan con los filtros.</td></tr>`; return; }
        // ordenar por fecha desc
        items.sort((a,b)=> (b.fecha_creacion||'').localeCompare(a.fecha_creacion||''));
        tbody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            const fecha = new Date(item.fecha_creacion).toLocaleString();
            const prioridadClass = item.prioridad === 'Alta' ? 'alta' : (item.prioridad === 'Media' ? 'media' : 'baja');
            tr.innerHTML = `
                <td data-label="Fecha" class="td-fecha-ticket">${fecha}</td>
                <td data-label="Solicitante"><b>${escapeHtml(item.nombre_solicitante || '-')}</b><br><small>${escapeHtml(item.correo_solicitante || '')}</small></td>
                <td data-label="Responsable">
                    <select class="ticket-resp-select">
                        <option value="">-- Ninguno --</option>
                    </select>
                </td>
                <td data-label="Prioridad" class="td-prio-ticket"><span class="badge-prio ${prioridadClass}">${item.prioridad || 'Baja'}</span></td>
                <td data-label="Estado">
                    <select class="ticket-estado-select">
                        <option value="Abierto">Abierto</option>
                        <option value="En Proceso">En Proceso</option>
                        <option value="Cerrado">Cerrado</option>
                    </select>
                </td>
                <td class="td-acciones-ticket">
                    <button class="btn-table-action" title="Ver detalle"> <i class="fas fa-eye"></i> </button>
                    <button class="btn-table-action" title="Descargar adjunto"> <i class="fas fa-download"></i> </button>
                </td>
            `;

            // insertar opciones de responsables
            const respSelect = tr.querySelector('.ticket-resp-select');
            if (respSelect) {
                const opciones = (ENUMS && ENUMS.personal) ? ENUMS.personal : [];
                opciones.forEach(opt => {
                    const o = document.createElement('option'); o.value = opt; o.textContent = opt; if (opt === item.responsable_asignado) o.selected = true; respSelect.appendChild(o);
                });
            }

            // set estado
            const estadoSelect = tr.querySelector('.ticket-estado-select');
            if (estadoSelect) estadoSelect.value = item.estado_ticket || 'Abierto';

            // acciones: ver detalle / descargar
            const btns = tr.querySelectorAll('.btn-table-action');
            if (btns[0]) btns[0].addEventListener('click', ()=> showTicketDetalle(item));
            if (btns[1]) btns[1].addEventListener('click', ()=> descargarAdjuntoTicket(item));

            // cuando se cambia responsable
            respSelect.addEventListener('change', function(){
                const nuevo = this.value;
                updateTicketField(item.id, 'responsable_asignado', nuevo, function(){
                    // notificar al responsable
                    try { fetch(WEB_APP_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ _accion:'notificar_responsable', ticket:Object.assign({}, item, { responsable_asignado: nuevo }) }) }); } catch(e){ console.error(e); }
                    renderTicketsTicketera();
                });
            });

            // cuando se cambia estado
            estadoSelect.addEventListener('change', function(){
                const nuevo = this.value;
                const patch = { estado_ticket: nuevo };
                if (nuevo === 'Cerrado') patch.fecha_cierre = new Date().toISOString();
                updateTicketFields(item.id, patch, function(){
                    // notificar responsable del cambio
                    try { fetch(WEB_APP_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ _accion:'notificar_responsable', ticket:Object.assign({}, item, patch) }) }); } catch(e){ console.error(e); }
                    renderTicketsTicketera();
                });
            });

            tbody.appendChild(tr);
        });
    };
}

function showTicketDetalle(item) {
    const detalle = `Fecha: ${new Date(item.fecha_creacion).toLocaleString()}\nSolicitante: ${item.nombre_solicitante} <${item.correo_solicitante}>\nResponsable: ${item.responsable_asignado}\nPrioridad: ${item.prioridad}\nEstado: ${item.estado_ticket}\n\nDetalle:\n${item.detalle_solicitud}`;
    alert(detalle);
}

function descargarAdjuntoTicket(item) {
    if (!item.archivo_adjunto) { alert('No hay archivo adjunto en este ticket.'); return; }
    const a = document.createElement('a');
    a.href = item.archivo_adjunto;
    a.download = `ticket-${item.id}-adjunto`;
    document.body.appendChild(a); a.click(); a.remove();
}

function updateTicketField(id, field, value, cb) {
    const tx = db.transaction(['ticketera_tickets'], 'readwrite');
    const store = tx.objectStore('ticketera_tickets');
    const req = store.get(id);
    req.onsuccess = function(){
        const rec = req.result; if (!rec) { if (cb) cb(); return; }
        rec[field] = value;
        const upd = store.put(rec);
        upd.onsuccess = function(){ if (cb) cb(); };
    };
}

function updateTicketFields(id, patch, cb) {
    const tx = db.transaction(['ticketera_tickets'], 'readwrite');
    const store = tx.objectStore('ticketera_tickets');
    const req = store.get(id);
    req.onsuccess = function(){
        const rec = req.result; if (!rec) { if (cb) cb(); return; }
        Object.keys(patch).forEach(k=> rec[k]=patch[k]);
        const upd = store.put(rec);
        upd.onsuccess = function(){ if (cb) cb(); };
    };
}

// Utilidad para escapar texto en HTML
function escapeHtml(str){ if(!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Filtros del historial de tickets: refrescan la tabla en vivo
document.getElementById('filter-ticket-search').addEventListener('input', renderTicketsTicketera);
document.getElementById('filter-ticket-estado').addEventListener('change', renderTicketsTicketera);
document.getElementById('filter-ticket-prioridad').addEventListener('change', renderTicketsTicketera);

// Exponer abrirTicketera globalmente para poder llamarla desde la UI
window.abrirTicketera = abrirTicketera;

// Cargar tickets cuando la DB esté lista si la vista está activa
function tryInitTicketera() {
    // poblar selects de solicitante y responsable desde la lista de personal
    const selNombre = document.getElementById('ticket-nombre'); if (selNombre) poblarSelect(selNombre, 'personal', '');
    const sel = document.getElementById('ticket-responsable'); if (sel) poblarSelect(sel, 'personal', '');
    // renderizar tabla si la vista está visible
    if (!document.getElementById('view-ticketera')) return;
    renderTicketsTicketera();
}

// Ejecutar intento inicial tras carga
setTimeout(tryInitTicketera, 500);

// =========================================================================
// --- FIN APARTADO NUEVO: SISTEMA DE TICKETERA SIMPLE --------------------
// =========================================================================

// --- 8. PROCESADO Y GUARDADO DEL FORMULARIO (ALTA Y EDICIÓN) ---
document.getElementById("form-carga").addEventListener("submit", function(e) {
    e.preventDefault();

    if (fotosEnProceso > 0) {
        alert(`Esperá un instante: todavía se ${fotosEnProceso === 1 ? 'está procesando 1 foto' : 'están procesando ' + fotosEnProceso + ' fotos'}. Volvé a tocar "Guardar" en unos segundos.`);
        return;
    }

    const esEdicion = !!idRegistroEnEdicion;
    const idParaGuardar = idRegistroEnEdicion || ("BC-" + Date.now());
    const registro = construirRegistroDesdeFormulario(idParaGuardar);

    if (esEdicion) {
        actualizarRegistroExistente(registro);
    } else {
        guardarRegistroNuevo(registro);
    }
});

// Arma el objeto "registro" a partir del estado actual del formulario.
// Se usa tanto al Guardar como al Enviar por Correo, para no repetir código.
function construirRegistroDesdeFormulario(idParaGuardar) {
    const listaProductos = [];
    document.querySelectorAll('#wrapper-productos-dinamicos .dynamic-item-card').forEach(card => {
        const item = {};
        card.querySelectorAll('.prod-item').forEach(input => {
            item[input.dataset.field] = input.value;
        });
        listaProductos.push(item);
    });

    const listaContratos = [];
    document.querySelectorAll('#wrapper-contratos-dinamicos .dynamic-item-card').forEach(card => {
        const item = {};
        card.querySelectorAll('.cont-item').forEach(input => {
            item[input.dataset.field] = input.value;
        });
        listaContratos.push(item);
    });

    return {
        Id_Carga: idParaGuardar,
        Fecha: document.getElementById("fecha").value,
        Tipo_Carga: tipoCargaActual,
        Nombre_Chofer: document.getElementById("chofer").value,
        Patente_Chasis: document.getElementById("patente-chasis").value,
        Patente_Acoplado: document.getElementById("patente-acoplado").value,

        Productos: listaProductos,
        Contratos: listaContratos,

        Aplica_Etiqueta: document.querySelector('input[name="aplica_etiqueta"]:checked').value,
        Lona_Protege: document.querySelector('input[name="lona_protege"]:checked').value,
        Piso_Libre_Suciedad: document.querySelector('input[name="piso_suciedad"]:checked').value,
        Libre_Oxido: document.querySelector('input[name="libre_oxido"]:checked').value,
        Chasis_Secos_Insectos: document.querySelector('input[name="secos_insectos"]:checked').value,
        Exentos_Hongos: document.querySelector('input[name="exentos_hongos"]:checked').value,
        Aislante_Piso: document.querySelector('input[name="aislante_piso"]:checked').value,

        ESTATUS: document.querySelector('input[name="estatus"]:checked').value,
        Elaboro: document.getElementById("elaboro").value,
        Indicaciones_Descarga: document.getElementById("indicaciones").value,
        Kg_Cargados: document.getElementById("kg-cargados").value,

        Correo: document.getElementById("correo-envio").value,
        Estado_Correo: document.getElementById("estado-correo").value,

        Firma_Chofer: document.getElementById("canvas-firma-chofer").toDataURL(),
        Firma_Control: document.getElementById("canvas-firma-control").toDataURL(),

        Foto_Frente: fotosBase64["Foto_Frente"] || "",
        Foto_Culo: fotosBase64["Foto_Culo"] || "",
        Foto_Interior_Chasis: fotosBase64["Foto_Interior_Chasis"] || "",
        Foto_Interior_Acoplado: fotosBase64["Foto_Interior_Acoplado"] || "",
        Foto_Proceso_Carga: fotosBase64["Foto_Proceso_Carga"] || "",
        Foto_Etiqueta_Bolsa: fotosBase64["Foto_Etiqueta_Bolsa"] || "",
        Foto_Camion_Cargado: fotosBase64["Foto_Camion_Cargado"] || "",
        Foto_Ticket_Balanza: fotosBase64["Foto_Ticket_Balanza"] || ""
    };
}

// --- 8-B. ARCHIVO ADJUNTO DE LA CARTA DE PORTE (reemplaza el viejo campo "Link CP") ---
function handleArchivoCP(inputEl) {
    const file = inputEl.files[0];
    const card = inputEl.closest('.dynamic-item-card');
    const hiddenInput = card.querySelector('input[data-field="archivo_cp"]');
    const preview = card.querySelector('.archivo-preview');
    if (!file) {
        hiddenInput.value = "";
        preview.textContent = "Sin archivo";
        return;
    }
    const reader = new FileReader();
    reader.onload = function(event) {
        hiddenInput.value = event.target.result;
        preview.textContent = `📎 ${file.name}`;
    };
    reader.readAsDataURL(file);
}

// --- 8-C. ENVÍO DEL REPORTE POR CORREO (requiere que el Google Apps Script
//     sepa atender la acción "enviar_correo" y mandar el mail con MailApp/GmailApp) ---
function enviarPorCorreo() {
    const correo = document.getElementById("correo-envio").value.trim();
    const estadoInput = document.getElementById("estado-correo");

    if (!correo || !correo.includes('@')) {
        alert("Ingresá un correo electrónico válido antes de enviar.");
        return;
    }
    if (!navigator.onLine) {
        alert("No hay conexión a internet. El correo no se puede enviar en este momento.");
        return;
    }
    if (WEB_APP_URL.includes("AQUÍ_VA")) {
        alert("Todavía no se configuró la URL del backend (Google Apps Script).");
        return;
    }

    estadoInput.value = "Iniciado";

    const idTemporal = idRegistroEnEdicion || ("BC-" + Date.now());
    const registro = construirRegistroDesdeFormulario(idTemporal);

    fetch(WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ _accion: "enviar_correo" }, registro))
    })
    .then(() => {
        // mode:no-cors no permite leer la respuesta real del servidor,
        // así que solo podemos confirmar que la petición salió sin error de red.
        estadoInput.value = "Enviado (sin confirmación del servidor)";
    })
    .catch(err => {
        console.error("Error al enviar por correo:", err);
        estadoInput.value = "Error de conexión";
    });
}

function guardarRegistroNuevo(registro) {
    const tx = db.transaction(["controles_carga"], "readwrite");
    const req = tx.objectStore("controles_carga").add(registro);

    req.onsuccess = function() {
        finalizarGuardadoUI("¡Control de carga Braun guardado con éxito!", false);
        renderOfflineCount();
        if (navigator.onLine) { sincronizarDatosPendientes(); }
    };

    req.onerror = function(e) {
        console.error("Error al guardar en IndexedDB:", e.target.error);
        alert("⚠️ No se pudo guardar el registro en este dispositivo. Motivo: " + (e.target.error ? e.target.error.message : "desconocido") + "\n\nProbá liberar espacio o revisar las fotos cargadas.");
    };
}

function actualizarRegistroExistente(registro) {
    if (!db) { alert("La base de datos local todavía no está lista, esperá un instante e intentá de nuevo."); return; }

    const tx = db.transaction(["controles_carga"], "readwrite");
    const store = tx.objectStore("controles_carga");
    let encontradoEnColaLocal = false;

    tx.onerror = function(e) {
        console.error("Error de transacción al actualizar IndexedDB:", e.target.error);
        alert("⚠️ No se pudieron guardar los cambios en este dispositivo. Motivo: " + (e.target.error ? e.target.error.message : "desconocido"));
    };

    store.openCursor().onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
            if (cursor.value.Id_Carga === registro.Id_Carga) {
                encontradoEnColaLocal = true;
                const registroActualizado = Object.assign({}, registro, { id: cursor.value.id });
                cursor.update(registroActualizado);
            }
            cursor.continue();
        } else {
            // Terminó de recorrer la cola local
            if (encontradoEnColaLocal) {
                finalizarGuardadoUI("¡Cambios guardados! (el registro seguía en la cola offline y se sincronizará normalmente)", true);
                renderOfflineCount();
                if (navigator.onLine) { sincronizarDatosPendientes(); }
            } else {
                // No estaba en la cola: ya se había sincronizado antes con Google Sheets.
                // Actualizamos la vista local y avisamos al backend (requiere soporte de tu lado en Apps Script).
                const idx = historialGeneral.findIndex(r => r.Id_Carga === registro.Id_Carga);
                if (idx !== -1) historialGeneral[idx] = registro;

                if (navigator.onLine && !WEB_APP_URL.includes("AQUÍ_VA")) {
                    fetch(WEB_APP_URL, {
                        method: "POST",
                        mode: "no-cors",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(Object.assign({ _accion: "actualizar" }, registro))
                    }).catch(err => console.error("No se pudo sincronizar la edición con el servidor:", err));
                }

                finalizarGuardadoUI("¡Cambios guardados! Si el registro ya estaba sincronizado con Sheets, confirmá que tu Google Apps Script soporte la acción \"actualizar\" por Id_Carga.", true);
            }
        }
    };
}

function finalizarGuardadoUI(mensaje, volverAlHistorial) {
    alert(mensaje);
    document.getElementById("form-carga").reset();
    document.querySelectorAll(".preview").forEach(div => {
        div.innerHTML = "📸 Sin foto";
        div.style.backgroundImage = '';
        const box = div.closest('.photo-box'); if (box) box.classList.remove('has-photo');
    });
    limpiarFirma("canvas-firma-chofer");
    limpiarFirma("canvas-firma-control");
    Object.keys(fotosBase64).forEach(k => fotosBase64[k] = "");

    idRegistroEnEdicion = null;
    document.getElementById('btn-guardar-control').textContent = "Guardar Control Completo";
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');

    abrirModuloCarga(tipoCargaActual);
    if (volverAlHistorial) {
        switchTab('historial');
    }
}



// --- 9. TRAER HISTORIAL E INYECTAR EN TABLA ---
function cargarHistorialDesdeGoogle() {
    if (!navigator.onLine || WEB_APP_URL.includes("AQUÍ_VA")) return;
    fetch(`${WEB_APP_URL}?action=read`)
    .then(res => res.json())
    .then(data => {
        if(Array.isArray(data)) {
            historialGeneral = data;
            filtrarYRenderizarTabla();
        }
    })
    .catch(err => console.error("Error cargando historial:", err));
}

// Lee todos los registros que todavía están en la cola local (IndexedDB), sin importar si están sincronizados o no
function obtenerRegistrosLocales() {
    return new Promise((resolve) => {
        if (!db) { resolve([]); return; }
        try {
            const tx = db.transaction(["controles_carga"], "readonly");
            const req = tx.objectStore("controles_carga").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (err) {
            console.error("No se pudo leer la cola local:", err);
            resolve([]);
        }
    });
}

document.getElementById('filter-search').addEventListener('input', filtrarYRenderizarTabla);
document.getElementById('filter-fecha-desde').addEventListener('change', filtrarYRenderizarTabla);
document.getElementById('filter-fecha-hasta').addEventListener('change', filtrarYRenderizarTabla);
document.getElementById('filter-status').addEventListener('change', filtrarYRenderizarTabla);

async function filtrarYRenderizarTabla() {
    const txt = document.getElementById('filter-search').value.toLowerCase();
    const fechaDesde = document.getElementById('filter-fecha-desde').value;
    const fechaHasta = document.getElementById('filter-fecha-hasta').value;
    const status = document.getElementById('filter-status').value;
    const tbody = document.getElementById('tabla-historial-body');
    if(!tbody) return;
 
    // --- Combinamos lo que ya sincronizó con Sheets + lo que todavía está solo en este celular ---
    const registrosLocales = await obtenerRegistrosLocales();
    const idsLocales = new Set(registrosLocales.map(r => r.Id_Carga));
    const registrosLocalesMarcados = registrosLocales.map(r => Object.assign({}, r, { _pendienteSync: true }));
    const remotosNoDuplicados = historialGeneral.filter(r => !idsLocales.has(r.Id_Carga));
    const listaCombinada = registrosLocalesMarcados.concat(remotosNoDuplicados);
 
    tbody.innerHTML = "";
 
    const filtrados = listaCombinada.filter(item => {
        if (item.Tipo_Carga !== tipoCargaActual) return false;
 
        const productos = Array.isArray(item.Productos) ? item.Productos : [];
        const contratos = Array.isArray(item.Contratos) ? item.Contratos : [];
 
        const textoProductos = productos.map(p => (p.producto || '')).join(' ').toLowerCase();
        const textoContratos = contratos.map(c => (c.contrato_com || '')).join(' ').toLowerCase();
 
        if (txt && !textoProductos.includes(txt) && !textoContratos.includes(txt)) return false;
        
        // Filtrado por rango de fechas
        if (fechaDesde && item.Fecha && item.Fecha < fechaDesde) return false;
        if (fechaHasta && item.Fecha && item.Fecha > fechaHasta) return false;
        
        if (status && item.ESTATUS !== status) return false;
        return true;
    });
 
    // Más recientes primero (los locales recién guardados quedan arriba)
    filtrados.sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));
 
    if(filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">No hay controles registrados.</td></tr>`;
        return;
    }
 
    filtrados.forEach(item => {
        const tr = document.createElement('tr');
        const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(item))));
        const etiquetaPendiente = item._pendienteSync
            ? `<br><span class="badge-pendiente" title="Todavía no se sincronizó con el servidor"><i class="fas fa-clock"></i> Pendiente de sincronizar</span>`
            : '';
 
        const listaProductos = (Array.isArray(item.Productos) && item.Productos.length > 0)
            ? item.Productos.map(p => p.producto || '-').join('<br>')
            : '-';
 
        const listaContratos = (Array.isArray(item.Contratos) && item.Contratos.length > 0)
            ? item.Contratos.map(c => c.contrato_com || '-').join('<br>')
            : '-';
 
        const numRegistroMovil = item.Id_Carga ? `<span class="reg-num-movil">#${item.Id_Carga}</span>` : '';
        tr.innerHTML = `
            <td data-label="Fecha" onclick="abrirDetalleCargaDesdeTabla('${dataString}')" class="celda-clickeable td-fecha">${item.Fecha || '-'}${numRegistroMovil}</td>
            <td data-label="Producto" onclick="abrirDetalleCargaDesdeTabla('${dataString}')" class="celda-clickeable"><b>${listaProductos}</b>${etiquetaPendiente}</td>
            <td data-label="Contrato" onclick="abrirDetalleCargaDesdeTabla('${dataString}')" class="celda-clickeable">${listaContratos}</td>
            <td data-label="Estado" onclick="abrirDetalleCargaDesdeTabla('${dataString}')" class="celda-clickeable td-estado"><span class="badge ${item.ESTATUS ? item.ESTATUS.toLowerCase() : 'aceptado'}">${item.ESTATUS || 'ACEPTADO'}</span></td>
            <td data-label="Peso" onclick="abrirDetalleCargaDesdeTabla('${dataString}')" class="celda-clickeable">${item.Kg_Cargados || '0'} kg</td>
            <td class="td-acciones" onclick="event.stopPropagation();">
                <button class="btn-table-action" onclick="cargarRegistroParaEditar('${dataString}')" title="Editar registro">
                    <i class="fas fa-pen" style="color:#ef6c00; font-size: 1.1rem; cursor:pointer;"></i>
                </button>
                <button class="btn-table-action" onclick="eliminarRegistro('${dataString}')" title="Eliminar registro">
                    <i class="fas fa-trash" style="color:#c62828; font-size: 1.1rem; cursor:pointer;"></i>
                </button>
                <button class="btn-table-action" onclick="generarPDFReporte('${dataString}')" title="Descargar PDF">
                    <i class="fas fa-file-pdf" style="color:#b71c1c; font-size: 1.2rem; cursor:pointer;"></i>
                </button>
                ${esDispositivoMovil() ? `
                <button class="btn-table-action" onclick="generarPDFReporte('${dataString}', 'compartir')" title="Compartir PDF (WhatsApp, correo...)">
                    <i class="fas fa-share-alt" style="color:#1967d2; font-size: 1.1rem; cursor:pointer;"></i>
                </button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 9-B. EDITAR UN REGISTRO EXISTENTE (carga los datos en el formulario) ---
function cargarRegistroParaEditar(base64Data) {
    try {
        const rawJson = decodeURIComponent(escape(atob(base64Data)));
        const item = JSON.parse(rawJson);

        // Nos aseguramos de estar parados en el módulo/tipo correcto y con el form limpio
        tipoCargaActual = item.Tipo_Carga || tipoCargaActual;
        document.getElementById('lbl-tipo-carga-actual').textContent = tipoCargaActual;
        switchTab('nuevo');
        cambiarVista('view-modulo-carga');

        // --- Datos generales ---
        document.getElementById("fecha").value = item.Fecha || "";
        document.getElementById("chofer").value = item.Nombre_Chofer || "";
        document.getElementById("patente-chasis").value = item.Patente_Chasis || "";
        document.getElementById("patente-acoplado").value = item.Patente_Acoplado || "";
        poblarSelect(document.getElementById("elaboro"), "elaboro", item.Elaboro || "");
        document.getElementById("indicaciones").value = item.Indicaciones_Descarga || "";
        document.getElementById("kg-cargados").value = item.Kg_Cargados || 0;
        document.getElementById("correo-envio").value = item.Correo || "";
        document.getElementById("estado-correo").value = item.Estado_Correo || "Sin enviar";

        // --- Productos dinámicos ---
        let productos = item.Productos || [];
        if (typeof productos === 'string') { try { productos = JSON.parse(productos); } catch (e) { productos = []; } }
        if (!Array.isArray(productos) || productos.length === 0) productos = [{}];

        const wrapperProd = document.getElementById('wrapper-productos-dinamicos');
        wrapperProd.innerHTML = "";
        productos.forEach(() => agregarFilaProducto());
        document.querySelectorAll('#wrapper-productos-dinamicos .dynamic-item-card').forEach((card, i) => {
            const p = productos[i] || {};
            card.querySelectorAll('.prod-item').forEach(input => {
                const valorGuardado = p[input.dataset.field] || '';
                if (input.tagName === 'SELECT') {
                    poblarSelect(input, input.dataset.enum, valorGuardado);
                } else {
                    input.value = valorGuardado;
                }
            });
            // Disparamos el recálculo del Total Kg con los valores ya cargados
            const evt = new Event('input');
            const inputCantidad = card.querySelector('.campo-cantidad');
            if (inputCantidad) inputCantidad.dispatchEvent(evt);
        });

        // --- Contratos dinámicos ---
        let contratos = item.Contratos || [];
        if (typeof contratos === 'string') { try { contratos = JSON.parse(contratos); } catch (e) { contratos = []; } }
        if (!Array.isArray(contratos) || contratos.length === 0) contratos = [{}];

        const wrapperCont = document.getElementById('wrapper-contratos-dinamicos');
        wrapperCont.innerHTML = "";
        contratos.forEach(() => agregarFilaContrato());
        document.querySelectorAll('#wrapper-contratos-dinamicos .dynamic-item-card').forEach((card, i) => {
            const c = contratos[i] || {};
            card.querySelectorAll('.cont-item').forEach(input => {
                const valorGuardado = c[input.dataset.field] || '';
                if (input.tagName === 'SELECT') {
                    poblarSelect(input, input.dataset.enum, valorGuardado);
                } else {
                    input.value = valorGuardado;
                }
            });
            // Vista previa del archivo de la Carta de Porte, si había uno cargado
            const previewArchivo = card.querySelector('.archivo-preview');
            if (previewArchivo) {
                previewArchivo.textContent = (c.archivo_cp && c.archivo_cp.length > 100) ? "📎 Archivo cargado" : "Sin archivo";
            }
            // Disparamos el recálculo de Diferencia de Carga con los valores ya cargados
            const evt = new Event('input');
            const inputKgCP = card.querySelector('.campo-kgcp');
            if (inputKgCP) inputKgCP.dispatchEvent(evt);
        });

        // --- Checklist y estatus ---
        setRadioValue('aplica_etiqueta', item.Aplica_Etiqueta);
        setRadioValue('lona_protege', item.Lona_Protege);
        setRadioValue('piso_suciedad', item.Piso_Libre_Suciedad);
        setRadioValue('libre_oxido', item.Libre_Oxido);
        setRadioValue('secos_insectos', item.Chasis_Secos_Insectos);
        setRadioValue('exentos_hongos', item.Exentos_Hongos);
        setRadioValue('aislante_piso', item.Aislante_Piso);
        setRadioValue('estatus', item.ESTATUS);

        // --- Fotos: restauramos las previsualizaciones y el objeto fotosBase64 ---
        const mapaFotos = {
            Foto_Frente: "p-frente", Foto_Culo: "p-culo",
            Foto_Interior_Chasis: "p-int-chasis", Foto_Interior_Acoplado: "p-int-acop",
            Foto_Proceso_Carga: "p-proceso", Foto_Etiqueta_Bolsa: "p-etiqueta",
            Foto_Camion_Cargado: "p-cargado", Foto_Ticket_Balanza: "p-balanza"
        };
        Object.keys(mapaFotos).forEach(key => {
            const valor = item[key] || "";
            fotosBase64[key] = valor;
            const previewEl = document.getElementById(mapaFotos[key]);
            if (previewEl) {
                previewEl.innerHTML = valor
                    ? `<img src="${valor}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
                    : "📸 Sin foto";
            }
        });

        // --- Firmas: las redibujamos en el canvas para que se vean, no se pueden "reeditar" salvo que se vuelvan a firmar ---
        setTimeout(() => {
            initCanvasFirma("canvas-firma-chofer");
            initCanvasFirma("canvas-firma-control");
            restaurarFirmaEnCanvas("canvas-firma-chofer", item.Firma_Chofer);
            restaurarFirmaEnCanvas("canvas-firma-control", item.Firma_Control);
        }, 200);

        // --- Activar modo edición ---
        idRegistroEnEdicion = item.Id_Carga;
        document.getElementById('btn-guardar-control').textContent = "Guardar Cambios";
        document.getElementById('btn-cancelar-edicion').classList.remove('hidden');

        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
        console.error("Error al cargar el registro para editar:", error);
        alert("No se pudo cargar este registro para editarlo.");
    }
}

function setRadioValue(name, valor) {
    const input = document.querySelector(`input[name="${name}"][value="${valor}"]`);
    if (input) input.checked = true;
}

function restaurarFirmaEnCanvas(canvasId, dataUrl) {
    if (!dataUrl || dataUrl.length < 100) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
}

function cancelarEdicion() {
    idRegistroEnEdicion = null;
    document.getElementById('btn-guardar-control').textContent = "Guardar Control Completo";
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
    abrirModuloCarga(tipoCargaActual);
}

// --- 9-C. ELIMINAR UN REGISTRO ---
function eliminarRegistro(base64Data) {
    try {
        const rawJson = decodeURIComponent(escape(atob(base64Data)));
        const item = JSON.parse(rawJson);

        const confirmado = confirm(`¿Seguro que querés eliminar el control de "${item.Nombre_Chofer || 'este registro'}" (${item.Fecha || ''})? Esta acción no se puede deshacer.`);
        if (!confirmado) return;

        // 1) Si todavía está en la cola offline (IndexedDB), lo borramos ahí
        if (db) {
            const tx = db.transaction(["controles_carga"], "readwrite");
            const store = tx.objectStore("controles_carga");
            store.openCursor().onsuccess = function(e) {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.Id_Carga === item.Id_Carga) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
        }

        // 2) Lo sacamos de la vista/tabla en memoria (viene de Google Sheets)
        historialGeneral = historialGeneral.filter(r => r.Id_Carga !== item.Id_Carga);
        filtrarYRenderizarTabla();
        renderOfflineCount();

        // 3) Intentamos avisarle al backend de Google Apps Script (requiere que el
        //    script esté preparado para atender action=delete; si no lo está,
        //    el registro se borra acá pero puede seguir existiendo en la Hoja).
        if (navigator.onLine && !WEB_APP_URL.includes("AQUÍ_VA")) {
            fetch(WEB_APP_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _accion: "eliminar", Id_Carga: item.Id_Carga })
            }).catch(err => console.error("No se pudo notificar el borrado al servidor:", err));
        }

    } catch (error) {
        console.error("Error al eliminar el registro:", error);
        alert("No se pudo eliminar este registro.");
    }
}

// Detecta celular/tablet (usado para mostrar el botón de compartir solo en mobile)
function esDispositivoMovil() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
}

// Comparte el PDF con el menú nativo del celular (Web Share API).
// Fallback: abre WhatsApp con un resumen del registro y descarga el PDF como respaldo.
async function compartirPDF(doc, nombreArchivo, item) {
    const blob = doc.output('blob');
    const archivo = new File([blob], nombreArchivo, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try {
            await navigator.share({
                files: [archivo],
                title: 'Reporte de Carga - Braun',
                text: `Reporte de carga del ${item.Fecha || '-'} (${item.Kg_Cargados || '0'} kg)`
            });
            return;
        } catch (e) {
            // Si el usuario canceló el menú de compartir, no hacemos nada más
            if (e && e.name === 'AbortError') return;
            console.warn('navigator.share falló, usando fallback WhatsApp:', e);
        }
    }

    // Fallback: texto informativo por WhatsApp + descarga del PDF como respaldo
    const productos = (Array.isArray(item.Productos) ? item.Productos : [])
        .map(p => p.producto).filter(Boolean).join(', ') || '-';
    const texto = `*Reporte de Carga - Braun*\n`
        + `Fecha: ${item.Fecha || '-'}\n`
        + `Producto/s: ${productos}\n`
        + `Total Kg: ${item.Kg_Cargados || '0'}\n`
        + `Estado: ${item.ESTATUS || 'ACEPTADO'}\n`
        + `Chofer: ${item.Nombre_Chofer || '-'}\n\n`
        + `(El PDF se descargó en el dispositivo para adjuntarlo manualmente)`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, '_blank');
    doc.save(nombreArchivo);
}

// --- === 10. GENERADOR DE REPORTE PDF CORPORATIVO (fiel al modelo de referencia) === ---
// modo: 'descargar' (default, comportamiento original) | 'compartir' (Web Share API en celulares)
async function generarPDFReporte(base64Data, modo) {
    try {
        const rawJson = decodeURIComponent(escape(atob(base64Data)));
        const item = JSON.parse(rawJson);
const camposImagen = [
    "Firma_Chofer", "Firma_Control",
    "Foto_Frente", "Foto_Culo", "Foto_Interior_Chasis", "Foto_Interior_Acoplado",
    "Foto_Proceso_Carga", "Foto_Etiqueta_Bolsa", "Foto_Camion_Cargado", "Foto_Ticket_Balanza"
];
for (const campo of camposImagen) {
    item[campo] = await obtenerImagenComoBase64(item[campo]);
}
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

        const rojoBraun = [183, 28, 28];
        const grisTexto = [40, 40, 40];
        const anchoPagina = 210;
        const margenX = 14;
        const anchoContenido = 182; // 196 - 14

        // --- ENCABEZADO: banner rojo "Control de Transporte" + logo Braun (igual al modelo) ---
        doc.setFillColor(...rojoBraun);
        doc.rect(0, 0, anchoPagina, 32, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(19);
        doc.text("Control de Transporte", margenX, 20);

        try {
            doc.addImage(LOGO_BRAUN_BLANCO, "PNG", 150, 4.5, 44, 23.6);
        } catch (logoErr) {
            console.error("No se pudo insertar el logo:", logoErr);
        }

        // --- Fecha y Total Kg (como en el modelo, sin cajas) ---
        let yCurrent = 44;
        doc.setTextColor(...grisTexto);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Fecha:", margenX, yCurrent);
        doc.setFont("helvetica", "normal");
        doc.text(`${item.Fecha || '-'}`, margenX + 16, yCurrent);

        doc.setFont("helvetica", "bold");
        doc.text("Total Kg:", 150, yCurrent);
        doc.setFont("helvetica", "normal");
        doc.text(`${item.Kg_Cargados || '0'}`, 172, yCurrent);

        // --- Datos de la Carga (tabla de productos) ---
        yCurrent += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Datos de la Carga:", margenX, yCurrent);
        yCurrent += 3;

        let productos = item.Productos || [];
        if (typeof productos === 'string') {
            try { productos = JSON.parse(productos); } catch (parseErr) { productos = []; }
        }
        if (!Array.isArray(productos)) productos = [];

        const columnasProductos = [
            { header: "Producto", width: 28 },
            { header: "Calibre", width: 16 },
            { header: "Tipo", width: 12 },
            { header: "N° de Lote", width: 20 },
            { header: "Posición en Planta", width: 24 },
            { header: "Tipo de envases", width: 22 },
            { header: "Cant. de Envases", width: 20 },
            { header: "Kg del Envase", width: 20 },
            { header: "Total Kg", width: 20 }
        ];
        const filasProductos = productos.length > 0
            ? productos.map(p => [p.producto, p.calibre, p.tipo || item.Tipo_Carga || 'PT', p.lote, p.posicion, p.envase, p.cantidad, p.kg_envase, p.total_kg])
            : [["Sin ítems cargados", "", "", "", "", "", "", "", ""]];

        yCurrent = dibujarTablaConBordes(doc, margenX, yCurrent, anchoContenido, columnasProductos, filasProductos, { fontSize: 6.8, alturaFila: 7 });

        // --- Nombre y Apellido del chofer / Patentes ---
        yCurrent += 6;
        const columnasChofer = [
            { header: "Nombre y Apellido del chofer", width: 80 },
            { header: "Patente Chasis", width: 51 },
            { header: "Patente Acoplado", width: 51 }
        ];
        yCurrent = dibujarTablaConBordes(doc, margenX, yCurrent, anchoContenido, columnasChofer,
            [[item.Nombre_Chofer, item.Patente_Chasis, item.Patente_Acoplado]], { fontSize: 8, alturaFila: 7 });

        // --- Contrato Comercial ---
        yCurrent += 6;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Contrato Comercial", margenX, yCurrent);
        yCurrent += 3;

        let contratos = item.Contratos || [];
        if (typeof contratos === 'string') {
            try { contratos = JSON.parse(contratos); } catch (parseErr) { contratos = []; }
        }
        if (!Array.isArray(contratos)) contratos = [];

        const columnasContrato = [
            { header: "Contrato Comercial", width: 28 },
            { header: "Contrato Cliente", width: 26 },
            { header: "Carta de Porte", width: 24 },
            { header: "Archivo CP", width: 16 },
            { header: "Destino de Mercadería", width: 32 },
            { header: "Kg CP", width: 18 },
            { header: "Kg Descarga", width: 18 },
            { header: "Diferencia", width: 20 }
        ];
        const filasContrato = contratos.length > 0
            ? contratos.map(c => [
                c.contrato_com, c.contrato_cli, c.carta_porte,
                (c.archivo_cp && c.archivo_cp.length > 100) ? "Sí" : "No",
                c.destino, c.kg_cp, c.kg_descarga, c.diferencia_carga
            ])
            : [["Sin contratos asociados", "", "", "", "", "", "", ""]];

        yCurrent = dibujarTablaConBordes(doc, margenX, yCurrent, anchoContenido, columnasContrato, filasContrato, { fontSize: 6.8, alturaFila: 7 });

        // --- Checklist operativo (tabla de 2 columnas, igual al modelo) ---
        yCurrent += 6;
        const columnasDoble = [
            { header: "", width: 140 },
            { header: "", width: 42 }
        ];
        const filasChecklist = [
            ["¿Aplica etiqueta?", item.Aplica_Etiqueta || 'SI'],
            ["Lona cubre y protege la carga", item.Lona_Protege || 'SI'],
            ["Piso chasis / acoplado libre de suciedad y otros granos", item.Piso_Libre_Suciedad || 'SI'],
            ["Piso y paredes chasis / acoplado libre de óxido", item.Libre_Oxido || 'SI'],
            ["Chasis y acoplados secos y exentos de insectos", item.Chasis_Secos_Insectos || 'SI'],
            ["Chasis y acoplados exentos de proliferación de hongos", item.Exentos_Hongos || 'SI'],
            ["Se instaló aislante en el piso para proteger la carga", item.Aislante_Piso || 'SI']
        ];
        yCurrent = dibujarTablaConBordes(doc, margenX, yCurrent, anchoContenido, columnasDoble, filasChecklist, { fontSize: 7.8, alturaFila: 7, conHeader: false });

        // --- Estado e Indicaciones de descarga ---
        const filasEstado = [
            ["Estado", item.ESTATUS || 'ACEPTADO'],
            ["Indicaciones para la Descarga", item.Indicaciones_Descarga || '-']
        ];
        yCurrent = dibujarTablaConBordes(doc, margenX, yCurrent, anchoContenido, columnasDoble, filasEstado, { fontSize: 7.8, alturaFila: 7, conHeader: false });

        // --- Firmas (izquierda: quien elaboró el control; derecha: chofer, igual al modelo) ---
        yCurrent += 16;
        if (yCurrent > 250) { doc.addPage(); yCurrent = 20; }

        const altoFirma = 20;
        try {
            if (item.Firma_Control && item.Firma_Control.length > 100) {
                doc.addImage(item.Firma_Control, "PNG", 30, yCurrent - altoFirma, 55, altoFirma);
            }
        } catch (firmaErr) { console.error("Firma de control inválida:", firmaErr); }
        try {
            if (item.Firma_Chofer && item.Firma_Chofer.length > 100) {
                doc.addImage(item.Firma_Chofer, "PNG", 125, yCurrent - altoFirma, 55, altoFirma);
            }
        } catch (firmaErr) { console.error("Firma del chofer inválida:", firmaErr); }

        yCurrent += 6;
        doc.setTextColor(...grisTexto);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(item.Elaboro || '-', 57, yCurrent, { align: "center" });
        doc.text(item.Nombre_Chofer || '-', 152, yCurrent, { align: "center" });

        // --- Páginas de registro fotográfico (grilla 2x2, igual estética al modelo) ---
        agregarPaginaFotos(doc, "REGISTRO FOTOGRÁFICO - VEHÍCULO VACÍO", rojoBraun, item.Id_Carga, [
            { titulo: "Frente del Camión", img: item.Foto_Frente },
            { titulo: "Culo del camión", img: item.Foto_Culo },
            { titulo: "Interior del camión vacío (Chasis)", img: item.Foto_Interior_Chasis },
            { titulo: "Interior del camión vacío (Acoplado)", img: item.Foto_Interior_Acoplado }
        ]);

        agregarPaginaFotos(doc, "REGISTRO FOTOGRÁFICO - CARGA Y DOCUMENTACIÓN", rojoBraun, item.Id_Carga, [
            { titulo: "Proceso de Carga", img: item.Foto_Proceso_Carga },
            { titulo: "Etiqueta o Bolsa", img: item.Foto_Etiqueta_Bolsa },
            { titulo: "Camión Cargado", img: item.Foto_Camion_Cargado },
            { titulo: "Ticket Balanza", img: item.Foto_Ticket_Balanza }
        ]);
        const totalPaginas = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPaginas; p++) {
            doc.setPage(p);
            agregarPiePagina(doc);
        }
 
        const nombreArchivo = `Reporte_Carga_PT_${item.Id_Carga || 'Braun'}.pdf`;
        if (modo === 'compartir') {
            await compartirPDF(doc, nombreArchivo, item);
        } else {
            // Comportamiento original: descarga directa (escritorio)
            doc.save(nombreArchivo);
        }

    } catch (error) {
        console.error("Error al construir PDF:", error);
        alert("Ocurrió un inconveniente al generar el PDF de este registro.");
    }
}

// --- 10-A. HELPER: dibuja una tabla simple con bordes reales (como el modelo de referencia) ---
function dibujarTablaConBordes(doc, x, y, anchoTotal, columnas, filas, opciones = {}) {
    const alturaFilaDatos = opciones.alturaFila || 7;
    const fontSize = opciones.fontSize || 8;
    const colorHeaderFill = opciones.colorHeaderFill || [183, 28, 28];
    const colorHeaderTexto = opciones.colorHeaderTexto || [255, 255, 255];
    const conHeader = opciones.conHeader !== false;

    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(0.15);

    let yPos = y;

    if (conHeader) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(fontSize);

        const lineasPorColumna = columnas.map(col => {
            if (!col.header) return [""];
            return doc.splitTextToSize(col.header, col.width - 3);
        });
        const maxLineas = Math.max(...lineasPorColumna.map(l => l.length));
        const lineHeight = fontSize * 0.42;
        const alturaHeader = Math.max(alturaFilaDatos, maxLineas * lineHeight + 2.5);

        let colX = x;
        columnas.forEach((col, i) => {
            doc.setFillColor(...colorHeaderFill);
            doc.rect(colX, yPos, col.width, alturaHeader, "FD");
            doc.setTextColor(...colorHeaderTexto);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(fontSize);
            const lineas = lineasPorColumna[i];
            const offsetY = (alturaHeader - (lineas.length * lineHeight)) / 2 + lineHeight;
            lineas.forEach((linea, li) => {
                doc.text(linea, colX + col.width / 2, yPos + offsetY + (li * lineHeight), { align: "center" });
            });
            colX += col.width;
        });
        yPos += alturaHeader;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(50, 50, 50);
    filas.forEach((fila, filaIdx) => {
        let colX = x;
        if (filaIdx % 2 === 1) {
            doc.setFillColor(248, 248, 248);
            doc.rect(x, yPos, anchoTotal, alturaFilaDatos, "F");
        }
        doc.setTextColor(50, 50, 50);
        columnas.forEach((col, i) => {
            const valorCrudo = fila[i];
            const texto = (valorCrudo === undefined || valorCrudo === null || valorCrudo === '') ? '-' : String(valorCrudo);
            doc.rect(colX, yPos, col.width, alturaFilaDatos);
            doc.text(texto, colX + 1.5, yPos + alturaFilaDatos / 2 + 1.2, { maxWidth: col.width - 3 });
            colX += col.width;
        });
        yPos += alturaFilaDatos;
    });

    return yPos;
}
// Agregar esta función nueva en cualquier parte de app.js
// (pie de página con línea roja + texto institucional)

// ============================================================
// FUNCIONES PARA VISTA DE DETALLES DE CARGA (SOLO LECTURA)
// ============================================================

let registroDetalleActual = null; // Almacena el registro actual en vista de detalles

function abrirDetalleCargaDesdeTabla(dataString) {
    try {
        const registroJSON = decodeURIComponent(escape(atob(dataString)));
        const registro = JSON.parse(registroJSON);
        abrirDetalleCarga(registro);
    } catch (e) {
        console.error("Error al decodificar registro:", e);
        alert("Error al abrir los detalles del registro");
    }
}

function abrirDetalleCarga(registro) {
    if (!registro) return;
    
    registroDetalleActual = registro;
    
    // Llenar información general
    document.getElementById('det-fecha').textContent = registro.Fecha || '-';
    document.getElementById('det-tipo').textContent = registro.Tipo_Carga || '-';
    document.getElementById('det-estado').innerHTML = `<span class="badge ${registro.ESTATUS ? registro.ESTATUS.toLowerCase() : 'aceptado'}">${registro.ESTATUS || 'ACEPTADO'}</span>`;
    document.getElementById('det-kg').textContent = (registro.Kg_Cargados || '0') + ' kg';
    
    // Llenar productos
    const detProductos = document.getElementById('det-productos');
    if (Array.isArray(registro.Productos) && registro.Productos.length > 0) {
        detProductos.innerHTML = registro.Productos.map((p, i) => `
            <div class="detalle-item-lista">
                <strong>${p.producto || '-'}</strong>
                <div class="detalle-item-sublista">
                    Calibre: ${p.calibre || '-'} | Envase: ${p.envase || '-'} | Cantidad: ${p.cantidad || '-'}
                </div>
            </div>
        `).join('');
    }
    
    // Llenar datos del chofer
    document.getElementById('det-chofer').textContent = registro.Nombre_Chofer || '-';
    document.getElementById('det-chasis').textContent = registro.Patente_Chasis || '-';
    document.getElementById('det-acoplado').textContent = registro.Patente_Acoplado || '-';
    
    // Llenar contratos
    const detContratos = document.getElementById('det-contratos');
    if (Array.isArray(registro.Contratos) && registro.Contratos.length > 0) {
        detContratos.innerHTML = registro.Contratos.map((c, i) => `
            <div class="detalle-item-lista">
                <strong>${c.contrato_com || '-'}</strong>
            </div>
        `).join('');
    }
    
    // Llenar verificaciones COMPLETAS
    const detVerificaciones = document.getElementById('det-verificaciones');
    const verificaciones = [
        { label: '¿Aplica etiqueta?', valor: registro.Aplica_Etiqueta },
        { label: 'Lona cubre y protege', valor: registro.Lona_Protege },
        { label: 'Piso libre de suciedad', valor: registro.Piso_Suciedad },
        { label: 'Libre de óxido', valor: registro.Libre_Oxido },
        { label: 'Secos y sin insectos', valor: registro.Secos_Insectos },
        { label: 'Exento de hongos', valor: registro.Exentos_Hongos },
        { label: 'Aislante en piso', valor: registro.Aislante_Piso }
    ];
    
    const verificacionesValidas = verificaciones.filter(v => v.valor !== undefined && v.valor !== '');
    if (verificacionesValidas.length > 0) {
        detVerificaciones.innerHTML = verificacionesValidas.map(v => `
            <div class="detalle-verificacion">
                <span>${v.label}</span>
                <span class="valor">${v.valor === 'SI' ? '✓ Sí' : v.valor === 'NO' ? '✕ No' : v.valor}</span>
            </div>
        `).join('');
    }
    
    // Llenar fotos
    const detFotos = document.getElementById('det-fotos');
    const fotos = [
        { nombre: '1. Frente', campo: 'Foto_Frente' },
        { nombre: '2. Culo', campo: 'Foto_Culo' },
        { nombre: '3. Int. Chasis', campo: 'Foto_Interior_Chasis' },
        { nombre: '4. Int. Acoplado', campo: 'Foto_Interior_Acoplado' },
        { nombre: '5. Proceso Carga', campo: 'Foto_Proceso_Carga' },
        { nombre: '6. Etiqueta Bolsa', campo: 'Foto_Etiqueta_Bolsa' },
        { nombre: '7. Camión Cargado', campo: 'Foto_Camion_Cargado' },
        { nombre: '8. Ticket Balanza', campo: 'Foto_Ticket_Balanza' }
    ];
    
    const fotosValidas = fotos.filter(f => registro[f.campo]);
    if (fotosValidas.length > 0) {
        detFotos.innerHTML = fotosValidas.map(f => `
            <div class="detalle-foto-box">
                <img src="${registro[f.campo]}" alt="${f.nombre}" class="detalle-foto-img">
                <div class="detalle-foto-label">${f.nombre}</div>
            </div>
        `).join('');
    } else {
        detFotos.innerHTML = '<p style="color: #999;">No hay fotos registradas</p>';
    }
    
    // Mostrar la vista de detalles
    cambiarVista('view-detalle-carga');
}

function cerrarDetalleCarga() {
    registroDetalleActual = null;
    cambiarVista('view-modulo-carga');
}

function abrirEdicionDesdeDetalle() {
    if (registroDetalleActual) {
        const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(registroDetalleActual))));
        cargarRegistroParaEditar(dataString);
    }
}

function generarPDFDesdeDetalle() {
    if (registroDetalleActual) {
        const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(registroDetalleActual))));
        generarPDFReporte(dataString);
    }
}

function eliminarDesdeDetalle() {
    if (registroDetalleActual) {
        if (confirm('¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer.')) {
            const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(registroDetalleActual))));
            eliminarRegistro(dataString);
            cerrarDetalleCarga();
        }
    }
}
// --------------------------------------------------------
function agregarPiePagina(doc) {
    const altoPagina = 297;
    const yLinea = altoPagina - 14;
    const margenX = 14;
    const anchoContenido = 182; // 196 - 14
 
    doc.setDrawColor(183, 28, 28);
    doc.setLineWidth(0.8);
    doc.line(margenX, yLinea, margenX + anchoContenido, yLinea);
 
    doc.setTextColor(183, 28, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
 
    // Dividimos el ancho disponible en 3 tercios iguales y centramos cada palabra en el suyo
    const anchoTercio = anchoContenido / 3;
    const centro1 = margenX + anchoTercio * 0.5;
    const centro2 = margenX + anchoTercio * 1.5;
    const centro3 = margenX + anchoTercio * 2.5;
 
    doc.text("EXPORTADORES", centro1, yLinea - 3, { align: "center" });
    doc.text("PRODUCTORES", centro2, yLinea - 3, { align: "center" });
    doc.text("PROCESADORES", centro3, yLinea - 3, { align: "center" });
}
 
// --- 10-B. HELPERS DEL REGISTRO FOTOGRÁFICO DEL PDF ---
function agregarPaginaFotos(doc, tituloPagina, colorBanner, idCarga, fotos) {
    doc.addPage();

    // Banner superior de la página de fotos
    doc.setFillColor(...colorBanner);
    doc.rect(0, 0, 210, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(tituloPagina, 14, 11.5);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`ID Carga: ${idCarga || '-'}`, 196, 11.5, { align: "right" });

    // Grilla 2x2: 2 columnas x 2 filas
    const margenX = 14;
    const anchoTotal = 182; // 196 - 14
    const gapCol = 8;
    const colWidth = (anchoTotal - gapCol) / 2;
    const barraTitulo = 8;
    const filaAltura = 118;
    const gapFila = 10;

    const posiciones = [
        { x: margenX, y: 26 },
        { x: margenX + colWidth + gapCol, y: 26 },
        { x: margenX, y: 26 + filaAltura + gapFila },
        { x: margenX + colWidth + gapCol, y: 26 + filaAltura + gapFila }
    ];

    fotos.forEach((foto, i) => {
        dibujarFotoCard(doc, posiciones[i].x, posiciones[i].y, colWidth, filaAltura, barraTitulo, foto.titulo, foto.img);
    });
}

function dibujarFotoCard(doc, x, y, w, h, altoBarra, titulo, base64Img) {
    // Barra de título oscura (igual estética al reporte de referencia)
    doc.setFillColor(58, 47, 40);
    doc.rect(x, y, w, altoBarra, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(titulo, x + w / 2, y + altoBarra / 2 + 1.5, { align: "center" });

    // Marco del cuerpo de la foto
    const bodyY = y + altoBarra;
    const bodyH = h - altoBarra;
    doc.setDrawColor(200, 200, 200);
    doc.rect(x, bodyY, w, bodyH);

    const tieneFoto = base64Img && typeof base64Img === 'string' && base64Img.length > 100;

    if (tieneFoto) {
        try {
            const imgProps = doc.getImageProperties(base64Img);
            const ratio = imgProps.width / imgProps.height;
            let drawW = w - 4;
            let drawH = drawW / ratio;
            if (drawH > bodyH - 4) {
                drawH = bodyH - 4;
                drawW = drawH * ratio;
            }
            const offsetX = x + (w - drawW) / 2;
            const offsetY = bodyY + (bodyH - drawH) / 2;
            doc.addImage(base64Img, "JPEG", offsetX, offsetY, drawW, drawH);
        } catch (imgErr) {
            console.error(`No se pudo insertar la foto "${titulo}":`, imgErr);
            dibujarSinFoto(doc, x, bodyY, w, bodyH, "Imagen dañada o no disponible");
        }
    } else {
        dibujarSinFoto(doc, x, bodyY, w, bodyH, "Sin foto cargada");
    }
}

function dibujarSinFoto(doc, x, y, w, h, mensaje) {
    doc.setTextColor(160, 160, 160);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(mensaje, x + w / 2, y + h / 2, { align: "center" });
}
async function obtenerImagenComoBase64(urlOBase64) {
    if (!urlOBase64 || typeof urlOBase64 !== 'string') return "";
    if (urlOBase64.indexOf("data:") === 0) return urlOBase64;
    if (urlOBase64.indexOf("http") !== 0) return "";

    try {
        const respuesta = await fetch(urlOBase64);
        const blob = await respuesta.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.error("No se pudo descargar/convertir la imagen para el PDF:", urlOBase64, err);
        return "";
    }
}
// --- 11. SINCRONIZACIÓN DE COLA OFFLINE ---
function renderOfflineCount() {
    if (!db) return;
    const store = db.transaction(["controles_carga"], "readonly").objectStore("controles_carga");
    const req = store.count();
    req.onsuccess = function() {
        const div = document.getElementById("offline-records");
        const list = document.getElementById("records-list");
        if(!div || !list) return;
        if (req.result > 0) {
            div.classList.remove("hidden");
            list.innerHTML = `<li>Tienes <b>${req.result}</b> reporte(s) en cola esperando señal.</li>`;
        } else { div.classList.add("hidden"); }
    };
}

function sincronizarDatosPendientes() {
    if (!db || !navigator.onLine) return;
    const tx = db.transaction(["controles_carga"], "readwrite");
    const store = tx.objectStore("controles_carga");
    
    store.openCursor().onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            const idKey = item.id;
            fetch(WEB_APP_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(item)
            })
            .then(() => {
                const delTx = db.transaction(["controles_carga"], "readwrite");
                delTx.objectStore("controles_carga").delete(idKey).onsuccess = function() {
                    renderOfflineCount();
                    sincronizarDatosPendientes();
                };
            });
        }
    };
}

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('usuarioBraun')) {
        cambiarVista('view-menu-principal');
    } else {
        cambiarVista('view-login');
    }
    
    document.getElementById("fecha").valueAsDate = new Date();
    
    configurarFoto("f-frente", "p-frente", "Foto_Frente");
    configurarFoto("f-culo", "p-culo", "Foto_Culo");
    configurarFoto("f-int-chasis", "p-int-chasis", "Foto_Interior_Chasis");
    configurarFoto("f-int-acop", "p-int-acop", "Foto_Interior_Acoplado");
    configurarFoto("f-proceso", "p-proceso", "Foto_Proceso_Carga");
    configurarFoto("f-etiqueta", "p-etiqueta", "Foto_Etiqueta_Bolsa");
    configurarFoto("f-cargado", "p-cargado", "Foto_Camion_Cargado");
    configurarFoto("f-balanza", "p-balanza", "Foto_Ticket_Balanza");

    updateOnlineStatus();
});