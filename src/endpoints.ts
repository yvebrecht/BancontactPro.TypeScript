import type { BancontactEnvironment } from './enums.js';

const MERCHANT_API: Record<BancontactEnvironment, string> = {
  Preprod: 'https://merchant.api.preprod.bancontact.net/',
  Production: 'https://merchant.api.bancontact.net/',
};

// The JWKS hosts are not stated in the OpenAPI specs; they follow the host pattern of the other environments and are
// carried over from the .NET library (BancontactPro.Net). Open item to confirm with devsupport@bancontact.com.
const JWKS: Record<BancontactEnvironment, string> = {
  Preprod: 'https://jwks.preprod.bancontact.net/',
  Production: 'https://jwks.bancontact.net/',
};

function lookup(table: Record<BancontactEnvironment, string>, environment: BancontactEnvironment): string {
  const url = table[environment];
  if (url === undefined) throw new Error(`Unknown Bancontact environment '${environment}'.`);
  return url;
}

/** The base address of the Payment, Refund and Reconciliation APIs (`servers` in each spec). */
export function getMerchantApiBaseUrl(environment: BancontactEnvironment): string {
  return lookup(MERCHANT_API, environment);
}

/** The address of Bancontact's JWKS (the public keys that sign its callbacks). */
export function getJwksUrl(environment: BancontactEnvironment): string {
  return lookup(JWKS, environment);
}
