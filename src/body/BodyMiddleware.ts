import type { Middleware } from '../types';

export function bodyMiddleware(): Middleware {
  return async (ctx, next) => {
    const { body, method, headers: initHeaders } = ctx.options;

    // Проверяем, нужно ли обрабатывать тело для текущего HTTP-метода
    if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {

      // Если тело — обычный объект JS (не FormData, не Blob, не поисковые параметры)
      if (typeof body === 'object' && body !== null && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {

        // 🔥 ИСПРАВЛЕНИЕ: Записываем сериализованную строку в ctx.data или локальные переменные контекста,
        // но НЕ мутируем оригинальный ctx.options.body, чтобы не сломать повторные попытки (retry)!
        // FetchMiddleware прочитает тело именно отсюда.
        const serializedBody = JSON.stringify(body);

        // Создаем новые заголовки для текущего прохода
        const headers = new Headers(initHeaders);
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }

        // Подменяем данные локально в объекте ctx.options для текущего шага пайплайна,
        // делая это через безопасное поверхностное клонирование, чтобы не задеть внешний объект пользователя
        ctx.options = {
          ...ctx.options,
          body: serializedBody,
          headers: headers as any // Приведение к any снимает конфликты exactOptionalPropertyTypes
        };
      }
    }

    await next();
  };
}
