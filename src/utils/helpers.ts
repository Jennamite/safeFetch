/**
 * Генерирует уникальный идентификатор запроса.
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Стабильная сериализация объектов для построения ключей.
 * Рекурсивно обходит объекты, сортирует ключи и защищена от циклических ссылок.
 */
export function stableStringify(obj: any, seen = new WeakSet()): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (obj instanceof Date) return obj.toISOString();

  // 🔥 ИСПРАВЛЕНИЕ: Защита от бесконечной рекурсии при циклических ссылках
  if (typeof obj === 'object') {
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(item => stableStringify(item, seen)).join(',')}]`;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${k}:${stableStringify(obj[k], seen)}`).join(',')}}`;
  }

  // 🔥 ИСПРАВЛЕНИЕ: Оптимизация размера ключей для примитивов (избавляемся от лишних кавычек JSON)
  return String(obj);
}

/**
 * Проверяет, является ли метод безопасным (не должен изменять состояние на сервере).
 */
export function isSafeMethod(method?: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * Рекурсивно очищает объект от undefined, полностью вычищая пустые поддеревья.
 */
/**
 * Рекурсивно очищает объект от undefined, полностью вычищая пустые поддеревья.
 */
export function filterUndefinedDeep(obj: any, seen = new WeakSet()): any {
  if (Array.isArray(obj)) {
    return obj
      .map(item => filterUndefinedDeep(item, seen))
      .filter(item => item !== undefined);
  }

  if (obj && typeof obj === 'object') {
    // Защита от циклов
    if (seen.has(obj)) return obj;
    seen.add(obj);

    const result: any = {};
    let hasKeys = false;

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;

      const filtered = filterUndefinedDeep(value, seen);

      // Если вложенный объект после очистки стал абсолютно пустым {},
      // мы НЕ добавляем его в родительский объект, чтобы гарантировать совпадение ключей кэша
      if (filtered !== undefined && (typeof filtered !== 'object' || filtered === null || Object.keys(filtered).length > 0 || Array.isArray(filtered))) {
        result[key] = filtered;
        hasKeys = true;
      }
    }

    // Если весь объект целиком стал пустым — возвращаем undefined для очистки родительской ветки
    return hasKeys ? result : undefined;
  }

  return obj;
}


/**
 * Глубокое слияние заголовков.
 * @param target - целевой объект заголовков
 * @param source - источник заголовков
 * @returns объединённый объект Headers
 */
export function mergeHeaders(target: HeadersInit | undefined, source: HeadersInit | undefined): Headers {
  const result = new Headers(target);
  if (source) {
    const sourceHeaders = new Headers(source);
    sourceHeaders.forEach((value, key) => {
      result.set(key, value);
    });
  }
  return result;
}
