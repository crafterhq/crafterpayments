import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  loadCrafterPayments,
  type CrafterPaymentsError,
  type Appearance,
  type CrafterPayments,
  type CrafterPaymentsOptions,
} from '@crafterpayments/js';
import { stableKey, toError } from './internal';

export interface CrafterPaymentsProviderOptions extends CrafterPaymentsOptions {
  /** Default appearance for `useCheckout`, `<CheckoutButton>` and `<EmbeddedCheckout>`; their own prop wins. */
  appearance?: Appearance;
}

export interface CrafterPaymentsProviderProps {
  /** Publishable key (`cp_pk_test_…` / `cp_pk_live_…`). A secret key is rejected with `secret_key_in_browser`. */
  publishableKey: string;
  options?: CrafterPaymentsProviderOptions;
  children?: ReactNode;
}

export interface CrafterPaymentsState {
  /** The client; `null` on the server and until it has loaded in the browser. */
  crafter: CrafterPayments | null;
  /** `true` until the client has loaded or failed (always `true` on the server). */
  loading: boolean;
  /** Load error, e.g. `invalid_publishable_key` or `secret_key_in_browser`. */
  error: CrafterPaymentsError | null;
}

interface ContextValue extends CrafterPaymentsState {
  appearance?: Appearance;
}

const CrafterPaymentsContext = /* @__PURE__ */ createContext<ContextValue | null>(null);

/**
 * Loads `@crafterpayments/js` once per key + options and shares the client with the hooks and components below it.
 * SSR-safe: children always render (also on the server); `crafter` stays `null` until the client has loaded.
 */
export function CrafterPaymentsProvider({ publishableKey, options, children }: CrafterPaymentsProviderProps) {
  const { appearance, ...clientOptions } = options ?? {};
  const loadKey = `${publishableKey}|${stableKey(clientOptions)}`;
  const [state, setState] = useState<CrafterPaymentsState & { key: string }>({
    crafter: null,
    loading: true,
    error: null,
    key: '',
  });
  // Survives the StrictMode effect replay, so the client is requested once per key/options
  const pending = useRef<{ key: string; promise: Promise<CrafterPayments | null> } | null>(null);
  const latestOptions = useRef(clientOptions);
  latestOptions.current = clientOptions;

  useEffect(() => {
    let active = true;
    if (!pending.current || pending.current.key !== loadKey) {
      let promise: Promise<CrafterPayments | null>;
      try {
        promise = loadCrafterPayments(publishableKey, latestOptions.current);
      } catch (err) {
        promise = Promise.reject(err);
      }
      pending.current = { key: loadKey, promise };
    }
    pending.current.promise.then(
      (crafter) => {
        if (active) setState({ crafter, loading: false, error: null, key: loadKey });
      },
      (err: unknown) => {
        if (active) setState({ crafter: null, loading: false, error: toError(err), key: loadKey });
      },
    );
    return () => {
      active = false;
    };
  }, [publishableKey, loadKey]);

  // While a new key/options pair loads, do not expose the previous client
  const current = state.key === loadKey;
  const appearanceKey = stableKey(appearance);
  const value = useMemo<ContextValue>(
    () => ({
      crafter: current ? state.crafter : null,
      loading: current ? state.loading : true,
      error: current ? state.error : null,
      appearance,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, state, appearanceKey],
  );

  return <CrafterPaymentsContext.Provider value={value}>{children}</CrafterPaymentsContext.Provider>;
}

/** @internal */
export function useCrafterPaymentsContext(hook: string): ContextValue {
  const ctx = useContext(CrafterPaymentsContext);
  if (!ctx) {
    throw new Error(`${hook} must be used inside <CrafterPaymentsProvider>.`);
  }
  return ctx;
}

/** Returns `{ crafter, loading, error }` from the nearest `<CrafterPaymentsProvider>`. */
export function useCrafterPayments(): CrafterPaymentsState {
  const { crafter, loading, error } = useCrafterPaymentsContext('useCrafterPayments()');
  return { crafter, loading, error };
}
