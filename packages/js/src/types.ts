import type { CrafterPaymentsError } from './errors';

/** Session status (#463 §3.5) */
export type SessionStatus = 'open' | 'processing' | 'complete' | 'expired' | 'canceled';

/** `GET /v1/checkout/sessions/:id/public` response: status fields only */
export interface PublicCheckoutSession {
  id: string;
  object: 'checkout.session';
  status: SessionStatus;
  paymentStatus: string;
  amountTotal: number | null;
  currency: string | null;
  orderId: string | null;
  delivery: { status: string | null };
  expiresAt: string;
}

/** Payload of result events */
export interface CheckoutResult {
  sessionId: string;
  status: SessionStatus;
  /** Order id; may be set only when the status was read from the server */
  orderId?: string | null;
  /**
   * true: the status was read from the `/public` endpoint. false: it came only from the return URL or the embedded page.
   * Never fulfil on a browser event; the source of truth is the webhook and a server-side GET request.
   */
  verified: boolean;
}

export interface CheckoutErrorEvent {
  sessionId?: string;
  error: CrafterPaymentsError;
}

export interface PaymentFailedEvent {
  sessionId: string;
  /** Provider-agnostic short code (e.g. card_declined). The buyer can retry in the same session. */
  code?: string;
}

export interface CheckoutEvents {
  /** Checkout loaded (embedded/modal: iframe ready; popup: window opened) */
  ready: { sessionId: string };
  complete: CheckoutResult;
  /** Buyer went back or the session was canceled (status: canceled) */
  cancel: CheckoutResult;
  expired: CheckoutResult;
  /** Payment declined; not final, the buyer can retry */
  payment_failed: PaymentFailedEvent;
  /** A payment method outside the iframe needs a separate window; the SDK opens it */
  redirect_required: { sessionId: string; url: string };
  /** Modal or popup closed without payment */
  close: { sessionId?: string };
  error: CheckoutErrorEvent;
}

export type CheckoutEventName = keyof CheckoutEvents;
export type CheckoutEventHandler<K extends CheckoutEventName> = (payload: CheckoutEvents[K]) => void;

export interface CheckoutController {
  on<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): CheckoutController;
  off<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): CheckoutController;
  /** Closes the window/modal and stops polling. Does not cancel the session. */
  close(): void;
  /** Resolves with the result event (complete / cancel / expired); rejects on error. Resolves to `null` if close() is called. */
  readonly result: Promise<CheckoutResult | null>;
}

export interface EmbeddedCheckout extends CheckoutController {
  /** Removes the iframe and cleans up listeners */
  destroy(): void;
  readonly iframe: HTMLIFrameElement;
}

/**
 * Appearance: the card fields (card number / expiry / CVC as separate fields) are rendered on the checkout page
 * with the provider's appearance API using these values. No free-form CSS; only these tokens.
 * Invalid values are dropped (with a console warning). Logo and store name come from the store settings (#269).
 */
export interface Appearance {
  theme?: 'light' | 'dark' | 'auto';
  variables?: {
    colorPrimary?: string;
    colorBackground?: string;
    colorText?: string;
    colorTextSecondary?: string;
    colorTextPlaceholder?: string;
    colorDanger?: string;
    colorBorder?: string;
    colorFocusRing?: string;
    fontFamily?: string;
    fontSizeBase?: string;
    fontWeightNormal?: string;
    borderRadius?: string;
    borderWidth?: string;
    spacingUnit?: string;
  };
  /** Card brand icon in the card number field (default true) */
  showCardBrandIcon?: boolean;
}

export type SessionInput =
  | { sessionId: string; clientSecret?: string }
  | { clientSecret: string; sessionId?: string };

export interface CreatedSession {
  sessionId: string;
  clientSecret?: string;
  /** The session `url` (redirect/popup); built from sessionId if omitted */
  url?: string;
}

export interface OpenCheckoutOptions {
  sessionId?: string;
  clientSecret?: string;
  url?: string;
  /**
   * For sessions created on the server after the click: the SDK opens the window/modal on the click (so it is not
   * blocked) and loads checkout once the session arrives.
   */
  createSession?: () => Promise<CreatedSession>;
  /** auto: popup on desktop, the `mobile` option on mobile. modal: embedded iframe (Pro+ plan, `uiMode: embedded`). */
  mode?: 'auto' | 'popup' | 'modal' | 'redirect';
  /** What to do on mobile (width < 800 px, short viewport or touch). Default redirect. */
  mobile?: 'redirect' | 'new_tab' | 'modal';
  /** If the popup is blocked: same-tab redirect (default) or an `error` event. */
  onPopupBlocked?: 'redirect' | 'error';
  appearance?: Appearance;
  locale?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  autoCloseOnComplete?: boolean;
}

export interface MountCheckoutOptions {
  sessionId?: string;
  clientSecret: string;
  appearance?: Appearance;
  locale?: string;
  /** Milliseconds without ready before an `embed_load_timeout` error (default 15000) */
  loadTimeoutMs?: number;
}

export type RedirectToCheckoutOptions = { sessionId: string } | { url: string };
