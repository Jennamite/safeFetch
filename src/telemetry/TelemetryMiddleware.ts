import type { Middleware } from '../types';
import { Telemetry } from './Telemetry';

export function telemetryMiddleware(telemetry: Telemetry): Middleware {
  return async (ctx, next) => {
    // Отправляем базовое событие старта запроса
    telemetry.emit({ type: 'request', ctx });
    
    try {
      await next();
      
      // 🔥 ИСПРАВЛЕНИЕ: Расчет длительности теперь берется строго на основе 
      // метаданных startTime контекста. Это гарантирует 100% точность метрик 
      // даже при дедупликации, батчинге или задержках в очередях конкурентности.
      const duration = Date.now() - ctx.metadata.startTime;
      telemetry.emit({ type: 'response', ctx, duration });
    } catch (err) {
      const duration = Date.now() - ctx.metadata.startTime;
      telemetry.emit({ type: 'error', ctx, error: err as any, duration });
      throw err;
    }
  };
}
