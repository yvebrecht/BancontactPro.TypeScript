import type { BancontactEnvironment, BancontactProduct } from './enums.js';

/** The API key and PPID (merchant profile id) Bancontact issued for one product type. */
export interface ProductCredentials {
  apiKey?: string | undefined;
  merchantProfileId?: string | undefined;
}

/** The merchant's ES256 (P-256) signing key, needed for Refund and Reconciliation calls. */
export interface SigningKey {
  kid: string;
  privateKeyPem: string;
}

/** A snapshot of everything the library needs, read afresh on every use (never cached by the library). */
export interface BancontactCredentials {
  /** Defaults to `Preprod`. */
  environment?: BancontactEnvironment | undefined;
  products?: Partial<Record<BancontactProduct, ProductCredentials>> | undefined;
  signingKey?: SigningKey | undefined;
  /**
   * The `iss` claim of signed requests. The Payment and Refund specs say "Payconiq"; the Reconciliation spec templates
   * it as the merchant id, which cannot be resolved from the documentation alone (open item, spec-discrepancy).
   */
  issuer?: string | undefined;
}

/**
 * Anything that returns the current credentials, directly or as a promise. Called on every use, so it may read a
 * database or secret store; cache briefly yourself if that is expensive.
 */
export type CredentialsProvider = () => BancontactCredentials | Promise<BancontactCredentials>;

/** Accepts fixed credentials or a provider. */
export function asProvider(source: BancontactCredentials | CredentialsProvider): CredentialsProvider {
  return typeof source === 'function' ? source : () => source;
}

export function getProductCredentials(
  credentials: BancontactCredentials,
  product: BancontactProduct,
): { apiKey: string; merchantProfileId: string } | undefined {
  const pair = credentials.products?.[product];
  const apiKey = pair?.apiKey?.trim();
  const merchantProfileId = pair?.merchantProfileId?.trim();
  return apiKey && merchantProfileId ? { apiKey: pair?.apiKey as string, merchantProfileId: pair?.merchantProfileId as string } : undefined;
}
