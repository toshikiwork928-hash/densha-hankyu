import { defineConfig } from 'vite';

// GitHub Pages 等のサブパス配信でも動くよう相対 base
export default defineConfig({
  base: './',
  server: { port: 8780 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
