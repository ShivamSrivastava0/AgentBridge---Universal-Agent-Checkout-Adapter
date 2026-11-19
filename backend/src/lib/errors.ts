export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'out_of_stock'
  | 'invalid_mandate'
  | 'invalid_state'
  | 'payment_error'
  | 'rate_limited'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  out_of_stock: 409,
  invalid_mandate: 422,
  invalid_state: 409,
  payment_error: 502,
  rate_limited: 429,
  internal_error: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`);
