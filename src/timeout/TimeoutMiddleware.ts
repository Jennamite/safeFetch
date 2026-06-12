import type { Middleware } from '../types';
import { SafeFetchError } from '../errors';

export function timeoutMiddleware(): Middleware {
  return async (ctx, next) => {
    const timeout = ctx.options.timeout;
    if (!timeout) {
      await next();
      return;
    }

    console.log('⏱️ timeoutMiddleware: set timeout', timeout);

    // Создаем уникальный маркер (символ), чтобы однозначно идентифицировать сработку НАШЕГО таймера
    const timeoutMarker = Symbol('TimeoutTriggered');
    let isTimeoutTriggered = false;

    const timeoutId = setTimeout(() => {
      console.log('⏱️ timeout triggered');
      if (!ctx.controller.signal.aborted) {
        isTimeoutTriggered = true;
        // Передаем маркер в качестве причины отмены
        ctx.controller.abort(timeoutMarker);
      }
    }, timeout);

    try {
      await next();
    } catch (err) {
      console.log('⏱️ timeoutMiddleware caught', err);

      const error = err as any;

      // 🔥 ИСПРАВЛЕНИЕ: Перехватываем таймаут ТОЛЬКО если сработал наш таймер
      // Либо по выставленному флагу, либо по маркеру причины в сигнале
      const isOurTimeout = isTimeoutTriggered ||
        ctx.controller.signal.reason === timeoutMarker ||
        error?.reason === timeoutMarker;

      if (isOurTimeout) {
        const timeoutError = new SafeFetchError('Request timeout', {
          isAbort: true, // Таймаут технически является отменой операции
          request: ctx.request
        });

        // Фиксируем ошибку таймаута в контексте
        ctx.error = timeoutError;
        throw timeoutError;
      }

      // Если это был обычный AbortError (ручная отмена), просто пробрасываем его дальше не трогая
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
