# Preguntas pendientes — Orden de Carga y Control de Transporte

Estamos armando el módulo de **Orden de Carga** dentro de la app, para que la OC
deje de hacerse en Excel y para que la planta no tenga que volver a cargar los
datos del camión: que solo haga el checklist, las fotos y las firmas.

Para eso trabajamos sobre dos cosas: la propuesta escrita de nuevas
vinculaciones y la OC real **2056** (archivo `CN26-063 Orden de Carga 14-7`).
De ahí salieron estas dudas. Cada una dice **por qué la preguntamos**, así se
entiende qué cambia según la respuesta.

No hace falta contestar todo junto. Las marcadas con ⭐ son las que frenan el
desarrollo ahora mismo.

---

## 1. Kilos y pesos

### ⭐ 1.1. El peso neto de la carta de porte, ¿puede no coincidir con la suma de los lotes?

En la OC 2056, la primera carta de porte declara
**26.695 kg**, pero sus tres lotes suman **26.715 kg**. Son **20 kg** de
diferencia. Las otras tres cartas de porte cierran exactas.

**Por qué preguntamos:** define si la app tiene que *impedir* que no coincidan
o simplemente *avisar*. Si la diferencia es real (balanza, tara, redondeo), son
dos datos distintos y hay que guardar los dos. Si fue un error de tipeo, la app
debería frenarlo antes de que salga el camión.

### 1.2. ¿La orden se arma contra un objetivo de kilos?

La OC 2056 cierra en **75.000 kg exactos**, con 3.000 bolsas de 25 kg.

**Por qué preguntamos:** si siempre se arma contra un número redondo, la app
puede ir mostrando "cargaste 66.000 de 75.000, faltan 9.000" mientras se cargan
los camiones, y avisar si se pasa.

### 1.3. Los "Kg Descarga", ¿quién los carga y cuándo?

**Por qué preguntamos:** hoy es un campo del Control de Transporte, pero el dato
llega después, desde el destino. Queremos saber si lo carga la misma persona de
planta más tarde, o alguien de oficina cuando le avisan del destino.

---

## 2. Contratos

### ⭐ 2.1. `CN26-063`, el del nombre del archivo, ¿qué contrato es?

Adentro del Excel, la columna CTTO tiene `CN26-081 A`, `B` y `C`, que son los
**comerciales**. Pero `CN26-063` no aparece en ninguna celda: solo está en el
nombre del archivo. Nuestra sospecha es que es el contrato de **flujo de masa**,
porque los lotes son de planta (LT-556, LT-573).

**Por qué preguntamos:** si la OC se encabeza con un contrato de flujo de masa y
adentro lleva varios comerciales, la app necesita un campo que hoy no tiene.

### 2.2. La letra del contrato comercial (081 **A**, **B**, **C**), ¿separa productor?

En la OC 2056: 081 A = BRAUN, 081 B = ACIAGRO, 081 C = ARGAN.

**Por qué preguntamos:** si la letra siempre significa eso, la app puede sugerir
el productor sola al elegir el contrato, en vez de que se escriba cada vez.

---

## 3. Qué carga la oficina y qué carga la planta

### ⭐ 3.1. De estos campos del Control de Transporte, ¿cuáles ya vienen decididos en la Orden de Carga?

Esta es **la pregunta más importante de todas**: define qué le aparece ya
completo al operario de planta y qué tiene que cargar él.

**Bloque de mercadería**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Producto | |
| Calibre | |
| Tipo (PT / MP) | |
| N° de Lote | |
| Posición en planta | |
| Tipo de envase | |
| Cantidad de envases | |
| Kg por envase | |

**Bloque de carta de porte**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Contrato Comercial | |
| Contrato Cliente | |
| N° de Carta de Porte | |
| Destino de la mercadería | |
| Archivo adjunto de la CP | |
| Kg CP | |
| Kg Descarga | |
| Observaciones CP | |

**Sueltos**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Indicaciones para la descarga | |
| Total Kg cargados | |
| Correo del destinatario | |

El checklist, las 8 fotos, las firmas y el ESTATUS damos por hecho que son
siempre de planta. **¿Es así?**

---

## 4. Lotes

### 4.1. Hay dos números de lote: "N° Lote BRC" y "N° Lote Planta". ¿Cuál usa cada uno?

En la OC 2056 conviven, por ejemplo, `4380` y `LT-556 A`.

**Por qué preguntamos:** hoy la app tiene **un solo** campo de lote. Queremos
saber cuál de los dos es el que mira la gente de planta cuando va a buscar la
mercadería, y cuál es el que va en los reportes al cliente.

### 4.2. ¿De dónde sale el stock disponible de cada lote?

En la OC 2056 el lote 4380 se reparte entre los dos camiones (737 bolsas en uno,
645 en el otro), y el 4381 entre tres cartas de porte distintas.

**Por qué preguntamos:** para poder avisar "estás cargando más bolsas de las que
quedan en el lote", la app necesita saber cuántas hay. Queremos saber dónde vive
hoy ese dato y quién lo mantiene.

---

## 5. Carta de porte

### 5.1. El CTG, ¿en qué momento se consigue?

En la OC 2056, dos de las cuatro cartas de porte tienen el CTG vacío.

**Por qué preguntamos:** si se consigue después de armada la OC, la app tiene
que permitir generar la orden sin CTG y completarlo más tarde, sin tener que
rehacer nada.

### 5.2. Estos tres campos vinieron vacíos en la OC 2056. ¿Son opcionales?

- Titular de la carta de porte (dice SELEXA, pero sin CUIT)
- Remitente comercial productor
- Remitente comercial venta primaria

**Por qué preguntamos:** para saber si la app los puede dar por obligatorios o
si hay casos donde no aplican.

### 5.3. ¿Un mismo camión puede hacer más de un viaje dentro de la misma OC?

En la OC 2056, el camión 2 aparece dos veces con sus datos
repetidos. Entendemos que es **un** camión con **dos** cartas de porte, no dos
viajes. **¿Es correcto?**

---

## 6. Flete

### 6.1. "Km a recorrer" y "Tarifa" vinieron vacíos. ¿Se usan?

**Por qué preguntamos:** si se usan, los dejamos; si no se completan nunca,
sacarlos del formulario le ahorra dos campos a quien arma la OC.

---

## 7. Datos que hoy se escriben a mano cada vez

La app puede tener listas fijas para elegir, en vez de que se escriban. Eso
elimina los errores de tipeo en los datos sensibles (CUIT, dominios, lotes).

### 7.1. ¿Existen hoy listas armadas de estos?

- Destinos y plantas (con CUIT, N° de planta, dirección, localidad, provincia)
- Transportistas (con CUIT)
- Choferes (con CUIT/CUIL)
- Camiones y acoplados (dominios)
- Productores

**Por qué preguntamos:** si ya existen en algún lado (aunque sea otra planilla),
las levantamos de ahí. Si no, las vamos armando solas: la primera vez se
escribe, y de ahí en más se elige.

---

## 8. Numeración y alcance

### 8.1. El número de OC lo pone una persona. ¿Se puede pasar a automático?

*(Ya nos confirmaron que hoy es manual.)* La idea es que la app lo genere sola.

**Lo que necesitamos saber:** en qué número va la serie hoy, si hay que
respetarla, y si alguna vez se saltean o se reservan números.

### 8.2. ¿La Orden de Carga aplica también a Materia Prima, o solo a Producto Terminado?

**Por qué preguntamos:** en MP el control se hace al recibir, así que una orden
de carga previa podría no tener sentido.

### 8.3. La OC armada, ¿a quién se le manda y en qué formato?

Entendemos que va a la planta de procesamiento como informe de los camiones.

**Por qué preguntamos:** para que el PDF que genere la app tenga la misma
información que hoy esperan recibir, ni más ni menos.

---

## 9. Control de Calidad (para más adelante)

La propuesta plantea partir Control de Calidad en **Control de Cosecha** y
**Control de Flujo de Masa**. Todavía no lo empezamos, pero dejamos anotado:

- Control de Cosecha se organiza por **Contrato de Producción** (ej. CN26-120)
- Control de Flujo de Masa, por **Contrato de Flujo de Masa** (ej. CN26-096)

**¿Es así?** ¿Y hay algún control que no entre en ninguna de las dos?

---

## Resumen de lo que frena el desarrollo ahora

1. **1.1** — los 20 kg de diferencia entre el peso declarado y la suma de los lotes
2. **2.1** — qué contrato es `CN26-063`
3. **3.1** — qué campos vienen de la OC y qué carga la planta

El resto lo podemos ir resolviendo mientras avanzamos.
