import { stableStringify } from './helpers';

export interface BuildKeyOptions {
  url: string;
  method: string;
  query?: Record<string, any> | undefined;
  body?: any | undefined;
  headers?: HeadersInit | undefined;
  includeHeaders?: string[] | undefined;
}

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
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
}

export function buildCacheKey(options: BuildKeyOptions): string {
  const { url, method, query, body, headers, includeHeaders = ['authorization', 'accept-language', 'x-api-key'] } = options;

  const queryString = query ? stableStringify(filterUndefined(query)) : '';
  
  let bodyString = '';
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') bodyString = body;
    else if (body instanceof FormData) bodyString = 'formdata';
    else if (body instanceof Blob) bodyString = `blob:${body.size}`;
    else if (body instanceof URLSearchParams) bodyString = body.toString();
    else bodyString = stableStringify(body);
  }

  let headerString = '';
  if (headers && includeHeaders.length) {
    const normalized = normalizeHeaders(headers);
    const relevant: Record<string, string> = {};
    for (const name of includeHeaders) {
      const val = normalized[name.toLowerCase()];
      if (val !== undefined) relevant[name] = val;
    }
    headerString = stableStringify(relevant);
  }

  return `${method}:${url}:${queryString}:${bodyString}:${headerString}`;
}

function filterUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}