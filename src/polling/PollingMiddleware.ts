import type { Middleware } from '../types';
import type { SafeFetch } from '../core/SafeFetch';

export function pollingMiddleware(instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    const { pollInterval } = ctx.options;
    if (!pollInterval) {
      await next();
      return;
    }
    await next();
    if (ctx.error) return;
    const poll = async () => {
      if (ctx.controller.signal.aborted) return;
      try {
        const { pollInterval: _, ...optionsWithoutPoll } = ctx.options;
        await instance.request(ctx.url, optionsWithoutPoll);
      } catch { /* ignore */ } finally {
        if (!ctx.controller.signal.aborted) setTimeout(poll, pollInterval);
      }
    };
    setTimeout(poll, pollInterval);
  };
}