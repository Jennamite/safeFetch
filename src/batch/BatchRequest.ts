// // batch/BatchProcessor.ts
// interface BatchRequest {
//   ctx: RequestContext;
//   resolve: (value: any) => void;
//   reject: (reason?: any) => void;
// }

// export class BatchProcessor {
//   private pending = new Map<string, BatchRequest[]>();
//   private timer: ReturnType<typeof setTimeout> | null = null;
//   private maxWaitMs: number;

//   constructor(maxWaitMs = 0) { // 0 означает микротаску
//     this.maxWaitMs = maxWaitMs;
//   }

//   async add(key: string, ctx: RequestContext, instance: SafeFetch): Promise<any> {
//     return new Promise((resolve, reject) => {
//       const list = this.pending.get(key) || [];
//       list.push({ ctx, resolve, reject });
//       this.pending.set(key, list);

//       if (!this.timer) {
//         const schedule = this.maxWaitMs > 0 ? setTimeout : queueMicrotask;
//         this.timer = schedule(() => this.flush(instance)) as any;
//         if (this.maxWaitMs > 0) {
//           this.timer = setTimeout(() => this.flush(instance), this.maxWaitMs);
//         } else {
//           queueMicrotask(() => this.flush(instance));
//         }
//       }
//     });
//   }

//   private async flush(instance: SafeFetch) {
//     const batches = Array.from(this.pending.entries());
//     this.pending.clear();
//     this.timer = null;

//     for (const [key, requests] of batches) {
//       const first = requests[0];
//       const { url, options } = first.ctx;
//       // Формируем тело батча: можно настроить через опции
//       const batchBody = {
//         batch: requests.map(r => ({
//           url: r.ctx.url,
//           method: r.ctx.options.method,
//           headers: r.ctx.options.headers,
//           body: r.ctx.options.body,
//         })),
//       };
//       const batchOptions: FetchOptions = {
//         ...options,
//         method: 'POST',
//         body: batchBody,
//         batch: false, // предотвращаем бесконечную рекурсию
//         context: { ...options.context, __batchKey: key },
//       };
//       try {
//         const response = await instance.request(url, batchOptions);
//         // Предполагаем, что сервер вернул массив в том же порядке
//         let dataArray: any[];
//         if (Array.isArray(response)) {
//           dataArray = response;
//         } else if (response && typeof response === 'object' && Array.isArray((response as any).data)) {
//           dataArray = (response as any).data;
//         } else {
//           throw new SafeFetchError('Batch response must be an array or contain "data" array');
//         }
//         if (dataArray.length !== requests.length) {
//           throw new SafeFetchError(`Batch response length mismatch: expected ${requests.length}, got ${dataArray.length}`);
//         }
//         for (let i = 0; i < requests.length; i++) {
//           requests[i].resolve(dataArray[i]);
//         }
//       } catch (err) {
//         for (const req of requests) {
//           req.reject(err);
//         }
//       }
//     }
//   }
// }