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
}

/**
 * Выполняет HTTP-запрос через XMLHttpRequest с поддержкой прогресса.
 * Возвращает распарсенные данные, заголовки, статус и статус-текст.
 */
export function xhrRequest<T = any>({
  url,
  method,
  options,
  requestId,
  signal,
  onDownloadProgress,
  onUploadProgress,
}: XHRRequestOptions): Promise<{ data: T; headers: Headers; status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parseMode = options.parse ?? 'auto';

    // Настраиваем responseType для бинарных данных
    if (parseMode === 'arrayBuffer') xhr.responseType = 'arraybuffer';
    else if (parseMode === 'blob') xhr.responseType = 'blob';

    xhr.open(method, url, true);

    // Устанавливаем заголовки
    const headers = new Headers(options.headers);
    headers.set('X-Request-Id', requestId);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));

    if (options.timeout) xhr.timeout = options.timeout;

    // Обработка отмены через AbortSignal
    if (signal) {
      if (signal.aborted) {
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
        return;
      }
      const onAbort = () => {
        xhr.abort();
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Прогресс скачивания
    if (onDownloadProgress) {
      xhr.addEventListener('progress', (e) => {
        if (e.lengthComputable) onDownloadProgress(e.loaded / e.total);
      });
    }

    // Прогресс загрузки
    if (onUploadProgress && xhr.upload) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
      });
    }

    xhr.onload = () => {
      // Формируем заголовки ответа
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
          // Создаём временный Response для передачи в функцию
          const tempResponse = new Response(xhr.response, {
            status,
            statusText,
            headers: responseHeaders,
          });
          data = parseMode(tempResponse);
        } else {
          // auto
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
          })
        );
      }
    };

    xhr.onerror = () => {
      reject(new SafeFetchError('Network Error'));
    };

    xhr.ontimeout = () => {
      reject(new SafeFetchError('Request timeout', { isAbort: true }));
    };

    // Подготовка тела запроса для XHR
    let requestBody: XMLHttpRequestBodyInit | Document | null | undefined = undefined;
    const body = options.body;
    if (body !== null && body !== undefined) {
      // XHR не поддерживает ReadableStream
      if (body instanceof ReadableStream) {
        reject(new SafeFetchError('ReadableStream body is not supported in XHR'));
        return;
      }
      // Оставляем другие типы (string, Blob, ArrayBuffer, FormData, URLSearchParams, Document)
      requestBody = body as any;
    }

    xhr.send(requestBody);
  });
}