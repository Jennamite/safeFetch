import type { Middleware } from '../types';
import type { SafeFetch } from '../core/SafeFetch';

export function pollingMiddleware(instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    // Берем pollInterval с учетом дефолтных настроек инстанса
    const pollInterval = ctx.options.pollInterval ?? instance.defaults.pollInterval;

    if (!pollInterval) {
      await next();
      return;
    }

    // Выполняем самый первый (базовый) запрос
    await next();

    // Если первый запрос упал с ошибкой, полинг не запускаем
    if (ctx.error) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (ctx.controller.signal.aborted) return;

      try {
        // 🔥 ИСПРАВЛЕНИЕ: Вырезаем pollInterval через деструктуризацию.
        // Переменная _poll содержит старое значение, а в optionsWithoutPoll
        // свойства pollInterval вообще не будет (оно не будет равно undefined, его там просто нет).
        // Это идеально подходит под правило exactOptionalPropertyTypes.
        const { pollInterval: _poll, ...optionsWithoutPoll } = ctx.options;

        // Передаем маркер обхода глобальных настроек
        if (instance.defaults.pollInterval) {
          (optionsWithoutPoll as any)._skipGlobalPoll = true;
        }

        const result = await instance.request(ctx.url, optionsWithoutPoll);

        // Обновляем данные в текущем контексте
        ctx.data = result;
      } catch {
        /* Игнорируем фоновые ошибки сети */
      } finally {
        if (!ctx.controller.signal.aborted) {
          timeoutId = setTimeout(poll, pollInterval);
        }
      }
    };

    const onAbort = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    ctx.controller.signal.addEventListener('abort', onAbort, { once: true });

    // Запускаем первый фоновый интервал полинга
    timeoutId = setTimeout(poll, pollInterval);
  };
}
