import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, SECRET, SID, fakeClient, mockJs } from './helpers.mjs';

// No DOM globals in this file: server rendering must not touch window/document
const state = { loads: [], returns: [], client: fakeClient() };
mockJs(state);

test('SSR: renders children and placeholders without touching window', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const guard = new Proxy({}, { get: () => { throw new Error('window accessed during SSR'); } });
  const React = await import('react');
  const { renderToString } = await import('react-dom/server');
  const lib = await import('../dist/index.mjs');
  const h = React.createElement;
  let checkout;
  let returned;
  function Status() {
    const { crafter, loading } = lib.useCrafterPayments();
    checkout = lib.useCheckout();
    returned = lib.useCheckoutReturn();
    return h('span', null, `${crafter === null}|${loading}`);
  }
  // Any window access from here on throws
  Object.defineProperty(globalThis, 'window', { get: () => guard, configurable: true });
  let html;
  try {
    html = renderToString(
      h(lib.CrafterPaymentsProvider, { publishableKey: PK },
        h('main', null,
          h(Status),
          h(lib.CheckoutButton, { createSession: async () => ({ sessionId: SID }) }, 'Pay'),
          h(lib.EmbeddedCheckout, { clientSecret: SECRET, id: 'embed' }))),
    );
  } finally {
    delete globalThis.window;
  }
  assert.match(html, /<span>true\|true<\/span>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Pay<\/button>/);
  assert.match(html, /<div id="embed" data-crafterpayments-embedded=""><\/div>/);
  assert.equal(checkout.status, 'idle');
  assert.equal(checkout.ready, false);
  assert.deepEqual(returned, { result: null, loading: true });
  assert.equal(state.loads.length, 0, 'the client is not loaded on the server');
  assert.equal(state.returns.length, 0);
});
