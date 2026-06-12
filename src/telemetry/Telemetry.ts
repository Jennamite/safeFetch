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
   * Отправляет событие всем слушателям асинхронно (fire-and-forget).
   */
  emit(event: TelemetryEvent): void {
    for (const listener of this.listeners) {
      // 🔥 ИСПРАВЛЕНИЕ: Выносим запуск слушателей в макротаск (setTimeout), 
      // чтобы операции телеметрии гарантированно не блокировали основной Event Loop
      // выполнения сетевых запросов и не приводили к утечкам при зависании.
      setTimeout(() => {
        try {
          const result = listener(event);
          if (result && typeof result.catch === 'function') {
            result.catch(() => {
              // Игнорируем внутренние ошибки слушателей
            });
          }
        } catch {
          // Игнорируем синхронные ошибки слушателей
        }
      }, 0);
    }
  }
}
