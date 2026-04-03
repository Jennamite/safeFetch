import type { Middleware, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';

export function responseMiddleware(): Middleware {
  return async (ctx, next) => {
    await next();

    console.log('responseMiddleware: ctx.response.status', ctx.response?.status);
    console.log('responseMiddleware: ctx.data before parse', ctx.data);

    if (ctx.error) return;

    const {
      parse = 'auto',
      validateStatus = (s: number) => s >= 200 && s < 300,
      raw = false,
      returnMeta = false
    } = ctx.options;

    if (raw) return;

    if (!ctx.response) {
      throw new SafeFetchError('No response received');
    }

    const response = ctx.response;
    const signal = ctx.controller?.signal;

    // ✅ helper
    const throwIfAborted = () => {
      if (signal?.aborted) {
throw new SafeFetchError('Request aborted', {
  isAbort: true,
  ...(ctx.request ? { request: ctx.request } : {}),
});
      }
    };

    // ✅ FIX #1 — перед любыми async действиями
    throwIfAborted();

    if (!validateStatus(response.status)) {
      let errorBody: any;

      try {
        const cloned = response.clone();
        errorBody = await cloned.text();
      } catch {
        errorBody = 'Unable to read error body';
      }

      throwIfAborted(); // ✅ FIX

      const errorOptions: {
        status?: number;
        statusText?: string;
        response?: Response;
        body?: any;
        request?: Request;
        isAbort?: boolean;
      } = {
        status: response.status,
        statusText: response.statusText,
        response,
        body: errorBody,
      };

      Object.keys(errorOptions).forEach(key => {
        if (errorOptions[key as keyof typeof errorOptions] === undefined) {
          delete errorOptions[key as keyof typeof errorOptions];
        }
      });

      throw new SafeFetchError(`HTTP ${response.status}: ${response.statusText}`, errorOptions);
    }

    if (ctx.data === undefined) {
      try {
        throwIfAborted(); // ✅ FIX перед parse

        ctx.data = await parseBody(response, parse);

        throwIfAborted(); // ✅ FIX после parse
      } catch (err: any) {
        // ✅ если во время парсинга произошёл abort
        if (signal?.aborted) {
throw new SafeFetchError('Request aborted', {
  isAbort: true,
  ...(ctx.request ? { request: ctx.request } : {}),
});
        }
        throw err;
      }
    }

    if (returnMeta && ctx.data !== undefined) {
      ctx.data = {
        data: ctx.data,
        requestId: ctx.metadata.requestId,
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      };
    }
  };
}

async function parseBody(response: Response, parse: FetchOptions['parse']): Promise<any> {
  if (parse === 'json') return await response.json();
  if (parse === 'text') return await response.text();
  if (parse === 'blob') return await response.blob();
  if (parse === 'arrayBuffer') return await response.arrayBuffer();
  if (typeof parse === 'function') return await parse(response);

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }

  if (contentType.includes('text/')) return await response.text();

  if (
    contentType.includes('application/octet-stream') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  ) {
    return await response.blob();
  }

  const text = await response.text();

  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}