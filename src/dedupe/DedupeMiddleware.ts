import type { Middleware, RequestContext } from '../types';
import { DedupeManager } from './DedupeManager';
import { buildCacheKey } from '../utils/keyBuilder';
import { isSafeMethod } from '../utils/helpers';
import { SafeFetchError } from '../errors';

export function dedupeMiddleware(manager: DedupeManager): Middleware {
  return async (ctx: RequestContext, next) => {
    const { method, dedupe = true, force = false, query, body, includeHeaders } = ctx.options;

    if (!isSafeMethod(method) || !dedupe || force) {
      await next();
      return;
    }

    // 🔥 ИСПРАВЛЕНИЕ: Безопасное формирование объекта для exactOptionalPropertyTypes
    const buildOptions: any = {
      url: ctx.url,
      method: method!,
      includeHeaders,
    };
    if (query !== undefined) buildOptions.query = filterUndefined(query);
    if (body !== undefined) buildOptions.body = body;
    if (ctx.options.headers !== undefined) buildOptions.headers = ctx.options.headers;

    const key = buildCacheKey(buildOptions);

    const existing = manager.get(key);
    if (existing) {
      try {
        // Ожидаем выполнение оригинального запроса
        const result = await existing;
        ctx.data = result.data;
        ctx.response = result.response;
        ctx.metadata.dedupeHit = true;
        return;
      } catch (err) {
        // 🔥 ИСПРАВЛЕНИЕ: Если оригинальный запрос упал, мы бережно перехватываем ошибку,
        // фиксируем её в контексте текущего запроса, чтобы отработали хуки onError, и пробрасываем выше.
        if (err instanceof SafeFetchError || (err && (err as any).name === 'SafeFetchError')) {
          ctx.error = err as any;
        }
        throw err;
      }
    }

    // Создаем промис для дедупликации текущего запроса
    const promise = (async () => {
      await next();
      // Если во время выполнения next() возникла ошибка, промис упадет, что правильно
      return { data: ctx.data, response: ctx.response };
    })();

    manager.set(key, promise);

    try {
      await promise;
    } finally {
      // Гарантированно очищаем менеджер, как только первый запрос завершился (успешно или с ошибкой)
      manager.delete(key);
    }
  };
}

function filterUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}
