import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, SK, SECRET, loadReact, setupDom } from './helpers.mjs';

// Uses the real @crafterpayments/js (no mock): key checks are inherited from it
setupDom();
const { h, React, render, lib } = await loadReact();

test('secret key is rejected by the provider (secret_key_in_browser)', async () => {
  let value;
  function Probe() {
    value = lib.useCrafterPayments();
    return h(lib.CheckoutButton, { createSession: async () => ({ sessionId: 'x' }) }, 'Pay');
  }
  const view = await render(h(lib.CrafterPaymentsProvider, { publishableKey: SK }, h(Probe)));
  assert.equal(value.crafter, null);
  assert.equal(value.loading, false);
  assert.ok(value.error instanceof lib.CrafterPaymentsError);
  assert.equal(value.error.code, 'secret_key_in_browser');
  assert.equal(view.container.querySelector('button').disabled, true);
  await view.unmount();
});

test('secret key as clientSecret is rejected by EmbeddedCheckout; a valid one mounts and unmount removes the iframe', async () => {
  const errors = [];
  const view = await render(
    h(React.StrictMode, null,
      h(lib.CrafterPaymentsProvider, { publishableKey: PK },
        h(lib.EmbeddedCheckout, { clientSecret: SK, onError: (e) => errors.push(e.code) }))),
  );
  assert.ok(errors.length >= 1);
  assert.ok(errors.every((c) => c === 'secret_key_in_browser'));
  assert.equal(document.querySelectorAll('iframe').length, 0);
  await view.unmount();

  const ok = await render(
    h(React.StrictMode, null,
      h(lib.CrafterPaymentsProvider, { publishableKey: PK },
        h(lib.EmbeddedCheckout, { clientSecret: SECRET, loadTimeoutMs: 60000, onError: () => {} }))),
  );
  const frames = document.querySelectorAll('iframe');
  assert.equal(frames.length, 1, 'StrictMode leaves one iframe');
  assert.match(frames[0].src, /^https:\/\/checkout\.crafterpayments\.com\/embed\/cs_test_/);
  assert.doesNotMatch(frames[0].src, /_secret_/);
  await ok.unmount();
  assert.equal(document.querySelectorAll('iframe').length, 0);
});
