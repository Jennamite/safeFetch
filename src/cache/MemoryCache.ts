import type { CacheEntrySerialized } from '../types';

export interface CacheEntry {
  data: any;
  requestId: string;
  headers: Headers;
  status: number;
  statusText: string;
  expires: number;
  tags: string[];
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
    const fullEntry: CacheEntry = { ...entry, expires };
    this.cache.set(key, fullEntry);
    this.keysOrder = this.keysOrder.filter(k => k !== key);
    this.keysOrder.push(key);
    this.enforceMaxSize();
    this.emit('set', key, fullEntry);
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
    for (const [key, entry] of this.cache.entries()) {
      if (entry.tags.some(t => tags.includes(t))) this.delete(key);
    }
  }

  invalidateByPattern(pattern: string | RegExp | ((key: string) => boolean), method?: string) {
    for (const [key] of this.cache.entries()) {
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
      this.cache.set(key, { ...entry, headers });
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
      if (oldest) this.cache.delete(oldest);
    }
  }

  private emit(event: string, key: string, entry?: CacheEntry) {
    this.listeners.get(event)?.forEach(fn => fn(key, entry));
  }
}