/** Public types of the CrafterPayments /v1 API (version 2026-12). */

export type Environment = 'production' | 'development';

export interface CrafterPaymentsConfig {
  /** Pins the API version (`Crafter-Version` header). Default: the version this SDK was built for (`2026-12`). */
  apiVersion?: string;
  /** `production` (api.crafterpayments.com, default) or `development` (dev-api.crafterpayments.com) */
  environment?: Environment;
  /** Overrides the API base URL, including `/v1` (e.g. a local backend). https, or http for localhost. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Retries after a network error, 429 or 5xx (same Idempotency-Key). Default 2. */
  maxRetries?: number;
  /** Custom fetch implementation. Default: global fetch (Node 18+). */
  fetch?: typeof fetch;
  /** Appended to the User-Agent header, e.g. `my-plugin/1.2.0` */
  appInfo?: string;
}

export interface RequestOptions {
  /** Idempotency-Key for POST requests. Generated (UUID) when omitted; reused across retries. */
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** Metadata of the HTTP response, available as the non-enumerable `lastResponse` property of returned objects */
export interface ResponseInfo {
  status: number;
  requestId: string | null;
  /** The API version that served the request (`Crafter-Version` response header) */
  apiVersion: string | null;
  /** true when the API returned a stored response for a repeated Idempotency-Key */
  idempotentReplayed: boolean;
  idempotencyKey: string | null;
}

export type WithResponse<T> = T & { readonly lastResponse?: ResponseInfo };

// ---------------------------------------------------------------- Checkout sessions

export type CheckoutSessionStatus = 'open' | 'processing' | 'complete' | 'expired' | 'canceled';
export type CheckoutSessionPaymentStatus =
  | 'unpaid'
  | 'paid'
  | 'no_payment_required'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed';
export type CheckoutUiMode = 'hosted' | 'embedded';

export interface CheckoutPlayer {
  /** Identity type of the product's delivery (e.g. `minecraft_java`, `steam64`) */
  type: string;
  /** Required for name based types (e.g. Minecraft) */
  username?: string | null;
  /** Required for `steam64`, `cfx`, `roblox` */
  id?: string | null;
  /** Optional Minecraft UUID */
  uuid?: string | null;
}

export interface CheckoutLineItemInput {
  productId: string;
  /** 1-99 */
  quantity: number;
}

export interface CheckoutSessionCreateParams {
  /** 1-50 lines. Prices always come from your store catalog; there is no price field. */
  lineItems: CheckoutLineItemInput[];
  customer?: {
    email?: string | null;
    /** Your own customer id (max 128) */
    externalId?: string | null;
    player?: CheckoutPlayer | null;
  };
  /** e.g. `en`, `tr`, `en-US` */
  locale?: string;
  /** Display currency suggestion (ISO 4217, upper case); the server decides */
  currency?: string;
  uiMode?: CheckoutUiMode;
  /** Must be in the store's allowed origins. `{CHECKOUT_SESSION_ID}` is replaced with the session id. */
  successUrl?: string;
  cancelUrl?: string;
  allowCoupons?: boolean;
  couponCode?: string | null;
  /** 900-86400, default 1800 */
  expiresInSeconds?: number;
  /** Your reference (max 200), echoed in webhooks */
  clientReferenceId?: string | null;
  /** Up to 20 keys (`[A-Za-z0-9_.-]{1,40}`), string values up to 500 characters */
  metadata?: Record<string, string>;
}

export interface CheckoutSessionLineItem {
  productId: string;
  name: string;
  quantity: number;
  /** Catalog unit price in `currency` (the store currency) */
  unitAmount: number;
  currency: string;
  options?: Record<string, string> | null;
}

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  livemode: boolean;
  status: CheckoutSessionStatus;
  paymentStatus: CheckoutSessionPaymentStatus;
  uiMode: CheckoutUiMode;
  /** Hosted payment page; redirect the buyer here */
  url: string;
  /** For the browser SDK (embedded / popup). Never log it. */
  clientSecret?: string;
  expiresAt: string;
  createdAt: string;
  storeCurrency: string;
  /** Sum of line items at catalog price in storeCurrency, before coupon and tax */
  amountSubtotal: number;
  /** Final charged amount; null until payment starts (tax depends on the buyer's billing country) */
  amountTotal: number | null;
  /** Charge currency; null until payment starts */
  currency: string | null;
  lineItems: CheckoutSessionLineItem[];
  customer: {
    email?: string | null;
    externalId?: string | null;
    player?: CheckoutPlayer | null;
  } | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  orderId: string | null;
  paymentId: string | null;
  completedAt: string | null;
}

// ---------------------------------------------------------------- Licenses

export interface LicenseVerifyParams {
  licenseKey: string;
  productId: string;
  /** Device or domain; required to activate */
  fingerprint?: string;
  /** Activation label shown in the dashboard */
  label?: string;
  /** Registers `fingerprint` as an activation (respects the activation limit) */
  activate?: boolean;
}

export type LicenseInvalidReason = 'not_found' | 'revoked' | 'expired' | 'activation_limit';

export type LicenseVerifyResult =
  | {
      valid: true;
      status: 'active';
      productId: string;
      expiresAt: string | null;
      activations: { used: number; max: number | null };
      customer: { id: string };
    }
  | {
      valid: false;
      reason: LicenseInvalidReason;
      activations?: { used: number; max: number | null };
    };

export interface LicenseDeactivateParams {
  licenseKey: string;
  productId: string;
  fingerprint: string;
}

export type LicenseDeactivateResult =
  | { success: true; activations: { used: number; max: number | null } }
  | { success: false; reason: 'not_found' };

// ---------------------------------------------------------------- Webhooks

export type WebhookEventType =
  | 'checkout.completed'
  | 'checkout.expired'
  | 'order.paid'
  | 'order.refunded'
  | 'order.delivery_failed'
  | 'order.chargeback'
  | 'delivery.requested';

export interface CheckoutSessionRef {
  id: string;
  clientReferenceId?: string | null;
  metadata?: Record<string, string>;
}

export interface CheckoutCompletedData {
  checkoutSession: CheckoutSessionRef;
  orderId: string | null;
  paymentId: string | null;
  websiteId: string;
  amount: number;
  currency: string;
  customer: { externalId: string | null; email: string | null; player: CheckoutPlayer | null };
  basket: Array<{ id: string; name: string; quantity: number; price: number }>;
  deliveryStatus: string;
}

export interface CheckoutExpiredData {
  checkoutSession: CheckoutSessionRef;
  websiteId: string;
  expiresAt: string;
}

export interface OrderChargebackData {
  chargebackId: string;
  status: 'opened' | 'won' | 'lost';
  orderId: string;
  paymentId: string;
  websiteId: string;
  amount: number;
  currency: string;
  reason: string | null;
  checkoutSession: { id: string } | null;
}

interface WebhookEventBase<T extends string, D> {
  event: T;
  /** Delivery id (same as the `X-Crafter-Delivery` header). Deduplicate on it: retries reuse the id. */
  id: string;
  /** Payload version, e.g. `2026-12` */
  version: string;
  createdAt: string;
  livemode?: boolean;
  data: D;
}

export type WebhookEvent =
  | WebhookEventBase<'checkout.completed', CheckoutCompletedData>
  | WebhookEventBase<'checkout.expired', CheckoutExpiredData>
  | WebhookEventBase<'order.chargeback', OrderChargebackData>
  | WebhookEventBase<'order.paid' | 'order.refunded' | 'order.delivery_failed' | 'delivery.requested', Record<string, any>>;

// ---------------------------------------------------------------- Signed return

export type ReturnStatus = 'complete' | 'processing' | 'canceled' | 'expired';
