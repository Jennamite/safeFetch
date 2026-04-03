interface QueueItem {
  resolve: () => void;
  reject: (reason?: any) => void;
  signal?: AbortSignal;
}

export class ConcurrencyController {
  private active = new Map<string, number>();
  private queues = new Map<string, QueueItem[]>();

  /**
   * Пытается захватить слот для ключа.
   * Если количество активных запросов меньше max, сразу возвращает управление.
   * Иначе добавляет в очередь ожидания и возвращает промис, который разрешится,
   * когда освободится слот.
   */
  async acquire(key: string, max: number, signal?: AbortSignal): Promise<void> {
    const current = this.active.get(key) || 0;
    if (current < max) {
      this.active.set(key, current + 1);
      return;
    }

    // Очередь
    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(key) || [];
      const item: QueueItem = { resolve, reject };
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
        // Сохраняем функцию очистки, чтобы можно было отвязать слушатель при обычном разрешении
        (item as any).cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      queue.push(item);
      this.queues.set(key, queue);
    });
  }

  /**
   * Освобождает слот для ключа.
   * Если в очереди есть ожидающие, первый из них получает разрешение.
   */
  release(key: string): void {
    const current = this.active.get(key);
    if (current === undefined || current <= 0) return;

    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      // Очищаем слушатель, если был
      if ((next as any).cleanup) (next as any).cleanup();
      next.resolve();
      // Активные слоты остаются прежними (один переходит из очереди в активные)
      return;
    }

    // Нет очереди – уменьшаем счётчик
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