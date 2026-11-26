import { useEffect, useRef, type CSSProperties } from 'react';
import { type Appearance, type EmbeddedCheckout as EmbeddedCheckoutController } from '@crafterpayments/js';
import { useCrafterPaymentsContext } from './provider';
import { stableKey, toError, useLatest } from './internal';
import type { CheckoutCallbacks } from './useCheckout';

export interface EmbeddedCheckoutProps extends Omit<CheckoutCallbacks, 'onClose'> {
  /** The session `clientSecret` (the session must be created with `uiMode: "embedded"`). */
  clientSecret: string;
  /** Optional; derived from `clientSecret`. */
  sessionId?: string;
  appearance?: Appearance;
  locale?: string;
  /** Milliseconds without `ready` before an `embed_load_timeout` error (default 15000). */
  loadTimeoutMs?: number;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Embedded checkout (Pro plans and above). Mounts `crafter.mountCheckout` into a div and destroys it on unmount or when
 * the session / appearance changes. Renders an empty div on the server.
 */
export function EmbeddedCheckout({
  clientSecret,
  sessionId,
  appearance,
  locale,
  loadTimeoutMs,
  id,
  className,
  style,
  ...callbacks
}: EmbeddedCheckoutProps) {
  const { crafter, appearance: defaultAppearance } = useCrafterPaymentsContext('<EmbeddedCheckout>');
  const container = useRef<HTMLDivElement>(null);
  const latest = useLatest(callbacks);
  const effectiveAppearance = appearance ?? defaultAppearance;
  const appearanceKey = stableKey(effectiveAppearance);
  const appearanceRef = useLatest(effectiveAppearance);

  useEffect(() => {
    const element = container.current;
    if (!crafter || !element) return;
    let checkout: EmbeddedCheckoutController;
    try {
      checkout = crafter.mountCheckout(element, {
        clientSecret,
        sessionId,
        appearance: appearanceRef.current,
        locale,
        loadTimeoutMs,
      });
    } catch (err) {
      const error = toError(err);
      if (latest.current.onError) latest.current.onError(error);
      else console.error('[CrafterPayments]', error);
      return;
    }
    let active = true;
    const guard =
      <T,>(fn: (cb: CheckoutCallbacks) => ((payload: T) => void) | undefined) =>
      (payload: T) => {
        if (active) fn(latest.current)?.(payload);
      };
    checkout
      .on('ready', guard((cb) => cb.onLoaded))
      .on('complete', guard((cb) => cb.onComplete))
      .on('cancel', guard((cb) => cb.onCancel))
      .on('expired', guard((cb) => cb.onExpired))
      .on('payment_failed', guard((cb) => cb.onPaymentFailed))
      .on('error', ({ error }) => {
        if (!active) return;
        if (latest.current.onError) latest.current.onError(error);
        else console.error('[CrafterPayments]', error);
      });
    return () => {
      active = false;
      checkout.destroy();
    };
  }, [crafter, clientSecret, sessionId, locale, loadTimeoutMs, appearanceKey, latest, appearanceRef]);

  return <div ref={container} id={id} className={className} style={style} data-crafterpayments-embedded="" />;
}
