import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,           // ← не генерируем типы через tsup
  clean: false,         // ← очистку делаем в скрипте
  outDir: 'dist',
  sourcemap: true,
  esbuildOptions(options) {
    options.drop = ['console'];
  },
});