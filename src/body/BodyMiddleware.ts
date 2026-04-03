import type { Middleware } from '../types';

export const bodyMiddleware: Middleware = async (ctx, next) => {
  const { body, method, headers: initHeaders } = ctx.options;

  // Если тело — это объект, не являющийся FormData, Blob, URLSearchParams или потоком,
  // сериализуем в JSON и устанавливаем заголовок Content-Type, если он ещё не задан.
  if (body !== undefined && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
    // Проверяем, не является ли тело уже строкой (для совместимости)
    if (typeof body !== 'string') {
      ctx.options.body = JSON.stringify(body);
      const headers = new Headers(initHeaders);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      ctx.options.headers = headers;
    }
  }

  await next();
};