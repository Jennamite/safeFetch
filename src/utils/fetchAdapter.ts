/**
 * Универсальный адаптер для fetch.
 * В браузере использует глобальный fetch.
 * В Node.js пытается импортировать node-fetch.
 */
export async function fetchAdapter(input: RequestInfo, init?: RequestInit): Promise<Response> {
  if (typeof fetch !== 'undefined') {
    return fetch(input, init);
  }

  // В Node.js пытаемся загрузить node-fetch
  try {
    // @ts-expect-error - node-fetch может отсутствовать, но мы обрабатываем ошибку
    const nodeFetch = await import('node-fetch');
    return nodeFetch.default(input, init);
  } catch {
    throw new Error(
      'fetch is not available in this environment. Please install node-fetch or polyfill fetch.'
    );
  }
}