import type { Middleware, RequestContext } from '../types';
import type { SafeFetch } from '../core/SafeFetch';
import { MemoryCache } from './MemoryCache';
import { buildCacheKey } from '../utils/keyBuilder';
import { isSafeMethod } from '../utils/helpers';

export function cacheMiddleware(cache: MemoryCache, instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    const {
      method,
      cache: cacheMode,
      cacheTTL = 5 * 60 * 1000,
      force = false,
      staleWhileRevalidate = false,
      query,
      body,
      tags = [],
      includeHeaders: requestIncludeHeaders,
    } = ctx.options;

    if (!isSafeMethod(method) || cacheMode !== 'memory') {
      await next();
      return;
    }

    const includeHeaders = requestIncludeHeaders ?? instance.defaults.includeHeaders;

    const key = buildCacheKey({
      url: ctx.url,
      method: method!,
      query,
      body,
      headers: ctx.options.headers,
      includeHeaders,
    });

    // SWR: проверяем наличие устаревшего кэша
    if (staleWhileRevalidate && !force) {
      const staleEntry = cache.get(key, true);
      if (staleEntry) {
        const refreshKey = `refresh:${key}`;
        if (!instance.refreshPending.has(refreshKey)) {
          // Клонируем опции, удаляя pollInterval и staleWhileRevalidate
          const { pollInterval, ...refreshOptions } = ctx.options;

          // Создаём отдельный контроллер для фонового запроса, связанный с сигналом исходного
          const refreshController = new AbortController();
          // Если исходный запрос будет отменён, отменяем и фоновый
          const onAbort = () => refreshController.abort(ctx.controller.signal.reason);
          ctx.controller.signal.addEventListener('abort', onAbort, { once: true });

          const refreshPromise = (async () => {
            try {
              await instance.request(ctx.url, {
                ...refreshOptions,
                force: true,
                staleWhileRevalidate: false,
                signal: refreshController.signal,
              });
            } catch {
              // ignore background errors
            } finally {
              instance.refreshPending.delete(refreshKey);
              ctx.controller.signal.removeEventListener('abort', onAbort);
            }
          })();
          instance.refreshPending.set(refreshKey, refreshPromise);
        }

        // Возвращаем устаревшие данные
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

    // Обычное чтение кэша
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

    // Нет кэша или force: выполняем запрос
    await next();

    // Сохраняем успешный ответ в кэш
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