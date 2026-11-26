import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendSignWebhook, backendSignReturn, SID } from './helpers.mjs';

const mod = await import('../dist/index.mjs');
const { CrafterPayments, webhooks, verifyReturnSignature } = mod;

const SECRET = 'whsec_' + '0123456789abcdef'.repeat(3);
const OLD_SECRET = 'whsec_' + 'fedcba9876543210'.repeat(3);
const now = () => Math.floor(Date.now() / 1000);

const payload = JSON.stringify({
  event: 'checkout.completed',
  id: 'dlv_1',
  version: '2026-12',
  createdAt: '2026-12-01T00:00:00.000Z',
  livemode: false,
  data: { checkoutSession: { id: SID, clientReferenceId: 'order-42', metadata: {} }, orderId: 'ord_1', amount: 12.5, currency: 'USD' },
});

const isSigError = (type) => (e) => e instanceof mod.CrafterPaymentsSignatureVerificationError && e.type === type;

test('valid signature (backend signer) returns the parsed event', () => {
  const header = backendSignWebhook(SECRET, now(), payload);
  const event = webhooks.constructEvent(payload, header, SECRET);
  assert.equal(event.event, 'checkout.completed');
  assert.equal(event.data.checkoutSession.clientReferenceId, 'order-42');
  // Buffer body, static and instance access
  assert.equal(CrafterPayments.webhooks.constructEvent(Buffer.from(payload), header, SECRET).id, 'dlv_1');
  assert.equal(mod.constructEvent(new TextEncoder().encode(payload), header, SECRET).id, 'dlv_1');
});

test('fixed vector', () => {
  const header = backendSignWebhook('whsec_test', 1764547200, '{"a":1}');
  assert.equal(header, mod.generateTestHeader({ payload: '{"a":1}', secret: 'whsec_test', timestamp: 1764547200 }));
  assert.equal(mod.verifyWebhookSignature('{"a":1}', header, 'whsec_test', 300, 1764547200 + 299), 1764547200);
});

test('invalid signature: wrong secret, modified body, re-serialized JSON', () => {
  const header = backendSignWebhook(SECRET, now(), payload);
  assert.throws(() => webhooks.constructEvent(payload, header, OLD_SECRET), isSigError('webhook_signature_mismatch'));
  assert.throws(() => webhooks.constructEvent(payload.replace('12.5', '0.01'), header, SECRET), isSigError('webhook_signature_mismatch'));
  assert.throws(() => webhooks.constructEvent(JSON.stringify(JSON.parse(payload), null, 2), header, SECRET), isSigError('webhook_signature_mismatch'));
  assert.throws(() => webhooks.constructEvent(JSON.parse(payload), header, SECRET), isSigError('webhook_payload_invalid'));
});

test('missing or malformed header', () => {
  assert.throws(() => webhooks.constructEvent(payload, undefined, SECRET), isSigError('webhook_signature_missing'));
  assert.throws(() => webhooks.constructEvent(payload, 'garbage', SECRET), isSigError('webhook_signature_malformed'));
  assert.throws(() => webhooks.constructEvent(payload, `t=abc,v1=${'0'.repeat(64)}`, SECRET), isSigError('webhook_signature_malformed'));
  assert.throws(() => webhooks.constructEvent(payload, `t=${now()},v1=zz`, SECRET), isSigError('webhook_signature_mismatch'));
  assert.throws(() => webhooks.constructEvent(payload, 'sha256=' + '0'.repeat(64), SECRET), isSigError('webhook_signature_legacy_format'));
  assert.throws(() => webhooks.constructEvent(payload, backendSignWebhook(SECRET, now(), payload), ''), isSigError('webhook_secret_missing'));
});

test('expired and future timestamps are rejected; tolerance is configurable', () => {
  const old = backendSignWebhook(SECRET, now() - 301, payload);
  assert.throws(() => webhooks.constructEvent(payload, old, SECRET), isSigError('webhook_timestamp_outside_tolerance'));
  const future = backendSignWebhook(SECRET, now() + 400, payload);
  assert.throws(() => webhooks.constructEvent(payload, future, SECRET), isSigError('webhook_timestamp_outside_tolerance'));
  assert.equal(webhooks.constructEvent(payload, old, SECRET, 600).id, 'dlv_1');
  assert.equal(webhooks.constructEvent(payload, backendSignWebhook(SECRET, 1000, payload), SECRET, 0).id, 'dlv_1');
});

test('secret rotation: several secrets and several v1 signatures', () => {
  const t = now();
  const signedWithOld = backendSignWebhook(OLD_SECRET, t, payload);
  assert.equal(webhooks.constructEvent(payload, signedWithOld, [SECRET, OLD_SECRET]).id, 'dlv_1');
  const newSig = backendSignWebhook(SECRET, t, payload).split('v1=')[1];
  const both = `${signedWithOld},v1=${newSig}`;
  assert.equal(webhooks.constructEvent(payload, both, SECRET).id, 'dlv_1');
  assert.equal(webhooks.constructEvent(payload, both, OLD_SECRET).id, 'dlv_1');
  assert.throws(() => webhooks.constructEvent(payload, both, 'whsec_other'), isSigError('webhook_signature_mismatch'));
});

test('verifyReturnSignature accepts backend-signed returns', () => {
  const secret = 'crs_' + 'x'.repeat(40);
  const ts = now();
  const sig = backendSignReturn(secret, SID, 'complete', ts);
  const url = `https://shop.example.com/thanks?session_id=${SID}&cp_status=complete&cp_ts=${ts}&cp_sig=${sig}`;
  assert.deepEqual(verifyReturnSignature(url, secret), { sessionId: SID, status: 'complete', timestamp: ts });
  assert.ok(verifyReturnSignature(new URL(url), secret));
  assert.ok(verifyReturnSignature(new URL(url).searchParams, secret));
  assert.ok(verifyReturnSignature({ session_id: SID, cp_status: 'complete', cp_ts: String(ts), cp_sig: sig }, secret));
  assert.ok(CrafterPayments.verifyReturnSignature(url, secret));
});

test('verifyReturnSignature rejects tampered, expired or malformed returns', () => {
  const secret = 'crs_' + 'x'.repeat(40);
  const ts = now();
  const sig = backendSignReturn(secret, SID, 'canceled', ts);
  const q = (o) => ({ session_id: SID, cp_status: 'canceled', cp_ts: String(ts), cp_sig: sig, ...o });
  assert.equal(verifyReturnSignature(q({ cp_status: 'complete' }), secret), null);
  assert.equal(verifyReturnSignature(q({}), 'crs_other'), null);
  assert.equal(verifyReturnSignature(q({ cp_status: 'paid' }), secret), null);
  assert.equal(verifyReturnSignature(q({ cp_sig: 'abc' }), secret), null);
  assert.equal(verifyReturnSignature(q({ session_id: '' }), secret), null);
  assert.equal(verifyReturnSignature(q({}), ''), null);
  const oldTs = ts - 601;
  const oldSig = backendSignReturn(secret, SID, 'canceled', oldTs);
  assert.equal(verifyReturnSignature(q({ cp_ts: String(oldTs), cp_sig: oldSig }), secret), null);
  assert.ok(verifyReturnSignature(q({ cp_ts: String(oldTs), cp_sig: oldSig }), secret, { toleranceSec: 900 }));
});
