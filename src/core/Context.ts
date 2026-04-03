import type { RequestContext, FetchOptions } from '../types';
import { SafeFetchError } from '../errors';

/**
 * Реализация контекста запроса.
 */
export class RequestContextImpl implements RequestContext {
  public url: string;
  public options: FetchOptions;
  public request?: Request;
  public response?: Response;
  public data?: any;
  public error?: SafeFetchError;
  public metadata: RequestContext['metadata'];
  public controller: AbortController;
  public cancel: (reason?: string) => void;

  constructor(url: string, options: FetchOptions) {
    this.url = url;
    this.options = options;
    this.metadata = {
      requestId: typeof options.requestId === 'function'
        ? options.requestId()
        : (options.requestId || this.generateRequestId()),
      startTime: Date.now(),
      retryCount: 0,
    };
    this.controller = new AbortController();
    this.cancel = (reason?: string) => {
      if (!this.controller.signal.aborted) {
        this.controller.abort(new SafeFetchError(reason || 'Request cancelled', { isAbort: true }));
      }
    };
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }
}