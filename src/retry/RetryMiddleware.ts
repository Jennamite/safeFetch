import type { Middleware } from '../types';
import { SafeFetchError } from '../errors';
import { isSafeMethod } from '../utils/helpers';

export function retryMiddleware(): Middleware {
  return async (ctx, next) => {
    const retry = ctx.options.retry ?? 0;
    const retryDelay = ctx.options.retryDelay ?? ((attempt: number) => Math.min(1000 * Math.pow(2, attempt - 1), 30000));
    const retryOn = ctx.options.retryOn ?? ((err: SafeFetchError) => {
      if (err.isAbort) return false;
      const status = err.status;
      // Повторяем только для безопасных методов и при ошибках сервера (5xx) или отсутствии статуса
      return isSafeMethod(ctx.options.method) && (!status || status >= 500);
    });

    let attempt = 0;
    while (true) {
      try {
        await next();
        return;
      } catch (err) {
        if (!(err instanceof SafeFetchError)) throw err;
        if (attempt >= retry) throw err;
        if (!retryOn(err)) throw err;

        attempt++;
        ctx.metadata.retryCount = attempt;

        // Если запрос уже отменён, не ждём
        if (ctx.controller.signal.aborted) {
          throw new SafeFetchError('Request cancelled', { isAbort: true });
        }

        const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new SafeFetchError('Retry cancelled', { isAbort: true }));
          };
          ctx.controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    }
  };
}