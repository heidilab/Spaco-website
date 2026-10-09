import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors tsconfig's "@/*" → "src/*" so tests can exercise modules that
// use the app's import alias (e.g. email templates importing @/types).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
