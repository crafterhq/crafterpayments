import { CrafterPaymentsError } from '../errors';
import type { CrafterPayments } from '../client';
import type { CheckoutSession, CheckoutSessionCreateParams, RequestOptions, WithResponse } from '../types';

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{22,40}$/;

function sessionPath(id: unknown): string {
  if (typeof id !== 'string' || !SESSION_ID.test(id))
    throw new CrafterPaymentsError({
      type: 'invalid_session_id',
      message: 'Invalid checkout session id (expected cs_test_… or cs_live_…).',
    });
  return `/checkout/sessions/${encodeURIComponent(id)}`;
}

/** /v1/checkout/sessions (secret key) */
export class CheckoutSessions {
  constructor(private readonly client: CrafterPayments) {}

  /**
   * Creates a checkout session. Redirect the buyer to `session.url`, or pass `session.clientSecret` to the browser
   * SDK for embedded / popup checkout. Prices come from your catalog; `amountTotal` and `currency` are null until
   * the buyer starts paying (tax depends on their billing country).
   */
  create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<WithResponse<CheckoutSession>> {
    if (!params || typeof params !== 'object' || !Array.isArray(params.lineItems))
      throw new CrafterPaymentsError({
        type: 'invalid_options',
        message: 'checkoutSessions.create requires { lineItems: [{ productId, quantity }] }.',
      });
    return this.client.request({ method: 'POST', path: '/checkout/sessions', body: params, options });
  }

  /** Retrieves a session (source of truth for status, paymentStatus, amountTotal, orderId) */
  retrieve(id: string, options?: RequestOptions): Promise<WithResponse<CheckoutSession>> {
    return this.client.request({ method: 'GET', path: sessionPath(id), options });
  }

  /** Cancels an open session. Calling it again on a canceled session returns it unchanged. */
  cancel(id: string, options?: RequestOptions): Promise<WithResponse<CheckoutSession>> {
    return this.client.request({ method: 'POST', path: `${sessionPath(id)}/cancel`, options });
  }
}
