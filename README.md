# Trazo — del boceto a mano al producto fabricable y configurable

Trazo es una app web (funciona en iPad, se instala como app desde Safari) que lleva una idea de
arquitecto/diseñador desde **dibujos a mano + imágenes referenciales + descripción** hasta un
**modelo paramétrico verificado para fabricación digital**, entregable a **Rhino/Grasshopper** y
publicable en una **tienda web donde el cliente configura** el producto dentro de los rangos que fijó el arquitecto.

```
 iPad (Procreate / Concepts / Pencil)          Trazo (web / PWA)                               Rhino 8 / Grasshopper
 ───────────────────────────────────   ─────────────────────────────────────────────   ──────────────────────────────
  boceto PNG  ─── compartir / ⌘V ──▶  1 Concepto   descripción, funciones, referencias
  fotos ref.  ─────────────────────▶  2 Boceto     tinta inteligente + escala + perfil
                                      3 Modelo 3D  generador paramétrico + reglas
                                      4 Planos     planta/alzado/lateral A3 + cotas
                                      5 Fabricación factibilidad, anidado, costo
                                      6 Tienda     configurador cliente + AR
                                      7 Exportar   .3dm · spec.json · DXF · USDZ   ──▶  trazo_rhino.py (mismos generadores)
                                                                                        → refinar → ShapeDiver / Rhino.Compute
```

## Funciones

| Paso | Qué hace |
|---|---|
| **1 · Concepto** | Nombre, descripción, funcionalidades, notas. Galería de imágenes referenciales con etiqueta (forma, material, uso, unión…) y portada de tienda. Elección de tipología paramétrica y método de manufactura. |
| **2 · Boceto** | Lienzo para Apple Pencil (el lápiz dibuja, los dedos mueven/zoom → rechazo de palma). Importa o pega (⌘V) el boceto de Procreate/Concepts como calco. **Tinta inteligente**: convierte trazos en rectas, rectángulos ortogonales, círculos o curvas suaves, imanta ángulos 0/45/90° y vértices. **Escala**: dibuja sobre una medida conocida → todo queda en mm. Cotas. La forma cerrada elegida es el **perfil del producto**. Exporta SVG/DXF. |
| **3 · Modelo 3D** | Visor three.js (Z arriba, como Rhino) con vista explotada. Parámetros por grupo. Pestaña **Reglas para tienda**: el arquitecto decide qué parámetros ve el cliente y sus mín/máx/paso, margen y costo base. Resumen en vivo: medidas, piezas, tableros, peso, precio y estado de factibilidad. |
| **4 · Planos** | Lámina A3 automática (sistema europeo ISO E): alzado, planta, lateral, cotas generales y en cadena (luces entre repisas), despiece y rótulo. **Superpone el boceto calibrado** para comparar intención vs. modelo. SVG y PDF (imprimir). |
| **5 · Fabricación** | Restricciones por método (CNC 3 ejes, láser, 5 ejes/robot, celda robótica, semi-automatizado, impresión 3D): cama, espesor máx., Ø herramienta. Verifica piezas que no caben, esquinas interiores (dogbones), detalles menores a la fresa, luz/espesor de repisas, estabilidad, espesores comerciales. Anidado en tableros, despiece, costo (material + mecanizado + base + margen) y **DXF de corte** por capas. |
| **6 · Tienda** | Vista del cliente: solo parámetros expuestos, precio en vivo, bloqueo de combinaciones no fabricables, **AR Quick Look** (ver a escala 1:1 en el espacio con iPad/iPhone), enlace compartible con la configuración, pedido JSON (punto de integración con checkout). |
| **7 · Exportar** | `.3dm` (sólidos por capa con UserText, perfiles CNC anidados, boceto de referencia, parámetros en DocumentUserText), `spec.json`, script **Rhino/Grasshopper**, DXF, SVG, STL, GLB, OBJ, USDZ, y el proyecto completo `.trazo.json` para pasarlo por iCloud Drive. |

La primera vez se muestra una bienvenida: empezar desde cero (diseño libre), partir de un ejemplo o abrir un respaldo. Todo se guarda localmente en el navegador (IndexedDB), con múltiples proyectos (menú ⋯: nuevo, importar, duplicar, eliminar).

## Diseño libre (compositor)

Para productos que no calzan en una tipología: defines **tus parámetros** (con rango y si el cliente los ve) y armas el
producto con **piezas**. Cada pieza tiene:

- **Forma**: rectángulo o una silueta cerrada del Boceto (lo dibujado dentro de la silueta se vuelve calado). La silueta se estira al ancho × alto de la pieza.
- **Orientación**: frontal (XZ), lateral (YZ) u horizontal (XY).
- **Medidas y posición como fórmulas**: `ancho + 2*t`, `alto_cama + alto_baranda - 60`, `baranda ? 300 : 0`, `min()`, `max()`, `floor()`…
- **Cantidad** (`i` = número de copia, `n` = cantidad) para barrotes, listones o costillas.
- **Presente si**: la pieza aparece solo si la fórmula es verdadera (p. ej. un parámetro Sí/No).
- **Tipo**: tablero CNC, tapiz (se cotiza por m²) o referencia (la cama o el muro existente: se ve en 3D pero no se fabrica).

### Edición directa en el 3D (iPad)

- **Tocar** una pieza la selecciona (un dedo gira, dos dedos mueven/zoom; un toque sin arrastrar selecciona).
- **Esferas naranjas** en los bordes: estirar o encoger. **Flechas** X (rojo) / Y (verde) / Z (azul): mover.
- Imán a las caras de otras piezas (15 mm) y grilla de 5 mm; etiqueta con la medida mientras arrastras.
- El arrastre se escribe en la fórmula: si la medida es un parámetro (`alto_respaldo`) cambia el parámetro — y todas
  las piezas que lo usan —; si es un número, cambia el número; si es una fórmula, se ajusta su término final
  (`alto_cama - 20` → `alto_cama + 30`). Respeta los rangos del arquitecto. Deshacer/rehacer en el visor.
- Barra de la pieza: **Dibujar en la pieza** (abre su silueta en el Boceto para calar), Duplicar, Eliminar.

Ejemplo cargable: *Cama nido: respaldo + baranda* (cama de 106 × 200 × 45 cm, respaldo y piecera con silueta de orejas y
ventana calada, baranda removible con barrotes de luz ≤ 75 mm).

## Tipologías paramétricas incluidas

- **Estantería / librero** — ancho, alto, profundidad, repisas, módulos, fondo, zócalo, espesor.
- **Mesa de placas** — largo, ancho, alto, retiro de patas, travesaño, espesor.
- **Nicho de lectura** — caja con corte semicircular en los costados, asiento curvo de listones fresados con cojín tapizado (cotizado por m², fuera del anidado CNC) y librero lateral opcional.
- **Costillas desde boceto** — tu perfil dibujado a mano repetido N veces (bancos, biombos, lámparas, revestimientos); con 1 costilla es una pieza plana única.

Agregar una tipología = una función `build(valores) → piezas` en `src/core/templates.ts` (y su espejo en
`public/rhino/trazo_rhino.py` para Grasshopper). Cada pieza es un perfil 2D extruido en un plano: exactamente
lo que entiende un CNC.

## Rhino y Grasshopper

- **Abrir el `.3dm`** directamente en Rhino 7/8 (Mac/Windows). Capas `Piezas · <rol>`, `CNC · …`, `Referencia · Boceto`.
- **`trazo_rhino.py`** (Exportar → Script): en Rhino 8 `ScriptEditor` → Run → elegir el `*.trazo-spec.json`;
  pregunta si cambiar parámetros y hornea sólidos con UserText. En Grasshopper, pégalo en un componente
  *Python 3 Script* con entradas `spec` (ruta) y `overrides` (lista `clave=valor`) → salidas `breps, names, roles, report`.
  Los generadores son los mismos que la app, así que el producto sigue siendo paramétrico en Rhino.

## Publicar un producto en la tienda

1. Tienda → *Descargar especificación para publicar* → `mi-producto.json`.
2. Súbelo a `public/productos/` del repo (desde el iPad: github.com → Add file → Upload).
3. Comparte `https://<usuario>.github.io/Trazo/#/tienda?producto=mi-producto` (modo público, sin herramientas de diseño).

Ejemplos: `#/tienda?producto=estanteria-demo`, `#/tienda?producto=banco-costillas-demo`, `#/tienda?producto=nicho-lectura`.

Para publicar una demo que abra directo en un proyecto: `VITE_SEED=<nombre> npm run build` precarga `productos/<nombre>.trazo.json` la primera vez que se abre (generado con `DEMO_OUT=… REF_IMG=… npx vite-node scripts/make-demo.ts`).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173 (con --host para abrirlo desde el iPad en la misma red)
npm test         # pruebas del núcleo (geometría, tinta inteligente, anidado, factibilidad)
npm run build    # dist/ estático
```

Stack: Vite + TypeScript sin framework, three.js (visor y exportadores), rhino3dm (WASM, carga diferida al exportar).

Más detalles del flujo de trabajo y la hoja de ruta en [`docs/FLUJO.md`](docs/FLUJO.md).
