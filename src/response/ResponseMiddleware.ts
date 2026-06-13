import type { Middleware, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';

export function responseMiddleware(): Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof SafeFetchError || (err && (err as any).name === 'SafeFetchError')) {
        ctx.error = err as any;
      }
      throw err;
    }

    console.log('responseMiddleware: ctx.response.status', ctx.response?.status);
    console.log('responseMiddleware: ctx.data before parse', ctx.data);

    // 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Если на нижнем уровне (в FetchMiddleware) 
    // уже была зафиксирована ошибка с кастомным текстом бэкенда, 
    // мы МГНОВЕННО выходим и не даем коду ниже перезаписать её дефолтной строкой!
    if (ctx.error) return;

    const {
      parse = 'auto',
      validateStatus = (s: number) => s >= 200 && s < 300,
      raw = false,
      returnMeta = false
    } = ctx.options;

    if (raw) return;

    if (!ctx.response) {
      throw new SafeFetchError('No response received', {
        request: ctx.request
      });
    }

    const response = ctx.response;
    const signal = ctx.controller?.signal;

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new SafeFetchError('Request aborted', {
          isAbort: true,
          request: ctx.request,
        });
      }
    };

    throwIfAborted();

    // Эта проверка сработает только если FetchMiddleware почему-то пропустил плохой статус
    if (!validateStatus(response.status)) {
      let errorBody = '';
      let parsedObj: any = null;
      let errorMessage = `HTTP ${response.status}: ${response.statusText || 'Error'}`;

      try {
        const cloned = response.clone();
        errorBody = await cloned.text();

        if (errorBody) {
          try {
            const parsed = JSON.parse(errorBody);
            if (parsed) {
              parsedObj = parsed;

              // 1. Если бэк вернул массив ошибок (часто бывает при валидации форм)
              if (Array.isArray(parsed) && parsed.length > 0) {
                const firstErr = parsed[0];
                errorMessage = firstErr?.message || firstErr?.error || errorMessage;
              }
              // 2. Если бэк вернул классический объект
              else if (typeof parsed === 'object') {
                const nestedError = parsed.error;

                // Зеркально сканируем все популярные ключи ошибок в индустрии по приоритету
                const possibleMessage =
                  parsed.message ||
                  (typeof nestedError === 'object' && nestedError !== null ? nestedError.message : null) ||
                  parsed.detail ||              // Для Python/FastAPI
                  parsed.error_description ||   // Стандарт OAuth2
                  (typeof parsed.error === 'string' ? parsed.error : null) ||
                  parsed.err;                   // Для Go

                // Безопасное приведение к строке (включая массивы строк из NestJS/Fastify)
                if (possibleMessage) {
                  errorMessage = Array.isArray(possibleMessage) ? possibleMessage.join(', ') : String(possibleMessage);
                }
              }
            }
          } catch {
            // Тело не JSON (оставляем дефолтный errorMessage, текст запишется в errorBody)
          }
        }
      } catch {
        errorBody = 'Unable to read error body';
      }

      throwIfAborted();

      throw new SafeFetchError(errorMessage, {
        status: response.status,
        statusText: response.statusText || undefined,
        response,
        body: parsedObj && typeof parsedObj === 'object' ? parsedObj : errorBody, // Передаем объект, если это был JSON
        request: ctx.request,
        isRetryable: response.status >= 500,
      });
    }

    // Парсим успешное тело, если оно ещё не распарсено
    if (ctx.data === undefined) {
      try {
        ctx.data = await parseBody(response, parse);
      } catch (parseErr) {
        throw new SafeFetchError('Failed to parse response body', {
          status: response.status,
          statusText: response.statusText || undefined,
          response,
          request: ctx.request,
          isRetryable: false,
        });
      }
    }

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
}

async function parseBody(response: Response, parse: FetchOptions['parse']): Promise<any> {
  if (parse === 'json') return await response.json();
  if (parse === 'text') return await response.text();
  if (parse === 'blob') return await response.blob();
  if (parse === 'arrayBuffer') return await response.arrayBuffer();
  if (typeof parse === 'function') return await parse(response);

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }

  if (contentType.includes('text/')) return await response.text();

  if (
    contentType.includes('application/octet-stream') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  ) {
    return await response.blob();
  }

  const text = await response.text();

  if (!text) return '';

  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}
