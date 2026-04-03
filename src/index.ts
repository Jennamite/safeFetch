// Публичные типы
export * from './types';
export { SafeFetchError } from './errors';

// Основной класс и фабрика (импортируем напрямую из core/SafeFetch)
export { SafeFetch, createSafeFetch } from './core/SafeFetch';

// Экземпляр по умолчанию
import { createSafeFetch } from './core/SafeFetch';
import type { SafeFetchInstance, FetchOptions } from './types';

/**
 * Экземпляр safeFetch с настройками по умолчанию:
 * - credentials: 'same-origin'
 * - timeout: 10000 мс
 * - retry: 2 попытки
 * - retryDelay: экспоненциальная задержка до 30 секунд
 * - validateStatus: статус 200-299
 * - parse: 'auto'
 * - cache: 'no-cache'
 * - dedupe: true
 * - maxCacheSize: 50
 */
export const safeFetch: SafeFetchInstance = createSafeFetch({
  credentials: 'same-origin',
  timeout: 10000,
  retry: 2,
  retryDelay: (attempt: number) => Math.min(1000 * Math.pow(2, attempt - 1), 30000),
  validateStatus: (status) => status >= 200 && status < 300,
  parse: 'auto',
  cache: 'no-cache',
  dedupe: true,
  maxCacheSize: 50,
});

export default safeFetch;

// Утилиты для клиента
export { createClient } from './client/createClient';

// Плагины
export type { Plugin } from './plugins/Plugin';