export const HTTP_ERROR_CODES = {
  HTTP_STATUS: 'HTTP_STATUS',
  CONTENT_TYPE: 'CONTENT_TYPE',
  ORIGIN_BLOCKED: 'ORIGIN_BLOCKED',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  UNKNOWN: 'UNKNOWN'
} as const;

export type HttpErrorCode = typeof HTTP_ERROR_CODES[keyof typeof HTTP_ERROR_CODES];

export interface HttpErrorOptions {
  status?: number;
  contentType?: string;
  origin?: string;
  name?: string;
  cause?: unknown;
}

export class HttpRequestError extends Error {
  readonly code: HttpErrorCode;
  readonly status?: number;
  readonly contentType?: string;
  readonly origin?: string;

  constructor(code: HttpErrorCode, message: string, options: HttpErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = options.name || 'HttpRequestError';
    this.code = code;
    this.status = options.status;
    this.contentType = options.contentType;
    this.origin = options.origin;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { HttpRequestError as HttpError };

function hasProperty(value: unknown, property: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && property in value;
}

export function getHttpErrorCode(error: unknown): HttpErrorCode | undefined {
  if (!hasProperty(error, 'code')) return undefined;
  const code = error.code;
  return typeof code === 'string' && Object.values(HTTP_ERROR_CODES).includes(code as HttpErrorCode)
    ? code as HttpErrorCode
    : undefined;
}

export function getHttpErrorStatus(error: unknown): number | undefined {
  if (!hasProperty(error, 'status')) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

export function getHttpErrorName(error: unknown): string | undefined {
  if (!hasProperty(error, 'name')) return undefined;
  return typeof error.name === 'string' ? error.name : undefined;
}

export function createUnknownHttpError(cause?: unknown): HttpRequestError {
  return new HttpRequestError(
    HTTP_ERROR_CODES.UNKNOWN,
    'Falha ao buscar ou interpretar o historico.',
    { cause }
  );
}
