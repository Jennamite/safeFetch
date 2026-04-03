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
  tags?: string[];
  pollInterval?: number;
  requestId?: string | (() => string);
  onUploadProgress?: (progress: number) => void;
  onDownloadProgress?: (progress: number) => void;
  returnMeta?: boolean;
  context?: Record<string, any>;
  concurrency?: {
    key?: string;
    max?: number;
  };
  batch?: boolean;
  batchKey?: string;
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

export type OnRequestHook = (ctx: RequestContext) => void | Promise<void>;
export type OnResponseHook = (ctx: RequestContext) => void | Promise<void>;
export type OnErrorHook = (ctx: RequestContext, error: SafeFetchError) => void | Promise<void>;

export type TelemetryEvent =
  | { type: 'request'; ctx: RequestContext }
  | { type: 'response'; ctx: RequestContext; duration: number }
  | { type: 'error'; ctx: RequestContext; error: SafeFetchError; duration: number };

export interface Plugin<TOptions = any> {
  name: string;
  setup: (instance: SafeFetchInstance, options?: TOptions) => void | Promise<void>;
}

export interface SafeFetchInstance {
  <T = any>(url: string, options?: FetchOptions): Promise<T | FetchResult<T>>;
  get: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  post: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  put: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  patch: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  del: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  raw: (url: string, options?: Omit<FetchOptions, 'raw'>) => Promise<Response>;
  use: (...middlewares: Middleware[]) => SafeFetchInstance;
  plugin: <T>(plugin: Plugin<T>, options?: T) => SafeFetchInstance;
  setDefaults: (defaults: Partial<FetchOptions>) => SafeFetchInstance;
  onRequest: (hook: OnRequestHook) => () => void;
  onResponse: (hook: OnResponseHook) => () => void;
  onError: (hook: OnErrorHook) => () => void;
  invalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => void;
  revalidate: (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => Promise<void>;
  onCacheEvent: (event: 'invalidate' | 'set' | 'delete', listener: (key: string, entry?: any) => void) => () => void;
  onTelemetry: (listener: (event: TelemetryEvent) => void) => () => void;
  hydrateCache: (data: Record<string, CacheEntrySerialized>) => void;
  serializeCache: () => Record<string, CacheEntrySerialized>;
  createClient<T extends Record<string, any>>(baseUrl?: string): T;
}

export interface CacheEntrySerialized {
  data: any;
  requestId: string;
  headers: [string, string][];
  status: number;
  statusText: string;
  expires: number;
  tags: string[];
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

function isSafeMethod(method?: string): boolean {
  return method === 'GET' || method === 'HEAD';
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

const fetchAdapter = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
  if (typeof fetch !== 'undefined') return fetch(input, init);
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch(input, init);
};

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
    const parseMode = options.parse ?? 'auto';
    if (parseMode === 'arrayBuffer') xhr.responseType = 'arraybuffer';
    else if (parseMode === 'blob') xhr.responseType = 'blob';
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
        if (parseMode === 'json') {
          try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText; }
        } else if (parseMode === 'text') {
          data = xhr.responseText;
        } else if (parseMode === 'blob') {
          data = xhr.response;
        } else if (parseMode === 'arrayBuffer') {
          data = xhr.response;
        } else if (typeof parseMode === 'function') {
          data = parseMode(response);
        } else if (parseMode === 'auto') {
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
// Кэш
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

  serialize(): Record<string, CacheEntrySerialized> {
    const result: Record<string, CacheEntrySerialized> = {};
    for (const [key, entry] of this.cache.entries()) {
      result[key] = {
        data: entry.data,
        requestId: entry.requestId,
        headers: Array.from(entry.headers.entries()),
        status: entry.status,
        statusText: entry.statusText,
        expires: entry.expires,
        tags: entry.tags,
      };
    }
    return result;
  }

  hydrate(data: Record<string, CacheEntrySerialized>) {
    for (const [key, entry] of Object.entries(data)) {
      const headers = new Headers(entry.headers);
      this.cache.set(key, {
        data: entry.data,
        requestId: entry.requestId,
        headers,
        status: entry.status,
        statusText: entry.statusText,
        expires: entry.expires,
        tags: entry.tags,
      });
      this.keysOrder.push(key);
    }
    this.keysOrder = this.keysOrder.slice(-this.maxSize);
    if (this.keysOrder.length > this.maxSize) {
      const oldest = this.keysOrder.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }

  forEach(callback: (key: string, entry: CacheEntry) => void) {
    this.cache.forEach((entry, key) => callback(key, entry));
  }
}

// ============================================================================
// Вспомогательные структуры
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

class ConcurrencyController {
  private active = new Map<string, number>();
  private queues = new Map<string, Array<() => void>>();

  async acquire(key: string, max: number): Promise<void> {
    const current = this.active.get(key) || 0;
    if (current < max) {
      this.active.set(key, current + 1);
      return;
    }
    return new Promise(resolve => {
      if (!this.queues.has(key)) this.queues.set(key, []);
      this.queues.get(key)!.push(resolve);
    });
  }

  release(key: string) {
    const current = this.active.get(key) || 0;
    if (current <= 0) return;
    const next = current - 1;
    if (next === 0) {
      this.active.delete(key);
    } else {
      this.active.set(key, next);
    }
    const queue = this.queues.get(key);
    if (queue && queue.length) {
      const resolve = queue.shift();
      if (resolve) {
        this.active.set(key, (this.active.get(key) || 0) + 1);
        resolve();
      }
    }
  }
}

class Telemetry {
  private listeners: Set<(event: TelemetryEvent) => void> = new Set();

  on(listener: (event: TelemetryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TelemetryEvent) {
    this.listeners.forEach(l => l(event));
  }
}

// ============================================================================
// Batching для POST-запросов
// ============================================================================
interface BatchRequest {
  ctx: RequestContext;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

class BatchProcessor {
  private pending = new Map<string, BatchRequest[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  async process(key: string, ctx: RequestContext, instance: SafeFetchInstance): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key)!.push({ ctx, resolve, reject });

      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(instance), 0);
      }
    });
  }

  private async flush(instance: SafeFetchInstance) {
    const batches = Array.from(this.pending.entries());
    this.pending.clear();
    this.timer = null;

    for (const [key, requests] of batches) {
      const first = requests[0];
      const { url, options } = first.ctx;
      const bodies = requests.map(r => r.ctx.options.body);
      const batchBody = { batch: bodies };
      const batchOptions: FetchOptions = {
        ...options,
        method: 'POST',
        body: batchBody,
        batch: false,
        context: { ...options.context, __batchKey: key },
      };
      try {
        const response = await instance(url, batchOptions);
        let dataArray: any[];
        if (Array.isArray(response)) {
          dataArray = response;
        } else if (response && typeof response === 'object' && Array.isArray((response as any).data)) {
          dataArray = (response as any).data;
        } else {
          throw new SafeFetchError('Batch response must be an array or contain "data" array');
        }
        if (dataArray.length !== requests.length) {
          throw new SafeFetchError(`Batch response length mismatch: expected ${requests.length}, got ${dataArray.length}`);
        }
        for (let i = 0; i < requests.length; i++) {
          requests[i].resolve(dataArray[i]);
        }
      } catch (err) {
        for (const req of requests) {
          req.reject(err);
        }
      }
    }
  }
}

// ============================================================================
// Встроенные middleware (фабрики)
// ============================================================================
const retryMiddleware = (): Middleware => {
  return async (ctx, next) => {
    const retryCount = ctx.options.retry ?? 0;
    const retryDelayFn = ctx.options.retryDelay ?? ((attempt: number) => Math.min(1000 * Math.pow(2, attempt - 1), 30000));
    const retryOn = ctx.options.retryOn ?? ((err: SafeFetchError) => {
      if (err.isAbort) return false;
      const status = err.status;
      return isSafeMethod(ctx.options.method) && (!status || status >= 500);
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

const dedupeMiddleware = (dedupePending: Map<string, Promise<any>>): Middleware => {
  return async (ctx, next) => {
    const { method, dedupe = true, force = false } = ctx.options;
    if (!isSafeMethod(method) || !dedupe || force) {
      await next();
      return;
    }
    const key = buildKey(ctx.url, method!, ctx.options.query, ctx.options.body);
    const existing = dedupePending.get(key);
    if (existing) {
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

const concurrencyMiddleware = (concurrencyController: ConcurrencyController): Middleware => {
  return async (ctx, next) => {
    const concurrency = ctx.options.concurrency;
    if (!concurrency || concurrency.max === undefined) {
      await next();
      return;
    }
    const key = concurrency.key ?? buildKey(ctx.url, ctx.options.method || 'GET', ctx.options.query, ctx.options.body);
    const max = concurrency.max;
    await concurrencyController.acquire(key, max);
    try {
      await next();
    } finally {
      concurrencyController.release(key);
    }
  };
};

const batchMiddleware = (batchProcessor: BatchProcessor, instance: SafeFetchInstance): Middleware => {
  return async (ctx, next) => {
    const { method, batch, batchKey, body } = ctx.options;
    if (method !== 'POST' || !batch) {
      await next();
      return;
    }
    const key = batchKey ?? buildKey(ctx.url, method, ctx.options.query, body);
    const result = await batchProcessor.process(key, ctx, instance);
    ctx.data = result;
    // Прерываем pipeline, так как ответ уже получен
    return;
  };
};

const cacheMiddleware = (cacheInstance: MemoryCache, refreshPending: Map<string, Promise<any>>, instance: SafeFetchInstance): Middleware => {
  return async (ctx, next) => {
    const { cache, cacheTTL = 5 * 60 * 1000, force = false, staleWhileRevalidate = false, method, body, query, tags = [] } = ctx.options;
    if (!isSafeMethod(method) || cache !== 'memory') {
      await next();
      return;
    }
    const key = buildKey(ctx.url, method!, query, body);

    if (staleWhileRevalidate && !force) {
      const staleEntry = cacheInstance.get(key, true);
      if (staleEntry !== undefined) {
        const refreshKey = `refresh:${key}`;
        if (!refreshPending.has(refreshKey)) {
          const refreshPromise = (async () => {
            try {
              await instance(ctx.url, { ...ctx.options, force: true, staleWhileRevalidate: false });
            } catch {
              // ignore background errors
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

    if (!force) {
      const cached = cacheInstance.get(key);
      if (cached !== undefined) {
        ctx.data = cached.data;
        ctx.response = new Response(null, { status: cached.status, statusText: cached.statusText });
        ctx.metadata.cacheHit = true;
        return;
      }
    }

    await next();

    if (ctx.data !== undefined && !ctx.error && ctx.response) {
      cacheInstance.set(key, ctx.data, ctx.metadata.requestId, ctx.response.headers, ctx.response.status, ctx.response.statusText, cacheTTL, tags);
    }
  };
};

const fetchMiddleware: Middleware = async (ctx, next) => {
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

const telemetryMiddleware = (telemetry: Telemetry): Middleware => {
  return async (ctx, next) => {
    const start = Date.now();
    telemetry.emit({ type: 'request', ctx });
    try {
      await next();
      const duration = Date.now() - start;
      telemetry.emit({ type: 'response', ctx, duration });
    } catch (err) {
      const duration = Date.now() - start;
      telemetry.emit({ type: 'error', ctx, error: err as SafeFetchError, duration });
      throw err;
    }
  };
};

const mutationInvalidationMiddleware = (cacheInstance: MemoryCache): Middleware => {
  return async (ctx, next) => {
    await next();
    const { method, tags } = ctx.options;
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isMutation && tags && tags.length) {
      cacheInstance.invalidateByTags(tags);
    }
  };
};

const pollingMiddleware = (instance: SafeFetchInstance): Middleware => {
  return async (ctx, next) => {
    const { pollInterval } = ctx.options;
    if (!pollInterval) {
      await next();
      return;
    }
    await next();
    if (!ctx.error) {
      const poll = async () => {
        if (ctx.controller.signal.aborted) return;
        try {
          await instance(ctx.url, { ...ctx.options, pollInterval: undefined });
        } catch {
          // ignore
        } finally {
          if (!ctx.controller.signal.aborted) {
            setTimeout(poll, pollInterval);
          }
        }
      };
      setTimeout(poll, pollInterval);
    }
  };
};

// ============================================================================
// Создание экземпляра
// ============================================================================
export function createSafeFetch(defaultOptions: Partial<FetchOptions> = {}): SafeFetchInstance {
  const memoryCache = new MemoryCache(defaultOptions.maxCacheSize ?? 50);
  const dedupePending = new Map<string, Promise<any>>();
  const refreshPending = new Map<string, Promise<any>>();
  const concurrencyController = new ConcurrencyController();
  const telemetry = new Telemetry();
  const batchProcessor = new BatchProcessor();
  let globalDefaults = { ...defaultOptions };

  const requestHooks = new Set<OnRequestHook>();
  const responseHooks = new Set<OnResponseHook>();
  const errorHooks = new Set<OnErrorHook>();

  // Начальный набор middleware с плейсхолдерами
  let middlewares: Middleware[] = [
    retryMiddleware(),
    timeoutMiddleware,
    concurrencyMiddleware(concurrencyController),
    queryMiddleware,
    bodyMiddleware,
    dedupeMiddleware(dedupePending),
    (async () => {}) as Middleware, // placeholder for batch
    (async () => {}) as Middleware, // placeholder for cache
    fetchMiddleware,
    responseMiddleware,
    telemetryMiddleware(telemetry),
    mutationInvalidationMiddleware(memoryCache),
    (async () => {}) as Middleware, // placeholder for polling
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

    for (const hook of requestHooks) {
      await hook(ctx);
    }

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

      for (const hook of responseHooks) {
        await hook(ctx);
      }

      return ctx.data as T;
    } catch (err) {
      const error = err instanceof SafeFetchError ? err : new SafeFetchError((err as Error).message);
      ctx.error = error;

      for (const hook of errorHooks) {
        await hook(ctx, error);
      }

      throw error;
    }
  };

  instance = request as SafeFetchInstance;

  // Замена плейсхолдеров на реальные middleware с instance
  const batchMw = batchMiddleware(batchProcessor, instance);
  const cacheMw = cacheMiddleware(memoryCache, refreshPending, instance);
  const pollingMw = pollingMiddleware(instance);

  // Находим индексы плейсхолдеров (по умолчанию на позициях 6,7,12)
  middlewares[6] = batchMw;
  middlewares[7] = cacheMw;
  middlewares[12] = pollingMw;

  // Добавляем вспомогательные методы
  instance.get = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => instance<T>(url, { ...options, method: 'GET' });
  instance.post = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'POST', body });
  instance.put = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'PUT', body });
  instance.patch = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => instance<T>(url, { ...options, method: 'PATCH', body });
  instance.del = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => instance<T>(url, { ...options, method: 'DELETE' });
  instance.raw = (url: string, options?: Omit<FetchOptions, 'raw'>) => instance<Response>(url, { ...options, raw: true });

  instance.use = (...newMiddlewares: Middleware[]) => {
    middlewares = [...newMiddlewares, ...middlewares];
    return instance;
  };

  instance.plugin = <T>(plugin: Plugin<T>, pluginOptions?: T) => {
    plugin.setup(instance, pluginOptions);
    return instance;
  };

  instance.setDefaults = (defaults) => {
    globalDefaults = { ...globalDefaults, ...defaults };
    return instance;
  };

  instance.onRequest = (hook) => {
    requestHooks.add(hook);
    return () => requestHooks.delete(hook);
  };

  instance.onResponse = (hook) => {
    responseHooks.add(hook);
    return () => responseHooks.delete(hook);
  };

  instance.onError = (hook) => {
    errorHooks.add(hook);
    return () => errorHooks.delete(hook);
  };

  instance.invalidate = (pattern, options = {}) => {
    const { tags, method } = options;
    if (tags && tags.length) {
      memoryCache.invalidateByTags(tags);
    } else if (pattern !== undefined) {
      memoryCache.invalidateByPattern(pattern, method);
    } else {
      memoryCache.clear();
    }
  };

  instance.revalidate = async (pattern, options = {}) => {
    const keysToRevalidate: string[] = [];
    const { tags, method } = options;
    if (tags && tags.length) {
      memoryCache.forEach((key, entry) => {
        if (entry.tags.some(t => tags.includes(t))) keysToRevalidate.push(key);
      });
    } else if (pattern !== undefined) {
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

  instance.onTelemetry = (listener) => {
    return telemetry.on(listener);
  };

  instance.hydrateCache = (data) => {
    memoryCache.hydrate(data);
  };

  instance.serializeCache = () => {
    return memoryCache.serialize();
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
    return proxy as T;
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