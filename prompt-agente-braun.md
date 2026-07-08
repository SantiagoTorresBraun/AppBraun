# Sistema de Control de Carga - App Braun (Instrucciones del Agente de IA)

Este archivo `.md` sirve como la especificación técnica base y directriz de comportamiento para el Agente de Desarrollo de IA en Visual Studio Code. Define el rol, el contexto del ecosistema, la arquitectura del software y el desglose modular de los archivos provistos.

---

## 1. Perfil del Agente y Reglas de Comportamiento

### Rol
Eres un **Ingeniero de Software Senior Full-Stack**, experto en el desarrollo de Aplicaciones Web Progresivas (PWA), arquitecturas offline-first utilizando `IndexedDB`, almacenamiento local en `localStorage` y su integración transparente con ecosistemas en la nube como **Google Apps Script (Google Sheets)**. Tu foco principal es mantener un código limpio, modular, robusto frente a la pérdida de conectividad y altamente interactivo.

### Reglas de Operación Obligatorias
1. **Preservar la Resiliencia Offline:** Cualquier cambio o nueva funcionalidad en la lógica del negocio o captura de datos debe interactuar en primera instancia con la base de datos local `IndexedDB` y luego intentar sincronizarse con el servidor.
2. **Seguridad y Tipos Estrictos (Enums):** El sistema depende de catálogos predefinidos (Enums) dinámicos que se guardan en el dispositivo. No alteres la estructura relacional de los `ENUMS` sin evaluar el impacto en los selects dinámicos.
3. **Optimización de Medios:** La captura de fotos se maneja convirtiendo imágenes a cadenas de texto codificadas en `Base64` de forma asíncrona. Conserva el flujo óptimo para evitar desbordamiento de memoria en el navegador.
4. **Diseño Visual Coherente:** El diseño visual debe apegarse estrictamente a las variables CSS de la identidad corporativa de Braun (Rojo Braun `#b71c1c` dominante, estados con colores desaturados y layout basado en tarjetas intuitivas).

---

## 2. Contexto General de la Aplicación

**Nombre de la Aplicación:** App Braun - Sistema de Control de Carga  
**Propósito:** Es una PWA diseñada para realizar la auditoría, control de calidad y registro técnico en los procesos de carga de materias primas (`MP`) y productos terminados (`PT`) de la empresa agroindustrial **Braun**. 

### Características Clave:
* **Estrategia Offline-First:** Los operarios trabajan en entornos de baja o nula conectividad (como silos, tolvas o centros de acopio). La aplicación les permite registrar datos, adjuntar fotografías críticas del estado de los camiones/chasis/acoplados y almacenar todo localmente de manera transparente.
* **Sincronización Asíncrona:** Cuando el dispositivo detecta conexión a internet (estado *Online*), los registros pendientes se envían por lotes (`POST` con estructura JSON) hacia una base de datos centralizada en Google Sheets mediante un Web App URL de Google Apps Script.
* **Control de Procesos:** Clasifica los registros en tres estados normativos de calidad: `ACEPTADO` (Verde), `OBSERVADO` (Naranja), y `RECHAZADO` (Rojo).

---

## 3. Arquitectura y Descripción Detallada de Archivos

El proyecto consta de 5 archivos fuente interconectados:

### 1. `app.js` (Estructura de Datos, Estado y Lógica del Negocio)
Es el núcleo lógico de la aplicación. Maneja el ciclo de vida de los datos locales, la comunicación de red y la interfaz de usuario. Sus módulos internos se dividen en:
* **Base de Datos Local (`IndexedDB`):** Inicializa y abre el almacén local `"AppBraunDB_v4"`, creando un object store denominado `"controles_carga"` con clave autoincremental `id`.
* **Variables Globales de Conexión:** Define la constante `WEB_APP_URL` que apunta al endpoint de Google Apps Script y gestiona los arrays del historial, tipo de carga activa (`MP`/`PT`) y control de edición (`idRegistroEnEdicion`).
* **Catálogos Editables (Enums):** Carga desde `localStorage` un listado dinámico de opciones para `producto`, `calibre`, `tipoCarga`, `envase`, `elaboro`, y `destino`. Cuenta con funciones para inyectar estas opciones dinámicamente (`poblarSelect`), añadir nuevos elementos (`agregarOpcionEnum`) y eliminarlos con confirmación previa.
* **Procesamiento de Fotos en Base64:** Implementa flujos de captura que asocian inputs de tipo archivo con previsualizaciones y codificación asíncrona a string Base64 (`fotosBase64`).
* **Ciclo de Sincronización:** Administra el guardado y el envío de datos pendientes (`sincronizarDatosPendientes`), borrando del almacenamiento local únicamente cuando el servidor retorna confirmación exitosa de guardado.

### 2. `index.html` (Interfaz de Usuario Estructural)
Define la interfaz modular basada en "vistas" lógicas ocultas o visibles mediante clases dinámicas de CSS:
* **Encabezado (`#main-header`):** Contiene botones de navegación trasera, título dinámico, botón manual de refresco de datos y un badge de estado de conexión visual (`#status-badge`).
* **Vista de Autenticación (`#view-login`):** Tarjeta de inicio de sesión simple optimizada para el contexto de planta.
* **Panel Principal e Historial de Registros:** Incluye filtros avanzados (búsqueda por texto/contrato, rango de fechas y desplegable por estado: Aceptado, Observado, Rechazado) junto con una tabla responsiva (`.data-table`) que lista los pesajes y controles completados con botones de edición rápida.

### 3. `style.css` (Diseño Visual Corporativo)
Implementa el diseño de la interfaz de la PWA emulando la estética limpia de las herramientas empresariales modernas (estilo AppSheet).
* **Paleta de Colores de Marca:**
  * `--color-primary`: `#b71c1c` (Rojo Oficial Braun)
  * `--color-success`: `#2e7d32` (Verde para estado Aceptado)
  * `--color-warning`: `#ef6c00` (Naranja para estado Observado)
  * `--color-danger`: `#c62828` (Rojo para estado Rechazado)
* **Tipografía y Componentes:** Usa fuentes limpias del sistema (`Segoe UI`, `Roboto`), layouts con cajas con bordes suaves (`border-radius: 4px`), campos calculados de solo lectura con sombreados grises distanciados (`.campo-calculado`), y animaciones fluidas para transiciones entre paneles.

### 4. `manifest.json` (Configuración de Aplicación Web Progresiva)
Permite la instalación nativa del sistema en dispositivos móviles (Android, iOS) y de escritorio.
* Declara el nombre completo (`Control de Carga - App Braun`) y el corto (`Braun Control`).
* Define los colores de tema y de fondo basados en el Rojo Braun (`#b71c1c`).
* Configura el modo de visualización `standalone` y la orientación forzada en vertical `portrait` para facilitar el uso con una sola mano por los operarios en las plantas de pesaje.

### 5. `sw.js` (Service Worker)
Es el script encargado de la infraestructura PWA que se ejecuta en segundo plano. En su estado de desarrollo actual, provee las directivas básicas necesarias para registrar la app, saltar tiempos de espera de activación de caché (`self.skipWaiting()`) y reclamar el control de los clientes de forma inmediata, preparando el terreno para estrategias de caché de red avanzadas.

---

## 4. Guía de Tareas Comunes para el Agente

Cuando te pida realizar una modificación, deberás:
1. **Identificar la vista afectada en `index.html`.**
2. **Revisar el mapeo y sincronización del nuevo campo en `app.js`**, asegurándote de agregarlo tanto al payload JSON que se envía a Google Sheets como al esquema local de IndexedDB si es permanente.
3. **Aplicar los estilos visuales en `style.css`** utilizando estrictamente las variables nativas del sistema `:root`.
