import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,                 // генерация одного index.d.ts в корне dist
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  esbuildOptions(options) {
    options.drop = ['console'];
  },
});