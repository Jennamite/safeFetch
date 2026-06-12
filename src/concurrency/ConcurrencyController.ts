interface QueueItem {
  resolve: () => void;
  reject: (reason?: any) => void;
  signal?: AbortSignal;
  isAcquired?: boolean; // Флаг: перешел ли запрос из очереди в активную фазу
}

export class ConcurrencyController {
  private active = new Map<string, number>();
  private queues = new Map<string, QueueItem[]>();
  // 🔥 Реестр для отслеживания: занимал ли конкретный инстанс запроса активный слот
  private requestState = new WeakMap<Promise<void> | any, boolean>();

  /**
   * Пытается захватить слот для ключа.
   * Возвращает уникальный токен (объект), который нужно передать в release().
   */
  async acquire(key: string, max: number, signal?: AbortSignal): Promise<any> {
    const current = this.active.get(key) || 0;

    // Создаем уникальный токен для этого конкретного запроса
    const token = {};

    if (current < max) {
      this.active.set(key, current + 1);
      this.requestState.set(token, true); // Запрос сразу стал активным
      return token;
    }

    // Если слотов нет — уходим в очередь
    await new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(key) || [];
      const item: QueueItem = { resolve, reject, isAcquired: false };

      if (signal) {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }

        item.signal = signal;
        const onAbort = () => {
          this.removeFromQueue(key, item);
          reject(signal.reason);
        };

        signal.addEventListener('abort', onAbort, { once: true });
        // Безопасное сохранение функции очистки без мутации скрытых классов
        (item as any).cleanup = () => signal.removeEventListener('abort', onAbort);
      }

      queue.push(item);
      this.queues.set(key, queue);
    });

    // Когда промис разрешается из метода release(), запрос официально занимает активный слот
    this.requestState.set(token, true);
    return token;
  }

  /**
   * Освобождает слот для ключа.
   * Принимает токен запроса, гарантируя атомарность счетчиков.
   */
  release(key: string, token?: any): void {
    // 🔥 ИСПРАВЛЕНИЕ: Если передан токен и этот запрос никогда не был активным
    // (например, его отменили еще на стадии ожидания в очереди) — мы НИЧЕГО не уменьшаем!
    if (token && !this.requestState.get(token)) {
      return;
    }

    const current = this.active.get(key);
    if (current === undefined || current <= 0) return;

    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if ((next as any).cleanup) (next as any).cleanup();

      next.isAcquired = true; // Помечаем, что элемент успешно забирает освободившийся слот
      next.resolve();
      // Количество активных слотов остается прежним
      return;
    }

    // Очередь пуста — честно уменьшаем счетчик активных слотов
    if (current === 1) {
      this.active.delete(key);
    } else {
      this.active.set(key, current - 1);
    }
  }

  private removeFromQueue(key: string, item: QueueItem): void {
    const queue = this.queues.get(key);
    if (!queue) return;
    const index = queue.indexOf(item);
    if (index !== -1) queue.splice(index, 1);
    if (queue.length === 0) this.queues.delete(key);
  }
}
