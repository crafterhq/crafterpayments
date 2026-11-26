import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';
import { SK, SK_LIVE, PK, SID, mockFetch, sessionBody, v1Error } from './helpers.mjs';

const mod = await import('../dist/index.mjs');
const { CrafterPayments } = mod;

const client = (fetch, config = {}) => new CrafterPayments(SK, { fetch, ...config });

test('CJS build exposes the same API', () => {
  const cjs = createRequire(import.meta.url)('../dist/index.cjs');
  assert.equal(typeof cjs.CrafterPayments, 'function');
  assert.equal(typeof cjs.webhooks.constructEvent, 'function');
  assert.equal(cjs.default, cjs.CrafterPayments);
});

test('key checks: secret keys accepted, publishable and malformed keys rejected', () => {
  assert.equal(new CrafterPayments(SK).livemode, false);
  assert.equal(new CrafterPayments(SK_LIVE).livemode, true);
  assert.throws(() => new CrafterPayments(PK), (e) => e instanceof mod.CrafterPaymentsError && e.type === 'publishable_key_not_allowed');
  assert.throws(() => new CrafterPayments(''), { type: 'invalid_api_key' });
  assert.throws(() => new CrafterPayments(undefined), { type: 'invalid_api_key' });
  assert.throws(() => new CrafterPayments('cp_rk_test_' + 'a'.repeat(30)), { type: 'invalid_api_key' });
  assert.throws(() => new CrafterPayments('sk_test_' + 'a'.repeat(30)), { type: 'invalid_api_key' });
  assert.throws(() => new CrafterPayments('cp_sk_test_short'), { type: 'invalid_api_key' });
});

test('the secret key is never serialized', () => {
  const c = new CrafterPayments(SK);
  assert.ok(!JSON.stringify(c).includes(SK));
  assert.ok(!inspect(c, { depth: 5 }).includes(SK));
});

test('environments and baseUrl', () => {
  assert.equal(new CrafterPayments(SK).baseUrl, 'https://api.crafterpayments.com/v1');
  assert.equal(new CrafterPayments(SK, { environment: 'development' }).baseUrl, 'https://dev-api.crafterpayments.com/v1');
  assert.equal(new CrafterPayments(SK, { baseUrl: 'http://localhost:3001/v1/' }).baseUrl, 'http://localhost:3001/v1');
  assert.throws(() => new CrafterPayments(SK, { baseUrl: 'http://example.com/v1' }), { type: 'invalid_options' });
  assert.throws(() => new CrafterPayments(SK, { environment: 'staging' }), { type: 'invalid_options' });
});

test('create sends auth, version and an automatic Idempotency-Key', async () => {
  const fetch = mockFetch([{ status: 201, body: sessionBody(), headers: { 'x-request-id': 'req_abc', 'crafter-version': '2026-12' } }]);
  const session = await client(fetch).checkoutSessions.create({ lineItems: [{ productId: 'prod_1', quantity: 1 }] });
  assert.equal(session.id, SID);
  const [call] = fetch.calls;
  assert.equal(call.url, 'https://api.crafterpayments.com/v1/checkout/sessions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${SK}`);
  assert.equal(call.headers['Crafter-Version'], '2026-12');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.match(call.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.match(call.headers['User-Agent'], /^crafterpayments-node\/0\.1\.0 node\//);
  assert.deepEqual(call.body, { lineItems: [{ productId: 'prod_1', quantity: 1 }] });
  assert.equal(session.lastResponse.requestId, 'req_abc');
  assert.equal(session.lastResponse.idempotencyKey, call.headers['Idempotency-Key']);
  assert.ok(!Object.keys(session).includes('lastResponse'));
});

test('a provided Idempotency-Key and apiVersion are used', async () => {
  const fetch = mockFetch([{ status: 201, body: sessionBody(), headers: { 'idempotent-replayed': 'true' } }]);
  const session = await client(fetch, { apiVersion: '2026-12' }).checkoutSessions.create(
    { lineItems: [{ productId: 'p', quantity: 2 }] },
    { idempotencyKey: 'order-42' },
  );
  assert.equal(fetch.calls[0].headers['Idempotency-Key'], 'order-42');
  assert.equal(session.lastResponse.idempotentReplayed, true);
  await assert.rejects(
    client(fetch).checkoutSessions.create({ lineItems: [] }, { idempotencyKey: 'x'.repeat(256) }),
    { type: 'invalid_options' },
  );
});

test('retrieve and cancel hit the right paths; GET has no Idempotency-Key', async () => {
  const fetch = mockFetch([{ body: sessionBody() }, { body: sessionBody({ status: 'canceled' }) }]);
  const c = client(fetch);
  await c.checkoutSessions.retrieve(SID);
  const canceled = await c.checkoutSessions.cancel(SID);
  assert.equal(fetch.calls[0].url, `https://api.crafterpayments.com/v1/checkout/sessions/${SID}`);
  assert.equal(fetch.calls[0].init.method, 'GET');
  assert.equal(fetch.calls[0].headers['Idempotency-Key'], undefined);
  assert.equal(fetch.calls[1].url, `https://api.crafterpayments.com/v1/checkout/sessions/${SID}/cancel`);
  assert.equal(fetch.calls[1].init.method, 'POST');
  assert.ok(fetch.calls[1].headers['Idempotency-Key']);
  assert.equal(canceled.status, 'canceled');
  assert.throws(() => c.checkoutSessions.retrieve('../admin'), { type: 'invalid_session_id' });
});

test('licenses.verify and deactivate', async () => {
  const fetch = mockFetch([
    { body: { valid: true, status: 'active', productId: 'p', expiresAt: null, activations: { used: 1, max: 3 }, customer: { id: 'u' } } },
    { body: { success: true, activations: { used: 0, max: 3 } } },
  ]);
  const c = client(fetch);
  const result = await c.licenses.verify({ licenseKey: 'K', productId: 'p', fingerprint: 'host', activate: true });
  assert.equal(result.valid, true);
  await c.licenses.deactivate({ licenseKey: 'K', productId: 'p', fingerprint: 'host' });
  assert.equal(fetch.calls[0].url, 'https://api.crafterpayments.com/v1/licenses/verify');
  assert.equal(fetch.calls[1].url, 'https://api.crafterpayments.com/v1/licenses/deactivate');
});

test('retries 5xx and 429 with the same Idempotency-Key', async () => {
  const fetch = mockFetch([
    { status: 503, body: v1Error('service_unavailable', 'The service is temporarily unavailable.'), headers: { 'retry-after': '0' } },
    { status: 429, body: v1Error('too_many_requests', 'Too many requests.'), headers: { 'retry-after': '0' } },
    { status: 201, body: sessionBody() },
  ]);
  await client(fetch).checkoutSessions.create({ lineItems: [{ productId: 'p', quantity: 1 }] });
  assert.equal(fetch.calls.length, 3);
  const keys = new Set(fetch.calls.map((c) => c.headers['Idempotency-Key']));
  assert.equal(keys.size, 1);
});

test('retries network errors, then raises a connection error', async () => {
  const ok = mockFetch([new TypeError('fetch failed'), { status: 201, body: sessionBody() }]);
  await client(ok, { maxRetries: 1 }).checkoutSessions.create({ lineItems: [{ productId: 'p', quantity: 1 }] });
  assert.equal(ok.calls.length, 2);
  assert.equal(ok.calls[0].headers['Idempotency-Key'], ok.calls[1].headers['Idempotency-Key']);

  const down = mockFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]);
  await assert.rejects(
    client(down, { maxRetries: 1 }).checkoutSessions.retrieve(SID),
    (e) => e instanceof mod.CrafterPaymentsConnectionError && e.type === 'connection_error',
  );
});

test('does not retry 4xx errors', async () => {
  const fetch = mockFetch([{ status: 409, body: v1Error('checkout_session_not_open', 'This checkout session is no longer open.', { details: { status: 'complete' } }) }]);
  await assert.rejects(client(fetch).checkoutSessions.cancel(SID), (e) => {
    assert.ok(e instanceof mod.CrafterPaymentsConflictError);
    assert.equal(e.type, 'checkout_session_not_open');
    assert.equal(e.status, 409);
    assert.equal(e.requestId, 'req_123');
    assert.deepEqual(e.details, { status: 'complete' });
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test('maxRetries 0 surfaces the 5xx error', async () => {
  const fetch = mockFetch([{ status: 500, body: v1Error('internal_server_error', 'An internal error occurred.') }]);
  await assert.rejects(client(fetch, { maxRetries: 0 }).checkoutSessions.retrieve(SID), (e) => e instanceof mod.CrafterPaymentsAPIError && e.status === 500);
});

test('timeout is retried and reported as a timeout', async () => {
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const fetch = mockFetch([hang, hang]);
  await assert.rejects(client(fetch, { timeoutMs: 20, maxRetries: 1 }).checkoutSessions.retrieve(SID), { type: 'timeout' });
  assert.equal(fetch.calls.length, 2);
});

test('error mapping by status and type', async () => {
  const cases = [
    [401, 'api_key_invalid', mod.CrafterPaymentsAuthenticationError],
    [403, 'api_key_wrong_type', mod.CrafterPaymentsPermissionError],
    [400, 'validation_failed', mod.CrafterPaymentsInvalidRequestError],
    [404, 'checkout_session_not_found', mod.CrafterPaymentsNotFoundError],
    [409, 'idempotency_key_reused', mod.CrafterPaymentsConflictError],
    [429, 'too_many_requests', mod.CrafterPaymentsRateLimitError],
  ];
  for (const [status, type, Klass] of cases) {
    const fetch = mockFetch([{ status, body: v1Error(type, 'msg', { param: status === 400 ? 'lineItems' : null }), headers: { 'retry-after': '7' } }]);
    await assert.rejects(client(fetch, { maxRetries: 0 }).checkoutSessions.retrieve(SID), (e) => {
      assert.ok(e instanceof Klass, `${status} -> ${Klass.name}`);
      assert.ok(e instanceof mod.CrafterPaymentsError);
      assert.equal(e.type, type);
      assert.equal(e.status, status);
      assert.equal(e.message, 'msg');
      if (status === 400) assert.equal(e.param, 'lineItems');
      if (status === 429) assert.equal(e.retryAfter, 7);
      return true;
    });
  }
});

test('flat error bodies (endpoints not yet on the /v1 format) are mapped too', async () => {
  const fetch = mockFetch([
    { status: 400, body: { success: false, type: 'validation_failed', message: ['licenseKey must be a string'], errors: { licenseKey: 'isString' } }, headers: { 'x-request-id': 'req_flat' } },
  ]);
  await assert.rejects(client(fetch).licenses.verify({}), (e) => {
    assert.ok(e instanceof mod.CrafterPaymentsInvalidRequestError);
    assert.equal(e.type, 'validation_failed');
    assert.equal(e.param, 'licenseKey');
    assert.equal(e.requestId, 'req_flat');
    return true;
  });
});

test('non-JSON error bodies get a generic type', async () => {
  const fetch = mockFetch([new Response('<html>Bad gateway</html>', { status: 502 })]);
  await assert.rejects(client(fetch, { maxRetries: 0 }).checkoutSessions.retrieve(SID), (e) => e instanceof mod.CrafterPaymentsAPIError && e.type === 'internal_server_error');
});
