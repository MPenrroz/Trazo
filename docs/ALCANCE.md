# Trazo · descripción y alcance (v0.1, revisión 5 nov 2026)

## Qué es

Trazo es una app web para iPad que lleva una idea de mueble u objeto desde el boceto a mano hasta un producto
**paramétrico, verificado para fabricación con tableros (CNC/láser)** y **configurable por el cliente** en una tienda.
Rhino es el destino para el trabajo de detalle.

Usuario principal: arquitecto o diseñador. Usuario secundario: el cliente final, que solo ve la tienda.

## Qué hace hoy

### 1 · Concepto
- Nombre, autor, descripción, lista de funcionalidades y notas de diseño.
- Galería de imágenes referenciales: elegir, pegar o arrastrar; etiqueta y comentario por imagen; la primera es la portada de la tienda.
- Elección de **tipología** (generador) y **método de fabricación**.
- Ejemplo cargable para diseño libre: cama nido con respaldo y baranda.

### 2 · Boceto
- Lienzo para Apple Pencil: el lápiz dibuja; los dedos mueven y hacen zoom.
- Imagen de calco (Procreate, Concepts, foto) con opacidad ajustable.
- **Tinta inteligente**: rectas con ángulos imantados, rectángulos, círculos y curvas suaves.
- Trazo libre, cotas, borrar, deshacer y rehacer.
- **Escala**: se calibra dibujando sobre una medida conocida.
- Las formas cerradas sirven como perfil (tipología Costillas) o como siluetas de piezas (Diseño libre); lo dibujado dentro de una silueta se vuelve calado.
- Exporta SVG y DXF.

### 3 · Modelo 3D
- Tipologías prediseñadas con parámetros: estantería, mesa de placas, costillas desde boceto, nicho de lectura.
- **Diseño libre**: parámetros propios y piezas definidas con fórmulas (rectángulo o silueta, orientación, medidas, posición, repeticiones, condición Sí/No, tipo tablero, tapiz o referencia).
- **Edición directa** (solo diseño libre):
  - tocar una pieza la selecciona;
  - manillas para estirar y flechas para mover, con imán y grilla;
  - el cambio se guarda en el parámetro o en la fórmula;
  - deshacer y rehacer.
- Visor con vista explotada y resumen en vivo: medidas, piezas, tableros, peso, precio y estado de factibilidad.
- Reglas para la tienda: qué ve el cliente, rangos, margen y costo base.

### 4 · Planos
- Lámina A3 automática (sistema europeo): alzado, planta y lateral.
- Cotas generales y en cadena, despiece, rótulo, ranuras en línea segmentada.
- Superposición del boceto calibrado para comparar la idea con el modelo.
- Exporta SVG y PDF (impresión).

### 5 · Fabricación
- Restricciones por método: cama de la máquina, espesor máximo, diámetro de herramienta.
- Chequeos:
  - piezas que no caben;
  - espesor comercial;
  - detalles menores que la fresa;
  - esquinas interiores;
  - luz de repisas;
  - vuelco;
  - ranuras (pared mínima, ancho mínimo).
- Acomodo de piezas en tableros (por rectángulos), despiece y costo (material, corte, cajeado, tapiz, base y margen).
- DXF de corte por capas, con piezas espejadas cuando la ranura va en la otra cara.

### 6 · Tienda
- Vista del cliente: solo los parámetros expuestos, precio en vivo y bloqueo de combinaciones no fabricables.
- Enlace que guarda la configuración y AR Quick Look (ver a escala real en el iPad).
- Pedido de prueba como archivo JSON.
- Productos publicables como archivo en el repositorio.

### 7 · Exportar
- `.3dm`: sólidos por capa con datos, perfiles CNC, boceto y parámetros.
- Especificación `.json` y script Rhino/Grasshopper, que reconstruye el producto con los mismos generadores.
- DXF, SVG, STL, GLB, OBJ, USDZ y el proyecto completo `.trazo.json`.

### Transversal
- Varios proyectos guardados en el navegador: nuevo, importar, duplicar, eliminar.
- Funciona sin conexión una vez cargada.
- Se instala como app en el iPad (PWA).

## Qué NO hace (hoy)

| Tema | Límite actual |
|---|---|
| Sincronización | Los proyectos viven solo en el navegador de cada dispositivo. No hay cuentas, nube ni colaboración. |
| Geometría | Solo piezas planas extruidas (tableros). Sin superficies curvas, doble curvatura, barridos ni sólidos libres. |
| Modelado | Sin uniones automáticas (encastres, finger joints, dogbones), herrajes ni cantos redondeados. Sin booleanas generales. |
| Edición directa | Solo en diseño libre. Sin agrupar piezas, rotar ni editar vértices de una silueta en 3D. |
| Boceto | Sin editar vértices ni segmentos después de dibujar, sin medidas numéricas por segmento, sin simetría, sin arcos precisos. |
| Interpretación del boceto | No interpreta el boceto ni la descripción para crear el modelo. El usuario elige la tipología o arma las piezas. |
| Planos | Sin cotas manuales, cortes ni detalles. Escala automática. Sin DWG. |
| Fabricación | El acomodo usa rectángulos envolventes (no forma real), sin veta ni G-code. Costos de ejemplo (CLP). |
| Tienda | Sin pago real, carrito, cuentas de cliente ni stock. Publicar requiere subir un archivo al repositorio. |
| Rhino | Sin conexión en vivo: se intercambian archivos. Rhino.Compute queda como fase 2, en evaluación. |
| Unidades | Solo milímetros. |

## Decisiones de alcance

**Tomadas (5 nov):**
1. **El diseño libre es el centro.** Los proyectos nuevos parten en diseño libre. Estantería, mesa y cama nido son ejemplos de diseño libre (editables pieza por pieza). Nicho y costillas quedan como "plantillas especiales" hasta que el compositor haga curvas y ranuras.
2. **El boceto es opcional:** sirve para siluetas y calados. En la navegación aparece con círculo segmentado y "Siguiente" desde Concepto va directo al Modelo.

**Pendientes:**

3. ¿La tienda es una **vista previa para el arquitecto** o debe llegar a vender (pago, pedidos)? Cambia mucho el alcance.
4. ¿Los proyectos deben **sincronizarse** entre iPad y computador dentro de la app, o basta con exportar a iCloud?
5. ¿Fabricación cubre solo **tableros CNC/láser**, o también impresión 3D y robótica con chequeos propios? Hoy esos métodos solo cambian medidas de cama y espesor.
