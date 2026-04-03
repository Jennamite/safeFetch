// safeFetch.ts
// ============================================================================
// Типы
// ============================================================================
type RequestHook = (request: Request, options: RequestInit) => Request | Promise<Request>;
type ResponseHook<T = any> = (response: Response, data: T) => T | Promise<T>;
type ErrorHook = (error: Error, request: Request, response?: Response) => any | Promise<any>;

interface FetchOptions extends RequestInit {
  baseUrl?: string;
  timeout?: number;
  signal?: AbortSignal;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
  retryOn?: (error: Error, response?: Response, method?: string) => boolean;
  validateStatus?: (status: number) => boolean;
  parse?: 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | ((response: Response) => Promise<any>);
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
  cache?: 'memory' | 'no-cache' | 'force-cache';
  cacheTTL?: number;
  maxCacheSize?: number;
  dedupe?: boolean;
  force?: boolean;               // игнорировать кэш и принудительно выполнить запрос
  staleWhileRevalidate?: boolean; // вернуть stale данные и обновить фоном
  requestId?: string | (() => string);
  onUploadProgress?: (progress: number) => void;
  onDownloadProgress?: (progress: number) => void;
  returnMeta?: boolean;
  hooks?: {
    onRequest?: RequestHook[];
    onResponse?: ResponseHook[];
    onError?: ErrorHook[];
  };
}

interface FetchResult<T = any> {
  data: T;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
}

interface SafeFetch {
  <T = any>(url: string, options?: FetchOptions): Promise<T | FetchResult<T>>;
  get: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  post: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  put: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  patch: <T = any>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) => Promise<T | FetchResult<T>>;
  del: <T = any>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) => Promise<T | FetchResult<T>>;
  raw: (url: string, options?: Omit<FetchOptions, 'raw'>) => Promise<Response>;
  addGlobalHooks: (hooks: Partial<{ onRequest: RequestHook[]; onResponse: ResponseHook[]; onError: ErrorHook[] }>) => void;
}

// ============================================================================
// Вспомогательные функции
// ============================================================================
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

function stableStringify(obj: Record<string, any>): string {
  const sortedKeys = Object.keys(obj).sort();
  return JSON.stringify(sortedKeys.reduce((acc, key) => ({ ...acc, [key]: obj[key] }), {}));
}

function buildKey(url: string, method: string, body?: any, query?: Record<string, any>): string {
  const q = query ? stableStringify(query) : '';
  let b = '';
  if (body !== undefined) {
    if (typeof body === 'string') b = body;
    else if (body instanceof FormData) b = 'formdata';
    else if (body instanceof Blob) b = `blob:${body.size}`;
    else if (body instanceof URLSearchParams) b = body.toString();
    else try { b = stableStringify(body); } catch { b = 'unknown'; }
  }
  return `${method}:${url}:${q}:${b}`;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal & { cleanup?: () => void } | undefined {
  const defined = signals.filter(s => s !== undefined) as AbortSignal[];
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
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
  // auto
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

function xhrRequest<T>(
  url: string,
  method: string,
  options: FetchOptions,
  requestId: string,
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
        const err = new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
        (err as any).status = xhr.status;
        (err as any).statusText = xhr.statusText;
        (err as any).headers = responseHeaders;
        (err as any).body = xhr.responseText;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Network Error'));
    xhr.ontimeout = () => {
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      reject(err);
    };

    const body = options.body;
    xhr.send(body || undefined);
  });
}

// ============================================================================
// LRU кэш с сохранением метаданных
// ============================================================================
interface CacheEntry {
  data: any;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private keysOrder: string[] = [];
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  set(key: string, value: any, requestId: string, headers: Headers, status: number, statusText: string, ttl: number) {
    this.cache.set(key, {
      data: value,
      requestId,
      headers,
      status,
      statusText,
      expires: Date.now() + ttl,
    });
    // LRU: обновляем порядок
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    if (this.keysOrder.length > this.maxSize) {
      const oldest = this.keysOrder.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }

  get(key: string, ignoreExpiry = false): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (!ignoreExpiry && entry.expires < Date.now()) {
      this.delete(key);
      return undefined;
    }
    // LRU: обновляем порядок
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    return entry;
  }

  delete(key: string) {
    this.cache.delete(key);
    this.keysOrder = this.keysOrder.filter(k => k !== key);
  }

  clear() {
    this.cache.clear();
    this.keysOrder = [];
  }
}

// ============================================================================
// Основная функция createSafeFetch
// ============================================================================
function createSafeFetch(defaults: Partial<FetchOptions> = {}): SafeFetch {
  const globalHooks = {
    onRequest: [] as RequestHook[],
    onResponse: [] as ResponseHook[],
    onError: [] as ErrorHook[],
  };

  const memoryCache = new MemoryCache(defaults.maxCacheSize ?? 50);
  const pending = new Map<string, Promise<any>>();

  const mergeHooks = (localHooks?: FetchOptions['hooks']) => ({
    onRequest: [...globalHooks.onRequest, ...(localHooks?.onRequest || [])],
    onResponse: [...globalHooks.onResponse, ...(localHooks?.onResponse || [])],
    onError: [...globalHooks.onError, ...(localHooks?.onError || [])],
  });

  const core = async <T = any>(url: string, options: FetchOptions = {}): Promise<T | FetchResult<T>> => {
    const finalOptions: FetchOptions = { ...defaults, ...options };
    const {
      baseUrl, timeout, signal: externalSignal, retry = 0, retryDelay = 1000,
      retryOn = (err: Error, res?: Response, method?: string) => {
        if (err.name === 'AbortError') return false;
        const status = (err as any).status;
        const isSafe = method === 'GET' || method === 'HEAD';
        return isSafe && (!status || status >= 500);
      },
      validateStatus = (status: number) => status >= 200 && status < 300,
      parse, query, raw: isRaw, cache, cacheTTL = 5 * 60 * 1000,
      maxCacheSize, dedupe = true, force = false, staleWhileRevalidate = false,
      requestId, onUploadProgress, onDownloadProgress, returnMeta = false,
      hooks: localHooks,
      ...init
    } = finalOptions;

    const method = (init.method || 'GET').toUpperCase();
    const isSafeMethod = method === 'GET' || method === 'HEAD';
    const shouldDedupe = dedupe && isSafeMethod && !force; // при force не используем pending

    // Формируем URL с query
    let requestUrl = baseUrl ? new URL(url, baseUrl).href : url;
    if (query && Object.keys(query).length) {
      const urlObj = new URL(requestUrl);
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) urlObj.searchParams.set(k, String(v));
      });
      requestUrl = urlObj.toString();
    }

    const finalRequestId = typeof requestId === 'function' ? requestId() : (requestId || generateRequestId());
    const cacheKey = buildKey(requestUrl, method, init.body, query);

    // Dev warnings
    if (process.env.NODE_ENV === 'development') {
      if (method === 'GET' && init.body) {
        console.warn('[safeFetch] GET request with body is discouraged');
      }
      if (!isSafeMethod && retry > 0 && retryOn === (defaults.retryOn || retryOn)) {
        console.warn(`[safeFetch] Retry on ${method} may cause duplicate side effects. Override retryOn to disable.`);
      }
      if (cache === 'memory' && !isSafeMethod) {
        console.warn('[safeFetch] Caching non-GET/HEAD request may lead to stale data');
      }
    }

    // --- Stale-while-revalidate: возвращаем stale данные, если есть ---
    if (staleWhileRevalidate && isSafeMethod && !force) {
      const staleEntry = memoryCache.get(cacheKey, true); // ignore expiry
      if (staleEntry !== undefined) {
        // Запускаем фоновое обновление, но с дедупликацией
        if (!pending.has(cacheKey)) {
          const refreshPromise = (async () => {
            try {
              const result = await core(url, { ...options, force: true });
              // результат уже сохранён в кэше внутри core
            } catch { /* игнорируем ошибки фона */ }
          })();
          pending.set(cacheKey, refreshPromise);
          refreshPromise.finally(() => pending.delete(cacheKey));
        }
        // Возвращаем stale данные
        if (returnMeta) {
          return {
            data: staleEntry.data,
            requestId: staleEntry.requestId,
            headers: staleEntry.headers,
            status: staleEntry.status,
            statusText: staleEntry.statusText,
          } as FetchResult<T>;
        }
        return staleEntry.data as T;
      }
    }

    // --- Кэш (не stale) ---
    if (!force && cache === 'memory' && isSafeMethod) {
      const cached = memoryCache.get(cacheKey);
      if (cached !== undefined) {
        if (returnMeta) {
          return {
            data: cached.data,
            requestId: cached.requestId,
            headers: cached.headers,
            status: cached.status,
            statusText: cached.statusText,
          } as FetchResult<T>;
        }
        return cached.data as T;
      }
    }

    // --- Дедупликация (только для safe методов и не force) ---
    if (shouldDedupe) {
      const pendingPromise = pending.get(cacheKey);
      if (pendingPromise) {
        return pendingPromise as Promise<T | FetchResult<T>>;
      }
    }

    // Функция выполнения запроса (без retry)
    const executeRequest = async (): Promise<{ data: T; headers: Headers; status: number; statusText: string }> => {
      const useXHR = (!!onUploadProgress || !!onDownloadProgress) && typeof XMLHttpRequest !== 'undefined';
      if (useXHR) {
        const result = await xhrRequest<T>(
          requestUrl,
          method,
          { ...finalOptions, headers: finalOptions.headers, timeout, parse },
          finalRequestId,
          onDownloadProgress,
          onUploadProgress,
        );
        return result;
      }

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const signals = [externalSignal, controller.signal];
      const combinedSignal = combineSignals(...signals);
      let cleanupSignal: (() => void) | undefined = (combinedSignal as any)?.cleanup;
      if (timeout) {
        timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeout);
      }

      let headers = new Headers(init.headers);
      headers.set('X-Request-Id', finalRequestId);
      let body = init.body;
      if (body !== undefined && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
        body = JSON.stringify(body);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      }

      const requestInit: RequestInit = {
        ...init,
        headers,
        body,
        signal: combinedSignal,
      };
      // Очистка лишних полей
      delete (requestInit as any).retry;
      delete (requestInit as any).retryDelay;
      delete (requestInit as any).retryOn;
      delete (requestInit as any).validateStatus;
      delete (requestInit as any).parse;
      delete (requestInit as any).query;
      delete (requestInit as any).raw;
      delete (requestInit as any).cache;
      delete (requestInit as any).cacheTTL;
      delete (requestInit as any).maxCacheSize;
      delete (requestInit as any).dedupe;
      delete (requestInit as any).force;
      delete (requestInit as any).staleWhileRevalidate;
      delete (requestInit as any).requestId;
      delete (requestInit as any).onUploadProgress;
      delete (requestInit as any).onDownloadProgress;
      delete (requestInit as any).returnMeta;
      delete (requestInit as any).hooks;

      let request = new Request(requestUrl, requestInit);

      const allRequestHooks = mergeHooks(localHooks).onRequest;
      for (const hook of allRequestHooks) {
        request = await hook(request, requestInit);
      }

      let response: Response;
      try {
        response = await fetch(request);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        cleanupSignal?.();
        const error = err as Error;
        // Унифицируем ошибку таймаута
        if (error.message === 'Request timeout') error.name = 'AbortError';
        const allErrorHooks = mergeHooks(localHooks).onError;
        let finalError = error;
        for (const hook of allErrorHooks) {
          try {
            await hook(finalError, request, undefined);
          } catch (hookError) {
            finalError = hookError as Error;
          }
        }
        throw finalError;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        cleanupSignal?.();
      }

      if (isRaw) {
        return { data: response as any, headers: response.headers, status: response.status, statusText: response.statusText };
      }

      const statusValid = validateStatus(response.status);
      if (!statusValid) {
        const cloned = response.clone();
        const errorBody = await cloned.text();
        const httpError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        (httpError as any).status = response.status;
        (httpError as any).statusText = response.statusText;
        (httpError as any).response = response;
        (httpError as any).body = errorBody;
        const allErrorHooks = mergeHooks(localHooks).onError;
        let finalError = httpError;
        for (const hook of allErrorHooks) {
          try {
            await hook(finalError, request, response);
          } catch (hookError) {
            finalError = hookError as Error;
          }
        }
        throw finalError;
      }

      const data = await parseBody(response, parse);
      const allResponseHooks = mergeHooks(localHooks).onResponse;
      let finalData = data;
      for (const hook of allResponseHooks) {
        finalData = await hook(response, finalData);
      }

      return { data: finalData, headers: response.headers, status: response.status, statusText: response.statusText };
    };

    // Обёртка с retry
    const executeWithRetry = async (attempt = 1): Promise<{ data: T; headers: Headers; status: number; statusText: string }> => {
      try {
        const result = await executeRequest();
        // Сохраняем в кэш, если нужно
        if (cache === 'memory' && isSafeMethod && !isRaw) {
          memoryCache.set(cacheKey, result.data, finalRequestId, result.headers, result.status, result.statusText, cacheTTL);
        }
        return result;
      } catch (error) {
        if (attempt <= retry && retryOn(error as Error, (error as any).response, method)) {
          const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
          await new Promise(resolve => setTimeout(resolve, delay));
          return executeWithRetry(attempt + 1);
        }
        throw error;
      }
    };

    let promise: Promise<{ data: T; headers: Headers; status: number; statusText: string }>;
    try {
      promise = executeWithRetry();
      if (shouldDedupe) pending.set(cacheKey, promise);
      const result = await promise;
      if (returnMeta) {
        return {
          data: result.data,
          requestId: finalRequestId,
          headers: result.headers,
          status: result.status,
          statusText: result.statusText,
        } as FetchResult<T>;
      }
      return result.data as T;
    } finally {
      if (shouldDedupe) pending.delete(cacheKey);
    }
  };

  const raw = (url: string, options?: Omit<FetchOptions, 'raw'>): Promise<Response> => {
    return core<Response>(url, { ...options, raw: true, returnMeta: false }) as Promise<Response>;
  };

  const safeFetch = core as SafeFetch;
  safeFetch.get = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    core<T>(url, { ...options, method: 'GET' });
  safeFetch.post = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    core<T>(url, { ...options, method: 'POST', body });
  safeFetch.put = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    core<T>(url, { ...options, method: 'PUT', body });
  safeFetch.patch = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    core<T>(url, { ...options, method: 'PATCH', body });
  safeFetch.del = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    core<T>(url, { ...options, method: 'DELETE' });
  safeFetch.raw = raw;
  safeFetch.addGlobalHooks = (hooks) => {
    if (hooks.onRequest) globalHooks.onRequest.push(...hooks.onRequest);
    if (hooks.onResponse) globalHooks.onResponse.push(...hooks.onResponse);
    if (hooks.onError) globalHooks.onError.push(...hooks.onError);
  };

  return safeFetch;
}

// ============================================================================
// Экспорт экземпляра по умолчанию
// ============================================================================
export const safeFetch = createSafeFetch({
  credentials: 'same-origin',
  timeout: 10000,
  retry: 2,
  retryDelay: 1000,
  retryOn: (error, response, method) => {
    if (error.name === 'AbortError') return false;
    const status = (error as any).status;
    const isSafe = method === 'GET' || method === 'HEAD';
    return isSafe && (!status || status >= 500);
  },
  validateStatus: (status) => status >= 200 && status < 300,
  parse: 'auto',
  cache: 'no-cache',
  dedupe: true,
  maxCacheSize: 50,
});

export default safeFetch;