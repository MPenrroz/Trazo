import { defineConfig } from 'vite';

// base relativo: funciona en GitHub Pages (https://usuario.github.io/Trazo/) y en local.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
} as any);
