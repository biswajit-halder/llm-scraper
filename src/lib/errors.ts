export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'SSRF_BLOCKED'
  | 'ROBOTS_DISALLOWED'
  | 'FETCH_FAILED'
  | 'UNSUPPORTED_CONTENT'
  | 'CONTENT_TRUNCATED'
  | 'QUOTA_EXHAUSTED'
  | 'UPSTREAM_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super('VALIDATION_ERROR', 400, message, false, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'A valid API key is required') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Rate limit exceeded for this API key', retryAfter = 60) {
    super('RATE_LIMITED', 429, message, true, undefined, retryAfter);
  }
}

export class SsrfBlockedError extends AppError {
  constructor(message: string) {
    super('SSRF_BLOCKED', 400, message);
  }
}

export class RobotsDisallowedError extends AppError {
  constructor(host: string) {
    super('ROBOTS_DISALLOWED', 403, `robots.txt disallows scraping this path on ${host}`);
  }
}

export class FetchFailedError extends AppError {
  constructor(message: string) {
    super('FETCH_FAILED', 502, message, true);
  }
}

export class UnsupportedContentError extends AppError {
  constructor(message: string) {
    super('UNSUPPORTED_CONTENT', 415, message);
  }
}

export class ContentTruncatedError extends AppError {
  constructor(maxChars: number) {
    super(
      'CONTENT_TRUNCATED',
      422,
      `The page exceeded ${maxChars} characters. Refusing to extract from a partial page; raise options.max_chars.`,
      false,
      { maxChars },
    );
  }
}

export class QuotaExhaustedError extends AppError {
  constructor(retryAfter = 86_400) {
    super(
      'QUOTA_EXHAUSTED',
      429,
      'Shared OpenRouter free-model daily quota exhausted. No result was persisted.',
      true,
      undefined,
      retryAfter,
    );
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'Upstream model call failed', details?: unknown) {
    super('UPSTREAM_ERROR', 502, message, true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', 404, message);
  }
}
