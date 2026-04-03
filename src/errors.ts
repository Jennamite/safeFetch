export class SafeFetchError extends Error {
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly response?: Response;
  public readonly body?: any;
  public readonly request?: Request;
  public readonly isAbort?: boolean;
  public readonly isRetryable?: boolean; // новое поле

  constructor(
    message: string,
    options: {
      status?: number;
      statusText?: string;
      response?: Response;
      body?: any;
      request?: Request;
      isAbort?: boolean;
      isRetryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'SafeFetchError';
    if (options.status !== undefined) this.status = options.status;
    if (options.statusText !== undefined) this.statusText = options.statusText;
    if (options.response !== undefined) this.response = options.response;
    if (options.body !== undefined) this.body = options.body;
    if (options.request !== undefined) this.request = options.request;
    if (options.isAbort !== undefined) this.isAbort = options.isAbort;
    if (options.isRetryable !== undefined) this.isRetryable = options.isRetryable;
  }
}