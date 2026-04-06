import { defineConfig } from 'tsup';

export default defineConfig({
  // Точка входа в вашу библиотеку
  entry: ['src/index.ts'],
  // Целевые форматы: ES Modules и CommonJS
  format: ['esm', 'cjs'],
  // Генерировать файлы деклараций типов (.d.ts)
  dts: false,
  // Очищать выходную директорию перед сборкой
  clean: true,
  // Минификация кода (опционально, можно отключить для отладки)
  minify: false,
  // Путь для выходных файлов
  outDir: 'dist',
  // Удалить все вызовы console.*
  esbuildOptions(options) {
    options.drop = ['console']; // удаляет все console.*
  },
});