/**
 * Объединяет несколько AbortSignal в один.
 * Возвращает новый сигнал, который отменяется при отмене любого из переданных.
 * Также возвращает функцию cleanup для удаления слушателей.
 */
export function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): (AbortSignal & { cleanup?: () => void }) | undefined {
  const defined = signals.filter(s => s !== undefined) as AbortSignal[];
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];

  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
  };
  const cleanups: (() => void)[] = [];

  for (const signal of defined) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort);
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }

  const cleanup = () => cleanups.forEach(fn => fn());
  (controller.signal as any).cleanup = cleanup;
  return controller.signal;
}

/**
 * Создаёт промис, который разрешается при отмене сигнала.
 */
export function abortedPromise(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort);
  });
}