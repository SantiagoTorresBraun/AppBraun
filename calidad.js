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
        habilitado: true,
        nombre: "Poroto Mung",
        ruta: "poroto-mung",
        // Columnas exactas de la hoja "Control de Calidad Mung"
        calibres: ["4mm", "3,5mm", "3,25mm", "3mm", "Bajo zaranda"],
        defectos: [
            "Partidos", "Roidos", "Picados", "Moho", "Brotados", "Descolorido",
            "Ardidos y Chuzos", "Lev. Descoloridos", "Otro tipo", "Sucios",
            "Manchados", "Lev. Manchados", "Cascados", "Pelados/Descorticados",
            "Daño Mecanico", "Arrugados", "Helados"
        ]
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
                    <input type="text" inputmode="decimal" id="${slugCampoCalidad(nombre)}" class="${cssClase} campo-numero-ar"
                           data-campo="${nombre}" value="0">
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
    document.querySelectorAll(selector).forEach(inp => { suma += parseNumeroAR(inp.value); });
    return suma;
}

function recalcularTotalesCalidad() {
    const totalBuenos = leerSumaInputs('.input-calibre-cal');   // 10mm + 9mm + 8mm + 7mm + Bajo zaranda
    const totalDanios = leerSumaInputs('.input-defecto-cal');   // suma de defectos físicos
    const totalMuestra = totalBuenos + totalDanios;             // Total Muestra Cargada
    const kg = parseNumeroAR(document.getElementById('cal-kg').value);
    // Total Muestra %: porcentaje analizado sobre 100 (control de que la muestra cierre)
    const totalMuestraPct = totalMuestra;

    document.getElementById('total-granos-buenos').textContent = formatNumeroAR(totalBuenos, 2) + " %";
    document.getElementById('total-danios').textContent = formatNumeroAR(totalDanios, 2) + " %";
    document.getElementById('total-muestra-cargada').textContent = formatNumeroAR(totalMuestra, 2);
    const elPct = document.getElementById('total-muestra-pct');
    elPct.textContent = formatNumeroAR(totalMuestraPct, 2) + " %";
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
        // Auditoría: email del operario logueado que crea/modifica el control
        "usuario_registro": usuarioRegistroActual(),
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
        "Kg": parseNumeroAR(document.getElementById('cal-kg').value),

        "Humedad": parseNumeroAR(document.getElementById('cal-humedad').value),
        "Materia Extraña": parseNumeroAR(document.getElementById('cal-materia-extrana').value),
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
        registro[inp.dataset.campo] = parseNumeroAR(inp.value);
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
        const seguir = confirm(`Atención: la muestra suma ${formatNumeroAR(totales.totalMuestraPct, 2)}% (calibres + defectos) y no cierra en 100%.\n\n¿Querés guardar igual?`);
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

// La hoja "Control Calidad Garbanzo" viene de AppSheet, así que los datos llegan
// "como se ven" en el Sheet: fechas "8/10/2025", porcentajes "25,20%" (texto con
// coma decimal) y fotos como rutas de Drive. Estas funciones los convierten al
// formato que usa la app (yyyy-mm-dd y números), para que filtros, orden,
// edición y PDF funcionen igual que con los registros creados desde la app.

const CAMPOS_NUMERICOS_CALIDAD = [
    "Kg", "Humedad", "Materia Extraña",
    "Total Granos Buenos", "Total de Daños",
    "Total Muestra Cargada", "Total Muestra %"
];

function normalizarNumeroSheet(valor) {
    if (typeof valor === 'number') return valor;
    if (valor === null || valor === undefined || valor === '') return 0;
    let s = String(valor).trim().replace('%', '').trim();
    if (s.includes(',')) {
        // Formato es-AR: "1.234,56" → puntos de miles fuera, coma decimal a punto
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
        // Solo puntos de miles: "250.000" → 250000
        s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function normalizarFechaSheet(valor) {
    if (!valor) return '';
    const s = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);   // ISO o ISO+hora
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);      // d/m/aaaa o d/m/aa (locale es-AR)
    if (m) {
        const anio = m[3].length === 2 ? `20${m[3]}` : m[3];    // "26" → "2026"
        return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return s;
}

// Google dejó de permitir incrustar imágenes con el formato "uc?export=view".
// Convertimos cualquier link de Drive al CDN final de Google (lh3), que sirve
// la imagen directo (sin redirección) y con CORS abierto: funciona tanto en
// <img> como para descargarla con fetch al armar el PDF.
function extraerIdDrive(valor) {
    const m = String(valor || '').match(/(?:drive\.google\.com\/(?:uc\?(?:[^#]*&)?id=|file\/d\/|open\?id=|thumbnail\?id=)|lh3\.googleusercontent\.com\/d\/)([\w-]+)/);
    return m ? m[1] : null;
}

function normalizarUrlImagenDrive(valor) {
    if (!valor) return valor;
    const id = extraerIdDrive(valor);
    return id ? `https://lh3.googleusercontent.com/d/${id}=w800` : valor;
}

function normalizarRegistroCalidadRemoto(r) {
    const reg = Object.assign({}, r);
    if (!reg["Grano"]) reg["Grano"] = "GARBANZO";
    reg["Fecha Analisis"] = normalizarFechaSheet(reg["Fecha Analisis"]);
    ["imagen 1", "imagen 2", "imagen 3", "imagen 4"].forEach(k => {
        if (reg[k]) reg[k] = normalizarUrlImagenDrive(reg[k]);
    });

    // Campos fijos + todos los calibres/defectos definidos para cualquier grano
    const numericos = new Set(CAMPOS_NUMERICOS_CALIDAD);
    Object.values(CALIDAD_CONFIG).forEach(cfg => {
        (cfg.calibres || []).forEach(c => numericos.add(c));
        (cfg.defectos || []).forEach(d => numericos.add(d));
    });
    numericos.forEach(campo => {
        if (campo in reg) reg[campo] = normalizarNumeroSheet(reg[campo]);
    });
    return reg;
}

// Una foto se puede mostrar si es base64 (sacada desde la app) o una URL
// (resuelta por el Apps Script desde la ruta de AppSheet en Drive).
function esImagenRenderizable(valor) {
    if (!valor) return false;
    const v = String(valor);
    return v.startsWith('data:image') || v.startsWith('http');
}

// --- Lectura directa de la hoja (PLAN B, sin Apps Script) --------------------
// Usa el endpoint gviz de Google Sheets. Solo funciona si el Sheet está
// compartido como "Cualquiera con el enlace: Lector". Devuelve los valores
// formateados (como se ven en la hoja), que luego pasan por el normalizador.
const CALIDAD_SHEET_ID = "1RXqKN0EJroi5fgZlvKYTXNGMCTDCc5iTu4cNrY1tP-M";
const CALIDAD_SHEET_NOMBRE = "Control Calidad Garbanzo";

function leerCalidadDirectoDelSheet() {
    const url = `https://docs.google.com/spreadsheets/d/${CALIDAD_SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(CALIDAD_SHEET_NOMBRE)}`;
    return fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`El Sheet respondió ${res.status} (¿está compartido como "cualquiera con el enlace puede ver"?)`);
            return res.text();
        })
        .then(texto => {
            // La respuesta viene envuelta en google.visualization.Query.setResponse({...})
            const inicio = texto.indexOf('{');
            const fin = texto.lastIndexOf('}');
            if (inicio === -1 || fin === -1) throw new Error("Respuesta gviz inválida");
            const json = JSON.parse(texto.slice(inicio, fin + 1));
            if (json.status === 'error') throw new Error("gviz: " + JSON.stringify(json.errors));

            const cols = json.table.cols.map(c => (c.label || '').trim());
            return json.table.rows.map(fila => {
                const reg = {};
                cols.forEach((nombre, i) => {
                    if (!nombre) return;
                    const celda = (fila.c || [])[i];
                    // .f = valor formateado ("25,20%", "8/10/2025"); .v = valor crudo
                    reg[nombre] = celda ? (celda.f !== undefined && celda.f !== null ? celda.f : (celda.v === null || celda.v === undefined ? '' : celda.v)) : '';
                });
                return reg;
            }).filter(r => r["Id_Calidad"]);
        });
}

function cargarHistorialCalidadDesdeGoogle() {
    if (!navigator.onLine || WEB_APP_URL.includes("AQUÍ_VA")) return;
    fetch(`${WEB_APP_URL}?action=read_calidad`)
        .then(res => res.json())
        .then(data => {
            // Solo filas que realmente son de calidad. Si el Apps Script
            // todavía no atiende ?action=read_calidad, devuelve las cargas
            // (tienen Id_Carga, no Id_Calidad) y hay que descartarlas.
            const soloCalidad = Array.isArray(data) ? data.filter(r => r && r["Id_Calidad"]) : [];
            if (soloCalidad.length > 0) {
                historialCalidad = soloCalidad.map(normalizarRegistroCalidadRemoto);
                filtrarYRenderizarCalidad();
                return;
            }

            // PLAN B: el Apps Script todavía no soporta read_calidad →
            // intentamos leer la hoja directo (requiere Sheet compartido como lector)
            console.warn("El backend no devolvió registros de calidad; intentando lectura directa del Sheet...");
            return leerCalidadDirectoDelSheet()
                .then(registros => {
                    historialCalidad = registros.map(normalizarRegistroCalidadRemoto);
                    filtrarYRenderizarCalidad();
                })
                .catch(err => console.warn("Lectura directa del Sheet no disponible:", err.message));
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
        // Click en la fila → vista detalle solo lectura (los botones de la
        // columna Acciones tienen stopPropagation, así que no interfieren)
        tr.style.cursor = 'pointer';
        tr.onclick = () => abrirDetalleCalidad(dataString);
        const foto = [item["imagen 1"], item["imagen 2"], item["imagen 3"], item["imagen 4"]].find(esImagenRenderizable) || "";
        const miniatura = foto
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

// --- 10-A. VISTA DETALLE (SOLO LECTURA, mismo patrón que Control de Carga) ---
let calidadDetalleActual = null;

function abrirDetalleCalidad(dataString) {
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(dataString))));
        calidadDetalleActual = item;
        const cfg = CALIDAD_CONFIG[item["Grano"]] || CALIDAD_CONFIG[granoActual];
        const num = v => typeof v === 'number' ? v : (parseFloat(v) || 0);
        const texto = (id, valor) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (valor === undefined || valor === null || valor === '') ? '-' : valor;
        };

        document.getElementById('det-cal-titulo-grano').textContent = cfg.nombre;

        // Información general
        texto('det-cal-fecha', item["Fecha Analisis"]);
        texto('det-cal-cliente', item["Cliente"]);
        texto('det-cal-muestreo', item["Muestreo en"]);
        texto('det-cal-kg', num(item["Kg"]) ? num(item["Kg"]).toLocaleString('es-AR') + ' kg' : '-');
        texto('det-cal-tipo', item["Tipo"]);
        texto('det-cal-calibre', item["Calibre"]);
        texto('det-cal-envase', item["Envase"]);
        texto('det-cal-variedad', item["Variedad"]);

        // Lotes y contratos
        texto('det-cal-lote', item["N° Lote"]);
        texto('det-cal-lote-brc', item["N° Lote BRC"]);
        texto('det-cal-lote-cliente', item["N° Lote Cliente/Planta"]);
        texto('det-cal-ctg', item["N° CTG"]);
        texto('det-cal-contrato-prod', item["Contrato Produccion"]);
        texto('det-cal-contrato-com', item["Contrato Comercial"]);
        texto('det-cal-contrato-fm', item["Contrato FM"]);
        texto('det-cal-proceso', item["N° Proceso"]);

        // Analítica: calibres, defectos y condición (con totales recalculados)
        const fila = (nombre, valor) => `<div class="detalle-verificacion"><span>${escapeHtml(String(nombre))}</span><span class="valor">${valor}</span></div>`;
        const totalBuenos = cfg.calibres.reduce((s, c) => s + num(item[c]), 0);
        const totalDanios = cfg.defectos.reduce((s, d) => s + num(item[d]), 0);
        document.getElementById('det-cal-calibres').innerHTML =
            cfg.calibres.map(c => fila(c, pdfFormatearPct(num(item[c])))).join('') +
            fila('TOTAL GRANOS BUENOS', `<b>${pdfFormatearPct(totalBuenos)}</b>`);
        document.getElementById('det-cal-defectos').innerHTML =
            cfg.defectos.map(d => fila(d, pdfFormatearPct(num(item[d])))).join('') +
            fila('TOTAL DE DAÑOS', `<b>${pdfFormatearPct(totalDanios)}</b>`);
        document.getElementById('det-cal-condicion').innerHTML =
            fila('Humedad', pdfFormatearPct(num(item["Humedad"]))) +
            fila('Materia Extraña', pdfFormatearPct(num(item["Materia Extraña"]))) +
            fila('Insectos Vivos o Muertos', item["Insectos Vivos o Muertos"] === 'SI' ? '✕ Sí' : '✓ No') +
            fila('Olor (ajeno al origen)', item["Olor"] === 'SI' ? '✕ Sí' : '✓ No');

        texto('det-cal-observaciones', item["observaciones"]);

        // Fotos
        const contFotos = document.getElementById('det-cal-fotos');
        const fotos = [1, 2, 3, 4]
            .map(i => ({ nombre: `Imagen ${i}`, src: item[`imagen ${i}`] }))
            .filter(f => esImagenRenderizable(f.src));
        contFotos.innerHTML = fotos.length > 0
            ? fotos.map(f => `
                <div class="detalle-foto-box">
                    <img src="${f.src}" alt="${f.nombre}" class="detalle-foto-img">
                    <div class="detalle-foto-label">${f.nombre}</div>
                </div>`).join('')
            : '<p style="color: #999;">No hay fotos registradas</p>';

        cambiarVista('view-detalle-calidad');
        window.scrollTo({ top: 0 });
    } catch (e) {
        console.error("Error al abrir el detalle de calidad:", e);
        alert("No se pudo abrir el detalle de este control.");
    }
}

function cerrarDetalleCalidad() {
    calidadDetalleActual = null;
    cambiarVista('view-modulo-calidad');
}

function editarDesdeDetalleCalidad() {
    if (!calidadDetalleActual) return;
    const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(calidadDetalleActual))));
    cargarCalidadParaEditar(dataString);
}

function pdfDesdeDetalleCalidad() {
    if (!calidadDetalleActual) return;
    const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(calidadDetalleActual))));
    generarPDFCalidad(dataString);
}

function eliminarDesdeDetalleCalidad() {
    if (!calidadDetalleActual) return;
    const dataString = btoa(unescape(encodeURIComponent(JSON.stringify(calidadDetalleActual))));
    eliminarCalidad(dataString); // pide confirmación adentro
    cerrarDetalleCalidad();
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
        document.getElementById('cal-kg').value = valorPlanoParaEditar(item["Kg"] || 0);

        // Variables analíticas
        document.querySelectorAll('.input-calibre-cal, .input-defecto-cal').forEach(inp => {
            inp.value = valorPlanoParaEditar(item[inp.dataset.campo] || 0);
        });

        // Condición
        document.getElementById('cal-humedad').value = valorPlanoParaEditar(item["Humedad"] || 0);
        document.getElementById('cal-materia-extrana').value = valorPlanoParaEditar(item["Materia Extraña"] || 0);
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
            if (prev && esImagenRenderizable(valor)) {
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
                body: JSON.stringify({ _accion: "eliminar_calidad", "Id_Calidad": item["Id_Calidad"], "Grano": item["Grano"] || granoActual })
            }).catch(err => console.error("No se pudo notificar el borrado de calidad:", err));
        }
    } catch (error) {
        console.error("Error al eliminar el control de calidad:", error);
        alert("No se pudo eliminar este control.");
    }
}

// --- 11. PDF DEL CONTROL DE CALIDAD ---
// Réplica del reporte original de AppSheet: header rojo "Reporte de Calidad",
// tablas "Condición del Lote" + "Análisis", sello SENASA, nota legal, página
// de fotos con banners y página final con gráficos (torta + barras).

const LOGO_SENASA = "data:image/png;base64,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";

// Paleta del reporte (colores fijos por identidad, nunca por posición)
const PDF_ROJO_BRAUN = [163, 30, 30];      // header y acentos
const PDF_MARRON_TABLA = [66, 52, 46];     // barras oscuras de las tablas
const PDF_NARANJA_FOTO = [211, 84, 42];    // banners de la página de fotos
// Verdes por calibre (asignación fija por posición del calibre en la config),
// amarillo para "Bajo zaranda", azul para "Total de daños".
const PDF_VERDES_CALIBRES = ["#b7dfae", "#8ecd85", "#57b25e", "#2e8b47", "#176334"];
const PDF_AMARILLO_ZARANDA = "#e8a917";
const PDF_AZUL_DANIOS = "#2b6cb0";

function pdfFormatearPct(n) {
    return (typeof n === 'number' ? n : (parseFloat(n) || 0)).toFixed(2).replace('.', ',') + ' %';
}

// Descarga una foto (URL de Drive o base64) y la devuelve como dataURL.
// Importante: drive.google.com/thumbnail responde una redirección 302 SIN
// encabezados CORS y el fetch del navegador falla ahí. Por eso siempre
// descargamos del CDN final (lh3.googleusercontent.com), que responde la
// imagen directo y con CORS abierto. Devuelve null si no se pudo.
function cargarImagenParaPDF(src) {
    const bajar = url => fetch(url)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(blob => new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        }));

    return new Promise(resolve => {
        if (!src) return resolve(null);
        const v = String(src);
        if (v.startsWith('data:image')) return resolve(v);
        if (!v.startsWith('http')) return resolve(null);

        const id = extraerIdDrive(v);
        const urlDirecta = id ? `https://lh3.googleusercontent.com/d/${id}=w1200` : v;
        bajar(urlDirecta)
            .then(resolve)
            .catch(() => {
                // Reintento con la URL original por si no era un link de Drive
                if (urlDirecta !== v) bajar(v).then(resolve).catch(() => resolve(null));
                else resolve(null);
            });
    });
}

// Recorta una imagen al aspecto de su caja (estilo "cover") para que no se deforme.
function recortarImagenACaja(dataUrl, ratio) {
    return new Promise(resolve => {
        if (!dataUrl) return resolve(null);
        const img = new Image();
        img.onload = () => {
            try {
                const iw = img.width, ih = img.height;
                let sw = iw, sh = iw / ratio;
                if (sh > ih) { sh = ih; sw = ih * ratio; }
                const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
                const c = document.createElement('canvas');
                c.width = Math.min(1000, Math.round(sw));
                c.height = Math.round(c.width / ratio);
                c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', 0.82));
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

function pdfLuminanciaHex(hex) {
    const n = hex.replace('#', '');
    const r = parseInt(n.substr(0, 2), 16) / 255;
    const g = parseInt(n.substr(2, 2), 16) / 255;
    const b = parseInt(n.substr(4, 2), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Gráfico de torta con leyenda (la identidad va por etiqueta, nunca solo por color)
function dibujarTortaCalidad(porciones) {
    const escala = 3, W = 330, H = Math.max(170, 34 + porciones.length * 16);
    const canvas = document.createElement('canvas');
    canvas.width = W * escala; canvas.height = H * escala;
    const ctx = canvas.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    const total = porciones.reduce((s, p) => s + p.valor, 0) || 1;
    const cx = 82, cy = H / 2, r = Math.min(70, H / 2 - 12);
    let ang = -Math.PI / 2;
    porciones.forEach(p => {
        const delta = (p.valor / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, ang, ang + delta);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); // separador entre porciones
        if (p.valor / total >= 0.055) { // etiqueta directa solo si entra
            const mid = ang + delta / 2;
            ctx.fillStyle = pdfLuminanciaHex(p.color) > 0.62 ? '#3a3a3a' : '#ffffff';
            ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(pdfFormatearPct(p.valor), cx + Math.cos(mid) * r * 0.62, cy + Math.sin(mid) * r * 0.62);
        }
        ang += delta;
    });

    let ly = cy - (porciones.length - 1) * 8;
    porciones.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.fillRect(168, ly - 5, 10, 10);
        ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 0.5; ctx.strokeRect(168, ly - 5, 10, 10);
        ctx.fillStyle = '#3a3a3a';
        ctx.font = '10px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`${p.nombre} — ${pdfFormatearPct(p.valor)}`, 184, ly);
        ly += 16;
    });

    return { dataUrl: canvas.toDataURL('image/png'), ratio: H / W };
}

// Barras horizontales de defectos (una sola serie: un solo tono, valores directos)
function dibujarBarrasDefectos(defectos) {
    const escala = 3, filaH = 17, W = 330;
    const H = 12 + defectos.length * filaH + 8;
    const canvas = document.createElement('canvas');
    canvas.width = W * escala; canvas.height = H * escala;
    const ctx = canvas.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    const maxVal = Math.max.apply(null, defectos.map(d => d.valor)) || 1;
    const xBar = 118, anchoMax = W - xBar - 48;
    defectos.forEach((d, i) => {
        const y = 12 + i * filaH + filaH / 2;
        ctx.fillStyle = '#3a3a3a';
        ctx.font = '9.5px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(d.nombre, xBar - 6, y);
        const w = Math.max(2, (d.valor / maxVal) * anchoMax);
        ctx.fillStyle = PDF_AZUL_DANIOS;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(xBar, y - 5.5, w, 11, [0, 3, 3, 0]) : ctx.rect(xBar, y - 5.5, w, 11);
        ctx.fill();
        ctx.fillStyle = '#3a3a3a';
        ctx.textAlign = 'left';
        ctx.fillText(pdfFormatearPct(d.valor), xBar + w + 5, y);
    });

    return { dataUrl: canvas.toDataURL('image/png'), ratio: H / W };
}

async function generarPDFCalidad(base64Data) {
    document.body.style.cursor = 'wait';
    try {
        const item = JSON.parse(decodeURIComponent(escape(atob(base64Data))));
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const cfg = CALIDAD_CONFIG[item["Grano"]] || CALIDAD_CONFIG[granoActual];
        const margen = 14;
        const anchoUtil = 210 - margen * 2;

        const num = v => typeof v === 'number' ? v : (parseFloat(v) || 0);
        const totalBuenos = cfg.calibres.reduce((s, c) => s + num(item[c]), 0);
        const totalDanios = cfg.defectos.reduce((s, d) => s + num(item[d]), 0);
        const fechaVisible = (() => {
            const m = String(item["Fecha Analisis"] || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}/${m[1]}` : (item["Fecha Analisis"] || '-');
        })();

        // ---- Descargar las fotos ANTES de armar el documento ----
        const RATIO_FOTO = 87 / 100; // ancho/alto de la celda de foto en la página 2
        const fotosCargadas = await Promise.all([1, 2, 3, 4].map(i =>
            cargarImagenParaPDF(item[`imagen ${i}`]).then(d => recortarImagenACaja(d, RATIO_FOTO))
        ));

        // ================= PÁGINA 1: REPORTE =================
        // Header redondeado rojo con logo Braun blanco
        doc.setFillColor(PDF_ROJO_BRAUN[0], PDF_ROJO_BRAUN[1], PDF_ROJO_BRAUN[2]);
        doc.roundedRect(margen, 10, anchoUtil, 18, 4, 4, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("Reporte de Calidad", margen + 7, 21.5);
        try { doc.addImage(LOGO_BRAUN_BLANCO, 'PNG', margen + anchoUtil - 42, 13, 34, 12.5); } catch (e) { }

        // Cliente / N° Proceso
        let y = 42;
        const lineaDato = (etiqueta, valor) => {
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(PDF_ROJO_BRAUN[0], PDF_ROJO_BRAUN[1], PDF_ROJO_BRAUN[2]);
            doc.text(etiqueta, margen, y);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(45, 45, 45);
            doc.text(String(valor || '-'), margen + doc.getTextWidth(etiqueta) + 3, y);
            y += 8;
        };
        lineaDato("Cliente:", item["Cliente"]);
        lineaDato("N° Proceso:", item["N° Proceso"]);
        const yTablas = y + 3;

        // ---- Tabla izquierda: "Condición del Lote" ----
        const xIzq = margen, wIzq = 76;
        doc.setFillColor(PDF_MARRON_TABLA[0], PDF_MARRON_TABLA[1], PDF_MARRON_TABLA[2]);
        doc.rect(xIzq, yTablas, wIzq, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("Condición del Lote:", xIzq + wIzq / 2, yTablas + 4.8, { align: 'center' });

        const filasLote = [
            ["N° Lote:", item["N° Lote"] || (((item["Tipo"] || '') + (item["N° Lote BRC"] || '')) || '-')],
            ["N° Lote Cliente/Planta", item["N° Lote Cliente/Planta"] || '-'],
            ["Calibre:", item["Calibre"] || '-'],
            ["Fecha AC:", fechaVisible],
            ["Envase:", item["Envase"] || '-'],
            ["Kg:", num(item["Kg"]) ? num(item["Kg"]).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : '-']
        ];
        let yIzq = yTablas + 13;
        doc.setTextColor(45, 45, 45);
        filasLote.forEach(([et, val]) => {
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.text(et, xIzq + 1, yIzq, { maxWidth: 32 });
            doc.setFont(undefined, 'normal');
            doc.text(String(val), xIzq + 35, yIzq, { maxWidth: wIzq - 36 });
            yIzq += 9;
        });
        // Sello SENASA
        try { doc.addImage(LOGO_SENASA, 'PNG', xIzq + 2, yIzq + 2, 44, 11.3); } catch (e) { }
        yIzq += 18;

        // ---- Tabla derecha: "Análisis" ----
        const xDer = 98, wDer = 98;
        const wGrupo = 28, wValor = 24, wEtiqueta = wDer - wGrupo - wValor;
        const grupos = [
            { titulo: "Granos Buenos", filas: cfg.calibres.map(c => [c, pdfFormatearPct(num(item[c]))]), total: ["Total granos buenos", pdfFormatearPct(totalBuenos)] },
            { titulo: "Defectos y Daños", filas: cfg.defectos.map(d => [d, pdfFormatearPct(num(item[d]))]), total: ["Total de daños", pdfFormatearPct(totalDanios)] },
            { titulo: "Condiciones", filas: [
                ["Humedad", pdfFormatearPct(num(item["Humedad"]))],
                ["Materia Extraña", pdfFormatearPct(num(item["Materia Extraña"]))],
                ["Insectos Vivos o Muertos", item["Insectos Vivos o Muertos"] || 'NO'],
                ["Olor", item["Olor"] || 'NO']
            ], total: null }
        ];
        const totalFilas = grupos.reduce((s, g) => s + g.filas.length + (g.total ? 1 : 0), 0);
        const altoFila = Math.max(5.4, Math.min(7, (268 - (yTablas + 7)) / totalFilas));

        doc.setFillColor(PDF_MARRON_TABLA[0], PDF_MARRON_TABLA[1], PDF_MARRON_TABLA[2]);
        doc.rect(xDer, yTablas, wDer, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("Análisis", xDer + wDer / 2, yTablas + 4.8, { align: 'center' });

        let yFila = yTablas + 7;
        doc.setDrawColor(130, 130, 130);
        grupos.forEach(g => {
            const hGrupo = g.filas.length * altoFila;
            doc.rect(xDer, yFila, wGrupo, hGrupo);
            doc.setTextColor(45, 45, 45);
            doc.setFontSize(8.5);
            doc.setFont(undefined, 'bold');
            doc.text(g.titulo, xDer + wGrupo / 2, yFila + hGrupo / 2 + 1, { align: 'center', maxWidth: wGrupo - 3 });
            g.filas.forEach(([et, val], i) => {
                const fy = yFila + i * altoFila;
                doc.rect(xDer + wGrupo, fy, wEtiqueta, altoFila);
                doc.rect(xDer + wGrupo + wEtiqueta, fy, wValor, altoFila);
                doc.setFontSize(7.8);
                doc.setFont(undefined, 'normal');
                doc.text(String(et), xDer + wGrupo + 2, fy + altoFila / 2 + 1, { maxWidth: wEtiqueta - 3 });
                doc.setFont(undefined, 'bold');
                doc.text(String(val), xDer + wDer - 2, fy + altoFila / 2 + 1, { align: 'right' });
            });
            yFila += hGrupo;
            if (g.total) {
                doc.setFillColor(PDF_MARRON_TABLA[0], PDF_MARRON_TABLA[1], PDF_MARRON_TABLA[2]);
                doc.rect(xDer, yFila, wDer, altoFila, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(8.3);
                doc.setFont(undefined, 'bold');
                doc.text(g.total[0], xDer + 3, yFila + altoFila / 2 + 1);
                doc.text(g.total[1], xDer + wDer - 2, yFila + altoFila / 2 + 1, { align: 'right' });
                yFila += altoFila;
            }
        });

        // ---- Observaciones + nota legal ----
        let yObs = Math.max(yIzq, yFila) + 10;
        if (yObs > 262) { doc.addPage(); yObs = 20; }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(PDF_ROJO_BRAUN[0], PDF_ROJO_BRAUN[1], PDF_ROJO_BRAUN[2]);
        doc.text("Observaciones:", margen, yObs);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(45, 45, 45);
        const obs = doc.splitTextToSize(String(item["observaciones"] || '-'), anchoUtil - 32);
        doc.text(obs, margen + 32, yObs);
        yObs += Math.max(6, obs.length * 4.6) + 6;

        doc.setFontSize(8);
        doc.setFont(undefined, 'bolditalic');
        doc.setTextColor(80, 80, 80);
        doc.text("Nota:", margen + 12, yObs);
        doc.setFont(undefined, 'italic');
        const nota = doc.splitTextToSize(
            "Este informe corresponde a un control de proceso o de cosecha en campo. Los resultados son orientativos y reflejan solo la muestra analizada; no representan la totalidad del lote ni deben considerarse como un certificado final de calidad.",
            anchoUtil - 24
        );
        doc.text(nota, margen + 12, yObs + 4.5);

        // ================= PÁGINA 2: FOTOS =================
        const etiquetasFotos = ["MUESTRA GENERAL 1:", "FOTO EN MANO 2:", "CALIBRES 3:", "DAÑOS 4:"];
        const fotosDisponibles = fotosCargadas
            .map((d, i) => ({ data: d, titulo: etiquetasFotos[i] }))
            .filter(f => f.data);
        if (fotosDisponibles.length > 0) {
            doc.addPage();
            const anchoCelda = 87, altoFoto = 100, gap = 8;
            fotosDisponibles.forEach((f, idx) => {
                const col = idx % 2, fila = Math.floor(idx / 2);
                const fx = margen + col * (anchoCelda + gap);
                const fy = 16 + fila * (altoFoto + 22);
                doc.setFillColor(PDF_NARANJA_FOTO[0], PDF_NARANJA_FOTO[1], PDF_NARANJA_FOTO[2]);
                doc.rect(fx, fy, anchoCelda, 8, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(9.5);
                doc.setFont(undefined, 'bolditalic');
                doc.text(f.titulo, fx + anchoCelda / 2, fy + 5.5, { align: 'center' });
                try { doc.addImage(f.data, 'JPEG', fx, fy + 8, anchoCelda, altoFoto); }
                catch (e) {
                    doc.setTextColor(120, 120, 120);
                    doc.setFont(undefined, 'normal');
                    doc.text("(no se pudo incluir la imagen)", fx + 4, fy + 20);
                }
            });
        }

        // ================= PÁGINA 3: GRÁFICOS =================
        doc.addPage();
        doc.setFillColor(PDF_ROJO_BRAUN[0], PDF_ROJO_BRAUN[1], PDF_ROJO_BRAUN[2]);
        doc.roundedRect(margen, 10, anchoUtil, 14, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`Resumen Gráfico — ${cfg.nombre}`, margen + 6, 19);

        // Torta: calibres en verdes, Bajo zaranda en amarillo, Total de daños en azul
        const porcionesTorta = [];
        cfg.calibres.forEach((c, i) => {
            const v = num(item[c]);
            if (v <= 0) return;
            const esZaranda = c.toLowerCase().indexOf('bajo zaranda') !== -1;
            porcionesTorta.push({
                nombre: c,
                valor: v,
                color: esZaranda ? PDF_AMARILLO_ZARANDA : PDF_VERDES_CALIBRES[i % PDF_VERDES_CALIBRES.length]
            });
        });
        if (totalDanios > 0) porcionesTorta.push({ nombre: "Total de daños", valor: totalDanios, color: PDF_AZUL_DANIOS });

        let yGraf = 34;
        doc.setTextColor(45, 45, 45);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text("Composición de la muestra (%)", margen, yGraf);
        yGraf += 4;
        if (porcionesTorta.length > 0) {
            const torta = dibujarTortaCalidad(porcionesTorta);
            const wTorta = 168;
            doc.addImage(torta.dataUrl, 'PNG', margen, yGraf, wTorta, wTorta * torta.ratio);
            yGraf += wTorta * torta.ratio + 12;
        } else {
            doc.setFont(undefined, 'normal');
            doc.text("Sin datos de calibres en esta muestra.", margen, yGraf + 6);
            yGraf += 16;
        }

        // Barras: defectos con valor > 0, de mayor a menor
        const defectosConValor = cfg.defectos
            .map(d => ({ nombre: d, valor: num(item[d]) }))
            .filter(d => d.valor > 0)
            .sort((a, b) => b.valor - a.valor);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text("Defectos y daños registrados (%)", margen, yGraf);
        yGraf += 4;
        if (defectosConValor.length > 0) {
            const barras = dibujarBarrasDefectos(defectosConValor);
            const wBarras = 168;
            if (yGraf + wBarras * barras.ratio > 282) { doc.addPage(); yGraf = 20; }
            doc.addImage(barras.dataUrl, 'PNG', margen, yGraf, wBarras, wBarras * barras.ratio);
        } else {
            doc.setFont(undefined, 'normal');
            doc.text("Sin defectos registrados en esta muestra.", margen, yGraf + 6);
        }

        doc.save(`Calidad_${cfg.nombre}_${item["Fecha Analisis"] || ''}_${item["Id_Calidad"] || ''}.pdf`);
    } catch (error) {
        console.error("Error al generar el PDF de calidad:", error);
        alert("No se pudo generar el PDF de este control.");
    } finally {
        document.body.style.cursor = '';
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
    if (haySesionActiva()) {
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
window.abrirDetalleCalidad = abrirDetalleCalidad;
window.cerrarDetalleCalidad = cerrarDetalleCalidad;
window.editarDesdeDetalleCalidad = editarDesdeDetalleCalidad;
window.pdfDesdeDetalleCalidad = pdfDesdeDetalleCalidad;
window.eliminarDesdeDetalleCalidad = eliminarDesdeDetalleCalidad;
