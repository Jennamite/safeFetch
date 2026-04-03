// cache/CacheMiddleware.ts
import type { Middleware, RequestContext, SafeFetchError } from '../types';
import { MemoryCache } from './MemoryCache';
import { buildCacheKey } from '../utils/keyBuilder';
import { isSafeMethod } from '../utils/helpers';

export function cacheMiddleware(cache: MemoryCache, instance: any): Middleware {
  return async (ctx, next) => {
    const { method, cache: cacheMode, cacheTTL = 5 * 60 * 1000, force = false, staleWhileRevalidate = false, query, body, tags = [], includeHeaders } = ctx.options;

    if (!isSafeMethod(method) || cacheMode !== 'memory') {
      await next();
      return;
    }

    const key = buildCacheKey({
      url: ctx.url,
      method: method!,
      query,
      body,
      headers: ctx.options.headers,
      includeHeaders,
    });

    // Stale-while-revalidate
    if (staleWhileRevalidate && !force) {
      const staleEntry = cache.get(key, true);
      if (staleEntry) {
        const refreshKey = `refresh:${key}`;
        if (!(globalThis as any).__refreshPending?.has(refreshKey)) {
          const refreshPromise = (async () => {
            try {
              await instance.request(ctx.url, {
                ...ctx.options,
                force: true,
                staleWhileRevalidate: false,
              });
            } catch {
              // ignore background errors
            }
          })();
          if (!(globalThis as any).__refreshPending) (globalThis as any).__refreshPending = new Map();
          (globalThis as any).__refreshPending.set(refreshKey, refreshPromise);
          refreshPromise.finally(() => (globalThis as any).__refreshPending.delete(refreshKey));
        }

        ctx.data = staleEntry.data;
        ctx.response = new Response(null, {
          status: staleEntry.status,
          statusText: staleEntry.statusText,
          headers: staleEntry.headers,
        });
        ctx.metadata.cacheHit = true;
        ctx.metadata.stale = true;
        return;
      }
    }

    // Normal cache lookup
    if (!force) {
      const cached = cache.get(key);
      if (cached) {
        ctx.data = cached.data;
        ctx.response = new Response(null, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        });
        ctx.metadata.cacheHit = true;
        return;
      }
    }

    // No cache or force: perform request
    await next();

    // Store response in cache
    if (ctx.data !== undefined && !ctx.error && ctx.response) {
      cache.set(key, {
        data: ctx.data,
        requestId: ctx.metadata.requestId,
        headers: ctx.response.headers,
        status: ctx.response.status,
        statusText: ctx.response.statusText,
        ttl: cacheTTL,
        tags,
      });
    }
  };
}

export function mutationInvalidationMiddleware(cache: MemoryCache): Middleware {
  return async (ctx, next) => {
    await next();
    const { method, tags } = ctx.options;
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isMutation && tags && tags.length) {
      cache.invalidateByTags(tags);
    }
  };
}