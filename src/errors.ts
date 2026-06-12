export class SafeFetchError extends Error {
  public readonly status: number | undefined;
  public readonly statusText: string | undefined;
  public readonly response: Response | undefined;
  public readonly body: any;
  public readonly request: Request | undefined;
  public readonly isAbort: boolean;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    options: {
      // 🔥 Исправление: добавляем `| undefined` к свойствам аргумента
      status?: number | undefined;
      statusText?: string | undefined;
      response?: Response | undefined;
      body?: any; // any уже покрывает undefined
      request?: Request | undefined;
      isAbort?: boolean | undefined;
      isRetryable?: boolean | undefined;
    } = {}
  ) {
    super(message);

    Object.setPrototypeOf(this, SafeFetchError.prototype);

    this.name = 'SafeFetchError';

    Object.defineProperty(this, 'message', {
      configurable: true,
      enumerable: true,
      value: message,
      writable: true
    });

    this.status = options.status;
    this.statusText = options.statusText;
    this.response = options.response;
    this.body = options.body;
    this.request = options.request;
    
    this.isAbort = options.isAbort ?? false;
    this.isRetryable = options.isRetryable ?? false;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
