// ============================================================================
//  ORDEN DE CARGA — el paso previo al Control de Transporte
// ----------------------------------------------------------------------------
//  Qué es: la OC la arma la oficina y se le manda a la planta como informe de
//  los camiones que van. Después el operario de planta la CONTINÚA en Control
//  de Transporte, sin volver a cargar nada del camión, del chofer ni de los
//  lotes: solo el checklist, las fotos y las firmas.
//
//  El modelo sale del Excel real (CN26-063, OC 2056) y tiene CUATRO niveles,
//  uno más que la hoja `Orden` de hoy:
//
//      OC          cabecera: especie, cosecha, destino, destinatario, fletes
//       └ CAMIÓN   transportista + CUIT, chofer + CUIL, dominios, km, tarifa
//          └ CP    productor, CTG, peso neto, CTTO comercial
//             └ LOTE   lote BRC, lote planta, bolsas, kg/bolsa, calibre
//
//  El nivel que falta hoy es el del medio: en el Sheet, `Producto` y
//  `Contrato Comercial` cuelgan los dos de `Id_Carga` como hermanos, así que
//  los lotes no saben a qué carta de porte pertenecen. Acá sí: cada CP declara
//  un peso neto que se compone de lotes concretos.
//
//  ESTADO: este archivo arma la PANTALLA y los cálculos. Todavía NO escribe en
//  el Sheet ni genera el Control de Transporte: el borrador se guarda en el
//  navegador (localStorage). Nada de esto toca el flujo de Control de
//  Transporte que ya funciona — es un módulo aparte, y los registros PT viejos
//  siguen igual, sin OC asociada.
//
//  Reutiliza de app.js: poblarSelect(), parseNumeroAR(), formatNumeroAR(),
//  scrollATarjeta(), cambiarVista(). Por eso el <script> va DESPUÉS de app.js.
// ============================================================================

// Las órdenes guardadas y el borrador de la que se está escribiendo. Son dos
// cosas distintas: la lista es lo que se ve en el historial, y el borrador es
// el respaldo de lo que hay en pantalla ahora mismo, por si se cierra la app.
// Solo para migrar lo que haya quedado de la version anterior (ver 5.6).
const OC_LISTA_KEY = 'braun_ordenes_carga';
const OC_STORAGE_KEY = 'braun_orden_carga_borrador';

// Contador propio para los ids internos de las tarjetas anidadas. No es el
// número de OC: es solo para que cada camión/CP tenga un contenedor con id
// único al que colgarle sus hijos.
let ocSecuencia = 0;
function ocNuevoId(prefijo) { ocSecuencia += 1; return prefijo + '-' + ocSecuencia; }

// Qué orden se está editando. null = se está creando una nueva.
let ocIdEditando = null;

// =========================================================================
// --- 1. ENTRADA AL MÓDULO Y PESTAÑAS --------------------------------------
// =========================================================================
// Misma lógica que Control de Transporte: al módulo se entra por el HISTORIAL,
// y el botón "Nueva Orden" abre el formulario. Por eso las dos pestañas y el
// ocSwitchTab propio, calcado de switchTab() pero con sus ids.

function abrirOrdenCarga() {
    cambiarVista('view-orden-carga');
    // Los selects de la cabecera comparten las listas del resto de la app
    // (el mismo gestor de Opciones), así que se pueblan desde ENUMS.
    document.querySelectorAll('#form-oc > .form-group-row .enum-select, #form-oc > .form-group .enum-select')
        .forEach(sel => poblarSelect(sel, sel.dataset.enum, sel.value || ''));
    ocSwitchTab('historial');
    // Se baja lo que hay en el Sheet y se vuelve a pintar: así el historial
    // aparece al instante con lo que ya estaba y se completa cuando llega.
    ocMigrarOrdenesViejas()
        .then(ocCargarOrdenesDesdeGoogle)
        .then(ocRenderHistorial);
}

function ocSwitchTab(tab) {
    document.getElementById('tab-content-historial-oc').classList.toggle('hidden', tab === 'nuevo');
    document.getElementById('tab-content-nuevo-oc').classList.toggle('hidden', tab !== 'nuevo');
    // Los filtros son del historial: arriba de un formulario no pintan nada.
    document.getElementById('oc-filtros').classList.toggle('hidden', tab === 'nuevo');
    if (tab === 'nuevo') window.scrollTo({ top: 0, behavior: 'smooth' });
    else ocRenderHistorial();
}

// Botón "Nueva Orden". Si quedó un borrador a medio escribir de una sesión
// anterior, se ofrece recuperarlo antes de pisarlo.
function ocNuevaOrden() {
    const borrador = ocLeerBorrador();
    let titulo = 'Crear Nueva Orden de Carga';
    if (borrador && confirm('Quedó una orden a medio cargar.\n\n¿Querés seguir con esa?\n\nAceptar = seguir con la que estaba.\nCancelar = empezar una nueva en blanco.')) {
        ocIdEditando = borrador.Id_OC || null;
        ocAplicarDatos(borrador);
        titulo = 'Continuar Orden de Carga';
    } else {
        ocLimpiarFormulario();
    }
    document.getElementById('oc-form-titulo').textContent = titulo;
    ocSwitchTab('nuevo');
}

function ocLimpiarFormulario() {
    ocIdEditando = null;
    document.getElementById('form-oc').reset();
    document.getElementById('oc-fecha').valueAsDate = new Date();
    document.getElementById('oc-numero').value = ocProximoNumero();
    document.getElementById('oc-validacion').classList.add('hidden');
    document.getElementById('wrapper-camiones').innerHTML = '';
    ocSecuencia = 0;
    ocAgregarCamion();
    ocRecalcularTodo();
}

// El número de orden hoy lo pone una persona a mano, que es justo lo que este
// módulo viene a sacar. Se propone el siguiente de la serie que ya está
// guardada, y se puede corregir a mano si hace falta.
function ocProximoNumero() {
    const numeros = (ocUltimasListadas || []).concat(ocHistorialRemoto || [])
        .map(o => parseInt(String(o.Nro_OC || '').replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n));
    return numeros.length ? String(Math.max.apply(null, numeros) + 1) : '';
}

// =========================================================================
// --- 2. TARJETAS ANIDADAS: CAMIÓN > CARTA DE PORTE > LOTE -----------------
// =========================================================================
// Mismo patrón visual que las tarjetas de producto/contrato del control: se
// pueden colapsar a una línea de resumen, duplicar y borrar. Lo que cambia es
// que acá están anidadas en tres niveles, así que cada nivel lleva su propio
// wrapper con un id único.

function ocEncabezadoHtml(etiqueta, funcionDuplicar, nivel) {
    return `
        <div class="dynamic-card-header oc-header-${nivel}" onclick="ocAlternarTarjeta(this)">
            <div class="card-header-texto">
                <span class="card-titulo">${etiqueta} #1</span>
                <span class="card-resumen"></span>
            </div>
            <div class="card-header-acciones">
                <button type="button" class="btn-card-accion" title="Duplicar"
                        onclick="event.stopPropagation(); ${funcionDuplicar}(this)"><i class="fas fa-copy"></i></button>
                <button type="button" class="btn-card-accion borrar" title="Eliminar"
                        onclick="event.stopPropagation(); ocEliminarTarjeta(this)"><i class="fas fa-trash-alt"></i></button>
                <i class="fas fa-chevron-up card-chevron"></i>
            </div>
        </div>`;
}

// --- 2.1. CAMIÓN ---------------------------------------------------------

function ocAgregarCamion(opciones) {
    opciones = opciones || {};
    const wrapper = document.getElementById('wrapper-camiones');
    const idCps = ocNuevoId('cps');

    const card = document.createElement('div');
    card.className = 'dynamic-item-card oc-camion';
    card.innerHTML = `
        ${ocEncabezadoHtml('Camión', 'ocDuplicarCamion', 'camion')}
        <div class="dynamic-card-body">
            <div class="form-group-row">
                <div class="form-group"><label>Transportista (razón social)</label><input type="text" class="oc-camion-item" data-field="transportista" placeholder="Razón social del transportista"></div>
                <div class="form-group"><label>CUIT transportista</label><input type="text" class="oc-camion-item campo-cuit" data-field="transportista_cuit" inputmode="numeric" placeholder="30-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Chofer (nombre y apellido)</label><input type="text" class="oc-camion-item" data-field="chofer" placeholder="Apellido y nombre"></div>
                <div class="form-group"><label>CUIT / CUIL chofer</label><input type="text" class="oc-camion-item campo-cuit" data-field="chofer_cuil" inputmode="numeric" placeholder="20-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Dominio camión</label><input type="text" class="oc-camion-item campo-dominio" data-field="dominio_camion" placeholder="AA000AA"></div>
                <div class="form-group"><label>Dominio acoplado</label><input type="text" class="oc-camion-item campo-dominio" data-field="dominio_acoplado" placeholder="AA000AA"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Km a recorrer</label><input type="text" inputmode="decimal" class="oc-camion-item campo-numero-ar" data-field="km"></div>
                <div class="form-group"><label>Tarifa</label><input type="text" inputmode="decimal" class="oc-camion-item campo-numero-ar" data-field="tarifa"></div>
            </div>

            <div class="section-dynamic-header oc-sub-header">
                <h4>Cartas de Porte <span class="contador-items oc-contador-cps">1</span></h4>
                <span class="oc-total-camion">0 kg</span>
            </div>
            <div class="oc-wrapper-cps" id="${idCps}"></div>
            <button type="button" class="btn-agregar-item oc-btn-sub" onclick="ocAgregarCp('${idCps}', { enfocar: true })">
                <i class="fas fa-plus"></i> Añadir otra carta de porte
            </button>
        </div>
    `;
    wrapper.appendChild(card);

    ocAplicarValores(card, 'oc-camion-item', opciones.valores);
    card.querySelectorAll('.oc-camion-item').forEach(el => el.addEventListener('input', ocRecalcularTodo));

    // Un camión sin ninguna CP no existe: arranca con una.
    if (opciones.cps && opciones.cps.length) {
        opciones.cps.forEach(cp => ocAgregarCp(idCps, { valores: cp.valores, lotes: cp.lotes }));
    } else {
        ocAgregarCp(idCps);
    }

    ocRenumerar(wrapper, 'Camión');
    ocRecalcularTodo();
    if (opciones.enfocar) ocEnfocarTarjeta(wrapper, card, 'transportista');
    return card;
}

// En la práctica el mismo camión hace varios viajes, o vuelve a aparecer con
// otra carta de porte. En el Excel eso obliga a tipear de nuevo razón social,
// CUIT, chofer y dominios; acá se copia todo y queda una CP vacía para llenar.
function ocDuplicarCamion(boton) {
    const origen = boton.closest('.oc-camion');
    ocAgregarCamion({ valores: ocValoresDe(origen, 'oc-camion-item'), enfocar: true });
}

// --- 2.2. CARTA DE PORTE -------------------------------------------------

function ocAgregarCp(idWrapper, opciones) {
    opciones = opciones || {};
    const wrapper = document.getElementById(idWrapper);
    if (!wrapper) return;
    const idLotes = ocNuevoId('lotes');

    const card = document.createElement('div');
    card.className = 'dynamic-item-card oc-cp';
    card.innerHTML = `
        ${ocEncabezadoHtml('Carta de Porte', 'ocDuplicarCp', 'cp')}
        <div class="dynamic-card-body">
            <div class="form-group-row">
                <div class="form-group"><label>Productor</label><input type="text" class="oc-cp-item" data-field="productor" placeholder="Razón social del productor"></div>
                <div class="form-group"><label>Contrato Comercial (CTTO)</label><input type="text" class="oc-cp-item" data-field="contrato_com" placeholder="CN26-081 B"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group">
                    <label>CTG <span class="oc-ayuda">11 dígitos</span></label>
                    <input type="text" class="oc-cp-item campo-ctg" data-field="ctg" inputmode="numeric" maxlength="11" placeholder="11 dígitos">
                </div>
                <div class="form-group"><label>N° Carta de Porte</label><input type="text" class="oc-cp-item" data-field="carta_porte"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group">
                    <label>Peso neto declarado</label>
                    <input type="text" inputmode="decimal" class="oc-cp-item campo-numero-ar oc-peso-neto" data-field="peso_neto">
                </div>
                <div class="form-group">
                    <label>Suma de los lotes</label>
                    <input type="text" class="campo-calculado campo-numero-ar oc-suma-lotes" readonly>
                </div>
            </div>
            <p class="oc-aviso-peso hidden"></p>
            <div class="form-group">
                <label>Observaciones CP <span class="oc-ayuda">se arma sola</span></label>
                <input type="text" class="oc-cp-item campo-calculado oc-obs-cp" data-field="observaciones" readonly>
            </div>

            <div class="section-dynamic-header oc-sub-header">
                <h5>Lotes a cargar <span class="contador-items oc-contador-lotes">1</span></h5>
                <span class="oc-total-cp">0 kg</span>
            </div>
            <div class="oc-wrapper-lotes" id="${idLotes}"></div>
            <button type="button" class="btn-agregar-item oc-btn-sub" onclick="ocAgregarLote('${idLotes}', { enfocar: true })">
                <i class="fas fa-plus"></i> Añadir otro lote
            </button>
        </div>
    `;
    wrapper.appendChild(card);

    ocAplicarValores(card, 'oc-cp-item', opciones.valores);
    card.querySelectorAll('.oc-cp-item').forEach(el => el.addEventListener('input', ocRecalcularTodo));

    if (opciones.lotes && opciones.lotes.length) {
        opciones.lotes.forEach(valores => ocAgregarLote(idLotes, { valores: valores }));
    } else {
        ocAgregarLote(idLotes);
    }

    ocRenumerar(wrapper, 'Carta de Porte');
    ocRecalcularTodo();
    if (opciones.enfocar) ocEnfocarTarjeta(wrapper, card, 'productor');
    return card;
}

// El mismo camión suele llevar dos CP que solo cambian de productor y contrato.
function ocDuplicarCp(boton) {
    const origen = boton.closest('.oc-cp');
    const valores = ocValoresDe(origen, 'oc-cp-item');
    valores.ctg = '';          // el CTG es único por carta de porte
    valores.peso_neto = '';
    ocAgregarCp(origen.parentElement.id, { valores: valores, enfocar: true });
}

// --- 2.3. LOTE -----------------------------------------------------------

function ocAgregarLote(idWrapper, opciones) {
    opciones = opciones || {};
    const wrapper = document.getElementById(idWrapper);
    if (!wrapper) return;

    const card = document.createElement('div');
    card.className = 'dynamic-item-card oc-lote';
    card.innerHTML = `
        ${ocEncabezadoHtml('Lote', 'ocDuplicarLote', 'lote')}
        <div class="dynamic-card-body">
            <div class="form-group-row">
                <div class="form-group"><label>N° Lote BRC</label><input type="text" class="oc-lote-item" data-field="lote_brc" placeholder="0000"></div>
                <div class="form-group"><label>N° Lote Planta</label><input type="text" class="oc-lote-item" data-field="lote_planta" placeholder="LT-000"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Tipo</label><select class="oc-lote-item enum-select" data-field="tipo" data-enum="tipoCarga"></select></div>
                <div class="form-group"><label>Calibre</label><select class="oc-lote-item enum-select" data-field="calibre" data-enum="calibre"></select></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Cant. de bolsas</label><input type="text" inputmode="decimal" class="oc-lote-item campo-numero-ar oc-bolsas" data-field="bolsas" value="0"></div>
                <div class="form-group"><label>Kg por bolsa</label><input type="text" inputmode="decimal" class="oc-lote-item campo-numero-ar oc-kg-bolsa" data-field="kg_bolsa" value="25"></div>
                <div class="form-group"><label>Total Kg</label><input type="text" class="oc-lote-item campo-calculado campo-numero-ar oc-total-lote" data-field="total_kg" readonly></div>
            </div>
        </div>
    `;
    wrapper.appendChild(card);

    card.querySelectorAll('.enum-select').forEach(sel => poblarSelect(sel, sel.dataset.enum, ''));
    ocAplicarValores(card, 'oc-lote-item', opciones.valores);
    card.querySelectorAll('.oc-lote-item').forEach(el => el.addEventListener('input', ocRecalcularTodo));
    card.querySelectorAll('select.oc-lote-item').forEach(el => el.addEventListener('change', ocRecalcularTodo));

    ocRenumerar(wrapper, 'Lote');
    ocRecalcularTodo();
    if (opciones.enfocar) ocEnfocarTarjeta(wrapper, card, 'lote_brc');
    return card;
}

// Un lote se parte entre camiones y cartas de porte (en la OC 2056 el lote 4380
// aparece en los dos camiones), así que duplicar conserva el lote y deja las
// bolsas en cero para escribir cuántas van acá.
function ocDuplicarLote(boton) {
    const origen = boton.closest('.oc-lote');
    const valores = ocValoresDe(origen, 'oc-lote-item');
    valores.bolsas = '0';
    ocAgregarLote(origen.parentElement.id, { valores: valores, enfocar: 'bolsas' });
}

// =========================================================================
// --- 3. CÁLCULOS ----------------------------------------------------------
// =========================================================================
// Todo se recalcula de abajo hacia arriba: lote -> CP -> camión -> OC. Es
// barato (una OC tiene diez o quince renglones) y evita tener que decidir qué
// se volvió a tocar.

function ocRecalcularTodo() {
    const nroOc = (document.getElementById('oc-numero').value || '').trim();
    let totalOc = 0, bolsasOc = 0;
    const porLote = {};   // acumulado por lote BRC a lo largo de TODA la OC

    document.querySelectorAll('#wrapper-camiones .oc-camion').forEach(camion => {
        let totalCamion = 0;

        camion.querySelectorAll(':scope .oc-wrapper-cps > .oc-cp').forEach(cp => {
            let totalCp = 0, bolsasCp = 0;

            cp.querySelectorAll(':scope .oc-wrapper-lotes > .oc-lote').forEach(lote => {
                const bolsas = parseNumeroAR(lote.querySelector('.oc-bolsas').value);
                const kgBolsa = parseNumeroAR(lote.querySelector('.oc-kg-bolsa').value);
                const total = bolsas * kgBolsa;
                lote.querySelector('.oc-total-lote').value = formatNumeroAR(total, 2);
                totalCp += total;
                bolsasCp += bolsas;

                const brc = (lote.querySelector('[data-field="lote_brc"]').value || '').trim();
                if (brc) {
                    if (!porLote[brc]) porLote[brc] = { bolsas: 0, kg: 0 };
                    porLote[brc].bolsas += bolsas;
                    porLote[brc].kg += total;
                }
                ocResumenTarjeta(lote, 'lote');
            });

            // "OC 2056 (1069 BLS)" — el formato exacto que ya usan a mano en el
            // Excel. Se arma solo, no se escribe.
            cp.querySelector('.oc-obs-cp').value = nroOc
                ? 'OC ' + nroOc + ' (' + formatNumeroAR(bolsasCp, 0) + ' BLS)'
                : '';
            cp.querySelector('.oc-suma-lotes').value = formatNumeroAR(totalCp, 2);
            cp.querySelector('.oc-total-cp').textContent = formatNumeroAR(totalCp, 0) + ' kg';
            ocAvisarDiferenciaPeso(cp, totalCp);
            ocContar(cp, '.oc-wrapper-lotes > .oc-lote', '.oc-contador-lotes');
            ocResumenTarjeta(cp, 'cp');

            totalCamion += totalCp;
            bolsasOc += bolsasCp;
        });

        camion.querySelector('.oc-total-camion').textContent = formatNumeroAR(totalCamion, 0) + ' kg';
        ocContar(camion, '.oc-wrapper-cps > .oc-cp', '.oc-contador-cps');
        ocResumenTarjeta(camion, 'camion');
        totalOc += totalCamion;
    });

    ocPintarTotales(totalOc, bolsasOc, porLote);
    ocGuardarBorrador();
}

// El peso neto de la carta de porte puede no coincidir con la suma de los
// lotes: en la OC 2056 la primera CP declara 26.695 y los lotes dan 26.715.
// No sabemos todavía si eso es la balanza o un error de tipeo, así que por
// ahora se AVISA y no se bloquea.
function ocAvisarDiferenciaPeso(cp, sumaLotes) {
    const aviso = cp.querySelector('.oc-aviso-peso');
    const declarado = parseNumeroAR(cp.querySelector('.oc-peso-neto').value);
    if (!declarado || !sumaLotes) { aviso.classList.add('hidden'); return; }
    const dif = declarado - sumaLotes;
    if (Math.abs(dif) < 0.5) { aviso.classList.add('hidden'); return; }
    aviso.textContent = (dif > 0 ? 'El peso declarado supera la suma de los lotes en ' : 'La suma de los lotes supera el peso declarado en ')
        + formatNumeroAR(Math.abs(dif), 2) + ' kg.';
    aviso.classList.remove('hidden');
}

function ocPintarTotales(totalOc, bolsasOc, porLote) {
    document.getElementById('oc-total-kg').textContent = formatNumeroAR(totalOc, 0) + ' kg';
    document.getElementById('oc-total-bolsas').textContent = formatNumeroAR(bolsasOc, 0);
    document.getElementById('oc-total-camiones').textContent = document.querySelectorAll('#wrapper-camiones .oc-camion').length;

    // Objetivo de kg: la OC 2056 cierra en 75.000 exactos, así que se arma
    // contra un número y conviene ver cuánto falta.
    const objetivo = parseNumeroAR(document.getElementById('oc-objetivo-kg').value);
    const cajaFalta = document.getElementById('oc-falta');
    if (objetivo > 0) {
        const falta = objetivo - totalOc;
        cajaFalta.classList.remove('hidden');
        cajaFalta.textContent = falta === 0
            ? 'Completo: ' + formatNumeroAR(objetivo, 0) + ' kg'
            : (falta > 0 ? 'Faltan ' + formatNumeroAR(falta, 0) + ' kg'
                         : 'Se pasó por ' + formatNumeroAR(-falta, 0) + ' kg');
        cajaFalta.classList.toggle('oc-ok', falta === 0);
        cajaFalta.classList.toggle('oc-excedido', falta < 0);
    } else {
        cajaFalta.classList.add('hidden');
    }

    // El acumulado por lote es lo que después permite avisar "estás cargando
    // más bolsas de las que tiene el lote", cuando tengamos el stock.
    const caja = document.getElementById('oc-resumen-lotes');
    const claves = Object.keys(porLote).sort();
    caja.innerHTML = claves.length === 0
        ? '<p class="oc-vacio">Todavía no hay lotes cargados.</p>'
        : claves.map(k => `<div class="oc-lote-fila">
               <span class="oc-lote-nombre">Lote ${k}</span>
               <span class="oc-lote-bolsas">${formatNumeroAR(porLote[k].bolsas, 0)} bolsas</span>
               <span class="oc-lote-kg">${formatNumeroAR(porLote[k].kg, 0)} kg</span>
           </div>`).join('');
}

// =========================================================================
// --- 4. RESÚMENES, CONTADORES Y TARJETAS ----------------------------------
// =========================================================================

function ocValorCampo(card, campo) {
    const el = card.querySelector(`[data-field="${campo}"]`);
    return el ? (el.value || '').trim() : '';
}

// La línea que se ve cuando la tarjeta está colapsada.
function ocResumenTarjeta(card, nivel) {
    const resumen = card.querySelector(':scope > .dynamic-card-header .card-resumen');
    if (!resumen) return;
    let partes;
    if (nivel === 'lote') {
        partes = [ocValorCampo(card, 'lote_brc') ? 'Lote ' + ocValorCampo(card, 'lote_brc') : '',
                  ocValorCampo(card, 'lote_planta'), ocValorCampo(card, 'calibre'),
                  ocValorCampo(card, 'bolsas') ? ocValorCampo(card, 'bolsas') + ' bls' : '',
                  ocValorCampo(card, 'total_kg') ? ocValorCampo(card, 'total_kg') + ' kg' : ''];
    } else if (nivel === 'cp') {
        partes = [ocValorCampo(card, 'productor'), ocValorCampo(card, 'contrato_com'),
                  ocValorCampo(card, 'ctg') ? 'CTG ' + ocValorCampo(card, 'ctg') : '',
                  card.querySelector('.oc-total-cp').textContent];
    } else {
        partes = [ocValorCampo(card, 'dominio_camion'), ocValorCampo(card, 'chofer'),
                  ocValorCampo(card, 'transportista'), card.querySelector('.oc-total-camion').textContent];
    }
    resumen.textContent = partes.filter(Boolean).join(' · ') || 'Sin completar';
}

function ocContar(card, selectorHijos, selectorContador) {
    const contador = card.querySelector(':scope ' + selectorContador);
    if (contador) contador.textContent = card.querySelectorAll(':scope ' + selectorHijos).length;
}

// Renumera los títulos del nivel que corresponda y esconde el botón de borrar
// cuando queda uno solo (no tiene sentido una OC sin camiones).
function ocRenumerar(wrapper, etiqueta) {
    const cards = Array.prototype.filter.call(wrapper.children, c => c.classList.contains('dynamic-item-card'));
    cards.forEach((card, i) => {
        const titulo = card.querySelector(':scope > .dynamic-card-header .card-titulo');
        if (titulo) titulo.textContent = `${etiqueta} #${i + 1}`;
        card.classList.toggle('unico', cards.length === 1);
    });
}

function ocEtiquetaDe(card) {
    if (card.classList.contains('oc-camion')) return 'Camión';
    if (card.classList.contains('oc-cp')) return 'Carta de Porte';
    return 'Lote';
}

function ocEliminarTarjeta(boton) {
    const card = boton.closest('.dynamic-item-card');
    const wrapper = card.parentElement;
    const hermanas = Array.prototype.filter.call(wrapper.children, c => c.classList.contains('dynamic-item-card'));
    if (hermanas.length <= 1) {
        alert('Tiene que quedar al menos un ' + ocEtiquetaDe(card).toLowerCase() + '. Si no lo necesitás, dejalo vacío.');
        return;
    }
    card.remove();
    ocRenumerar(wrapper, ocEtiquetaDe(card));
    ocRecalcularTodo();
}

// Colapsar/expandir. Cada tarjeta se ocupa SOLO de sí misma: el header de un
// camión no debe cerrar las CP que tiene adentro, por eso el closest() se
// resuelve contra el header al que se le hizo clic.
function ocAlternarTarjeta(header) {
    header.parentElement.classList.toggle('colapsada');
}

function ocEnfocarTarjeta(wrapper, card, campo) {
    Array.prototype.forEach.call(wrapper.children, otra => {
        if (otra !== card && otra.classList && otra.classList.contains('dynamic-item-card')) {
            ocResumenTarjeta(otra, otra.classList.contains('oc-camion') ? 'camion'
                                 : otra.classList.contains('oc-cp') ? 'cp' : 'lote');
            otra.classList.add('colapsada');
        }
    });
    setTimeout(() => {
        scrollATarjeta(card);
        const destino = card.querySelector(`[data-field="${campo}"]`);
        if (destino) { try { destino.focus({ preventScroll: true }); } catch (e) { destino.focus(); } }
    }, 60);
}

function ocValoresDe(card, claseItem) {
    const valores = {};
    card.querySelectorAll(':scope > .dynamic-card-body .' + claseItem).forEach(el => {
        valores[el.dataset.field] = el.value;
    });
    return valores;
}

function ocAplicarValores(card, claseItem, valores) {
    if (!valores) return;
    card.querySelectorAll(':scope > .dynamic-card-body .' + claseItem).forEach(el => {
        const valor = valores[el.dataset.field];
        if (valor === undefined) return;
        if (el.tagName === 'SELECT') poblarSelect(el, el.dataset.enum, valor);
        else el.value = valor;
    });
}

// =========================================================================
// --- 5. GUARDADO EN EL SHEET, HISTORIAL Y BORRADOR ------------------------
// =========================================================================
// Las órdenes se guardan en las hojas Orden_Carga / OC_Camion / OC_CartaPorte /
// OC_Lote (ver 05_orden_carga.gs). Mismo camino que el resto de la app:
//
//   1. se escribe PRIMERO en este dispositivo (IndexedDB, store "ordenes_carga")
//   2. se sincroniza con el Sheet apenas hay señal
//   3. el historial muestra lo del Sheet MÁS lo que todavía está pendiente acá
//
// El orden importa: si se mandara primero y se guardara después, una orden
// armada sin señal se perdería. En una oficina eso parece exagerado, pero es el
// mismo criterio que ya usan Carga, Calidad y Ticketera, y sale gratis.

const OC_STORE = 'ordenes_carga';

// Mapa entre los ids del formulario y los nombres de columna de la hoja.
// En la hoja los encabezados los lee gente, así que no van los guiones del HTML.
// Los campos de camión, carta de porte y lote NO necesitan mapa: sus
// data-field ya se llaman igual que lo que espera el backend.
const OC_MAPA_CABECERA = {
    'oc-numero': 'Nro_OC',
    'oc-fecha': 'Fecha',
    'oc-contrato-fm': 'Contrato_Encabeza',
    'oc-especie': 'Especie',
    'oc-cosecha': 'Cosecha',
    'oc-titular-cp': 'Titular_CP',
    'oc-remitente-productor': 'Remitente_Productor',
    'oc-remitente-venta': 'Remitente_Venta',
    'oc-destinatario': 'Destinatario',
    'oc-destinatario-cuit': 'Destinatario_CUIT',
    'oc-destino': 'Destino',
    'oc-destino-cuit': 'Destino_CUIT',
    'oc-destino-planta': 'Destino_Planta',
    'oc-destino-direccion': 'Destino_Direccion',
    'oc-destino-localidad': 'Destino_Localidad',
    'oc-destino-provincia': 'Destino_Provincia',
    'oc-flete-intermediario': 'Flete_Intermediario',
    'oc-flete-intermediario-cuit': 'Flete_Intermediario_CUIT',
    'oc-flete-pagador': 'Flete_Pagador',
    'oc-flete-pagador-cuit': 'Flete_Pagador_CUIT',
    'oc-objetivo-kg': 'Objetivo_Kg',
    'oc-observaciones': 'Observaciones'
};

// Lo que tiene que llegar al Sheet como NÚMERO y no como texto. Los campos con
// máscara se ven "18.420" y así viajarían como texto: sumarlos en el Sheet no
// daría nada.
const OC_CAMPOS_NUMERICOS = ['Objetivo_Kg', 'km', 'tarifa', 'peso_neto',
    'bolsas', 'kg_bolsa', 'total_kg'];

function ocNumero(valor) {
    const n = parseNumeroAR(valor);
    return isNaN(n) ? 0 : n;
}

// Lo guardado en el Sheet (se baja al entrar al módulo).
let ocHistorialRemoto = [];

// --- 5.1. Pasar la pantalla a un objeto y al revés ------------------------

function ocArmarObjeto() {
    const orden = {
        Id_OC: ocIdEditando || ('OC-' + Date.now()),
        // Siempre "actualizar": borra por Id_OC (si no está, no hace nada) y
        // vuelve a insertar. Así el mismo envío sirve para crear y para editar,
        // y un reintento de la cola no puede duplicar nada.
        _accion: 'actualizar_oc',
        usuario_registro: (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : ''
    };

    Object.keys(OC_MAPA_CABECERA).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const clave = OC_MAPA_CABECERA[id];
        orden[clave] = OC_CAMPOS_NUMERICOS.indexOf(clave) !== -1 ? ocNumero(el.value) : el.value;
    });

    const totales = ocTotalesActuales();
    orden.Total_Camiones = totales.camiones;
    orden.Total_Bolsas = ocNumero(totales.bolsas);
    orden.Total_Kg = ocNumero(totales.kg);

    orden.Camiones = [];
    document.querySelectorAll('#wrapper-camiones .oc-camion').forEach(camion => {
        const datosCamion = ocValoresNumerados(camion, 'oc-camion-item');
        datosCamion.CartasPorte = [];

        camion.querySelectorAll(':scope .oc-wrapper-cps > .oc-cp').forEach(cp => {
            const datosCp = ocValoresNumerados(cp, 'oc-cp-item');
            datosCp.Lotes = [];
            cp.querySelectorAll(':scope .oc-wrapper-lotes > .oc-lote').forEach(lote => {
                datosCp.Lotes.push(ocValoresNumerados(lote, 'oc-lote-item'));
            });
            datosCamion.CartasPorte.push(datosCp);
        });

        orden.Camiones.push(datosCamion);
    });

    return orden;
}

// Como ocValoresDe(), pero convirtiendo a número lo que tiene que viajar
// como número.
function ocValoresNumerados(card, claseItem) {
    const valores = ocValoresDe(card, claseItem);
    OC_CAMPOS_NUMERICOS.forEach(campo => {
        if (valores[campo] !== undefined) valores[campo] = ocNumero(valores[campo]);
    });
    return valores;
}

function ocAplicarDatos(orden) {
    document.getElementById('form-oc').reset();
    document.getElementById('oc-validacion').classList.add('hidden');

    Object.keys(OC_MAPA_CABECERA).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const valor = orden[OC_MAPA_CABECERA[id]];
        if (valor === undefined || valor === null) return;
        if (el.tagName === 'SELECT') poblarSelect(el, el.dataset.enum, valor);
        else el.value = valor;
    });

    document.getElementById('wrapper-camiones').innerHTML = '';
    ocSecuencia = 0;
    (orden.Camiones || []).forEach(cam => {
        ocAgregarCamion({
            valores: cam,
            cps: (cam.CartasPorte || []).map(cp => ({ valores: cp, lotes: cp.Lotes || [] }))
        });
    });
    if (!document.querySelectorAll('#wrapper-camiones .oc-camion').length) ocAgregarCamion();
    ocRecalcularTodo();
}

// Los totales que ya pintó ocRecalcularTodo(), para no recorrer todo de nuevo:
// el historial los muestra sin tener que abrir la orden.
function ocTotalesActuales() {
    return {
        camiones: document.querySelectorAll('#wrapper-camiones .oc-camion').length,
        bolsas: document.getElementById('oc-total-bolsas').textContent,
        kg: document.getElementById('oc-total-kg').textContent
    };
}

// --- 5.2. Lo pendiente en este dispositivo -------------------------------

function ocPendientesLocales() {
    return new Promise(resolve => {
        if (!db || !db.objectStoreNames.contains(OC_STORE)) { resolve([]); return; }
        try {
            const pedido = db.transaction([OC_STORE], 'readonly').objectStore(OC_STORE).getAll();
            pedido.onsuccess = () => resolve(pedido.result || []);
            pedido.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}

// Guarda en IndexedDB. Si esa orden ya estaba pendiente acá, se pisa en vez de
// agregar otra: editar tres veces sin señal tiene que dejar UNA orden, no tres.
function ocGuardarLocal(orden) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(OC_STORE)) {
            reject(new Error('La base local todavía no está lista. Esperá un instante y probá de nuevo.'));
            return;
        }
        try {
            const store = db.transaction([OC_STORE], 'readwrite').objectStore(OC_STORE);
            const cursor = store.openCursor();
            let idLocal = null;
            cursor.onsuccess = e => {
                const c = e.target.result;
                if (c) {
                    if (c.value.Id_OC === orden.Id_OC) idLocal = c.value.id;
                    c.continue();
                    return;
                }
                const aGuardar = idLocal ? Object.assign({}, orden, { id: idLocal }) : orden;
                const req = store.put(aGuardar);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error || new Error('No se pudo guardar en este dispositivo'));
            };
            cursor.onerror = () => reject(cursor.error || new Error('No se pudo leer la cola local'));
        } catch (e) { reject(e); }
    });
}

// --- 5.3. Guardar, editar y borrar ---------------------------------------

// Guardar exige que la orden esté completa: una OC a la que le falte el chofer
// o el contrato no sirve para mandarle a planta.
async function ocGuardarOrden() {
    if (!ocValidar()) {
        document.getElementById('oc-validacion').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const orden = ocArmarObjeto();
    try {
        await ocGuardarLocal(orden);
    } catch (err) {
        alert('⚠️ No se pudo guardar la orden en este dispositivo.\n\nMotivo: ' + (err.message || err));
        return;
    }

    // Guardada acá: el borrador ya no hace falta.
    try { localStorage.removeItem(OC_STORAGE_KEY); } catch (e) { /* modo privado */ }
    ocIdEditando = null;

    if (navigator.onLine && typeof sincronizarCola === 'function' && typeof colaPorStore === 'function') {
        sincronizarCola(colaPorStore(OC_STORE));
        alert('Orden de carga guardada. Se está sincronizando con el Sheet.');
    } else {
        alert('Orden de carga guardada en este dispositivo.\n\nSe va a subir sola cuando haya señal.');
    }
    ocSwitchTab('historial');
}

function ocEditarOrden(idOC) {
    const orden = ocBuscarOrden(idOC);
    if (!orden) { alert('Esa orden ya no está.'); ocRenderHistorial(); return; }
    ocIdEditando = idOC;
    ocAplicarDatos(orden);
    document.getElementById('oc-form-titulo').textContent = 'Editar Orden de Carga';
    ocSwitchTab('nuevo');
}

function ocBuscarOrden(idOC) {
    if (ocUltimasListadas) {
        const encontrada = ocUltimasListadas.find(o => o.Id_OC === idOC);
        if (encontrada) return encontrada;
    }
    return ocHistorialRemoto.find(o => o.Id_OC === idOC) || null;
}

async function ocEliminarOrden(idOC) {
    const orden = ocBuscarOrden(idOC);
    const numero = orden ? (orden.Nro_OC || '') : '';
    if (!confirm('¿Borrar la orden de carga ' + (numero ? 'N° ' + numero : '') + '?\n\nNo se puede deshacer.')) return;

    // Primero lo de este dispositivo: si estaba pendiente de subir, se va con esto.
    const pendientes = await ocPendientesLocales();
    const pendiente = pendientes.find(o => o.Id_OC === idOC);
    if (pendiente && typeof colaBorrar === 'function') await colaBorrar(OC_STORE, pendiente.id);

    // Y si ya había llegado al Sheet, hay que borrarla de allá.
    const estaEnElSheet = ocHistorialRemoto.some(o => o.Id_OC === idOC);
    if (estaEnElSheet) {
        if (!navigator.onLine) {
            alert('Esa orden ya está en el Sheet y hace falta conexión para borrarla.\n\nProbá de nuevo cuando tengas señal.');
            ocRenderHistorial();
            return;
        }
        try {
            await enviarAlBackend({ _accion: 'eliminar_oc', Id_OC: idOC });
            ocHistorialRemoto = ocHistorialRemoto.filter(o => o.Id_OC !== idOC);
        } catch (err) {
            alert('⚠️ No se pudo borrar la orden del Sheet.\n\nMotivo: ' + (err.message || err));
        }
    }
    ocRenderHistorial();
}

// --- 5.4. El historial ---------------------------------------------------

function ocCargarOrdenesDesdeGoogle() {
    if (!navigator.onLine) return Promise.resolve();
    return fetch(WEB_APP_URL + '?action=read_oc')
        .then(res => res.json())
        .then(data => {
            // Mismo cuidado que en Calidad y Producción (hallazgo 14): una lista
            // vacía puede ser "no hay órdenes" o "me contestaron otra cosa". Si
            // no parece lo que pedimos, se conserva lo que había.
            const pareceOrdenes = Array.isArray(data) && (data.length === 0 || data.some(o => o && o.Id_OC));
            if (pareceOrdenes) ocHistorialRemoto = data.filter(o => o && o.Id_OC);
            else console.warn('[orden-carga] El servidor devolvió algo que no son órdenes; se conserva lo que había.');
        })
        .catch(err => console.error('No se pudieron cargar las órdenes de carga:', err));
}

// Texto donde busca el filtro rápido: todo lo escrito en la orden.
function ocTextoBuscable(orden) {
    const partes = [];
    Object.keys(orden).forEach(k => {
        if (k !== 'Camiones' && typeof orden[k] !== 'object') partes.push(orden[k]);
    });
    (orden.Camiones || []).forEach(cam => {
        Object.keys(cam).forEach(k => { if (k !== 'CartasPorte') partes.push(cam[k]); });
        (cam.CartasPorte || []).forEach(cp => {
            Object.keys(cp).forEach(k => { if (k !== 'Lotes') partes.push(cp[k]); });
            (cp.Lotes || []).forEach(l => Object.keys(l).forEach(k => partes.push(l[k])));
        });
    });
    return partes.filter(v => v !== '' && v !== null && v !== undefined).join(' ').toLowerCase();
}

// Lo que se está mostrando, para que editar y borrar no tengan que buscar de nuevo.
let ocUltimasListadas = [];

async function ocRenderHistorial() {
    const pendientes = await ocPendientesLocales();
    const idsPendientes = new Set(pendientes.map(o => o.Id_OC));
    // Lo pendiente manda sobre lo del Sheet: es lo último que se escribió.
    const todas = pendientes.map(o => Object.assign({}, o, { _pendiente: true }))
        .concat(ocHistorialRemoto.filter(o => !idsPendientes.has(o.Id_OC)));

    const desde = document.getElementById('oc-filter-desde').value;
    const hasta = document.getElementById('oc-filter-hasta').value;
    const numero = (document.getElementById('oc-filter-numero').value || '').trim().toLowerCase();
    const busqueda = (document.getElementById('oc-filter-search').value || '').trim().toLowerCase();

    const filtradas = todas.filter(o => {
        const fecha = o.Fecha || '';
        if (desde && fecha && fecha < desde) return false;
        if (hasta && fecha && fecha > hasta) return false;
        if (numero && String(o.Nro_OC || '').toLowerCase().indexOf(numero) === -1) return false;
        if (busqueda && ocTextoBuscable(o).indexOf(busqueda) === -1) return false;
        return true;
    }).sort((a, b) => String(b.Fecha || '').localeCompare(String(a.Fecha || '')));

    ocUltimasListadas = filtradas;

    const cuerpo = document.getElementById('tabla-oc-body');
    if (!filtradas.length) {
        cuerpo.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">'
            + (todas.length ? 'Ninguna orden coincide con los filtros.'
                            : 'Todavía no hay órdenes de carga. Tocá "Nueva Orden" para armar la primera.')
            + '</td></tr>';
        return;
    }

    cuerpo.innerHTML = filtradas.map(o => `<tr>
            <td>${o.Fecha || '-'}</td>
            <td><strong>${o.Nro_OC || '-'}</strong>${o._pendiente ? ' <span class="oc-chip-pendiente" title="Todavía no subió al Sheet">sin subir</span>' : ''}</td>
            <td>${o.Contrato_Encabeza || '-'}</td>
            <td>${o.Destino || '-'}</td>
            <td>${o.Total_Camiones || 0}</td>
            <td>${formatNumeroAR(o.Total_Kg || 0, 0)} kg</td>
            <td>
                <button type="button" class="btn-accion editar" title="Editar" onclick="ocEditarOrden('${o.Id_OC}')"><i class="fas fa-edit"></i></button>
                <button type="button" class="btn-accion eliminar" title="Eliminar" onclick="ocEliminarOrden('${o.Id_OC}')"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>`).join('');
}

// --- 5.5. El borrador de lo que se está escribiendo ----------------------
// El recálculo corre en cada tecla, pero escribir en localStorage en cada tecla
// es tirar trabajo: se espera medio segundo de quietud antes de guardar.
// Esto NO es la orden guardada: es solo el respaldo de lo que hay en pantalla,
// por si se cierra la app a la mitad.

let ocTimerGuardado = null;
function ocGuardarBorrador() {
    clearTimeout(ocTimerGuardado);
    ocTimerGuardado = setTimeout(ocGuardarBorradorYa, 500);
}

function ocGuardarBorradorYa() {
    // Si el formulario no está a la vista no hay nada que respaldar: evita
    // pisar el borrador con el formulario vacío al entrar al historial.
    if (document.getElementById('tab-content-nuevo-oc').classList.contains('hidden')) return;
    try {
        localStorage.setItem(OC_STORAGE_KEY, JSON.stringify(ocArmarObjeto()));
    } catch (e) {
        // Modo privado o sin espacio: no se pierde nada de lo que está en
        // pantalla, solo no queda respaldado. No vale la pena molestar.
    }
}

function ocLeerBorrador() {
    try {
        const crudo = localStorage.getItem(OC_STORAGE_KEY);
        if (!crudo) return null;
        const datos = JSON.parse(crudo);
        return (datos && datos.Camiones) ? datos : null;
    } catch (e) { return null; }
}


// --- 5.6. Las órdenes de la versión anterior -----------------------------
// La primera versión del módulo guardaba las órdenes en localStorage, con otra
// forma. Se pasan a la cola para que suban al Sheet y se borra la clave vieja.
// Corre una sola vez: después ya no queda nada que migrar.

async function ocMigrarOrdenesViejas() {
    let viejas = [];
    try {
        const crudo = localStorage.getItem(OC_LISTA_KEY);
        if (!crudo) return;
        viejas = JSON.parse(crudo) || [];
    } catch (e) { return; }
    if (!Array.isArray(viejas) || !viejas.length) return;

    let migradas = 0;
    for (const vieja of viejas) {
        const orden = ocConvertirOrdenVieja(vieja);
        if (!orden) continue;
        try { await ocGuardarLocal(orden); migradas++; } catch (e) { /* se reintenta al próximo arranque */ }
    }
    if (migradas < viejas.length) return;   // quedó alguna: NO se borra el respaldo

    try { localStorage.removeItem(OC_LISTA_KEY); } catch (e) { }
    if (migradas && navigator.onLine && typeof sincronizarCola === 'function') {
        sincronizarCola(colaPorStore(OC_STORE));
    }
    console.log('[orden-carga] Órdenes migradas al Sheet: ' + migradas);
}

function ocConvertirOrdenVieja(vieja) {
    if (!vieja || !vieja.cabecera) return null;
    const orden = {
        Id_OC: vieja.id || ('OC-' + Date.now()),
        _accion: 'actualizar_oc',
        usuario_registro: (typeof usuarioRegistroActual === 'function') ? usuarioRegistroActual() : ''
    };
    Object.keys(OC_MAPA_CABECERA).forEach(id => {
        const clave = OC_MAPA_CABECERA[id];
        const valor = vieja.cabecera[id];
        if (valor === undefined) return;
        orden[clave] = OC_CAMPOS_NUMERICOS.indexOf(clave) !== -1 ? ocNumero(valor) : valor;
    });
    const t = vieja.totales || {};
    orden.Total_Camiones = t.camiones || 0;
    orden.Total_Bolsas = ocNumero(t.bolsas);
    orden.Total_Kg = ocNumero(t.kg);

    orden.Camiones = (vieja.camiones || []).map(cam => {
        const datos = ocNumerar(Object.assign({}, cam.valores));
        datos.CartasPorte = (cam.cps || []).map(cp => {
            const datosCp = ocNumerar(Object.assign({}, cp.valores));
            datosCp.Lotes = (cp.lotes || []).map(l => ocNumerar(Object.assign({}, l)));
            return datosCp;
        });
        return datos;
    });
    return orden;
}

function ocNumerar(valores) {
    OC_CAMPOS_NUMERICOS.forEach(campo => {
        if (valores[campo] !== undefined) valores[campo] = ocNumero(valores[campo]);
    });
    return valores;
}

// =========================================================================
// --- 6. VALIDACIÓN --------------------------------------------------------
// =========================================================================
// Por ahora solo revisa y muestra: no bloquea nada, porque todavía no hay
// nada que generar. Cuando la OC escriba en el Sheet, este mismo chequeo es
// el que tiene que frenar el "Generar OC".

function ocValidar() {
    const faltan = [];
    if (!(document.getElementById('oc-numero').value || '').trim()) faltan.push('el N° de orden de carga');
    if (!(document.getElementById('oc-especie').value || '').trim()) faltan.push('el grano / especie');
    if (!(document.getElementById('oc-destino').value || '').trim()) faltan.push('el destino de la mercadería');

    document.querySelectorAll('#wrapper-camiones .oc-camion').forEach((camion, i) => {
        const n = i + 1;
        if (!ocValorCampo(camion, 'dominio_camion')) faltan.push(`el dominio del camión #${n}`);
        if (!ocValorCampo(camion, 'chofer')) faltan.push(`el chofer del camión #${n}`);

        camion.querySelectorAll(':scope .oc-wrapper-cps > .oc-cp').forEach((cp, j) => {
            const m = j + 1;
            if (!ocValorCampo(cp, 'productor')) faltan.push(`el productor de la CP #${m} del camión #${n}`);
            if (!ocValorCampo(cp, 'contrato_com')) faltan.push(`el contrato de la CP #${m} del camión #${n}`);
            const ctg = ocValorCampo(cp, 'ctg');
            if (ctg && ctg.replace(/\D/g, '').length !== 11) {
                faltan.push(`el CTG de la CP #${m} del camión #${n} no tiene 11 dígitos`);
            }
            const lotesSinBolsas = Array.prototype.filter.call(
                cp.querySelectorAll(':scope .oc-wrapper-lotes > .oc-lote'),
                lote => parseNumeroAR(lote.querySelector('.oc-bolsas').value) <= 0);
            if (lotesSinBolsas.length) {
                faltan.push(`hay ${lotesSinBolsas.length} lote/s sin bolsas en la CP #${m} del camión #${n}`);
            }
        });
    });

    const caja = document.getElementById('oc-validacion');
    if (faltan.length === 0) {
        caja.className = 'oc-validacion oc-ok';
        caja.innerHTML = '<i class="fas fa-check-circle"></i> La orden de carga está completa.';
    } else {
        caja.className = 'oc-validacion oc-error';
        caja.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Falta revisar:<ul>'
            + faltan.map(f => '<li>' + f + '</li>').join('') + '</ul>';
    }
    caja.classList.remove('hidden');
    return faltan.length === 0;
}
