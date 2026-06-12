import type { Middleware } from '../types';

export function queryMiddleware(): Middleware {
  return async (ctx, next) => {
    const { query, baseUrl } = ctx.options;
    let url = ctx.url;

    // 🔥 ИСПРАВЛЕНИЕ: Склеиваем baseUrl только если url — это относительный путь (не начинается с http:// или https://)
    // Это полностью защищает от дублирования строк при повторных попытках (retry)
    if (baseUrl && !/^https?:\/\//i.test(url)) {
      const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const normalizedPath = url.startsWith('/') ? url : `/${url}`;
      url = `${normalizedBase}${normalizedPath}`;
    }

    if (query && Object.keys(query).length) {
      // 🔥 ИСПРАВЛЕНИЕ: Безопасная сборка Query-параметров, которая поддерживает как абсолютные, так и относительные URL.
      // Если URL абсолютный — парсим его стандартно. Если относительный — подставляем фейковый хост-заглушку.
      const isAbsolute = /^https?:\/\//i.test(url);
      const baseForParsing = isAbsolute ? undefined : 'http://localhost-placeholder.local';

      try {
        const urlObj = new URL(url, baseForParsing);

        Object.entries(query).forEach(([k, v]) => {
          if (v !== undefined && v !== null) {
            urlObj.searchParams.set(k, String(v));
          }
        });

        if (isAbsolute) {
          ctx.url = urlObj.toString();
        } else {
          // Если URL был относительным, вырезаем фейковый хост обратно, оставляя чистый путь с параметрами
          ctx.url = urlObj.pathname + urlObj.search;
        }
      } catch {
        // На случай непредвиденных ошибок парсинга оставляем URL как есть
        ctx.url = url;
      }
    } else {
      ctx.url = url;
    }

    await next();
  };
}
