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

SI PUEDE NO COINCIDIR y ESO ESTA BIEN

> ✅ **Resuelto.** Son dos datos distintos y se guardan los dos: el peso neto
> declarado de la CP y la suma de los lotes. Nunca se bloquea: la orden se
> guarda igual. Hasta un **1 %** de diferencia se toma como balanza y se muestra
> como dato, en gris (los 20 kg de la OC 2056 son 0,07 %). Más del 1 % se avisa
> en naranja, porque probablemente es un error de tipeo.

### 1.2. ¿La orden se arma contra un objetivo de kilos?

La OC 2056 cierra en **75.000 kg exactos**, con 3.000 bolsas de 25 kg.

**Por qué preguntamos:** si siempre se arma contra un número redondo, la app
puede ir mostrando "cargaste 66.000 de 75.000, faltan 9.000" mientras se cargan
los camiones, y avisar si se pasa.

LOS KILOS DE LA ORDEN DAN EXACTO POR QUE SE CARGA RESPECTO A BOLSAS PERO SI VA A TENER DIFERENCIA CON LOS PESOS DE LA BALANZA

> ✅ **Resuelto (16/10).** No hay objetivo de kilos: la orden se arma por
> bolsas, y los kilos reales los da la balanza. Se sacó el campo "objetivo de
> kg" y el "faltan X kg".

### 1.3. Los "Kg Descarga", ¿quién los carga y cuándo?

**Por qué preguntamos:** hoy es un campo del Control de Transporte, pero el dato
llega después, desde el destino. Queremos saber si lo carga la misma persona de
planta más tarde, o alguien de oficina cuando le avisan del destino.

SE CARGA EN OTRO MOMENTO LO CARGA OTRO OPERARIO Y SON LOS KG DE BALANZA DESTINO

> ✅ **Resuelto.** No viene de la Orden de Carga. Se carga después, desde el
> módulo de **Contratos** (editar Kg de descarga), sin tener que abrir y
> regrabar el control entero.

---

## 2. Contratos

### ⭐ 2.1. `CN26-063`, el del nombre del archivo, ¿qué contrato es?

Adentro del Excel, la columna CTTO tiene `CN26-081 A`, `B` y `C`, que son los
**comerciales**. Pero `CN26-063` no aparece en ninguna celda: solo está en el
nombre del archivo. Nuestra sospecha es que es el contrato de **flujo de masa**,
porque los lotes son de planta (LT-556, LT-573).

**Por qué preguntamos:** si la OC se encabeza con un contrato de flujo de masa y
adentro lleva varios comerciales, la app necesita un campo que hoy no tiene.
EL CONTRATO ES COMERCIAL LOS CONTRATOS SE FORMAN A TRAVEZ DE CN ES CONTRATO 26 DEL AÑO 081 ES UN NUMERO A SON RAZONES SOCIALES DIFERENTE B C  

### 2.2. La letra del contrato comercial (081 **A**, **B**, **C**), ¿separa productor?

En la OC 2056: 081 A = BRAUN, 081 B = ACIAGRO, 081 C = ARGAN.

**Por qué preguntamos:** si la letra siempre significa eso, la app puede sugerir
el productor sola al elegir el contrato, en vez de que se escriba cada vez.
 SI SI SON DIFERENTES RAZONES SOCIALES
---

## 3. Qué carga la oficina y qué carga la planta

### ⭐ 3.1. De estos campos del Control de Transporte, ¿cuáles ya vienen decididos en la Orden de Carga?

Esta es **la pregunta más importante de todas**: define qué le aparece ya
completo al operario de planta y qué tiene que cargar él.

**Bloque de mercadería**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Producto | OC|
| Calibre |OC |
| Tipo (PT / MP) |OC |
| N° de Lote |OC |
| Posición en planta |OC |
| Tipo de envase |OC |
| Cantidad de envases |OC |
| Kg por envase |OC |

**Bloque de carta de porte**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Contrato Comercial |OC |
| Contrato Cliente |OC |
| N° de Carta de Porte |PLANTA |
| Destino de la mercadería |OC |
| Archivo adjunto de la CP |PLANTA |
| Kg CP |PLANTA |
| Kg Descarga | PLANTA|
| Observaciones CP |PLANTA |

**Sueltos**

| Campo | ¿Viene de la OC o lo carga planta? |
|---|---|
| Indicaciones para la descarga | PLANRA|
| Total Kg cargados |PLANTA |
| Correo del destinatario |PLANTA |

El checklist, las 8 fotos, las firmas y el ESTATUS damos por hecho que son
siempre de planta. **¿Es así?**

---

## 4. Lotes

### 4.1. Hay dos números de lote: "N° Lote BRC" y "N° Lote Planta". ¿Cuál usa cada uno?

En la OC 2056 conviven, por ejemplo, `4380` y `LT-556 A`.

**Por qué preguntamos:** hoy la app tiene **un solo** campo de lote. Queremos
saber cuál de los dos es el que mira la gente de planta cuando va a buscar la
mercadería, y cuál es el que va en los reportes al cliente.
LOTE BRC ES DE DE BRAUN Y LOTE PLATNA ES UNN UMERO Q TE SA LA PLANTA
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

TODO LO RELACIONADO A CARGTA DE POERT ES AL ULTIMO

### 5.2. Estos tres campos vinieron vacíos en la OC 2056. ¿Son opcionales?

- Titular de la carta de porte (dice SELEXA, pero sin CUIT)
- Remitente comercial productor
- Remitente comercial venta primaria

**Por qué preguntamos:** para saber si la app los puede dar por obligatorios o
si hay casos donde no aplican.
DATOS OBLIGATORIOS

### 5.3. ¿Un mismo camión puede hacer más de un viaje dentro de la misma OC?

En la OC 2056, el camión 2 aparece dos veces con sus datos
repetidos. Entendemos que es **un** camión con **dos** cartas de porte, no dos
viajes. **¿Es correcto?**
SI SE PUEDE
---

## 6. Flete

### 6.1. "Km a recorrer" y "Tarifa" vinieron vacíos. ¿Se usan?

**Por qué preguntamos:** si se usan, los dejamos; si no se completan nunca,
sacarlos del formulario le ahorra dos campos a quien arma la OC.

---
SI PERO NO OBLIGATORIO
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

SI EN UNA APLICACION QUE TODAVIA NO TENMOS ACCESO 
POR LO QUE PODEMOS CREAR UN MODULO DE CLIENTES CON TODOS ESTOS DATOS A LGUAI QUE MERCADERIA QUE TENEMOS GARBANZO Y DISTINTOS MM CON EL DESTINO DE LA MERCADOERIA SE POBRAS ASI SE PUEDE LEVANTAR

---

## 8. Numeración y alcance

### 8.1. El número de OC lo pone una persona. ¿Se puede pasar a automático?

*(Ya nos confirmaron que hoy es manual.)* La idea es que la app lo genere sola.

**Lo que necesitamos saber:** en qué número va la serie hoy, si hay que
respetarla, y si alguna vez se saltean o se reservan números.

NUMERO AUTOMATICO VISUALMENTE DISPONIBLE PARA VINCULAR EN UN FUTURO CON LA APLICACION DE EXO

### 8.2. ¿La Orden de Carga aplica también a Materia Prima, o solo a Producto Terminado?

**Por qué preguntamos:** en MP el control se hace al recibir, así que una orden
de carga previa podría no tener sentido.

VA A SER LO MISMO HASTA CIERTO PUNTO

### 8.3. La OC armada, ¿a quién se le manda y en qué formato?

Entendemos que va a la planta de procesamiento como informe de los camiones.

**Por qué preguntamos:** para que el PDF que genere la app tenga la misma
información que hoy esperan recibir, ni más ni menos.
LO ENVIA OPERARIO DE BRAUN SE ENVIA A PLANTA  O AL RESPONSABLE DE CAMPO EN FORMATO PDF
---

## 9. Control de Calidad

La propuesta plantea partir Control de Calidad en **Control de Cosecha** (en
campo) y **Control de Flujo de Masa** (en planta). Ya lo empezamos: el diseño
está en `DISEÑO_CALIDAD_COSECHA_FM.md`. Los controles de los dos tipos se guardan
en la misma hoja de cada grano, con una columna nueva que dice de qué tipo es.


### 9.1. ⭐ ¿Cada tipo se organiza por su contrato?

Entendemos que:

- Control de Cosecha se organiza por **Contrato de Producción** (ej. CN26-120)
- Control de Flujo de Masa, por **Contrato de Flujo de Masa** (ej. CN26-096)

**¿Es así?** ¿Y hay algún control que no entre en ninguna de las dos?

**Por qué preguntamos:** el contrato va a ser la "carpeta" donde se agrupan los
controles. Por eso pensamos hacerlo **obligatorio** al cargar un control nuevo.
Si hay controles que se hacen sin contrato, no puede ser obligatorio.
CORRECTO
### 9.2. ⭐ Los controles viejos: ¿de qué tipo es cada uno?

Los controles que vienen de AppSheet no dicen si son de cosecha o de planta.
Para clasificarlos vamos a usar el campo **"Muestreo en"**. Nuestra propuesta:

| Muestreo en | Tipo |
|---|---|
| Planta, Big Bag, Puerto | Flujo de Masa |
| Silo Bolsa | Cosecha |
| **Camión** | Cosecha  |
| **Sin dato** | Cosecha  |

**Lo que necesitamos saber:** ¿la tabla está bien? ¿A qué tipo van "Camión" y los
controles sin dato?

**Por qué preguntamos:** según eso, cada control viejo aparece en un módulo o en
el otro. Si queda mal clasificado, no se va a encontrar donde se lo busca.
LOS FIJOES LO VAMOS A DEJAR EN CONTRATO DE FLUJO DE MASA PERO LA REALIDAD ES Q NO TODOS SON DE FLUJOS DE MASAS YA Q ESTAN MEJORADOS Y SI PODEMOS USAS EN MUESTRO EN 
### 9.3. ¿Falta la opción "Campo" en "Muestreo en"?

Hoy las opciones son Planta, Camión, Big Bag, Silo Bolsa y Puerto. Ninguna es
"en el campo", que es justamente donde se hace el Control de Cosecha.

**Por qué preguntamos:** si se agrega "Campo", los controles de cosecha quedan
bien identificados desde el primer día.

### 9.4. ¿Qué es "ID Planta"?

La propuesta pide, en Flujo de Masa, los campos **Planta** e **ID Planta**.

**Lo que necesitamos saber:** ¿"ID Planta" es un código fijo de cada planta
(siempre el mismo para la misma planta) o el número de lote o de ID que asigna
la planta a cada partida? EL ID DE LA PARTIDA DE CADA LOTE

**Por qué preguntamos:** si es un código fijo, conviene una lista para elegir y
que se complete solo al elegir la planta. Si cambia en cada control, se escribe
a mano.

ACLARACIONES, EN PLANTA COMO VIEL TENEMOS GI81 ES EL NUMERO DE PROCESO DE LA PLANTA Y LT-555A ESTO NO SE REPITE PUERO TENES CASO DE 4PULCE QUE PR500 LOT1 LOT2 LOT3 EL PROICEOS NO SE REPITE PERO SI EL NUMERO DE LOTE EN DIFERETENEWS PROCESOS

### 9.5. N° Lote BRC y N° Lote: ¿en qué tipo de control van?

La propuesta no los nombra ni en Cosecha ni en Flujo de Masa, pero hoy están en
el formulario.

**Nuestra propuesta:** dejarlos solo en Flujo de Masa, porque en el campo todavía
no hay lote BRC.

**Por qué preguntamos:** para no mostrar en cada tipo campos que nadie completa.

### 9.6. El PDF: ¿cambia el título?

Hoy el PDF se titula **"Reporte de Calidad"** para todos los controles.

**Lo que necesitamos saber:** ¿se mantiene ese título, o pasa a decir "Control de
Cosecha" o "Control de Flujo de Masa" según el tipo?

**Por qué preguntamos:** el PDF se le manda al cliente, y tiene que decir lo que
el cliente espera leer.
NO CAMBIA
---

## Resumen de lo que frena el desarrollo ahora

1. ~~**1.1** — los 20 kg de diferencia entre el peso declarado y la suma de los lotes~~ ✅ puede no coincidir: se avisa, no se bloquea
2. **2.1** — qué contrato es `CN26-063`
3. **3.1** — qué campos vienen de la OC y qué carga la planta
4. **9.1 y 9.2** (Control de Calidad) — si el contrato es obligatorio, y cómo se
   clasifican los controles viejos

El resto lo podemos ir resolviendo mientras avanzamos.
