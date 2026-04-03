import type { Middleware } from '../types';
import { SafeFetchError } from '../errors';
import { isSafeMethod } from '../utils/helpers';

export function retryMiddleware(): Middleware {
  console.log('🔁 retryMiddleware: factory called');
  return async (ctx, next) => {
    console.log('🔁 retryMiddleware: start for', ctx.url, 'method:', ctx.options.method);
    const retries = ctx.options.retry ?? 0;
    const retryDelay = ctx.options.retryDelay ?? 0;
    let attempt = 0;
    const getDelay = (attempt: number): number => {
      if (typeof retryDelay === 'function') return retryDelay(attempt);
      if (typeof retryDelay === 'number') return retryDelay * Math.pow(2, attempt - 1) + Math.random() * 50;
      return 0;
    };
    while (true) {
      try {
        console.log(`🔁 attempt ${attempt}: calling next`);
        await next();
        console.log(`🔁 attempt ${attempt}: next succeeded`);
        return;
      } catch (err) {
        console.log(`🔁 attempt ${attempt}: caught error`, err);
        if (!(err instanceof SafeFetchError)) throw err;
        console.log(`🔁 err.status=${err.status}, err.isRetryable=${err.isRetryable}, method=${ctx.options.method}`);
        const isRetryable = (err.isRetryable ?? (err.status !== undefined && err.status >= 500)) && isSafeMethod(ctx.options.method);
        console.log(`🔁 isRetryable=${isRetryable}, attempt=${attempt}, retries=${retries}`);
        if (!isRetryable || attempt >= retries) throw err;
        attempt++;
        ctx.metadata.retryCount = attempt;
        const delay = getDelay(attempt);
        if (delay > 0) {
          console.log(`🔁 waiting ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        console.log(`🔁 resetting ctx.response, data, error`);
        delete ctx.response;
        delete ctx.data;
        delete ctx.error;
        console.log('🔁 after delete, ctx.response ===', ctx.response);
        console.log('🔁 after delete, ctx.data ===', ctx.data);
        console.log('🔁 after delete, ctx.error ===', ctx.error);
      }
    }
  };
}