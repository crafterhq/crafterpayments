# @crafterpayments/react

React components and hooks for [CrafterPayments](https://crafterpayments.com) checkout. A thin layer over
[`@crafterpayments/js`](../js): it loads the client once, maps checkout events to React state and cleans up after
itself. Works with React 18 and 19, the Next.js App Router (`"use client"` is built in), Vite and any other React setup.

> Status: Preview (0.1.0). The API can still change before 1.0.

## Install

```bash
npm install @crafterpayments/react
```

`@crafterpayments/js` is installed with it. `react` (18 or 19) is a peer dependency. ESM, CommonJS and TypeScript
types are included; there are no other runtime dependencies.

## Ground rules

- Checkout sessions are **always created on your server** with a secret key (`cp_sk_…`). The browser only gets the
  publishable key (`cp_pk_…`), the session id and, when needed, the `clientSecret`.
- Passing a secret key to the provider or to a component fails with `secret_key_in_browser` (checked by
  `@crafterpayments/js`). If such a key ever reached browsers, roll it in the dashboard right away.
- Browser events (`onComplete`, …) are **not proof for fulfilment**. Deliver on the `checkout.completed` webhook or a
  server-side `GET /v1/checkout/sessions/:id`.

## API

| Export | What it does |
|---|---|
| `<CrafterPaymentsProvider publishableKey options>` | Loads the client once per key + options. `options`: `environment` (`production` / `development`), `locale`, `appearance` (default for everything below), `checkoutOrigin` / `apiBase` (local development). |
| `useCrafterPayments()` | `{ crafter, loading, error }`. `crafter` is `null` on the server and until loaded. |
| `useCheckout(callbacks?)` | `{ open, redirect, close, status, result, error, ready }`. `open(options)` wraps `crafter.open`, `redirect(options)` wraps `crafter.redirectToCheckout`. |
| `<CheckoutButton createSession mode …>` | Accessible button that opens checkout on click. |
| `<EmbeddedCheckout clientSecret …>` | Mounts embedded checkout into a div (Pro plans and above). |
| `useCheckoutReturn(options?)` | For your success / cancel page: `{ result, loading }`. |
| `handleReturn`, `CrafterPaymentsError` | Re-exported from `@crafterpayments/js`, along with its types. |

Callbacks (on `useCheckout`, `<CheckoutButton>` and `<EmbeddedCheckout>`): `onLoaded`, `onComplete`, `onCancel`,
`onExpired`, `onPaymentFailed`, `onClose` (not on `<EmbeddedCheckout>`), `onError`. They always see the latest props;
changing them does not reopen or remount checkout.

`status` from `useCheckout`: `idle` → `opening` → `open` → `complete` / `canceled` / `expired`, or `closed`,
`redirecting`, `error`.

### Call `open` inside the click handler

Browsers only allow a popup that opens **synchronously within a user click**. Call `open()` directly in the
`onClick` handler, with no `await` (or `setTimeout`, or state update round trip) before it. If you need to create the
session first, pass `createSession` instead of awaiting it yourself: the window or modal opens on the click with a
loading state, and checkout loads once your server responds.

```tsx
// Good
<button onClick={() => checkout.open({ createSession })}>Pay</button>

// Blocked as a popup: the window opens after an await
<button onClick={async () => { const s = await createSession(); checkout.open(s); }}>Pay</button>
```

`<CheckoutButton>` already does this for you.

## Next.js (App Router)

**1. Server route** that creates the session with the secret key. `app/api/checkout/route.ts`:

```ts
import { randomUUID } from 'node:crypto';

export async function POST(request: Request) {
  const { productId } = await request.json();
  const origin = new URL(request.url).origin;

  const res = await fetch('https://api.crafterpayments.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRAFTERPAYMENTS_SECRET_KEY}`, // cp_sk_test_… / cp_sk_live_…
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(), // required; reuse the same key when you retry the same request
      'Crafter-Version': '2026-12',
    },
    body: JSON.stringify({
      lineItems: [{ productId, quantity: 1 }],
      uiMode: 'hosted', // 'embedded' for <EmbeddedCheckout> and mode="modal"
      successUrl: `${origin}/checkout/return`,
      cancelUrl: `${origin}/checkout/return`,
    }),
  });
  const session = await res.json();
  if (!res.ok) {
    return Response.json({ error: session.error?.message ?? 'Checkout failed' }, { status: 502 });
  }
  // Only these go to the browser
  return Response.json({ sessionId: session.id, clientSecret: session.clientSecret, url: session.url });
}
```

Prices, tax and currency are always calculated by CrafterPayments; send product ids and quantities only. Add your site
origin to the store's **allowed origins** in the dashboard (return URLs and embedding are checked against that list).

**2. Provider** in a client component, `app/providers.tsx`:

```tsx
'use client';

import { CrafterPaymentsProvider } from '@crafterpayments/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CrafterPaymentsProvider
      publishableKey={process.env.NEXT_PUBLIC_CRAFTERPAYMENTS_PUBLISHABLE_KEY!} // cp_pk_…
      options={{ locale: 'en', appearance: { theme: 'auto' } }}
    >
      {children}
    </CrafterPaymentsProvider>
  );
}
```

Wrap your layout with it (`app/layout.tsx`: `<body><Providers>{children}</Providers></body>`). The provider renders its
children on the server as usual; the client loads in the browser after hydration.

**3. Button** — `app/product/buy-button.tsx`:

```tsx
'use client';

import { CheckoutButton } from '@crafterpayments/react';

export function BuyButton({ productId }: { productId: string }) {
  return (
    <CheckoutButton
      className="btn-primary"
      createSession={async () => {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId }),
        });
        if (!res.ok) throw new Error('Could not start checkout');
        return res.json(); // { sessionId, clientSecret, url }
      }}
      onComplete={(result) => console.log('paid', result.orderId)} // show a thank-you state; fulfil on the webhook
      onError={(error) => console.error(error.code)}
    >
      Buy now
    </CheckoutButton>
  );
}
```

`mode`: `auto` (default: popup on desktop, same-tab redirect on phones; change with `mobile="new_tab" | "modal"`),
`popup`, `modal` (needs `uiMode: "embedded"`) or `redirect`. Other props: `appearance`, `locale`, `onPopupBlocked`,
`closeOnEscape`, `closeOnBackdrop`, `autoCloseOnComplete`, plus normal button attributes. The button is disabled and
`aria-busy` while the client loads and while the session is being created.

**4. Return page** — `app/checkout/return/page.tsx`:

```tsx
'use client';

import { useCheckoutReturn } from '@crafterpayments/react';

export default function CheckoutReturn() {
  const { result, loading } = useCheckoutReturn();
  if (loading) return <p>Checking your payment…</p>;
  if (result?.status === 'complete') return <p>Thank you! Your order is being delivered.</p>;
  return <p>Payment was not completed.</p>;
}
```

If checkout ran in a popup, the hook tells the original tab about the result and closes the popup. The status in the
URL is only a hint for the screen.

## Vite (or any client-rendered app)

```tsx
// main.tsx
import { createRoot } from 'react-dom/client';
import { CrafterPaymentsProvider } from '@crafterpayments/react';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <CrafterPaymentsProvider publishableKey={import.meta.env.VITE_CRAFTERPAYMENTS_PUBLISHABLE_KEY}>
    <App />
  </CrafterPaymentsProvider>,
);
```

```tsx
// App.tsx — with the hook instead of the ready-made button
import { useCheckout } from '@crafterpayments/react';

export function App() {
  const checkout = useCheckout({
    onComplete: (result) => console.log('paid', result.sessionId),
  });

  const createSession = () =>
    fetch('/api/checkout', { method: 'POST' }).then((res) => res.json()); // your server, as in step 1 above

  return (
    <>
      <button disabled={!checkout.ready} onClick={() => checkout.open({ createSession, mode: 'popup' })}>
        Pay
      </button>
      <p role="status">{checkout.status}</p>
    </>
  );
}
```

Keep the secret key on the server (`/api/checkout` above can be any backend). Only `VITE_`-prefixed publishable keys
belong in the client bundle.

## Embedded checkout (Pro plans and above)

Create the session with `uiMode: "embedded"` and add your page origin to the store's allowed origins. The plan is
enforced by the server.

```tsx
'use client';

import { EmbeddedCheckout } from '@crafterpayments/react';

export function Payment({ clientSecret }: { clientSecret: string }) {
  return (
    <EmbeddedCheckout
      clientSecret={clientSecret}
      appearance={{
        theme: 'dark',
        variables: { colorPrimary: '#7c3aed', borderRadius: '10px', fontFamily: 'Inter, sans-serif' },
      }}
      onComplete={(result) => console.log('paid', result.verified)}
      onPaymentFailed={({ code }) => console.warn('declined', code)} // the buyer can retry in place
      onError={(error) => console.error(error.code)}
    />
  );
}
```

The component renders an empty `<div>` on the server, mounts the iframe in the browser, and destroys it on unmount
or when `clientSecret`, `sessionId`, `locale` or the appearance values change. It is safe under React StrictMode
(the development double mount leaves exactly one iframe). The `clientSecret` is never put in the iframe URL, and card
details are typed only into the payment provider's own fields.

Appearance tokens (`theme`, `variables.*`, `showCardBrandIcon`) are listed in the
[`@crafterpayments/js` README](../js/README.md#appearance). Logo and store name come from the store settings.

## Test mode

Use test keys (`cp_pk_test_…` in the browser, `cp_sk_test_…` on your server). Test sessions (`cs_test_…`) never
charge real money. Pay with the test card **4242 4242 4242 4242**, any future expiry date and any 3-digit CVC.
Test and live keys and sessions cannot be mixed.

## Development

```bash
npm install
npm test           # build + jsdom tests (mocked and real @crafterpayments/js) + size budget
npm run typecheck  # needs @crafterpayments/js built first (npm run build at the root)
```

The ESM entry must stay within 8 KB minified and 3 KB gzip (react and `@crafterpayments/js` excluded); `npm run size`
and `npm test` enforce it.
