# @crafterpayments/node

Server SDK for the [CrafterPayments](https://crafterpayments.com) Checkout API (`/v1`, API version `2026-12`).

- Checkout sessions: create, retrieve, cancel
- License key verification: verify, deactivate
- Webhook signature verification (`X-Crafter-Signature`) and signed return verification (`cp_sig`)
- Automatic `Idempotency-Key` on every POST, safe retries with backoff, typed errors
- Node.js 18+, zero runtime dependencies, ESM + CommonJS + TypeScript types

> Status: **Preview** (0.x). The API surface may still change before 1.0.

## Install

```bash
npm install @crafterpayments/node
```

## Quick start

```ts
import { CrafterPayments } from '@crafterpayments/node';

const crafter = new CrafterPayments(process.env.CRAFTER_SECRET_KEY!, {
  apiVersion: '2026-12', // pins the Crafter-Version header (default: 2026-12)
  // environment: 'production' | 'development',  // default 'production'
  // timeoutMs: 30_000,
  // maxRetries: 2,
});

const session = await crafter.checkoutSessions.create({
  lineItems: [{ productId: 'YOUR_PRODUCT_ID', quantity: 1 }],
  customer: { email: 'buyer@example.com', externalId: 'user_123' },
  successUrl: 'https://shop.example.com/thanks?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://shop.example.com/cart',
  clientReferenceId: 'order-42',
  metadata: { cartId: 'c_981' },
});

// Redirect the buyer to the hosted payment page
console.log(session.url);
```

Secret keys (`cp_sk_test_…`, `cp_sk_live_…`) are created in the dashboard under **Headless and API**. They must
only ever live on your server. The constructor rejects publishable keys (`cp_pk_…`): those belong in the browser
SDK, [`@crafterpayments/js`](../js).

Prices always come from your store catalog, so there is no price field. `amountTotal` and `currency` are `null` until
the buyer starts paying, because tax is calculated on the payment page from the billing country. Use
`amountSubtotal` (catalog prices in `storeCurrency`) for display before that.

### Configuration

| Option | Default | |
|---|---|---|
| `apiVersion` | `'2026-12'` | Sent as `Crafter-Version`. An unsupported version fails with `crafter_version_unsupported`. |
| `environment` | `'production'` | `production` → `https://api.crafterpayments.com/v1`, `development` → `https://dev-api.crafterpayments.com/v1` |
| `baseUrl` | | Overrides the base URL (including `/v1`). https, or http for localhost. |
| `timeoutMs` | `30000` | Per attempt |
| `maxRetries` | `2` | Retries after network errors, timeouts, 429 and 5xx |
| `fetch` | global `fetch` | Custom fetch implementation |
| `appInfo` | | Appended to the User-Agent, e.g. `my-plugin/1.2.0` |

### API

```ts
crafter.checkoutSessions.create(params, options?)   // POST /v1/checkout/sessions
crafter.checkoutSessions.retrieve(id, options?)     // GET  /v1/checkout/sessions/:id
crafter.checkoutSessions.cancel(id, options?)       // POST /v1/checkout/sessions/:id/cancel
crafter.licenses.verify(params, options?)           // POST /v1/licenses/verify
crafter.licenses.deactivate(params, options?)       // POST /v1/licenses/deactivate
```

`options`: `{ idempotencyKey?, timeoutMs?, maxRetries?, signal? }`.

Every returned object has a non-enumerable `lastResponse` with `requestId`, `apiVersion`, `idempotencyKey` and
`idempotentReplayed`.

### Idempotency and retries

Every POST carries an `Idempotency-Key`. When you do not pass one the SDK generates a UUID, and every retry of that
call reuses the same key, so a session is never created twice. Pass your own key to make the call idempotent across
processes as well (for example your order id):

```ts
await crafter.checkoutSessions.create(params, { idempotencyKey: `order-${order.id}` });
```

The same key with a different body fails with `idempotency_key_reused`. Only network errors, timeouts, `429` (the
`Retry-After` delay is honoured) and `5xx` are retried; other errors are thrown immediately.

### Errors

API errors are thrown as subclasses of `CrafterPaymentsError` built from the `/v1` error body
`{ error: { type, message, param, details, requestId } }`:

```ts
import { CrafterPaymentsError, CrafterPaymentsNotFoundError } from '@crafterpayments/node';

try {
  await crafter.checkoutSessions.cancel(id);
} catch (error) {
  if (error instanceof CrafterPaymentsError) {
    console.log(error.type, error.status, error.requestId, error.param, error.details);
    if (error.type === 'checkout_session_not_open') {
      // already paid, expired or canceled
    }
  }
  throw error;
}
```

| Class | Status | Examples of `type` |
|---|---|---|
| `CrafterPaymentsAuthenticationError` | 401 | `api_key_invalid` |
| `CrafterPaymentsPermissionError` | 403 | `api_key_wrong_type`, `api_key_exposed`, `plan_feature_unavailable` |
| `CrafterPaymentsInvalidRequestError` | 400, 422 | `validation_failed`, `checkout_line_items_invalid`, `checkout_return_url_not_allowed` |
| `CrafterPaymentsNotFoundError` | 404 | `checkout_session_not_found` |
| `CrafterPaymentsConflictError` | 409 | `checkout_session_not_open`, `checkout_payment_in_progress`, `idempotency_key_reused` |
| `CrafterPaymentsRateLimitError` | 429 | `too_many_requests` (`error.retryAfter` in seconds) |
| `CrafterPaymentsAPIError` | 5xx | `internal_server_error` |
| `CrafterPaymentsConnectionError` | none | `connection_error`, `timeout`, `request_aborted` |
| `CrafterPaymentsSignatureVerificationError` | none | `webhook_signature_mismatch`, `webhook_timestamp_outside_tolerance` |

Branch on `type`; `message` is meant for humans and may change. Include `requestId` when contacting support
(support@crafterpayments.com).

## Express

```ts
import express from 'express';
import { CrafterPayments } from '@crafterpayments/node';

const app = express();
const crafter = new CrafterPayments(process.env.CRAFTER_SECRET_KEY!);

app.post('/checkout', express.json(), async (req, res, next) => {
  try {
    const session = await crafter.checkoutSessions.create({
      lineItems: [{ productId: req.body.productId, quantity: 1 }],
      successUrl: 'https://shop.example.com/thanks?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://shop.example.com/cart',
    });
    res.redirect(303, session.url);
  } catch (error) {
    next(error);
  }
});
```

## Next.js (App Router route handler)

```ts
// app/api/checkout/route.ts
import { CrafterPayments } from '@crafterpayments/node';

export const runtime = 'nodejs';
const crafter = new CrafterPayments(process.env.CRAFTER_SECRET_KEY!);

export async function POST(request: Request) {
  const { productId } = await request.json();
  const session = await crafter.checkoutSessions.create({
    lineItems: [{ productId, quantity: 1 }],
    successUrl: `${process.env.APP_URL}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${process.env.APP_URL}/cart`,
  });
  // For embedded or popup checkout, return session.clientSecret to @crafterpayments/js instead
  return Response.json({ url: session.url });
}
```

## Webhooks

Create an endpoint in the dashboard and copy its secret (`whsec_…`). Each delivery is signed:

```
X-Crafter-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
```

`constructEvent` checks the signature with a constant-time comparison, rejects signatures older (or newer) than
`toleranceSec` (default 300 seconds) and returns the parsed event. The signature covers the exact bytes, so pass
the **raw** request body, never a parsed and re-serialized object.

Events: `checkout.completed`, `checkout.expired`, `order.paid`, `order.refunded`, `order.delivery_failed`,
`order.chargeback`, `delivery.requested`. Deliveries are retried (up to 6 attempts) with the same `id` (also sent as
`X-Crafter-Delivery`), so deduplicate on `event.id`. Respond with a 2xx quickly and do slow work afterwards.

### Express

```ts
app.post('/webhooks/crafter', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = CrafterPayments.webhooks.constructEvent(
      req.body, // Buffer, thanks to express.raw
      req.header('x-crafter-signature'),
      process.env.CRAFTER_WEBHOOK_SECRET!,
    );
  } catch (error) {
    return res.status(400).send('Invalid signature');
  }

  if (event.event === 'checkout.completed') {
    const { checkoutSession, orderId, amount, currency } = event.data;
    // Fulfil the order for checkoutSession.clientReferenceId (deduplicate on event.id)
  }
  res.sendStatus(200);
});
```

Register the webhook route **before** any global `app.use(express.json())`, or the body arrives already parsed.

### Next.js

```ts
// app/api/webhooks/crafter/route.ts
import { CrafterPayments } from '@crafterpayments/node';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text(); // raw body
  try {
    const event = CrafterPayments.webhooks.constructEvent(
      body,
      request.headers.get('x-crafter-signature'),
      process.env.CRAFTER_WEBHOOK_SECRET!,
    );
    if (event.event === 'checkout.completed') {
      // fulfil the order
    }
    return new Response(null, { status: 200 });
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
}
```

### Rotating the endpoint secret

Pass both secrets while you switch over; a signature matching either one is accepted:

```ts
CrafterPayments.webhooks.constructEvent(body, header, [process.env.CRAFTER_WEBHOOK_SECRET!, process.env.CRAFTER_WEBHOOK_SECRET_OLD!]);
```

### Testing your handler

```ts
import { generateTestHeader } from '@crafterpayments/node';

const payload = JSON.stringify({ event: 'checkout.completed', id: 'test_1', version: '2026-12', createdAt: new Date().toISOString(), data: {} });
const header = generateTestHeader({ payload, secret: 'whsec_test' });
```

## Signed return (`cp_sig`)

After payment the buyer is sent to your `successUrl` / `cancelUrl` with `session_id`, `cp_status`
(`complete`, `processing`, `canceled`, `expired`), `cp_ts` and `cp_sig`. Verify them on your server with the store's
return signing secret (`crs_…`, dashboard → Headless and API):

```ts
import { verifyReturnSignature } from '@crafterpayments/node';

app.get('/thanks', async (req, res) => {
  const result = verifyReturnSignature(req.query, process.env.CRAFTER_RETURN_SECRET!); // or the full URL
  if (!result) return res.redirect('/cart');
  // result = { sessionId, status, timestamp }; default tolerance 600 seconds
  const session = await crafter.checkoutSessions.retrieve(result.sessionId);
  res.render('thanks', { session });
});
```

A valid `cp_sig` only proves the buyer was redirected by Crafter. **Never fulfil an order from the return
parameters**: use the `checkout.completed` webhook or `checkoutSessions.retrieve()` as the source of truth.

## Test mode

Use a test secret key (`cp_sk_test_…`). Test sessions (`cs_test_…`) are separate from live data, never move money
and send webhooks with `livemode: false`. On the hosted payment page, pay with the test card
`4242 4242 4242 4242`, any future expiry date and any CVC. Switch to a `cp_sk_live_…` key to go live; `crafter.livemode`
tells you which mode a client is in.

## License

MIT
