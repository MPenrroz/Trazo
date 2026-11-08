# Revisión de UI/UX y flujo · usuario sin experiencia (5 nov 2026)

Método: recorrido completo como usuario nuevo, sin datos, en iPad horizontal (1180×820) y vertical (820×1180).
Se revisaron los 7 pasos, se midieron los objetivos táctiles y se revisó el código de cada vista.

Sin errores de consola y sin desbordes horizontales.

Prioridad: **A** bloquea o confunde a un usuario nuevo · **B** fricción clara · **C** pulido.
Esfuerzo: S (< 1 h) · M (medio día) · L (varios días).

## Estado

**Tanda rápida hecha (5 nov):**
- G2 — aviso en Boceto cuando la tipología no lo usa.
- G3 — luz libre considera divisiones como apoyos; el ejemplo abre "Factible" y la relación alto/base sobre 4 pasa a recomendación.
- G4 — los 7 pasos siempre visibles (número; nombre solo en el activo).
- G6 — aviso de respaldo, "Respaldar proyecto" en el menú y fecha del último respaldo.
- G7 — "Siguiente" en cada paso.
- B2 — la primera cota pregunta su medida real y calibra la escala; consejo al primer trazo.
- B5 — ayuda visible la primera vez que eliges cada herramienta.
- M1 — en iPad vertical el 3D queda fijo arriba.
- M5 — Material y espesor juntos, solo espesores disponibles (ajuste automático al cambiar de material).
- M6 — todos los controles a 44 px.
- M7 — tocar el estado lleva a los avisos.
- T1 — "Generar pedido (prueba)".
- E1 — Exportar con 3 opciones principales (Rhino, Taller, Respaldo) y "Más formatos".

**Bloque 1 · Inicio y estructura (5 nov):**
- G1 — bienvenida en la primera visita y en "+ Nuevo producto" (desde cero, ejemplo o respaldo) con "Cómo funciona".
- G5 — tipología, ejemplo o conversión que reemplaza trabajo: confirmación con lo que se pierde y "Deshacer".
- C1/C2 — sin tipología preseleccionada: proyectos nuevos en diseño libre; ejemplos visibles; "Pasar a diseño libre" para estantería y mesa.
- Estado vacío del diseño libre con acción principal "Agregar la primera pieza"; sin precio ni "Factible" cuando no hay piezas.

**Bloque 2 · Concepto → Boceto (5 nov):**
- B1 — herramienta **Editar**: tocar una forma la selecciona; arrastrar puntos (con imán a otras formas); arrastrar desde adentro la mueve; tocar un lado → escribir su medida (estira la forma conservando ángulos); tocar una cota seleccionada → su medida real recalibra la escala. Reflejar, duplicar, borrar y deshacer.
- B3 — un solo concepto, **silueta**: toda forma cerrada, con nombre editable, que muestra en qué piezas se usa; "Usar como perfil" solo aparece en la plantilla Costillas. Se quitó el cambio silencioso a Costillas del botón "Usar perfil".
- B4 — **simetría** con eje vertical arrastrable: media silueta que empieza y termina en el eje se completa sola; otros trazos se copian reflejados.
- B7 (parcial) — **rectángulo con medidas** exactas.
- C3 — pista en Funcionalidades; C4 — en vertical las imágenes van arriba.

**Correcciones tras la prueba en iPad (7 nov):**
- Panel y 3D desincronizados (ficha "Barrote" abierta, 3D en "Larguero"): la sincronía ahora depende del estado, no de banderas de eventos; una ficha abierta a la vez.
- Fórmulas largas ilegibles: el campo enfocado ocupa toda la fila; la fórmula completa también aparece al mantener el dedo.
- La ventana redonda se volvía elipse al estirar la silueta: los calados conservan su proporción (también en el script de Rhino).
- Planos sin calados: las vistas dibujan los huecos y sus paredes.
- Boceto superpuesto mal ubicado en diseño libre: parte apagado (las siluetas no son un alzado).
- Anidado: el nombre de la pieza se ubica sobre material, no dentro del calado.
- 3D pequeño: encuadre exacto por las esquinas de la caja y re-encuadre al girar el iPad si no se movió la cámara.
- Íconos de deshacer/rehacer reemplazados por íconos dibujados.

**M2 · Edición de piezas sin fórmulas (7 nov):**
- Medidas y posición como números; etiqueta "↔ parámetro" cuando la medida está ligada (cambiar el número cambia el parámetro) y "calculada" cuando viene de una fórmula. Respeta los rangos.
- Orientación con íconos: de frente, de lado, acostada.
- Espesor como lista: el del tablero o uno de los espesores disponibles.
- Repetición como formulario: repetir N veces, cada X mm, en dirección largo/fondo/alto (la cantidad puede ser automática).
- "Aparece": siempre, o solo si un parámetro Sí/No está activo.
- Fórmulas dentro de "Ver fórmulas (avanzado)" en cada ficha; ayuda de fórmulas plegada.
- Los cambios hechos en las fichas y en Parámetros entran al deshacer del visor.
- Parámetros nuevos toman su nombre corto del nombre visible.

**Crear diseño desde una imagen (7 nov, prototipo opción A):**
- Botón "✦ Crear diseño" bajo cada imagen de referencia (y en el estado vacío de Piezas) cuando la página puede consultar a Claude con imágenes (enlace de claude.ai, capacidad `sample`).
- Pide una medida conocida y, opcionalmente, qué tomar de la imagen; muestra lo que entendió (piezas, medidas, siluetas, supuestos) antes de aplicar; aplicar confirma y se puede deshacer.
- La respuesta se valida y se construye con el motor real antes de usarla (`core/proposal.ts`, con tests); lo que no sirve se informa.
- Siluetas al Boceto con su nombre y la foto como calco; en la app instalada el botón no aparece (falta la opción B: servidor propio).

## Flujo general

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| G1 | A | **Sin bienvenida ni punto de partida.** Un usuario nuevo cae en Concepto con una estantería ya elegida y no sabe qué hacer. | Pantalla inicial: "¿Qué quieres hacer?" con *Empezar desde un boceto*, *Partir de un ejemplo* y *Diseño libre desde cero*, más un recorrido corto de 3–4 tarjetas. | M |
| G2 | A | **El flujo numerado 1→7 sugiere que todo es obligatorio y lineal**, pero el Boceto solo sirve para 2 de las 5 tipologías. Quien dibuja con una estantería no ve ningún efecto. | Mostrar Boceto como opcional según la tipología, o avisar: "Esta tipología no usa el boceto; cambia a Diseño libre o Costillas para usarlo". | S |
| G3 | A | **Primera impresión negativa:** la estantería de ejemplo abre en estado "Revisar". Una de sus advertencias es falsa: la luz del techo se calcula como si no hubiera división central que lo apoye. | Corregir el chequeo de luz para considerar apoyos intermedios. Ajustar los valores por defecto para que el ejemplo abra "Factible". | S |
| G4 | A | **Pestañas ocultas:** en horizontal "Exportar" queda cortada; en vertical solo se ven 4 de 7, sin indicio de que hay más. | Barra de pasos que siempre quepa (solo números e íconos en angosto, o barra inferior tipo app) y mover el selector de proyecto a un menú. | S |
| G5 | A | **Cambios destructivos sin aviso:** cambiar de tipología en Concepto borra valores y reglas; cargar un ejemplo reemplaza el diseño libre completo. No hay deshacer. | Confirmación con resumen de lo que se pierde, y deshacer global (proyecto) además del de 3D. | M |
| G6 | A | **Riesgo de perder trabajo:** todo vive en el navegador. Borrar datos de Safari, cambiar de navegador o usar el enlace de Claude en vez de la app instalada muestran proyectos distintos o ninguno. Nada lo advierte. | Aviso claro de dónde se guarda, recordatorio de respaldo (exportar a iCloud) y "último respaldo: hace X días". | S |
| G7 | B | **Cada paso termina sin "siguiente paso".** | Botón al pie de cada vista: "Siguiente: Modelo 3D →", con lo que falta ("Aún no calibras la escala"). | S |
| G8 | B | **Unidades:** la app usa solo mm, pero el usuario piensa en cm (en la prueba escribió "Ancho 106 cm" en la descripción). | Aceptar "106 cm" o "1,06 m" en los campos y convertir; o selector de unidad por proyecto. | M |
| G9 | B | La **descripción, funcionalidades e imágenes** no influyen en nada (solo la portada de la tienda). El usuario puede esperar que guíen el modelo. | Decir explícitamente para qué sirven (ficha del producto en la tienda y planos), o usarlas en la ficha del producto y en el rótulo. | S |
| G10 | C | Jerga técnica a la vista: "tipología", "generador paramétrico", "spec", "kerf", "DocumentUserText", "XZ/YZ". | Glosario corto en una ayuda y textos simples en la interfaz; los términos técnicos solo como detalle. | S |

## 1 · Concepto

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| C1 | B | La tipología viene preseleccionada (Estantería) sin que el usuario la haya elegido. | Sin selección inicial, o preguntarlo en la bienvenida (G1). | S |
| C2 | B | Los ejemplos del diseño libre quedan escondidos bajo la lista de tipologías. | Mostrar los ejemplos como tarjetas con miniatura. | S |
| C3 | C | "Funcionalidades" no indica que Enter agrega. Las etiquetas de imágenes ("Forma", "Uso"…) no tienen efecto visible. | Placeholder "Escribe y pulsa Agregar"; usar las etiquetas en la ficha de la tienda o quitarlas. | S |
| C4 | C | La página es una columna larga en vertical; las imágenes quedan muy abajo. | Imágenes arriba en vertical, o secciones plegables. | S |

## 2 · Boceto

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| B1 | A | **No se puede corregir un trazo:** solo borrar entero o deshacer. No hay seleccionar, mover, editar vértices ni escribir la medida de un segmento. | Modo "Editar": tocar una forma, arrastrar vértices, tocar una cota y escribir su medida. | L |
| B2 | A | **Calibrar la escala es poco descubrible** y si no se hace, los planos no permiten superponer el boceto. | Al primer trazo, sugerir "Indica una medida conocida". Permitir calibrar tocando una cota y escribiendo su valor. | S |
| B3 | B | Dos ideas distintas para lo mismo: "perfil" (Costillas, herramienta Elegir perfil) y "silueta" (Diseño libre). | Unificar como "siluetas", con nombre editable cada una; el perfil de Costillas es "la silueta elegida". | M |
| B4 | B | Sin **simetría**, clave en respaldos, sillas o lámparas. | Eje de simetría: dibujas media silueta y se refleja. | M |
| B5 | B | Las ayudas de cada herramienta están en `title` (hover), que no existe en iPad; solo aparecen en la barra inferior. | Ayuda visible al elegir la herramienta (globo breve la primera vez). | S |
| B6 | C | Las etiquetas de la barra de herramientas usan 11 px; el panel lateral corta el último botón en horizontal. | Etiquetas de 12–13 px; panel con botón fijo abajo. | S |
| B7 | C | No hay arcos precisos (por 3 puntos) ni rectángulos con medida. | Herramientas Arco y Rectángulo con medida numérica. | M |

## 3 · Modelo 3D

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| M1 | A | **En vertical, los controles quedan bajo el 3D:** al mover un deslizador no ves el modelo. | En vertical, 3D fijo arriba (~45 %) y panel con scroll propio abajo. | S |
| M2 | A | **El diseño libre es potente pero intimida:** fórmulas, orientación "XZ/YZ/XY" y la posición como "esquina mínima" no son intuitivas para alguien sin experiencia. | Ejes dibujados en el visor; orientación con íconos ("de frente", "de lado", "acostada"); "Agregar pieza" que la crea tocando una cara existente; fórmulas como opción avanzada. | L |
| M3 | B | La edición directa solo funciona en Diseño libre; en tipologías tocar una pieza solo informa. | Permitir arrastrar en tipologías hacia su parámetro (p. ej. arrastrar el lateral → Ancho), o "Convertir a diseño libre". | M |
| M4 | B | No se pueden **agrupar** piezas (p. ej. mover la baranda completa). | Grupos: seleccionar varias y moverlas juntas; las posiciones relativas al grupo. | L |
| M5 | B | "Material" aparece dos veces (selector arriba y grupo "Material" con el espesor), y el espesor no se limita a los que existen para el material. | Un solo bloque Material + espesor, con solo los espesores disponibles. | S |
| M6 | B | Campos numéricos de 36 px y pestañas del panel de 38–40 px: bajo el mínimo táctil de 44 px. | Subir a 44 px. | S |
| M7 | C | El estado "Revisar" no lleva a los avisos; hay que bajar a buscarlos. | Tocar el estado lleva a los avisos o los abre. | S |
| M8 | C | Sin vistas rápidas (frente, lado, arriba) ni medidas sobre el modelo. | Botones de vista y cotas generales en el 3D. | M |

## 4 · Planos

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| P1 | B | La lámina A3 se ve muy pequeña en iPad vertical. En el enlace de Claude no se puede imprimir ni descargar. | Zoom con pellizco dentro de la lámina; explicar que PDF y descargas funcionan en la app instalada. | M |
| P2 | B | No se pueden agregar cotas, notas ni detalles; las notas del Concepto no llegan a la lámina. | Cotas manuales simples y notas del proyecto en el rótulo. | M |
| P3 | C | Sin cortes ni vista isométrica. | Vista isométrica en la lámina. | M |

## 5 · Fabricación

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| F1 | B | Los precios son de ejemplo y no se distingue cuáles son propios y cuáles por defecto. | Marcar "valor de ejemplo" hasta que el usuario lo edite; ajustes de taller globales (no por proyecto). | M |
| F2 | B | Los métodos robot, impresión 3D y 5 ejes solo cambian la cama y el espesor; parecen soportados más de lo que están. | Indicar "verificación básica" o limitar la lista a CNC/láser/escuadradora (decisión de alcance 5). | S |
| F3 | C | El acomodo usa rectángulos envolventes; en piezas curvas el aprovechamiento real es mejor que lo informado. | Indicarlo en la lámina ("estimación conservadora"). | S |

## 6 · Tienda

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| T1 | A | **"Agregar al carro" no compra nada:** descarga un JSON. Es engañoso para quien lo prueba. | Renombrar a "Generar pedido (prueba)" hasta tener pago real (decisión de alcance 3). | S |
| T2 | A | **Publicar requiere subir un archivo a GitHub:** imposible para un usuario sin experiencia. | Definir el destino de publicación (decisión 3); mientras tanto, ocultar esas instrucciones técnicas. | M–L |
| T3 | C | Solo se muestra una imagen; las funcionalidades aparecen como lista simple. | Galería con las referencias elegidas para tienda. | S |

## 7 · Exportar

| # | Prio | Problema | Propuesta | Esf. |
|---|---|---|---|---|
| E1 | B | 11 formatos sin indicar cuál usar; un usuario nuevo no sabe qué descargar. | Tres botones principales: **Para Rhino** (.3dm), **Para el taller** (DXF + planos PDF) y **Respaldo** (.trazo); el resto bajo "Más formatos". | S |
| E2 | C | El .3dm exporta los costados con ranura como 2 sólidos (hay que unirlos en Rhino). | Explicarlo en el botón, o resolverlo con Rhino.Compute (fase 2). | S |

## Orden sugerido para revisar paso a paso

1. **Inicio y estructura:** G1, G2, G4, G6, G7 (cómo entra un usuario nuevo y cómo navega).
2. **Concepto → Boceto:** C1–C2, B1, B2, B3, B5.
3. **Modelo 3D:** M1, M2, M5, M6, G3.
4. **Planos y Fabricación:** P1, P2, F1, F2.
5. **Tienda y Exportar:** T1, T2, E1, según la decisión de alcance 3.

Arreglos rápidos (S, prioridad A/B) que se pueden hacer en una sola tanda:
- G2, G3, G4, G6, G7;
- B2, B5;
- M1, M5, M6;
- T1, E1.

## Prueba en iPad · cama niño (feedback 4)

| # | Problema reportado | Solución | Estado |
|---|---|---|---|
| K1 | Las curvas salen como tramos rectos; para CNC se necesitan curvas reales (NURBS). | Las siluetas suaves (trazos curvos, círculos y siluetas de la IA) son ahora una **curva que pasa por sus puntos** (spline con esquinas automáticas sobre 50°). Se exporta exacta: **NURBS de grado 3** en el .3dm (sólidos y perfiles de corte) y **polilíneas con arcos** (G2/G3, tolerancia 0,05 mm) en el DXF de corte. Los puntos de la curva se arrastran en modo Editar. Espejo en `trazo_rhino.py` (`to_beziers`). | Hecho |
| K2 | Faltó el volumen "objetivo" de la cama existente (nido plaza y media). | **+ Volumen de referencia** (Modelo → Piezas) con largo/ancho/alto en mm, cm o m: crea parámetros `ref_largo`, `ref_ancho`, `ref_alto` para usar en las fórmulas. "Interpretar imagen" pregunta "¿Es para un mueble existente?" y adapta la propuesta a esas medidas. | Hecho |
| K3 | Tablero de proveedor local con medidas especiales. | Fabricación → Material → **+ Nuevo tablero**: nombre, plancha (p. ej. 1000 × 3000), espesores (22) y precio. El espesor de las piezas ofrece solo los del tablero elegido. | Hecho |
| K4 | "Dibujar en la pieza" es confuso; se borró el perfil del respaldo. | Modo enfocado: barra "Dibujando en «pieza»" con **Redibujar contorno** (un trazo cerrado reemplaza la forma conservando la pieza) o **Agregar calados**, y **Listo → ver en 3D**. El borrador ya no elimina siluetas en uso por piezas (avisa). | Hecho |
