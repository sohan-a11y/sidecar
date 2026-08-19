import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'out',
    emptyOutDir: true,
    rollupOptions: {
      // Second entry: the transparent full-screen layer for picking a capture region.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        region: path.resolve(__dirname, 'region.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
});
