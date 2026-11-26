import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, fakeClient, loadReact, mockJs, setupDom } from './helpers.mjs';

const state = { loads: [], returns: [], client: fakeClient() };
mockJs(state);
setupDom();
const { h, React, render, lib } = await loadReact();

function Probe({ log }) {
  const value = lib.useCrafterPayments();
  log.push(value);
  return h('span', null, value.loading ? 'loading' : 'ready');
}

test('provider loads the client once (StrictMode, re-render with equal options)', async () => {
  state.loads = [];
  const log = [];
  const tree = (options) =>
    h(React.StrictMode, null, h(lib.CrafterPaymentsProvider, { publishableKey: PK, options }, h(Probe, { log })));
  const view = await render(tree({ environment: 'development', locale: 'en' }));
  await view.rerender(tree({ locale: 'en', environment: 'development' }));
  assert.equal(state.loads.length, 1);
  assert.deepEqual(state.loads[0], { key: PK, options: { environment: 'development', locale: 'en' } });
  assert.equal(log[0].loading, true);
  assert.equal(log[0].crafter, null);
  const last = log.at(-1);
  assert.equal(last.loading, false);
  assert.equal(last.crafter, state.client);
  assert.equal(last.error, null);
  assert.equal(view.container.textContent, 'ready');
  await view.unmount();
});

test('provider: appearance is not part of the load options; changing the key reloads', async () => {
  state.loads = [];
  const log = [];
  const view = await render(
    h(lib.CrafterPaymentsProvider, { publishableKey: PK, options: { appearance: { theme: 'dark' } } }, h(Probe, { log })),
  );
  assert.deepEqual(state.loads[0].options, {});
  const other = 'cp_pk_test_' + 'z'.repeat(32);
  await view.rerender(h(lib.CrafterPaymentsProvider, { publishableKey: other }, h(Probe, { log })));
  assert.equal(state.loads.length, 2);
  assert.equal(state.loads[1].key, other);
  await view.unmount();
});

test('provider: load error is exposed', async () => {
  state.loads = [];
  state.loadError = Object.assign(new Error('bad key'), { code: 'invalid_publishable_key' });
  const log = [];
  const view = await render(h(lib.CrafterPaymentsProvider, { publishableKey: 'nope' }, h(Probe, { log })));
  const last = log.at(-1);
  assert.equal(last.loading, false);
  assert.equal(last.crafter, null);
  assert.equal(last.error.code, 'invalid_publishable_key');
  state.loadError = undefined;
  await view.unmount();
});

test('hooks outside the provider throw a clear error', async () => {
  function Bad() {
    lib.useCrafterPayments();
    return null;
  }
  const errors = [];
  const original = console.error;
  console.error = () => {};
  try {
    await render(h(class extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(err) { errors.push(err); }
      render() { return this.state.failed ? null : h(Bad); }
    }));
  } finally {
    console.error = original;
  }
  assert.match(errors[0].message, /inside <CrafterPaymentsProvider>/);
});
