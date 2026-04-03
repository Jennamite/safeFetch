import { stableStringify, filterUndefinedDeep } from './helpers';

export interface BuildKeyOptions {
  url: string;
  method: string;
  query?: Record<string, any> | undefined;
  body?: any;
  headers?: HeadersInit | undefined;
  includeHeaders?: string[] | undefined;
}

const SEP = '\x00'; // безопасный разделитель

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key.toLowerCase()] = value;
    });
    return obj;
  }

  if (Array.isArray(headers)) {
    const obj: Record<string, string> = {};
    for (const [key, value] of headers) {
      obj[key.toLowerCase()] = value;
    }
    return obj;
  }

  const obj: Record<string, string> = {};
  for (const key in headers) {
    obj[key.toLowerCase()] = String((headers as any)[key]);
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
    includeHeaders = ['authorization', 'accept-language', 'x-api-key'],
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
  if (headers && includeHeaders?.length) {
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
  ].join(SEP);
}

export function parseCacheKey(key: string): { method: string; url: string } {
  const parts = key.split(SEP, 2);
  if (parts.length < 2) {
    throw new Error(`Invalid cache key: ${key}`);
  }
  const method = parts[0]!;
  const url = parts[1]!;
  return { method, url };
}