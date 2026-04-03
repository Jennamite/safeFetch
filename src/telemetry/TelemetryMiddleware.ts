import type { Middleware } from '../types';
import { Telemetry } from './Telemetry';

export function telemetryMiddleware(telemetry: Telemetry): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    telemetry.emit({ type: 'request', ctx });
    try {
      await next();
      telemetry.emit({ type: 'response', ctx, duration: Date.now() - start });
    } catch (err) {
      telemetry.emit({ type: 'error', ctx, error: err as any, duration: Date.now() - start });
      throw err;
    }
  };
}