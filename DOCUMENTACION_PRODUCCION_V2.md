# Producción v2 — Informes de Campo

*Escrito el 11/09/2026, a partir de los reportes reales que el equipo de
producción manda hoy por WhatsApp (contrato CN26-044, campos Don Manuel y
Ronchi, campaña 2026).*

Este documento **reemplaza como guía de rumbo** a
[DOCUMENTACION_PRODUCCION_DISENO.md](DOCUMENTACION_PRODUCCION_DISENO.md), que
sigue siendo válido pero **solo para el submódulo de Muestreo georreferenciado**.

---

## Resumen en tres líneas

1. El módulo que estaba hecho modela **muestreo por puntos con GPS**. Lo que la
   gente realmente hace es **un informe por visita, con mediciones por lote y un
   texto narrado**, que termina pegado en un grupo de WhatsApp.
2. Por eso Producción se parte en **dos submódulos**: *Muestreo de Campo* (lo que
   ya existía, intacto) e **Informes de Campo** (lo nuevo).
3. El video **no puede** viajar por el camino actual (base64 → Apps Script →
   Drive). Ningún ajuste lo salva. Hay que subirlo derecho del navegador a Drive.

---

## 1. El diagnóstico: lo que modela la app ≠ lo que hace la gente

El módulo de hoy modela **muestreo georreferenciado por puntos**: un recorrido,
N puntos con GPS, cada punto con una plaga / severidad / incidencia. Es un
modelo de monitoreo entomológico.

Los reportes reales no son eso. El patrón que se repite en los seis mensajes es:

```
CONTRATO (CN26-044 · siembra asociada ACIAGRO-ARGAN-BRC)
  └── CAMPO (Don Manuel, Ronchi)
        └── LOTE (9F, M8, M9, L1, L2, L3, cabeceras)
              └── INFORME (una fecha, un TIPO)
                    ├── mediciones POR LOTE (14,3 sem/m · 6 cm · 11,9 pl/m · 3% daño)
                    ├── bloques narrados (malezas, plagas, observaciones, acciones)
                    └── pack de media (fotos rotuladas "Don Manuel 9F 14 sem/m" + videos)
```

### Los seis tipos de informe

| # | Tipo | Qué mide |
|---|---|---|
| 1 | Gira previa / lotes a sembrar | estado del lote, humedad, malezas, decisión |
| 2 | Envío de semilla | camiones, kg, inoculado, responsable |
| 3 | **Siembra** | variedad, humedad, **sem/m + distribución + profundidad por lote**, funcionamiento de sembradoras, malezas |
| 4 | **Post-siembra / nacimiento** | **plantas/m por lote**, estadío, % de daño por plaga, acciones |
| 5 | Estadio vegetativo | fenología (V6–V13), nodulación, plagas/enfermedades, malezas |
| 6 | Estadio reproductivo | fenología (R1…), plagas, malezas, acciones |

### Las cuatro cosas que faltaban

1. El **contrato / campaña** como paraguas.
2. El **lote** como entidad con historia propia.
3. El **tipo de informe** (cada uno pide campos distintos).
4. Y la más importante:

> **La salida no es un PDF. Es un mensaje de WhatsApp.** El producto final del
> módulo tiene que ser ese texto con emojis, armado solo, listo para copiar y
> pegar — idéntico al que hoy escriben a mano. El PDF y el historial son
> consecuencia, no el objetivo.

Ahí está el valor: hoy tipean 40 líneas en el celular, en el campo, con sol. Si
la app tipea eso por ellos, la adoptan sin que nadie los obligue.

---

## 2. Modelo de datos

Cinco entidades. **No reemplaza** a `Muestreo` / `Muestreo_Puntos`: convive.

| Entidad | Campos clave | Por qué |
|---|---|---|
| **contratos_prod** | `Id`, `Codigo` (CN26-044), `Descripcion`, `Campania`, `Campos[]`, `Lotes[]` | El paraguas. Se carga UNA vez por campaña, desde el escritorio. En el campo solo se elige. |
| **lotes** | `Campo`, `Lote` (9F), `Sup_ha`, `Cultivo`, `Variedad`, `Fecha_Siembra` | Sin esto no hay evolución. Con esto, "plantas/m del 9F a lo largo de la campaña" sale solo. |
| **informes** | `Id_Informe`, `Id_Contrato`, `Fecha`, `Tipo`, `Responsable`, `Matricula`, `Resumen`, `Malezas`, `Plagas`, `Acciones`, `Estado`, `usuario_registro` | El encabezado + los bloques narrados. |
| **informe_lotes** | `Id_Informe`, `Campo`, `Lote`, `Sem_m`, `Prof_cm`, `Distribucion`, `Plantas_m`, `Estadio`, `Dano_pct`, `Nota` | **Una fila por lote por visita.** Es la tabla que hace posible cualquier gráfico. Hoy ese dato vive dentro de un párrafo de WhatsApp y se pierde. |
| **informe_media** | `Id_Informe`, `Lote?`, `Tipo` (foto/video/audio), `URL`, `Etiqueta`, `Orden`, `Estado_Subida` | Cantidad variable, con **estado de subida propio por archivo**. Crítico: ver §4.2. |

En la v1 implementada, `contratos_prod` y `lotes` viven en **localStorage** (mismo
patrón que los `ENUMS` del resto de la app), porque son pocos y los edita una
sola persona. Cuando haya más de un cargador, pasan al Sheet.

---

## 3. La UX: cuatro pantallas, cero navegación mental

**P1 — Empezar (3 toques).** Contrato → Fecha (hoy por defecto) → Tipo de
informe. Nada más.

**P2 — El formulario cambia según el tipo.** Si es Siembra pide sem/m,
profundidad, distribución y funcionamiento de sembradoras. Si es Post-siembra
pide plantas/m y % de daño. **Nunca se ve un campo que no corresponde.** Ese es
todo el secreto de que sea simple: no es un formulario más chico, es un
formulario distinto por tipo.

**P3 — Bloque repetible por lote.** El `+ Lote` con tres números grandes y
teclado numérico. Es exactamente lo que hoy escriben como
`🔹 F9 • Semillas por metro: 14,3`.

**P4 — Bloques narrados con chips.** Malezas tiene su catálogo (parietaria,
peludilla, malva, girasol guacho, rama negra, sorgo de Alepo…): se tocan los que
hay y la app arma la frase. Abajo, texto libre + **dictado por voz** (Web Speech
API cuando hay señal). Lo mismo para plagas y acciones.

**Media:** un botón que abre cámara/galería con **multi-selección**, y acepta
foto, video y audio. Cada archivo se asigna al lote al que pertenece y hereda la
etiqueta — la app le estampa `Don Manuel · 9F · 14 sem/m`, que es lo que hoy
hacen a mano con una app aparte.

**Botón final: "Armar mensaje".** Genera el texto con los emojis, en el formato
de ellos, y ofrece **Copiar**, **Compartir por WhatsApp**
(`navigator.share({ text, files })`), y guardar / PDF / correo.

Autosave en cada cambio: nunca hay un "guardar" que se pueda olvidar, y cerrar
la app no pierde nada.

---

## 4. Offline real — y una bomba que ya estaba puesta

"Que funcione sin señal" estaba resuelto a medias, con un patrón que **no
sobrevive al video**. Tres problemas concretos del submódulo de Muestreo, que
**el submódulo nuevo no repite**:

### 4.1 Todo se guardaba como base64, en RAM

[produccion.js:283](produccion.js#L283) mete la foto como string
`data:image/jpeg;base64,...` dentro del registro. Base64 infla un 33% y obliga a
tener el archivo entero como string de JavaScript. Una foto comprimida (300 KB)
aguanta. **Un video de 60 MB se vuelve un string de 80 MB y tira abajo el
navegador en un celular de gama media.**

→ **Informes de Campo guarda `Blob` nativo en IndexedDB**, en un store aparte
(`informes_media`). IndexedDB los soporta sin conversión y sin costo de RAM. Y
al estar en otro store, listar los informes no carga ni un byte de media.

### 4.2 La sincronización mandaba el informe entero en un POST

[produccion.js:428](produccion.js#L428) arma un payload con el muestreo y todas
sus fotos. Con 20 fotos son ~25 MB en un solo POST a Apps Script; si falla una
foto, **falla el informe completo** y se reintenta todo desde cero.

→ **Sincronización por piezas:** primero el texto (2 KB, sube aunque haya una
barra de señal), después cada archivo por separado, con su propio estado y su
propio reintento. El informe queda completo y visible en el servidor desde el
minuto uno; la media va llegando.

### 4.3 El almacenamiento del celular es descartable por defecto

No se pedía `navigator.storage.persist()`. Android puede vaciar IndexedDB bajo
presión de espacio, y en iPhone es peor (§5.4).

→ Se pide persistencia al entrar al submódulo, se muestra
`navigator.storage.estimate()` como barra ("3,2 GB usados · 18 GB libres") y se
avisa al 80%. Un agrónomo que sale a recorrer con el celular lleno tiene que
enterarse **antes** de salir, no al volver.

---

## 5. Los límites — dónde revienta cada eslabón

### 5.1 La cadena de hoy (documentado)

| Eslabón | Límite duro | Traducción |
|---|---|---|
| Celda de Google Sheet | **50.000 caracteres** | Base64 de ~37 KB. **Una foto de celular no entra en una celda.** Por eso ya van a Drive. |
| Google Sheet | 10 millones de celdas | Lejísimos. No es el problema. |
| Ejecución de Apps Script | **6 minutos** | Decodificar base64 grande + crear en Drive se lo come. |
| Cuota de runtime Apps Script | 90 min/día (consumer) · **6 h/día (Workspace)** | Subir video por acá quemaría la cuota diaria de TODA la app, correos y guardado de cargas incluidos. |
| Adjunto de Gmail / MailApp | **25 MB** | Un video nunca va por correo. |
| Drive: archivo individual | 5 TB | No es el límite. |
| Drive: cuota de la cuenta | Según el plan | **Este sí es el límite real.** Ver §5.3. |
| IndexedDB en Android/Chrome | ~60% del disco libre, **descartable** | Generoso, pero el sistema lo puede vaciar. |
| IndexedDB en iOS/Safari | **~1 GB por origen** + purga a los 7 días sin uso | Ver §5.4. |

> El tamaño máximo del cuerpo de un POST a un Web App de Apps Script **no está
> documentado por Google**. En la práctica falla mucho antes de cualquier número
> teórico, por memoria del intérprete. No es un número: es "no es un canal para
> archivos grandes".

### 5.2 Veredicto por tipo de archivo

| | ¿Puede seguir el camino actual (base64 → Apps Script → Drive)? |
|---|---|
| **Foto comprimida** (1280 px, JPEG 0.6 ≈ 200-400 KB) | ✅ Sí. Es lo que ya hace y anda. |
| **Foto original** (3-5 MB) | ⚠️ Anda, pero es caro e innecesario. Comprimir siempre. |
| **Audio** (nota de voz, 30 s ≈ 300 KB) | ✅ Sí. |
| **Video** | ❌ **No. Nunca.** Tamaño, base64, 6 minutos y cuota diaria: los cuatro a la vez. |

**Esta es la conclusión central: el video obliga a un camino de subida nuevo.**

### 5.3 Cuánto va a pesar (estimado — hay que medirlo)

| | Supuesto | Peso |
|---|---|---|
| Foto comprimida | 300 KB | |
| Video 30 s, 1080p, del celular | **50-70 MB** | ← el problema |
| Video 30 s recomprimido a 720p | ~12-18 MB | |
| Un informe | 20 fotos + 2 videos | ~6 MB + ~120 MB = **~126 MB** |
| Una campaña por contrato | 8 informes | **~1 GB** |
| 10 contratos por campaña | | **~10 GB/año** |

Contra eso:

- **Gmail personal (`analistabrc@gmail.com`, donde están los 3.949 archivos
  históricos): 15 GB compartidos con su correo → se llena en el primer año.** Es
  el riesgo más concreto de todo el documento.
- **Supabase Free: 1 GB → no alcanza ni para un contrato.** Pro (USD 25/mes) da
  100 GB.
- **Google Workspace: según el plan, típicamente 2 TB agrupados → sobra.**

> Todo esto se confirma o se derrumba con una medición de 10 minutos: pedir el
> pack completo de UN informe (fotos + videos como los mandan) y pesarlo.

### 5.4 El riesgo que casi nadie ve: iPhone

Si un agrónomo usa iPhone y abre la app **desde Safari sin instalarla**, iOS
puede **borrar IndexedDB a los 7 días** de no entrar. Un informe grabado un
viernes en un campo sin señal, con el celular guardado hasta la semana
siguiente, **desaparece**. Instalada en la pantalla de inicio (PWA), esa purga
no aplica.

→ Si hay iPhones, **instalar la app en la pantalla de inicio deja de ser
opcional y pasa a ser parte del procedimiento.**

---

## 6. Dónde guardar la media — tres opciones

### Opción A — Subida directa del navegador a Drive ✅ **recomendada**

El navegador sube el archivo a la Drive API **sin pasar por Apps Script**.

- **Media parte ya está hecha:** [correo.js:317](correo.js#L317) ya usa Google
  Identity Services con `initTokenClient` para mandar el Gmail del usuario. Solo
  hay que agregar el scope `drive.file` al mismo flujo.
- `drive.file` = la app solo ve los archivos que ella misma creó. Scope mínimo,
  el más fácil de aprobar.
- **Subida resumable:** va por trozos y **se reanuda** si se corta la señal. Sin
  límite de 6 minutos, sin límite de tamaño, sin base64, sin RAM.
- Al Sheet va solo el `fileId` (~80 caracteres): el historial queda plano para
  siempre — el mismo arreglo del Hallazgo 6 ya documentado.
- **Guardar en una Unidad compartida**, no en el Drive personal de cada
  agrónomo: el espacio y la propiedad quedan de la empresa, y de paso se ataca
  el punto único de falla de [ALMACENAMIENTO_DATOS.md](ALMACENAMIENTO_DATOS.md).
- Costo adicional: **0**, si ya hay Workspace con Unidades compartidas.

### Opción B — Supabase Storage

Más limpio y desacoplado de Google, y ya existe
[MIGRACION_SUPABASE.md](MIGRACION_SUPABASE.md). Pero el plan Free (1 GB) **no
aguanta video**: son USD 25/mes desde el día uno. Tiene sentido solo si la
migración completa ya está decidida.

### Opción C — Video fuera de la app (honesta y barata)

La app guarda fotos y del video guarda **solo una miniatura + la duración**, con
el informe diciendo "video enviado por WhatsApp". No es trazabilidad: es dejar
constancia.

**Recomendación: A** para toda la media, y Apps Script/Sheet solo para datos. Si
mañana se migra a Supabase, la media ya está desacoplada y no se toca.

---

## 7. Qué hay que verificar antes de decidir

1. **Qué plan de Google Workspace hay y cuánto espacio queda** en la cuenta
   dueña (`admin.google.com` → Almacenamiento).
2. **¿Hay Unidades compartidas?** Requiere Business Standard o superior.
3. **Android o iPhone** entre los agrónomos → define el riesgo de §5.4.
4. **Pesar un informe real.** Recalcula toda la §5.3.
5. **¿Aceptan instalar la app en la pantalla de inicio?** En iPhone no es
   negociable.
6. **Los 6 tipos con Melisa:** confirmar qué campo va en cada uno.

---

## 8. Fases

| Fase | Qué | Estado |
|---|---|---|
| **0** | Cerrar el modelo: contrato/campo/lote + los 6 tipos | ✅ hecho (este documento) |
| **1** | Submódulos + modelo + **generador del mensaje de WhatsApp** | ✅ implementado |
| **2** | Media local: `Blob` en IndexedDB, multi-selección, etiquetado, `navigator.share` | ✅ implementado |
| **3** | Subida directa a Drive + cola por archivo + persistencia de storage | ⏳ pendiente |
| **4** | Historial por lote (evolución de plantas/m), PDF, correo | ⏳ pendiente |

Con las fases 0-2 el submódulo **ya reemplaza al WhatsApp actual**, aunque
todavía no suba la media al servidor.

---

## 9. Cómo quedó armado (v1, 11/09/2026)

### Navegación

```
Menú principal
  └── Producción            → view-submenu-produccion   (NUEVO: elige submódulo)
        ├── Muestreo de Campo    → view-modulo-produccion  (lo de antes, intacto)
        └── Informes de Campo    → view-informes-campo     (NUEVO)
              └── Informe abierto → view-informe-activo
```

### Archivos

| Archivo | Qué cambió |
|---|---|
| [produccion-informes.js](produccion-informes.js) | **Nuevo.** Todo el submódulo de Informes de Campo. |
| [index.html](index.html) | El submenú de Producción y las dos vistas nuevas. |
| [app.js](app.js) | IndexedDB v4 con los stores `informes_campo` e `informes_media`; rutas nuevas en `cambiarVista`. |
| [style.css](style.css) | Bloque `INFORMES DE CAMPO` al final. |
| [sw.js](sw.js) | `produccion-informes.js` agregado a la caché offline. |
| [01_backend_principal.gs](01_backend_principal.gs) | Acciones `guardar_informe` / `actualizar_informe` / `eliminar_informe` y `?action=read_informes`; hojas `Informes_Campo` e `Informes_Campo_Lotes` (se autocrean). |
| [produccion.js](produccion.js) | Submódulo **Muestreo**: ficha del recorrido, mapa real y listado agrupado por campo (ver §10). |
| [vendor/leaflet/](vendor/leaflet/) | **Nuevo.** Leaflet 1.9.4 vendorizado, igual que jsPDF y Font Awesome. |

### Lo que NO hace todavía (dicho de frente)

- **La media no sube al servidor.** Queda en IndexedDB del dispositivo y se
  comparte por WhatsApp desde ahí. Sube cuando se haga la Fase 3 (Opción A).
  La UI lo dice con todas las letras: *"Las fotos y videos viajan por WhatsApp;
  todavía no se guardan en el servidor."*
- **No hay PDF ni correo** del informe (Fase 4).
- **No hay gráfico de evolución por lote** (Fase 4). El dato ya se guarda
  estructurado, que es lo que lo hace posible después.

> **Recordatorio de siempre:** tocar un `.gs` no alcanza. Hay que ir al editor de
> Apps Script, pegarlo y hacer **Implementar → Nueva versión**.


---

## 10. Muestreo de Campo — lo que se arregló el 11/09/2026

Tres cosas que hacían que la pantalla no se entendiera:

### 10.1 El listado no se leía

Era una lista plana de tarjetas que arrancaban con el **número de lote**:
`1 · Soja`, `1 · Soja`, `1 · Soja` — tres recorridos distintos que se veían
iguales, y en ninguno se veía de qué campo eran.

Ahora está **agrupado por campo**, que es como se organiza el trabajo: se entra
a *La Lucila* y ahí están sus lotes, cada uno con su fecha, sus puntos y cuántos
tienen GPS. El encabezado del grupo resume: recorridas, lotes, puntos y la
fecha de la última.

### 10.2 Al abrir un muestreo faltaba el contexto

La pantalla arrancaba directo con el mapa y la lista de puntos. Para saber de
qué campo era, de qué campaña o quién lo había hecho, había que volver atrás.

Ahora arriba va la **ficha del recorrido**: campo, lote, cultivo/variedad,
campaña, fecha, responsable con matrícula, cantidad de puntos y **la ubicación**
—el centro del recorrido, la precisión media del GPS y un link para abrirlo en
Google Maps—. El título dice `La Lucila · Lote 9F`, no `1 — Soja`.

### 10.3 El mapa era un rectángulo verde

Un scatter de puntos sobre fondo liso: no georreferencia nada, porque no se ve
dónde está parado el punto. Ahora es un mapa de verdad con **imagen satelital**.
El detalle técnico —y por qué no se usó la API de Google Maps— está en
[DOCUMENTACION_PRODUCCION_DISENO.md](DOCUMENTACION_PRODUCCION_DISENO.md) §5.4.

También cambió la proyección: antes los puntos se ubicaban con una regla de tres
entre el mínimo y el máximo, que sirve para un scatter suelto pero **no coincide
con ningún mapa**. Ahora se usa Web Mercator, la misma que usan los tiles, así
que el punto cae donde tiene que caer.
