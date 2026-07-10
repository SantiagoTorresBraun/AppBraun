// =========================================================================
// MÓDULO: CONTROL DE CALIDAD
// Arquitectura escalable por grano: para habilitar un grano nuevo alcanza con
// completar su entrada en CALIDAD_CONFIG (habilitado: true + calibres/defectos).
// Reutiliza la infraestructura global de app.js: db (IndexedDB), WEB_APP_URL,
// ENUMS/poblarSelect, cambiarVista y los estilos premium existentes.
// =========================================================================

// --- 1. CONFIGURACIÓN POR GRANO (modelo de datos del Google Sheet) ---
const CALIDAD_CONFIG = {
    GARBANZO: {
        habilitado: true,
        nombre: "Garbanzo",
        ruta: "garbanzo",
        // Columnas de calibre del Sheet (suman "Total Granos Buenos")
        calibres: ["10mm", "9mm", "8mm", "7mm", "Bajo zaranda"],
        // Columnas de defectos físicos del Sheet (suman "Total de Daños")
        defectos: [
            "Partidos", "Roidos", "Picados", "Moho", "Brotados", "Verdes",
            "Ardidos y Chuzos", "Lavados", "Blanqueados", "Sucios",
            "Manchados", "Tocados", "Pelados/Decorticados"
        ]
    },
    POROTO_MUNG: {
        habilitado: false, // Esqueleto listo: definir calibres/defectos y pasar a true
        nombre: "Poroto Mung",
        ruta: "poroto-mung",
        calibres: [],
        defectos: []
    }
};

// --- 2. ESTADO DEL MÓDULO ---
let granoActual = "GARBANZO";
let historialCalidad = [];          // registros ya sincronizados (vienen del Sheet)
let idCalidadEnEdicion = null;      // Id_Calidad en edición (null = registro nuevo)
const fotosCalidad = { "imagen 1": "", "imagen 2": "", "imagen 3": "", "imagen 4": "" };
let fotosCalidadEnProceso = 0;

function nombreGranoActual() {
    return (CALIDAD_CONFIG[granoActual] || {}).nombre || "";
}

// --- 3. RUTEO INTERNO (#/control-calidad/garbanzo) ---
function actualizarHashCalidad() {
    const cfg = CALIDAD_CONFIG[granoActual];
    if (cfg) history.replaceState(null, "", `#/control-calidad/${cfg.ruta}`);
}

function abrirCalidadDesdeHash() {
    const match = (location.hash || "").match(/^#\/control-calidad\/([a-z-]+)/);
    if (!match) return false;
    const granoKey = Object.keys(CALIDAD_CONFIG).find(k => CALIDAD_CONFIG[k].ruta === match[1]);
    if (granoKey && CALIDAD_CONFIG[granoKey].habilitado) {
        abrirModuloCalidad(granoKey);
        return true;
    }
    return false;
}

// --- 4. NAVEGACIÓN Y ARMADO DE PANTALLA ---
function abrirModuloCalidad(granoKey) {
    const cfg = CALIDAD_CONFIG[granoKey];
    if (!cfg) return;
    if (!cfg.habilitado) {
        alert(`El módulo de calidad de ${cfg.nombre} está en desarrollo. ¡Próximamente!`);
        return;
    }

    granoActual = granoKey;
    document.getElementById('lbl-grano-actual').textContent = cfg.nombre;
    document.getElementById('lbl-grano-form').textContent = cfg.nombre;

    resetFormularioCalidad();
    switchTabCalidad('historial');
    cambiarVista('view-modulo-calidad');
    actualizarHashCalidad();
    filtrarYRenderizarCalidad();
}

function switchTabCalidad(tabName) {
    const historial = document.getElementById('tab-content-historial-calidad');
    const nuevo = document.getElementById('tab-content-nuevo-calidad');
    if (tabName === 'nuevo') {
        historial.classList.add('hidden');
        nuevo.classList.remove('hidden');
    } else {
        nuevo.classList.add('hidden');
        historial.classList.remove('hidden');
        filtrarYRenderizarCalidad();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetFormularioCalidad() {
    const form = document.getElementById('form-calidad');
    if (!form) return;
    form.reset();
    document.getElementById('cal-fecha').valueAsDate = new Date();

    // Poblar selects de enums (Cliente, Muestreo, Tipo, Calibre, Envase)
    document.querySelectorAll('#form-calidad select.enum-select').forEach(sel => {
        poblarSelect(sel, sel.dataset.enum, '');
    });

    // Reconstruir inputs analíticos según el grano activo
    construirCamposAnaliticos();

    // Limpiar fotos
    Object.keys(fotosCalidad).forEach(k => fotosCalidad[k] = "");
    for (let i = 1; i <= 4; i++) {
        const prev = document.getElementById(`cal-p${i}`);
        if (prev) {
            prev.innerHTML = "📸 Sin foto";
            prev.style.backgroundImage = '';
            prev.onclick = null;
            const box = prev.closest('.photo-box'); if (box) box.classList.remove('has-photo');
        }
    }

    idCalidadEnEdicion = null;
    document.getElementById('btn-guardar-calidad').textContent = "Guardar Control de Calidad";
    document.getElementById('btn-cancelar-edicion-calidad').classList.add('hidden');
    recalcularTotalesCalidad();
}

function cancelarEdicionCalidad() {
    resetFormularioCalidad();
    switchTabCalidad('historial');
}

// Convierte un nombre de columna ("Ardidos y Chuzos") en un id de input seguro
function slugCampoCalidad(nombre) {
    return 'cal-var-' + nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// Genera los inputs de porcentaje para calibres y defectos según CALIDAD_CONFIG
function construirCamposAnaliticos() {
    const cfg = CALIDAD_CONFIG[granoActual];
    const armarGrupo = (wrapperId, campos, cssClase) => {
        const wrapper = document.getElementById(wrapperId);
        wrapper.innerHTML = "";
        campos.forEach(nombre => {
            const div = document.createElement('div');
            div.className = 'calidad-campo-pct';
            div.innerHTML = `
                <label for="${slugCampoCalidad(nombre)}">${nombre}</label>
                <div class="input-pct-wrap">
                    <input type="number" id="${slugCampoCalidad(nombre)}" class="${cssClase}"
                           data-campo="${nombre}" step="0.01" min="0" max="100" value="0" inputmode="decimal">
                    <span>%</span>
                </div>`;
            wrapper.appendChild(div);
        });
        wrapper.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recalcularTotalesCalidad));
    };
    armarGrupo('wrapper-calibres-calidad', cfg.calibres, 'input-calibre-cal');
    armarGrupo('wrapper-defectos-calidad', cfg.defectos, 'input-defecto-cal');
}

// --- 5. CAMPOS CALCULADOS (fórmulas del modelo AppSheet) ---
function leerSumaInputs(selector) {
    let suma = 0;
    document.querySelectorAll(selector).forEach(inp => { suma += parseFloat(inp.value) || 0; });
    return suma;
}

function recalcularTotalesCalidad() {
    const totalBuenos = leerSumaInputs('.input-calibre-cal');   // 10mm + 9mm + 8mm + 7mm + Bajo zaranda
    const totalDanios = leerSumaInputs('.input-defecto-cal');   // suma de defectos físicos
    const totalMuestra = totalBuenos + totalDanios;             // Total Muestra Cargada
    const kg = parseFloat(document.getElementById('cal-kg').value) || 0;
    // Total Muestra %: porcentaje analizado sobre 100 (control de que la muestra cierre)
    const totalMuestraPct = totalMuestra;

    document.getElementById('total-granos-buenos').textContent = totalBuenos.toFixed(2) + " %";
    document.getElementById('total-danios').textContent = totalDanios.toFixed(2) + " %";
    document.getElementById('total-muestra-cargada').textContent = totalMuestra.toFixed(2);
    const elPct = document.getElementById('total-muestra-pct');
    elPct.textContent = totalMuestraPct.toFixed(2) + " %";
    // Alerta visual si la muestra no cierra en 100%
    elPct.closest('.calidad-total-card').classList.toggle('descuadrada', Math.abs(totalMuestraPct - 100) > 0.5 && totalMuestraPct > 0);

    return { totalBuenos, totalDanios, totalMuestra, totalMuestraPct, kg };
}

// --- 6. FOTOS (compresión idéntica al módulo de carga) ---
function configurarFotoCalidad(inputId, previewId, keyName) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", function(e) {
        const file = e.target.files[0];
        if (!file) return;
        fotosCalidadEnProceso++;
        const previewDiv = document.getElementById(previewId);
        previewDiv.innerHTML = "⏳ Procesando...";

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                try {
                    const canvas = document.createElement("canvas");
                    const max_width = 600;
                    let width = img.width, height = img.height;
                    if (width > max_width) { height *= max_width / width; width = max_width; }
                    canvas.width = width; canvas.height = height;
                    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                    const compressed = canvas.toDataURL("image/jpeg", 0.5);
                    fotosCalidad[keyName] = compressed;
                    previewDiv.innerHTML = '';
                    previewDiv.style.backgroundImage = `url(${compressed})`;
                    previewDiv.style.backgroundSize = 'cover';
                    previewDiv.style.backgroundPosition = 'center center';
                    const box = previewDiv.closest('.photo-box'); if (box) box.classList.add('has-photo');
                } catch (err) {
                    console.error("Error al comprimir la foto:", keyName, err);
                    previewDiv.innerHTML = "⚠️ Error, reintentá la foto";
                } finally {
                    fotosCalidadEnProceso--;
                }
            };
            img.onerror = function() {
                previewDiv.innerHTML = "⚠️ Error, reintentá la foto";
                fotosCalidadEnProceso--;
            };
            img.src = event.target.result;
        };
        reader.onerror = function() {
            previewDiv.innerHTML = "⚠️ Error, reintentá la foto";
            fotosCalidadEnProceso--;
        };
        reader.readAsDataURL(file);
    });
}

// --- 7. CONSTRUCCIÓN DEL PAYLOAD (claves EXACTAS del Google Sheet) ---
function construirRegistroCalidad(idParaGuardar) {
    const totales = recalcularTotalesCalidad();

    const registro = {
        "Id_Calidad": idParaGuardar,
        "Grano": granoActual,
        "Fecha Analisis": document.getElementById('cal-fecha').value,
        "Cliente": document.getElementById('cal-cliente').value,
        "Muestreo en": document.getElementById('cal-muestreo').value,
        "N° Lote Cliente/Planta": document.getElementById('cal-lote-cliente').value,
        "N° Lote BRC": document.getElementById('cal-lote-brc').value,
        "Contrato Produccion": document.getElementById('cal-contrato-prod').value,
        "Contrato Comercial": document.getElementById('cal-contrato-com').value,
        "Contrato FM": document.getElementById('cal-contrato-fm').value,
        "N° Proceso": document.getElementById('cal-proceso').value,
        "Variedad": document.getElementById('cal-variedad').value,
        "N° Lote": document.getElementById('cal-lote').value,
        "N° CTG": document.getElementById('cal-ctg').value,
        "Tipo": document.getElementById('cal-tipo').value,
        "Calibre": document.getElementById('cal-calibre').value,
        "Envase": document.getElementById('cal-envase').value,
        "Kg": parseFloat(document.getElementById('cal-kg').value) || 0,

        "Humedad": parseFloat(document.getElementById('cal-humedad').value) || 0,
        "Materia Extraña": parseFloat(document.getElementById('cal-materia-extrana').value) || 0,
        "Insectos Vivos o Muertos": document.querySelector('input[name="cal_insectos"]:checked').value,
        "Olor": document.querySelector('input[name="cal_olor"]:checked').value,
        "observaciones": document.getElementById('cal-observaciones').value,

        // Campos calculados (se envían resueltos para que el Sheet no dependa de fórmulas)
        "Total Granos Buenos": Number(totales.totalBuenos.toFixed(2)),
        "Total de Daños": Number(totales.totalDanios.toFixed(2)),
        "Total Muestra Cargada": Number(totales.totalMuestra.toFixed(2)),
        "Total Muestra %": Number(totales.totalMuestraPct.toFixed(2)),

        // Multimedia y archivos
        "imagen 1": fotosCalidad["imagen 1"] || "",
        "imagen 2": fotosCalidad["imagen 2"] || "",
        "imagen 3": fotosCalidad["imagen 3"] || "",
        "imagen 4": fotosCalidad["imagen 4"] || "",
        "Archivo2": 0,
        "PDF Control Calidad": ""
    };

    // Variables analíticas dinámicas (calibres y defectos del grano activo)
    document.querySelectorAll('.input-calibre-cal, .input-defecto-cal').forEach(inp => {
        registro[inp.dataset.campo] = parseFloat(inp.value) || 0;
    });

    return registro;
}

// --- 8. GUARDADO: COLA OFFLINE (IndexedDB) + SYNC AL BACKEND ---
document.getElementById('form-calidad').addEventListener('submit', function(e) {
    e.preventDefault();

    if (fotosCalidadEnProceso > 0) {
        alert("Esperá un instante: todavía se están procesando fotos. Volvé a tocar \"Guardar\" en unos segundos.");
        return;
    }

    const totales = recalcularTotalesCalidad();
    if (totales.totalMuestra > 0 && Math.abs(totales.totalMuestraPct - 100) > 0.5) {
        const seguir = confirm(`Atención: la muestra suma ${totales.totalMuestraPct.toFixed(2)}% (calibres + defectos) y no cierra en 100%.\n\n¿Querés guardar igual?`);
        if (!seguir) return;
    }

    const esEdicion = !!idCalidadEnEdicion;
    const idParaGuardar = idCalidadEnEdicion || ("CC-" + Date.now());
    const registro = construirRegistroCalidad(idParaGuardar);

    if (esEdicion) {
        actualizarCalidadExistente(registro);
    } else {
        guardarCalidadNueva(registro);
    }
});

function guardarCalidadNueva(registro) {
    if (!db) { alert("La base local todavía no está lista, intentá de nuevo en un instante."); return; }
    const tx = db.transaction(["controles_calidad"], "readwrite");
    const req = tx.objectStore("controles_calidad").add(registro);

    req.onsuccess = function() {
        alert(`¡Control de calidad de ${nombreGranoActual()} guardado con éxito!`);
        resetFormularioCalidad();
        switchTabCalidad('historial');
        if (navigator.onLine) sincronizarCalidadPendientes();
    };
    req.onerror = function(e) {
        console.error("Error al guardar calidad en IndexedDB:", e.target.error);
        alert("⚠️ No se pudo guardar el control en este dispositivo. Motivo: " + (e.target.error ? e.target.error.message : "desconocido"));
    };
}

function actualizarCalidadExistente(registro) {
    if (!db) { alert("La base local todavía no está lista, intentá de nuevo en un instante."); return; }
    const tx = db.transaction(["controles_calidad"], "readwrite");
    const store = tx.objectStore("controles_calidad");
    let encontradoEnColaLocal = false;

    store.openCursor().onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
            if (cursor.value["Id_Calidad"] === registro["Id_Calidad"]) {
                encontradoEnColaLocal = true;
                cursor.update(Object.assign({}, registro, { id: cursor.value.id }));
            }
            cursor.continue();
        } else {
            if (!encontradoEnColaLocal) {
                // Ya estaba sincronizado: actualizamos la vista y avisamos al backend
                const idx = historialCalidad.findIndex(r => r["Id_Calidad"] === registro["Id_Calidad"]);
                if (idx !== -1) historialCalidad[idx] = registro;
                if (navigator.onLine && !WEB_APP_URL.includes("AQUÍ_VA")) {
                    fetch(WEB_APP_URL, {
                        method: "POST",
                        mode: "no-cors",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(Object.assign({ _accion: "actualizar_calidad" }, registro))
                    }).catch(err => console.error("No se pudo sincronizar la edición de calidad:", err));
                }
            } else if (navigator.onLine) {
                sincronizarCalidadPendientes();
            }
            alert("¡Cambios del control de calidad guardados!");
            resetFormularioCalidad();
            switchTabCalidad('historial');
        }
    };
}

// Sube al backend (Google Apps Script) los registros en cola y los saca de IndexedDB
function sincronizarCalidadPendientes() {
    if (!db || !navigator.onLine || WEB_APP_URL.includes("AQUÍ_VA")) return;
    const tx = db.transaction(["controles_calidad"], "readonly");
    tx.objectStore("controles_calidad").openCursor().onsuccess = function(e) {
        const cursor = e.target.result;
        if (!cursor) return;
        const item = cursor.value;
        const idKey = item.id;
        const payload = Object.assign({ _accion: "guardar_calidad" }, item);
        delete payload.id; // el id local de IndexedDB no viaja al Sheet

        fetch(WEB_APP_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(() => {
            const delTx = db.transaction(["controles_calidad"], "readwrite");
            delTx.objectStore("controles_calidad").delete(idKey).onsuccess = function() {
                sincronizarCalidadPendientes(); // procesa el siguiente de la cola
            };
        })
        .catch(err => console.error("No se pudo sincronizar el control de calidad:", err));
    };
}

// --- 9. HISTORIAL: LECTURA DEL BACKEND + RENDER DE LA LISTA ---
function cargarHistorialCalidadDesdeGoogle() {
    if (!navigator.onLine || WEB_APP_URL.includes("AQUÍ_VA")) return;
    fetch(`${WEB_APP_URL}?action=read_calidad`)
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                historialCalidad = data;
                filtrarYRenderizarCalidad();
            }
        })
        .catch(err => console.error("Error cargando historial de calidad:", err));
}

function obtenerCalidadLocales() {
    return new Promise((resolve) => {
        if (!db || !db.objectStoreNames.contains("controles_calidad")) { resolve([]); return; }
        try {
            const tx = db.transaction(["controles_calidad"], "readonly");
            const req = tx.objectStore("controles_calidad").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (err) { resolve([]); }
    });
}

async function filtrarYRenderizarCalidad() {
    const tbody = document.getElementById('tabla-calidad-body');
    if (!tbody) return;

    const txt = (document.getElementById('filter-cal-search').value || '').toLowerCase();
    const fechaDesde = document.getElementById('filter-cal-fecha-desde').value;
    const fechaHasta = document.getElementById('filter-cal-fecha-hasta').value;

    const locales = (await obtenerCalidadLocales()).map(r => Object.assign({}, r, { _pendienteSync: true }));
    const idsLocales = new Set(locales.map(r => r["Id_Calidad"]));
    const remotos = historialCalidad.filter(r => !idsLocales.has(r["Id_Calidad"]));
    const lista = locales.concat(remotos);

    const filtrados = lista.filter(item => {
        if ((item["Grano"] || "GARBANZO") !== granoActual) return false;
        const fecha = item["Fecha Analisis"] || '';
        if (fechaDesde && fecha && fecha < fechaDesde) return false;
        if (fechaHasta && fecha && fecha > fechaHasta) return false;
        if (txt) {
            const buscable = [
                item["Cliente"], item["Variedad"], item["N° Lote"], item["N° Lote BRC"],
                item["N° Lote Cliente/Planta"], item["Contrato Comercial"],
                item["Contrato Produccion"], item["N° Proceso"]
            ].join(' ').toLowerCase();
            if (!buscable.includes(txt)) return false;
        }
        return true;
    });

    filtrados.sort((a, b) => (b["Fecha Analisis"] || '').localeCompare(a["Fecha Analisis"] || ''));

    tbody.innerHTML = "";
    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">No hay controles de calidad registrados.</td></tr>`;
        return;
    }

    filtrados.forEach(item => {
        const tr = document.createElement('tr');
        const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(item))));
        const foto = item["imagen 1"] || item["imagen 2"] || item["imagen 3"] || item["imagen 4"] || "";
        const miniatura = (foto && foto.length > 100)
            ? `<img src="${foto}" class="thumb-historial" alt="Muestra">`
            : `<div class="thumb-historial thumb-vacia"><i class="fas fa-seedling"></i></div>`;
        const etiquetaPendiente = item._pendienteSync
            ? `<br><span class="badge-pendiente" title="Todavía no se sincronizó con el servidor"><i class="fas fa-clock"></i> Pendiente</span>`
            : '';
        const loteVariedad = [item["N° Lote"], item["Variedad"]].filter(Boolean).join(' / ') || '-';

        tr.innerHTML = `
            <td data-label="Foto" class="td-thumb">${miniatura}</td>
            <td data-label="Fecha" class="td-fecha">${item["Fecha Analisis"] || '-'}<span class="reg-num-movil">#${item["Id_Calidad"] || ''}</span></td>
            <td data-label="Cliente"><b>${escapeHtml(item["Cliente"] || '-')}</b>${etiquetaPendiente}</td>
            <td data-label="Lote / Variedad">${escapeHtml(loteVariedad)}</td>
            <td data-label="Kg">${item["Kg"] || 0} kg</td>
            <td class="td-acciones" onclick="event.stopPropagation();">
                <button class="btn-table-action" onclick="cargarCalidadParaEditar('${dataString}')" title="Editar control">
                    <i class="fas fa-pen" style="color:#ef6c00; font-size: 1.1rem; cursor:pointer;"></i>
                </button>
                <button class="btn-table-action" onclick="eliminarCalidad('${dataString}')" title="Eliminar control">
                    <i class="fas fa-trash" style="color:#c62828; font-size: 1.1rem; cursor:pointer;"></i>
                </button>
                <button class="btn-table-action" onclick="generarPDFCalidad('${dataString}')" title="Descargar PDF">
                    <i class="fas fa-file-pdf" style="color:#b71c1c; font-size: 1.2rem; cursor:pointer;"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 10. EDICIÓN Y BORRADO ---
function cargarCalidadParaEditar(base64Data) {
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(base64Data))));

        granoActual = item["Grano"] || granoActual;
        document.getElementById('lbl-grano-actual').textContent = nombreGranoActual();
        document.getElementById('lbl-grano-form').textContent = nombreGranoActual();
        resetFormularioCalidad();
        switchTabCalidad('nuevo');
        cambiarVista('view-modulo-calidad');

        // Cabecera
        document.getElementById('cal-fecha').value = item["Fecha Analisis"] || "";
        poblarSelect(document.getElementById('cal-cliente'), 'cliente', item["Cliente"] || "");
        poblarSelect(document.getElementById('cal-muestreo'), 'muestreo', item["Muestreo en"] || "");
        document.getElementById('cal-lote-cliente').value = item["N° Lote Cliente/Planta"] || "";
        document.getElementById('cal-lote-brc').value = item["N° Lote BRC"] || "";
        document.getElementById('cal-contrato-prod').value = item["Contrato Produccion"] || "";
        document.getElementById('cal-contrato-com').value = item["Contrato Comercial"] || "";
        document.getElementById('cal-contrato-fm').value = item["Contrato FM"] || "";
        document.getElementById('cal-proceso').value = item["N° Proceso"] || "";
        document.getElementById('cal-variedad').value = item["Variedad"] || "";
        document.getElementById('cal-lote').value = item["N° Lote"] || "";
        document.getElementById('cal-ctg').value = item["N° CTG"] || "";
        poblarSelect(document.getElementById('cal-tipo'), 'tipoGrano', item["Tipo"] || "");
        poblarSelect(document.getElementById('cal-calibre'), 'calibre', item["Calibre"] || "");
        poblarSelect(document.getElementById('cal-envase'), 'envase', item["Envase"] || "");
        document.getElementById('cal-kg').value = item["Kg"] || 0;

        // Variables analíticas
        document.querySelectorAll('.input-calibre-cal, .input-defecto-cal').forEach(inp => {
            inp.value = item[inp.dataset.campo] || 0;
        });

        // Condición
        document.getElementById('cal-humedad').value = item["Humedad"] || 0;
        document.getElementById('cal-materia-extrana').value = item["Materia Extraña"] || 0;
        const radioInsectos = document.querySelector(`input[name="cal_insectos"][value="${item["Insectos Vivos o Muertos"] || 'NO'}"]`);
        if (radioInsectos) radioInsectos.checked = true;
        const radioOlor = document.querySelector(`input[name="cal_olor"][value="${item["Olor"] || 'NO'}"]`);
        if (radioOlor) radioOlor.checked = true;
        document.getElementById('cal-observaciones').value = item["observaciones"] || "";

        // Fotos
        for (let i = 1; i <= 4; i++) {
            const key = `imagen ${i}`;
            const valor = item[key] || "";
            fotosCalidad[key] = valor;
            const prev = document.getElementById(`cal-p${i}`);
            if (prev && valor && valor.length > 100) {
                prev.innerHTML = '';
                prev.style.backgroundImage = `url(${valor})`;
                prev.style.backgroundSize = 'cover';
                prev.style.backgroundPosition = 'center center';
                const box = prev.closest('.photo-box'); if (box) box.classList.add('has-photo');
            }
        }

        recalcularTotalesCalidad();

        idCalidadEnEdicion = item["Id_Calidad"];
        document.getElementById('btn-guardar-calidad').textContent = "Guardar Cambios";
        document.getElementById('btn-cancelar-edicion-calidad').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error("Error al cargar el control de calidad para editar:", error);
        alert("No se pudo cargar este control para editarlo.");
    }
}

function eliminarCalidad(base64Data) {
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(base64Data))));
        const confirmado = confirm(`¿Seguro que querés eliminar el control de calidad de "${item["Cliente"] || 'este registro'}" (${item["Fecha Analisis"] || ''})? Esta acción no se puede deshacer.`);
        if (!confirmado) return;

        // 1) Sacarlo de la cola offline si todavía estaba ahí
        if (db) {
            const tx = db.transaction(["controles_calidad"], "readwrite");
            tx.objectStore("controles_calidad").openCursor().onsuccess = function(e) {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value["Id_Calidad"] === item["Id_Calidad"]) cursor.delete();
                    cursor.continue();
                } else {
                    filtrarYRenderizarCalidad();
                }
            };
        }

        // 2) Sacarlo de la vista en memoria
        historialCalidad = historialCalidad.filter(r => r["Id_Calidad"] !== item["Id_Calidad"]);
        filtrarYRenderizarCalidad();

        // 3) Avisar al backend (el Apps Script debe atender _accion: "eliminar_calidad")
        if (navigator.onLine && !WEB_APP_URL.includes("AQUÍ_VA")) {
            fetch(WEB_APP_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _accion: "eliminar_calidad", "Id_Calidad": item["Id_Calidad"] })
            }).catch(err => console.error("No se pudo notificar el borrado de calidad:", err));
        }
    } catch (error) {
        console.error("Error al eliminar el control de calidad:", error);
        alert("No se pudo eliminar este control.");
    }
}

// --- 11. PDF DEL CONTROL DE CALIDAD (jsPDF) ---
function generarPDFCalidad(base64Data) {
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(base64Data))));
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const cfg = CALIDAD_CONFIG[item["Grano"]] || CALIDAD_CONFIG[granoActual];
        const margen = 14;
        const anchoUtil = 210 - margen * 2;
        let y = 18;

        const rojo = [183, 28, 28];

        // Encabezado
        doc.setFillColor(rojo[0], rojo[1], rojo[2]);
        doc.rect(0, 0, 210, 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(15);
        doc.setFont(undefined, 'bold');
        doc.text(`BRAUN - Control de Calidad ${cfg.nombre}`, margen, 11);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Registro ${item["Id_Calidad"] || '-'}  |  Fecha de análisis: ${item["Fecha Analisis"] || '-'}`, margen, 18);
        doc.setTextColor(30, 30, 30);
        y = 32;

        const seccion = (titulo) => {
            if (y > 265) { doc.addPage(); y = 18; }
            doc.setFillColor(245, 235, 235);
            doc.rect(margen, y - 4.5, anchoUtil, 7, 'F');
            doc.setFontSize(10.5);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(rojo[0], rojo[1], rojo[2]);
            doc.text(titulo, margen + 2, y);
            doc.setTextColor(30, 30, 30);
            y += 8;
        };

        const filaDoble = (l1, v1, l2, v2) => {
            if (y > 275) { doc.addPage(); y = 18; }
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.text(l1 + ":", margen, y);
            doc.setFont(undefined, 'normal');
            doc.text(String(v1 === undefined || v1 === null || v1 === '' ? '-' : v1), margen + 42, y);
            if (l2 !== undefined) {
                doc.setFont(undefined, 'bold');
                doc.text(l2 + ":", margen + 95, y);
                doc.setFont(undefined, 'normal');
                doc.text(String(v2 === undefined || v2 === null || v2 === '' ? '-' : v2), margen + 137, y);
            }
            y += 6;
        };

        seccion("Datos Generales y Logística");
        filaDoble("Cliente", item["Cliente"], "Muestreo en", item["Muestreo en"]);
        filaDoble("Lote Cliente/Planta", item["N° Lote Cliente/Planta"], "N° Lote BRC", item["N° Lote BRC"]);
        filaDoble("Contrato Producción", item["Contrato Produccion"], "Contrato Comercial", item["Contrato Comercial"]);
        filaDoble("Contrato FM", item["Contrato FM"], "N° Proceso", item["N° Proceso"]);
        filaDoble("Variedad", item["Variedad"], "N° Lote", item["N° Lote"]);
        filaDoble("N° CTG", item["N° CTG"], "Tipo", item["Tipo"]);
        filaDoble("Calibre", item["Calibre"], "Envase", item["Envase"]);
        filaDoble("Kg", item["Kg"]);

        seccion("Análisis de Calibre (%)");
        cfg.calibres.forEach((c, i) => {
            if (i % 2 === 0) {
                const sig = cfg.calibres[i + 1];
                filaDoble(c, (item[c] || 0) + " %", sig, sig !== undefined ? (item[sig] || 0) + " %" : undefined);
            }
        });
        filaDoble("TOTAL GRANOS BUENOS", (item["Total Granos Buenos"] || 0) + " %");

        seccion("Defectos Físicos (%)");
        cfg.defectos.forEach((d, i) => {
            if (i % 2 === 0) {
                const sig = cfg.defectos[i + 1];
                filaDoble(d, (item[d] || 0) + " %", sig, sig !== undefined ? (item[sig] || 0) + " %" : undefined);
            }
        });
        filaDoble("TOTAL DE DAÑOS", (item["Total de Daños"] || 0) + " %");

        seccion("Totales de Muestra");
        filaDoble("Total Muestra Cargada", item["Total Muestra Cargada"], "Total Muestra %", (item["Total Muestra %"] || 0) + " %");

        seccion("Condición de la Muestra");
        filaDoble("Humedad", (item["Humedad"] || 0) + " %", "Materia Extraña", (item["Materia Extraña"] || 0) + " %");
        filaDoble("Insectos Vivos/Muertos", item["Insectos Vivos o Muertos"], "Olor", item["Olor"]);
        if (item["observaciones"]) {
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.text("Observaciones:", margen, y);
            doc.setFont(undefined, 'normal');
            const lineas = doc.splitTextToSize(String(item["observaciones"]), anchoUtil - 30);
            doc.text(lineas, margen + 30, y);
            y += lineas.length * 5 + 3;
        }

        // Fotos en página aparte
        const fotos = [1, 2, 3, 4]
            .map(i => ({ titulo: `Imagen ${i}`, data: item[`imagen ${i}`] }))
            .filter(f => f.data && f.data.length > 100);
        if (fotos.length > 0) {
            doc.addPage();
            doc.setFillColor(rojo[0], rojo[1], rojo[2]);
            doc.rect(0, 0, 210, 16, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`Registro Fotográfico — ${item["Id_Calidad"] || ''}`, margen, 11);
            doc.setTextColor(30, 30, 30);
            const anchoFoto = (anchoUtil - 10) / 2;
            const altoFoto = 70;
            fotos.forEach((f, i) => {
                const col = i % 2, fila = Math.floor(i / 2);
                const x = margen + col * (anchoFoto + 10);
                const fy = 24 + fila * (altoFoto + 16);
                doc.setFontSize(9);
                doc.setFont(undefined, 'bold');
                doc.text(f.titulo, x, fy);
                try { doc.addImage(f.data, 'JPEG', x, fy + 2, anchoFoto, altoFoto); }
                catch (err) { doc.setFont(undefined, 'normal'); doc.text("(no se pudo incluir la imagen)", x, fy + 10); }
            });
        }

        doc.save(`Calidad_${cfg.nombre}_${item["Fecha Analisis"] || ''}_${item["Id_Calidad"] || ''}.pdf`);
    } catch (error) {
        console.error("Error al generar el PDF de calidad:", error);
        alert("No se pudo generar el PDF de este control.");
    }
}

// --- 12. INICIALIZACIÓN DEL MÓDULO ---
document.addEventListener("DOMContentLoaded", () => {
    // Fotos del formulario de calidad
    configurarFotoCalidad("cal-f1", "cal-p1", "imagen 1");
    configurarFotoCalidad("cal-f2", "cal-p2", "imagen 2");
    configurarFotoCalidad("cal-f3", "cal-p3", "imagen 3");
    configurarFotoCalidad("cal-f4", "cal-p4", "imagen 4");

    // Filtros del historial en vivo
    document.getElementById('filter-cal-search').addEventListener('input', filtrarYRenderizarCalidad);
    document.getElementById('filter-cal-fecha-desde').addEventListener('change', filtrarYRenderizarCalidad);
    document.getElementById('filter-cal-fecha-hasta').addEventListener('change', filtrarYRenderizarCalidad);

    // El Kg de cabecera participa del resumen: recalculamos al cambiarlo
    document.getElementById('cal-kg').addEventListener('input', recalcularTotalesCalidad);

    // Ruteo interno: si la URL trae #/control-calidad/<grano> y hay sesión, abrimos directo
    if (localStorage.getItem('usuarioBraun')) {
        abrirCalidadDesdeHash();
    }
});

// Exponer las funciones usadas desde el HTML
window.abrirModuloCalidad = abrirModuloCalidad;
window.switchTabCalidad = switchTabCalidad;
window.cancelarEdicionCalidad = cancelarEdicionCalidad;
window.cargarCalidadParaEditar = cargarCalidadParaEditar;
window.eliminarCalidad = eliminarCalidad;
window.generarPDFCalidad = generarPDFCalidad;
window.nombreGranoActual = nombreGranoActual;
