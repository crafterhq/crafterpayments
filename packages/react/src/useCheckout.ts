import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CrafterPaymentsError,
  type CheckoutController,
  type CheckoutErrorEvent,
  type CheckoutResult,
  type OpenCheckoutOptions,
  type PaymentFailedEvent,
  type RedirectToCheckoutOptions,
} from '@crafterpayments/js';
import { useCrafterPaymentsContext } from './provider';
import { toError, useLatest } from './internal';

/**
 * - `idle`: nothing opened yet
 * - `opening`: window/modal opened, waiting for the session or the checkout page
 * - `open`: checkout loaded (`ready`)
 * - `complete` / `canceled` / `expired`: result event received
 * - `closed`: closed without paying
 * - `redirecting`: same-tab redirect started
 * - `error`: see `error`
 */
export type CheckoutStatus =
  | 'idle'
  | 'opening'
  | 'open'
  | 'complete'
  | 'canceled'
  | 'expired'
  | 'closed'
  | 'redirecting'
  | 'error';

/** Event callbacks shared by `useCheckout`, `<CheckoutButton>` and `<EmbeddedCheckout>`. */
export interface CheckoutCallbacks {
  /** Checkout loaded (the `ready` event). */
  onLoaded?: (event: { sessionId: string }) => void;
  /** Payment completed. A browser event is not proof for fulfilment; use the `checkout.completed` webhook. */
  onComplete?: (result: CheckoutResult) => void;
  /** Buyer went back or the session was canceled. */
  onCancel?: (result: CheckoutResult) => void;
  onExpired?: (result: CheckoutResult) => void;
  /** Payment declined; not final, the buyer can retry in the same session. */
  onPaymentFailed?: (event: PaymentFailedEvent) => void;
  /** Modal or popup closed without paying. */
  onClose?: (event: { sessionId?: string }) => void;
  onError?: (error: CrafterPaymentsError) => void;
}

export interface UseCheckoutOptions extends CheckoutCallbacks {}

export interface UseCheckoutResult {
  /**
   * Opens checkout (popup, modal or redirect) via `crafter.open`. Call it **synchronously inside the click handler**
   * (no `await` before it), otherwise the browser blocks the popup. Returns the controller, or `null` if it could not
   * open (the reason is in `error`).
   */
  open: (options: OpenCheckoutOptions) => CheckoutController | null;
  /** Same-tab redirect to the hosted checkout page via `crafter.redirectToCheckout`. */
  redirect: (options: RedirectToCheckoutOptions) => Promise<void>;
  /** Closes the open window/modal (does not cancel the session). */
  close: () => void;
  status: CheckoutStatus;
  /** Result of the last checkout (complete / canceled / expired), otherwise `null`. */
  result: CheckoutResult | null;
  error: CrafterPaymentsError | null;
  /** `false` until the provider has loaded the client. */
  ready: boolean;
}

interface State {
  status: CheckoutStatus;
  result: CheckoutResult | null;
  error: CrafterPaymentsError | null;
}

const IDLE: State = { status: 'idle', result: null, error: null };

/** Popup / modal / redirect checkout with React state. Requires `<CrafterPaymentsProvider>`. */
export function useCheckout(options: UseCheckoutOptions = {}): UseCheckoutResult {
  const { crafter, error: loadError, appearance } = useCrafterPaymentsContext('useCheckout()');
  const callbacks = useLatest(options);
  const [state, setState] = useState<State>(IDLE);
  const current = useRef<CheckoutController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the page section: close the modal/popup and stop polling
      const controller = current.current;
      current.current = null;
      controller?.close();
    };
  }, []);

  const update = useCallback((next: State) => {
    if (mounted.current) setState(next);
  }, []);

  const reportError = useCallback(
    (error: CrafterPaymentsError) => {
      update({ status: 'error', result: null, error });
      const handler = callbacks.current.onError;
      if (handler) handler(error);
      else console.error('[CrafterPayments]', error);
    },
    [callbacks, update],
  );

  const open = useCallback(
    (openOptions: OpenCheckoutOptions): CheckoutController | null => {
      if (!crafter) {
        reportError(
          loadError ??
            new CrafterPaymentsError('not_ready', 'CrafterPayments has not loaded yet; disable the button until it has.'),
        );
        return null;
      }
      const previous = current.current;
      current.current = null;
      previous?.close();

      let controller: CheckoutController;
      try {
        // Synchronous: the popup/modal must open within the user's click
        controller = crafter.open({ ...openOptions, appearance: openOptions.appearance ?? appearance });
      } catch (err) {
        reportError(toError(err));
        return null;
      }
      current.current = controller;
      const live = () => current.current === controller;
      const settle = (status: CheckoutStatus, result: CheckoutResult) => {
        if (!live()) return;
        update({ status, result, error: null });
      };

      controller
        .on('ready', (event) => {
          if (!live()) return;
          update({ status: 'open', result: null, error: null });
          callbacks.current.onLoaded?.(event);
        })
        .on('complete', (result) => {
          settle('complete', result);
          if (live()) callbacks.current.onComplete?.(result);
        })
        .on('cancel', (result) => {
          settle('canceled', result);
          if (live()) callbacks.current.onCancel?.(result);
        })
        .on('expired', (result) => {
          settle('expired', result);
          if (live()) callbacks.current.onExpired?.(result);
        })
        .on('payment_failed', (event) => {
          if (live()) callbacks.current.onPaymentFailed?.(event);
        })
        .on('close', (event) => {
          if (!live()) return;
          update({ status: 'closed', result: null, error: null });
          callbacks.current.onClose?.(event);
        })
        .on('error', ({ error }: CheckoutErrorEvent) => {
          if (live()) reportError(error);
        });

      update({ status: openOptions.mode === 'redirect' ? 'redirecting' : 'opening', result: null, error: null });
      return controller;
    },
    [crafter, loadError, appearance, callbacks, reportError, update],
  );

  const redirect = useCallback(
    async (redirectOptions: RedirectToCheckoutOptions): Promise<void> => {
      if (!crafter) {
        reportError(loadError ?? new CrafterPaymentsError('not_ready', 'CrafterPayments has not loaded yet.'));
        return;
      }
      update({ status: 'redirecting', result: null, error: null });
      try {
        await crafter.redirectToCheckout(redirectOptions);
      } catch (err) {
        reportError(toError(err));
      }
    },
    [crafter, loadError, reportError, update],
  );

  const close = useCallback(() => {
    current.current?.close();
  }, []);

  return { open, redirect, close, status: state.status, result: state.result, error: state.error, ready: !!crafter };
}
