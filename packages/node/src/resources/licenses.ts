import type { CrafterPayments } from '../client';
import type {
  LicenseDeactivateParams,
  LicenseDeactivateResult,
  LicenseVerifyParams,
  LicenseVerifyResult,
  RequestOptions,
  WithResponse,
} from '../types';

/** /v1/licenses: license key verification for software you sell (digital products with license keys) */
export class Licenses {
  constructor(private readonly client: CrafterPayments) {}

  /** Checks a license key; with `activate: true` and a `fingerprint` it also registers an activation */
  verify(params: LicenseVerifyParams, options?: RequestOptions): Promise<WithResponse<LicenseVerifyResult>> {
    return this.client.request({ method: 'POST', path: '/licenses/verify', body: params, options });
  }

  /** Removes the activation of a fingerprint */
  deactivate(
    params: LicenseDeactivateParams,
    options?: RequestOptions,
  ): Promise<WithResponse<LicenseDeactivateResult>> {
    return this.client.request({ method: 'POST', path: '/licenses/deactivate', body: params, options });
  }
}
