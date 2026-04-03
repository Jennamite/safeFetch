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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitMs: number;

  constructor(maxWaitMs?: number) {
    this.maxWaitMs = maxWaitMs ?? 0;
  }

  async add(key: string, ctx: RequestContext, instance: SafeFetch): Promise<any> {
    return new Promise((resolve, reject) => {
      const list = this.pending.get(key) || [];
      const item: BatchRequest = { ctx, resolve, reject };

      if (ctx.controller.signal.aborted) {
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
        return;
      }

      const onAbort = () => {
        this.removeFromQueue(key, item);
        reject(new SafeFetchError('Request cancelled', { isAbort: true }));
      };
      ctx.controller.signal.addEventListener('abort', onAbort, { once: true });
      item.signal = ctx.controller.signal;
      item.cleanup = () => ctx.controller.signal.removeEventListener('abort', onAbort);

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

      const first = requests[0]!; // после проверки длины first точно существует
      const { url, options } = first.ctx;
      const { batchKey, batchMaxWaitMs, ...batchOptions } = options;

      const batchBody = {
        batch: requests.map(r => ({
          url: r.ctx.url,
          method: r.ctx.options.method ?? 'GET',
          headers: r.ctx.options.headers,
          body: r.ctx.options.body,
        })),
      };

      const mergedBatchOptions: FetchOptions = {
        ...batchOptions,
        method: 'POST',
        body: JSON.stringify(batchBody), // сериализуем в JSON
        batch: false,
        context: {
          ...batchOptions.context,
          __batchKey: key,
        },
      };

      try {
        const response = await instance.request(url, mergedBatchOptions);

        let dataArray: any[];
        if (Array.isArray(response)) {
          dataArray = response;
        } else if (response && typeof response === 'object' && Array.isArray((response as any).data)) {
          dataArray = (response as any).data;
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
          if (req.signal?.aborted) {
            req.reject(new SafeFetchError('Request cancelled', { isAbort: true }));
          } else {
            req.resolve(dataArray[i]);
          }
          if (req.cleanup) req.cleanup();
        }
      } catch (err) {
        for (const req of requests) {
          if (req.cleanup) req.cleanup();
          req.reject(err);
        }
      }
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