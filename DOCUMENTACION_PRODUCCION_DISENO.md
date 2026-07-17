# Módulo Producción — Muestreo de campo (Diseño / Especificación)

Spec de diseño del módulo **Producción**: muestreo georreferenciado a campo para
ingenieros agrónomos, con reporte PDF y envío por WhatsApp. Pensado para
**extender la PWA Braun actual** (JS vanilla + IndexedDB + Apps Script + Sheets +
Drive + jsPDF + `navigator.share`), no como app aparte.

Estado: **MVP implementado.** Módulo funcional en `produccion.js` +
vistas en `index.html` + backend en `Codigo-COMPLETO-para-pegar.gs`
(hojas `Muestreo` y `Muestreo_Puntos`, se autocrean). Requiere **volver a
implementar** la web app de Apps Script para que el backend nuevo tome efecto.
Falta probar en dispositivo real (GPS, cámara, compartir por WhatsApp).
Fases 2 y 3 pendientes (mapa base offline, voz→texto, UDE, etc.).

---

## 1. Modelo de datos

Misma lógica relacional que ya usás en Control de Carga (`Orden → Producto →
Contrato`, unidos por `Id`). Tres entidades:

```
Muestreo (encabezado)  1 ──► N  Punto (observación)  1 ──► N  Foto
```

### 1.1 Hoja "Muestreo" (encabezado del recorrido)

| Campo | Tipo | Notas |
|---|---|---|
| Id_Muestreo | texto (UUID / "MU-"+timestamp) | Clave. |
| Fecha | fecha ISO | Día del recorrido. |
| Establecimiento | texto (enum) | Reutiliza catálogo compartido. |
| Lote | texto | Identificación del lote. |
| Campaña | texto (enum) | Ej. "2025/26". |
| Cultivo | texto (enum) | Cultivo predominante del lote. |
| Variedad | texto | Opcional a nivel encabezado. |
| Responsable | texto (enum personal) | Ing. agrónomo. |
| Matricula | texto | N° matrícula profesional (formalidad AR). |
| Superficie_ha | número | Opcional. |
| Lote_Geocerca | texto (GeoJSON/polígono) | Opcional, fase 2. |
| Observaciones_grales | texto | Resumen/recomendaciones del recorrido. |
| usuario_registro | texto (email) | Auditoría (ya existe en la app). |
| Estado | texto | "En curso" / "Cerrado". |
| Estado_Sync | texto | Cola offline. |

### 1.2 Hoja "Muestreo_Puntos" (cada observación georreferenciada)

| Campo | Tipo | Notas |
|---|---|---|
| Id_Punto | texto (UUID) | Clave. |
| Id_Muestreo | texto | FK → Muestreo. |
| Orden | número | N° de punto dentro del recorrido (1,2,3…). |
| Lat | número (decimal, 6+ dec) | Latitud. |
| Long | número (decimal, 6+ dec) | Longitud. |
| Precision_m | número | Exactitud GPS reportada (metros). |
| Altitud_m | número | Opcional. |
| Timestamp | fecha-hora ISO | Momento exacto de la toma. |
| Cultivo | texto (enum) | Hereda del encabezado, editable. |
| Variedad | texto | |
| Estado_Fenologico | texto (enum por cultivo) | Ver catálogo §2.2. |
| Tipo_Observacion | texto (enum) | plaga/enfermedad/maleza/deficiencia/daño/stand. |
| Objetivo | texto (enum por tipo) | Especie/agente (ej. "Isoca medidora", "Roya", "Yuyo colorado"). |
| Severidad_Escala | texto/número | Escala 1–5 o baja/media/alta. |
| Incidencia_pct | número (%) | % de plantas afectadas. |
| Conteo_Valor | número | Ej. 18. |
| Conteo_Unidad | texto (enum) | "plantas/m²", "malezas/m²", "orugas/m", etc. |
| Supera_UDE | booleano | ¿Supera umbral de daño económico? (§2.5). |
| Nota | texto | Texto libre o transcripción de voz. |
| usuario_registro | texto | Auditoría. |

### 1.3 Hoja "Muestreo_Fotos"

| Campo | Tipo | Notas |
|---|---|---|
| Id_Foto | texto (UUID) | Clave. |
| Id_Punto | texto | FK → Punto. |
| Id_Muestreo | texto | FK redundante (facilita el join/reporte). |
| Archivo | texto | Ruta Drive `Produccion_Files_/...` o URL estable. |
| Lat / Long / Timestamp | número/fecha | Copia embebida en la foto (redundancia útil). |

> **Nota de implementación:** para el MVP se pueden guardar hasta N fotos por
> punto como columnas (`Foto1..Foto3`) igual que hoy en la hoja `Orden`, y pasar
> a la hoja hija `Muestreo_Fotos` cuando se necesite cantidad variable real.

---

## 2. Catálogos agronómicos (enums pre-cargados, editables desde el gestor)

Todos viven en `ENUMS` (localStorage) como el resto, y se pueden editar con el
engranaje de "Opciones". Se pre-cargan con valores de referencia.

### 2.1 Tipos de observación
`Plaga · Enfermedad · Maleza · Deficiencia nutricional · Daño climático ·
Daño mecánico · Stand de plantas · Otro`

### 2.2 Estados fenológicos por cultivo (escalas estándar)

- **Soja** (Fehr & Caviness): `VE, VC, V1, V2, V3, Vn, R1, R2, R3, R4, R5, R6, R7, R8`
- **Maíz** (Ritchie/Hanway): `VE, V1, V2, Vn, VT, R1, R2, R3, R4, R5, R6`
- **Trigo** (Zadoks): `Z10 emergencia, Z20 macollaje, Z30 encañazón, Z50 espigazón, Z60 floración, Z70 grano lechoso, Z90 madurez`
- **Girasol** (Schneiter & Miller): `VE, V1, Vn, R1, R2, R3, R4, R5, R6, R7, R8, R9`
- **Cebada / Sorgo / Maní**: cargar según necesidad.

> El selector de estado fenológico se filtra por el cultivo del punto.

### 2.3 Objetivo (agente) — catálogo por tipo de observación (referencia AR)

- **Plagas:** Isoca medidora, Isoca bolillera, Oruga militar (Spodoptera),
  Chinche verde/de la alfalfa, Pulgón, Arañuela, Trips, Cogollero, Gusano blanco,
  Bicho bolita, Vaquita de San Antonio.
- **Enfermedades:** Roya, Mancha ojo de rana, Tizón, Septoriosis, Fusarium,
  Mancha en red, Carbón, Sclerotinia, Bacteriosis, Virosis.
- **Malezas:** Yuyo colorado (Amaranthus), Rama negra (Conyza), Sorgo de Alepo,
  Chloris, Eleusine, Gramón, Cardo, Nabo, Enredadera.
- **Deficiencias:** N, P, K, S, Zn, B, Fe, Mg.

### 2.4 Escala de severidad (unificada, con color para el mapa)

| Nivel | Etiqueta | Color mapa |
|---|---|---|
| 0 | Sin daño / normal | Verde |
| 1 | Leve | Amarillo |
| 2 | Moderado | Naranja |
| 3 | Alto | Rojo |
| 4 | Crítico | Bordó/negro |

### 2.5 Umbrales de Daño Económico (UDE) — tabla de referencia, EDITABLE

> ⚠️ **Valores orientativos, NO prescriptivos.** Deben ser validados por el
> profesional matriculado; varían por cultivo, estado, región y momento. La app
> solo marca "revisar" cuando el conteo supera el umbral configurado.

| Cultivo | Agente | Umbral de referencia |
|---|---|---|
| Soja | Chinches (grandes >0,5 cm) | ~1 /m (grano) · ~0,5 /m (semilla) |
| Soja | Defoliadoras (orugas) | ~20 % defoliación vegetativo · ~10 % reproductivo |
| Maíz | Cogollero (Spodoptera) | ~20 % plantas con cogollo dañado |
| Girasol | Orugas | según estado |

---

## 3. Estructura Apps Script (backend)

Mismo patrón que `Codigo-COMPLETO-para-pegar.gs`:

- `doPost` con `_accion`: `guardar_muestreo`, `actualizar_muestreo`,
  `eliminar_muestreo`.
- `doGet` con `?action=read_muestreos` → join de las 3 hojas (como el historial
  de cargas).
- Fotos base64 → Drive en carpeta `Produccion_Files_/` (misma función que ya
  hicimos para la Carta de Porte: `guardarArchivoContratoEnDrive` → clonar como
  `guardarFotoMuestreoEnDrive`, con link estable de descarga).

---

## 4. Stack técnico (decisión)

**Recomendado: extender la PWA actual.** Reutiliza el 80 % de lo que ya tenés y
mantiene una sola app. APIs del navegador:

| Necesidad | Solución en la PWA |
|---|---|
| GPS | `navigator.geolocation.getCurrentPosition({enableHighAccuracy:true})` |
| Cámara | `<input type="file" accept="image/*" capture="environment">` |
| Coordenada en la foto | Dibujar watermark con lat/long/fecha sobre canvas + guardar lat/long como dato |
| Offline | IndexedDB (ya lo usás) + cola de sync (ya la tenés) |
| Mapa | Leaflet + OpenStreetMap **online**; scatter en canvas **offline** |
| PDF | jsPDF (ya lo usás) |
| Compartir WhatsApp | `navigator.share({files:[pdf]})` (ya lo usás) o `wa.me` |
| Voz → texto | Web Speech API (online) · fallback a texto |
| Firma matriculado | canvas de firma (ya lo tenés) |

**Cuándo saltar a nativo (Capacitor envolviendo la misma PWA):** si más adelante
necesitás **mapas base offline** (tiles cacheados), **GPS en segundo plano** o
**EXIF real** en la foto. Capacitor reusa el mismo código web y agrega plugins
nativos sin reescribir. No hace falta para el MVP.

---

## 5. Soluciones técnicas puntuales

### 5.1 Coordenada embebida en la foto
En PWA el navegador suele **borrar** el EXIF-GPS de la cámara, así que no confíes
en leerlo. Enfoque robusto:
1. Al tocar "Tomar foto", pedir `getCurrentPosition` en paralelo.
2. Cargar la imagen en un `<canvas>`, **dibujar abajo** una franja con
   `lat, long, ±precisión, fecha/hora y lote` (watermark visible e imborrable).
3. Guardar lat/long/precisión/timestamp **también como campos** del punto (para
   el mapa y el reporte). La foto queda auto-documentada aunque se comparta suelta.
4. (Opcional) EXIF real con `piexifjs` si algún día se requiere.

### 5.2 Offline + sincronización
- Todo se guarda primero en **IndexedDB** (nuevo store `muestreos`), igual que
  `controles_carga`.
- Badge de "pendientes de sincronizar" (ya existe el patrón).
- Al recuperar señal → subir a Apps Script; fotos base64 → Drive.
- **Cuidado con la RAM:** varias fotos por punto en base64 pesan. Comprimir a
  ~1280 px / JPEG 0.6 antes de guardar (ya tenés esa compresión en `configurarFoto`).

### 5.3 Envío por WhatsApp
- Generar el PDF con jsPDF → `Blob`.
- `navigator.share({ files:[new File([blob],'reporte.pdf')], title, text })` abre
  la hoja de compartir del celular (WhatsApp incluido). Es lo que ya hacés con el
  reporte de carga.
- Fallback: `https://wa.me/?text=` con un resumen + link al PDF en Drive.

---

## 6. MVP vs. fases siguientes

**MVP (v1):**
1. Encabezado de muestreo.
2. Punto con: GPS automático + precisión, 1 foto con watermark, cultivo, estado
   fenológico, tipo de observación, severidad (1–5) e incidencia %, 1 conteo,
   nota de texto.
3. Lista de puntos + mapa online (Leaflet) coloreado por severidad.
4. Offline + sync (IndexedDB → Sheets/Drive).
5. PDF (encabezado + ficha por punto + resumen) y compartir por WhatsApp.

**Fase 2:** mapa offline, voz→texto, múltiples fotos/punto, geocerca del lote,
UDE con alertas, escalas fenológicas completas por cultivo, firma del matriculado
en el PDF.

**Fase 3:** comparación temporal (evolución de una plaga en el mismo lote),
export KML/GeoJSON para SIG, recorrida sugerida (patrón W), integración con
clima/lluvias, receta fitosanitaria.

---

## 7. Mejoras específicas para el agro argentino

- **Precisión GPS visible + promediado:** mostrar ±m y advertir si >10 m; permitir
  promediar varias lecturas parado en el punto.
- **UDE / umbral de daño económico** (tabla editable): marcar "revisar" cuando el
  conteo lo supera. Muy valorado por el asesor.
- **Escalas fenológicas reales por cultivo** (Fehr, Zadoks, etc.).
- **Catálogo de malezas resistentes** (yuyo colorado, rama negra, sorgo de Alepo).
- **Condición de aplicación:** viento, temperatura, humedad → ventana de
  pulverización (útil si el reporte deriva en una aplicación).
- **Matrícula + firma del profesional** en el PDF (formalidad AR).
- **Reutilizar catálogos** ya existentes en la app (establecimientos, cultivos,
  personal) para no recargar datos.
- **Comparación temporal** del mismo lote entre fechas.
- **Export GeoJSON/KML** para llevar los puntos a QGIS / Google Earth.
- **Recorrida sugerida en "W"** sobre el lote para muestreo representativo.
