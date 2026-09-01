# Guía de archivos del proyecto — App Braun

Índice rápido de qué hace cada archivo del repositorio, para no tener que abrirlos todos para ubicarse.

---

## Código de la app (lo que corre en el navegador/celular)

| Archivo | Qué hace |
|---|---|
| **index.html** | Esqueleto de toda la PWA: login, menú principal, formulario de Control de Carga, vista de Contratos, Control de Calidad, Ticketera, modales. Un solo HTML con todas las "vistas" (se muestran/ocultan por JS, no hay rutas reales de servidor). |
| **app.js** | El archivo más grande y el corazón de la app: maneja login/sesión (junto con `auth.js`), el formulario de Control de Carga (productos, contratos, fotos, firmas), el guardado offline en IndexedDB y su sincronización con Google Sheets, el historial de cargas, la vista de "Contratos", la Ticketera, la generación de PDF del reporte, y los ENUMS (listas desplegables editables: productos, calibres, destinos, etc.). |
| **auth.js** | Login corporativo: lista blanca de usuarios autorizados, contraseña genérica hasheada (SHA-256, nunca en texto plano), sesión guardada en `localStorage` por 24 horas. También administra los usuarios "extra" agregados desde la app (se sincronizan con la hoja "Usuarios" del Sheet). |
| **correo.js** | Envío de reportes por correo con el **PDF adjunto**, tanto de **Control de Carga** como de **Control de Calidad** (el motor es el mismo; lo propio de cada módulo está en `REPORTES_CORREO`): arma el asunto y el cuerpo con los datos generales del registro, genera el PDF reutilizando `generarPDFReporte` de `app.js` o `generarPDFCalidad` de `calidad.js` y lo manda **desde el Gmail del usuario logueado** (API de Gmail + Google Identity Services). Si eso no se puede —falta configurar `GMAIL_CLIENT_ID`, el usuario no da el permiso o falla la API— lo envía por el backend, que sale desde la cuenta del script pero con el nombre del usuario y "Responder a" su correo. Incluye el modal de revisión, el botón ✉ del historial con su estado (gris/verde/rojo) y el envío automático al guardar (solo en Control de Carga). |
| **calidad.js** | Módulo de Control de Calidad (Garbanzo, Poroto Mung). Config por grano (calibres/defectos que suma cada uno), carga fotos de muestras a Drive, arma el historial de calidad leyendo directamente de las hojas del Sheet. Reutiliza la infraestructura de `app.js` (IndexedDB, ENUMS, `cambiarVista`, etc.). |
| **agente.js** | Agente de IA: el chat que abre el botón flotante del avatar. Arma solo un catálogo de las hojas del Sheet (columnas, tipos y valores posibles), se lo manda a Groq junto con la pregunta, recibe un *plan de consulta* en JSON y lo ejecuta **en el navegador** sobre los datos ya cargados (`historialGeneral`, `historialCalidad`, `historialTickets`, `historialMuestreos`). Nunca le manda las filas a la IA: por eso funciona igual con tablas pesadas. Detalle completo en [DOCUMENTACION_AGENTE_IA.md](DOCUMENTACION_AGENTE_IA.md). |
| **produccion.js** | Módulo de Producción / muestreo a campo: carga de muestreos con sus puntos individuales (conteos, severidades, tipos de observación, notas y foto por punto), guardado offline en el store `muestreos` de IndexedDB y su PDF. Escribe en las hojas `Muestreo` y `Muestreo_Puntos`. |
| **style.css** | Todos los estilos: identidad visual Braun (rojo `#b71c1c`), diseño de tarjetas, tablas, modales, responsive para celular (incluye el rediseño del menú y las cards del historial en mobile). |
| **manifest.json** | Manifest de PWA: nombre de la app, ícono, color de tema, modo standalone (para "Agregar a pantalla de inicio"). |
| **sw.js** | Service Worker mínimo — hoy no cachea nada todavía (`/* Estrategia de red posterior */`), solo activa el ciclo de vida básico para que la PWA sea instalable. |

## Backend (Google Apps Script)

| Archivo | Qué hace |
|---|---|
| **01_backend_principal.gs** | Todo el backend en un solo archivo: **copia espejo** del `Código.gs` que corre en el proyecto de Apps Script **App_BRC**, pegado adentro del Sheet `BD_BRC`. Expone `doGet` (leer historial, calidad, producción, tickets, usuarios) y `doPost` (guardar/actualizar/eliminar cargas, calidad, muestreos, tickets, usuarios; enviar correos), las funciones de subida a Drive y la configuración de carpetas por ID. **No se autoejecuta**: la fuente de verdad es el editor de Apps Script. Si se cambia acá, hay que copiarlo allá y volver a **Implementar → Nueva versión**. |
| **02_agente_ia.gs** | Puente hacia **Groq** (la IA gratuita que usa el agente). **La API key no está en este archivo ni en ningún otro del repo** (el repo es público): se carga a mano una sola vez en *Apps Script ▸ ⚙ Configuración del proyecto ▸ Propiedades del script*, como `GROQ_API_KEY`. Necesita además el scope `script.external_request`. `01_backend_principal.gs` lo llama desde `doPost` con la acción `agente_consulta`. |
| **99_diagnostico.gs** | Herramientas de diagnóstico que **no llama la app**: se corren a mano desde el editor. `diagnosticoCarpetasApp()` dice dónde guarda la app y si hay carpetas duplicadas; `diagnosticoArbolCarpetaMadre()` lista el árbol de `APP_Braun_2026` con los IDs de cada carpeta; `diagnosticoDuplicadosCarga()` informa qué cargas quedaron repetidas en la hoja `Orden` (y sus productos/contratos multiplicados) y `limpiarDuplicadosCarga()` las borra; `limpiarFilasSinIdCarga()` saca las filas basura sin `Id_Carga`. |

> El backend vive en **cuatro archivos más** dentro de Apps Script que **no están en este repo**:
> las migraciones históricas `91_`, `92_`, `93_` y `94_` (ya ejecutadas, no se vuelven a correr).
> Están inventariadas en [INVENTARIO_APPS_SCRIPT.md](INVENTARIO_APPS_SCRIPT.md).

## Documentación de referencia (vigente — no es bitácora)

| Archivo | Qué documenta |
|---|---|
| **CUENTAS_Y_DESPLIEGUE.md** | **Qué cuenta hace falta para cada cosa y dónde se sube cada cambio.** Las dos mitades de la app (frontend en GitHub Pages / backend en Apps Script), las cuentas de Google y de GitHub, cómo publicar cada tipo de cambio y los errores que ya pasaron. Empezar por acá ante la duda de "¿esto va a GitHub o a Apps Script?". |
| **ESTRUCTURA_SHEET.md** | **Campo por campo de cada hoja del Sheet**: los 37 encabezados de `Orden` con su nombre interno, `Producto`, `Contrato Comercial`, las hojas de Calidad, y cómo se relacionan por `Id_Carga`. Incluye qué columnas quedaron vacías de la época de AppSheet, cómo los ve el Agente de IA y los problemas de datos detectados. |
| **DOCUMENTACION_CORREO.md** | **El envío de reportes por mail**: los dos caminos por los que puede salir (Gmail del usuario / backend), las tres causas por las que los correos llegaban duplicados y qué evita cada capa de protección, por qué el endpoint de Gmail estaba mal elegido, el estado "Sin confirmar", y qué columnas no van en el PDF. Empezar por acá ante cualquier duda de correos. |
| **ALMACENAMIENTO_DATOS.md** | **Dónde se guardan los datos**: ID del Google Sheet, qué guarda cada hoja, las carpetas de Google Drive, el almacenamiento local del dispositivo (IndexedDB/localStorage) y el checklist para cuando algo deja de guardarse. Empezar por acá ante cualquier duda de persistencia. |
| **DOCUMENTACION_AGENTE_IA.md** | **Cómo poner en marcha y cómo funciona el Agente de IA.** Los pasos para sacar la clave de Groq y guardarla, la explicación de por qué el agente aguanta tablas pesadas (nunca le manda las filas a la IA, solo el catálogo), qué datasets puede consultar, cómo cambiar de modelo y qué hacer ante cada mensaje de error. |
| **INVENTARIO_APPS_SCRIPT.md** | Inventario del proyecto de Apps Script `App_BRC`: qué hace cada archivo `.gs`, cuáles son migraciones históricas ya ejecutadas y el registro del duplicado que rompía el guardado de fotos. |

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
