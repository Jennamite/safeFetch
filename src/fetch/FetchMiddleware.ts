import type { Middleware, FetchOptions } from '../types'; // <- добавить FetchOptions
import { SafeFetchError } from '../errors';
import { fetchAdapter } from '../utils/fetchAdapter';
import { combineSignals } from '../utils/signals';
import { xhrRequest } from '../xhr/xhrRequest';

export const fetchMiddleware: Middleware = async (ctx, next) => {
  if (ctx.response) {
    await next();
    return;
  }

  const { method, headers: initHeaders, raw, validateStatus, onUploadProgress, onDownloadProgress, signal: externalSignal } = ctx.options;
  const requestId = ctx.metadata.requestId;
  const useXHR = (!!onUploadProgress || !!onDownloadProgress) && typeof XMLHttpRequest !== 'undefined';

  const headers = new Headers(initHeaders);
  headers.set('X-Request-Id', requestId);

  // Комбинируем сигналы
  const finalSignal = combineSignals(externalSignal ?? undefined, ctx.controller.signal);
  const cleanup = (finalSignal as any)?.cleanup;

  // Формируем RequestInit без undefined полей
  const requestInit: RequestInit = {
    headers,
  };
  if (method !== undefined) {
    requestInit.method = method;
  }
  if (ctx.options.body !== undefined) {
    requestInit.body = ctx.options.body === null ? null : ctx.options.body;
  }
  if (finalSignal) {
    requestInit.signal = finalSignal;
  }

  let request = new Request(ctx.url, requestInit);
  ctx.request = request;

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
      } = {
        url: ctx.url,
        method: method!,
        options: ctx.options,
        requestId,
      };
      if (finalSignal) xhrOptions.signal = finalSignal;
      if (onDownloadProgress) xhrOptions.onDownloadProgress = onDownloadProgress;
      if (onUploadProgress) xhrOptions.onUploadProgress = onUploadProgress;

      const xhrResult = await xhrRequest(xhrOptions);
      response = new Response(xhrResult.data, {
        status: xhrResult.status,
        statusText: xhrResult.statusText,
        headers: xhrResult.headers,
      });
      ctx.data = xhrResult.data;
      ctx.response = response;
    } else {
      response = await fetchAdapter(request);
      ctx.response = response;

      if (raw) {
        ctx.data = response;
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
        });
      }
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    const error = err as Error;
    const isAbort = error.name === 'AbortError' || error.message === 'Request timeout';
    throw new SafeFetchError(error.message, { isAbort, request });
  } finally {
    cleanup?.();
  }
  await next();
};