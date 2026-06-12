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
  const cleanups: (() => void)[] = [];

  const onAbort = (event: Event) => {
    const targetSignal = event.target as AbortSignal;
    controller.abort(targetSignal.reason);
  };

  for (const signal of defined) {
    if (signal.aborted) {
      cleanups.forEach(fn => fn());
      controller.abort(signal.reason);
      return controller.signal;
    }

    signal.addEventListener('abort', onAbort);
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }

  const cleanup = () => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  };

  (controller.signal as any).cleanup = cleanup;
  return controller.signal;
}

/**
 * Создаёт промис, который гарантированно реджектится при отмене сигнала.
 */
export function abortedPromise(signal?: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let onAbortListener: (() => void) | null = null;
  let hasSettled = false;

  const promise = new Promise<never>((_, reject) => {
    if (!signal) return;

    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    onAbortListener = () => {
      if (!hasSettled) {
        hasSettled = true;
        reject(signal.reason);
      }
    };

    signal.addEventListener('abort', onAbortListener, { once: true });
  });

  return {
    promise,
    cleanup: () => {
      hasSettled = true;
      if (signal && onAbortListener) {
        signal.removeEventListener('abort', onAbortListener);
      }
    }
  };
}
