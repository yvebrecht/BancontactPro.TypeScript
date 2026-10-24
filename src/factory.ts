import type { KeyObject } from 'node:crypto';
import { PaymentClient, ReconciliationClient, RefundClient } from './clients.js';
import { asProvider, getProductCredentials } from './credentials.js';
import type { BancontactCredentials, CredentialsProvider } from './credentials.js';
import { getMerchantApiBaseUrl } from './endpoints.js';
import { BancontactEnvironment } from './enums.js';
import type { BancontactProduct } from './enums.js';
import { ProductNotConfiguredError, SigningKeyNotConfiguredError } from './errors.js';
import { ApiKeyAuth, DEFAULT_TIMEOUT_MS, SigningAuth, Transport } from './http.js';
import { JwksClient } from './jwks.js';
import type { FetchLike, JwksClientOptions } from './jwks.js';
import { BancontactSignatureVerifier, loadEcPrivateKeyPem } from './signing.js';
import { BancontactCallbackVerifier } from './webhooks.js';

export interface BancontactClientFactoryOptions {
  /** Your own HTTP client: any `fetch`-compatible function (proxy, retries you opted into, test double). */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  jwks?: Omit<JwksClientOptions, 'fetch'>;
}

/**
 * Creates product-bound clients from the *current* credentials.
 *
 * Credentials are read on every call and never captured, so a provider that changes at runtime (a rotated key, an
 * environment switch) takes effect immediately. The returned clients keep the credentials they were created with,
 * which is why callers ask for one per operation rather than holding it. Bancontact issues credentials per product
 * type, so a client is always bound to one product.
 *
 * Credentials are never logged and never part of an error message.
 */
export class BancontactClientFactory {
  private readonly credentials: CredentialsProvider;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly jwksOptions: Omit<JwksClientOptions, 'fetch'>;
  private jwks: JwksClient | undefined;
  private signingKeyCache: { kid: string; pem: string; key: KeyObject } | undefined;

  constructor(credentials: BancontactCredentials | CredentialsProvider, options: BancontactClientFactoryOptions = {}) {
    this.credentials = asProvider(credentials);
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.jwksOptions = options.jwks ?? {};
  }

  async isConfigured(product: BancontactProduct): Promise<boolean> {
    return getProductCredentials(await this.credentials(), product) !== undefined;
  }

  /** Payment API client; authenticated by the product's API key alone. */
  async payments(product: BancontactProduct): Promise<PaymentClient> {
    const { credentials, pair } = await this.prepare(product);
    return new PaymentClient(this.transport(credentials, new ApiKeyAuth(pair.apiKey)));
  }

  /** Refund API client; needs a signing key. */
  async refunds(product: BancontactProduct): Promise<RefundClient> {
    return new RefundClient(await this.signedTransport(product));
  }

  /** Reconciliation API client; needs a signing key. */
  async reconciliation(product: BancontactProduct): Promise<ReconciliationClient> {
    return new ReconciliationClient(await this.signedTransport(product));
  }

  /** The verifier for inbound webhooks. Uses one long-lived JWKS cache; never build a `JwksClient` per call. */
  callbackVerifier(): BancontactCallbackVerifier {
    this.jwks ??= new JwksClient(this.credentials, { ...this.jwksOptions, fetch: this.fetchImpl });
    return new BancontactCallbackVerifier(new BancontactSignatureVerifier(this.jwks));
  }

  private transport(credentials: BancontactCredentials, auth: ApiKeyAuth | SigningAuth): Transport {
    const environment = credentials.environment ?? BancontactEnvironment.Preprod;
    return new Transport(this.fetchImpl, getMerchantApiBaseUrl(environment), auth, this.timeoutMs);
  }

  private async prepare(product: BancontactProduct) {
    const credentials = await this.credentials();
    const pair = getProductCredentials(credentials, product);
    if (pair === undefined) throw new ProductNotConfiguredError(product);
    return { credentials, pair };
  }

  private async signedTransport(product: BancontactProduct): Promise<Transport> {
    const { credentials, pair } = await this.prepare(product);
    const key = credentials.signingKey;
    if (key === undefined || !key.kid.trim() || !key.privateKeyPem.trim()) throw new SigningKeyNotConfiguredError();
    const auth = new SigningAuth(
      pair.apiKey,
      pair.merchantProfileId,
      credentials.issuer ?? 'Payconiq',
      key.kid,
      this.parseSigningKey(key.kid, key.privateKeyPem),
    );
    return this.transport(credentials, auth);
  }

  private parseSigningKey(kid: string, pem: string): KeyObject {
    // Parsing a PEM costs more than a request needs, so the last parsed key is kept, keyed on its content.
    const cached = this.signingKeyCache;
    if (cached?.kid === kid && cached.pem === pem) return cached.key;
    let key: KeyObject;
    try {
      key = loadEcPrivateKeyPem(pem);
    } catch (cause) {
      throw new Error(
        `The signing key '${kid}' is not a valid PEM-encoded EC (P-256) private key, so Refund and Reconciliation requests cannot be signed.`,
        { cause },
      );
    }
    this.signingKeyCache = { kid, pem, key };
    return key;
  }
}
