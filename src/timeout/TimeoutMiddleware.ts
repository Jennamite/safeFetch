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
    let timeoutId = setTimeout(() => {
      console.log('⏱️ timeout triggered');
      if (!ctx.controller.signal.aborted) ctx.controller.abort();
    }, timeout);
    try {
      await next();
    } catch (err) {
      console.log('⏱️ timeoutMiddleware caught', err);
      if ((err as Error).name === 'AbortError') {
        throw new SafeFetchError('Request timeout', { isAbort: true });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}