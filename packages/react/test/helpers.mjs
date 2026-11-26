import { mock } from 'node:test';
import { JSDOM } from 'jsdom';

export const PK = 'cp_pk_test_' + 'a'.repeat(32);
export const SK = 'cp_sk_test_' + 'c'.repeat(32);
export const SID = 'cs_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
export const SECRET = `${SID}_secret_` + 'Z'.repeat(24);

/** jsdom window bound to the globals React DOM expects. Call before importing react-dom. */
export function setupDom(url = 'https://shop.example.com/cart') {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.MessageEvent = window.MessageEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { dom, window };
}

export class FakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CrafterPaymentsError';
    this.code = code;
  }
}

/** Minimal controller with on/emit/close, recording calls. */
export function fakeController(extra = {}) {
  const handlers = {};
  const controller = {
    closed: 0,
    destroyed: 0,
    on(event, fn) {
      (handlers[event] ??= new Set()).add(fn);
      return controller;
    },
    off(event, fn) {
      handlers[event]?.delete(fn);
      return controller;
    },
    emit(event, payload) {
      for (const fn of handlers[event] ?? []) fn(payload);
    },
    close() {
      controller.closed++;
      controller.emit('close', {});
    },
    destroy() {
      controller.destroyed++;
    },
    result: Promise.resolve(null),
    ...extra,
  };
  return controller;
}

/** Fake `@crafterpayments/js` client; records open / mount / redirect calls. */
export function fakeClient() {
  const client = {
    opened: [],
    mounted: [],
    redirects: [],
    open(options) {
      const controller = fakeController();
      client.opened.push({ options, controller });
      return controller;
    },
    mountCheckout(element, options) {
      const iframe = element.ownerDocument.createElement('iframe');
      element.appendChild(iframe);
      const controller = fakeController({ iframe });
      controller.destroy = () => {
        controller.destroyed++;
        iframe.remove();
      };
      client.mounted.push({ element, options, controller });
      return controller;
    },
    async redirectToCheckout(options) {
      client.redirects.push(options);
    },
  };
  return client;
}

/** Shape of the mocked module; tests swap `state.client` / `state.returnResult`. */
export function jsMock(state) {
  return {
    CrafterPaymentsError: FakeError,
    loadCrafterPayments: async (key, options) => {
      state.loads.push({ key, options });
      if (state.loadError) throw state.loadError;
      return state.client;
    },
    handleReturn: async (options) => {
      state.returns.push(options);
      return state.returnResult ?? null;
    },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Loads React + the built package after the DOM globals exist. */
export async function loadReact() {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const lib = await import('../dist/index.mjs');
  const h = React.createElement;
  async function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => root.render(element));
    return {
      container,
      rerender: (next) => React.act(async () => root.render(next)),
      unmount: () => React.act(async () => root.unmount()),
    };
  }
  return { React, h, act: React.act, render, lib };
}

/** Replaces `@crafterpayments/js` with `jsMock(state)` for every later import (call before loadReact). */
export function mockJs(state) {
  const exports = jsMock(state);
  // `exports` replaced `namedExports` in newer Node versions
  const major = Number(process.versions.node.split('.')[0]);
  mock.module('@crafterpayments/js', major >= 26 ? { exports } : { namedExports: exports });
}
