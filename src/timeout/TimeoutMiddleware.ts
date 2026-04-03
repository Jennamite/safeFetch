import type { Middleware } from '../types';
import { SafeFetchError } from '../errors';

export const timeoutMiddleware: Middleware = async (ctx, next) => {
  const timeout = ctx.options.timeout;
  if (!timeout) {
    await next();
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const onTimeout = () => {
    if (!ctx.controller.signal.aborted) {
      ctx.controller.abort(new SafeFetchError('Request timeout', { isAbort: true }));
    }
  };

  timeoutId = setTimeout(onTimeout, timeout);

  try {
    await next();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};