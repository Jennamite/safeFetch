import type { TelemetryEvent } from '../types';

type TelemetryListener = (event: TelemetryEvent) => void | Promise<void>;

export class Telemetry {
  private listeners = new Set<TelemetryListener>();

  /**
   * Добавляет слушатель событий телеметрии.
   * Возвращает функцию для удаления слушателя.
   */
  on(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Удаляет слушатель.
   */
  off(listener: TelemetryListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Отправляет событие всем слушателям.
   * Слушатели вызываются асинхронно без ожидания (fire-and-forget).
   */
  emit(event: TelemetryEvent): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(event);
        // Если слушатель асинхронный, не ждём его завершения
        if (result && typeof result.catch === 'function') {
          result.catch(() => {
            // Игнорируем ошибки в слушателях телеметрии
          });
        }
      } catch {
        // Игнорируем ошибки в слушателях телеметрии
      }
    }
  }
}