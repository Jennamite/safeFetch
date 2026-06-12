/**
 * Универсальный адаптер для fetch.
 * Использует глобальный fetch в браузере.
 * В Node.js необходимо передать кастомную реализацию через опцию `fetch`.
 */

export async function fetchAdapter(input: RequestInfo, init?: RequestInit): Promise<Response> {
  if (typeof fetch !== 'undefined') {
    return fetch(input, init);
  }
  // Вместо возврата undefined – бросаем ошибку
  throw new Error(
    'fetch is not available in this environment. Please provide a custom fetch implementation via the "fetch" option.'
  );
}