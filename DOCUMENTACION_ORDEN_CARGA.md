# Orden de Carga — modelo de datos y vinculación con Control de Transporte

> Estado: **primer incremento construido** (pantalla y cálculos). Falta el Sheet, el PDF y el enganche con Control de Transporte.
> Fuentes: `Propuesta nuevas vinculaciones.docx` y el Excel real
> `CN26-063 Orden de Carga 14-7.xlsx` (OC 2056, 14/07).
> Última actualización: 29/09/2026.
>
> **Todo lo que quedó sin confirmar está en
> [PREGUNTAS_PENDIENTES_LUCAS.md](PREGUNTAS_PENDIENTES_LUCAS.md)**, ordenado para
> consultarle a Lucas Ramis. Acá abajo los "Pendiente" remiten a ese documento.

---

## 1. Qué es y dónde encaja

La Orden de Carga es el **paso previo** al Control de Transporte, no un módulo
aparte. La arma la oficina, se le envía a la planta de procesamiento como
informe de los camiones que van, y ahí un operario la **continúa**: toma el
camión que tiene delante y completa solo lo que se controla en el momento.

```
OFICINA                          PLANTA
   │                                │
   ▼                                ▼
ORDEN DE CARGA ──── informe ───▶ CONTROL DE TRANSPORTE
(contratos, camiones,            (checklist, fotos,
 lotes, CP, kg)                   firmas, estatus)
```

El objetivo es que el operario **no vuelva a cargar datos del camión, del
chofer ni de los lotes**: eso ya viene de la OC.

### Es un solo registro con dos vistas

No son dos tablas separadas. Es el mismo registro, mostrado distinto según
quién lo abre, y con reportes intermedios distintos (el informe de camiones que
va a planta no es el PDF final del control).

La app ya tiene este patrón funcionando para Materia Prima:
`body.carga-mp .solo-pt { display: none }` apaga los bloques que no aplican.
Acá sería lo mismo con `solo-oc` / `solo-planta`.

---

## 2. El identificador

**Confirmado:** el número que encabeza la OC es `OC 2056`, y es la **orden de
carga** (no la orden de compra del cliente, que es otra cosa y vive en el campo
`Contrato Cliente`).

Ese número **ya viaja hoy al Control de Transporte, tipeado a mano**, dentro del
campo `Observaciones CP`. Ver el hallazgo de la sección 5.

### Esquema propuesto

```
OC 2056                    ← número de orden de carga
 ├─ camión 1  → OC2056-01  ← este renglón es UN control de transporte
 └─ camión 2  → OC2056-02
```

- `Id_Carga` (`PT-` + timestamp) sigue siendo la **clave técnica** que genera la app.
- `Id_OC` + `N° de camión` son **la clave humana**: lo que la oficina y la planta
  usan para hablar entre ellas.
- El operario entra, escribe `2056`, elige su camión y le aparece todo cargado.

**Confirmado (29/09/2026):** hoy el número **lo pone una persona**, a mano. Es
justamente el tipo de tipeo que este módulo viene a eliminar, así que **la app lo
tiene que generar sola**, dejando la posibilidad de corregirlo.
Queda por saber en qué número va la serie y si hay que respetarla (ver
`PREGUNTAS_PENDIENTES_LUCAS.md`, punto 8.1).

---

## 3. La jerarquía real: cuatro niveles

El Excel tiene un nivel más que el modelo actual del Sheet:

```
OC  (cabecera: especie, cosecha, destino, destinatario, fletes)
 └─ CAMIÓN            (transportista+CUIT, chofer+CUIL, dominios, km, tarifa)
     └─ CARTA DE PORTE (productor, CTG, peso neto, obs CP, CTTO comercial)
         └─ LOTE       (tipo, lote BRC, lote planta, bolsas, kg/bolsa, total kg, calibre)
```

Ejemplo real de OC 2056: **2 camiones · 4 cartas de porte · 10 renglones de
lote · 75.000 kg · 3.000 bolsas de 25 kg**.

### Por qué importa el nivel de más

Hoy en el Sheet, `Producto` y `Contrato Comercial` cuelgan **los dos de
`Id_Carga`, como hermanos**: los lotes no están relacionados con ninguna carta
de porte en particular. En la OC sí lo están, y tiene que ser así, porque cada
CP declara un peso neto que se compone de lotes específicos.

### El productor y el CTTO cambian por CP, no por camión

| Camión | CP | Productor | CTTO comercial | Peso neto |
|---|---|---|---|---|
| 1 | 1 | ACIAGRO | CN26-081 B | 26.695 |
| 1 | 2 | ARGAN | CN26-081 C | 9.785 |
| 2 | 3 | ARGAN | CN26-081 C | 14.575 |
| 2 | 4 | BRAUN | CN26-081 A | 23.925 |

Por eso en el Excel **el camión 2 está tipeado dos veces completo** (razón
social, CUIT, chofer, dominios) solo para colgarle su segunda carta de porte.
Esa repetición es de las primeras cosas que el módulo tiene que eliminar.

---

## 4. Los contratos

Existen tres tipos, todos con el mismo formato `CN26-###`:

| Tipo | Ejemplo | Dónde aparece |
|---|---|---|
| **Comercial** | `CN26-081 A/B/C` | Columna CTTO del Excel, por carta de porte |
| **Producción** | `CN26-120` | Control de Cosecha (módulo de calidad) |
| **Flujo de masa** | `CN26-096` | Control de Flujo de Masa (módulo de calidad) |

La **letra separa el productor** dentro del mismo contrato comercial:
081 **A** = BRAUN, 081 **B** = ACIAGRO, 081 **C** = ARGAN.

El nombre del archivo, `CN26-063`, va **sin letra** y no aparece en ninguna
celda: la OC se encabeza con un contrato y adentro lleva otros distintos.

**Pendiente de confirmar:** que `CN26-063` sea el contrato de flujo de masa.
Si lo es, la app necesita un campo para él — hoy solo tiene `Contrato Comercial`
y `Contrato Cliente`.

---

## 5. Hallazgos del Excel real

### `Observaciones CP` no es texto libre: es un campo calculado

| CP | Lo que dice la celda | Bolsas de esa CP |
|---|---|---|
| ACIAGRO | `OC 2056 (1069 BLS)` | 737 + 250 + 82 = **1069** ✓ |
| ARGAN | `OC 2056 (391 BLS)` | **391** ✓ |
| ARGAN | `OC 2056 (583 BLS)` | 336 + 247 = **583** ✓ |
| BRAUN | `OC 2056 (957 BLS)` | 645 + 24 + 234 + 54 = **957** ✓ |

Las cuatro dan exacto y suman las 3.000 bolsas. El formato es
`OC <número> (<bolsas de esa CP> BLS)` — lo tiene que armar la app, no el usuario.

### Un lote se parte entre camiones y cartas de porte

| Lote BRC | Bolsas | Kg | Aparece en |
|---|---|---|---|
| 4380 | 1.382 | 34.545 | camión 1 (737) y camión 2 (645) |
| 4381 | 751 | 18.800 | tres cartas de porte distintas |
| 4450 | 731 | 18.255 | dos camiones |
| 4455 | 82 | 2.050 | una |
| 4469 | 54 | 1.350 | una |

La validación de "no cargar más de lo disponible" tiene que llevar **acumulado
por lote a lo largo de toda la OC**, no renglón por renglón.

### El lote tiene dos numeraciones

`N° Lote BRC` (4380, interno) y `N° Lote Planta` (`LT-556 A`). La app tiene un
solo campo `N° de Lote`.

### El peso neto de la CP puede no coincidir con la suma de los lotes

La primera CP declara 26.695 kg pero sus lotes suman 26.715 — **20 kg de
diferencia**. Las otras tres cierran exacto.

**Pendiente:** ¿es la balanza (y entonces es un campo independiente que puede
diferir) o es un error de tipeo que la app debería impedir?

### La OC cierra en número redondo

75.000 kg exactos, 3.000 bolsas de 25 kg. Sugiere que se arma contra un objetivo
de kg, y que convendría mostrar "cargaste 75.000 de 75.000, faltan 0".

### El CTG se completa después

Dos de las cuatro cartas de porte lo tienen vacío. La celda F3 dice
`11 CARACTERES`, o sea que hay una validación de largo.

---

## 6. Campos de la OC que hoy no existen en el formulario

Como es un solo registro, estos campos se agregan al mismo lugar: los carga la
oficina en la vista OC y la planta no los ve (o los ve solo de lectura, para
controlar contra el camión que tiene delante).

| Bloque | Campos que faltan |
|---|---|
| Transporte | Transportista (razón social + CUIT), CUIT/CUIL del chofer |
| Carta de porte | Productor, CTG |
| Lote | N° Lote BRC (separado del de planta) |
| Destino | Destinatario, N° de planta, dirección, localidad, provincia |
| Mercadería | Cosecha |
| Flete | Intermediario del flete + CUIT, pagador del flete + CUIT, km a recorrer, tarifa |
| Carta de porte | Titular CP, remitente comercial productor, remitente comercial venta primaria |

Los tres últimos vienen vacíos en el Excel de ejemplo. **Pendiente:** confirmar
si son opcionales o si en esta OC en particular no aplicaban. Ídem km y tarifa.

---

## 7. Sobre EXO

El documento apoya la OC en que "la app consulta EXO y trae cliente, especie,
cosecha, lotes y stock". **El código no tiene ninguna referencia a EXO.**

EXO es el proveedor de tecnología actual de Braun, y la intención es que esta
app termine absorbiendo ese trabajo. Por eso la integración quedó postergada: el
diseño debe dejar **un punto único de entrada** para esos datos, sin acoplarse a
una API externa.

Mientras tanto, los datos maestros (destinos, transportistas, choferes,
vehículos, productores) se resuelven con hojas nuevas en el Sheet y selects. Eso
solo ya elimina el tipeo de CUIT, dominios y lotes, que es el grueso del error.

---

## 8. Lo que ya se hizo

### Renombre
**Control de Carga → Control de Transporte** en todos los textos visibles (menú,
header, mails, cola offline, backend). No se tocó ningún campo, id ni hoja del
Sheet. La carpeta de Drive `Control de Carga_Images` queda con su nombre viejo a
propósito, para no romper los links de las fotos ya guardadas.

### Submenú
Tres tarjetas: **Orden de Carga** · Producto Terminado · Materia Prima.

### Módulo de Orden de Carga — primer incremento
Archivo nuevo [orden-carga.js](orden-carga.js) + la vista `view-orden-carga` en
`index.html` + estilos al final de `style.css`. **No toca nada del flujo de
Control de Transporte**: es un módulo aparte, y los registros PT ya guardados
siguen igual, sin OC asociada.

**Sigue la misma lógica que Control de Transporte**: se entra al **historial**,
con sus filtros y su tabla, y el botón **Nueva Orden** abre el formulario. Dos
pestañas (`tab-content-historial-oc` / `tab-content-nuevo-oc`) y un `ocSwitchTab`
propio, calcado de `switchTab()` pero con sus ids — igual que hacen Calidad y
Producción.

Lo que hace hoy:

- **Historial** con filtros por fecha, por N° de orden y búsqueda rápida sobre
  todo lo escrito en la orden (contrato, destino, lote, chofer, dominio). Cada
  fila se puede editar o borrar.
- **Guardar**, que exige que la orden esté completa: una OC sin chofer o sin
  contrato no sirve para mandarle a planta.
- **Número de orden propuesto solo**: toma el mayor de la serie guardada y suma
  uno. Se puede corregir a mano.
- Cabecera completa de la OC: número, fecha, contrato, especie, cosecha,
  destino (con planta, dirección, localidad, provincia), destinatario, datos
  fijos de carta de porte y flete.
- **Las tres jerarquías anidadas**: camión → carta de porte → lote, cada una
  con agregar, duplicar, borrar y colapsar a una línea de resumen. Duplicar un
  camión copia transportista, CUIT, chofer y dominios, que es lo que en el
  Excel hay que volver a tipear.
- **Totales en vivo** en una barra fija arriba: camiones, bolsas, kg, y cuánto
  falta para el objetivo de kg.
- **`Observaciones CP` se arma sola** con el formato real
  `OC <número> (<bolsas de esa CP> BLS)`.
- **Acumulado por lote de toda la orden**, que es la base para después avisar
  "estás cargando más bolsas de las que tiene el lote".
- **Aviso** cuando el peso neto declarado en la CP no coincide con la suma de
  sus lotes. Avisa, no bloquea, hasta saber si es la balanza.
- Botón **Revisar la orden**: lista lo que falta, incluido el CTG que no tenga
  11 dígitos.
- Borrador de lo que se está escribiendo, con medio segundo de espera para no
  escribir en cada tecla. Si se cierra la app a la mitad, al tocar **Nueva
  Orden** se ofrece seguir con esa.

Las órdenes viven en `localStorage` (`braun_ordenes_carga`). Cuando exista la
hoja en el Sheet, lo único que cambia es de dónde salen y a dónde van
`ocListaOrdenes()` y `ocGuardarOrden()`; el resto de la pantalla no se entera.

Lo que **todavía no** hace: escribir en el Sheet, generar el PDF de la OC y
crear el Control de Transporte a partir de ella.

## 9. Lo que sigue

1. Cerrar el mapeo campo por campo: cuáles de los 48 campos actuales del
   formulario de control vienen de la OC y cuáles se completan en planta.
2. Definir las hojas nuevas del Sheet y agregar `Id_OC` + `N° de camión` al final
   de la hoja `Orden` (se escribe por posición con `appendRow`, así que las
   columnas nuevas van al final, como se hizo con `Tipo_Carga`).
3. El PDF de la OC — el informe de camiones que hoy se le manda a planta.
4. El enganche: que la planta abra la OC por número, elija su camión y arranque
   el Control de Transporte con todo cargado.
