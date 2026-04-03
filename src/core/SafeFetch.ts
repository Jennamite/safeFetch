import { Pipeline } from './Pipeline';
import { RequestContextImpl } from './Context';
import type {
  SafeFetchInstance,
  FetchOptions,
  FetchResult,
  Middleware,
  Plugin,
  OnRequestHook,
  OnResponseHook,
  OnErrorHook,
  TelemetryEvent,
} from '../types';
import { SafeFetchError } from '../errors';
import { MemoryCache } from '../cache/MemoryCache';
import { DedupeManager } from '../dedupe/DedupeManager';
import { ConcurrencyController } from '../concurrency/ConcurrencyController';
import { BatchProcessor } from '../batch/BatchProcessor';
import { Telemetry } from '../telemetry/Telemetry';
import { HooksManager } from '../hooks/HooksManager';
import { defaultMiddleware } from './defaultMiddleware';

export class SafeFetch {
  private pipeline: Pipeline;
  private defaults: Partial<FetchOptions>;
  private hooksManager: HooksManager;
  private _instance: SafeFetchInstance;

  public cache: MemoryCache;
  public dedupeManager: DedupeManager;
  public concurrencyController: ConcurrencyController;
  public batchProcessor: BatchProcessor;
  public telemetry: Telemetry;

  constructor(defaults: Partial<FetchOptions> = {}) {
    this.defaults = { ...defaults };
    this.cache = new MemoryCache(this.defaults.maxCacheSize ?? 50);
    this.dedupeManager = new DedupeManager();
    this.concurrencyController = new ConcurrencyController();
    this.batchProcessor = new BatchProcessor(this.defaults.batchMaxWaitMs);
    this.telemetry = new Telemetry();
    this.hooksManager = new HooksManager();

    this.pipeline = new Pipeline();
    this.pipeline.use(...defaultMiddleware(this));
    this.pipeline.use(...this.hooksManager.createMiddleware());

    // Создаём callable обёртку
    const fetcher = (url: string, options?: FetchOptions) => this.request(url, options);
    Object.assign(fetcher, {
      get: this.get.bind(this),
      post: this.post.bind(this),
      put: this.put.bind(this),
      patch: this.patch.bind(this),
      del: this.del.bind(this),
      raw: this.raw.bind(this),
      use: this.use.bind(this),
      prepend: this.prepend.bind(this),
      plugin: this.plugin.bind(this),
      setDefaults: this.setDefaults.bind(this),
      onRequest: this.onRequest.bind(this),
      onResponse: this.onResponse.bind(this),
      onError: this.onError.bind(this),
      invalidate: this.invalidate.bind(this),
      revalidate: this.revalidate.bind(this),
      onCacheEvent: this.onCacheEvent.bind(this),
      onTelemetry: this.onTelemetry.bind(this),
      hydrateCache: this.hydrateCache.bind(this),
      serializeCache: this.serializeCache.bind(this),
      createClient: this.createClient.bind(this),
    });
    this._instance = fetcher as SafeFetchInstance;
  }

  async request<T = any>(url: string, options: FetchOptions = {}): Promise<T | FetchResult<T>> {
    const mergedOptions = this.mergeOptions(this.defaults, options);
    const ctx = new RequestContextImpl(url, mergedOptions);

    try {
      await this.pipeline.run(ctx);
      if (ctx.error) throw ctx.error;
      return ctx.data as T;
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      throw new SafeFetchError((err as Error).message);
    }
  }

  use(...middlewares: Middleware[]): SafeFetchInstance {
    this.pipeline.use(...middlewares);
    return this._instance;
  }

  prepend(...middlewares: Middleware[]): SafeFetchInstance {
    this.pipeline.prepend(...middlewares);
    return this._instance;
  }

  plugin<T>(plugin: Plugin<T>, options?: T): SafeFetchInstance {
    plugin.setup(this._instance, options);
    return this._instance;
  }

  setDefaults(defaults: Partial<FetchOptions>): SafeFetchInstance {
    this.defaults = { ...this.defaults, ...defaults };
    if (defaults.maxCacheSize !== undefined) {
      this.cache.setMaxSize(defaults.maxCacheSize);
    }
    return this._instance;
  }

  get = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    this.request<T>(url, { ...options, method: 'GET' });

  post = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    this.request<T>(url, { ...options, method: 'POST', body });

  put = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    this.request<T>(url, { ...options, method: 'PUT', body });

  patch = <T>(url: string, body?: any, options?: Omit<FetchOptions, 'method'>) =>
    this.request<T>(url, { ...options, method: 'PATCH', body });

  del = <T>(url: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    this.request<T>(url, { ...options, method: 'DELETE' });

  raw = (url: string, options?: Omit<FetchOptions, 'raw'>): Promise<Response> =>
    this.request<Response>(url, { ...options, raw: true, returnMeta: false }) as Promise<Response>;

  onRequest = (hook: OnRequestHook) => this.hooksManager.addRequestHook(hook);
  onResponse = (hook: OnResponseHook) => this.hooksManager.addResponseHook(hook);
  onError = (hook: OnErrorHook) => this.hooksManager.addErrorHook(hook);

  invalidate = (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => {
    const { tags, method } = options || {};
    if (tags && tags.length) {
      this.cache.invalidateByTags(tags);
    } else if (pattern !== undefined) {
      this.cache.invalidateByPattern(pattern, method);
    } else {
      this.cache.clear();
    }
  };

  revalidate = async (pattern?: string | RegExp | ((key: string) => boolean), options?: { tags?: string[]; method?: string }) => {
    const keysToRevalidate: string[] = [];
    const { tags, method } = options || {};

    if (tags && tags.length) {
      this.cache.forEach((key, entry) => {
        if (entry.tags.some(t => tags!.includes(t))) keysToRevalidate.push(key);
      });
    } else if (pattern !== undefined) {
      this.cache.forEach((key) => {
        let match = false;
        if (typeof pattern === 'function') match = pattern(key);
        else if (pattern instanceof RegExp) match = pattern.test(key);
        else match = key.includes(pattern);
        if (method && !key.startsWith(`${method.toUpperCase()}:`)) match = false;
        if (match) keysToRevalidate.push(key);
      });
    } else {
      this.cache.forEach((key) => keysToRevalidate.push(key));
    }

    const promises = keysToRevalidate.map(async (key) => {
      const parts = key.split(':', 2);
      const method = parts[0];
      const url = parts[1];
      if (!url) return;
      const originalUrl = url;
      this.cache.delete(key);
      try {
        await this.request(originalUrl, { method: method as any, force: true });
      } catch {
        // ignore
      }
    });
    await Promise.allSettled(promises);
  };

  onCacheEvent = (event: 'invalidate' | 'set' | 'delete', listener: (key: string, entry?: any) => void) =>
    this.cache.on(event, listener);

  onTelemetry = (listener: (event: TelemetryEvent) => void) => this.telemetry.on(listener);

  hydrateCache = (data: Record<string, any>) => this.cache.hydrate(data);
  serializeCache = () => this.cache.serialize();

  createClient = <T extends Record<string, any>>(baseUrl?: string): T => {
    const client: any = {};
    const buildPath = (path: string) => (baseUrl ? `${baseUrl}${path.startsWith('/') ? path : `/${path}`}` : path);
    const methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    const proxy = new Proxy(client, {
      get: (target, prop: string) => {
        if (target[prop]) return target[prop];
        for (const method of methods) {
          if (prop === method.toLowerCase()) {
            return (path: string, data?: any, opts?: FetchOptions) => {
              const options: FetchOptions = { ...opts, method };
              if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) options.body = data;
              return this.request(buildPath(path), options);
            };
          }
        }
        if (typeof prop === 'string') {
          return new Proxy(() => {}, {
            get: (_, subProp: string) => {
              return (path?: string, data?: any, opts?: FetchOptions) => {
                const fullPath = `/${prop}${path ? `/${path}` : ''}`;
                return this.request(buildPath(fullPath), { ...opts, method: subProp.toUpperCase() as any, body: data });
              };
            },
          });
        }
        return undefined;
      },
    });
    return proxy as T;
  };

  private mergeOptions(defaults: Partial<FetchOptions>, options: FetchOptions): FetchOptions {
    const result: FetchOptions = { ...defaults, ...options };
    if (defaults.headers || options.headers) {
      const defaultHeaders = new Headers(defaults.headers);
      const optsHeaders = new Headers(options.headers);
      const mergedHeaders = new Headers(defaultHeaders);
      optsHeaders.forEach((value, key) => mergedHeaders.set(key, value));
      result.headers = mergedHeaders;
    }
    return result;
  }
}

export function createSafeFetch(defaultOptions: Partial<FetchOptions> = {}): SafeFetchInstance {
  return new SafeFetch(defaultOptions)['_instance'];
}