import { createHmac } from 'node:crypto';

export const SK = 'cp_sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
export const SK_LIVE = 'cp_sk_live_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6';
export const PK = 'cp_pk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
export const SID = 'cs_test_' + 'Ab12Cd34Ef56Gh78Ij90Kl12';

/** Copy of the backend signer (src/modules/website/marketplace/digital/webhooks/webhook-signing.ts, signWebhook) */
export function backendSignWebhook(secret, timestamp, body) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Copy of the backend signer (src/modules/website/headless/return-signature.ts, signReturn) */
export function backendSignReturn(secret, sessionId, status, timestamp) {
  return createHmac('sha256', secret).update(`${timestamp}.${sessionId}.${status}`).digest('hex');
}

/**
 * Mock fetch: `responses` is a list of (request) => Response | Error | { status, body, headers }.
 * Records every call in `calls`.
 */
export function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init) => {
    calls.push({ url, init, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('mockFetch: no more responses');
    const value = typeof next === 'function' ? await next(url, init) : next;
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return new Response(value.body === undefined ? '' : JSON.stringify(value.body), {
      status: value.status ?? 200,
      headers: { 'content-type': 'application/json', ...(value.headers ?? {}) },
    });
  };
  fn.calls = calls;
  return fn;
}

export function sessionBody(overrides = {}) {
  return {
    id: SID,
    object: 'checkout.session',
    livemode: false,
    status: 'open',
    paymentStatus: 'unpaid',
    uiMode: 'hosted',
    url: `https://checkout.crafterpayments.com/c/${SID}`,
    clientSecret: `${SID}_secret_abcdefghijklmnopqrstuvwx`,
    expiresAt: '2026-12-01T00:30:00.000Z',
    createdAt: '2026-12-01T00:00:00.000Z',
    storeCurrency: 'USD',
    amountSubtotal: 10,
    amountTotal: null,
    currency: null,
    lineItems: [{ productId: 'prod_1', name: 'VIP', quantity: 1, unitAmount: 10, currency: 'USD' }],
    customer: null,
    clientReferenceId: null,
    metadata: {},
    orderId: null,
    paymentId: null,
    completedAt: null,
    ...overrides,
  };
}

export function v1Error(type, message, extra = {}) {
  return { error: { type, message, param: null, requestId: 'req_123', ...extra } };
}
