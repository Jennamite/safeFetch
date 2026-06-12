import type { Middleware } from '../types';
import type { SafeFetch } from '../core/SafeFetch';
import { BatchProcessor } from './BatchProcessor';
import { buildCacheKey } from '../utils/keyBuilder';

export function batchMiddleware(processor: BatchProcessor, instance: SafeFetch): Middleware {
  return async (ctx, next) => {
    const { method, batch, batchKey, query, includeHeaders } = ctx.options;

    console.log('batchMiddleware: method=', method, 'batch=', batch);

    // Пакетная группировка по умолчанию работает для POST-запросов (спецификация RPC/батчинга)
    if (method !== 'POST' || !batch) {
      await next();
      return;
    }

    console.log('batchMiddleware: batching request');

    // 🔥 ИСПРАВЛЕНИЕ: Безопасное формирование объекта для exactOptionalPropertyTypes
    let key = batchKey;

    if (!key) {
      const buildOptions: any = {
        url: ctx.url,
        method: 'POST',
      };

      if (query !== undefined) buildOptions.query = query;
      if (ctx.options.headers !== undefined) buildOptions.headers = ctx.options.headers;
      if (includeHeaders !== undefined) buildOptions.includeHeaders = includeHeaders;

      key = buildCacheKey(buildOptions);
    }

    // Отправляем запрос в процессор пакетов и ждём индивидуального результата для этого контекста
    const result = await processor.add(key, ctx, instance);

    // Записываем распарсенные данные дочернего ответа
    ctx.data = result;

    // 🔥 ИСПРАВЛЕНИЕ: Воссоздаем полноценный объект Response, чтобы не ломать ResponseMiddleware и кэш!
    // Сериализуем данные обратно в строку, если это объект, имитируя тело ответа от сервера
    const responseBody = typeof result === 'object' && result !== null
      ? JSON.stringify(result)
      : String(result ?? '');

    ctx.response = new Response(responseBody, {
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-Batch-Grounded': 'true'
      })
    });

    // Специально прерываем цепочку (не вызываем next()), так как сеть для этого подзапроса сымитирована
  };
}
