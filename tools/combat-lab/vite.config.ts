import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174 },
  // three.js sozinho passa de 500 kB; é uma ferramenta de dev, não importa.
  build: { chunkSizeWarningLimit: 1000 },
});
