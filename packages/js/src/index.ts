import { CrafterPayments, type CrafterPaymentsOptions } from './client';
import { SDK_VERSION } from './config';

export { CrafterPayments, isMobileViewport } from './client';
export type { CrafterPaymentsOptions } from './client';
export { CrafterPaymentsError } from './errors';
export type { CrafterPaymentsErrorCode } from './errors';
export { handleReturn } from './return';
export type { HandleReturnOptions, ReturnResult, ReturnStatus } from './return';
export { API_VERSION } from './config';
export type { Environment } from './config';
export type * from './types';

export const version: string = SDK_VERSION;

const instances = new Map<string, CrafterPayments>();

/**
 * Returns the client for a publishable key (cp_pk_…). Returns `null` on the server (SSR). Calling again with the same key
 * and options returns the same instance. A secret key (cp_sk_…) is rejected with `secret_key_in_browser`.
 */
export async function loadCrafterPayments(
  publishableKey: string,
  options: CrafterPaymentsOptions = {},
): Promise<CrafterPayments | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const cacheKey = `${publishableKey}|${options.environment ?? ''}|${options.locale ?? ''}|${options.checkoutOrigin ?? ''}|${options.apiBase ?? ''}`;
  let instance = instances.get(cacheKey);
  if (!instance) {
    instance = new CrafterPayments(publishableKey, options);
    instances.set(cacheKey, instance);
  }
  return instance;
}
