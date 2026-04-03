import type { Middleware, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';

/**
 * Парсит тело ответа и обрабатывает returnMeta.
 */
export const responseMiddleware: Middleware = async (ctx, next) => {
  await next();

  // Если уже есть ошибка, ничего не делаем
  if (ctx.error) return;

  const { parse = 'auto', validateStatus = (s: number) => s >= 200 && s < 300, raw = false, returnMeta = false } = ctx.options;

  // Если raw, то ctx.data уже Response, не парсим
  if (raw) return;

  if (!ctx.response) {
    throw new SafeFetchError('No response received');
  }

  const response = ctx.response;

  // Проверяем статус
  if (!validateStatus(response.status)) {
    let errorBody: any;
    try {
      // Клонируем, чтобы не нарушить дальнейшее чтение
      const cloned = response.clone();
      errorBody = await cloned.text();
    } catch {
      errorBody = 'Unable to read error body';
    }

    const errorOptions: {
      status?: number;
      statusText?: string;
      response?: Response;
      body?: any;
      request?: Request;
      isAbort?: boolean;
    } = {
      status: response.status,
      statusText: response.statusText,
      response,
      body: errorBody,
    };

    // Удаляем поля, которые undefined (для exactOptionalPropertyTypes)
    Object.keys(errorOptions).forEach(key => {
      if (errorOptions[key as keyof typeof errorOptions] === undefined) {
        delete errorOptions[key as keyof typeof errorOptions];
      }
    });

    throw new SafeFetchError(`HTTP ${response.status}: ${response.statusText}`, errorOptions);
  }

  // Парсим тело, если ещё не распарсено
  if (ctx.data === undefined) {
    ctx.data = await parseBody(response, parse);
  }

  // Если returnMeta, оборачиваем результат
  if (returnMeta && ctx.data !== undefined) {
    ctx.data = {
      data: ctx.data,
      requestId: ctx.metadata.requestId,
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    };
  }
};

/**
 * Парсит тело ответа в зависимости от опции parse.
 */
async function parseBody(response: Response, parse: FetchOptions['parse']): Promise<any> {
  if (parse === 'json') return await response.json();
  if (parse === 'text') return await response.text();
  if (parse === 'blob') return await response.blob();
  if (parse === 'arrayBuffer') return await response.arrayBuffer();
  if (typeof parse === 'function') return await parse(response);

  // 'auto'
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }
  if (contentType.includes('text/')) return await response.text();
  if (contentType.includes('application/octet-stream') || contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/')) {
    return await response.blob();
  }
  // По умолчанию текст
  return await response.text();
}