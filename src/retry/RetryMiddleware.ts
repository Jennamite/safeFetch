import type { Middleware } from '../types';

export function retryMiddleware(): Middleware {
  return async (ctx, next) => {
    // Вся логика повторных попыток (создание чистого контекста, задержки, проверка isAbort)
    // централизованно и надежно управляется в цикле `while(true)` внутри метода request класса SafeFetch.ts.
    // Этот middleware просто передает выполнение дальше по цепочке, исключая двойные циклы.
    await next();
  };
}
