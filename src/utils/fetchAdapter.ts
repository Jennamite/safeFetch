
/**
 * Универсальный адаптер для fetch.
 * В браузере использует глобальный fetch.
 * В Node.js пытается импортировать node-fetch.
 */
// export async function fetchAdapter(input: RequestInfo, init?: RequestInit): Promise<Response> {
//   if (typeof fetch !== 'undefined') {
//     return fetch(input, init);
//   }

//   // В Node.js пытаемся загрузить node-fetch
//   try {
//     // @ts-expect-error - node-fetch может отсутствовать, но мы обрабатываем ошибку
//     const nodeFetch = await import('node-fetch');
//     return nodeFetch.default(input, init);
//   } catch {
//     throw new Error(
//       'fetch is not available in this environment. Please install node-fetch or polyfill fetch.'
//     );
//   }
// }
/**
 * Универсальный адаптер для fetch.
 * Использует глобальный fetch в браузере.
 * В Node.js необходимо передать кастомную реализацию через опцию `fetch`.
 */
// export async function fetchAdapter(input: RequestInfo, init?: RequestInit): Promise<Response> {
//   if (typeof fetch !== 'undefined') {
//     return fetch(input, init);
//   }
//   throw new Error(
//     'fetch is not available in this environment. Provide a custom fetch implementation via the "fetch" option.'
//   );
// }
export async function fetchAdapter(input: RequestInfo, init?: RequestInit): Promise<Response> {
  if (typeof fetch !== 'undefined') {
    return fetch(input, init);
  }
  // Вместо возврата undefined – бросаем ошибку
  throw new Error(
    'fetch is not available in this environment. Please provide a custom fetch implementation via the "fetch" option.'
  );
}