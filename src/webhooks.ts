import { InvalidCallbackError } from './errors.js';
import { merchantCallbackSchema } from './models.js';
import type { MerchantCallback } from './models.js';
import { parseModel } from './schema.js';
import type { BancontactSignatureVerifier, Bytes } from './signing.js';

export interface VerifiedCallback {
  payload: MerchantCallback;
  /**
   * The `jti` claim: unique per message. Bancontact retries a callback with identical headers and body, so handlers
   * should tolerate duplicates.
   */
  requestId: string;
}

/**
 * The entry point for inbound webhooks (`POST /callback` in the Payment spec): verify the signature, then parse the body.
 *
 * Framework independent: pass the `Signature` header, the raw body bytes and the request path.
 * Failure throws `InvalidCallbackError`: "this callback cannot be trusted" should stop request processing, not be a
 * value the caller might ignore. Answer `200 OK` only after verifying and processing.
 */
export class BancontactCallbackVerifier {
  constructor(private readonly signatureVerifier: BancontactSignatureVerifier) {}

  /**
   * @param signatureHeader the `Signature` header
   * @param body the raw request bytes (never re-serialized JSON)
   * @param path the path of the request URI, as received (percent-encoded, without query string)
   */
  async verifyAndParse(signatureHeader: string, body: Bytes, path: string): Promise<VerifiedCallback> {
    const claims = await this.signatureVerifier.verify(signatureHeader, body, path);
    if (claims === undefined) throw new InvalidCallbackError("The callback's signature could not be verified.");

    let payload: MerchantCallback;
    try {
      payload = parseModel(merchantCallbackSchema, JSON.parse(Buffer.from(body).toString('utf8')));
    } catch (cause) {
      throw new InvalidCallbackError('The callback body could not be parsed.', { cause });
    }
    return { payload, requestId: claims.requestId };
  }
}
