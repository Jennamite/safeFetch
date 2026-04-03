import type { Middleware } from '../types';

export function queryMiddleware(): Middleware {
  return async (ctx, next) => {
    const { query, baseUrl } = ctx.options;
    let url = ctx.url;

    if (baseUrl) {
      const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const normalizedPath = url.startsWith('/') ? url : `/${url}`;
      url = `${normalizedBase}${normalizedPath}`;
    }

    if (query && Object.keys(query).length) {
      try {
        const urlObj = new URL(url);
        Object.entries(query).forEach(([k, v]) => {
          if (v !== undefined && v !== null) urlObj.searchParams.set(k, String(v));
        });
        ctx.url = urlObj.toString();
      } catch {
        ctx.url = url;
      }
    } else {
      ctx.url = url;
    }
    await next();
  };
}