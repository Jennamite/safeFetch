import type { Middleware } from '../types';
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

    // 🔥 ИСПРАВЛЕНИЕ: Безопасное формирование объекта для exactOptionalPropertyTypes
    let key = concurrency.key;

    if (!key) {
      const buildOptions: any = {
        url: ctx.url,
        method: ctx.options.method ?? 'GET',
      };

      if (ctx.options.query !== undefined) buildOptions.query = ctx.options.query;
      if (ctx.options.body !== undefined) buildOptions.body = ctx.options.body;
      if (ctx.options.headers !== undefined) buildOptions.headers = ctx.options.headers;
      if (ctx.options.includeHeaders !== undefined) buildOptions.includeHeaders = ctx.options.includeHeaders;

      key = buildCacheKey(buildOptions);
    }

    let token: any;

    try {
      // Захватываем слот конкурентности и сохраняем уникальный защитный токен
      token = await controller.acquire(key, max, ctx.controller.signal);

      // 🔥 ИСПРАВЛЕНИЕ: Вызываем next() строго один раз в рамках безопасной сессии слота!
      await next();
    } finally {
      // Передаем токен в метод release, чтобы контроллер мог отличить 
      // отмену запроса в очереди от отмены уже активного запроса
      controller.release(key, token);
    }
  };
}
