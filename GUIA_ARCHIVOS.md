# Guía de archivos del proyecto — App Braun

Índice rápido de qué hace cada archivo del repositorio, para no tener que abrirlos todos para ubicarse.

---

## Código de la app (lo que corre en el navegador/celular)

| Archivo | Qué hace |
|---|---|
| **index.html** | Esqueleto de toda la PWA: login, menú principal, formulario de Control de Carga, vista de Contratos, Control de Calidad, Ticketera, modales. Un solo HTML con todas las "vistas" (se muestran/ocultan por JS, no hay rutas reales de servidor). |
| **app.js** | El archivo más grande y el corazón de la app: maneja login/sesión (junto con `auth.js`), el formulario de Control de Carga (productos, contratos, fotos, firmas), el guardado offline en IndexedDB y su sincronización con Google Sheets, el historial de cargas, la vista de "Contratos", la Ticketera, la generación de PDF del reporte, y los ENUMS (listas desplegables editables: productos, calibres, destinos, etc.). |
| **auth.js** | Login corporativo: lista blanca de usuarios autorizados, contraseña genérica hasheada (SHA-256, nunca en texto plano), sesión guardada en `localStorage` por 24 horas. También administra los usuarios "extra" agregados desde la app (se sincronizan con la hoja "Usuarios" del Sheet). |
| **calidad.js** | Módulo de Control de Calidad (Garbanzo, Poroto Mung). Config por grano (calibres/defectos que suma cada uno), carga fotos de muestras a Drive, arma el historial de calidad leyendo directamente de las hojas del Sheet. Reutiliza la infraestructura de `app.js` (IndexedDB, ENUMS, `cambiarVista`, etc.). |
| **produccion.js** | Módulo de Producción / muestreo a campo: carga de muestreos con sus puntos individuales (conteos, severidades, tipos de observación, notas y foto por punto), guardado offline en el store `muestreos` de IndexedDB y su PDF. Escribe en las hojas `Muestreo` y `Muestreo_Puntos`. |
| **style.css** | Todos los estilos: identidad visual Braun (rojo `#b71c1c`), diseño de tarjetas, tablas, modales, responsive para celular (incluye el rediseño del menú y las cards del historial en mobile). |
| **manifest.json** | Manifest de PWA: nombre de la app, ícono, color de tema, modo standalone (para "Agregar a pantalla de inicio"). |
| **sw.js** | Service Worker mínimo — hoy no cachea nada todavía (`/* Estrategia de red posterior */`), solo activa el ciclo de vida básico para que la PWA sea instalable. |

## Backend (Google Apps Script)

| Archivo | Qué hace |
|---|---|
| **01_backend_principal.gs** | Todo el backend en un solo archivo: **copia espejo** del `Código.gs` que corre en el proyecto de Apps Script **App_BRC**, pegado adentro del Sheet `BD_BRC`. Expone `doGet` (leer historial, calidad, producción, tickets, usuarios) y `doPost` (guardar/actualizar/eliminar cargas, calidad, muestreos, tickets, usuarios; enviar correos), las funciones de subida a Drive y la configuración de carpetas por ID. **No se autoejecuta**: la fuente de verdad es el editor de Apps Script. Si se cambia acá, hay que copiarlo allá y volver a **Implementar → Nueva versión**. |
| **99_diagnostico.gs** | Herramientas de diagnóstico que **no llama la app**: se corren a mano desde el editor. `diagnosticoCarpetasApp()` dice dónde guarda la app y si hay carpetas duplicadas; `diagnosticoArbolCarpetaMadre()` lista el árbol de `APP_Braun_2026` con los IDs de cada carpeta. |

> El backend vive en **cuatro archivos más** dentro de Apps Script que **no están en este repo**:
> las migraciones históricas `91_`, `92_`, `93_` y `94_` (ya ejecutadas, no se vuelven a correr).
> Están inventariadas en [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md).

## Documentación de referencia (vigente — no es bitácora)

| Archivo | Qué documenta |
|---|---|
| **ALMACENAMIENTO_DATOS.md** | **Dónde se guardan los datos**: ID del Google Sheet, qué guarda cada hoja, las carpetas de Google Drive, el almacenamiento local del dispositivo (IndexedDB/localStorage) y el checklist para cuando algo deja de guardarse. Empezar por acá ante cualquier duda de persistencia. |

## Documentación de sesiones anteriores (registro histórico de cambios)

Estos `.md` son bitácoras de lo que se hizo en cada sesión de trabajo — sirven para entender el "por qué" de algo si lo encontrás raro en el código, no son manuales de uso.

| Archivo | Qué documenta |
|---|---|
| **DOCUMENTACION_CAMBIOS_SESION.md** | Sesión del 08/07: modal "Gestionar Opciones" (reemplaza un alert viejo), rediseño mobile del historial de cargas, la nueva sección "Contratos", y la estandarización de la Ticketera. |
| **DOCUMENTACION_LOGIN_AUTENTICACION.md** | Sesión del 10/07: cómo se armó el login (`auth.js`), protección de todas las vistas, y el campo `usuario_registro` para saber quién creó/modificó cada registro. |
| **DOCUMENTACION_CALIDAD_SHEET.md** | Sesión del 10/07: cómo se conectó el módulo de Control de Calidad para leer el historial real desde las hojas de Garbanzo y Poroto Mung del Sheet (datos que ya existían, cargados originalmente desde AppSheet). |
| **DOCUMENTACION_TICKETERA.md** | Sesión del 11/07: la Ticketera pasó de vivir solo en el dispositivo (IndexedDB local) a ser compartida entre todos vía Sheet, con notificaciones automáticas por correo (creación, reasignación, respuesta, cierre). |
| **DOCUMENTACION_PRODUCCION_DISENO.md** | Diseño del módulo de Producción (muestreo a campo): vistas, estructura de los puntos de muestreo y su PDF. |
| **REDISEÑO_MENÚ_PREMIUM.md** | Rediseño estético del menú principal (tarjetas, colores, íconos) para que se vea más profesional. |
| **prompt-agente-braun.md** | El "prompt de sistema" original con el que se le dieron instrucciones a un agente de IA sobre cómo comportarse en este proyecto: reglas de resiliencia offline, manejo de fotos en Base64, identidad visual, etc. Es la guía de estilo/arquitectura de más alto nivel del repo. |

## Imágenes

| Archivo | Qué es |
|---|---|
| **logo-braun.png** / **logo-senasa.png** | Logos usados en el login y en el reporte PDF. |

---

### Cómo se relacionan entre sí (flujo típico)

```
index.html (vistas)
   │
   ├─ auth.js        → login / sesión
   ├─ app.js         → Control de Carga, Contratos, Ticketera, PDF, IndexedDB
   ├─ calidad.js     → Control de Calidad
   ├─ produccion.js  → Muestreo a campo
   └─ style.css      → estilos de todo lo anterior
        │
        │  fetch(WEB_APP_URL, ...)
        ▼
01_backend_principal.gs  (proyecto "App_BRC" de Apps Script, adentro del Sheet BD_BRC)
        │
        ▼
Google Sheet (hojas: Orden, Producto, Contrato Comercial, Muestreo,
Muestreo_Puntos, Tickets, Usuarios, Control Calidad Garbanzo,
Control de Calidad Mung)
        +
Google Drive (carpetas: Contrato Comercial_Files_, Produccion_Files_,
Control de Calidad_Images)
```

> El detalle completo de qué guarda cada hoja y cada carpeta está en
> **[ALMACENAMIENTO_DATOS.md](ALMACENAMIENTO_DATOS.md)**.
