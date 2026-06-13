import type { Middleware, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';
import { combineSignals, abortedPromise } from '../utils/signals';
import { xhrRequest } from '../xhr/xhrRequest';
import { fetchAdapter } from '../utils/fetchAdapter';

export function fetchMiddleware(): Middleware {
  return async (ctx, next) => {
    if (ctx.controller.signal.aborted) {
      throw new SafeFetchError('Request aborted', {
        isAbort: true,
      });
    }

    if (ctx.response) {
      await next();
      return;
    }

    const {
      method,
      headers: initHeaders,
      raw,
      validateStatus,
      onUploadProgress,
      onDownloadProgress,
      signal: externalSignal,
      credentials,
      fetch: customFetch,
    } = ctx.options;

    const requestId = ctx.metadata.requestId;
    const useXHR = (!!onUploadProgress || !!onDownloadProgress) && typeof XMLHttpRequest !== 'undefined';

    const headers = new Headers(initHeaders);
    headers.set('X-Request-Id', requestId);

    const finalSignal = combineSignals(externalSignal ?? undefined, ctx.controller.signal);
    const cleanup = (finalSignal as any)?.cleanup;

    const requestInit: RequestInit = { headers };
    if (method !== undefined) requestInit.method = method;
    if (ctx.options.body != null) requestInit.body = ctx.options.body;
    if (finalSignal) requestInit.signal = finalSignal;
    if (credentials !== undefined) requestInit.credentials = credentials;

    const request = new Request(ctx.url, requestInit);
    ctx.request = request;

    const throwIfAborted = () => {
      if (finalSignal?.aborted || ctx.controller.signal.aborted) {
        throw new SafeFetchError('Request aborted', {
          isAbort: true,
          request,
        });
      }
    };

    try {
      let response: Response;

      if (useXHR) {
        const xhrOptions: any = {
          url: ctx.url,
          method: method!,
          options: ctx.options,
          requestId,
        };

        if (finalSignal) xhrOptions.signal = finalSignal;
        if (onDownloadProgress) xhrOptions.onDownloadProgress = onDownloadProgress;
        if (onUploadProgress) xhrOptions.onUploadProgress = onUploadProgress;
        if (credentials !== undefined) xhrOptions.credentials = credentials;

        const xhrResult = await xhrRequest(xhrOptions);
        throwIfAborted();

        response = new Response(xhrResult.data, {
          status: xhrResult.status,
          statusText: xhrResult.statusText,
          headers: xhrResult.headers,
        });

        ctx.data = xhrResult.data;
        ctx.response = response;

        const isValid = validateStatus?.(response.status) ?? (response.status >= 200 && response.status < 300);
        if (!isValid) {
          const errorBody = typeof xhrResult.data === 'string' ? xhrResult.data : JSON.stringify(xhrResult.data);
          throw new SafeFetchError(`HTTP ${response.status}: ${response.statusText}`, {
            status: response.status,
            statusText: response.statusText,
            response,
            body: errorBody,
            request,
            isRetryable: response.status >= 500,
          });
        }

        await next();
        throwIfAborted();
        return;
      } else {
        const fetcher = customFetch ?? fetchAdapter;
        response = await fetcher(ctx.url, requestInit);

        throwIfAborted();

        ctx.response = response;

        if (!response) {
          throw new SafeFetchError('Fetch returned undefined response', { request });
        }

        if (raw) {
          ctx.data = response;
          await next();
          return;
        }

        const statusValid = validateStatus?.(response.status) ?? (response.status >= 200 && response.status < 300);
        if (!statusValid) {
          let errorBodyString = '';
          let errorBodyFinal: any = '';
          // Базовый дженерик на случай, если бэк вообще ничего не прислал
          let errorMessage = `HTTP ${response.status}: ${response.statusText || 'Bad Request'}`;

          try {
            const cloned = response.clone();
            errorBodyString = await cloned.text();
            errorBodyFinal = errorBodyString;

            if (errorBodyString) {
              try {
                const parsed = JSON.parse(errorBodyString);
                if (parsed) {
                  errorBodyFinal = parsed;

                  // 1. Если бэк вернул массив ошибок (часто бывает при валидации форм)
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    const firstErr = parsed[0];
                    errorMessage = firstErr?.message || firstErr?.error || errorMessage;
                  }
                  // 2. Если бэк вернул классический объект
                  else if (typeof parsed === 'object') {
                    const nestedError = parsed.error;

                    // Сканируем все популярные ключи ошибок в индустрии по приоритету
                    const possibleMessage =
                      parsed.message ||
                      (typeof nestedError === 'object' && nestedError !== null ? nestedError.message : null) ||
                      parsed.detail ||
                      parsed.error_description ||
                      (typeof parsed.error === 'string' ? parsed.error : null) ||
                      parsed.err;

                    // Если нашли хоть какой-то вменяемый текст, берем его. 
                    // Если это массив (например, в NestJS parsed.message бывает массивом), берем его первый элемент
                    if (possibleMessage) {
                      errorMessage = Array.isArray(possibleMessage) ? possibleMessage[0] : String(possibleMessage);
                    }
                  }
                }
              } catch {
                // Тело не JSON (например, plain text) — errorMessage остается дефолтным, 
                // но сам текст сохранится в errorBodyFinal и будет доступен через err.body
              }
            }
          } catch {
            errorBodyFinal = 'Unable to read error response body';
          }

          throw new SafeFetchError(errorMessage, {
            status: response.status,
            statusText: response.statusText || 'Bad Request',
            response,
            body: errorBodyFinal,
            request,
            isRetryable: response.status >= 500,
          });
        }

        await next();
        return;
      }
    } catch (err) {
      throwIfAborted();

      // 🔥 ИСПРАВЛЕНИЕ: Если это уже готовая SafeFetchError с текстом от бэкенда, 
      // просто пробрасываем её наверх, не оборачивая заново в дефолтный "Fetch error"!
      if (err instanceof SafeFetchError || (err && (err as any).name === 'SafeFetchError')) {
        throw err;
      }

      const error = err as any;
      const isAbort = finalSignal?.aborted ||
        ctx.controller.signal.aborted ||
        error?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError');

      throw new SafeFetchError(error?.message || 'Fetch error', {
        isAbort,
        request,
        isRetryable: !isAbort,
      });
    } finally {
      cleanup?.();
    }
  };
}
