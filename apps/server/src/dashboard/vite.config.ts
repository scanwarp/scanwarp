import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, '../../dist/dashboard'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3000',
      '/projects': 'http://localhost:3000',
      '/monitors': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/incidents': 'http://localhost:3000',
      '/traces': 'http://localhost:3000',
      '/channels': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
});
