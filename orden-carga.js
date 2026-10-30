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
//      OC          cabecera: N° y fecha (automáticos), destino, titular CP + CUIT
//       └ CAMIÓN   grano, campaña, transportista + CUIT, chofer + CUIL,
//                  dominios, pagador del flete + CUIT, km, tarifa,
//                  intermediario de flete (sí/no + razón social y CUIT)
//          └ CP    remitente comercial productor + CUIT, CTTO, CTG, peso neto
//             └ LOTE   lote BRC, lote planta, bolsas, kg/bolsa, calibre
//
//  El nivel que falta hoy es el del medio: en el Sheet, `Producto` y
//  `Contrato Comercial` cuelgan los dos de `Id_Carga` como hermanos, así que
//  los lotes no saben a qué carta de porte pertenecen. Acá sí: cada CP declara
//  un peso neto que se compone de lotes concretos.
//
//  ESTADO: la orden se guarda en el Sheet (sección 5), genera su PDF para
//  planta (sección 8) y cada camión arranca su Control de Transporte ya
//  completo (sección 9). Los controles PT viejos siguen igual, sin OC asociada.
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
        .then(ocRenderHistorial)
        .then(ocRefrescarNumeroSiEsNueva);
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
    ocPrepararNumeroYFecha();
    document.getElementById('oc-validacion').classList.add('hidden');
    document.getElementById('wrapper-camiones').innerHTML = '';
    ocSecuencia = 0;
    ocAgregarCamion();
    ocRecalcularTodo();
}

// El número de orden lo pone la app: el siguiente de la serie ya guardada. No
// se edita (decisión del 16/10/2026), así no hay números repetidos ni
// salteados. Se cuentan TODAS las órdenes conocidas, no solo las que pasan los
// filtros del historial.
function ocProximoNumero() {
    const numeros = (ocPendientesConocidas || []).concat(ocHistorialRemoto || [])
        .map(o => parseInt(String(o.Nro_OC || '').replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n));
    return numeros.length ? String(Math.max.apply(null, numeros) + 1) : '';
}

// Número y fecha van bloqueados. Única excepción: la PRIMERA orden de todas,
// cuando todavía no hay serie de la cual seguir. Ahí se deja escribir el número
// inicial una vez; de ahí en más la app sigue sola.
function ocPrepararNumeroYFecha() {
    const numero = document.getElementById('oc-numero');
    const ayuda = document.getElementById('oc-numero-ayuda');
    const sinSerie = !numero.value && !ocIdEditando;
    numero.readOnly = !sinSerie;
    numero.classList.toggle('campo-calculado', !sinSerie);
    numero.placeholder = sinSerie ? 'Primera orden: escribí el número inicial' : '';
    if (ayuda) ayuda.textContent = sinSerie ? 'primera orden de la serie' : 'automático';
}

// El historial puede llegar del Sheet DESPUÉS de abrir una orden nueva (sobre
// todo la primera vez que se entra). Si la orden en pantalla es nueva, se
// vuelve a calcular el número con lo que llegó.
function ocRefrescarNumeroSiEsNueva() {
    if (ocIdEditando) return;
    if (document.getElementById('tab-content-nuevo-oc').classList.contains('hidden')) return;
    const numero = document.getElementById('oc-numero');
    const proximo = ocProximoNumero();
    if (proximo && (numero.readOnly || !numero.value)) {
        numero.value = proximo;
        ocPrepararNumeroYFecha();
        ocRecalcularTodo();
    }
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
            <!-- La clave del camión. El Control de Transporte que planta hace
                 sobre este camión apunta acá, así que NO puede cambiar al
                 editar la orden (ver ocIdCamionNuevo). -->
            <input type="hidden" class="oc-camion-item" data-field="Id_Camion">
            <div class="form-group-row">
                <div class="form-group"><label>Grano / Especie</label><select class="oc-camion-item enum-select" data-field="especie" data-enum="producto"></select></div>
                <div class="form-group"><label>Campaña</label><input type="text" class="oc-camion-item" data-field="cosecha" list="oc-lista-cosechas" placeholder="25-26"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Transportista (razón social)</label><input type="text" class="oc-camion-item" data-field="transportista" list="oc-lista-transportistas" placeholder="Razón social del transportista"></div>
                <div class="form-group"><label>CUIT transportista</label><input type="text" class="oc-camion-item campo-cuit" data-field="transportista_cuit" inputmode="numeric" placeholder="30-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Chofer (nombre y apellido)</label><input type="text" class="oc-camion-item" data-field="chofer" list="oc-lista-choferes" placeholder="Apellido y nombre"></div>
                <div class="form-group"><label>CUIT / CUIL chofer</label><input type="text" class="oc-camion-item campo-cuit" data-field="chofer_cuil" inputmode="numeric" placeholder="20-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Dominio camión</label><input type="text" class="oc-camion-item campo-dominio" data-field="dominio_camion" list="oc-lista-dominios" placeholder="AA000AA"></div>
                <div class="form-group"><label>Dominio acoplado</label><input type="text" class="oc-camion-item campo-dominio" data-field="dominio_acoplado" list="oc-lista-acoplados" placeholder="AA000AA"></div>
            </div>
            <!-- Flete, como sale en la carta de porte (sección A y E): el pagador,
                 los km y la tarifa están siempre; el intermediario puede no
                 estar (la CPE de ejemplo no lo tiene). El campo se sigue
                 llamando "flete" en los datos: Sí = hay intermediario. -->
            <div class="form-group-row">
                <div class="form-group"><label>Pagador del flete</label><input type="text" class="oc-camion-item" data-field="flete_pagador" list="oc-lista-fletes" placeholder="Razón social"></div>
                <div class="form-group"><label>CUIT pagador</label><input type="text" class="oc-camion-item campo-cuit" data-field="flete_pagador_cuit" inputmode="numeric" placeholder="30-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Km a recorrer <span class="oc-ayuda">opcional</span></label><input type="text" inputmode="decimal" class="oc-camion-item campo-numero-ar" data-field="km"></div>
                <div class="form-group"><label>Tarifa <span class="oc-ayuda">opcional</span></label><input type="text" inputmode="decimal" class="oc-camion-item campo-numero-ar" data-field="tarifa"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group">
                    <label>¿Hay intermediario de flete?</label>
                    <select class="oc-camion-item oc-flete-select" data-field="flete">
                        <option value="No">No</option>
                        <option value="Sí">Sí</option>
                    </select>
                </div>
            </div>
            <div class="oc-flete-detalle hidden">
                <div class="form-group-row">
                    <div class="form-group"><label>Intermediario del flete</label><input type="text" class="oc-camion-item" data-field="flete_intermediario" list="oc-lista-fletes" placeholder="Razón social"></div>
                    <div class="form-group"><label>CUIT intermediario</label><input type="text" class="oc-camion-item campo-cuit" data-field="flete_intermediario_cuit" inputmode="numeric" placeholder="30-00000000-0"></div>
                </div>
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

    card.querySelectorAll(':scope > .dynamic-card-body .enum-select').forEach(sel => poblarSelect(sel, sel.dataset.enum, ''));
    ocAplicarValores(card, 'oc-camion-item', opciones.valores);
    const idCamion = card.querySelector('[data-field="Id_Camion"]');
    if (!idCamion.value) idCamion.value = ocIdCamionNuevo();
    ocMostrarFlete(card);
    card.querySelector('.oc-flete-select').addEventListener('change', () => { ocMostrarFlete(card); ocRecalcularTodo(); });
    card.querySelector('[data-field="especie"]').addEventListener('change', ocRecalcularTodo);
    card.querySelectorAll('.oc-camion-item').forEach(el => el.addEventListener('input', ocRecalcularTodo));
    // Al elegir una sugerencia se completa lo que va con eso (CUIT, acoplado,
    // lote de planta). Solo rellena lo que está vacío: nunca pisa lo escrito.
    card.querySelectorAll('.oc-camion-item').forEach(el => el.addEventListener('change', () => ocAutocompletarTarjeta(el)));

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

// El intermediario del flete solo se ve si lo hay. Si se pasa a "No", lo
// escrito queda en pantalla (por si fue un toque de más), pero no se guarda ni
// sale en el PDF: ver ocArmarObjeto().
function ocMostrarFlete(card) {
    const conFlete = card.querySelector('.oc-flete-select').value === 'Sí';
    card.querySelector('.oc-flete-detalle').classList.toggle('hidden', !conFlete);
}

// En la práctica el mismo camión hace varios viajes, o vuelve a aparecer con
// otra carta de porte. En el Excel eso obliga a tipear de nuevo razón social,
// CUIT, chofer y dominios; acá se copia todo y queda una CP vacía para llenar.
function ocDuplicarCamion(boton) {
    const origen = boton.closest('.oc-camion');
    const valores = ocValoresDe(origen, 'oc-camion-item');
    valores.Id_Camion = '';   // es otro camión: lleva su propia clave
    ocAgregarCamion({ valores: valores, enfocar: true });
}

// Antes la app no mandaba ninguna clave de camión y el backend inventaba una
// en cada guardado: como editar una orden es borrarla y reinsertarla, el mismo
// camión cambiaba de id con cada corrección. Ahora la clave nace con la tarjeta
// y viaja con ella. Los camiones guardados antes conservan la que les puso el
// backend (llega en read_oc y se vuelve a mandar igual).
function ocIdCamionNuevo() {
    return 'CAM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
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
                <div class="form-group"><label>Remitente comercial productor</label><input type="text" class="oc-cp-item" data-field="productor" list="oc-lista-productores" placeholder="Razón social"></div>
                <div class="form-group"><label>CUIT remitente</label><input type="text" class="oc-cp-item campo-cuit" data-field="productor_cuit" inputmode="numeric" placeholder="30-00000000-0"></div>
            </div>
            <div class="form-group-row">
                <div class="form-group"><label>Contrato Comercial (CTTO)</label><input type="text" class="oc-cp-item" data-field="contrato_com" list="oc-lista-contratos-com" placeholder="CN26-081 B"></div>
                <div class="form-group">
                    <label>CTG <span class="oc-ayuda">11 dígitos</span></label>
                    <input type="text" class="oc-cp-item campo-ctg" data-field="ctg" inputmode="numeric" maxlength="11" placeholder="11 dígitos">
                </div>
            </div>
            <!-- El N° de carta de porte lo carga PLANTA en el Control de
                 Transporte (PREGUNTAS_PENDIENTES_LUCAS 3.1). No se pide acá, pero
                 se conserva oculto para no borrarlo al editar una orden vieja. -->
            <input type="hidden" class="oc-cp-item" data-field="carta_porte">
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
    // Al elegir una sugerencia se completa lo que va con eso (CUIT, acoplado,
    // lote de planta). Solo rellena lo que está vacío: nunca pisa lo escrito.
    card.querySelectorAll('.oc-cp-item').forEach(el => el.addEventListener('change', () => ocAutocompletarTarjeta(el)));

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
                <div class="form-group"><label>N° Lote BRC</label><input type="text" class="oc-lote-item" data-field="lote_brc" list="oc-lista-lotes-brc" placeholder="0000"></div>
                <div class="form-group"><label>N° Lote Planta</label><input type="text" class="oc-lote-item" data-field="lote_planta" list="oc-lista-lotes-planta" placeholder="LT-000"></div>
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
    // Al elegir una sugerencia se completa lo que va con eso (CUIT, acoplado,
    // lote de planta). Solo rellena lo que está vacío: nunca pisa lo escrito.
    card.querySelectorAll('.oc-lote-item').forEach(el => el.addEventListener('change', () => ocAutocompletarTarjeta(el)));
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
// lotes, y está bien (Lucas, PREGUNTAS_PENDIENTES_LUCAS 1.1): los lotes se
// cuentan por bolsas y el peso lo da la balanza. En la OC 2056 la primera CP
// declara 26.695 y los lotes dan 26.715. Nunca se bloquea; solo cambia el tono:
// hasta OC_TOLERANCIA_PESO es la balanza y se muestra como dato, en gris; más
// que eso huele a error de tipeo (26.695 → 2.669,5) y se avisa en naranja.
const OC_TOLERANCIA_PESO = 0.01;

function ocAvisarDiferenciaPeso(cp, sumaLotes) {
    const aviso = cp.querySelector('.oc-aviso-peso');
    const declarado = parseNumeroAR(cp.querySelector('.oc-peso-neto').value);
    if (!declarado || !sumaLotes) { aviso.classList.add('hidden'); return; }
    const dif = declarado - sumaLotes;
    if (Math.abs(dif) < 0.5) { aviso.classList.add('hidden'); return; }
    const pct = Math.abs(dif) / declarado;
    const detalle = formatNumeroAR(Math.abs(dif), 2) + ' kg (' + formatNumeroAR(pct * 100, 2) + ' %)';
    if (pct <= OC_TOLERANCIA_PESO) {
        aviso.textContent = 'Diferencia con la suma de los lotes: ' + detalle + '.';
        aviso.classList.add('oc-aviso-peso-leve');
    } else {
        aviso.textContent = (dif > 0 ? 'El peso declarado supera la suma de los lotes en ' : 'La suma de los lotes supera el peso declarado en ')
            + detalle + '. Revisá que no sea un error de tipeo.';
        aviso.classList.remove('oc-aviso-peso-leve');
    }
    aviso.classList.remove('hidden');
}

function ocPintarTotales(totalOc, bolsasOc, porLote) {
    document.getElementById('oc-total-kg').textContent = formatNumeroAR(totalOc, 0) + ' kg';
    document.getElementById('oc-total-bolsas').textContent = formatNumeroAR(bolsasOc, 0);
    document.getElementById('oc-total-camiones').textContent = document.querySelectorAll('#wrapper-camiones .oc-camion').length;

    // Ya no hay "objetivo de kg": se sacó el 16/10/2026. La orden se arma por
    // bolsas y los kilos reales los da la balanza.

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
        partes = [ocValorCampo(card, 'dominio_camion'), ocValorCampo(card, 'especie'),
                  ocValorCampo(card, 'chofer'), card.querySelector('.oc-total-camion').textContent];
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
        // Los selects con lista editable se pueblan desde ENUMS; los fijos (el
        // "¿Lleva flete?") ya traen sus opciones y solo se elige.
        if (el.tagName === 'SELECT' && el.dataset.enum) poblarSelect(el, el.dataset.enum, valor);
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
    'oc-titular-cp': 'Titular_CP',
    'oc-titular-cp-cuit': 'Titular_CP_CUIT',
    'oc-destinatario': 'Destinatario',
    'oc-destinatario-cuit': 'Destinatario_CUIT',
    'oc-destino': 'Destino',
    'oc-destino-cuit': 'Destino_CUIT',
    'oc-destino-planta': 'Destino_Planta',
    'oc-destino-direccion': 'Destino_Direccion',
    'oc-destino-localidad': 'Destino_Localidad',
    'oc-destino-provincia': 'Destino_Provincia',
    'oc-observaciones': 'Observaciones'
};
// Se sacaron de la cabecera el 16/10/2026: Contrato_Encabeza, Objetivo_Kg y
// Remitente_Venta (no van), y Especie, Cosecha, Remitente_Productor y los
// fletes (pasaron al camión o a la carta de porte). Las órdenes viejas que los
// tienen se adaptan al abrirlas: ver ocAdaptarOrdenVieja().

// Lo que tiene que llegar al Sheet como NÚMERO y no como texto. Los campos con
// máscara se ven "18.420" y así viajarían como texto: sumarlos en el Sheet no
// daría nada.
const OC_CAMPOS_NUMERICOS = ['km', 'tarifa', 'peso_neto',
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

    // A quién se mandó por correo y cuándo. No está en el formulario: viene de
    // la orden que se está editando, y sin esto se perdería al guardarla,
    // porque editar es borrar y reinsertar.
    const anterior = ocIdEditando ? ocBuscarOrden(ocIdEditando)
        || (ocPendientesConocidas || []).find(o => o.Id_OC === ocIdEditando) : null;
    orden.Correo = anterior ? (anterior.Correo || '') : '';
    orden.Estado_Correo = anterior ? (anterior.Estado_Correo || '') : '';

    const totales = ocTotalesActuales();
    orden.Total_Camiones = totales.camiones;
    orden.Total_Bolsas = ocNumero(totales.bolsas);
    orden.Total_Kg = ocNumero(totales.kg);

    orden.Camiones = [];
    document.querySelectorAll('#wrapper-camiones .oc-camion').forEach(camion => {
        const datosCamion = ocValoresNumerados(camion, 'oc-camion-item');
        // Sin intermediario no viaja el intermediario, aunque haya quedado
        // algo escrito en pantalla de antes de pasarlo a "No". El pagador, los
        // km y la tarifa van siempre.
        if (datosCamion.flete !== 'Sí') {
            datosCamion.flete_intermediario = '';
            datosCamion.flete_intermediario_cuit = '';
        }
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

// Las órdenes armadas antes del 16/10/2026 tienen grano, campaña y flete en la
// cabecera. Se copian a cada camión que no los tenga, así al abrirlas (o
// imprimirlas) se ven igual que una nueva, y al volver a guardarlas ya quedan
// en el formato nuevo. No modifica la orden recibida: devuelve una copia.
function ocAdaptarOrdenVieja(orden) {
    const copia = JSON.parse(JSON.stringify(orden || {}));
    (copia.Camiones || []).forEach(cam => {
        if (!cam.especie && copia.Especie) cam.especie = copia.Especie;
        if (!cam.cosecha && copia.Cosecha) cam.cosecha = copia.Cosecha;
        if (!cam.flete_pagador && copia.Flete_Pagador) {
            cam.flete_pagador = copia.Flete_Pagador;
            cam.flete_pagador_cuit = copia.Flete_Pagador_CUIT || '';
        }
        if (!cam.flete && copia.Flete_Intermediario) {
            cam.flete = 'Sí';
            cam.flete_intermediario = copia.Flete_Intermediario;
            cam.flete_intermediario_cuit = copia.Flete_Intermediario_CUIT || '';
        }
    });
    return copia;
}

// Los granos de una orden, para el historial ("Garbanzo, Poroto Mung").
function ocGranosDe(orden) {
    const granos = (orden.Camiones || []).map(c => c.especie).concat(orden.Especie ? [orden.Especie] : []);
    return Array.from(new Set(granos.filter(Boolean))).join(', ');
}

function ocAplicarDatos(orden) {
    orden = ocAdaptarOrdenVieja(orden);
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
    ocPrepararNumeroYFecha();
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

    // Si mientras se armaba esta orden se guardó otra con el mismo número (otra
    // persona, otro dispositivo), la NUEVA toma el siguiente libre. Una orden
    // que ya existía conserva siempre el suyo.
    const yaExistia = (ocHistorialRemoto || []).concat(ocPendientesConocidas || [])
        .some(o => o.Id_OC === orden.Id_OC);
    const repetido = (ocHistorialRemoto || []).concat(ocPendientesConocidas || [])
        .some(o => o.Id_OC !== orden.Id_OC && String(o.Nro_OC) === String(orden.Nro_OC));
    if (!yaExistia && repetido) {
        const anterior = orden.Nro_OC;
        orden.Nro_OC = ocProximoNumero();
        document.getElementById('oc-numero').value = orden.Nro_OC;
        ocRecalcularTodo();
        // Las Observaciones CP llevan el número: se rearman con el nuevo
        const actualizada = ocArmarObjeto();
        actualizada.Id_OC = orden.Id_OC;
        Object.assign(orden, actualizada);
        alert('El N° ' + anterior + ' ya lo tomó otra orden mientras armabas esta.\n\nEsta orden queda como N° ' + orden.Nro_OC + '.');
    }

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
    }
    ocSwitchTab('historial');

    // La orden se le manda a planta: se ofrece en el momento, que es cuando
    // hace falta. Con señal, por correo (con el PDF adjunto); sin señal, el PDF
    // para compartirlo como se pueda. Si dice que no, quedan los botones del
    // historial.
    if (navigator.onLine && typeof abrirModalCorreo === 'function') {
        if (confirm('Orden de carga guardada.\n\n¿La mandás por correo ahora? (va con el PDF adjunto)')) {
            abrirModalCorreo(orden, 'oc');
        }
    } else if (confirm('Orden de carga guardada en este dispositivo. Se va a subir sola cuando haya señal.\n\n' +
                       '¿Generás el PDF para mandarle a planta?')) {
        ocGenerarPDF(orden);
    }
}

function ocAbrirCorreo(idOC) {
    const orden = ocBuscarOrden(idOC);
    if (!orden) { alert('Esa orden ya no está.'); ocRenderHistorial(); return; }
    abrirModalCorreo(orden, 'oc');
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

// Las órdenes también quedan copiadas en el celular: planta tiene que poder
// arrancar el Control de Transporte desde la OC aunque no haya señal en el
// silo (ver sección 9). Es la misma copia que usan los demás historiales.
const OC_COPIA_LOCAL = 'ordenes_carga';

function ocCargarOrdenesDesdeGoogle() {
    if (!navigator.onLine) { ocRestaurarCopiaLocal(); return Promise.resolve(); }
    return fetch(WEB_APP_URL + '?action=read_oc')
        .then(res => res.json())
        .then(data => {
            // Mismo cuidado que en Calidad y Producción (hallazgo 14): una lista
            // vacía puede ser "no hay órdenes" o "me contestaron otra cosa". Si
            // no parece lo que pedimos, se conserva lo que había.
            const pareceOrdenes = Array.isArray(data) && (data.length === 0 || data.some(o => o && o.Id_OC));
            if (pareceOrdenes) {
                ocHistorialRemoto = data.filter(o => o && o.Id_OC);
                if (typeof guardarHistorialLocal === 'function') guardarHistorialLocal(OC_COPIA_LOCAL, ocHistorialRemoto);
            } else {
                console.warn('[orden-carga] El servidor devolvió algo que no son órdenes; se conserva lo que había.');
            }
        })
        .catch(err => {
            console.error('No se pudieron cargar las órdenes de carga:', err);
            ocRestaurarCopiaLocal();
        });
}

// Lo viejo nunca pisa lo nuevo: solo se usa la copia si no hay nada en memoria.
function ocRestaurarCopiaLocal() {
    if (ocHistorialRemoto.length || typeof leerHistorialLocal !== 'function') return;
    const copia = leerHistorialLocal(OC_COPIA_LOCAL);
    if (copia) ocHistorialRemoto = copia.registros.filter(o => o && o.Id_OC);
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
// Todas las pendientes de este dispositivo, sin filtrar: las usa la numeración.
let ocPendientesConocidas = [];

async function ocRenderHistorial() {
    const pendientes = await ocPendientesLocales();
    ocPendientesConocidas = pendientes;
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
    // Las sugerencias salen de las órdenes ya cargadas: este es el momento
    // en que pueden haber cambiado.
    ocConstruirMaestros(pendientes);

    const cuerpo = document.getElementById('tabla-oc-body');
    if (!filtradas.length) {
        cuerpo.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">'
            + (todas.length ? 'Ninguna orden coincide con los filtros.'
                            : 'Todavía no hay órdenes de carga. Tocá "Nueva Orden" para armar la primera.')
            + '</td></tr>';
        return;
    }

    // Cuántos camiones de cada orden ya tienen su Control de Transporte.
    const controles = (typeof controlesDeTransporteConocidos === 'function')
        ? await controlesDeTransporteConocidos() : [];
    const avance = o => {
        const hechos = ocControlesPorCamion(o.Id_OC, controles);
        const camiones = o.Camiones || [];
        const conControl = camiones.filter(c => hechos[String(c.Id_Camion || '')]).length;
        if (!camiones.length) return '';
        const completa = conControl === camiones.length;
        return ` <span class="oc-chip-controles${completa ? ' completa' : ''}" title="Camiones con su Control de Transporte">`
            + `<i class="fas fa-truck"></i> ${conControl}/${camiones.length}</span>`;
    };

    cuerpo.innerHTML = filtradas.map(o => `<tr>
            <td>${o.Fecha || '-'}</td>
            <td><strong>${o.Nro_OC || '-'}</strong>${o._pendiente ? ' <span class="oc-chip-pendiente" title="Todavía no subió al Sheet">sin subir</span>' : ''}${avance(o)}</td>
            <td>${ocGranosDe(o) || '-'}</td>
            <td>${o.Destino || '-'}</td>
            <td>${o.Total_Camiones || 0}</td>
            <td>${formatNumeroAR(o.Total_Kg || 0, 0)} kg</td>
            <td>
                <button type="button" class="btn-accion control" title="Hacer el Control de Transporte de un camión" onclick="ocIniciarControl('${o.Id_OC}')"><i class="fas fa-truck-loading"></i></button>
                <button type="button" class="btn-accion pdf" title="Descargar el informe para planta" onclick="ocGenerarPDF('${o.Id_OC}')"><i class="fas fa-file-pdf"></i></button>
                ${typeof botonCorreoHtml === 'function' ? botonCorreoHtml(o, `ocAbrirCorreo('${o.Id_OC}')`) : ''}
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
    if (!(document.getElementById('oc-destino').value || '').trim()) faltan.push('el destino de la mercadería');

    document.querySelectorAll('#wrapper-camiones .oc-camion').forEach((camion, i) => {
        const n = i + 1;
        if (!ocValorCampo(camion, 'especie')) faltan.push(`el grano del camión #${n}`);
        if (!ocValorCampo(camion, 'dominio_camion')) faltan.push(`el dominio del camión #${n}`);
        if (!ocValorCampo(camion, 'chofer')) faltan.push(`el chofer del camión #${n}`);
        if (ocValorCampo(camion, 'flete') === 'Sí') {
            if (!ocValorCampo(camion, 'flete_intermediario')) faltan.push(`el intermediario del flete del camión #${n}`);
            if (!ocValorCampo(camion, 'flete_intermediario_cuit')) faltan.push(`el CUIT del intermediario del flete del camión #${n}`);
        }

        camion.querySelectorAll(':scope .oc-wrapper-cps > .oc-cp').forEach((cp, j) => {
            const m = j + 1;
            if (!ocValorCampo(cp, 'productor')) faltan.push(`el remitente comercial productor de la CP #${m} del camión #${n}`);
            if (!ocValorCampo(cp, 'productor_cuit')) faltan.push(`el CUIT del remitente de la CP #${m} del camión #${n}`);
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

// =========================================================================
// --- 7. SUGERENCIAS: ELEGIR EN VEZ DE ESCRIBIR ---------------------------
// =========================================================================
// El grueso de los errores de una OC no está en la lógica: está en el tipeo de
// los datos que ya existen —CUIT, dominios, lotes—. Un dígito de más en un CUIT
// y la carta de porte sale mal.
//
// Esto no espera a que haya una tabla de datos maestros en ningún lado: la arma
// con lo que YA se cargó en órdenes anteriores. La primera vez se escribe; de
// ahí en más se elige de la lista, y lo que va con ese dato se completa solo:
//
//     elegís el transportista  -> viene su CUIT
//     elegís el chofer         -> viene su CUIL
//     elegís el dominio        -> vienen acoplado, transportista y chofer
//     elegís el destino        -> vienen CUIT, planta, dirección, localidad
//     elegís el lote BRC       -> vienen lote de planta, calibre y kg por bolsa
//
// NUNCA pisa lo que ya está escrito: solo rellena los campos vacíos. Si el
// chofer de hoy es otro, se escribe encima y listo.
//
// Cuando exista una tabla de maestros de verdad (ver PREGUNTAS_PENDIENTES_LUCAS,
// punto 7.1), lo único que cambia es de dónde sale `ocMaestros`.

// Cada clave guarda: valor elegido -> { campo acompañante: valor }
let ocMaestros = null;

// Se arma de las órdenes del Sheet más las que todavía están pendientes acá.
// La más reciente gana: si a un chofer le cambió el camión, vale el último.
function ocConstruirMaestros(pendientes) {
    const m = {
        'oc-lista-cosechas': {},
        'oc-lista-destinatarios': {}, 'oc-lista-destinos': {},
        'oc-lista-titulares': {}, 'oc-lista-fletes': {},
        'oc-lista-transportistas': {}, 'oc-lista-choferes': {},
        'oc-lista-dominios': {}, 'oc-lista-acoplados': {},
        'oc-lista-productores': {}, 'oc-lista-contratos-com': {},
        'oc-lista-lotes-brc': {}, 'oc-lista-lotes-planta': {}
    };

    const anotar = (lista, valor, acompanan) => {
        const clave = String(valor || '').trim();
        if (!clave) return;
        const limpio = {};
        Object.keys(acompanan || {}).forEach(k => {
            const v = acompanan[k];
            if (v !== undefined && v !== null && String(v).trim() !== '') limpio[k] = v;
        });
        m[lista][clave] = limpio;
    };

    // Las más viejas primero, para que al repetirse gane la última.
    const todas = (ocHistorialRemoto || []).slice().reverse().concat(pendientes || []);

    todas.forEach(o => {
        anotar('oc-lista-cosechas', o.Cosecha, {});
        anotar('oc-lista-titulares', o.Titular_CP, { 'oc-titular-cp-cuit': o.Titular_CP_CUIT });
        anotar('oc-lista-destinatarios', o.Destinatario, { 'oc-destinatario-cuit': o.Destinatario_CUIT });
        anotar('oc-lista-destinos', o.Destino, {
            'oc-destino-cuit': o.Destino_CUIT,
            'oc-destino-planta': o.Destino_Planta,
            'oc-destino-direccion': o.Destino_Direccion,
            'oc-destino-localidad': o.Destino_Localidad,
            'oc-destino-provincia': o.Destino_Provincia
        });
        // Los dos fletes comparten lista: suele ser la misma gente. Las órdenes
        // viejas los tienen en la cabecera; las nuevas, en cada camión.
        anotar('oc-lista-fletes', o.Flete_Intermediario, { cuit: o.Flete_Intermediario_CUIT });
        anotar('oc-lista-fletes', o.Flete_Pagador, { cuit: o.Flete_Pagador_CUIT });

        (o.Camiones || []).forEach(cam => {
            anotar('oc-lista-cosechas', cam.cosecha, {});
            anotar('oc-lista-fletes', cam.flete_intermediario, { cuit: cam.flete_intermediario_cuit });
            anotar('oc-lista-fletes', cam.flete_pagador, { cuit: cam.flete_pagador_cuit });
            anotar('oc-lista-transportistas', cam.transportista, { transportista_cuit: cam.transportista_cuit });
            anotar('oc-lista-choferes', cam.chofer, { chofer_cuil: cam.chofer_cuil });
            // El dominio es la mejor clave del camión: trae todo lo demás.
            anotar('oc-lista-dominios', cam.dominio_camion, {
                dominio_acoplado: cam.dominio_acoplado,
                transportista: cam.transportista,
                transportista_cuit: cam.transportista_cuit,
                chofer: cam.chofer,
                chofer_cuil: cam.chofer_cuil
            });
            anotar('oc-lista-acoplados', cam.dominio_acoplado, {});

            (cam.CartasPorte || []).forEach(cp => {
                anotar('oc-lista-productores', cp.productor, { productor_cuit: cp.productor_cuit });
                anotar('oc-lista-contratos-com', cp.contrato_com, { productor: cp.productor, productor_cuit: cp.productor_cuit });

                (cp.Lotes || []).forEach(l => {
                    anotar('oc-lista-lotes-brc', l.lote_brc, {
                        lote_planta: l.lote_planta,
                        tipo: l.tipo,
                        calibre: l.calibre,
                        kg_bolsa: l.kg_bolsa
                    });
                    anotar('oc-lista-lotes-planta', l.lote_planta, {});
                });
            });
        });
    });

    ocMaestros = m;
    ocPintarSugerencias();
}

// Vuelca cada lista en su <datalist>. Ordenadas, para que buscar sea rápido.
function ocPintarSugerencias() {
    if (!ocMaestros) return;
    Object.keys(ocMaestros).forEach(id => {
        const lista = document.getElementById(id);
        if (!lista) return;
        const valores = Object.keys(ocMaestros[id]).sort(
            (a, b) => a.localeCompare(b, 'es', { numeric: true }));
        lista.innerHTML = valores
            .map(v => '<option value="' + String(v).replace(/"/g, '&quot;') + '"></option>')
            .join('');
    });
}

// Completa un campo solo si está vacío: lo escrito a mano nunca se pisa.
function ocCompletarSiVacio(el, valor) {
    if (!el || valor === undefined || valor === null || String(valor).trim() === '') return false;
    if (String(el.value).trim() !== '') return false;
    el.value = valor;
    return true;
}

// --- Cabecera ------------------------------------------------------------
function ocAutocompletarCabecera(input) {
    if (!ocMaestros || !input) return;
    const lista = input.getAttribute('list');
    const datos = ocMaestros[lista] && ocMaestros[lista][String(input.value).trim()];
    if (!datos) return;

    Object.keys(datos).forEach(clave => {
        // La lista de fletes guarda 'cuit' a secas, porque la comparten el
        // intermediario y el pagador: cada uno completa el suyo.
        const id = (clave === 'cuit') ? input.id + '-cuit' : clave;
        ocCompletarSiVacio(document.getElementById(id), datos[clave]);
    });
    ocRecalcularTodo();
}

// --- Tarjetas (camión, carta de porte, lote) -----------------------------
function ocAutocompletarTarjeta(input) {
    if (!ocMaestros || !input) return;
    const lista = input.getAttribute('list');
    if (!lista) return;
    const datos = ocMaestros[lista] && ocMaestros[lista][String(input.value).trim()];
    if (!datos) return;

    const card = input.closest('.dynamic-item-card');
    if (!card) return;

    Object.keys(datos).forEach(clave => {
        // La lista de fletes guarda 'cuit' a secas (la comparten intermediario
        // y pagador): cada uno completa el suyo, flete_xxx -> flete_xxx_cuit.
        const campo = (clave === 'cuit') ? input.dataset.field + '_cuit' : clave;
        const destino = card.querySelector(':scope > .dynamic-card-body [data-field="' + campo + '"]');
        if (!destino) return;
        if (destino.tagName === 'SELECT') {
            if (!destino.value) poblarSelect(destino, destino.dataset.enum, datos[clave]);
        } else {
            ocCompletarSiVacio(destino, datos[clave]);
        }
    });
    ocRecalcularTodo();
}

// =========================================================================
// --- 8. EL PDF DE LA ORDEN: EL INFORME DE CAMIONES QUE VA A PLANTA --------
// =========================================================================
// Es lo que hoy se manda como Excel. Tiene que decir exactamente lo mismo, en
// el mismo orden: la cabecera arriba (quién recibe, qué grano, de qué contrato)
// y después UN BLOQUE POR CAMIÓN con sus cartas de porte y los lotes de cada
// una. El operario lo lee parado al lado del camión, así que lo que busca
// —dominio, chofer, qué lotes cargar y cuántas bolsas— va en negrita y grande.
//
// Reutiliza de app.js el logo, el pie de página, la tabla con bordes y el corte
// de hoja: el PDF de la OC y el del Control de Transporte tienen que verse de
// la misma familia, porque los mira la misma gente el mismo día.

const OC_PDF_MARGEN_X = 14;
const OC_PDF_ANCHO = 182;        // 196 - 14, igual que el reporte de carga
const OC_ROJO = [183, 28, 28];
const OC_GRIS = [40, 40, 40];

// Acepta el id (desde el historial) o la orden ya armada (al guardar). Lo
// segundo importa: recién guardada, el historial todavía se está refrescando y
// buscarla por id podía no encontrarla.
// modo 'blob': no descarga nada, devuelve { doc, nombreArchivo, item } para
// adjuntarlo al correo (correo.js), igual que generarPDFReporte() del Control
// de Transporte. Así el adjunto es exactamente el PDF del botón de descarga.
function ocGenerarPDF(ordenOId, modo) {
    const paraAdjuntar = modo === 'blob';
    const encontrada = (typeof ordenOId === 'string') ? ocBuscarOrden(ordenOId) : ordenOId;
    if (!encontrada) {
        if (paraAdjuntar) throw new Error('No encontré esa orden de carga.');
        alert('No encontré esa orden de carga.');
        return;
    }
    // Las órdenes viejas tienen grano y flete en la cabecera: se pasan al camión
    const orden = ocAdaptarOrdenVieja(encontrada);

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        let y = ocPdfEncabezado(doc, orden);
        y = ocPdfCabeceraDatos(doc, orden, y);
        y = ocPdfCamiones(doc, orden, y);
        ocPdfResumenLotes(doc, orden, y);

        const totalPaginas = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPaginas; p++) {
            doc.setPage(p);
            agregarPiePagina(doc);
            // Numeración: el informe se imprime y se reparte, y una hoja suelta
            // sin número no se sabe de qué orden es ni si falta alguna.
            doc.setTextColor(130, 130, 130);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.text('OC ' + (orden.Nro_OC || '-') + '  ·  Hoja ' + p + ' de ' + totalPaginas,
                     196, 289, { align: 'right' });
        }

        const nombreArchivo = 'Orden_de_Carga_' + (orden.Nro_OC || 'Braun') + '.pdf';
        if (paraAdjuntar) return { doc: doc, nombreArchivo: nombreArchivo, item: orden };
        doc.save(nombreArchivo);
    } catch (err) {
        console.error('No se pudo generar el PDF de la orden:', err);
        if (paraAdjuntar) throw err;
        alert('Ocurrió un inconveniente al generar el PDF de esta orden.');
    }
}

// --- Banner rojo con el número de orden ----------------------------------
function ocPdfEncabezado(doc, orden) {
    doc.setFillColor(...OC_ROJO);
    doc.rect(0, 0, 210, 32, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text('Orden de Carga', OC_PDF_MARGEN_X, 17);

    // El número es el dato con el que la planta y la oficina se entienden.
    doc.setFontSize(12);
    doc.text('N° ' + (orden.Nro_OC || '-'), OC_PDF_MARGEN_X, 26);

    try {
        doc.addImage(LOGO_BRAUN_BLANCO, 'PNG', 150, 4.5, 44, 23.6);
    } catch (logoErr) {
        console.error('No se pudo insertar el logo:', logoErr);
    }
    return 42;
}

// Una línea "etiqueta: valor". Devuelve la Y siguiente.
function ocPdfDato(doc, etiqueta, valor, x, y, anchoEtiqueta) {
    doc.setTextColor(...OC_GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(etiqueta, x, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(valor || '-'), x + anchoEtiqueta, y);
    return y + 5;
}

function ocPdfTitulo(doc, texto, y) {
    y = pdfNuevaPaginaSiNoEntra(doc, y, 14);
    doc.setTextColor(...OC_ROJO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(texto, OC_PDF_MARGEN_X, y);
    doc.setDrawColor(...OC_ROJO);
    doc.setLineWidth(0.4);
    doc.line(OC_PDF_MARGEN_X, y + 1.5, OC_PDF_MARGEN_X + OC_PDF_ANCHO, y + 1.5);
    return y + 7;
}

// --- Cabecera: lo que es igual para toda la orden ------------------------
function ocPdfCabeceraDatos(doc, orden, y) {
    const col2 = 110;   // segunda columna

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...OC_GRIS);

    let yIzq = y, yDer = y;
    // Grano y campaña van por camión; acá solo el resumen de lo que lleva la orden
    yIzq = ocPdfDato(doc, 'Fecha:', orden.Fecha, OC_PDF_MARGEN_X, yIzq, 24);
    yIzq = ocPdfDato(doc, 'Grano:', ocGranosDe(orden), OC_PDF_MARGEN_X, yIzq, 24);

    yDer = ocPdfDato(doc, 'Camiones:', orden.Total_Camiones || 0, col2, yDer, 26);
    yDer = ocPdfDato(doc, 'Bolsas:', formatNumeroAR(orden.Total_Bolsas || 0, 0), col2, yDer, 26);
    yDer = ocPdfDato(doc, 'Total kg:', formatNumeroAR(orden.Total_Kg || 0, 0) + ' kg', col2, yDer, 26);

    y = Math.max(yIzq, yDer) + 3;

    // Destino: es lo que mira quien despacha, así que va en su propio bloque.
    y = ocPdfTitulo(doc, 'DESTINO', y);
    const destino = [
        ['Destinatario', ocPdfConCuit(orden.Destinatario, orden.Destinatario_CUIT)],
        ['Destino de la mercadería', ocPdfConCuit(orden.Destino, orden.Destino_CUIT)],
        ['Planta', orden.Destino_Planta],
        ['Dirección', [orden.Destino_Direccion, orden.Destino_Localidad, orden.Destino_Provincia]
            .filter(Boolean).join(', ')]
    ].filter(f => f[1]);

    if (destino.length) {
        y = ocPdfTablaDosColumnas(doc, destino, y);
    }

    // Lo de la carta de porte que es igual para toda la orden. El remitente
    // comercial productor va en cada CP y el flete en cada camión.
    if (orden.Titular_CP) {
        y = ocPdfTitulo(doc, 'CARTA DE PORTE', y + 8);
        y = ocPdfTablaDosColumnas(doc, [['Titular carta de porte', ocPdfConCuit(orden.Titular_CP, orden.Titular_CP_CUIT)]], y);
    }

    if (orden.Observaciones) {
        y = ocPdfTitulo(doc, 'INDICACIONES', y + 8);
        doc.setTextColor(...OC_GRIS);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const lineas = doc.splitTextToSize(String(orden.Observaciones), OC_PDF_ANCHO);
        y = pdfNuevaPaginaSiNoEntra(doc, y, lineas.length * 4 + 4);
        doc.text(lineas, OC_PDF_MARGEN_X, y);
        y += lineas.length * 4 + 2;
    }

    return y + 4;
}

// Corta un texto al ancho dado (en mm, con la fuente actual) agregando "…".
function ocPdfRecortar(doc, texto, ancho) {
    texto = String(texto || '');
    if (doc.getTextWidth(texto) <= ancho) return texto;
    while (texto.length > 1 && doc.getTextWidth(texto + '…') > ancho) texto = texto.slice(0, -1);
    return texto.trimEnd() + '…';
}

// "ARGENCROPS SA (CUIT 30-...)" — el CUIT entre paréntesis solo si está.
function ocPdfConCuit(razonSocial, cuit) {
    if (!razonSocial) return '';
    return cuit ? razonSocial + '  (CUIT ' + cuit + ')' : String(razonSocial);
}

function ocPdfTablaDosColumnas(doc, filas, y) {
    const columnas = [
        { header: '', width: 62 },
        { header: '', width: OC_PDF_ANCHO - 62 }
    ];
    return dibujarTablaConBordes(doc, OC_PDF_MARGEN_X, y, OC_PDF_ANCHO, columnas, filas,
        { conHeader: false, fontSize: 8.5, alturaFila: 6 });
}

// --- Un bloque por camión, con sus CP y los lotes de cada una ------------
function ocPdfCamiones(doc, orden, y) {
    const camiones = orden.Camiones || [];
    if (!camiones.length) return y;

    camiones.forEach((cam, i) => {
        // El encabezado del camión no puede quedar solo al pie de la hoja: se
        // reserva lugar para él más la primera carta de porte.
        y = pdfNuevaPaginaSiNoEntra(doc, y + 2, 46);
        y = ocPdfBloqueCamion(doc, cam, i + 1, y);

        (cam.CartasPorte || []).forEach((cp, j) => {
            y = ocPdfBloqueCartaPorte(doc, cp, j + 1, y);
        });
    });
    return y;
}

function ocPdfBloqueCamion(doc, cam, numero, y) {
    // Barra roja con el dominio bien grande: es lo primero que se busca.
    doc.setFillColor(...OC_ROJO);
    doc.rect(OC_PDF_MARGEN_X, y, OC_PDF_ANCHO, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('CAMIÓN ' + numero, OC_PDF_MARGEN_X + 2.5, y + 5.6);

    const dominios = [cam.dominio_camion, cam.dominio_acoplado].filter(Boolean).join('  /  ');
    if (dominios) {
        doc.setFontSize(11);
        doc.text(dominios, OC_PDF_MARGEN_X + OC_PDF_ANCHO - 2.5, y + 5.6, { align: 'right' });
    }
    y += 10;

    const filas = [
        ['Grano / Campaña', [cam.especie, cam.cosecha].filter(Boolean).join('  ·  ')],
        ['Transportista', ocPdfConCuit(cam.transportista, cam.transportista_cuit)],
        ['Chofer', ocPdfConCuit(cam.chofer, cam.chofer_cuil)]
    ].filter(f => f[1]);

    if (cam.flete_pagador) filas.push(['Pagador del flete', ocPdfConCuit(cam.flete_pagador, cam.flete_pagador_cuit)]);
    if (cam.flete === 'Sí' && cam.flete_intermediario) {
        filas.push(['Intermediario del flete', ocPdfConCuit(cam.flete_intermediario, cam.flete_intermediario_cuit)]);
    }
    const kmTarifa = [cam.km ? formatNumeroAR(cam.km, 0) + ' km' : '',
                      cam.tarifa ? 'Tarifa ' + formatNumeroAR(cam.tarifa, 2) : ''].filter(Boolean).join('  ·  ');
    if (kmTarifa) filas.push(['Km / Tarifa', kmTarifa]);

    if (filas.length) y = ocPdfTablaDosColumnas(doc, filas, y);
    return y + 2;
}

function ocPdfBloqueCartaPorte(doc, cp, numero, y) {
    const lotes = cp.Lotes || [];
    // El renglón de la CP y su primer lote tienen que entrar juntos: separarlos
    // deja "Carta de Porte 2" al pie de una hoja y sus lotes en la siguiente.
    y = pdfNuevaPaginaSiNoEntra(doc, y, 26);

    // Franja gris clara con los datos de la carta de porte
    doc.setFillColor(242, 242, 242);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(OC_PDF_MARGEN_X, y, OC_PDF_ANCHO, 11, 'FD');

    doc.setTextColor(...OC_GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('CP ' + numero, OC_PDF_MARGEN_X + 2.5, y + 4.5);

    doc.setFont('helvetica', 'normal');
    // Renglón 1: el remitente comercial productor con su CUIT, solo. Con una
    // razón social larga no entra nada más al lado, y si no entra se corta con
    // "…" en vez de pasar al renglón de abajo y pisarlo. A la derecha queda
    // lugar para los kg.
    const anchoTexto = OC_PDF_ANCHO - 16 - 30;
    const linea1 = cp.productor ? 'Rte. com. productor: ' + ocPdfConCuit(cp.productor, cp.productor_cuit) : '';
    doc.text(ocPdfRecortar(doc, linea1, anchoTexto), OC_PDF_MARGEN_X + 16, y + 4.5);

    // Renglón 2: contrato, CTG y observaciones. El N° de carta de porte no va:
    // lo carga planta después.
    const linea2 = [cp.contrato_com ? 'CTTO: ' + cp.contrato_com : '',
                    cp.ctg ? 'CTG: ' + cp.ctg : 'CTG: (a completar)',
                    cp.observaciones || ''].filter(Boolean).join('     ');
    doc.text(ocPdfRecortar(doc, linea2, anchoTexto), OC_PDF_MARGEN_X + 16, y + 8.8);

    if (cp.peso_neto) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(formatNumeroAR(cp.peso_neto, 0) + ' kg',
                 OC_PDF_MARGEN_X + OC_PDF_ANCHO - 2.5, y + 7, { align: 'right' });
    }
    y += 11;

    if (!lotes.length) return y + 3;

    // Los lotes: lo que el operario tiene que ir a buscar a la planta.
    const columnas = [
        { header: 'Lote BRC', width: 24 },
        { header: 'Lote Planta', width: 30 },
        { header: 'Tipo', width: 16 },
        { header: 'Calibre', width: 24 },
        { header: 'Bolsas', width: 24 },
        { header: 'Kg bolsa', width: 24 },
        { header: 'Total kg', width: OC_PDF_ANCHO - 142 }
    ];
    const filas = lotes.map(l => [
        l.lote_brc, l.lote_planta, l.tipo, l.calibre,
        formatNumeroAR(l.bolsas || 0, 0),
        formatNumeroAR(l.kg_bolsa || 0, 0),
        formatNumeroAR(l.total_kg || 0, 0)
    ]);

    y = dibujarTablaConBordes(doc, OC_PDF_MARGEN_X, y, OC_PDF_ANCHO, columnas, filas,
        { fontSize: 8, alturaFila: 6, colorHeaderFill: [120, 120, 120] });
    return y + 4;
}

// --- Acumulado por lote: el control de que no se cargue de más -----------
function ocPdfResumenLotes(doc, orden, y) {
    const porLote = {};
    (orden.Camiones || []).forEach(cam => {
        (cam.CartasPorte || []).forEach(cp => {
            (cp.Lotes || []).forEach(l => {
                const brc = String(l.lote_brc || '').trim();
                if (!brc) return;
                if (!porLote[brc]) porLote[brc] = { planta: l.lote_planta || '', bolsas: 0, kg: 0 };
                porLote[brc].bolsas += Number(l.bolsas) || 0;
                porLote[brc].kg += Number(l.total_kg) || 0;
            });
        });
    });

    const claves = Object.keys(porLote).sort();
    if (!claves.length) return y;

    y = ocPdfTitulo(doc, 'TOTAL POR LOTE', y + 2);

    const columnas = [
        { header: 'Lote BRC', width: 36 },
        { header: 'Lote Planta', width: 46 },
        { header: 'Bolsas', width: 40 },
        { header: 'Total kg', width: OC_PDF_ANCHO - 122 }
    ];
    const filas = claves.map(k => [
        k, porLote[k].planta,
        formatNumeroAR(porLote[k].bolsas, 0),
        formatNumeroAR(porLote[k].kg, 0)
    ]);
    // Última fila: el total de la orden.
    filas.push(['TOTAL', '',
        formatNumeroAR(orden.Total_Bolsas || 0, 0),
        formatNumeroAR(orden.Total_Kg || 0, 0)]);

    y = dibujarTablaConBordes(doc, OC_PDF_MARGEN_X, y, OC_PDF_ANCHO, columnas, filas,
        { fontSize: 8.5, alturaFila: 6 });

    return y;
}

// =========================================================================
// --- 9. ENGANCHE CON CONTROL DE TRANSPORTE --------------------------------
// =========================================================================
// Cada camión de la orden es UN Control de Transporte. Planta elige la orden y
// el camión, y el control arranca con lo que ya decidió la oficina
// (PREGUNTAS_PENDIENTES_LUCAS 3.1): chofer, patentes, un producto por cada lote
// y un contrato por cada carta de porte. Planta completa lo suyo: checklist,
// fotos, firmas, N° y archivo de la CP, Kg CP, indicaciones y correo.
//
// El control guarda Id_OC + Id_Camion_OC (las claves, que no cambian al editar
// la orden) y Nro_OC + Nro_Camion_OC (lo que lee la gente). La pantalla vive en
// app.js (sección "Vínculo con la Orden de Carga"); acá está el armado de los
// datos, que no toca el DOM y se prueba en test_enganche_oc.js.

// Lo que un camión de la orden le pasa al Control de Transporte. null si el
// camión ya no está en la orden (la oficina lo sacó).
//   - N° Lote = Lote BRC y Posición Planta = Lote Planta (definido con Santiago).
//   - Kg CP va VACÍO: es el de la balanza y lo carga planta. El peso declarado
//     en la orden viaja aparte (kg_oc) para mostrarlo como referencia.
//   - Contrato Cliente no existe en la orden: lo completa planta.
function ocDatosParaControl(orden, idCamion) {
    if (!orden) return null;
    const o = ocAdaptarOrdenVieja(orden);
    const camiones = o.Camiones || [];
    const i = camiones.findIndex(c => String(c.Id_Camion || '') === String(idCamion || ''));
    if (i === -1 || !idCamion) return null;
    const cam = camiones[i];

    const productos = [];
    const contratos = [];
    (cam.CartasPorte || []).forEach(cp => {
        (cp.Lotes || []).forEach(l => productos.push({
            producto: cam.especie || '',
            calibre: l.calibre || '',
            tipo: l.tipo || '',
            lote: l.lote_brc || '',
            posicion: l.lote_planta || '',
            envase: 'Bolsas',
            cantidad: ocNumero(l.bolsas),
            kg_envase: ocNumero(l.kg_bolsa)
        }));
        contratos.push({
            contrato_com: cp.contrato_com || '',
            destino: o.Destino || '',
            // Las órdenes viejas traían el N° de CP; las nuevas no (lo carga planta).
            carta_porte: cp.carta_porte || '',
            // "OC 2056 (1069 BLS)": lo que hoy se tipea a mano en el control.
            observaciones_cp: cp.observaciones || '',
            kg_oc: ocNumero(cp.peso_neto)
        });
    });

    return {
        vinculo: {
            Id_OC: o.Id_OC,
            Nro_OC: o.Nro_OC || '',
            Id_Camion_OC: cam.Id_Camion,
            Nro_Camion_OC: i + 1
        },
        chofer: cam.chofer || '',
        patente_chasis: cam.dominio_camion || '',
        patente_acoplado: cam.dominio_acoplado || '',
        productos: productos,
        contratos: contratos
    };
}

// { Id_Camion: control } con los controles de transporte ya hechos sobre los
// camiones de esa orden. Si hubiera dos para el mismo camión, gana el más nuevo.
function ocControlesPorCamion(idOC, controles) {
    const porCamion = {};
    (controles || [])
        .filter(c => c && c.Id_Camion_OC && String(c.Id_OC || '') === String(idOC || ''))
        .sort((a, b) => String(a.Fecha || '').localeCompare(String(b.Fecha || '')))
        .forEach(c => { porCamion[String(c.Id_Camion_OC)] = c; });
    return porCamion;
}

// "OC 2056 · Camión 2 · AB123CD · Pérez" para listas y avisos.
function ocTextoCamion(cam, numero) {
    return ['Camión ' + numero, cam.dominio_camion, cam.chofer].filter(Boolean).join(' · ');
}

// Todas las órdenes que conoce este dispositivo: las del Sheet (o su copia sin
// señal) más las que todavía no subieron. Las pendientes mandan.
async function ocOrdenesConocidas() {
    ocRestaurarCopiaLocal();
    const pendientes = await ocPendientesLocales();
    const ids = new Set(pendientes.map(o => o.Id_OC));
    return pendientes.concat(ocHistorialRemoto.filter(o => !ids.has(o.Id_OC)))
        .sort((a, b) => String(b.Fecha || '').localeCompare(String(a.Fecha || '')));
}

// Desde el historial de órdenes: abre el Control de Transporte con esta orden
// ya elegida; planta solo tiene que elegir el camión.
function ocIniciarControl(idOC) {
    if (typeof iniciarControlDesdeOC === 'function') iniciarControlDesdeOC(idOC);
}
