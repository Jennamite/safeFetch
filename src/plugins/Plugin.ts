import type { SafeFetchInstance } from '../types';

/**
 * Интерфейс плагина.
 * Плагин может расширять экземпляр safeFetch, добавляя middleware, настройки или методы.
 */
export interface Plugin<TOptions = any> {
  name: string;
  setup: (instance: SafeFetchInstance, options?: TOptions) => void | Promise<void>;
}