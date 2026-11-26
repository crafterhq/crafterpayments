# CrafterPayments SDKs

Official client libraries for [CrafterPayments](https://crafterpayments.com) — the Crafter Checkout API.

| Package | Where it runs | Status |
|---|---|---|
| [`@crafterpayments/js`](packages/js) | Browser: redirect, popup and embedded checkout | Preview |
| `@crafterpayments/react` | React components and hooks | Planned |
| [`@crafterpayments/node`](packages/node) | Server (Node.js 18+): checkout sessions, licenses, webhook and return signature verification | Preview |

Secret keys (`cp_sk_…`) must only be used on your server. Browser packages accept publishable keys (`cp_pk_…`) only.

Docs: https://docs.crafter.net.tr/en/developers · License: MIT
