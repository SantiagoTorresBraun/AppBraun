// ============================================================================
// VISOR DE FOTOS A PANTALLA COMPLETA
// ============================================================================
// Al tocar una foto en la vista Detalle (Control de Calidad o Control de
// Transporte) se abre a pantalla completa. Se engancha por delegación sobre la
// clase `detalle-foto-img`, así funciona en los dos módulos sin tocar el código
// que arma cada detalle, y sigue andando aunque el detalle se vuelva a renderizar.
//
// - Recorre las fotos de la MISMA grilla: flechas, teclado (← →) o deslizando.
// - Tocar la foto alterna zoom (para ver daños de cerca); con zoom se desplaza
//   arrastrando.
// - Cierra con ✕, Esc o tocando el fondo oscuro.
// ============================================================================

const visorFotos = {
    fotos: [],      // [{ src, nombre }]
    indice: 0,
    overlay: null,
    toqueInicioX: null
};

function construirVisorFotos() {
    if (visorFotos.overlay) return visorFotos.overlay;

    const overlay = document.createElement('div');
    overlay.className = 'visor-fotos';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Foto ampliada');
    overlay.innerHTML = `
        <div class="visor-fotos-barra">
            <span class="visor-fotos-titulo"></span>
            <span class="visor-fotos-contador"></span>
            <button type="button" class="visor-fotos-cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="visor-fotos-escenario">
            <img class="visor-fotos-img" alt="">
        </div>
        <button type="button" class="visor-fotos-nav visor-fotos-prev" aria-label="Foto anterior">‹</button>
        <button type="button" class="visor-fotos-nav visor-fotos-next" aria-label="Foto siguiente">›</button>
        <div class="visor-fotos-ayuda">Tocá la foto para acercar</div>`;

    overlay.querySelector('.visor-fotos-cerrar').addEventListener('click', cerrarVisorFotos);
    overlay.querySelector('.visor-fotos-prev').addEventListener('click', () => moverVisorFotos(-1));
    overlay.querySelector('.visor-fotos-next').addEventListener('click', () => moverVisorFotos(1));

    const escenario = overlay.querySelector('.visor-fotos-escenario');
    // Tocar el fondo (no la foto) cierra
    escenario.addEventListener('click', e => {
        if (e.target === escenario) cerrarVisorFotos();
    });
    overlay.querySelector('.visor-fotos-img').addEventListener('click', alternarZoomVisorFotos);

    // Deslizar para cambiar de foto (solo sin zoom: con zoom el dedo desplaza la imagen)
    escenario.addEventListener('touchstart', e => {
        visorFotos.toqueInicioX = e.touches.length === 1 ? e.touches[0].clientX : null;
    }, { passive: true });
    escenario.addEventListener('touchend', e => {
        if (visorFotos.toqueInicioX === null || overlay.classList.contains('con-zoom')) return;
        const dx = e.changedTouches[0].clientX - visorFotos.toqueInicioX;
        visorFotos.toqueInicioX = null;
        if (Math.abs(dx) > 50) moverVisorFotos(dx < 0 ? 1 : -1);
    });

    document.body.appendChild(overlay);
    visorFotos.overlay = overlay;
    return overlay;
}

function abrirVisorFotos(fotos, indice) {
    if (!fotos.length) return;
    visorFotos.fotos = fotos;
    visorFotos.indice = indice;
    const overlay = construirVisorFotos();
    overlay.classList.toggle('una-sola', fotos.length === 1);
    mostrarFotoVisor();
    overlay.classList.add('abierto');
    document.body.style.overflow = 'hidden';
    overlay.querySelector('.visor-fotos-cerrar').focus();
}

function cerrarVisorFotos() {
    if (!visorFotos.overlay) return;
    visorFotos.overlay.classList.remove('abierto', 'con-zoom');
    document.body.style.overflow = '';
}

function moverVisorFotos(paso) {
    const total = visorFotos.fotos.length;
    if (total < 2) return;
    visorFotos.indice = (visorFotos.indice + paso + total) % total;
    mostrarFotoVisor();
}

function mostrarFotoVisor() {
    const overlay = visorFotos.overlay;
    const foto = visorFotos.fotos[visorFotos.indice];
    overlay.classList.remove('con-zoom');
    const img = overlay.querySelector('.visor-fotos-img');
    img.src = foto.src;
    img.alt = foto.nombre;
    overlay.querySelector('.visor-fotos-titulo').textContent = foto.nombre;
    overlay.querySelector('.visor-fotos-contador').textContent =
        visorFotos.fotos.length > 1 ? `${visorFotos.indice + 1} / ${visorFotos.fotos.length}` : '';
}

function alternarZoomVisorFotos(e) {
    const overlay = visorFotos.overlay;
    const escenario = overlay.querySelector('.visor-fotos-escenario');
    const img = e.currentTarget;

    if (overlay.classList.contains('con-zoom')) {
        overlay.classList.remove('con-zoom');
        return;
    }
    // Centrar el zoom en el punto tocado
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    overlay.classList.add('con-zoom');
    escenario.scrollLeft = fx * escenario.scrollWidth - escenario.clientWidth / 2;
    escenario.scrollTop = fy * escenario.scrollHeight - escenario.clientHeight / 2;
}

// Delegación: cualquier foto de detalle, presente o futura
document.addEventListener('click', e => {
    const img = e.target.closest && e.target.closest('.detalle-foto-img');
    if (!img) return;
    const grilla = img.closest('.detalle-foto-grid') || img.parentElement;
    const imgs = Array.from(grilla.querySelectorAll('.detalle-foto-img'));
    const fotos = imgs.map(i => ({ src: i.currentSrc || i.src, nombre: i.alt || 'Foto' }));
    abrirVisorFotos(fotos, Math.max(0, imgs.indexOf(img)));
});

// El recuadro entero de la foto (incluida la etiqueta) también abre el visor
document.addEventListener('click', e => {
    if (!e.target.closest || e.target.closest('.detalle-foto-img')) return;
    const caja = e.target.closest('.detalle-foto-box');
    const img = caja && caja.querySelector('.detalle-foto-img');
    if (img) img.click();
});

document.addEventListener('keydown', e => {
    if (!visorFotos.overlay || !visorFotos.overlay.classList.contains('abierto')) return;
    if (e.key === 'Escape') cerrarVisorFotos();
    else if (e.key === 'ArrowLeft') moverVisorFotos(-1);
    else if (e.key === 'ArrowRight') moverVisorFotos(1);
});
