import type { Middleware } from '../types';

export const queryMiddleware: Middleware = async (ctx, next) => {
  const { query, baseUrl } = ctx.options;
  let url = ctx.url;

  // Добавляем baseUrl, если указан
  if (baseUrl) {
    try {
      url = new URL(url, baseUrl).href;
    } catch {
      // Если URL некорректный, оставляем как есть (позже fetch выбросит ошибку)
    }
  }

  // Добавляем query параметры
  if (query && Object.keys(query).length) {
    try {
      const urlObj = new URL(url);
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          urlObj.searchParams.set(k, String(v));
        }
      });
      ctx.url = urlObj.toString();
    } catch {
      // Если URL не может быть разобран, пропускаем добавление query
      // (например, относительный URL в окружении без baseUrl)
      ctx.url = url;
    }
  } else {
    ctx.url = url;
  }

  await next();
};