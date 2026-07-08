# Documentación de Cambios — Sesión 08/07/2026

Registro completo de las mejoras implementadas en la PWA Braun (Control de Carga).
Archivos afectados: `index.html`, `app.js`, `style.css`. No se modificó `sw.js` ni la lógica de guardado existente.

---

## 1. Modal "Gestionar Opciones" (reemplazo del alert temporal)

**Problema:** el botón ⚙ "Opciones" del formulario de carga mostraba un `alert()` con el texto "En construcción".

**Solución implementada:**

| Pieza | Ubicación | Descripción |
|---|---|---|
| HTML | `index.html` → `#modal-gestor-opciones` | Modal con backdrop, header rojo Braun, pestañas y lista de opciones |
| CSS | `style.css` → clases `gestor-*` | Mismo patrón visual que el modal de imágenes existente (`.image-modal`) |
| JS | `app.js` → sección "GESTOR CENTRALIZADO DE OPCIONES" | Funciones nuevas, sin tocar la lógica de enums existente |

**Funcionalidad:**
- Pestañas: **Productos, Calibres, Tipos de Carga, Envases** (+ **Personal**, agregada luego para la Ticketera).
- Agregar opción: input + botón (también con tecla Enter). Valida vacíos y duplicados (sin distinguir mayúsculas).
- Quitar opción: botón 🗑 por ítem, con confirmación. No borra registros ya guardados que usen ese valor.
- Persistencia: usa el sistema existente `ENUMS` + `guardarEnums()` → `localStorage` (clave `braun_enums_v1`).
- **Actualización en vivo:** `refrescarSelectsEnum(enumKey)` repuebla todos los `select.enum-select[data-enum=...]` del formulario conservando la selección actual, sin recargar la página.
- Cierre: botón ✕, clic fuera del modal, o tecla Escape.

**Funciones JS nuevas:** `abrirGestorOpciones()`, `cerrarGestorOpciones()`, `cambiarTabGestor()`, `renderizarListaGestor()`, `agregarOpcionGestor()`, `quitarOpcionGestor()`, `refrescarSelectsEnum()`, `abrirGestorPersonal()`.

---

## 2. Rediseño mobile del Historial de Cargas (cards)

**Problema:** en celular la lista se veía desorganizada — los datos flotaban a la derecha sin etiquetas.

**Causa raíz:** el CSS mobile (`@media max-width: 720px`) convertía las filas en cards usando `td:before { content: attr(data-label) }`, pero el JS que genera las filas nunca agregaba el atributo `data-label`.

**Solución:**
- `app.js` → `filtrarYRenderizarTabla()`: cada `<td>` ahora lleva `data-label` ("Fecha", "Producto", "Contrato", "Estado", "Peso") y clases `td-fecha` / `td-estado` / `td-acciones`. Se agregó `<span class="reg-num-movil">#Id_Carga</span>` junto a la fecha (oculto en escritorio).
- `style.css` → bloque "CARD DEL HISTORIAL DE CARGAS EN MOBILE", scopeado a `#tabla-historial-body` (no afecta escritorio ni otras tablas):
  - Card blanca, borde redondeado 10px, sombra sutil.
  - Encabezado: **fecha + n° de registro** en negrita con separador inferior.
  - Filas de datos: etiqueta en negrita a la izquierda (ancho fijo 80px) + dato en texto normal.
  - Badge de estado como **píldora** (`border-radius: 50px`) alineada a la derecha, con los colores pastel existentes (verde/naranja/rojo).
  - Acciones (✏ 🗑 PDF) centradas abajo, con área táctil de **44×44px** y separador superior.

---

## 3. Nueva sección "Contratos"

**Objetivo:** vista de solo lectura sobre los contratos ya registrados en Control de Carga.

**Menú principal:** card nueva "Contratos" con ícono SVG de documento (`onclick="abrirVistaContratos()"`), mismo formato premium que las demás.

**Vista** (`index.html` → `#view-contratos`):
- Breadcrumb **Inicio > Contratos** ("Inicio" clickeable; el botón ← del header también funciona).
- Filtros con la misma estética de Control de Carga: **Desde / Hasta / Búsqueda Rápida** (IDs: `filter-cont-fecha-desde`, `filter-cont-fecha-hasta`, `filter-cont-search`).
- Panel blanco con contador de contratos y tabla scrolleable (`max-height: 65vh`, encabezado sticky).

**Columnas:** Fecha · Contrato Comercial · Contrato Cliente · Carta de Porte · Kg CP · Kg Descarga · Diferencia KG · Observaciones CP.

**Lógica de datos** (`app.js` → `renderizarTablaContratos()`):
- Fuentes: `historialGeneral` (Google Sheets) + `obtenerRegistrosLocales()` (IndexedDB pendientes), con deduplicación por `Id_Carga` — igual que el historial. **Solo lectura.**
- Aplana los registros: un registro con N contratos genera N filas, heredando Fecha y Observaciones del registro.
- **Diferencia KG = Kg CP − Kg Descarga**, calculada en vivo (decisión confirmada; el campo guardado `diferencia_carga` usa la convención inversa y NO se modificó). Roja si es negativa, verde si es positiva.
- **Observaciones CP** = campo `Indicaciones_Descarga` del registro (decisión confirmada; no existe un campo de observaciones por contrato).
- Números con formato es-AR (separador de miles). Orden: más recientes primero.
- Mobile: cards con etiquetas, mismo patrón que el historial (scopeado a `#tabla-contratos-body`).

**Cambio en código existente:** solo un `else if (idDestino === 'view-contratos')` nuevo en `cambiarVista()`.

---

## 4. Estandarización de la Ticketera

### 4.1 Navegación
- Se eliminó el botón blanco "← Volver al Menú".
- Rama nueva en `cambiarVista()` para `view-ticketera`: título "Ticketera" en el header rojo + flecha ← estándar.

### 4.2 Personal centralizado
- Enum nuevo en `ENUMS_DEFAULT`: `personal: ["Santiago Torres", "Melisa Braun", "Jonathan Rui", "Lucas Ramis", "Carla Candoni", "Alejo Chamorro"]`.
- **Nombre solicitante** pasó de texto libre a `<select>`; **Responsable asignado** ahora usa la misma lista (antes usaba `responsables`).
- Botón ⚙ junto a ambos campos (`abrirGestorPersonal()`) → abre el modal de opciones directo en la pestaña **Personal** (5ª pestaña del modal).
- Los selects de responsable dentro de las filas del historial de tickets también usan `ENUMS.personal`, y se refrescan al editar la lista.
- La clave vieja `responsables` sigue existiendo en defaults por compatibilidad, pero ya no se usa en la UI.
- ⚠️ Nota funcional: los nombres nuevos deben agregarse desde el ⚙ antes de poder seleccionarlos (lista cerrada, decisión confirmada).

### 4.3 Historial de tickets rediseñado
- Filtros con la estética estándar: **Estado** (Abierto/En Proceso/Cerrado), **Prioridad** (Baja/Media/Alta) y **Búsqueda Rápida** (solicitante, correo, responsable, detalle). IDs: `filter-ticket-estado`, `filter-ticket-prioridad`, `filter-ticket-search`.
- `renderTicketsTicketera()` aplica los filtros antes de pintar. La lógica viva de las filas (cambio de responsable/estado → IndexedDB + notificación al backend vía `WEB_APP_URL`) quedó **intacta**.
- Badges de prioridad: de colores sólidos a **píldoras pastel** (coherentes con los badges del historial de cargas).
- Selects de las filas con estilo estándar (borde, focus rojo Braun).
- Mobile: cada ticket es una card blanca (scopeado a `#ticketera-body`), fecha como encabezado, prioridad a la derecha, acciones centradas 44×44px.

---

## 5. Rediseño premium del Menú Principal

Todo por CSS — el HTML de las cards no cambió.

1. **Fondo:** el menú principal y el submenú de carga usan la **misma foto de campo que el login** con velo blanco al 92% (`linear-gradient` sobre la imagen). `background-attachment: fixed` en escritorio (parallax sutil); `scroll` en mobile (≤720px) por rendimiento en iOS.
2. **Cards glassmorphism:** `rgba(255,255,255,0.85)` + `backdrop-filter: blur(4px)`, borde fino `rgba(167,29,29,0.1)`, sombra doble suave. **Hover:** `translateY(-5px)`, borde iluminado en rojo Braun `#A71D1D`, sombra teñida de rojo.
3. **Íconos unificados:** se eliminaron los 4 colores (rojo/verde/azul/violeta). Todos: fondo `rgba(167,29,29,0.08)` + ícono rojo `#A71D1D`. Hover: escala 1.08 sin rotación.
4. **Tipografía/badges:** títulos en `#1f2328`; badges "Activo"/"En desarrollo" como píldoras pastel con borde fino; badge "Próximamente" como píldora blanca con blur y sombra.
5. Media queries de tablet/celular actualizados para que el hover sea consistente.

---

## Convenciones establecidas (para futuras pantallas)

- **Filtros:** reutilizar `.filters-section` / `.filters-title` / `.filters-grid` / `.filter-group`.
- **Tablas:** `.data-table` dentro de `.table-responsive`; en mobile, cards mediante `data-label` en cada `<td>` + CSS scopeado al `tbody` por ID.
- **Badges:** píldora (`border-radius: 50px`), fondo pastel `rgba(color, 0.10-0.15)` + texto bold del color pleno.
- **Selects editables:** clase `enum-select` + `data-enum="clave"` → se repueblan solos con `refrescarSelectsEnum()`.
- **Navegación:** toda vista nueva necesita su rama `else if` en `cambiarVista()` (título de header + botón ←).
- **Rojo institucional del rediseño:** `#A71D1D` / `rgba(167,29,29,x)` (el resto de la app usa `--color-primary: #b71c1c`).

## Pendientes / ideas a futuro

- Unificar los dos tonos de rojo (`#A71D1D` vs `#b71c1c`) en una sola variable CSS.
- Reemplazar la foto de campo por una textura de granos de garbanzo propia si se consigue el asset.
- La clave `responsables` de ENUMS quedó sin uso en la UI (limpiable en el futuro).
- "Observaciones CP" muestra `Indicaciones_Descarga` (a nivel registro); si se necesita observación por contrato, habría que agregar el campo al formulario.
