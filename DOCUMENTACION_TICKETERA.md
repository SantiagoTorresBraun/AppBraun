# Documentación — Ticketera con Notificaciones por Correo (Sesión 11/07/2026)

La ticketera pasa de ser local (los tickets vivían solo en el IndexedDB del dispositivo que los creaba) a **compartida y con notificaciones automáticas por correo**.

Archivos afectados: `index.html`, `app.js`, `Codigo-COMPLETO-para-pegar.gs`.

---

## 1. Cómo funciona ahora

```
Solicitante crea ticket ──▶ cola offline (IndexedDB) ──▶ _accion: crear_ticket
                                                              │
                                              Apps Script guarda en hoja "Tickets"
                                                              │
                                              📧 correo al RESPONSABLE con los datos
                                                 + botón "Abrir Ticketera"
```

### Matriz de notificaciones

| Evento | Quién recibe el correo | Contenido |
|---|---|---|
| **Crear ticket** | Responsable asignado | Datos completos + prioridad + adjunto (si hay) |
| **Responder** (botón ↩ verde) | Solicitante | La respuesta destacada + datos del ticket |
| **Reasignar responsable** | Nuevo responsable | Datos del ticket |
| **Cerrar** (estado → Cerrado) | Solicitante | Aviso de cierre |

Todos los correos llevan botón **"Abrir Ticketera"** (link a la app con la ruta `#/ticketera`) y `replyTo` apuntando a la contraparte: si el responsable aprieta "Responder" en su Gmail, le escribe directo al solicitante.

## 2. Frontend (`app.js` + `index.html`)

- **Solicitante automático**: nombre y correo se autocompletan con el usuario logueado (editables por si se carga en nombre de otro).
- **Responsable**: el select se arma desde `AUTH_USUARIOS` (los usuarios del login) — texto visible = nombre, value = **email** — así la notificación siempre tiene destinatario. Es obligatorio.
- **Tickets compartidos**: la tabla combina los tickets del Sheet (`?action=read_tickets`, visibles para todo el equipo) + los pendientes locales (badge "Pendiente"). Mismo patrón que Carga/Calidad: `cargarTicketsDesdeGoogle()`, `obtenerTicketsLocales()`, `sincronizarTicketsPendientes()`.
- **Offline-first**: sin conexión el ticket queda en cola; al volver internet se sube y **recién ahí** se manda el correo. La sincronización corre al iniciar la app, al volver online y al crear un ticket.
- **Botón Responder** (↩ verde en Acciones): pide el texto, marca el ticket "En Proceso" (si estaba Abierto) y dispara el correo al solicitante. El detalle (👁) y el ícono 💬 verde junto al solicitante muestran la respuesta.
- **Cambios de responsable/estado**: van por `aplicarCambioTicket()` → si el ticket está pendiente de sync se edita en la cola local; si ya está en el Sheet se manda `actualizar_ticket`.
- **Ruta `#/ticketera`**: al abrir la app con ese hash (desde el link del correo) va directo al módulo; si no hay sesión, primero pasa por el login y después retoma el destino.

## 3. Backend (`Codigo-COMPLETO-para-pegar.gs`, sección 4)

- **Hoja "Tickets"**: se **crea sola** la primera vez (con encabezados congelados). Columnas: `id_ticket, fecha_creacion, fecha_cierre, nombre_solicitante, correo_solicitante, responsable_asignado, correo_responsable, prioridad, detalle_solicitud, estado_ticket, respuesta, fecha_respuesta, usuario_registro, archivo_adjunto`.
- **Acciones**: GET `read_tickets` · POST `crear_ticket` (con control de duplicados si el dispositivo reintenta), `actualizar_ticket`, `responder_ticket`. `notificar_responsable` (versión vieja) sigue soportada.
- **Correos**: HTML institucional (header rojo Braun, tabla de datos, badge de prioridad con color, respuesta destacada, botón rojo). El adjunto del ticket viaja como archivo adjunto del correo; si supera el límite de celda de Sheets (50k caracteres) no se guarda en la hoja pero sí llega por correo.
- **⚙️ `URL_APP_TICKETERA`**: constante al inicio de la sección 4 con la URL de la app para el botón del correo. Hoy apunta a `http://127.0.0.1:5500/...` (solo funciona en tu máquina). **Cambiarla cuando la app se publique.**
- **🐞 Bug corregido de paso**: el `doPost` viejo mandaba cualquier acción desconocida (incluida `crear_ticket`) a `guardarRegistroCompleto()`, o sea que **cada ticket creaba una fila casi vacía en la hoja "Orden"**. Ahora las acciones desconocidas devuelven error. Conviene revisar la hoja "Orden" y borrar las filas vacías que hayan quedado.

## 3-B. Módulo de Usuarios (agregado en la misma sesión)

**Solicitante y responsable son desplegables** con todos los miembros de la empresa; el correo del solicitante se completa solo al elegirlo.

**Gestión de usuarios** (botón "👥 Usuarios" arriba a la derecha de la Ticketera):
- Lista completa: los 8 usuarios originales (con 🔒, no se pueden borrar desde la app) + los agregados.
- **Agregar**: nombre + correo → queda operativo al instante en el dispositivo y se guarda en la hoja **"Usuarios"** del Sheet (se crea sola, sembrada con los 8 originales). El resto de los dispositivos lo recibe al sincronizar (al abrir la app).
- **Quitar**: solo usuarios agregados; deja de poder loguearse y de aparecer en los selects.
- Los usuarios nuevos **pueden iniciar sesión** con la contraseña genérica (`Braun123`) y **recibir tickets por correo**.

**Arquitectura** (`auth.js`): `obtenerUsuariosApp()` = 8 usuarios base del código + extras de la hoja "Usuarios" (cacheados en `localStorage` clave `braun_usuarios_extra_v1` para que el login funcione offline). `sincronizarUsuariosDesdeSheet()` refresca la caché al iniciar la app. El login y la validación de sesión usan la lista combinada.

**Backend** (`.gs` sección 5): GET `read_usuarios` · POST `agregar_usuario` (con control de duplicados) · POST `eliminar_usuario`.

## 4. Instalación

1. Pegar el `Codigo-COMPLETO-para-pegar.gs` completo en el Apps Script (Ctrl+A → Ctrl+V en `Código.gs`).
2. Guardar y **republicar**: Implementar → Gestionar implementaciones → ✏️ → Nueva versión.
3. ⚠️ La primera vez Google va a pedir **autorización nueva** (permiso de "enviar correos en tu nombre" por MailApp): aceptar. Los correos salen desde la cuenta dueña del Apps Script.
4. Cuota de MailApp: ~100 correos/día en cuentas Gmail comunes, ~1500/día en Workspace — de sobra para una ticketera interna.

## 5. Cómo probar

1. Refrescar la app (Ctrl+Shift+R) → Ticketera. El solicitante ya viene completado con tu usuario.
2. Crear un ticket asignándote a vos mismo como responsable → en 1 minuto llega el correo con los datos y el botón.
3. Botón ↩ (verde) → escribir una respuesta → le llega el correo al solicitante con la respuesta destacada.
4. Cambiar el estado a "Cerrado" → correo de cierre al solicitante.
5. Abrir la ticketera desde el botón del correo (con la app corriendo en la URL configurada).
6. Verificar en el Sheet que apareció la hoja "Tickets" con las filas.
