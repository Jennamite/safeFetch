import type { SafeFetchError } from './errors';

// Базовые типы
export type RequestMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Основные опции запроса.
 * Расширяет стандартный RequestInit, добавляя специфичные для библиотеки поля.
 */
export interface FetchOptions extends Omit<RequestInit, 'cache'> {
  /**
   * Кастомная реализация fetch.
   * По умолчанию используется глобальный fetch или node-fetch.
   */
  // fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Базовый URL, будет объединён с переданным url */
  baseUrl?: string;
  /** Таймаут запроса в миллисекундах */
  timeout?: number;
  /** Количество повторных попыток при ошибке (по умолчанию 0) */
  retry?: number;
  /** Задержка между попытками: число (мс) или функция (attempt) => число */
  retryDelay?: number | ((attempt: number) => number);
  /** Условие для повторной попытки (по умолчанию: безопасные методы и статус 5xx) */
  retryOn?: (error: SafeFetchError, response?: Response, method?: string) => boolean;
  /** Функция для проверки успешности статуса ответа (по умолчанию 200-299) */
  validateStatus?: (status: number) => boolean;
  /** Способ парсинга тела ответа */
  parse?: 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | ((response: Response) => Promise<any>);
  /** Параметры query, будут добавлены к URL */
  query?: Record<string, string | number | boolean | undefined>;
  /** Если true, возвращает сырой Response вместо распарсенных данных */
  raw?: boolean;
  /** Режим кэширования */
  cache?: 'memory' | 'no-cache' | 'force-cache';
  /** Время жизни кэша в миллисекундах (по умолчанию 5 минут) */
  cacheTTL?: number;
  /** Максимальный размер кэша (количество записей) */
  maxCacheSize?: number;
  /** Включает дедупликацию одинаковых запросов (только для безопасных методов) */
  dedupe?: boolean;
  /** Игнорировать кэш и дедупликацию, принудительно выполнить запрос */
  force?: boolean;
  /** Использовать stale-while-revalidate: отдавать устаревший кэш и обновлять в фоне */
  staleWhileRevalidate?: boolean;
  /** Теги для инвалидации кэша */
  tags?: string[];
  /** Интервал опроса в миллисекундах (автоматически повторять запрос) */
  pollInterval?: number;
  /** Идентификатор запроса (можно передать строку или функцию генерации) */
  requestId?: string | (() => string);
  /** Прогресс загрузки (только в браузере через XHR) */
  onUploadProgress?: (progress: number) => void;
  /** Прогресс скачивания (только в браузере через XHR) */
  onDownloadProgress?: (progress: number) => void;
  /** Если true, вместо данных возвращается объект с метаинформацией (статус, заголовки и т.д.) */
  returnMeta?: boolean;
  /** Произвольный контекст, доступный в middleware и хуках */
  context?: Record<string, any>;
  /** Ограничение параллельных запросов по ключу */
  concurrency?: {
    key?: string;          // если не указан, строится автоматически
    max?: number;          // максимальное количество одновременных запросов для этого ключа
  };
  /** Включить пакетную обработку (batch) для POST-запросов */
  batch?: boolean;
  /** Ключ для группировки батча (по умолчанию строится автоматически) */
  batchKey?: string;
  /** Максимальное время ожидания накопления запросов в батче (мс) */
  batchMaxWaitMs?: number;
  /** Список заголовков, которые влияют на ключ кэша и дедупликации */
  includeHeaders?: string[];
}

/**
 * Структура результата при returnMeta: true
 */
export interface FetchResult<T = any> {
  data: T;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
}

/**
 * Контекст запроса, передаваемый через middleware и хуки.
 */
export interface RequestContext {
  url: string;
  options: FetchOptions;
  request?: Request;
  response?: Response;
  data?: any;
  error?: SafeFetchError;
  metadata: {
    requestId: string;
    startTime: number;
    retryCount: number;
    cacheHit?: boolean;
    stale?: boolean;
    dedupeHit?: boolean;
    [key: string]: any;
  };
  controller: AbortController;
  cancel: (reason?: string) => void;
}

/**
 * Middleware — функция, принимающая контекст и функцию next, которая продолжает выполнение цепочки.
 */
export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => Promise<void>;

/**
 * Хуки (упрощённый вариант, могут быть реализованы через middleware)
 */
export type OnRequestHook = (ctx: RequestContext) => void | Promise<void>;
export type OnResponseHook = (ctx: RequestContext) => void | Promise<void>;
export type OnErrorHook = (ctx: RequestContext, error: SafeFetchError) => void | Promise<void>;

/**
 * События телеметрии
 */
export type TelemetryEvent =
  | { type: 'request'; ctx: RequestContext }
  | { type: 'response'; ctx: RequestContext; duration: number }
  | { type: 'error'; ctx: RequestContext; error: SafeFetchError; duration: number };

/**
 * Плагин для расширения функциональности
 */
export interface Plugin<TOptions = any> {
  name: string;
  setup: (instance: SafeFetchInstance, options?: TOptions) => void | Promise<void>;
}

/**
 * Интерфейс экземпляра safeFetch, возвращаемого createSafeFetch
 */
export interface SafeFetchInstance {
  <T = any>(url: string, options?: FetchOptions): Promise<T | FetchResult<T>>;
  get: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  post: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  put: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  patch: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  del: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  raw: (url: string, options?: Omit<FetchOptions, 'raw'>) => Promise<Response>;

  use: (...middlewares: Middleware[]) => SafeFetchInstance;
  prepend: (...middlewares: Middleware[]) => SafeFetchInstance;
  plugin: <T>(plugin: Plugin<T>, options?: T) => SafeFetchInstance;
  setDefaults: (defaults: Partial<FetchOptions>) => SafeFetchInstance;

  onRequest: (hook: OnRequestHook) => () => void;
  onResponse: (hook: OnResponseHook) => () => void;
  onError: (hook: OnErrorHook) => () => void;

  // invalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => void;
  invalidate(): void;
  invalidate(pattern: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }): void;
  invalidate(options: { tags?: string[]; method?: string }): void;
  revalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => Promise<void>;

  onCacheEvent: (event: 'invalidate' | 'set' | 'delete', listener: (key: string, entry?: any) => void) => () => void;
  onTelemetry: (listener: (event: TelemetryEvent) => void) => () => void;

  hydrateCache: (data: Record<string, any>) => void;
  serializeCache: () => Record<string, any>;

  createClient: <T extends Record<string, any>>(baseUrl?: string) => T;
}

/**
 * Сериализованная запись кэша (используется для hydrateCache / serializeCache)
 */
export interface CacheEntrySerialized {
  data: any;
  requestId: string;
  headers: [string, string][];
  status: number;
  statusText: string;
  expires: number;
  tags: string[];
}