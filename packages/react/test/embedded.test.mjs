import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, SID, SECRET, fakeClient, loadReact, mockJs, setupDom } from './helpers.mjs';

const state = { loads: [], returns: [], client: fakeClient() };
mockJs(state);
setupDom('https://shop.example.com/thanks?session_id=' + SID + '&cp_status=complete');
const { h, React, act, render, lib } = await loadReact();

const strict = (child, options) =>
  h(React.StrictMode, null, h(lib.CrafterPaymentsProvider, { publishableKey: PK, options }, child));
const live = (client) => client.mounted.filter((m) => m.controller.destroyed === 0);

test('EmbeddedCheckout: StrictMode double mount leaves exactly one live iframe', async () => {
  const client = fakeClient();
  state.client = client;
  const view = await render(strict(h(lib.EmbeddedCheckout, { clientSecret: SECRET, className: 'box' })));
  const box = view.container.querySelector('div.box');
  assert.ok(box);
  assert.ok(client.mounted.length >= 1);
  assert.equal(live(client).length, 1);
  assert.equal(box.querySelectorAll('iframe').length, 1);
  assert.equal(live(client)[0].element, box);
  assert.equal(live(client)[0].options.clientSecret, SECRET);
  await view.unmount();
  assert.equal(live(client).length, 0);
});

test('EmbeddedCheckout: unmount destroys; prop change remounts; appearance object identity does not', async () => {
  const client = fakeClient();
  state.client = client;
  const other = 'cs_test_' + 'Q'.repeat(24);
  const otherSecret = `${other}_secret_` + 'Y'.repeat(24);
  const view = await render(
    h(lib.CrafterPaymentsProvider, { publishableKey: PK, options: { appearance: { theme: 'dark' } } },
      h(lib.EmbeddedCheckout, { clientSecret: SECRET })),
  );
  assert.equal(client.mounted.length, 1);
  assert.deepEqual(client.mounted[0].options.appearance, { theme: 'dark' });
  await view.rerender(
    h(lib.CrafterPaymentsProvider, { publishableKey: PK, options: { appearance: { theme: 'dark' } } },
      h(lib.EmbeddedCheckout, { clientSecret: SECRET })),
  );
  assert.equal(client.mounted.length, 1, 'equal appearance does not remount');
  await view.rerender(
    h(lib.CrafterPaymentsProvider, { publishableKey: PK },
      h(lib.EmbeddedCheckout, { clientSecret: otherSecret, appearance: { theme: 'light' } })),
  );
  assert.equal(client.mounted.length, 2);
  assert.equal(client.mounted[0].controller.destroyed, 1);
  assert.equal(client.mounted[1].options.clientSecret, otherSecret);
  assert.deepEqual(client.mounted[1].options.appearance, { theme: 'light' });
  await view.unmount();
  assert.equal(client.mounted[1].controller.destroyed, 1);
});

test('EmbeddedCheckout: events reach the latest callbacks; none after unmount', async () => {
  const client = fakeClient();
  state.client = client;
  const seen = [];
  const tree = (tag) =>
    h(lib.CrafterPaymentsProvider, { publishableKey: PK },
      h(lib.EmbeddedCheckout, {
        clientSecret: SECRET,
        onLoaded: () => seen.push(`${tag}:loaded`),
        onComplete: (r) => seen.push(`${tag}:complete:${r.verified}`),
        onError: (e) => seen.push(`${tag}:error:${e.code}`),
      }));
  const view = await render(tree('a'));
  const { controller } = client.mounted[0];
  await act(async () => controller.emit('ready', { sessionId: SID }));
  await view.rerender(tree('b'));
  assert.equal(client.mounted.length, 1, 'new callbacks do not remount');
  await act(async () => controller.emit('complete', { sessionId: SID, status: 'complete', verified: true }));
  await act(async () => controller.emit('error', { error: { code: 'embed_load_timeout' } }));
  await view.unmount();
  controller.emit('complete', { sessionId: SID, status: 'complete', verified: true });
  assert.deepEqual(seen, ['a:loaded', 'b:complete:true', 'b:error:embed_load_timeout']);
});

test('EmbeddedCheckout: mount errors go to onError', async () => {
  const client = fakeClient();
  client.mountCheckout = () => {
    throw Object.assign(new Error('bad secret'), { code: 'invalid_client_secret' });
  };
  state.client = client;
  const errors = [];
  const view = await render(
    h(lib.CrafterPaymentsProvider, { publishableKey: PK },
      h(lib.EmbeddedCheckout, { clientSecret: 'x', onError: (e) => errors.push(e.code) })),
  );
  assert.deepEqual(errors, ['invalid_client_secret']);
  await view.unmount();
});

test('useCheckoutReturn runs handleReturn once (StrictMode) without a provider', async () => {
  state.returns = [];
  state.returnResult = { sessionId: SID, status: 'complete', signed: false, openedByCheckout: false };
  const log = [];
  function Thanks() {
    const value = lib.useCheckoutReturn({ closeWindow: false });
    log.push(value);
    return h('p', null, value.loading ? '…' : value.result?.status ?? 'none');
  }
  const view = await render(h(React.StrictMode, null, h(Thanks)));
  assert.equal(state.returns.length, 1);
  assert.deepEqual(state.returns[0], { closeWindow: false });
  assert.equal(log[0].loading, true);
  assert.equal(view.container.textContent, 'complete');
  assert.equal(lib.handleReturn, (await import('@crafterpayments/js')).handleReturn, 'handleReturn is re-exported');
  await view.unmount();
});
