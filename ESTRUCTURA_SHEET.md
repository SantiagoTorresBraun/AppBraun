# Estructura del Google Sheet — hojas, campos y cómo se relacionan

Qué columna es cada cosa en `BD_BRC`, cómo se llama ese mismo dato adentro de la app, y
qué hojas se cruzan con cuáles.

Las hojas y quién las escribe están en [ALMACENAMIENTO_DATOS.md](ALMACENAMIENTO_DATOS.md#3-google-sheet--hojas-y-qué-guarda-cada-una).
Acá está el **detalle campo por campo**, que es lo que hace falta para entender por qué el
Agente de IA puede responder "cuántos kg de garbanzo 7mm se cargaron en agosto" cuando el
producto vive en una hoja y la fecha en otra.

**Todo lo de este archivo está verificado contra el código**, no contra la memoria: los
índices de columna salen de `insertarFilaOrden()` y del `doGet()` de
[01_backend_principal.gs](01_backend_principal.gs).

---

## 1. El modelo relacional en una imagen

```
                    ┌──────────────────────┐
                    │       Orden          │   ← 1 fila = 1 camión controlado
                    │  Id_Carga (clave)    │      Acá vive la FECHA
                    │  Fecha, chofer,      │
                    │  checklist, ESTATUS  │
                    └──────────┬───────────┘
                               │ Id_Carga
                 ┌─────────────┴─────────────┐
                 │                           │
     ┌───────────▼──────────┐    ┌───────────▼──────────────┐
     │      Producto        │    │   Contrato Comercial     │
     │  1 fila = 1 producto │    │  1 fila = 1 contrato /   │
     │  dentro de la carga  │    │  carta de porte          │
     │  producto, calibre,  │    │  destino, Kg CP,         │
     │  lote, envase, kg    │    │  Kg Descarga             │
     └──────────────────────┘    └──────────────────────────┘

     ┌──────────────────────┐              ┌──────────────────────────┐
     │      Muestreo        │──Id_Muestreo─▶│    Muestreo_Puntos      │
     │  1 fila = 1 muestreo │              │  1 fila = 1 punto        │
     └──────────────────────┘              └──────────────────────────┘

     Independientes (no se cruzan con nada):
     Control Calidad Garbanzo · Control de Calidad Mung · Tickets · Usuarios
```

**Ni `Producto` ni `Contrato Comercial` tienen fecha propia.** La fecha es la de su `Orden`.
Por eso el agente, al armar sus datasets, **copia la Fecha, el ESTATUS y el chofer de la
carga padre a cada renglón hijo**: así una pregunta por producto y por mes se resuelve en un
solo dataset, sin cruzar nada. Ver sección 7.

---

## 2. Hoja `Orden` — cabecera del Control de Carga

37 columnas. La columna 1 es la clave; el orden importa porque el backend escribe la fila
por posición (`appendRow`), no por nombre.

| # | Encabezado en el Sheet | Nombre en la app | Qué es |
|---|---|---|---|
| 1 | `Id_Carga` | `Id_Carga` | **Clave.** La genera la app (`BC-` o `PT-` + timestamp). Une con `Producto` y `Contrato Comercial`. |
| 2 | `Fecha` | `Fecha` | Fecha del control. **La única fecha de todo el árbol de la carga.** |
| 3 | `Archivo` | — | Heredada de AppSheet. **La app la deja vacía.** |
| 4 | `PDF` | — | Heredada de AppSheet. **La app la deja vacía.** |
| 5 | `Nombre y Apellido del chofer` | `Nombre_Chofer` | Texto libre — de ahí los duplicados de escritura (sección 8). |
| 6 | `Patente Chasis` | `Patente_Chasis` | Patente del camión. |
| 7 | `Patente Acoplado` | `Patente_Acoplado` | Patente del acoplado. |
| 8 | `Firma Chofer` | `Firma_Chofer` | Firma digital en base64. |
| 9 | `¿Aplica etiqueta?` | `Aplica_Etiqueta` | Checklist: SI / NO. |
| 10 | `Lona cubre y protege la carga` | `Lona_Protege` | Checklist: SI / NO. |
| 11 | `Piso chasis / acoplado libre de suciedad y otros granos` | `Piso_Libre_Suciedad` | Checklist: SI / NO. |
| 12 | `Piso y paredes chasis / acoplado libre de óxido` | `Libre_Oxido` | Checklist: SI / NO. |
| 13 | `Chasis y acoplados secos y exentos de insectos` | `Chasis_Secos_Insectos` | Checklist: SI / NO. |
| 14 | `Chasis y acoplados exentos de proliferación de hongos` | `Exentos_Hongos` | Checklist: SI / NO. |
| 15 | `Se instaló aislante en el piso para proteger la carga` | `Aislante_Piso` | Checklist: SI / NO. |
| 16 | `ESTATUS` | `ESTATUS` | **Resultado del control:** `ACEPTADO` · `OBSERVADO` · `RECHAZADO`. |
| 17 | `Firma Control` | `Firma_Control` | Firma del responsable, en base64. |
| 18 | `Elaboró` | `Elaboro` | Quién hizo el control. |
| 19 | `Indicaciones para la Descarga:` | `Indicaciones_Descarga` | Texto libre para el destino. |
| 20 | `Foto1` | `Foto_Frente` | Frente del camión. |
| 21 | `Foto2` | `Foto_Culo` | Parte trasera. |
| 22 | `Foto3` | `Foto_Interior_Chasis` | Interior del chasis. |
| 23 | `Foto4` | `Foto_Interior_Acoplado` | Interior del acoplado. |
| 24 | `Foto5` | `Foto_Proceso_Carga` | Proceso de carga. |
| 25 | `Foto6` | `Foto_Etiqueta_Bolsa` | Etiqueta de la bolsa. |
| 26 | `Foto7` | `Foto_Camion_Cargado` | Camión ya cargado. |
| 27 | `Foto8` | `Foto_Ticket_Balanza` | Ticket de balanza. |
| 28 | `Kg Cargados` | `Kg_Cargados` | Kilos declarados de la carga. |
| 29 | `Estado` | — | Distinta de `ESTATUS`. Heredada de AppSheet, **la app la deja vacía**. |
| 30-34 | `CP1` … `CP5` | — | Cartas de porte del modelo viejo. **Reemplazadas por la hoja `Contrato Comercial`**; quedan vacías. |
| 35 | `Correo` | `Correo` | Destinatario del reporte. |
| 36 | `Estado_Correo` | `Estado_Correo` | `Sin enviar`, `Enviado <fecha> a <mail>`, etc. |
| 37 | `Tipo_Carga` | `Tipo_Carga` | `PT` (producto terminado) o `MP` (materia prima). Columna agregada al final. |

> **Los nombres 3, 4, 29 y 30-34 existen pero nadie los llena.** Vienen de cuando el sistema
> era un AppSheet. No se borran para no correr las posiciones de todo lo demás.

### Las fotos de esta hoja pesan
A diferencia de Calidad y Producción, **las fotos de `Orden` se guardan como base64 dentro
de la propia celda**, no en Drive. Por eso `?action=read` devuelve **4,3 MB** para 251 cargas.
El agente descarta estas columnas antes de mirar nada (sección 7).

---

## 3. Hoja `Producto` — los productos de cada carga

11 columnas. **1:N con `Orden`**: una carga puede llevar varios productos.

| # | Encabezado en el Sheet | Nombre en la app | Qué es |
|---|---|---|---|
| 1 | `id_Producto` | — | UUID del renglón. La app no lo usa. |
| 2 | `Id_Carga` | `Id_Carga` | **A qué carga pertenece.** Une con `Orden`. |
| 3 | `Producto` | `producto` | Garbanzo, Poroto Mung, Lenteja, Poroto Negro… |
| 4 | `Calibre` | `calibre` | `8 mm`, `9 mm`, `3,5mm`… También trae valores que **no son calibres**: `PRELIMPIEZA`, `DESCARTES`, `Split`, `Mix`, `NATURAL`. |
| 5 | `Tipo` | `tipo` | `PT` o `MP`. |
| 6 | `N° de Lote` | `lote` | Número de lote. |
| 7 | `Posición en Planta` | `posicion` | Dónde estaba almacenado. |
| 8 | `Tipo de envases` | `envase` | Big Bag, Bolsas, Granel, Silo Bolsa. |
| 9 | `Cantidad de envases` | `cantidad` | Cuántos envases. |
| 10 | `Kg del envase` | `kg_envase` | Kilos por envase. |
| 11 | `Total Kg` | `total_kg` | **Kilos de este producto.** Es el campo a sumar para totales por producto o calibre. |

---

## 4. Hoja `Contrato Comercial` — contratos y cartas de porte

10 columnas. **1:N con `Orden`**.

| # | Encabezado en el Sheet | Nombre en la app | Qué es |
|---|---|---|---|
| 1 | `id_Contrato.Comercial` | — | UUID del renglón. |
| 2 | `Id_Carga` | `Id_Carga` | **A qué carga pertenece.** |
| 3 | `Contrato.Comercial` | `contrato_com` | Número de contrato comercial. |
| 4 | `Contrato.Cliente` | `contrato_cli` | Número de contrato del cliente. |
| 5 | `Carta de Porte` | `carta_porte` | Número de carta de porte. |
| 6 | `Destino de Mercadería` | `destino` | A dónde va la mercadería. |
| 7 | `Kg CP` | `kg_cp` | Kilos declarados en la carta de porte. |
| 8 | `Observaciones CP` | — | **El backend no la lee** (`doGet` saltea el índice 7). |
| 9 | `Kg Descarga` | `kg_descarga` | Kilos pesados al descargar. |
| 10 | `CP` | `archivo_cp` | ⚠️ **No es un número: es el ARCHIVO adjunto** de la carta de porte (link de Drive). Es el error de lectura más fácil de cometer en esta hoja. |

> **`diferencia_carga` no existe en el Sheet.** Se calcula al vuelo:
> `Kg Descarga − Kg CP`. Un valor negativo significa que llegó menos de lo declarado.

---

## 5. Hojas de Control de Calidad

Dos hojas con la misma forma, una por grano:
- `Control Calidad Garbanzo`
- `Control de Calidad Mung` (se aceptan también `Control Calidad Mung` / `Control Calidad Poroto Mung`)

**No se relacionan con las cargas**: son análisis independientes.

A diferencia de las otras hojas, acá el backend **mapea por nombre de encabezado, no por
posición**. Consecuencia práctica: **agregar una columna nueva en el Sheet alcanza para que
el dato llegue solo**, sin tocar código.

| Grupo | Columnas | Qué es |
|---|---|---|
| Identificación | `Id_Calidad`, `Fecha Analisis`, `Cliente`, `Contrato Comercial`, `Contrato Produccion`, `Contrato FM`, `N° Proceso`, `N° CTG` | Quién, cuándo y contra qué contrato. |
| Lote y origen | `N° Lote BRC`, `N° Lote Cliente/Planta`, `Variedad`, `Muestreo en` (Planta / Campo), `Tipo` (PT/MP), `Kg` | De dónde salió la muestra. |
| Calibres Garbanzo | `10mm`, `9mm`, `8mm`, `7mm`, `Bajo zaranda` | % de cada calibre. Suman `Total Granos Buenos`. |
| Calibres Mung | `4mm`, `3,5mm`, `3,25mm`, `3mm`, `Bajo zaranda` | Ídem para poroto mung. |
| Defectos Garbanzo | `Verdes`, `Lavados`, `Blanqueados`, `Tocados`, `Pelados/Decorticados` | % de cada defecto. |
| Defectos Mung | `Descolorido`, `Lev. Descoloridos`, `Otro tipo`, `Lev. Manchados`, `Cascados`, `Pelados/Descorticados`, `Daño Mecanico`, `Arrugados`, `Helados` | % de cada defecto. |
| Defectos comunes | `Partidos`, `Roidos`, `Picados`, `Moho`, `Brotados`, `Ardidos y Chuzos`, `Sucios`, `Manchados` | % en ambos granos. |
| Condición | `Humedad`, `Materia Extraña` | % de humedad y de materia extraña. |
| Totales | `Total Granos Buenos`, `Total de Daños`, `Total Muestra %` | Sumatorias. |
| Adjuntos | `imagen 1` … `imagen 4`, `PDF Control Calidad` | Fotos en Drive y link al PDF. |
| Correo | `Correo`, `Estado_Correo` | Se **crean solas** al enviar el primer reporte. |

> ⚠️ **Todas las columnas de porcentaje se guardan divididas por 100 con formato `0.00%`.**
> La app manda `25.2`, la celda guarda `0.252` y se ve `25,20%`. Si a una celda le falta el
> formato de porcentaje, la próxima edición la vuelve a dividir por 100 y el valor se
> arruina. Está explicado en `repararFormatoPorcentajesCalidad()`.

**La columna `Grano` no existe en el Sheet**: la agrega el backend al leer, según de qué hoja
salió la fila. Vale `GARBANZO` o `POROTO_MUNG`.

---

## 6. Resto de las hojas

### `Muestreo` (módulo Producción)
`Id_Muestreo` · `Fecha` · `Establecimiento` · `Lote` · `Campania` · `Cultivo` · `Variedad` ·
`Responsable` · `Matricula` · `Observaciones` · `usuario_registro` · `Estado`

### `Muestreo_Puntos` — **1:N con `Muestreo`** por `Id_Muestreo`
`Id_Punto` · `Id_Muestreo` · `Orden` · `Lat` · `Long` · `Precision_m` · `Timestamp` ·
`Cultivo` · `Estado_Fenologico` · `Tipo_Observacion` · `Objetivo` · `Severidad` ·
`Incidencia_pct` · `Conteo_Valor` · `Conteo_Unidad` · `Nota` · `Foto`

### `Tickets`
`id_ticket` · `fecha_creacion` · `fecha_cierre` · `nombre_solicitante` · `correo_solicitante` ·
`responsable_asignado` · `correo_responsable` · `prioridad` · `detalle_solicitud` ·
`estado_ticket` · `respuesta` · `fecha_respuesta` · `usuario_registro` · `archivo_adjunto`

### `Usuarios`
`nombre` · `email`. Se crea sola con los 8 usuarios semilla.

---

## 7. Cómo ve todo esto el Agente de IA

El agente no consulta las hojas: consulta **7 datasets** que arma
[agente.js](agente.js) en el navegador a partir de los datos ya descargados.

| Dataset | Sale de | Una fila es | Lo que se le agregó |
|---|---|---|---|
| `cargas` | `Orden` | un camión | Totales ya calculados de sus productos y contratos |
| `productos` | `Producto` | un producto | **`Fecha`, `ESTATUS` y chofer copiados de su carga** |
| `contratos` | `Contrato Comercial` | un contrato | **`Fecha` y `ESTATUS` copiados** + `Diferencia_Carga` calculada |
| `calidad` | las 2 hojas de calidad | un análisis | La columna `Grano` |
| `muestreos` | `Muestreo` | un muestreo | `Cantidad_Puntos` |
| `puntos_muestreo` | `Muestreo_Puntos` | un punto | Fecha, establecimiento y lote del muestreo padre |
| `tickets` | `Tickets` | un ticket | — |

**Por qué se copian las columnas del padre a los hijos.** Es la decisión de diseño que hace
que funcione la pregunta *"cuántos kg de garbanzo 7mm se cargaron en agosto"*: el producto
está en una hoja y la fecha en otra, pero como `productos` ya trae la fecha heredada, la
consulta se resuelve en un solo dataset. Sin esto, el agente respondía
*"no dispongo de una columna de fecha"*.

**Lo que el agente NUNCA ve** (se filtra en `AGENTE_PATRONES_OCULTOS`): fotos, firmas,
archivos adjuntos, base64 y la columna `CP`. Son megabytes que no aportan a ninguna consulta
y romperían el límite de tokens.

**Columnas concatenadas.** En `cargas`, campos como `Productos_Cargados` juntan los valores
de las filas hijas: `"Lenteja | Garbanzo"`. Sirven para buscar con *contiene*, **no para
agrupar** — agrupar por ahí devolvía un renglón "Lenteja | Garbanzo" con los kilos del camión
entero. El catálogo se lo avisa al planificador de forma explícita.

---

## 8. Problemas de datos detectados (26/08/2026)

Salieron al hacer que el agente responda sobre los datos reales. **No son fallas del agente:
afectan cualquier informe**, lo haga la IA o una tabla dinámica a mano.

| Problema | Ejemplo | Estado |
|---|---|---|
| **Un mismo calibre escrito de dos formas** | `8 mm` (2.003.500 kg) y `8mm` (25.625 kg) contaban separado. También `9 mm`/`9mm`, `7 mm`/`7mm`, `3.5mm`/`3,5mm`/`3,5 mm` | ✅ **Resuelto en el agente**: compara y agrupa ignorando espacios, mayúsculas, acentos y coma/punto decimal. El renglón se rotula con la escritura más usada. **En el Sheet siguen distintos.** |
| **Mismo chofer con el nombre dado vuelta** | `Taborda Lucas` (3) y `Lucas Taborda` (3) son la misma persona: deberían ser 6. Hay **203 choferes distintos en 251 cargas** | 🔴 **Sin resolver.** El orden de las palabras cambia; normalizar eso automáticamente es adivinar. Se arregla en el Sheet o con una lista de equivalencias. |
| **Cargas sin `ESTATUS`** | 7 de 251 aparecen como `(sin dato)` | 🔴 Sin resolver — hay que completarlas. |
| **`Calibre` mezcla calibres con procesos** | `PRELIMPIEZA`, `DESCARTES`, `Split`, `Mix`, `NATURAL` conviven con `8 mm` | 🟡 A decidir: si son categorías válidas, conviene una columna aparte. |
| **`Tipo_Carga` siempre vale `PT`** | Ninguna carga registrada como `MP` | 🟡 A verificar: ¿no se usa, o no se está guardando? |

---

## 9. Correos duplicados — corregido el 28/08/2026

Se estaban enviando **dos correos por cada reporte**, con distinto remitente: uno como
*"Lucas Ramis (App Braun)"* y otro desde la cuenta del usuario.

**Por qué.** `enviarReportePorCorreo()` era la **única acción de escritura del backend sin
guarda de idempotencia**. Todas las demás ya tenían la suya (`guardarRegistroCompleto` por
`Id_Carga` + lock, `guardarCalidad` por `Id_Calidad`, `crearTicket` por `id_ticket`,
`guardarMuestreo` por `Id_Muestreo`). Mandar un mail no es idempotente: si el pedido llega
dos veces, salen dos mails. Y llegaba dos veces por tres caminos distintos:

1. **El reintento a ciegas de `enviarAlBackend()`** ([app.js:86](app.js#L86)). Cuando no puede
   leer la respuesta del servidor, vuelve a hacer el POST completo. Se diseñó para *guardar*,
   que es idempotente; el envío de correo se sumó después al mismo helper y heredó el
   reintento. Si el primer POST llegó bien pero la respuesta se perdió, sale un segundo mail.
2. **El envío automático al guardar pisándose con el botón del modal.** El automático corre en
   segundo plano y tarda (arma el PDF, pide token de Gmail). Si mientras tanto el usuario abre
   el modal y toca *Enviar*, salen los dos. Y como cada uno puede resolver por un camino
   distinto —uno cae al backend porque el popup de Gmail quedó bloqueado, el otro sale por
   Gmail— **llegan con distinto remitente**, que es exactamente lo que se vio.
3. Dos POST simultáneos: Apps Script atiende varios pedidos a la vez.

**Cómo quedó.**

| Capa | Qué hace |
|---|---|
| Backend | Recuerda por **5 minutos** qué se mandó (reporte + destinatario + asunto, hasheado). Un pedido repetido dentro de esa ventana devuelve `duplicado: true` y **no manda nada**. El chequeo y la marca van adentro de un `LockService`, así dos pedidos simultáneos no pasan los dos. |
| Frontend | `enviosEnCurso` bloquea que el mismo reporte se mande dos veces a la vez (el automático y el botón ya no se pisan). |
| Aviso | Si el backend frena un duplicado, la app lo dice: *"ya se había enviado hace instantes: no se mandó de nuevo"*. |

**Un reenvío deliberado más tarde sigue funcionando**: pasada la ventana, la marca expiró.

### El detalle que casi se escapa

La primera versión del arreglo borraba la marca ante cualquier error, para permitir
reintentar. Pero `marcarEstadoCorreo()` corre **después** de que el mail ya salió: si fallaba
al escribir la constancia en la planilla, se borraba la marca y **el reintento mandaba un
segundo correo al cliente**. Lo detectó una prueba automática, no la lectura del código.

Ahora la constancia va en su propio `try`: perder la anotación es molesto, mandar el reporte
dos veces al cliente es peor. La marca solo se borra cuando el fallo fue **antes** de enviar.
