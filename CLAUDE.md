# Trazo — notas para agentes

- App web estática (Vite + TS sin framework). Español en UI y comentarios. Unidades mm, Z arriba.
- Núcleo puro y testeado en `src/core/` (`templates.ts` generadores, `analysis.ts` factibilidad/costo, `nesting.ts`).
- Si cambias una plantilla en `src/core/templates.ts`, replica el cambio en `public/rhino/trazo_rhino.py` (espejo Python para Rhino/Grasshopper) y regenera ejemplos con `npx vite-node scripts/make-demo.ts`.
- Antes de commit: `npx tsc --noEmit && npm test && npm run build`.
- El usuario trabaja desde iPad: mantener objetivos táctiles ≥ 44 px y soporte Apple Pencil (pointerType 'pen').
- Diseño libre: `src/core/expr.ts` (fórmulas) y `src/core/free.ts` (piezas); espejo Python en `trazo_rhino.py` (`eval_expr`, `build_libre`). Mantener ambos evaluadores con la misma sintaxis.
