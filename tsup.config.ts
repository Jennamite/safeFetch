import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],   // только точка входа
  format: ['cjs', 'esm'],
  dts: true,                 // генерирует index.d.ts
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  esbuildOptions(options) {
    options.drop = ['console'];
  },
});