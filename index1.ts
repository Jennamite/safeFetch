// safeFetch.ts
// ============================================================================
// Типы
// ============================================================================
export type RequestMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FetchOptions extends RequestInit {
  baseUrl?: string;
  timeout?: number;
  signal?: AbortSignal;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
  retryOn?: (error: SafeFetchError, response?: Response, method?: string) => boolean;
  validateStatus?: (status: number) => boolean;
  parse?: 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | ((response: Response) => Promise<any>);
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
  cache?: 'memory' | 'no-cache' | 'force-cache';
  cacheTTL?: number;
  maxCacheSize?: number;
  dedupe?: boolean;
  force?: boolean;
  staleWhileRevalidate?: boolean;
  tags?: string[];                 // теги для кэширования
  requestId?: string | (() => string);
  onUploadProgress?: (progress: number) => void;
  onDownloadProgress?: (progress: number) => void;
  returnMeta?: boolean;
  context?: Record<string, any>;
}

export interface FetchResult<T = any> {
  data: T;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
}

export class SafeFetchError extends Error {
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly response?: Response;
  public readonly body?: any;
  public readonly request?: Request;
  public readonly isAbort?: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      statusText?: string;
      response?: Response;
      body?: any;
      request?: Request;
      isAbort?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'SafeFetchError';
    this.status = options.status;
    this.statusText = options.statusText;
    this.response = options.response;
    this.body = options.body;
    this.request = options.request;
    this.isAbort = options.isAbort;
  }
}

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

export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => Promise<void>;

export interface SafeFetchInstance {
  <T = any>(url: string, options?: FetchOptions): Promise<T | FetchResult<T>>;
  get: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  post: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  put: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  patch: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  del: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  raw: (url: string, options?: Omit<FetchOptions, 'raw'>) => Promise<Response>;
  use: (...middlewares: Middleware[]) => SafeFetchInstance;
  plugin: (plugin: (instance: SafeFetchInstance) => void) => SafeFetchInstance;
  setDefaults: (defaults: Partial<FetchOptions>) => SafeFetchInstance;
  invalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => void;
  revalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => Promise<void>;
  onCacheEvent: (event: 'invalidate' | 'set' | 'delete', listener: (key: string, entry?: any) => void) => () => void;
  createClient<T extends Record<string, any>>(baseUrl?: string): T;
}

// ============================================================================
// Вспомогательные функции
// ============================================================================
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

function stableStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${k}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(obj);
}

function buildKey(url: string, method: string, query?: Record<string, any>, body?: any): string {
  const q = query ? stableStringify(query) : '';
  let b = '';
  if (body !== undefined) {
    if (typeof body === 'string') b = body;
    else if (body instanceof FormData) b = 'formdata';
    else if (body instanceof Blob) b = `blob:${body.size}`;
    else if (body instanceof URLSearchParams) b = body.toString();
    else b = stableStringify(body);
  }
  return `${method}:${url}:${q}:${b}`;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal & { cleanup?: () => void } | undefined {
  const defined = signals.filter(s => s !== undefined) as AbortSignal[];
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  const controller = new AbortController();
  const onAbort = (event: any) => {
    const reason = event?.target?.reason;
    controller.abort(reason);
  };
  const cleanups: (() => void)[] = [];
  for (const signal of defined) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort);
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }
  (controller.signal as any).cleanup = () => cleanups.forEach(fn => fn());
  return controller.signal;
}

async function parseBody(response: Response, mode: FetchOptions['parse'] = 'auto'): Promise<any> {
  if (mode === 'json') return await response.json();
  if (mode === 'text') return await response.text();
  if (mode === 'blob') return await response.blob();
  if (mode === 'arrayBuffer') return await response.arrayBuffer();
  if (typeof mode === 'function') return await mode(response);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }
  if (contentType.includes('text/')) return await response.text();
  if (contentType.includes('application/octet-stream') || contentType.startsWith('image/')) {
    return await response.blob();
  }
  return null;
}

// Адаптер для Node
const fetchAdapter = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
  if (typeof fetch !== 'undefined') return fetch(input, init);
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch(input, init);
};

// XHR запрос (только браузер)
function xhrRequest<T>(
  url: string,
  method: string,
  options: FetchOptions,
  requestId: string,
  abortSignal?: AbortSignal,
  onProgress?: (progress: number) => void,
  onUpload?: (progress: number) => void,
): Promise<{ data: T; headers: Headers; status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    const headers = new Headers(options.headers);
    headers.set('X-Request-Id', requestId);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));

    if (options.timeout) xhr.timeout = options.timeout;

    if (abortSignal) {
      const onAbort = () => {
        xhr.abort();
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    if (onProgress) {
      xhr.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }

    if (onUpload && xhr.upload) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onUpload(e.loaded / e.total);
      });
    }

    xhr.onload = () => {
      const responseHeaders = new Headers();
      xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
        const parts = line.split(': ');
        if (parts.length === 2) responseHeaders.set(parts[0], parts[1]);
      });

      const response = new Response(xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      });

      if (xhr.status >= 200 && xhr.status < 300) {
        let data: any;
        const parse = options.parse ?? 'auto';
        if (parse === 'json') {
          try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText; }
        } else if (parse === 'text') {
          data = xhr.responseText;
        } else if (parse === 'blob') {
          data = new Blob([xhr.response]);
        } else if (parse === 'arrayBuffer') {
          data = xhr.response;
        } else if (typeof parse === 'function') {
          data = parse(response);
        } else if (parse === 'auto') {
          const contentType = responseHeaders.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText; }
          } else {
            data = xhr.responseText;
          }
        }
        resolve({ data, headers: responseHeaders, status: xhr.status, statusText: xhr.statusText });
      } else {
        const err = new SafeFetchError(`HTTP ${xhr.status}: ${xhr.statusText}`, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: responseHeaders,
          body: xhr.responseText,
        });
        reject(err);
      }
    };
    xhr.onerror = () => reject(new SafeFetchError('Network Error'));
    xhr.ontimeout = () => reject(new SafeFetchError('Request timeout', { isAbort: true }));

    const body = options.body;
    xhr.send(body || undefined);
  });
}

// ============================================================================
// Кэш с тегами и событиями
// ============================================================================
interface CacheEntry {
  data: any;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
  expires: number;
  tags: string[];
}

class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private keysOrder: string[] = [];
  private maxSize: number;
  private listeners: Map<string, Set<(key: string, entry?: CacheEntry) => void>> = new Map();

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  private emit(event: string, key: string, entry?: CacheEntry) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(fn => fn(key, entry));
    }
  }

  on(event: 'invalidate' | 'set' | 'delete', listener: (key: string, entry?: CacheEntry) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  set(key: string, value: any, requestId: string, headers: Headers, status: number, statusText: string, ttl: number, tags: string[] = []) {
    this.cache.set(key, {
      data: value,
      requestId,
      headers,
      status,
      statusText,
      expires: Date.now() + ttl,
      tags,
    });
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    if (this.keysOrder.length > this.maxSize) {
      const oldest = this.keysOrder.shift();
      if (oldest) this.cache.delete(oldest);
    }
    this.emit('set', key, this.cache.get(key));
  }

  get(key: string, ignoreExpiry = false): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (!ignoreExpiry && entry.expires < Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    return entry;
  }

  delete(key: string) {
    const entry = this.cache.get(key);
    this.cache.delete(key);
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.emit('delete', key, entry);
    this.emit('invalidate', key, entry);
  }

  invalidateByTags(tags: string[]) {
    const toDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (entry.tags.some(t => tags.includes(t))) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.delete(key);
    }
  }

  invalidateByPattern(pattern: string | RegExp | ((key: string) => boolean), method?: string) {
    const toDelete: string[] = [];
    for (const [key] of this.cache.entries()) {
      let match = false;
      if (typeof pattern === 'function') match = pattern(key);
      else if (pattern instanceof RegExp) match = pattern.test(key);
      else match = key.includes(pattern);
      if (method && !key.startsWith(`${method.toUpperCase()}:`)) match = false;
      if (match) toDelete.push(key);
    }
    for (const key of toDelete) {
      this.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.keysOrder = [];
    this.emit('invalidate', '*', undefined);
  }
}

// ============================================================================
// Вспомогательная функция для дедупликации
// ============================================================================
async function withDedupe<T>(
  key: string,
  fn: () => Promise<T>,
  pendingMap: Map<string, Promise<T>>
): Promise<T> {
  const existing = pendingMap.get(key);
  if (existing) return existing;
  const promise = fn();
  pendingMap.set(key, promise);
  try {
    return await promise;
  } finally {
    pendingMap.delete(key);
  }
}

// ============================================================================
// Встроенные middleware (Koa-style)
// ============================================================================

// 1. Retry middleware (оборачивает вызов next())
const retryMiddleware = (): Middleware => {
  return async (ctx, next) => {
    const retryCount = ctx.options.retry ?? 0;
    const retryDelayFn = ctx.options.retryDelay ?? ((attempt: number) => Math.min(1000 * Math.pow(2, attempt - 1), 30000));
    const retryOn = ctx.options.retryOn ?? ((err: SafeFetchError) => {
      if (err.isAbort) return false;
      const status = err.status;
      const isSafe = ctx.options.method === 'GET' || ctx.options.method === 'HEAD';
      return isSafe && (!status || status >= 500);
    });

    let attempt = 0;
    while (true) {
      try {
        await next();
        return;
      } catch (err) {
        if (!(err instanceof SafeFetchError)) throw err;
        ctx.error = err;
        if (attempt >= retryCount) throw err;
        if (!retryOn(err)) throw err;
        attempt++;
        ctx.metadata.retryCount = attempt;
        const delay = typeof retryDelayFn === 'function' ? retryDelayFn(attempt) : retryDelayFn;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (ctx.controller.signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new SafeFetchError('Retry cancelled', { isAbort: true }));
            };
            ctx.controller.signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  };
};

// 2. Timeout middleware
const timeoutMiddleware: Middleware = async (ctx, next) => {
  const timeout = ctx.options.timeout;
  if (timeout && ctx.controller) {
    const timeoutId = setTimeout(() => {
      if (!ctx.controller.signal.aborted) {
        ctx.controller.abort(new SafeFetchError('Request timeout', { isAbort: true }));
      }
    }, timeout);
    try {
      await next();
    } finally {
      clearTimeout(timeoutId);
    }
  } else {
    await next();
  }
};

// 3. Query middleware
const queryMiddleware: Middleware = async (ctx, next) => {
  const { query, baseUrl } = ctx.options;
  let url = ctx.url;
  if (baseUrl) url = new URL(url, baseUrl).href;
  if (query && Object.keys(query).length) {
    const urlObj = new URL(url);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) urlObj.searchParams.set(k, String(v));
    });
    ctx.url = urlObj.toString();
  } else {
    ctx.url = url;
  }
  await next();
};

// 4. Body middleware (JSON сериализация)
const bodyMiddleware: Middleware = async (ctx, next) => {
  const { body, method, headers: initHeaders } = ctx.options;
  if (body !== undefined && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
    ctx.options.body = JSON.stringify(body);
    const headers = new Headers(initHeaders);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    ctx.options.headers = headers;
  }
  await next();
};

// 5. Dedupe middleware (только для GET/HEAD, не force)
const dedupeMiddleware = (dedupePending: Map<string, Promise<any>>): Middleware => {
  return async (ctx, next) => {
    const { method, dedupe = true, force = false } = ctx.options;
    const isSafe = method === 'GET' || method === 'HEAD';
    if (!isSafe || !dedupe || force) {
      await next();
      return;
    }
    const key = buildKey(ctx.url, method!, ctx.options.query, ctx.options.body);
    const existing = dedupePending.get(key);
    if (existing) {
      // Ждём результат другого запроса
      const result = await existing;
      ctx.data = result.data;
      ctx.response = result.response;
      ctx.metadata.dedupeHit = true;
      return;
    }
    let resolveFn: any, rejectFn: any;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    dedupePending.set(key, promise);
    try {
      await next();
      resolveFn({ data: ctx.data, response: ctx.response });
    } catch (err) {
      rejectFn(err);
      throw err;
    } finally {
      dedupePending.delete(key);
    }
  };
};

// 6. Cache middleware (с поддержкой stale-while-revalidate и тегов)
const cacheMiddleware = (cacheInstance: MemoryCache, refreshPending: Map<string, Promise<any>>, instance: SafeFetchInstance): Middleware => {
  return async (ctx, next) => {
    const { cache, cacheTTL = 5 * 60 * 1000, force = false, staleWhileRevalidate = false, method, body, query, tags = [] } = ctx.options;
    const isSafe = method === 'GET' || method === 'HEAD';
    if (!isSafe || cache !== 'memory') {
      await next();
      return;
    }
    const key = buildKey(ctx.url, method!, query, body);

    // stale-while-revalidate
    if (staleWhileRevalidate && !force) {
      const staleEntry = cacheInstance.get(key, true);
      if (staleEntry !== undefined) {
        // Запускаем фоновое обновление, дедуплицируя его через refreshPending
        const refreshKey = `refresh:${key}`;
        if (!refreshPending.has(refreshKey)) {
          const refreshPromise = (async () => {
            try {
              await instance(ctx.url, { ...ctx.options, force: true, staleWhileRevalidate: false });
            } catch {
              // ignore
            }
          })();
          refreshPending.set(refreshKey, refreshPromise);
          refreshPromise.finally(() => refreshPending.delete(refreshKey));
        }
        ctx.data = staleEntry.data;
        ctx.response = new Response(null, { status: staleEntry.status, statusText: staleEntry.statusText });
        ctx.metadata.cacheHit = true;
        ctx.metadata.stale = true;
        return;
      }
    }

    // Обычный кэш
    if (!force) {
      const cached = cacheInstance.get(key);
      if (cached !== undefined) {
        ctx.data = cached.data;
        ctx.response = new Response(null, { status: cached.status, statusText: cached.statusText });
        ctx.metadata.cacheHit = true;
        return;
      }
    }

    // Выполняем запрос
    await next();

    // Сохраняем в кэш после успешного выполнения
    if (ctx.data !== undefined && !ctx.error && ctx.response) {
      cacheInstance.set(key, ctx.data, ctx.metadata.requestId, ctx.response.headers, ctx.response.status, ctx.response.statusText, cacheTTL, tags);
    }
  };
};

// 7. Fetch middleware (реальный HTTP)
const fetchMiddleware: Middleware = async (ctx, next) => {
  // Если уже есть ответ (кэш), пропускаем
  if (ctx.response) {
    await next();
    return;
  }

  const { method, headers: initHeaders, raw: isRaw, validateStatus = (s: number) => s >= 200 && s < 300, parse, onUploadProgress, onDownloadProgress, signal: externalSignal } = ctx.options;
  const requestId = ctx.metadata.requestId;
  const useXHR = (!!onUploadProgress || !!onDownloadProgress) && typeof XMLHttpRequest !== 'undefined';

  const headers = new Headers(initHeaders);
  headers.set('X-Request-Id', requestId);

  const finalSignal = combineSignals(externalSignal, ctx.controller.signal);
  const cleanup = (finalSignal as any)?.cleanup;

  const requestInit: RequestInit = {
    method,
    headers,
    body: ctx.options.body,
    signal: finalSignal,
  };

  let request = new Request(ctx.url, requestInit);
  ctx.request = request;

  try {
    let response: Response;
    if (useXHR) {
      const xhrResult = await xhrRequest(
        ctx.url,
        method!,
        ctx.options,
        requestId,
        finalSignal,
        onDownloadProgress,
        onUploadProgress,
      );
      response = new Response(xhrResult.data, {
        status: xhrResult.status,
        statusText: xhrResult.statusText,
        headers: xhrResult.headers,
      });
      ctx.data = xhrResult.data;
      ctx.response = response;
    } else {
      response = await fetchAdapter(request);
      ctx.response = response;

      if (isRaw) {
        ctx.data = response;
        return;
      }

      const statusValid = validateStatus(response.status);
      if (!statusValid) {
        const cloned = response.clone();
        const errorBody = await cloned.text();
        throw new SafeFetchError(`HTTP ${response.status}: ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          response,
          body: errorBody,
          request,
        });
      }
      ctx.data = await parseBody(response, parse);
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    const error = err as Error;
    const isAbort = error.name === 'AbortError' || error.message === 'Request timeout';
    throw new SafeFetchError(error.message, { isAbort, request });
  } finally {
    cleanup?.();
  }
  await next();
};

// 8. Response middleware (returnMeta)
const responseMiddleware: Middleware = async (ctx, next) => {
  await next();
  if (ctx.error) return;
  if (ctx.options.returnMeta && ctx.data !== undefined) {
    const result: FetchResult = {
      data: ctx.data,
      requestId: ctx.metadata.requestId,
      headers: ctx.response?.headers || new Headers(),
      status: ctx.response?.status || 200,
      statusText: ctx.response?.statusText || 'OK',
    };
    ctx.data = result;
  }
};

// ============================================================================
// Создание экземпляра
// ============================================================================
export function createSafeFetch(defaultOptions: Partial<FetchOptions> = {}): SafeFetchInstance {
  const memoryCache = new MemoryCache(defaultOptions.maxCacheSize ?? 50);
  const dedupePending = new Map<string, Promise<any>>();
  const refreshPending = new Map<string, Promise<any>>();
  let globalDefaults = { ...defaultOptions };

  // Middleware chain (порядок важен)
  let middlewares: Middleware[] = [
    retryMiddleware(),
    timeoutMiddleware,
    queryMiddleware,
    bodyMiddleware,
    dedupeMiddleware(dedupePending),
    cacheMiddleware(memoryCache, refreshPending, null as any), // placeholder, будет заменён
    fetchMiddleware,
    responseMiddleware,
  ];

  let instance: SafeFetchInstance;

  const request = async <T = any>(url: string, options: FetchOptions = {}): Promise<T | FetchResult<T>> => {
    const mergedOptions: FetchOptions = { ...globalDefaults, ...options };
    const method = (mergedOptions.method || 'GET').toUpperCase();
    mergedOptions.method = method;

    const controller = new AbortController();
    const cancel = (reason?: string) => {
      if (!controller.signal.aborted) controller.abort(new SafeFetchError(reason || 'Request cancelled', { isAbort: true }));
    };

    const ctx: RequestContext = {
      url,
      options: mergedOptions,
      metadata: {
        requestId: typeof mergedOptions.requestId === 'function' ? mergedOptions.requestId() : (mergedOptions.requestId || generateRequestId()),
        startTime: Date.now(),
        retryCount: 0,
      },
      controller,
      cancel,
    };

    let index = -1;
    const next = async (): Promise<void> => {
      index++;
      if (index < middlewares.length) {
        await middlewares[index](ctx, next);
      }
    };

    try {
      await next();
      if (ctx.error) throw ctx.error;
      return ctx.data as T;
    } catch (err) {
      if (err instanceof SafeFetchError) {
        ctx.error = err;
      } else {
        ctx.error = new SafeFetchError((err as Error).message);
      }
      throw ctx.error;
    }
  };

  instance = request as SafeFetchInstance;

  // Заменяем cacheMiddleware с правильной ссылкой на instance
  const cacheMwIndex = middlewares.findIndex(mw => mw.name === 'cacheMiddleware' || (mw as any).isCacheMw);
  const cacheMw = cacheMiddleware(memoryCache, refreshPending, instance);
  if (cacheMwIndex !== -1) {
    middlewares[cacheMwIndex] = cacheMw;
  } else {
    middlewares.splice(5, 0, cacheMw);
  }
  (cacheMw as any).isCacheMw = true;

  // Методы API
  instance.get = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => instance<T>(url, { ...options, method: 'GET' });
  instance.post = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'POST', body });
  instance.put = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'PUT', body });
  instance.patch = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'PATCH', body });
  instance.del = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => instance<T>(url, { ...options, method: 'DELETE' });
  instance.raw = (url: string, options?: Omit<FetchOptions, 'raw'>) => instance<Response>(url, { ...options, raw: true });

  instance.use = (...newMiddlewares: Middleware[]) => {
    middlewares = [...newMiddlewares, ...middlewares]; // добавляем в начало
    return instance;
  };

  instance.plugin = (pluginFn) => {
    pluginFn(instance);
    return instance;
  };

  instance.setDefaults = (defaults) => {
    globalDefaults = { ...globalDefaults, ...defaults };
    return instance;
  };

  instance.invalidate = (pattern, options = {}) => {
    const { tags, method } = options;
    if (tags && tags.length) {
      memoryCache.invalidateByTags(tags);
    } else if (pattern) {
      memoryCache.invalidateByPattern(pattern, method);
    } else {
      memoryCache.clear();
    }
  };

  instance.revalidate = async (pattern, options = {}) => {
    // Получаем список ключей, подлежащих ревалидации
    const keysToRevalidate: string[] = [];
    const { tags, method } = options;
    if (tags && tags.length) {
      memoryCache.forEach((key, entry) => {
        if (entry.tags.some(t => tags.includes(t))) keysToRevalidate.push(key);
      });
    } else if (pattern) {
      memoryCache.forEach((key) => {
        let match = false;
        if (typeof pattern === 'function') match = pattern(key);
        else if (pattern instanceof RegExp) match = pattern.test(key);
        else match = key.includes(pattern);
        if (method && !key.startsWith(`${method.toUpperCase()}:`)) match = false;
        if (match) keysToRevalidate.push(key);
      });
    } else {
      memoryCache.forEach((key) => keysToRevalidate.push(key));
    }

    // Для каждого ключа удаляем из кэша и выполняем новый запрос (force)
    const promises = keysToRevalidate.map(key => {
      const [method, url] = key.split(':', 2);
      const originalUrl = url;
      memoryCache.delete(key);
      return instance(originalUrl, { method: method as RequestMethod, force: true }).catch(() => {});
    });
    await Promise.allSettled(promises);
  };

  instance.onCacheEvent = (event, listener) => {
    return memoryCache.on(event, listener);
  };

  instance.createClient = <T extends Record<string, any>>(baseUrl?: string): T => {
    const client: any = {};
    const methods: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const buildPath = (path: string) => (baseUrl ? `${baseUrl}${path}` : path);
    const proxy = new Proxy(client, {
      get: (target, prop: string) => {
        if (target[prop]) return target[prop];
        for (const method of methods) {
          if (prop === method.toLowerCase()) {
            return (path: string, data?: any, opts?: FetchOptions) => {
              const options: FetchOptions = { ...opts, method };
              if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) options.body = data;
              return instance(buildPath(path), options);
            };
          }
        }
        if (typeof prop === 'string') {
          return new Proxy(() => {}, {
            get: (_, subProp: string) => {
              return (path?: string, data?: any, opts?: FetchOptions) => {
                const fullPath = `/${prop}${path ? `/${path}` : ''}`;
                return instance(buildPath(fullPath), { ...opts, method: subProp.toUpperCase() as RequestMethod, body: data });
              };
            },
          });
        }
        return undefined;
      },
    });
    return client as T;
  };

  return instance;
}

// ============================================================================
// Экспорт экземпляра по умолчанию
// ============================================================================
export const safeFetch = createSafeFetch({
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