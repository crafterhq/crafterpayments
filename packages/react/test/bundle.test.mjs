import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const external = ['react', 'react/jsx-runtime', 'react-dom', '@crafterpayments/js'];

test('ESM and CJS entries start with "use client"', () => {
  for (const file of ['dist/index.mjs', 'dist/index.cjs']) {
    assert.ok(read(file).startsWith('"use client";'), file);
  }
});

test('CJS entry loads and exposes the API', () => {
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/index.cjs');
  for (const name of ['CrafterPaymentsProvider', 'useCrafterPayments', 'useCheckout', 'CheckoutButton', 'EmbeddedCheckout', 'useCheckoutReturn', 'handleReturn', 'CrafterPaymentsError']) {
    assert.equal(typeof cjs[name], 'function', name);
  }
});

test('only react and @crafterpayments/js are imported; no other runtime dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@crafterpayments/js']);
  assert.deepEqual(Object.keys(pkg.peerDependencies), ['react']);
  assert.match(pkg.peerDependencies.react, /\^18/);
  assert.match(pkg.peerDependencies.react, /\^19/);
  const specifiers = [...read('dist/index.mjs').matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), ['@crafterpayments/js', 'react', 'react/jsx-runtime']);
});

test('tree-shakeable: importing useCheckoutReturn drops the components', async () => {
  const out = await build({
    stdin: { contents: "export { useCheckoutReturn } from './dist/index.mjs';", resolveDir: new URL('.', root).pathname },
    bundle: true,
    minify: true,
    format: 'esm',
    external,
    write: false,
    logLevel: 'silent',
  });
  // Import statements of externals stay; the code of unused exports must not
  const code = out.outputFiles[0].text.replace(/import\{[^}]*\}from"[^"]+";/g, '');
  assert.match(code, /useCheckoutReturn/);
  assert.doesNotMatch(code, /mountCheckout|aria-busy|crafterpayments-embedded|inside <CrafterPaymentsProvider>/);
});

test('package files contain no secret key sample or provider name', () => {
  for (const file of ['dist/index.mjs', 'dist/index.cjs', 'README.md']) {
    const text = read(file);
    assert.doesNotMatch(text, /cp_sk_(test|live)_[A-Za-z0-9]{8}/, file);
    assert.doesNotMatch(text, /stripe/i, file);
  }
});
