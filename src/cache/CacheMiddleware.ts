import type { Middleware } from '../types';
import type { SafeFetch } from '../core/SafeFetch';
import { MemoryCache } from './MemoryCache';
import { buildCacheKey } from '../utils/keyBuilder';
import { isSafeMethod } from '../utils/helpers';

export function cacheMiddleware(cache: MemoryCache, instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    // 🔥 ИСПРАВЛЕНИЕ: Учитываем глобальные дефолтные настройки инстанса
    const cacheMode = ctx.options.cache ?? instance.defaults.cache;
    const cacheTTL = ctx.options.cacheTTL ?? instance.defaults.cacheTTL ?? 5 * 60 * 1000;
    const force = ctx.options.force ?? false;
    const staleWhileRevalidate = ctx.options.staleWhileRevalidate ?? false;

    const {
      method,
      query,
      body,
      tags = [],
      includeHeaders: requestIncludeHeaders,
    } = ctx.options;

    // Кэшируем только безопасные методы (GET/HEAD) и только при режиме 'memory'
    if (!isSafeMethod(method) || cacheMode !== 'memory') {
      await next();
      return;
    }

    const includeHeaders = requestIncludeHeaders ?? instance.defaults.includeHeaders;

    // Строим ключ строго на основе сетевых параметров
    const key = buildCacheKey({
      url: ctx.url,
      method: method!,
      query,
      body,
      headers: ctx.options.headers,
      includeHeaders,
    });

    // Хелпер для воссоздания полноценного Response из кэша
    const createCachedResponse = (entry: any) => {
      // 🔥 ИСПРАВЛЕНИЕ: Чтобы не ломать чтение тела, упаковываем данные обратно, если это был JSON/текст
      const responseBody = typeof entry.data === 'object' && entry.data !== null
        ? JSON.stringify(entry.data)
        : String(entry.data ?? '');

      return new Response(responseBody, {
        status: entry.status ?? 200,
        statusText: entry.statusText ?? 'OK',
        headers: entry.headers,
      });
    };

    // SWR: проверяем наличие устаревшего кэша
    if (staleWhileRevalidate && !force) {
      const staleEntry = cache.get(key, true);
      if (staleEntry) {
        const refreshKey = `refresh:${key}`;
        if (!instance.refreshPending.has(refreshKey)) {
          const { pollInterval, ...refreshOptions } = ctx.options;

          const refreshController = new AbortController();
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
              // игнорируем фоновые ошибки
            } finally {
              instance.refreshPending.delete(refreshKey);
              ctx.controller.signal.removeEventListener('abort', onAbort);
            }
          })();
          instance.refreshPending.set(refreshKey, refreshPromise);
        }

        ctx.data = staleEntry.data;
        ctx.response = createCachedResponse(staleEntry);
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
        ctx.response = createCachedResponse(cached);
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
        originalUrl: ctx.url,
        originalOptions: ctx.options,
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
