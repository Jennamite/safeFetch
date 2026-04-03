import type { Middleware, RequestContext, OnRequestHook, OnResponseHook, OnErrorHook } from '../types';
import { SafeFetchError } from '../errors';

export class HooksManager {
  private requestHooks: OnRequestHook[] = [];
  private responseHooks: OnResponseHook[] = [];
  private errorHooks: OnErrorHook[] = [];

  addRequestHook(hook: OnRequestHook): () => void {
    this.requestHooks.push(hook);
    return () => this.removeHook(this.requestHooks, hook);
  }

  addResponseHook(hook: OnResponseHook): () => void {
    this.responseHooks.push(hook);
    return () => this.removeHook(this.responseHooks, hook);
  }

  addErrorHook(hook: OnErrorHook): () => void {
    this.errorHooks.push(hook);
    return () => this.removeHook(this.errorHooks, hook);
  }

  /**
   * Создаёт массив middleware, которые будут вызывать хуки в нужные моменты.
   * Возвращает три middleware: до запроса, после запроса (при успехе) и при ошибке.
   */
  createMiddleware(): Middleware[] {
    const before: Middleware = async (ctx, next) => {
      for (const hook of this.requestHooks) {
        await hook(ctx);
      }
      await next();
    };

    const after: Middleware = async (ctx, next) => {
      await next();
      if (!ctx.error) {
        for (const hook of this.responseHooks) {
          await hook(ctx);
        }
      }
    };

    const error: Middleware = async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        const safeError = err instanceof SafeFetchError ? err : new SafeFetchError((err as Error).message);
        for (const hook of this.errorHooks) {
          await hook(ctx, safeError);
        }
        throw err;
      }
    };

    return [before, after, error];
  }

  private removeHook(list: any[], hook: any): void {
    const index = list.indexOf(hook);
    if (index !== -1) list.splice(index, 1);
  }
}