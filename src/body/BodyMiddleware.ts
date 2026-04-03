import type { Middleware } from '../types';

export function bodyMiddleware(): Middleware {
  return async (ctx, next) => {
    const { body, method, headers: initHeaders } = ctx.options;
    if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
        ctx.options.body = JSON.stringify(body);
        const headers = new Headers(initHeaders);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        ctx.options.headers = headers;
      }
    }
    await next();
  };
}