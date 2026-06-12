import type { CacheEntrySerialized, FetchOptions } from '../types';

interface CacheEntry {
  data: any;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
  expires: number;
  tags: string[];
  originalUrl: string;
  originalOptions: FetchOptions;
}

export class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private keysOrder: string[] = [];
  private maxSize: number;
  private listeners = new Map<string, Set<(key: string, entry?: CacheEntry) => void>>();

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  setMaxSize(maxSize: number) {
    this.maxSize = maxSize;
    this.enforceMaxSize();
  }

  set(key: string, entry: Omit<CacheEntry, 'expires'> & { ttl: number }) {
    const expires = Date.now() + entry.ttl;
    const fullEntry: CacheEntry = {
      data: entry.data,
      requestId: entry.requestId,
      headers: entry.headers,
      status: entry.status,
      statusText: entry.statusText,
      expires,
      tags: entry.tags,
      originalUrl: entry.originalUrl,
      originalOptions: entry.originalOptions,
    };

    // 🔥 ИСПРАВЛЕНИЕ: Реально сохраняем данные в Map!
    this.cache.set(key, fullEntry);

    // Обновляем порядок ключей для алгоритма LRU (выталкивание старых данных)
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);

    // 🔥 ИСПРАВЛЕНИЕ: Контролируем лимит размера при каждой записи
    this.enforceMaxSize();

    // Оповещаем подписчиков
    this.emit('set', key, fullEntry);
  }

  get(key: string, ignoreExpiry = false): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (!ignoreExpiry && entry.expires < Date.now()) {
      this.delete(key);
      return undefined;
    }

    // Элемент обновился по частоте использования, двигаем в конец очереди
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    return entry;
  }

  delete(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return; // Защита от холостых вызовов

    this.cache.delete(key);
    this.keysOrder = this.keysOrder.filter(k => k !== key);

    this.emit('delete', key, entry);
    this.emit('invalidate', key, entry);
  }

  invalidateByTags(tags: string[]) {
    // Делаем копию ключей перед итерацией, чтобы избежать багов изменения Map во время цикла
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry && entry.tags.some(t => tags.includes(t))) {
        this.delete(key);
      }
    }
  }

  invalidateByPattern(pattern: string | RegExp | ((key: string) => boolean), method?: string) {
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      let match = false;
      if (typeof pattern === 'function') match = pattern(key);
      else if (pattern instanceof RegExp) match = pattern.test(key);
      else match = key.includes(pattern);

      if (method && !key.startsWith(`${method.toUpperCase()}:`)) match = false;
      if (match) this.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.keysOrder = [];
    this.emit('invalidate', '*', undefined);
  }

  forEach(callback: (key: string, entry: CacheEntry) => void) {
    this.cache.forEach((entry, key) => callback(key, entry));
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
        originalUrl: entry.originalUrl,
        originalOptions: entry.originalOptions,
      };
    }
    return result;
  }

  hydrate(data: Record<string, CacheEntrySerialized>) {
    const entries = Object.entries(data).sort((a, b) => a[1].expires - b[1].expires).slice(-this.maxSize);
    this.cache.clear();
    this.keysOrder = [];
    for (const [key, entry] of entries) {
      const headers = new Headers(entry.headers);
      this.cache.set(key, {
        data: entry.data,
        requestId: entry.requestId,
        headers,
        status: entry.status,
        statusText: entry.statusText,
        expires: entry.expires,
        tags: entry.tags,
        originalUrl: entry.originalUrl,
        originalOptions: entry.originalOptions,
      });
      this.keysOrder.push(key);
    }
  }

  on(event: 'set' | 'delete' | 'invalidate', listener: (key: string, entry?: CacheEntry) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private enforceMaxSize() {
    while (this.keysOrder.length > this.maxSize) {
      const oldest = this.keysOrder.shift();
      if (oldest) {
        // Вызываем напрямую cache.delete, чтобы избежать лишней фильтрации массива keysOrder внутри this.delete
        const entry = this.cache.get(oldest);
        this.cache.delete(oldest);
        this.emit('delete', oldest, entry);
        this.emit('invalidate', oldest, entry);
      }
    }
  }

  private emit(event: string, key: string, entry?: CacheEntry) {
    this.listeners.get(event)?.forEach(fn => fn(key, entry));
  }

  getEntry(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }
}
