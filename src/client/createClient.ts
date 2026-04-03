import type { SafeFetchInstance, FetchOptions, RequestMethod } from '../types';

/**
 * Создаёт прокси-клиент, который позволяет вызывать методы API в стиле:
 * client.users.get('/123')
 * client.users.post({ name: 'John' })
 * client.users.profile.get()
 *
 * @param instance - экземпляр safeFetch
 * @param baseUrl - базовый URL для всех запросов (опционально)
 */
export function createClient<T extends Record<string, any>>(
  instance: SafeFetchInstance,
  baseUrl?: string
): T {
  const methods: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  const buildPath = (path: string): string => {
    if (!baseUrl) return path;
    // Убираем дублирующиеся слеши
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  };

  const client: any = {};

  const proxy = new Proxy(client, {
    get(target, prop: string) {
      if (target[prop]) return target[prop];

      // Проверяем, является ли prop именем HTTP-метода (get, post, put, patch, delete)
      const lowerProp = prop.toLowerCase();
      for (const method of methods) {
        if (lowerProp === method.toLowerCase()) {
          return (path: string, data?: any, options?: Omit<FetchOptions, 'method' | 'body'>) => {
            const fetchOptions: FetchOptions = { ...options, method };
            if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
              fetchOptions.body = data;
            }
            return instance(buildPath(path), fetchOptions);
          };
        }
      }

      // Иначе создаём вложенный прокси для поддержки client.users.profile.get()
      return new Proxy(() => {}, {
        get: (_, subProp: string) => {
          return (path?: string, data?: any, options?: FetchOptions) => {
            const fullPath = `/${prop}${path ? `/${path}` : ''}`;
            const method = subProp.toUpperCase() as RequestMethod;
            const fetchOptions: FetchOptions = { ...options, method };
            if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
              fetchOptions.body = data;
            }
            return instance(buildPath(fullPath), fetchOptions);
          };
        },
      });
    },
  });

  return proxy as T;
}