import type { RequestContext, FetchOptions } from '../types';
import type { SafeFetch } from '../core/SafeFetch';
import { SafeFetchError } from '../errors';

interface BatchRequest {
  ctx: RequestContext;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  signal?: AbortSignal;
  cleanup?: () => void;
}

export class BatchProcessor {
  private pending = new Map<string, BatchRequest[]>();
  private flushing = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitMs: number;

  constructor(maxWaitMs?: number) {
    this.maxWaitMs = maxWaitMs ?? 0;
  }

  async add(key: string, ctx: RequestContext, instance: SafeFetch): Promise<any> {
    // Вспомогательная функция для настройки AbortSignal на элементе очереди
    const setupAbort = (item: BatchRequest, reject: (reason?: any) => void) => {
      if (ctx.controller.signal.aborted) {
        reject(new SafeFetchError('Request cancelled', { isAbort: true, request: ctx.request }));
        return false;
      }

      const onAbort = () => {
        this.removeFromQueue(key, item);
        reject(new SafeFetchError('Request cancelled', { isAbort: true, request: ctx.request }));
      };

      ctx.controller.signal.addEventListener('abort', onAbort, { once: true });
      item.signal = ctx.controller.signal;
      item.cleanup = () => ctx.controller.signal.removeEventListener('abort', onAbort);
      return true;
    };

    if (this.flushing.has(key)) {
      return new Promise((resolve, reject) => {
        const list = this.pending.get(key) || [];
        const item: BatchRequest = { ctx, resolve, reject };

        // 🔥 ИСПРАВЛЕНИЕ: Добавлена полноценная обработка отмены для фазы flushing
        if (!setupAbort(item, reject)) return;

        list.push(item);
        this.pending.set(key, list);
      });
    }

    return new Promise((resolve, reject) => {
      const list = this.pending.get(key) || [];
      const item: BatchRequest = { ctx, resolve, reject };

      // Настраиваем прерывание по сигналу отмены
      if (!setupAbort(item, reject)) return;

      list.push(item);
      this.pending.set(key, list);

      if (!this.timer) {
        this.scheduleFlush(instance);
      }
    });
  }

  private scheduleFlush(instance: SafeFetch) {
    if (this.maxWaitMs > 0) {
      this.timer = setTimeout(() => this.flush(instance), this.maxWaitMs);
    } else {
      queueMicrotask(() => this.flush(instance));
    }
  }

  private async flush(instance: SafeFetch) {
    const batches = Array.from(this.pending.entries());
    this.pending.clear();
    this.timer = null;

    for (const [key, requests] of batches) {
      if (requests.length === 0) continue;

      // Помечаем ключ батча как находящийся в процессе отправки
      this.flushing.add(key);

      const first = requests[0]!;
      const { url, options } = first.ctx;
      const { batchKey, batchMaxWaitMs, ...batchOptions } = options;

      const batchBody = {
        batch: requests.map(r => {
          // 🔥 ИСПРАВЛЕНИЕ: Сериализация Headers, если они представлены инстансом класса Headers
          let serializedHeaders: any = r.ctx.options.headers;
          if (serializedHeaders instanceof Headers) {
            const obj: Record<string, string> = {};
            serializedHeaders.forEach((value, k) => { obj[k] = value; });
            serializedHeaders = obj;
          }

          return {
            url: r.ctx.url,
            method: r.ctx.options.method ?? 'GET',
            headers: serializedHeaders,
            body: r.ctx.options.body,
          };
        }),
      };

      const mergedBatchOptions: FetchOptions = {
        ...batchOptions,
        method: 'POST',
        body: JSON.stringify(batchBody),
        batch: false,
        context: {
          ...batchOptions.context,
          __batchKey: key,
        },
      };

      try {
        const response = await instance.request(url, mergedBatchOptions);

        let parsedResponse = response;
        if (typeof parsedResponse === 'string') {
          try {
            parsedResponse = JSON.parse(parsedResponse);
          } catch {
            // Оставляем как текст
          }
        }

        let dataArray: any[];
        if (Array.isArray(parsedResponse)) {
          dataArray = parsedResponse;
        } else if (parsedResponse && typeof parsedResponse === 'object' && Array.isArray((parsedResponse as any).data)) {
          dataArray = (parsedResponse as any).data;
        } else {
          throw new SafeFetchError('Batch response must be an array or contain "data" array');
        }

        if (dataArray.length !== requests.length) {
          throw new SafeFetchError(
            `Batch response length mismatch: expected ${requests.length}, got ${dataArray.length}`
          );
        }

        for (let i = 0; i < requests.length; i++) {
          const req = requests[i]!;

          // 🔥 ИСПРАВЛЕНИЕ: Сначала снимаем обработчик, чтобы предотвратить гонку утечек
          if (req.cleanup) req.cleanup();

          if (req.signal?.aborted) {
            req.reject(new SafeFetchError('Request cancelled', { isAbort: true, request: req.ctx.request }));
          } else {
            req.resolve(dataArray[i]);
          }
        }
      } catch (err) {
        for (const req of requests) {
          // 🔥 ИСПРАВЛЕНИЕ: Гарантированная очистка слушателей при падении
          if (req.cleanup) req.cleanup();
          req.reject(err);
        }
      } finally {
        // Фаза сброса для данного ключа завершена
        this.flushing.delete(key);
      }
    }

    if (this.pending.size > 0) {
      this.scheduleFlush(instance);
    }
  }

  private removeFromQueue(key: string, item: BatchRequest): void {
    const list = this.pending.get(key);
    if (!list) return;
    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) this.pending.delete(key);
  }
}
