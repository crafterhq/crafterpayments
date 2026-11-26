import { CrafterPayments } from './client';

export { CrafterPayments, API_VERSION, SDK_VERSION, BASE_URLS, assertSecretKey } from './client';
export * from './errors';
export {
  webhooks,
  constructEvent,
  verifyWebhookSignature,
  parseSignatureHeader,
  generateTestHeader,
  verifyReturnSignature,
  WEBHOOK_SIGNATURE_HEADER,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  DEFAULT_RETURN_TOLERANCE_SECONDS,
} from './webhooks';
export type { ParsedSignatureHeader, ReturnParamsInput, VerifiedReturn } from './webhooks';
export type { CheckoutSessions } from './resources/checkout-sessions';
export type { Licenses } from './resources/licenses';
export type * from './types';

export default CrafterPayments;
