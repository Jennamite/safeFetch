import type { Middleware, RequestContext } from '../types';
import { DedupeManager } from './DedupeManager';
import { buildCacheKey } from '../utils/keyBuilder';
import { isSafeMethod } from '../utils/helpers';

export function dedupeMiddleware(manager: DedupeManager): Middleware {
  return async (ctx: RequestContext, next) => {
    const { method, dedupe = true, force = false, query, body, includeHeaders } = ctx.options;

    if (!isSafeMethod(method) || !dedupe || force) {
      await next();
      return;
    }

    const key = buildCacheKey({
      url: ctx.url,
      method: method!,
      query: query ? filterUndefined(query) : undefined,
      body: body ?? undefined,
      headers: ctx.options.headers ?? undefined,
      includeHeaders: includeHeaders ?? undefined,
    });

    const existing = manager.get(key);
    if (existing) {
      const result = await existing;
      ctx.data = result.data;
      ctx.response = result.response;
      ctx.metadata.dedupeHit = true;
      return;
    }

    const promise = (async () => {
      await next();
      return { data: ctx.data, response: ctx.response };
    })();

    manager.set(key, promise);

    try {
      await promise;
    } finally {
      manager.delete(key);
    }
  };
}

function filterUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}