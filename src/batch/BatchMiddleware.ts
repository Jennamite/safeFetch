import type { Middleware, RequestContext } from '../types';
import type { SafeFetch } from '../core/SafeFetch';
import { BatchProcessor } from './BatchProcessor';
import { buildCacheKey } from '../utils/keyBuilder';

export function batchMiddleware(processor: BatchProcessor, instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    const { method, batch, batchKey, query, body, includeHeaders } = ctx.options;
    console.log('batchMiddleware: method=', method, 'batch=', batch);
    if (method !== 'POST' || !batch) {
      await next();
      return;
    }
    console.log('batchMiddleware: batching request');

    // Формируем ключ для группировки
    const key = batchKey ?? buildCacheKey({
      url: ctx.url,
      method: 'POST',
      query,
      // body,
      headers: ctx.options.headers,
      includeHeaders,
    });

    // Отправляем запрос в процессор и ждём результата
    const result = await processor.add(key, ctx, instance);
    ctx.data = result;
    // Не вызываем next(), так как ответ уже получен
  };
}