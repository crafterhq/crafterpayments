/**
 * Errors thrown by the SDK.
 *
 * API errors come from the /v1 error body `{ error: { type, message, param, details, requestId } }`. Integrations
 * should branch on `type` (stable, e.g. `checkout_session_not_found`) and use `instanceof` for broad categories;
 * `message` is for humans and may change.
 */
export interface CrafterPaymentsErrorInit {
  type: string;
  message: string;
  status?: number;
  requestId?: string | null;
  param?: string | null;
  details?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

export class CrafterPaymentsError extends Error {
  /** Error type from the API (e.g. `checkout_session_not_found`) or an SDK type (e.g. `connection_error`) */
  readonly type: string;
  /** HTTP status; undefined for errors raised before or without a response */
  readonly status?: number;
  /** `requestId` of the failed request (also the `X-Request-Id` header); include it when contacting support */
  readonly requestId?: string;
  /** The request field the error is about, when known */
  readonly param?: string | null;
  /** Extra structured data (e.g. `{ errors }` for validation, `{ expected }` for a wrong key type) */
  readonly details?: unknown;
  /** Response headers (lower-case names) */
  readonly headers?: Record<string, string>;

  constructor(init: CrafterPaymentsErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.type = init.type;
    this.status = init.status;
    this.requestId = init.requestId ?? undefined;
    this.param = init.param ?? null;
    this.details = init.details;
    this.headers = init.headers;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

/** 401: missing, malformed or revoked API key */
export class CrafterPaymentsAuthenticationError extends CrafterPaymentsError {}
/** 403: wrong key type, exposed key, plan restriction */
export class CrafterPaymentsPermissionError extends CrafterPaymentsError {}
/** 400 / 422: invalid parameters (see `param` and `details`) */
export class CrafterPaymentsInvalidRequestError extends CrafterPaymentsError {}
/** 404: the resource does not exist (or is not visible to this key / mode) */
export class CrafterPaymentsNotFoundError extends CrafterPaymentsError {}
/** 409: state conflict (session not open, payment in progress, Idempotency-Key reuse) */
export class CrafterPaymentsConflictError extends CrafterPaymentsError {}
/** 429: rate limited; `retryAfter` seconds when the API sent Retry-After */
export class CrafterPaymentsRateLimitError extends CrafterPaymentsError {
  get retryAfter(): number | undefined {
    const raw = this.headers?.['retry-after'];
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
}
/** 5xx or an unexpected response */
export class CrafterPaymentsAPIError extends CrafterPaymentsError {}
/** Network failure or timeout (no response received) */
export class CrafterPaymentsConnectionError extends CrafterPaymentsError {}
/** Webhook or return signature could not be verified */
export class CrafterPaymentsSignatureVerificationError extends CrafterPaymentsError {}

/** Picks the error class for an HTTP status */
export function errorClassForStatus(status: number): typeof CrafterPaymentsError {
  if (status === 401) return CrafterPaymentsAuthenticationError;
  if (status === 403) return CrafterPaymentsPermissionError;
  if (status === 404) return CrafterPaymentsNotFoundError;
  if (status === 409) return CrafterPaymentsConflictError;
  if (status === 429) return CrafterPaymentsRateLimitError;
  if (status === 400 || status === 422 || status === 413 || status === 415) return CrafterPaymentsInvalidRequestError;
  if (status >= 500) return CrafterPaymentsAPIError;
  return CrafterPaymentsError;
}

const GENERIC_TYPES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

/**
 * Builds a typed error from a response body. Understands the /v1 body (`{ error: {...} }`) and, for endpoints that
 * are not yet on the /v1 error format, the flat `{ success: false, type, message }` body.
 */
export function errorFromResponse(status: number, body: unknown, headers: Record<string, string>): CrafterPaymentsError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const inner =
    record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : record;
  const type =
    typeof inner.type === 'string' && inner.type
      ? inner.type
      : GENERIC_TYPES[status] ?? (status >= 500 ? 'internal_server_error' : 'api_error');
  const rawMessage = Array.isArray(inner.message) ? inner.message.join('; ') : inner.message;
  const message =
    typeof rawMessage === 'string' && rawMessage ? rawMessage : `Request failed with status ${status}.`;
  let details = inner.details;
  let param = typeof inner.param === 'string' ? inner.param : null;
  if (!details && inner.errors && typeof inner.errors === 'object') {
    details = { errors: inner.errors };
    param = param ?? Object.keys(inner.errors as object)[0] ?? null;
  }
  const requestId =
    (typeof inner.requestId === 'string' && inner.requestId) || headers['x-request-id'] || undefined;
  const ErrorClass = errorClassForStatus(status);
  return new ErrorClass({ type, message, status, requestId, param, details, headers });
}
