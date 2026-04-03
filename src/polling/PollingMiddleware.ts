// polling/PollingMiddleware.ts
import type { Middleware } from '../types';
import type { SafeFetch } from '../core/SafeFetch';

export function pollingMiddleware(instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    const { pollInterval } = ctx.options;
    if (!pollInterval) {
      await next();
      return;
    }

    await next();

    // Если запрос был неудачным, не запускаем опрос
    if (ctx.error) return;

    // Функция для выполнения опроса
    const poll = async () => {
      if (ctx.controller.signal.aborted) return;

      try {
        // Создаём копию опций, исключая pollInterval
        const { pollInterval: _, ...optionsWithoutPoll } = ctx.options;
        // Выполняем повторный запрос с теми же опциями, но без pollInterval
        await instance.request(ctx.url, optionsWithoutPoll);
      } catch {
        // Игнорируем ошибки в опросе
      } finally {
        if (!ctx.controller.signal.aborted) {
          setTimeout(poll, pollInterval);
        }
      }
    };

    // Запускаем первый опрос после задержки
    setTimeout(poll, pollInterval);
  };
}