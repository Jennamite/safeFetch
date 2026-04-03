export class DedupeManager {
  private pending = new Map<string, Promise<any>>();

  /**
   * Проверяет, существует ли уже запрос для данного ключа.
   */
  has(key: string): boolean {
    return this.pending.has(key);
  }

  /**
   * Возвращает промис для существующего запроса или undefined.
   */
  get(key: string): Promise<any> | undefined {
    return this.pending.get(key);
  }

  /**
   * Сохраняет промис для ключа.
   */
  set(key: string, promise: Promise<any>): void {
    this.pending.set(key, promise);
  }

  /**
   * Удаляет запись по ключу.
   */
  delete(key: string): void {
    this.pending.delete(key);
  }

  /**
   * Очищает все ожидающие запросы.
   */
  clear(): void {
    this.pending.clear();
  }
}