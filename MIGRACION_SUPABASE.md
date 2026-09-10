# Sacar la base del Google Sheet — evaluación de Supabase

*Escrito el 10/09/2026, con los datos reales del proyecto.*

**La pregunta corta:** ¿se puede migrar a Supabase en el plan gratuito?
**Sí, y con bastante margen.** Pero antes de leer el resto: *hoy no hace falta*,
y hay un arreglo mucho más barato que compra años. Está al final, en
"Qué haría antes".

---

## 1. Tus números contra el plan gratuito

Límites del plan Free, verificados en supabase.com/pricing el 10/09/2026:

| | Free | Lo tuyo hoy | Veredicto |
|---|---|---|---|
| Base de datos | 500 MB | **< 1 MB** | Sobra por décadas |
| Archivos | 1 GB | fotos nuevas: ~100 MB/año | ~10 años |
| Tráfico | 5 GB/mes | ~17.000 fotos/mes | Ni cerca |
| Usuarios | 50.000 | **8** | Ni cerca |
| Proyectos | 2 | 1 (+1 de prueba) | Justo |

**El ritmo real:** 16,5 cargas por mes (253 en 15,3 meses). A ese ritmo, la
base de datos crece unos **430 KB por año**. El límite de 500 MB no es un
límite: es el infinito.

### La única trampa del plan gratuito

> **Un proyecto Free se pausa tras 1 semana sin actividad.**

Para un negocio de granos con temporadas bajas, eso es un riesgo real: vuelven
de dos semanas tranquilas y la app no anda hasta que alguien entra al panel de
Supabase a despertarla.

Dos salidas:

- **Un ping semanal** desde una GitHub Action (gratis, 5 líneas). Resuelve el
  problema, pero es una pieza más que se puede romper en silencio.
- **Plan Pro, USD 25/mes.** No se pausa nunca. Para una empresa que mueve
  camiones de garbanzo, 25 dólares por sacarse ese riesgo de encima
  probablemente sea la decisión correcta.

---

## 2. Qué arregla Supabase de lo que hoy duele

Esto no es teoría: cada línea es un hallazgo abierto de la auditoría.

| Hallazgo | Hoy | Con Supabase |
|---|---|---|
| **1** — Cualquiera con la URL lee y borra todo | El backend no tiene autenticación | Auth + **Row Level Security**: la base misma decide quién ve qué |
| **2** — `Braun123` publicada en GitHub | La contraseña vive en el código | Las contraseñas nunca tocan el repo |
| **6** — Fotos en base64 dentro del Sheet | 4,5 MB de historial, 92% fotos | Storage con URL real; el historial queda plano |
| **8** — Catálogos por dispositivo | Cada celular tiene su lista | Una tabla `catalogos`, igual para todos |
| **9** — La hoja `Orden` se lee por POSICIÓN de columna | Mover una columna rompe todo | Columnas con nombre y tipo |
| **11** — `Kg_Cargados` a mano, sin control | 11 cargas no cuadran | `CHECK` en la base: no entra un dato imposible |
| — La carga duplicada en 3 filas | Se resolvió con `LockService` a mano | `UNIQUE (id_carga)`: la base lo impide, y listo |
| — `?action=read` tarda **8,6 segundos** | Trae las 253 cargas con fotos | Consulta indexada y paginada: milisegundos |

**El 1 es el que más pesa.** Hoy la seguridad depende de que nadie encuentre la
URL del Web App. Con RLS, aunque alguien la encuentre, no puede leer nada sin
una sesión válida.

---

## 3. Qué NO resuelve (y hay que decirlo)

- **El correo desde el Gmail del usuario.** Es una decisión deliberada del
  proyecto: el reporte sale de la casilla de quien lo manda, queda en *su*
  carpeta Enviados y las respuestas le llegan a *él*. Supabase no manda correo
  transaccional. Eso se queda como está (Gmail API desde el navegador), o se
  reemplaza por un servicio tipo Resend — pero perdiendo esa propiedad.
- **Los PDF.** Se generan en el navegador con jsPDF. No cambian.
- **La cola offline.** Sigue siendo IndexedDB. Supabase no trae magia offline.
- **Los 3.949 archivos históricos de Drive.** Ver el punto siguiente.

---

## 4. El problema de propiedad que la migración sí resolvería

Hoy hay algo que no se puede arreglar con Google:

- El Sheet, el Apps Script y la carpeta son de **santiago.torres@braun…** (Workspace)
- Las **7 carpetas con los 3.949 archivos** son de **analistabrc@gmail.com** (Gmail personal)
- Google **no permite transferir la propiedad** entre un Gmail y un Workspace de
  otro dominio

O sea: hay que mantener vivas dos cuentas, una de ellas personal, para que la
app funcione. Y el backend corre con la identidad de una sola persona: si esa
cuenta se suspende, **se caen a la vez el guardado, las fotos y los correos**.

Migrar es la oportunidad natural de salir de eso. Los archivos pasarían a ser
de la organización, no de una persona.

> **Ojo con el orden:** no hace falta mover los 3.949 archivos históricos.
> Pueden quedarse en Drive en modo lectura, y solo lo nuevo ir a Supabase. Si
> se migraran todos, a ~300 KB promedio serían más de 1 GB y ahí sí se pasa
> del plan gratuito.

---

## 5. Cómo se vería

**Hoy**

```
Navegador ──POST/GET──► Apps Script (58 funciones)
                          ├──► Google Sheet   (los datos, y las fotos en base64)
                          ├──► Drive          (3.949 archivos)
                          └──► Gmail          (correos)
```

**Después**

```
Navegador ──SDK──► Supabase
                     ├──► Postgres  (los datos, con RLS)
                     ├──► Storage   (las fotos, con URL)
                     └──► Auth      (las sesiones)
        └──Gmail API──► el correo sigue saliendo del usuario
```

Las 58 funciones del backend en su mayoría **desaparecen**: no se reescriben.
Buscar, insertar, borrar y paginar los hace la base. Lo que hay que escribir de
verdad son las políticas RLS y la subida de archivos.

### Las tablas

Salen casi solas de la estructura que ya existe:

| Hoja hoy | Tabla | Relación |
|---|---|---|
| `Orden` | `cargas` | |
| `Producto` | `carga_productos` | N:1 con `cargas` |
| `Contrato Comercial` | `carga_contratos` | N:1 con `cargas` |
| `Control Calidad Garbanzo` / `Mung` | `calidad` | una tabla, con columna `grano` |
| `Muestreo` | `muestreos` | |
| `Muestreo_Puntos` | `muestreo_puntos` | N:1 con `muestreos` |
| `Tickets` | `tickets` | |
| `Usuarios` | lo maneja Auth | |

Las dos hojas de calidad se unifican en una tabla con `grano`, que es lo que la
app ya hace en memoria.

---

## 6. El plan, por fases

Ninguna fase rompe lo que está andando. Se puede parar en cualquiera.

**Fase 0 — Antes de tocar nada (1 día)**
Confirmar que **nadie mira el Sheet a mano**. Si alguien de administración abre
`BD_BRC` para consultar, migrar le saca la herramienta. AppSheet ya quedó como
legado (la app deja esas columnas vacías), pero hay que preguntarlo.

**Fase 1 — Espejo de solo lectura (2-3 días)**
Crear el proyecto y las tablas. Volcar los datos actuales. La app sigue
escribiendo en el Sheet; Supabase solo recibe una copia. Sirve para comparar
números sin arriesgar nada.

**Fase 2 — Autenticación (2 días)**
Pasar el login a Supabase Auth. Cierra los hallazgos 1 y 2. **Esta fase sola ya
justifica el trabajo**, aunque después no se migre nada más.

**Fase 3 — Escrituras (3-4 días)**
Un módulo por vez, empezando por el más chico: Ticketera → Producción →
Calidad → Carga. Cada uno escribe en los dos lados hasta que se confirma.

**Fase 4 — Las fotos (2 días)**
Lo nuevo va a Storage. Lo viejo se queda en Drive.

**Fase 5 — Apagar el Sheet (1 día)**
Queda como respaldo histórico, de solo lectura.

**Total: unas dos semanas de trabajo real**, repartidas.

---

## 7. Cuándo hacerlo — los disparadores

No migres por fecha. Migrá cuando pase alguna de estas:

1. **Dos personas cargando al mismo tiempo, seguido.** Apps Script serializa
   con `LockService`; ya hubo una carga duplicada en 3 filas por eso.
2. **Alguien pide reportes de verdad** (cruces entre años, totales por cliente
   y período). Hoy eso lo resuelve el agente trayendo *todo* al navegador.
3. **Más de ~5.000 cargas**, o que `?action=read` pase de 15 segundos.
4. **Entran usuarios de afuera** de la empresa. Ahí la falta de autenticación
   deja de ser un riesgo teórico.
5. **La cuenta personal de Gmail se vuelve un problema** (alguien se va, hay
   que cerrarla).

**Ninguna se está cumpliendo hoy**, salvo la 4 en su versión latente.

---

## 8. Qué haría antes

**El Hallazgo 6: sacar las fotos del Sheet y dejar el link a Drive.**

El patrón ya existe y funciona en tu propio proyecto:

| Historial completo | Peso |
|---|---|
| **Producción** (la foto es un link de 80 caracteres) | **2,7 KB** |
| **Carga** (la foto va en base64 adentro) | **4,5 MB** |

Con ese cambio, el historial de Carga baja a ~300 KB y **queda plano para
siempre**, sin importar cuántas fotos saquen. Los 8,6 segundos bajan a menos de
uno. Y se destraba la otra mitad del Hallazgo 13.

Son **días**, no semanas. Y compra años de margen.

**Después, el Hallazgo 1 (autenticación).** Si igual se va a migrar, la Fase 2
de arriba lo resuelve mejor y de una vez.

---

## 9. Riesgos honestos

| Riesgo | Qué tan real | Cómo se baja |
|---|---|---|
| El proyecto Free se pausa por inactividad | **Alto** en temporada baja | Ping semanal, o Pro a USD 25/mes |
| Alguien usaba el Sheet a mano y nadie lo sabía | Medio | Preguntar en la Fase 0 |
| Migrar mal los datos históricos | Medio | Fase 1: espejo y comparación antes de cambiar nada |
| Quedar atado a un proveedor | **Bajo** | Es Postgres estándar; se puede exportar o autohospedar |
| Perder el correo desde el Gmail del usuario | Bajo | No se toca: sigue saliendo del navegador |

---

## Resumen en tres líneas

1. **Sí, entra cómodo en el plan gratuito de Supabase.** El único cuidado real
   es la pausa por inactividad.
2. **Todavía no hace falta.** Nada de lo que aprieta hoy es por el tamaño de los
   datos.
3. **Lo que sí urge** es sacar las fotos del Sheet (Hallazgo 6) y ponerle
   autenticación al backend (Hallazgo 1). Si se van a hacer igual, hacerlos
   *dentro* de la migración es más barato que hacerlos dos veces.
