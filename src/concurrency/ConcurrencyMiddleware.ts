import type { Middleware, RequestContext } from '../types';
import { ConcurrencyController } from './ConcurrencyController';
import { buildCacheKey } from '../utils/keyBuilder';

export function concurrencyMiddleware(controller: ConcurrencyController): Middleware {
  return async (ctx, next) => {
    const concurrency = ctx.options.concurrency;
    if (!concurrency || concurrency.max === undefined) {
      await next();
      return;
    }

    const max = concurrency.max;
    const key = concurrency.key ?? buildCacheKey({
      url: ctx.url,
      method: ctx.options.method ?? 'GET',
      query: ctx.options.query,
      body: ctx.options.body,
      headers: ctx.options.headers,
      includeHeaders: ctx.options.includeHeaders,
    });

    // Используем сигнал из контекста для возможности прерывания ожидания
    await controller.acquire(key, max, ctx.controller.signal);
    try {
      await next();
    } finally {
      controller.release(key);
    }
  };
}