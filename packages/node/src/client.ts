import { randomUUID } from 'node:crypto';
import {
  CrafterPaymentsConnectionError,
  CrafterPaymentsError,
  CrafterPaymentsAPIError,
  errorFromResponse,
} from './errors';
import { CheckoutSessions } from './resources/checkout-sessions';
import { Licenses } from './resources/licenses';
import { webhooks, verifyReturnSignature } from './webhooks';
import type { CrafterPaymentsConfig, Environment, RequestOptions, ResponseInfo } from './types';

declare const __SDK_VERSION__: string;
export const SDK_VERSION: string = typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '0.0.0-dev';

/** API version this SDK release is written against */
export const API_VERSION = '2026-12';

export const BASE_URLS: Record<Environment, string> = {
  production: 'https://api.crafterpayments.com/v1',
  development: 'https://dev-api.crafterpayments.com/v1',
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

const SECRET_KEY = /^cp_sk_(test|live)_[A-Za-z0-9]{24,64}$/;

function configError(type: string, message: string): CrafterPaymentsError {
  return new CrafterPaymentsError({ type, message });
}

/** Validates a secret key and returns its mode */
export function assertSecretKey(key: unknown): { livemode: boolean } {
  if (typeof key !== 'string' || !key.trim())
    throw configError('invalid_api_key', 'A secret key is required: new CrafterPayments("cp_sk_test_…").');
  const value = key.trim();
  if (value.startsWith('cp_pk_'))
    throw configError(
      'publishable_key_not_allowed',
      'A publishable key (cp_pk_…) was passed. The server SDK needs a secret key (cp_sk_test_… or cp_sk_live_…); ' +
        'publishable keys belong in the browser SDK (@crafterpayments/js).',
    );
  const match = SECRET_KEY.exec(value);
  if (!match)
    throw configError(
      'invalid_api_key',
      'Invalid secret key. Expected a key starting with cp_sk_test_ or cp_sk_live_ (dashboard → Headless and API).',
    );
  return { livemode: match[1] === 'live' };
}

function resolveBaseUrl(config: CrafterPaymentsConfig): string {
  const environment = config.environment ?? 'production';
  if (!Object.prototype.hasOwnProperty.call(BASE_URLS, environment))
    throw configError('invalid_options', 'environment must be "production" or "development".');
  if (!config.baseUrl) return BASE_URLS[environment];
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw configError('invalid_options', 'baseUrl must be an absolute URL (including /v1).');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw configError('invalid_options', 'baseUrl must use https (http is allowed only for localhost).');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function nonNegativeInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw configError('invalid_options', `${field} must be a non-negative number.`);
  return Math.floor(value);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter; honours Retry-After (seconds) up to 60 s */
function retryDelayMs(attempt: number, retryAfter: string | undefined): number {
  const seconds = retryAfter === undefined ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const base = Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return base / 2 + Math.random() * (base / 2);
}

export interface RequestInput {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  options?: RequestOptions;
}

export class CrafterPayments {
  /** Webhook helpers; also available without a client as `CrafterPayments.webhooks` */
  static readonly webhooks = webhooks;
  static readonly verifyReturnSignature = verifyReturnSignature;
  readonly webhooks = webhooks;
  readonly verifyReturnSignature = verifyReturnSignature;

  readonly checkoutSessions: CheckoutSessions;
  readonly licenses: Licenses;

  /** true for cp_sk_live_ keys, false for test mode keys */
  readonly livemode: boolean;
  readonly apiVersion: string;
  readonly baseUrl: string;

  readonly #secretKey: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string;

  constructor(secretKey: string, config: CrafterPaymentsConfig = {}) {
    const { livemode } = assertSecretKey(secretKey);
    this.#secretKey = secretKey.trim();
    this.livemode = livemode;
    if (config.apiVersion !== undefined && (typeof config.apiVersion !== 'string' || !config.apiVersion.trim()))
      throw configError('invalid_options', 'apiVersion must be a version string such as "2026-12".');
    this.apiVersion = config.apiVersion?.trim() || API_VERSION;
    this.baseUrl = resolveBaseUrl(config);
    this.#timeoutMs = nonNegativeInt(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs') || DEFAULT_TIMEOUT_MS;
    this.#maxRetries = nonNegativeInt(config.maxRetries, DEFAULT_MAX_RETRIES, 'maxRetries');
    const fetchImpl = config.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!fetchImpl)
      throw configError('invalid_options', 'No fetch implementation found. Use Node.js 18+ or pass config.fetch.');
    this.#fetch = fetchImpl;
    const nodeVersion = typeof process !== 'undefined' ? process.version : 'unknown';
    this.#userAgent = `crafterpayments-node/${SDK_VERSION} node/${nodeVersion}${config.appInfo ? ` ${config.appInfo}` : ''}`;

    this.checkoutSessions = new CheckoutSessions(this);
    this.licenses = new Licenses(this);
  }

  /** Never print the key */
  toJSON() {
    return { livemode: this.livemode, apiVersion: this.apiVersion, baseUrl: this.baseUrl };
  }

  /**
   * Sends a request. Retries network errors, 429 and 5xx with backoff (up to maxRetries); POST requests always carry
   * an Idempotency-Key, and every retry reuses it so the API never performs the operation twice.
   */
  async request<T>({ method, path, body, options = {} }: RequestInput): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const maxRetries = nonNegativeInt(options.maxRetries, this.#maxRetries, 'maxRetries');
    const timeoutMs = nonNegativeInt(options.timeoutMs, this.#timeoutMs, 'timeoutMs') || this.#timeoutMs;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#secretKey}`,
      'Crafter-Version': this.apiVersion,
      Accept: 'application/json',
      'User-Agent': this.#userAgent,
    };
    let idempotencyKey: string | null = null;
    if (method === 'POST') {
      if (options.idempotencyKey !== undefined) {
        const key = String(options.idempotencyKey);
        if (key.length < 1 || key.length > 255)
          throw configError('invalid_options', 'idempotencyKey must be 1-255 characters.');
        idempotencyKey = key;
      } else {
        idempotencyKey = randomUUID();
      }
      headers['Idempotency-Key'] = idempotencyKey;
      headers['Content-Type'] = 'application/json';
    }
    const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      let response: Response;
      let text: string;
      try {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
        response = await this.#fetch(url, { method, headers, body: payload, signal: controller.signal });
        text = await response.text();
      } catch (cause) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (options.signal?.aborted)
          throw new CrafterPaymentsConnectionError({
            type: 'request_aborted',
            message: 'The request was aborted.',
            cause,
          });
        if (attempt < maxRetries) {
          await sleep(retryDelayMs(attempt, undefined));
          continue;
        }
        const timedOut = controller.signal.aborted;
        throw new CrafterPaymentsConnectionError({
          type: timedOut ? 'timeout' : 'connection_error',
          message: timedOut
            ? `The request timed out after ${timeoutMs} ms.`
            : `Could not connect to CrafterPayments (${(cause as Error)?.message ?? String(cause)}).`,
          cause,
        });
      }
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);

      const responseHeaders = headersToRecord(response.headers);
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, responseHeaders['retry-after']));
        continue;
      }

      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (!response.ok) throw errorFromResponse(response.status, parsed ?? text, responseHeaders);
      if (!parsed || typeof parsed !== 'object')
        throw new CrafterPaymentsAPIError({
          type: 'invalid_response',
          message: `Unexpected response from CrafterPayments (status ${response.status}).`,
          status: response.status,
          requestId: responseHeaders['x-request-id'] ?? null,
          headers: responseHeaders,
        });
      const info: ResponseInfo = {
        status: response.status,
        requestId: responseHeaders['x-request-id'] ?? null,
        apiVersion: responseHeaders['crafter-version'] ?? null,
        idempotentReplayed: responseHeaders['idempotent-replayed'] === 'true',
        idempotencyKey,
      };
      Object.defineProperty(parsed, 'lastResponse', { value: info, enumerable: false });
      return parsed as T;
    }
  }
}
