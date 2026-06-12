import type { Middleware, OnRequestHook, OnResponseHook, OnErrorHook } from '../types';
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
   * Создаёт массив middleware с правильным порядком выполнения Onion-архитектуры.
   */
  createMiddleware(): Middleware[] {
    // Перехватчик ошибок должен стоять на самом внешнем уровне (вверху),
    // чтобы контролировать абсолютно весь внутренний процесс пайплайна
    const errorMiddleware: Middleware = async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        // Извлекаем ошибку: либо готовую из контекста, либо текущую, бережно приводя к SafeFetchError
        const safeError = ctx.error ||
          (err instanceof SafeFetchError || (err && (err as any).name === 'SafeFetchError')
            ? (err as any)
            : new SafeFetchError((err as Error)?.message || 'Unknown error'));

        // Передаем ошибку в контекст, если она там отсутствовала
        if (!ctx.error) {
          ctx.error = safeError;
        }

        for (const hook of this.errorHooks) {
          await hook(ctx, safeError);
        }
        throw err;
      }
    };

    const beforeMiddleware: Middleware = async (ctx, next) => {
      for (const hook of this.requestHooks) {
        await hook(ctx);
      }
      await next();
    };

    const afterMiddleware: Middleware = async (ctx, next) => {
      await next();
      if (!ctx.error) {
        for (const hook of this.responseHooks) {
          await hook(ctx);
        }
      }
    };

    // 🔥 ИСПРАВЛЕНИЕ: Изменяем порядок возврата! 
    // errorMiddleware оборачивает before и after, гарантируя 100% перехват
    return [errorMiddleware, beforeMiddleware, afterMiddleware];
  }

  private removeHook(list: any[], hook: any): void {
    const index = list.indexOf(hook);
    if (index !== -1) list.splice(index, 1);
  }
}
