import type { Middleware, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';
import { combineSignals } from '../utils/signals';
import { xhrRequest } from '../xhr/xhrRequest';
import { fetchAdapter } from '../utils/fetchAdapter';

export function fetchMiddleware(): Middleware {
  return async (ctx, next) => {
    console.log('🌐 fetchMiddleware: ENTER, has signal?', !!ctx.controller.signal);
    if (ctx.controller.signal.aborted) {
      throw new SafeFetchError('Request aborted', {
        isAbort: true,
      });
    }

    if (ctx.response) {
      console.log('🌐 fetchMiddleware: ctx.response exists, skipping fetch');
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

    const useXHR =
      (!!onUploadProgress || !!onDownloadProgress) &&
      typeof XMLHttpRequest !== 'undefined';

    const headers = new Headers(initHeaders);
    headers.set('X-Request-Id', requestId);

    const finalSignal = combineSignals(externalSignal ?? undefined, ctx.controller.signal);
    console.log('🌐 finalSignal exists?', !!finalSignal);

    const cleanup = (finalSignal as any)?.cleanup;

    const requestInit: RequestInit = { headers };
    if (method !== undefined) requestInit.method = method;
    if (ctx.options.body != null) requestInit.body = ctx.options.body;
    if (finalSignal) requestInit.signal = finalSignal;
    if (credentials !== undefined) requestInit.credentials = credentials;

    const request = new Request(ctx.url, requestInit);
    ctx.request = request;

    // ✅ helper — единая проверка abort
    const throwIfAborted = () => {
      if (finalSignal?.aborted) {
        throw new SafeFetchError('Request aborted', {
          isAbort: true,
          request,
        });
      }
    };

    try {
      let response: Response;

      if (useXHR) {
        const xhrOptions: {
          url: string;
          method: string;
          options: FetchOptions;
          requestId: string;
          signal?: AbortSignal;
          onDownloadProgress?: (progress: number) => void;
          onUploadProgress?: (progress: number) => void;
          credentials?: RequestCredentials;
        } = {
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

        throwIfAborted(); // ✅ FIX

        response = new Response(xhrResult.data, {
          status: xhrResult.status,
          statusText: xhrResult.statusText,
          headers: xhrResult.headers,
        });

        ctx.data = xhrResult.data;
        ctx.response = response;

        const isValid = validateStatus?.(response.status) ?? (response.status >= 200 && response.status < 300);
        if (!isValid) {
          const errorBody = typeof xhrResult.data === 'string'
            ? xhrResult.data
            : JSON.stringify(xhrResult.data);

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

        throwIfAborted(); // ✅ FIX

        return;
      } else {
        const fetcher = customFetch ?? fetchAdapter;
        response = await fetcher(ctx.url, requestInit);
        ctx.response = response;

        // ✅ Добавить проверку
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
          const cloned = response.clone();
          const errorBody = await cloned.text();
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
        return;
      }
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;

      const error = err as any;

      // ✅ ЧИСТОЕ определение abort (без магии)
      const isAbort =
        error?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError');

      throw new SafeFetchError(error?.message || 'Fetch error', {
        isAbort,
        request,
      });
    } finally {
      cleanup?.();
    }
  };
}