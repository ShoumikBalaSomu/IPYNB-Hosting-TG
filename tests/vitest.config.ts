import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@telebook/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
