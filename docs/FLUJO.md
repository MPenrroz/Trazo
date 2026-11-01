# Flujo de trabajo Trazo: iPad → producto → tienda

## 1. Captura de la idea (iPad)

| Herramienta | Uso | Cómo llega a Trazo |
|---|---|---|
| Procreate / Concepts / Morpholio Trace / Notas | Boceto a mano | Compartir → Guardar en Archivos, o **copiar capa y pegar (⌘V)** en Boceto |
| Fotos / Pinterest / Safari | Imágenes referenciales | Arrastrar desde Split View, pegar o elegir en Concepto |
| Pencil directo en Trazo | Calco limpio y perfil | Tinta inteligente sobre el boceto importado |

Consejo: incluye en el dibujo una medida conocida (ancho total, altura de asiento 450 mm…) para calibrar la escala.

## 2. Del trazo a la geometría

1. Importa el boceto como calco (opacidad ajustable).
2. **📏 Escala**: traza sobre la medida conocida e ingresa el valor en mm.
3. **✎ Tinta inteligente**: repasa las líneas principales. Trazos casi rectos → rectas a 0/45/90°; formas cerradas → polígonos o círculos; trazos orgánicos → curvas suavizadas.
4. **◎ Elegir perfil**: toca la forma cerrada que define el producto (naranjo).
5. *Usar perfil → Modelo 3D*.

## 3. Factibilidad (antes de abrir Rhino)

- **Planos**: compara el boceto superpuesto con las vistas generadas; revisa cotas y luces.
- **Fabricación**: el semáforo indica si cabe en la cama/tablero, si el espesor existe, si hay esquinas que requieren dogbones, flecha de repisas, vuelco. Ajusta parámetros hasta quedar en verde.
- **Costo**: tableros × precio + metros de corte + setup + base → precio con margen.

## 4. Rhino como mesa de trabajo de detalle

- `.3dm` → uniones (finger joints, tarugos, herrajes), cantos, chaflanes, texturas.
- `trazo_rhino.py` en Grasshopper → mantener el producto paramétrico y agregar lógica propia (encastres que dependen del espesor, perforaciones de sistema 32, etc.).
- Las piezas llevan UserText (`trazo:rol`, `trazo:espesor_mm`, `trazo:material`) para filtrar y generar despieces con `_ExportWithOrigin` o RhinoCAM.

## 5. Tienda configurable

El arquitecto define en **Modelo → Reglas para tienda** qué cambia el cliente y entre qué rangos. La tienda
bloquea combinaciones no fabricables y calcula el precio con la misma lógica de costos.

## Hoja de ruta sugerida

| Prioridad | Integración | Valor |
|---|---|---|
| Alta | **Uniones automáticas** (encastres CNC, dogbones, ranuras para fondo) en los generadores | Del modelo al corte sin pasar por Rhino para productos simples |
| Alta | **Checkout real** (Shopify Storefront / Stripe Checkout) usando el pedido JSON | Vender desde la tienda |
| Alta | **Visión con Claude**: subir boceto + referencias → propuesta de tipología, parámetros y riesgos de fabricación (requiere backend con API key) | Acelera el paso 1→3 |
| Media | **Rhino.Compute / ShapeDiver**: la tienda llama a la definición Grasshopper refinada en vez del generador JS | Productos más complejos manteniendo la tienda |
| Media | **Sincronización en la nube** (Supabase/Firebase o carpeta iCloud vía `.trazo.json`) | Mismo proyecto en iPad y PC |
| Media | Exportar G-code / post-procesadores por máquina; etiquetas QR por pieza para ensamble | Taller semi-automatizado |
| Media | Biblioteca de herrajes y materiales con stock/precios del proveedor | Costos reales |
| Baja | Colaboración: comentarios sobre láminas, versiones por cliente, aprobación de planos | Flujo con clientes y taller |
| Baja | Celda robótica: exportar secuencia de ensamble (orden de piezas, poses) desde el despiece | Automatización del armado |
