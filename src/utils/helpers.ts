/**
 * Генерирует уникальный идентификатор запроса.
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Стабильная сериализация объектов для построения ключей.
 * Рекурсивно обходит объекты, сортирует ключи.
 */
export function stableStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${k}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(obj);
}

/**
 * Проверяет, является ли метод безопасным (не должен изменять состояние на сервере).
 */
export function isSafeMethod(method?: string): boolean {
  return method === 'GET' || method === 'HEAD';
}