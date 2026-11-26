import { createHmac, timingSafeEqual } from 'node:crypto';
import { CrafterPaymentsSignatureVerificationError } from './errors';
import type { ReturnStatus, WebhookEvent } from './types';

/**
 * Webhook signature (store webhooks, payload version 2026-12):
 *
 *   X-Crafter-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(endpointSecret, `${t}.${rawBody}`)>
 *
 * The signature covers the exact bytes of the request body, so verify the raw body before any JSON parsing.
 * Several `v1=` entries are accepted (any match passes), and several endpoint secrets can be passed while you
 * rotate a secret in the dashboard.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-crafter-signature';
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
export const DEFAULT_RETURN_TOLERANCE_SECONDS = 600;

type RawBody = string | Uint8Array;

function bodyToString(body: RawBody): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  throw new CrafterPaymentsSignatureVerificationError({
    type: 'webhook_payload_invalid',
    message:
      'The webhook payload must be the raw request body (string or Buffer), not a parsed object. ' +
      'Use express.raw({ type: "application/json" }) or `await request.text()`.',
  });
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function safeHexEqual(expectedHex: string, givenHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(givenHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const given = Buffer.from(givenHex, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function fail(type: string, message: string): never {
  throw new CrafterPaymentsSignatureVerificationError({ type, message });
}

function secretsOf(secret: string | readonly string[]): string[] {
  const list = (Array.isArray(secret) ? secret : [secret]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (list.length === 0) fail('webhook_secret_missing', 'An endpoint secret (whsec_…) is required to verify webhooks.');
  return list;
}

function headerValue(header: string | readonly string[] | null | undefined): string {
  if (Array.isArray(header)) return header.join(',');
  return typeof header === 'string' ? header : '';
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/** Parses `t=…,v1=…[,v1=…]`; unknown schemes are ignored */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') timestamp = /^\d+$/.test(value) ? Number(value) : NaN;
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verifies the signature header against the raw body and returns the timestamp.
 * Throws CrafterPaymentsSignatureVerificationError on any failure.
 */
export function verifyWebhookSignature(
  rawBody: RawBody,
  signatureHeader: string | readonly string[] | null | undefined,
  endpointSecret: string | readonly string[],
  toleranceSec: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  const body = bodyToString(rawBody);
  const secrets = secretsOf(endpointSecret);
  const header = headerValue(signatureHeader).trim();
  if (!header) fail('webhook_signature_missing', 'No X-Crafter-Signature header found on the request.');
  if (/^sha256=/i.test(header))
    fail(
      'webhook_signature_legacy_format',
      'This endpoint uses the legacy webhook format (sha256=…). Switch the endpoint to the 2026-12 format in the ' +
        'dashboard to use timestamped signatures.',
    );
  const parsed = parseSignatureHeader(header);
  if (!parsed) fail('webhook_signature_malformed', 'Unable to parse the X-Crafter-Signature header (expected t=…,v1=…).');
  if (toleranceSec > 0 && Math.abs(nowSeconds - parsed.timestamp) > toleranceSec)
    fail('webhook_timestamp_outside_tolerance', 'The webhook timestamp is outside the tolerance window.');
  const signedPayload = `${parsed.timestamp}.${body}`;
  for (const secret of secrets) {
    const expected = hmacHex(secret, signedPayload);
    for (const signature of parsed.signatures) {
      if (safeHexEqual(expected, signature)) return parsed.timestamp;
    }
  }
  return fail(
    'webhook_signature_mismatch',
    'No signature matches the expected signature for this payload. Check the endpoint secret and that the body is ' +
      'the raw, unmodified request body.',
  );
}

/**
 * Verifies a webhook and returns the parsed event.
 *
 * @param rawBody         Raw request body (string or Buffer), exactly as received
 * @param signatureHeader Value of the `X-Crafter-Signature` header
 * @param endpointSecret  Endpoint secret (`whsec_…`), or several while rotating
 * @param toleranceSec    Maximum age of the signature in seconds (default 300; 0 disables the check)
 */
export function constructEvent<T extends WebhookEvent = WebhookEvent>(
  rawBody: RawBody,
  signatureHeader: string | readonly string[] | null | undefined,
  endpointSecret: string | readonly string[],
  toleranceSec: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
): T {
  verifyWebhookSignature(rawBody, signatureHeader, endpointSecret, toleranceSec);
  try {
    return JSON.parse(bodyToString(rawBody)) as T;
  } catch (cause) {
    throw new CrafterPaymentsSignatureVerificationError({
      type: 'webhook_payload_invalid',
      message: 'The webhook payload is not valid JSON.',
      cause,
    });
  }
}

/** Builds a valid signature header, for testing your webhook handler */
export function generateTestHeader(input: { payload: string; secret: string; timestamp?: number }): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=${hmacHex(input.secret, `${timestamp}.${input.payload}`)}`;
}

export const webhooks = {
  constructEvent,
  verifySignature: verifyWebhookSignature,
  parseSignatureHeader,
  generateTestHeader,
};

// ---------------------------------------------------------------- Signed return

const RETURN_STATUSES: readonly ReturnStatus[] = ['complete', 'processing', 'canceled', 'expired'];

export type ReturnParamsInput = string | URL | URLSearchParams | Record<string, unknown>;

export interface VerifiedReturn {
  sessionId: string;
  status: ReturnStatus;
  timestamp: number;
}

function readReturnParams(input: ReturnParamsInput): Record<string, string> {
  let params: URLSearchParams | null = null;
  if (input instanceof URLSearchParams) params = input;
  else if (input instanceof URL) params = input.searchParams;
  else if (typeof input === 'string') {
    const query = input.includes('?') ? input.slice(input.indexOf('?') + 1) : input;
    params = new URLSearchParams(query.split('#')[0]);
  }
  const pick = (key: string): string => {
    if (params) return params.get(key) ?? '';
    const value = (input as Record<string, unknown>)[key];
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined || first === null ? '' : String(first);
  };
  return {
    session_id: pick('session_id'),
    cp_status: pick('cp_status'),
    cp_ts: pick('cp_ts'),
    cp_sig: pick('cp_sig'),
  };
}

/**
 * Verifies the signed return parameters appended to successUrl / cancelUrl:
 * `session_id`, `cp_status`, `cp_ts`, `cp_sig` = hex(HMAC-SHA256(returnSecret, `${cp_ts}.${session_id}.${cp_status}`)).
 *
 * A valid signature only proves the buyer was redirected by Crafter. Never fulfil an order from it: use the
 * `checkout.completed` webhook or `checkoutSessions.retrieve()` as the source of truth.
 *
 * @param input        The return URL, its query string, URLSearchParams or a parsed query object (e.g. `req.query`)
 * @param returnSecret The store's return signing secret (`crs_…`, dashboard → Headless and API)
 * @returns the verified values, or null when the signature is missing, invalid or too old
 */
export function verifyReturnSignature(
  input: ReturnParamsInput,
  returnSecret: string,
  options: { toleranceSec?: number; nowSeconds?: number } = {},
): VerifiedReturn | null {
  if (typeof returnSecret !== 'string' || !returnSecret) return null;
  const query = readReturnParams(input);
  const sessionId = query.session_id;
  const status = query.cp_status as ReturnStatus;
  const ts = /^\d+$/.test(query.cp_ts) ? Number(query.cp_ts) : NaN;
  const sig = query.cp_sig;
  if (!sessionId || !RETURN_STATUSES.includes(status)) return null;
  if (!Number.isSafeInteger(ts) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSec ?? DEFAULT_RETURN_TOLERANCE_SECONDS;
  if (tolerance > 0 && Math.abs(now - ts) > tolerance) return null;
  const expected = hmacHex(returnSecret, `${ts}.${sessionId}.${status}`);
  return safeHexEqual(expected, sig) ? { sessionId, status, timestamp: ts } : null;
}
