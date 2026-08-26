// =========================================================================
// MÓDULO: AGENTE DE IA  (asistente de datos sobre el Google Sheet)
//
// IDEA CENTRAL — por qué esto funciona con tablas pesadas:
// NUNCA se le manda la tabla entera a la IA. Se le manda solo el CATÁLOGO
// (nombres de hojas, columnas, tipos y valores posibles), que ocupa unos
// pocos miles de caracteres aunque el Sheet tenga 100.000 filas.
//
// El circuito es:
//   1) El usuario pregunta en castellano.
//   2) La IA (Groq) recibe la pregunta + el catálogo y devuelve un PLAN en
//      JSON: qué dataset mirar, qué filtrar, qué agrupar y qué calcular.
//   3) El PLAN lo ejecuta esta app en JavaScript, sobre los datos que ya
//      están cargados en memoria (historialGeneral, historialCalidad, etc.).
//      Acá es donde se procesan las filas: rápido, gratis y sin límite.
//   4) El RESULTADO (que es chico: unos totales o un top 20) vuelve a la IA
//      para que lo redacte en castellano.
//
// La clave de Groq NO vive acá: vive en el Apps Script (02_agente_ia.gs),
// guardada en las Propiedades del Script. El navegador nunca la ve.
//
// Depende de la infraestructura global de app.js: WEB_APP_URL,
// historialGeneral; y de los otros módulos: historialCalidad (calidad.js),
// historialTickets (app.js), historialMuestreos (produccion.js).
// =========================================================================

// --- 1. CONFIGURACIÓN -----------------------------------------------------
const AGENTE_CFG = {
    // Modelo de Groq. Cambiándolo acá cambia en toda la app.
    // Verificado contra la API en 08/2026: "openai/gpt-oss-120b" es el más capaz
    // del plan gratuito; "openai/gpt-oss-20b" responde algo más rápido con los
    // mismos límites. (Los llama-3.x ya fueron dados de baja por Groq.)
    modelo: "openai/gpt-oss-120b",
    // Estos modelos "razonan" antes de contestar y ese razonamiento se paga en
    // tokens. En "low" el plan sale igual de bien gastando la mitad de salida.
    esfuerzo: "low",
    maxFilasRespuesta: 25,        // filas de detalle que se muestran como máximo
    maxValoresDistintos: 25,      // cuántos valores posibles se listan por columna
    maxLargoValor: 45,            // si un valor es más largo que esto, la columna no se lista como categoría
    maxCaracteresResultado: 7000, // tope del JSON de resultados que se le manda a la IA
    maxTurnosMemoria: 6,          // cuántos mensajes previos recuerda la conversación
    maxFilasMuestreoEsquema: 400  // filas que se miran para inferir tipos y valores
};

// Columnas que NUNCA se le muestran a la IA ni se usan en resultados:
// son fotos en base64, firmas y archivos. Pesan megabytes y no aportan nada.
const AGENTE_PATRONES_OCULTOS = [
    /foto/i, /firma/i, /^imagen\s*\d*$/i, /archivo/i, /base64/i, /^cp$/i, /adjunto/i,
    // "PDF Control Calidad" de la hoja de calidad: es un link, no un dato consultable.
    /pdf/i
];

function agenteColumnaVisible(nombre) {
    return !AGENTE_PATRONES_OCULTOS.some(function (rx) { return rx.test(String(nombre)); });
}

// --- 2. ESTADO DEL MÓDULO -------------------------------------------------
let agenteConversacion = [];   // [{rol:'user'|'assistant', texto:'...'}]
let agenteOcupado = false;

// =========================================================================
// 3. DATASETS: qué puede consultar el agente
//    Cada entrada expone una función filas() que devuelve un array PLANO de
//    objetos (una fila = un objeto). Los datos ya vienen del Sheet a través
//    de los módulos existentes, así que el agente siempre ve lo mismo que
//    ve el usuario en las pantallas.
// =========================================================================

// Devuelve el historial que ya tiene cargado cada módulo.
//
// OJO CON ESTO: los historiales se declaran con `let` (app.js, calidad.js,
// produccion.js). Las variables `let`/`const` del nivel superior de un script
// NO se cuelgan de `window` — solo lo hacen `var` y las funciones. Leerlas como
// window["historialGeneral"] devolvía undefined SIEMPRE, así que el agente veía
// cero filas en todos los datasets y contestaba "0 de 0 registros" o "no tengo
// columna de fecha".
//
// Hay que nombrarlas directo: los scripts clásicos comparten el mismo ámbito
// léxico global, así que agente.js (que carga último) las ve sin problema.
// El typeof + try/catch cubre que un módulo no esté cargado todavía.
function agenteHistorial(cual) {
    try {
        let v;
        switch (cual) {
            case "cargas":    v = (typeof historialGeneral   !== "undefined") ? historialGeneral   : null; break;
            case "calidad":   v = (typeof historialCalidad   !== "undefined") ? historialCalidad   : null; break;
            case "tickets":   v = (typeof historialTickets   !== "undefined") ? historialTickets   : null; break;
            case "muestreos": v = (typeof historialMuestreos !== "undefined") ? historialMuestreos : null; break;
            default: v = null;
        }
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return []; // el módulo todavía no se ejecutó (zona muerta temporal)
    }
}

// --- Controles de carga: una fila por camión, con los totales ya calculados ---
function agenteFilasCargas() {
    return agenteHistorial("cargas").map(function (r) {
        const productos = Array.isArray(r.Productos) ? r.Productos : [];
        const contratos = Array.isArray(r.Contratos) ? r.Contratos : [];
        const sum = function (lista, campo) {
            return lista.reduce(function (a, x) { return a + (agenteANumero(x[campo]) || 0); }, 0);
        };
        const unicos = function (lista, campo) {
            const s = [];
            lista.forEach(function (x) {
                const v = agenteTexto(x[campo]);
                if (v && s.indexOf(v) === -1) s.push(v);
            });
            return s.join(" | ");
        };
        return {
            Id_Carga: r.Id_Carga,
            Fecha: r.Fecha,
            Tipo_Carga: r.Tipo_Carga,
            ESTATUS: r.ESTATUS,
            Nombre_Chofer: r.Nombre_Chofer,
            Patente_Chasis: r.Patente_Chasis,
            Patente_Acoplado: r.Patente_Acoplado,
            Elaboro: r.Elaboro,
            Kg_Cargados: r.Kg_Cargados,
            Aplica_Etiqueta: r.Aplica_Etiqueta,
            Lona_Protege: r.Lona_Protege,
            Piso_Libre_Suciedad: r.Piso_Libre_Suciedad,
            Libre_Oxido: r.Libre_Oxido,
            Chasis_Secos_Insectos: r.Chasis_Secos_Insectos,
            Exentos_Hongos: r.Exentos_Hongos,
            Aislante_Piso: r.Aislante_Piso,
            Indicaciones_Descarga: r.Indicaciones_Descarga,
            Correo: r.Correo,
            Estado_Correo: r.Estado_Correo,
            Cantidad_Productos: productos.length,
            Productos_Cargados: unicos(productos, "producto"),
            Total_Kg_Productos: sum(productos, "total_kg"),
            Cantidad_Contratos: contratos.length,
            Contratos_Comerciales: unicos(contratos, "contrato_com"),
            Contratos_Cliente: unicos(contratos, "contrato_cli"),
            Cartas_De_Porte: unicos(contratos, "carta_porte"),
            Destinos: unicos(contratos, "destino"),
            Total_Kg_CP: sum(contratos, "kg_cp"),
            Total_Kg_Descarga: sum(contratos, "kg_descarga"),
            Diferencia_Carga: sum(contratos, "kg_descarga") - sum(contratos, "kg_cp")
        };
    });
}

// --- Productos: una fila por producto cargado (hoja "Producto" desanidada) ---
function agenteFilasProductos() {
    const salida = [];
    agenteHistorial("cargas").forEach(function (r) {
        (Array.isArray(r.Productos) ? r.Productos : []).forEach(function (p) {
            salida.push({
                Id_Carga: r.Id_Carga,
                Fecha: r.Fecha,
                Tipo_Carga: r.Tipo_Carga,
                ESTATUS: r.ESTATUS,
                Nombre_Chofer: r.Nombre_Chofer,
                Producto: p.producto,
                Calibre: p.calibre,
                Tipo: p.tipo,
                Lote: p.lote,
                Posicion: p.posicion,
                Envase: p.envase,
                Cantidad: p.cantidad,
                Kg_Por_Envase: p.kg_envase,
                Total_Kg: p.total_kg
            });
        });
    });
    return salida;
}

// --- Contratos: una fila por contrato / carta de porte ---
function agenteFilasContratos() {
    const salida = [];
    agenteHistorial("cargas").forEach(function (r) {
        (Array.isArray(r.Contratos) ? r.Contratos : []).forEach(function (c) {
            const kgCp = agenteANumero(c.kg_cp) || 0;
            const kgDesc = agenteANumero(c.kg_descarga) || 0;
            salida.push({
                Id_Carga: r.Id_Carga,
                Fecha: r.Fecha,
                Tipo_Carga: r.Tipo_Carga,
                ESTATUS: r.ESTATUS,
                Contrato_Comercial: c.contrato_com,
                Contrato_Cliente: c.contrato_cli,
                Carta_De_Porte: c.carta_porte,
                Destino: c.destino,
                Kg_CP: kgCp,
                Kg_Descarga: kgDesc,
                Diferencia_Carga: Number((kgDesc - kgCp).toFixed(2))
            });
        });
    });
    return salida;
}

// --- Control de Calidad: las columnas salen tal cual del Sheet ---
function agenteFilasCalidad() {
    return agenteHistorial("calidad").map(function (r) {
        const o = {};
        Object.keys(r).forEach(function (k) {
            if (agenteColumnaVisible(k)) o[k] = r[k];
        });
        return o;
    });
}

// --- Ticketera ---
function agenteFilasTickets() {
    return agenteHistorial("tickets").map(function (r) {
        const o = {};
        Object.keys(r).forEach(function (k) {
            if (agenteColumnaVisible(k)) o[k] = r[k];
        });
        return o;
    });
}

// --- Producción / muestreos a campo (cabecera) ---
function agenteFilasMuestreos() {
    return agenteHistorial("muestreos").map(function (r) {
        const puntos = Array.isArray(r.Puntos) ? r.Puntos : [];
        return {
            Id_Muestreo: r.Id_Muestreo,
            Fecha: r.Fecha,
            Establecimiento: r.Establecimiento,
            Lote: r.Lote,
            Campania: r.Campania,
            Cultivo: r.Cultivo,
            Variedad: r.Variedad,
            Responsable: r.Responsable,
            Matricula: r.Matricula,
            Observaciones: r.Observaciones,
            usuario_registro: r.usuario_registro,
            Estado: r.Estado,
            Cantidad_Puntos: puntos.length
        };
    });
}

// --- Producción / puntos de muestreo (desanidado) ---
function agenteFilasPuntosMuestreo() {
    const salida = [];
    agenteHistorial("muestreos").forEach(function (r) {
        (Array.isArray(r.Puntos) ? r.Puntos : []).forEach(function (p) {
            salida.push({
                Id_Punto: p.Id_Punto,
                Id_Muestreo: r.Id_Muestreo,
                Fecha: r.Fecha,
                Establecimiento: r.Establecimiento,
                Lote: r.Lote,
                Campania: r.Campania,
                Orden: p.Orden,
                Lat: p.Lat,
                Long: p.Long,
                Cultivo: p.Cultivo,
                Estado_Fenologico: p.Estado_Fenologico,
                Tipo_Observacion: p.Tipo_Observacion,
                Objetivo: p.Objetivo,
                Severidad: p.Severidad,
                Incidencia_pct: p.Incidencia_pct,
                Conteo_Valor: p.Conteo_Valor,
                Conteo_Unidad: p.Conteo_Unidad,
                Nota: p.Nota
            });
        });
    });
    return salida;
}

const AGENTE_DATASETS = {
    cargas: {
        detalle: 'Controles de carga de camiones. Una fila por camión controlado: fecha, chofer, patentes, checklist de higiene, ESTATUS (ACEPTADO / OBSERVADO / RECHAZADO), kilos y totales de sus productos y contratos.',
        // Columnas que concatenan los valores de las filas hijas ("Garbanzo | Lenteja").
        // Sirven para BUSCAR con "contiene", pero agrupar por ellas da categorías
        // combinadas sin sentido: preguntando "kilos por producto" el planificador
        // devolvía una fila "Lenteja | Garbanzo" con los kilos del camión entero.
        // Se avisa en el catálogo a qué dataset ir para cada análisis.
        resumen: {
            Productos_Cargados: "productos",
            Contratos_Comerciales: "contratos",
            Contratos_Cliente: "contratos",
            Cartas_De_Porte: "contratos",
            Destinos: "contratos"
        },
        filas: agenteFilasCargas
    },
    productos: {
        detalle: 'Productos cargados. Una fila por producto dentro de una carga: producto, calibre, lote, envase, cantidad y kilos. YA INCLUYE la Fecha, el ESTATUS y el chofer de la carga a la que pertenece, así que para "cuántos kg de tal producto en tal mes" se resuelve todo acá, sin cruzar con otro dataset.',
        filas: agenteFilasProductos
    },
    contratos: {
        detalle: 'Contratos y cartas de porte. Una fila por contrato dentro de una carga: contrato comercial, contrato cliente, carta de porte, destino, kilos de carta de porte y de descarga, y la diferencia. YA INCLUYE la Fecha y el ESTATUS de la carga a la que pertenece, así que se puede filtrar por fecha directamente acá.',
        filas: agenteFilasContratos
    },
    calidad: {
        detalle: 'Controles de calidad de granos. Una fila por análisis, con calibres, defectos, humedad y totales en porcentaje. La columna "Grano" indica GARBANZO o POROTO_MUNG. Es independiente de las cargas: no se cruza con ellas.',
        filas: agenteFilasCalidad
    },
    tickets: {
        detalle: 'Ticketera de soporte interno: solicitante, responsable asignado, prioridad, estado del ticket, detalle y respuesta.',
        filas: agenteFilasTickets
    },
    muestreos: {
        detalle: 'Muestreos a campo. Una fila por muestreo: establecimiento, lote, campaña, cultivo, variedad y responsable.',
        filas: agenteFilasMuestreos
    },
    puntos_muestreo: {
        detalle: 'Puntos relevados dentro de cada muestreo: coordenadas, estado fenológico, tipo de observación, objetivo, severidad, incidencia y conteos. YA INCLUYE la fecha, el establecimiento y el lote del muestreo al que pertenece.',
        filas: agenteFilasPuntosMuestreo
    }
};

// =========================================================================
// 4. NORMALIZACIÓN DE VALORES
//    El Sheet devuelve texto tal como se ve: "25,20%", "1.234,56", "8/10/2025".
//    Estas funciones lo convierten a número o fecha para poder comparar.
// =========================================================================

function agenteTexto(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
}

// Marcas de acento que deja NFD al separarlas de su letra. Se arma con new RegExp
// y escapes \u para que el archivo no dependa de cómo se guarde el encoding.
const SIN_ACENTOS = new RegExp("[\\u0300-\\u036f]", "g");

// Clave para comparar y agrupar textos que son EL MISMO valor escrito distinto.
// En el Sheet conviven "8 mm" y "8mm", "3,5mm" y "3.5mm", "PLANTA" y "Planta".
// Sin esto, preguntar por "garbanzo 7mm" no encontraba las filas cargadas como
// "7 mm", y un total por calibre salía partido en dos renglones.
//
// Solo normaliza espacios, mayúsculas, acentos y la coma decimal: NO intenta
// adivinar que "Taborda Lucas" y "Lucas Taborda" son la misma persona.
function agenteClaveTexto(v) {
    return agenteTexto(v)
        .toLowerCase()
        .normalize("NFD").replace(SIN_ACENTOS, "") // MONZON con y sin tilde son lo mismo
        .replace(/,/g, ".")
        .replace(/\s+/g, "");
}

function agenteANumero(v) {
    if (typeof v === "number") return isNaN(v) ? null : v;
    let s = agenteTexto(v).replace(/%/g, "").replace(/\s/g, "").replace(/kg$/i, "");
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
        s = s.replace(/\./g, "").replace(",", ".");        // 1.234,56  → 1234.56
    } else if (/^-?\d+,\d+$/.test(s)) {
        s = s.replace(",", ".");                            // 25,20     → 25.20
    } else {
        s = s.replace(/,/g, "");                            // 1,234.56  → 1234.56
    }
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function agenteAFecha(v) {
    if (v instanceof Date) return v.getTime();
    const s = agenteTexto(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                   // 2025-10-08
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                 // 8/10/2025 (d/m/aaaa)
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);                // 8/10/25
    if (m) return Date.UTC(2000 + (+m[3]), +m[2] - 1, +m[1]);
    return null;
}

function agenteFechaLegible(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + "-" +
        String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(d.getUTCDate()).padStart(2, "0");
}

function agenteFormatearNumero(n) {
    if (typeof n !== "number" || isNaN(n)) return String(n);
    const decimales = Number.isInteger(n) ? 0 : 2;
    return n.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

// =========================================================================
// 5. CATÁLOGO / ESQUEMA
//    Se arma solo, mirando los datos reales. Si mañana agregás una columna
//    al Sheet, el agente la ve sin tocar una línea de código.
// =========================================================================

function agenteInferirColumnas(filas) {
    const muestra = filas.slice(0, AGENTE_CFG.maxFilasMuestreoEsquema);
    const nombres = [];
    muestra.forEach(function (f) {
        Object.keys(f || {}).forEach(function (k) {
            if (nombres.indexOf(k) === -1 && agenteColumnaVisible(k)) nombres.push(k);
        });
    });

    return nombres.map(function (col) {
        const valores = [];
        muestra.forEach(function (f) {
            const v = agenteTexto(f[col]);
            if (v !== "") valores.push(v);
        });
        if (!valores.length) return { nombre: col, tipo: "texto" };

        const numeros = valores.map(agenteANumero).filter(function (n) { return n !== null; });
        if (numeros.length >= valores.length * 0.6) return { nombre: col, tipo: "numero" };

        const fechas = valores.map(agenteAFecha).filter(function (n) { return n !== null; });
        if (fechas.length >= valores.length * 0.6) {
            return {
                nombre: col, tipo: "fecha",
                desde: agenteFechaLegible(Math.min.apply(null, fechas)),
                hasta: agenteFechaLegible(Math.max.apply(null, fechas))
            };
        }

        // Columna de texto: si tiene pocos valores distintos es un "enum" y al
        // planificador le sirve muchísimo conocerlos (así filtra con el string exacto).
        const distintos = [];
        for (let i = 0; i < valores.length; i++) {
            if (distintos.indexOf(valores[i]) === -1) distintos.push(valores[i]);
            if (distintos.length > AGENTE_CFG.maxValoresDistintos) break;
        }
        // Solo vale la pena listar los valores si son cortos y realmente parecen
        // categorías. Columnas como Estado_Correo guardan frases enteras
        // ("Enviado 22/08/2026 13:28 a fulano@... (vía app)") que gastan cientos
        // de tokens en cada pregunta sin ayudar a armar el plan.
        const largoMaximo = distintos.reduce(function (a, v) { return Math.max(a, v.length); }, 0);
        if (distintos.length <= AGENTE_CFG.maxValoresDistintos && largoMaximo <= AGENTE_CFG.maxLargoValor) {
            return { nombre: col, tipo: "texto", opciones: distintos };
        }
        return { nombre: col, tipo: "texto" };
    });
}

// Devuelve el catálogo como TEXTO plano y COMPACTO.
//
// El formato importa mucho: el catálogo viaja en CADA pregunta y el plan
// gratuito de Groq permite 8.000 tokens por minuto. Listar una línea por
// columna ("- Humedad (numero; de 5,20 a 18,40)") daba 8.200 caracteres con el
// Sheet real — casi la mitad del presupuesto de una pregunta.
//
// Agrupando las columnas por tipo en una sola línea y dejando línea propia solo
// a las que tienen valores fijos (ESTATUS, Grano, prioridad…), que son las que
// el planificador necesita conocer al detalle, baja a menos de un tercio.
function agenteConstruirEsquema() {
    const bloques = [];
    Object.keys(AGENTE_DATASETS).forEach(function (clave) {
        const ds = AGENTE_DATASETS[clave];
        let filas = [];
        try { filas = ds.filas() || []; } catch (e) { filas = []; }

        const cols = agenteInferirColumnas(filas);
        if (!cols.length) {
            bloques.push("DATASET " + clave + " (sin datos cargados) — " + ds.detalle);
            return;
        }

        const resumen = ds.resumen || {};
        const numeros = [], textos = [], fechas = [], enums = [], concatenadas = [];
        cols.forEach(function (c) {
            if (resumen[c.nombre]) concatenadas.push(c.nombre + " -> " + resumen[c.nombre]);
            else if (c.tipo === "numero") numeros.push(c.nombre);
            else if (c.tipo === "fecha") fechas.push(c.nombre + " (" + c.desde + " a " + c.hasta + ")");
            else if (c.opciones) enums.push("  " + c.nombre + " = " + c.opciones.join(" | "));
            else textos.push(c.nombre);
        });

        const lineas = ["DATASET " + clave + " (" + filas.length + " filas) — " + ds.detalle];
        if (fechas.length)  lineas.push("  fechas: " + fechas.join(", "));
        if (numeros.length) lineas.push("  numeros: " + numeros.join(", "));
        if (textos.length)  lineas.push("  textos: " + textos.join(", "));
        if (enums.length)   lineas.push(enums.join("\n"));
        if (concatenadas.length) {
            lineas.push('  CONCATENADAS (varios valores en una celda, "Garbanzo | Lenteja"): ' +
                concatenadas.join(", "));
            lineas.push('  -> NO agrupar ni sumar por estas. Para eso usá el dataset que indica la flecha.' +
                ' Acá solo sirven con el operador "contiene".');
        }
        bloques.push(lineas.join("\n"));
    });
    return bloques.join("\n\n");
}

// =========================================================================
// 6. EJECUCIÓN DEL PLAN (esto corre en el navegador, no en la IA)
// =========================================================================

function agenteComparar(celda, valorFiltro, op) {
    const numCelda = agenteANumero(celda);
    const numFiltro = agenteANumero(valorFiltro);
    const fechaCelda = agenteAFecha(celda);
    const fechaFiltro = agenteAFecha(valorFiltro);

    // Para >, <, >=, <=: se intenta primero como fecha y después como número.
    if (["=", "!=", ">", "<", ">=", "<="].indexOf(op) !== -1) {
        let a = null, b = null;
        if (fechaCelda !== null && fechaFiltro !== null) { a = fechaCelda; b = fechaFiltro; }
        else if (numCelda !== null && numFiltro !== null) { a = numCelda; b = numFiltro; }

        if (a !== null) {
            switch (op) {
                case "=":  return a === b;
                case "!=": return a !== b;
                case ">":  return a > b;
                case "<":  return a < b;
                case ">=": return a >= b;
                case "<=": return a <= b;
            }
        }
    }

    const textoCelda = agenteTexto(celda).toLowerCase();
    const textoFiltro = agenteTexto(valorFiltro).toLowerCase();
    switch (op) {
        // La igualdad usa la clave normalizada: preguntar por "7mm" tiene que
        // encontrar también las filas cargadas como "7 mm".
        case "=":  return agenteClaveTexto(celda) === agenteClaveTexto(valorFiltro);
        case "!=": return agenteClaveTexto(celda) !== agenteClaveTexto(valorFiltro);
        case ">":  return textoCelda > textoFiltro;
        case "<":  return textoCelda < textoFiltro;
        case ">=": return textoCelda >= textoFiltro;
        case "<=": return textoCelda <= textoFiltro;
    }
    return false;
}

// Los operadores "entre" y "en" esperan una lista, pero el modelo a veces la
// manda como texto: "[2026-04-01,2026-04-30]" en vez de ["2026-04-01","2026-04-30"].
// Sin esto el filtro no matcheaba nada y la consulta devolvía 0 filas en
// silencio, que es el peor error posible: parece una respuesta válida.
function agenteAlista(valor) {
    if (Array.isArray(valor)) return valor;
    const s = agenteTexto(valor);
    if (!s) return [];
    const limpio = s.replace(/^\[/, "").replace(/\]$/, "");
    if (limpio.indexOf(",") !== -1) {
        return limpio.split(",").map(function (x) {
            return x.trim().replace(/^["']/, "").replace(/["']$/, "");
        }).filter(function (x) { return x !== ""; });
    }
    return [s];
}

function agenteCumpleFiltro(fila, filtro) {
    if (!filtro || !filtro.columna) return true;
    const celda = fila[filtro.columna];
    const op = String(filtro.op || "=").toLowerCase();
    const valor = filtro.valor;

    switch (op) {
        case "contiene":
            return agenteTexto(celda).toLowerCase().indexOf(agenteTexto(valor).toLowerCase()) !== -1;
        case "no_contiene":
            return agenteTexto(celda).toLowerCase().indexOf(agenteTexto(valor).toLowerCase()) === -1;
        case "empieza_con":
            return agenteTexto(celda).toLowerCase().indexOf(agenteTexto(valor).toLowerCase()) === 0;
        case "vacio":
            return agenteTexto(celda) === "";
        case "no_vacio":
            return agenteTexto(celda) !== "";
        case "en":
            return agenteAlista(valor).some(function (v) {
                return agenteComparar(celda, v, "=");
            });
        case "entre": {
            const rango = agenteAlista(valor);
            if (rango.length < 2) return agenteComparar(celda, rango[0], "=");
            return agenteComparar(celda, rango[0], ">=") && agenteComparar(celda, rango[1], "<=");
        }
        default:
            return agenteComparar(celda, valor, op);
    }
}

function agenteCalcularMetrica(filas, metrica) {
    const fn = String(metrica.funcion || "contar").toLowerCase();
    if (fn === "contar") return filas.length;

    const col = metrica.columna;
    if (fn === "contar_distintos") {
        const vistos = [];
        filas.forEach(function (f) {
            const v = agenteTexto(f[col]);
            if (v && vistos.indexOf(v) === -1) vistos.push(v);
        });
        return vistos.length;
    }

    const nums = filas.map(function (f) { return agenteANumero(f[col]); })
                      .filter(function (n) { return n !== null; });
    if (!nums.length) return 0;

    let r;
    switch (fn) {
        case "suma":     r = nums.reduce(function (a, b) { return a + b; }, 0); break;
        case "promedio": r = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length; break;
        case "minimo": case "min": r = Math.min.apply(null, nums); break;
        case "maximo": case "max": r = Math.max.apply(null, nums); break;
        default: r = nums.length;
    }
    return Number(r.toFixed(2));
}

function agenteColumnasPorDefecto(filas) {
    const cols = [];
    (filas[0] ? Object.keys(filas[0]) : []).forEach(function (k) {
        if (agenteColumnaVisible(k) && cols.length < 8) cols.push(k);
    });
    return cols;
}

function agenteEjecutarPlan(plan) {
    const ds = AGENTE_DATASETS[plan.dataset];
    if (!ds) throw new Error('No existe el conjunto de datos "' + plan.dataset + '".');

    let filas = ds.filas() || [];
    const totalOriginal = filas.length;

    (Array.isArray(plan.filtros) ? plan.filtros : []).forEach(function (f) {
        filas = filas.filter(function (fila) { return agenteCumpleFiltro(fila, f); });
    });
    const totalFiltrado = filas.length;

    const metricas = (Array.isArray(plan.metricas) ? plan.metricas : [])
        .filter(function (m) { return m && m.funcion; });
    const grupos = (Array.isArray(plan.agrupar_por) ? plan.agrupar_por : [])
        .filter(function (g) { return !!g; });

    let datos, columnas, tipo;

    if (metricas.length || grupos.length) {
        tipo = "agregado";
        const mapa = new Map();
        if (grupos.length) {
            filas.forEach(function (fila) {
                const valores = grupos.map(function (g) { return agenteTexto(fila[g]) || "(sin dato)"; });
                // Se agrupa por la clave normalizada, así "8 mm" y "8mm" caen en
                // el mismo renglón en vez de partir el total en dos.
                const clave = JSON.stringify(valores.map(agenteClaveTexto));
                if (!mapa.has(clave)) mapa.set(clave, { valores: valores, filas: [], escrituras: {} });
                const g = mapa.get(clave);
                g.filas.push(fila);
                // Se cuenta cada forma de escribirlo para mostrar despues la mas
                // usada. Va como JSON y no como join de un separador porque los
                // valores tienen espacios ("8 mm", "Nahuel Castellano") y cualquier
                // separador de texto podria aparecer dentro del propio valor.
                const etiqueta = JSON.stringify(valores);
                g.escrituras[etiqueta] = (g.escrituras[etiqueta] || 0) + 1;
            });
            // El renglón se rotula con la escritura más frecuente del grupo.
            mapa.forEach(function (g) {
                let mejor = null, max = -1;
                Object.keys(g.escrituras).forEach(function (e) {
                    if (g.escrituras[e] > max) { max = g.escrituras[e]; mejor = e; }
                });
                if (mejor !== null) { try { g.valores = JSON.parse(mejor); } catch (e) { } }
            });
        } else {
            mapa.set("__total__", { valores: [], filas: filas });
        }

        datos = [];
        mapa.forEach(function (grupo) {
            const reg = {};
            grupos.forEach(function (g, i) { reg[g] = grupo.valores[i]; });
            if (!metricas.length) {
                reg["Cantidad"] = grupo.filas.length;
            } else {
                metricas.forEach(function (m) {
                    const alias = m.alias || (m.funcion + (m.columna ? " de " + m.columna : ""));
                    reg[alias] = agenteCalcularMetrica(grupo.filas, m);
                });
            }
            datos.push(reg);
        });
        columnas = Object.keys(datos[0] || {});
    } else {
        tipo = "detalle";
        columnas = (Array.isArray(plan.columnas) && plan.columnas.length)
            ? plan.columnas.filter(agenteColumnaVisible)
            : agenteColumnasPorDefecto(filas);
        datos = filas.map(function (fila) {
            const o = {};
            columnas.forEach(function (c) { o[c] = fila[c]; });
            return o;
        });
    }

    // Orden
    const orden = plan.orden;
    if (orden && orden.columna) {
        const desc = String(orden.direccion || "desc").toLowerCase().indexOf("asc") !== 0;
        datos.sort(function (a, b) {
            const na = agenteANumero(a[orden.columna]);
            const nb = agenteANumero(b[orden.columna]);
            let r;
            if (na !== null && nb !== null) {
                r = na - nb;
            } else {
                const fa = agenteAFecha(a[orden.columna]);
                const fb = agenteAFecha(b[orden.columna]);
                if (fa !== null && fb !== null) r = fa - fb;
                else r = agenteTexto(a[orden.columna]).localeCompare(agenteTexto(b[orden.columna]), "es");
            }
            return desc ? -r : r;
        });
    }

    const limite = Math.min(
        Number(plan.limite) > 0 ? Number(plan.limite) : AGENTE_CFG.maxFilasRespuesta,
        AGENTE_CFG.maxFilasRespuesta
    );
    const recortado = datos.length > limite;

    return {
        dataset: plan.dataset,
        tipo: tipo,
        columnas: columnas,
        filas_totales: totalOriginal,
        filas_que_cumplen_filtros: totalFiltrado,
        grupos_encontrados: datos.length,
        recortado: recortado,
        datos: datos.slice(0, limite)
    };
}

// =========================================================================
// 7. LLAMADA A LA IA (pasa por el Apps Script, que guarda la clave de Groq)
// =========================================================================

function agenteLlamarIA(mensajes, modoJson) {
    const cuerpo = JSON.stringify({
        _accion: "agente_consulta",
        modelo: AGENTE_CFG.modelo,
        esfuerzo: AGENTE_CFG.esfuerzo,
        json: !!modoJson,
        temperatura: modoJson ? 0 : 0.3,
        mensajes: mensajes
    });

    return fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: cuerpo
    })
    .then(function (res) { return res.text(); })
    .then(function (texto) {
        let data;
        try { data = JSON.parse(texto); }
        catch (e) { throw new Error("El backend no devolvió una respuesta válida. ¿Está publicada la última versión del Apps Script?"); }
        if (data.status === "error") throw new Error(data.message || "Error del agente");
        return String(data.contenido || "");
    });
}

// --- Prompt del planificador ---
// Se mantiene corto a propósito: viaja en cada pregunta y compite por el mismo
// presupuesto de tokens que el catálogo (ver agenteConstruirEsquema).
function agentePromptPlanificador(esquema) {
    return [
        "Analista de datos de App Braun (agroindustria). Traducís la pregunta del usuario",
        "a un PLAN DE CONSULTA en JSON. No tenés los datos, solo el catálogo: nunca inventes números.",
        "",
        "CATÁLOGO:",
        esquema,
        "",
        "Respondé SOLO este objeto JSON:",
        '{"tipo":"consulta"|"charla", "respuesta":"solo si charla", "dataset":"...",',
        ' "filtros":[{"columna":"...","op":"...","valor":"..."}], "agrupar_por":["..."],',
        ' "metricas":[{"funcion":"...","columna":"...","alias":"..."}],',
        ' "orden":{"columna":"...","direccion":"desc"}, "limite":10,',
        ' "columnas":["solo si no hay metricas"], "explicacion":"qué consultás, 1 frase"}',
        "",
        'op: = != > < >= <= contiene no_contiene empieza_con en(lista) entre([desde,hasta]) vacio no_vacio',
        'funcion: contar suma promedio minimo maximo contar_distintos',
        "",
        "REGLAS:",
        "1. Solo nombres de dataset y columna EXACTOS del catálogo.",
        "2. Fechas en aaaa-mm-dd. Si no aclara período, no filtres por fecha.",
        '3. "cuántos" -> metricas [{"funcion":"contar","alias":"Cantidad"}].',
        "4. Rankings -> agrupar_por la columna + orden por el alias de la métrica.",
        '5. Saludo, "qué podés hacer" o algo que no está en los datos -> tipo "charla".',
        '6. Sin metricas: poné 5 a 8 columnas útiles y un limite razonable.',
        "7. Usá el contexto de los mensajes anteriores.",
        "8. Elegí el dataset por el nivel de detalle que pide la pregunta: por producto o",
        "   calibre -> productos; por contrato, destino o carta de porte -> contratos;",
        "   por camión, chofer o estatus -> cargas. NUNCA agrupes por una columna",
        "   marcada como CONCATENADA."
    ].join("\n");
}

// --- Prompt del redactor ---
function agentePromptRedactor() {
    return [
        "Asistente de App Braun. Te paso la pregunta del usuario y el RESULTADO REAL de",
        "consultar los registros cargados en la app.",
        "",
        "- Contestá en castellano rioplatense, claro y directo, en pocas frases.",
        "- Usá SOLO los números del resultado. Prohibido inventar o estimar.",
        "- Mencioná sobre cuántos registros se calculó cuando aporte contexto.",
        "- Si vino vacío, decilo y sugerí cómo reformular.",
        "- Si está recortado, aclará que se muestran los primeros.",
        "- No repitas la tabla: la app ya la muestra abajo.",
        "- Nunca menciones Google Sheet, hojas, datasets ni nombres tecnicos de",
        "  columnas: para el usuario son los registros de la app. Hablá de cargas,",
        "  productos, contratos, controles de calidad, muestreos y tickets.",
        "- Texto plano: nada de markdown, asteriscos, tablas ni bloques de código.",
        "  Si enumerás, usá guiones al principio de la línea.",
        "- Números en formato argentino: coma decimal y punto de miles (12,5 / 28.500)."
    ].join("\n");
}

function agenteExtraerJson(texto) {
    let t = String(texto).trim();
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const desde = t.indexOf("{");
    const hasta = t.lastIndexOf("}");
    if (desde === -1 || hasta === -1) throw new Error("La IA no devolvió un plan en JSON.");
    return JSON.parse(t.substring(desde, hasta + 1));
}

// =========================================================================
// 8. CICLO COMPLETO DE UNA PREGUNTA
// =========================================================================

function agenteResponder(pregunta) {
    const esquema = agenteConstruirEsquema();

    const historial = agenteConversacion
        .slice(-AGENTE_CFG.maxTurnosMemoria)
        .map(function (m) { return { role: m.rol === "user" ? "user" : "assistant", content: m.texto }; });

    const mensajesPlan = [{ role: "system", content: agentePromptPlanificador(esquema) }]
        .concat(historial)
        .concat([{ role: "user", content: pregunta }]);

    return agenteLlamarIA(mensajesPlan, true).then(function (crudo) {
        const plan = agenteExtraerJson(crudo);

        if (plan.tipo === "charla" || !plan.dataset) {
            return {
                texto: plan.respuesta || "Contame qué dato del sistema necesitás y lo busco.",
                resultado: null,
                plan: plan
            };
        }

        const resultado = agenteEjecutarPlan(plan);

        let resumen = JSON.stringify(resultado);
        if (resumen.length > AGENTE_CFG.maxCaracteresResultado) {
            resumen = JSON.stringify(Object.assign({}, resultado, {
                datos: resultado.datos.slice(0, 10),
                recortado: true
            }));
        }

        const mensajesTexto = [
            { role: "system", content: agentePromptRedactor() },
            { role: "user", content:
                "PREGUNTA DEL USUARIO:\n" + pregunta +
                "\n\nQUÉ SE CONSULTÓ:\n" + (plan.explicacion || plan.dataset) +
                "\n\nRESULTADO (datos reales de la app):\n" + resumen
            }
        ];

        return agenteLlamarIA(mensajesTexto, false).then(function (texto) {
            return { texto: texto, resultado: resultado, plan: plan };
        });
    });
}

// =========================================================================
// 9. INTERFAZ DEL CHAT
// =========================================================================

function abrirAgenteIA() {
    const panel = document.getElementById("agente-panel");
    if (!panel) return;
    panel.classList.add("abierto");
    document.body.classList.add("agente-abierto");

    if (!agenteConversacion.length) {
        const cuerpo = document.getElementById("agente-mensajes");
        if (cuerpo && !cuerpo.children.length) {
            agentePintarMensaje("assistant",
                "¡Hola! Soy el asistente de App Braun.\n\n" +
                "Puedo responderte sobre todo lo que se cargo en la app: controles de carga, " +
                "productos, contratos, control de calidad, muestreos a campo y tickets.\n\n" +
                "Probá con alguna de estas:");
            agentePintarSugerencias([
                "¿Cuántas cargas hay por estatus?",
                "Humedad promedio de garbanzo",
                "Top 5 destinos por kilos",
                "Tickets abiertos por responsable"
            ]);
        }
    }

    const input = document.getElementById("agente-input");
    if (input) setTimeout(function () { input.focus(); }, 250);
}

function cerrarAgenteIA() {
    const panel = document.getElementById("agente-panel");
    if (panel) panel.classList.remove("abierto");
    document.body.classList.remove("agente-abierto");
}

function agenteLimpiarChat() {
    agenteConversacion = [];
    const cuerpo = document.getElementById("agente-mensajes");
    if (cuerpo) cuerpo.innerHTML = "";
    abrirAgenteIA();
}

function agenteScrollAbajo() {
    const cuerpo = document.getElementById("agente-mensajes");
    if (cuerpo) cuerpo.scrollTop = cuerpo.scrollHeight;
}

// Las burbujas se pintan con textContent (no innerHTML) para que ningún dato del
// Sheet pueda inyectar HTML. Como el modelo a veces igual devuelve markdown pese
// a que se le pide texto plano, se limpian las marcas para no mostrar "**12,5**".
function agenteLimpiarMarkdown(texto) {
    return String(texto)
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(^|\s)\*(\S[^*]*?)\*/g, "$1$2")
        .replace(/`{1,3}/g, "")
        .replace(/^\s*#{1,6}\s*/gm, "")
        .replace(/^\s*[*•]\s+/gm, "- ")
        .trim();
}

function agentePintarMensaje(rol, texto, clase) {
    const cuerpo = document.getElementById("agente-mensajes");
    if (!cuerpo) return null;
    const esBot = rol !== "user";
    const div = document.createElement("div");
    div.className = "agente-msg agente-msg-" + (esBot ? "bot" : "user") + (clase ? " " + clase : "");
    const burbuja = document.createElement("div");
    burbuja.className = "agente-burbuja";
    burbuja.textContent = esBot ? agenteLimpiarMarkdown(texto) : texto;
    div.appendChild(burbuja);
    cuerpo.appendChild(div);
    agenteScrollAbajo();
    return div;
}

function agentePintarSugerencias(lista) {
    const cuerpo = document.getElementById("agente-mensajes");
    if (!cuerpo) return;
    const cont = document.createElement("div");
    cont.className = "agente-sugerencias";
    lista.forEach(function (s) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "agente-chip";
        chip.textContent = s;
        chip.onclick = function () {
            const input = document.getElementById("agente-input");
            if (input) { input.value = s; agenteEnviar(); }
        };
        cont.appendChild(chip);
    });
    cuerpo.appendChild(cont);
    agenteScrollAbajo();
}

// Tabla de respaldo debajo de la respuesta: le deja al usuario ver el dato crudo.
function agentePintarTabla(resultado) {
    if (!resultado || !resultado.datos || !resultado.datos.length) return;
    const cuerpo = document.getElementById("agente-mensajes");
    if (!cuerpo) return;

    const caja = document.createElement("div");
    caja.className = "agente-tabla-caja";

    const titulo = document.createElement("div");
    titulo.className = "agente-tabla-titulo";
    titulo.textContent = resultado.dataset + " · " +
        resultado.filas_que_cumplen_filtros + " de " + resultado.filas_totales + " registros" +
        (resultado.recortado ? " (se muestran los primeros " + resultado.datos.length + ")" : "");
    caja.appendChild(titulo);

    const scroll = document.createElement("div");
    scroll.className = "agente-tabla-scroll";
    const tabla = document.createElement("table");
    tabla.className = "agente-tabla";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    resultado.columnas.forEach(function (c) {
        const th = document.createElement("th");
        th.textContent = c;
        trh.appendChild(th);
    });
    thead.appendChild(trh);
    tabla.appendChild(thead);

    const tbody = document.createElement("tbody");
    resultado.datos.forEach(function (fila) {
        const tr = document.createElement("tr");
        resultado.columnas.forEach(function (c) {
            const td = document.createElement("td");
            const v = fila[c];
            td.textContent = (typeof v === "number") ? agenteFormatearNumero(v) : agenteTexto(v);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    scroll.appendChild(tabla);
    caja.appendChild(scroll);
    cuerpo.appendChild(caja);
    agenteScrollAbajo();
}

function agenteEnviar() {
    const input = document.getElementById("agente-input");
    if (!input || agenteOcupado) return;
    const pregunta = input.value.trim();
    if (!pregunta) return;

    if (!navigator.onLine) {
        agentePintarMensaje("assistant", "Estás sin conexión. El asistente necesita internet para pensar; los datos que ya tenés cargados se siguen viendo en las pantallas.");
        return;
    }

    input.value = "";
    input.style.height = "auto";
    agentePintarMensaje("user", pregunta);
    agenteConversacion.push({ rol: "user", texto: pregunta });

    agenteOcupado = true;
    const boton = document.getElementById("agente-enviar");
    if (boton) boton.disabled = true;

    const pensando = agentePintarMensaje("assistant", "Buscando en los registros…", "agente-pensando");

    agenteResponder(pregunta)
        .then(function (r) {
            if (pensando) pensando.remove();
            agentePintarMensaje("assistant", r.texto);
            agenteConversacion.push({ rol: "assistant", texto: r.texto });
            agentePintarTabla(r.resultado);
        })
        .catch(function (err) {
            if (pensando) pensando.remove();
            console.error("Agente IA:", err);
            agentePintarMensaje("assistant", "Uy, no pude responder eso.\n\nMotivo: " + (err && err.message ? err.message : err));
        })
        .finally(function () {
            agenteOcupado = false;
            if (boton) boton.disabled = false;
            if (input) input.focus();
        });
}

// Enter envía, Shift+Enter hace salto de línea. El textarea crece solo.
document.addEventListener("DOMContentLoaded", function () {
    const input = document.getElementById("agente-input");
    if (!input) return;
    input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            agenteEnviar();
        }
    });
    input.addEventListener("input", function () {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
});
