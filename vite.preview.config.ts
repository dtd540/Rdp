import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'app/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'app/renderer/src')
    }
  },
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1'
  },
  clearScreen: false
});
