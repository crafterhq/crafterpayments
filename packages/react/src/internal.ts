import { useEffect, useLayoutEffect, useRef } from 'react';
import { CrafterPaymentsError } from '@crafterpayments/js';

/** useLayoutEffect in the browser, useEffect on the server (no SSR warning in React 18). */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Ref that always holds the latest value; lets effects and handlers read fresh callbacks without re-subscribing. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Stable string key for plain option objects (used as effect dependencies). */
export function stableKey(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, (_key, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (v as Record<string, unknown>)[k];
              return acc;
            }, {})
        : v,
    );
  } catch {
    return String(value);
  }
}

/** Normalises anything thrown into a CrafterPaymentsError, keeping its `code`. */
export function toError(err: unknown): CrafterPaymentsError {
  if (err instanceof CrafterPaymentsError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  return new CrafterPaymentsError(
    typeof code === 'string' ? code : 'invalid_options',
    err instanceof Error ? err.message : String(err),
  );
}
