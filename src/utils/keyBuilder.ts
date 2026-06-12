import { stableStringify, filterUndefinedDeep } from './helpers';

export interface BuildKeyOptions {
  url: string;
  method: string;
  query?: Record<string, any> | undefined;
  body?: any;
  headers?: HeadersInit | undefined;
  includeHeaders?: string[] | undefined;
}

// Используем единый безопасный разделитель для всей библиотеки
export const CACHE_KEY_SEP = '\x00';

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  const obj: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      obj[key.toLowerCase()] = value;
    });
    return obj;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key) {
        obj[key.toLowerCase()] = value;
      }
    }
    return obj;
  }

  // 🔥 ИСПРАВЛЕНИЕ: Безопасный перебор без зацепа свойств прототипа (for...in)
  if (typeof headers === 'object' && headers !== null) {
    const entries = Object.entries(headers);
    for (const [key, value] of entries) {
      obj[key.toLowerCase()] = String(value);
    }
  }

  return obj;
}

export function buildCacheKey(options: BuildKeyOptions): string {
  const {
    url,
    method,
    query,
    body,
    headers,
    // Если заголовки фильтрации не переданы явно, по умолчанию не привязываемся к ним,
    // чтобы избежать неожиданного расхождения ключей при изменении окружения
    includeHeaders = [],
  } = options;

  const queryString = query ? stableStringify(filterUndefinedDeep(query)) : '';

  let bodyString = '';
  if (body != null) {
    if (typeof body === 'string') bodyString = body;
    else if (body instanceof FormData) bodyString = 'formdata';
    else if (body instanceof Blob) bodyString = `blob:${body.size}`;
    else if (body instanceof URLSearchParams) bodyString = body.toString();
    else if (typeof body === 'object') {
      bodyString = stableStringify(filterUndefinedDeep(body));
    }
  }

  let headerString = '';
  if (headers && includeHeaders.length > 0) {
    const headerObj = normalizeHeaders(headers);
    const relevant: Record<string, string> = {};

    for (const name of includeHeaders) {
      const lower = name.toLowerCase();
      if (headerObj[lower] !== undefined) {
        relevant[lower] = headerObj[lower];
      }
    }

    headerString = stableStringify(relevant);
  }

  return [
    method.toUpperCase(),
    url,
    queryString,
    bodyString,
    headerString,
  ].join(CACHE_KEY_SEP);
}

export function parseCacheKey(key: string): { method: string; url: string } {
  // 🔥 ИСПРАВЛЕНИЕ: Используем экспортируемую константу CACHE_KEY_SEP
  const parts = key.split(CACHE_KEY_SEP, 2);
  if (parts.length < 2) {
    throw new Error(`Invalid cache key: ${key}`);
  }
  const method = parts[0]!;
  const url = parts[1]!;
  return { method, url };
}
