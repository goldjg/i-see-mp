import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://localhost:7474',
      '/servers': 'http://localhost:7474',
      '/tools': 'http://localhost:7474',
      '/graph': 'http://localhost:7474',
      '/findings': 'http://localhost:7474',
      '/collections': 'http://localhost:7474',
    },
  },
  build: {
    outDir: 'dist',
  },
});
