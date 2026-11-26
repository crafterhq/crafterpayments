import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, SID, SECRET, fakeClient, loadReact, mockJs, setupDom } from './helpers.mjs';

const state = { loads: [], returns: [], client: fakeClient() };
mockJs(state);
const { window } = setupDom();
const { h, React, act, render, lib } = await loadReact();

const withProvider = (child, options) => h(lib.CrafterPaymentsProvider, { publishableKey: PK, options }, child);

test('CheckoutButton opens synchronously inside the click handler', async () => {
  const client = fakeClient();
  state.client = client;
  const createSession = async () => ({ sessionId: SID, clientSecret: SECRET });
  const view = await render(
    withProvider(h(lib.CheckoutButton, { createSession, mode: 'popup', className: 'pay' }, 'Pay'), {
      appearance: { theme: 'dark' },
    }),
  );
  const button = view.container.querySelector('button');
  assert.equal(button.textContent, 'Pay');
  assert.equal(button.type, 'button');
  assert.equal(button.className, 'pay');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), null);

  let openedDuringDispatch = 0;
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // Nothing awaited yet: open() must already have run inside the event
    openedDuringDispatch = client.opened.length;
  });
  assert.equal(openedDuringDispatch, 1);
  const { options } = client.opened[0];
  assert.equal(options.createSession, createSession);
  assert.equal(options.mode, 'popup');
  assert.deepEqual(options.appearance, { theme: 'dark' }, 'provider appearance is the default');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.disabled, true, 'no double click while the session is created');
  await act(async () => client.opened[0].controller.emit('ready', { sessionId: SID }));
  assert.equal(button.disabled, false);
  await view.unmount();
});

test('CheckoutButton: onClick preventDefault skips checkout; no client means disabled', async () => {
  const client = fakeClient();
  state.client = client;
  const view = await render(
    withProvider(h(lib.CheckoutButton, { createSession: async () => ({ sessionId: SID }), onClick: (e) => e.preventDefault() })),
  );
  await act(async () => view.container.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.equal(client.opened.length, 0);
  await view.unmount();

  state.client = null; // e.g. load resolved to null
  const view2 = await render(withProvider(h(lib.CheckoutButton, { createSession: async () => ({ sessionId: SID }) })));
  assert.equal(view2.container.querySelector('button').disabled, true);
  await view2.unmount();
});

test('CheckoutButton: loading state renders aria-busy', async () => {
  let resolve;
  state.client = new Promise((r) => (resolve = r)); // the mock returns this promise => pending load
  const client = fakeClient();
  const view = await render(withProvider(h(lib.CheckoutButton, { createSession: async () => ({ sessionId: SID }) })));
  const button = view.container.querySelector('button');
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.textContent, 'Checkout');
  await act(async () => resolve(client));
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), null);
  await view.unmount();
});

test('useCheckout: events are mapped to status/result and callbacks', async () => {
  const client = fakeClient();
  state.client = client;
  const seen = [];
  let api;
  function Shop() {
    api = lib.useCheckout({
      onLoaded: (e) => seen.push(['loaded', e.sessionId]),
      onComplete: (r) => seen.push(['complete', r.orderId]),
      onPaymentFailed: (e) => seen.push(['failed', e.code]),
      onError: (e) => seen.push(['error', e.code]),
    });
    return h('output', null, api.status);
  }
  const view = await render(withProvider(h(Shop)));
  assert.equal(api.status, 'idle');
  assert.equal(api.ready, true);
  let controller;
  await act(async () => {
    controller = api.open({ sessionId: SID, clientSecret: SECRET, mode: 'modal' });
  });
  assert.equal(controller, client.opened[0].controller);
  assert.equal(api.status, 'opening');
  await act(async () => controller.emit('ready', { sessionId: SID }));
  assert.equal(api.status, 'open');
  await act(async () => controller.emit('payment_failed', { sessionId: SID, code: 'card_declined' }));
  assert.equal(api.status, 'open');
  const result = { sessionId: SID, status: 'complete', orderId: 'CR-1', verified: true };
  await act(async () => controller.emit('complete', result));
  assert.equal(api.status, 'complete');
  assert.deepEqual(api.result, result);
  assert.deepEqual(seen, [['loaded', SID], ['failed', 'card_declined'], ['complete', 'CR-1']]);
  assert.equal(view.container.textContent, 'complete');

  // A new open() closes the previous controller; its late events are ignored
  let second;
  await act(async () => {
    second = api.open({ sessionId: SID });
  });
  await act(async () => controller.emit('cancel', { sessionId: SID, status: 'canceled', verified: false }));
  assert.equal(api.status, 'opening');
  await act(async () => second.emit('error', { error: Object.assign(new Error('x'), { code: 'popup_blocked' }) }));
  assert.equal(api.status, 'error');
  assert.equal(api.error.code, 'popup_blocked');

  await act(async () => api.close());
  // Unmount closes the open controller
  const third = await act(async () => api.open({ sessionId: SID }));
  void third;
  const last = client.opened.at(-1).controller;
  await view.unmount();
  assert.equal(last.closed, 1);
});

test('useCheckout: synchronous errors from open() and redirect()', async () => {
  const client = fakeClient();
  client.open = () => {
    throw Object.assign(new Error('Secret key in browser'), { code: 'secret_key_in_browser' });
  };
  state.client = client;
  const errors = [];
  let api;
  function Shop() {
    api = lib.useCheckout({ onError: (e) => errors.push(e.code) });
    return null;
  }
  const view = await render(withProvider(h(Shop)));
  await act(async () => {
    assert.equal(api.open({ clientSecret: 'cp_sk_test_x' }), null);
  });
  assert.equal(api.status, 'error');
  assert.deepEqual(errors, ['secret_key_in_browser']);
  await act(async () => api.redirect({ sessionId: SID }));
  assert.deepEqual(client.redirects, [{ sessionId: SID }]);
  assert.equal(api.status, 'redirecting');
  await view.unmount();
});
