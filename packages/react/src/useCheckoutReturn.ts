import { useEffect, useRef, useState } from 'react';
import { handleReturn, type HandleReturnOptions, type ReturnResult } from '@crafterpayments/js';

export interface UseCheckoutReturnResult {
  /** `{ sessionId, status, signed, openedByCheckout }`, or `null` if the URL has no checkout result. */
  result: ReturnResult | null;
  /** `true` until `handleReturn()` has finished (always `true` on the server). */
  loading: boolean;
}

/**
 * For your `successUrl` / `cancelUrl` page. Runs `handleReturn()` once in the browser: it relays the result to the tab
 * that opened checkout and, in a popup, closes this tab. Does not need `<CrafterPaymentsProvider>`.
 * The status in the URL is only a hint; fulfil on the webhook or a server-side request.
 */
export function useCheckoutReturn(options?: HandleReturnOptions): UseCheckoutReturnResult {
  const [state, setState] = useState<UseCheckoutReturnResult>({ result: null, loading: true });
  // Runs once per page, also under the StrictMode effect replay
  const started = useRef<Promise<ReturnResult | null> | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    let active = true;
    if (!started.current) {
      started.current = handleReturn(optionsRef.current).catch(() => null);
    }
    started.current.then((result) => {
      if (active) setState({ result, loading: false });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
