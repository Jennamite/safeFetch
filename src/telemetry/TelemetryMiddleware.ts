import type { Middleware, TelemetryEvent } from '../types';
import { Telemetry } from './Telemetry';

export function telemetryMiddleware(telemetry: Telemetry): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    // Событие начала запроса
    telemetry.emit({ type: 'request', ctx });

    try {
      await next();
      const duration = Date.now() - start;
      // Событие успешного ответа
      telemetry.emit({ type: 'response', ctx, duration });
    } catch (err) {
      const duration = Date.now() - start;
      // Событие ошибки
      telemetry.emit({ type: 'error', ctx, error: err as any, duration });
      throw err;
    }
  };
}