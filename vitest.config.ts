import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,          // включает глобальные переменные describe, it, expect, vi
    environment: 'jsdom',   // для поддержки XMLHttpRequest и браузерных API
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});