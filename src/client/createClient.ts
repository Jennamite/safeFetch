import type { SafeFetchInstance, FetchOptions, RequestMethod } from '../types';

function normalizePath(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return base + p;
}

export function createClient<T extends Record<string, any>>(
  instance: SafeFetchInstance,
  baseUrl?: string
): T {
  const methods: string[] = ['get', 'post', 'put', 'patch', 'delete'];

  const buildPath = (path: string) => {
    if (!baseUrl) return path;
    return normalizePath(baseUrl, path);
  };

  // 🔥 ИСПРАВЛЕНИЕ: Рекурсивная фабрика прокси, которая умеет накапливать сегменты пути
  const createSubProxy = (parts: string[]): any => {
    // Создаем функцию-заглушку, чтобы прокси оставался вызываемым (callable)
    const targetFn = () => { };

    return new Proxy(targetFn, {
      get(_, prop: string) {
        // 🔥 ИСПРАВЛЕНИЕ: Игнорируем служебные свойства JS и символы.
        // Это полностью защищает от поломки async/await (блокирует ложные запросы .then)
        if (
          typeof prop === 'symbol' ||
          prop === 'then' ||
          prop === 'constructor' ||
          prop === 'prototype' ||
          prop === 'inspect'
        ) {
          return undefined;
        }

        const lowerProp = prop.toLowerCase();

        // Если вызван HTTP-метод, значит мы дошли до конца цепочки эндпоинта
        if (methods.includes(lowerProp)) {
          const method = prop.toUpperCase() as RequestMethod;

          return (path?: string, data?: any, options?: Omit<FetchOptions, 'method' | 'body'>) => {
            // Собираем все накопленные сегменты пути в единую строку
            const basePath = '/' + parts.join('/');
            // Добавляем хвостовой путь, если он передан в метод (например, .get('/123'))
            const fullPath = `${basePath}${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`;

            const fetchOptions: FetchOptions = { ...options, method };

            if (data !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
              fetchOptions.body = data;
            }

            return instance(buildPath(fullPath), fetchOptions);
          };
        }

        // Если это не HTTP-метод, значит перед нами следующий сегмент пути API.
        // Накапливаем его в массив и уходим на следующий уровень рекурсии прокси.
        return createSubProxy([...parts, prop]);
      }
    });
  };

  // Корневой прокси начинает сборку с пустого массива сегментов
  return createSubProxy([]) as T;
}
