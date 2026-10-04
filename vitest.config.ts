import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'app/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'app/renderer/src/**/*.test.ts', 'app/main/**/*.test.ts']
  }
});
