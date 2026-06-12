import { SafeFetchError } from '../errors';
import type { FetchOptions } from '../types';

interface XHRRequestOptions {
  url: string;
  method: string;
  options: FetchOptions;
  requestId: string;
  signal?: AbortSignal;
  onDownloadProgress?: (progress: number) => void;
  onUploadProgress?: (progress: number) => void;
  credentials?: RequestCredentials;
}

export function xhrRequest<T = any>({
  url,
  method,
  options,
  requestId,
  signal,
  onDownloadProgress,
  onUploadProgress,
  credentials,
}: XHRRequestOptions): Promise<{ data: T; headers: Headers; status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parseMode = options.parse ?? 'auto';

    if (parseMode === 'arrayBuffer') xhr.responseType = 'arraybuffer';
    else if (parseMode === 'blob') xhr.responseType = 'blob';

    xhr.open(method, url, true);

    if (credentials === 'include' || credentials === 'same-origin') {
      xhr.withCredentials = true;
    } else {
      xhr.withCredentials = false;
    }

    const headers = new Headers(options.headers);
    headers.set('X-Request-Id', requestId);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));

    if (options.timeout) xhr.timeout = options.timeout;

    // 🔥 ИСПРАВЛЕНИЕ: Инкапсулируем логику отмены и очистки
    let onAbort: (() => void) | null = null;

    const cleanupSignalListener = () => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    if (signal) {
      if (signal.aborted) {
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
        return;
      }
      onAbort = () => {
        try { xhr.abort(); } catch { /* ignore */ }
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (onDownloadProgress) {
      xhr.addEventListener('progress', (e) => {
        if (e.lengthComputable) onDownloadProgress(e.loaded / e.total);
      });
    }

    if (onUploadProgress && xhr.upload) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
      });
    }

    // Делаем колбэк асинхронным для поддержки await в кастомных функциях парсинга
    xhr.onload = async () => {
      cleanupSignalListener(); // 🔥 Гарантированно вычищаем слушатель при успехе

      const responseHeaders = new Headers();
      const allHeaders = xhr.getAllResponseHeaders();
      if (allHeaders) {
        allHeaders.trim().split(/[\r\n]+/).forEach(line => {
          const separatorIndex = line.indexOf(':');
          if (separatorIndex !== -1) {
            const key = line.substring(0, separatorIndex).trim();
            const value = line.substring(separatorIndex + 1).trim();
            if (key) responseHeaders.set(key, value);
          }
        });
      }

      const status = xhr.status;
      const statusText = xhr.statusText;

      if (status >= 200 && status < 300) {
        let data: any;
        if (parseMode === 'json') {
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            data = xhr.responseText;
          }
        } else if (parseMode === 'text') {
          data = xhr.responseText;
        } else if (parseMode === 'blob' || parseMode === 'arrayBuffer') {
          data = xhr.response;
        } else if (typeof parseMode === 'function') {
          const tempResponse = new Response(xhr.response, {
            status,
            statusText,
            headers: responseHeaders,
          });
          // 🔥 ИСПРАВЛЕНИЕ: Разрешаем кастомный парсер асинхронно через await
          data = await parseMode(tempResponse);
        } else {
          const contentType = responseHeaders.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              data = JSON.parse(xhr.responseText);
            } catch {
              data = xhr.responseText;
            }
          } else {
            data = xhr.responseText;
          }
        }

        resolve({ data, headers: responseHeaders, status, statusText });
      } else {
        const errorBody = xhr.responseText;
        reject(
          new SafeFetchError(`HTTP ${status}: ${statusText}`, {
            status,
            statusText,
            body: errorBody,
            isRetryable: status >= 500,
          })
        );
      }
    };

    xhr.onerror = () => {
      cleanupSignalListener(); // 🔥 Вычищаем слушатель при ошибке сети
      // 🔥 ИСПРАВЛЕНИЕ: Сетевые ошибки XHR теперь ретраятся (isRetryable: true)
      reject(new SafeFetchError('Network Error', { isRetryable: true }));
    };

    xhr.ontimeout = () => {
      cleanupSignalListener(); // 🔥 Вычищаем слушатель при таймауте
      reject(new SafeFetchError('Request timeout', { isAbort: true }));
    };

    let requestBody: XMLHttpRequestBodyInit | Document | null | undefined = undefined;
    const body = options.body;
    if (body !== null && body !== undefined) {
      if (body instanceof ReadableStream) {
        cleanupSignalListener();
        reject(new SafeFetchError('ReadableStream body is not supported in XHR'));
        return;
      }
      requestBody = body as any;
    }

    xhr.send(requestBody);
  });
}
