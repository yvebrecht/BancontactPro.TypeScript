/**
 * Verify a webhook callback (`POST /callback`). Framework independent: only headers and the raw body go in.
 * https://docs.bancontactpro.com/guides/general/callback052025
 */
import { InvalidCallbackError } from '../src/index.js';
import type { BancontactClientFactory } from '../src/index.js';

export async function handleCallback(
  factory: BancontactClientFactory,
  request: { headers: Record<string, string>; rawBody: Buffer; path: string },
): Promise<{ status: number }> {
  const verifier = factory.callbackVerifier(); // keep one per process: the JWKS cache lives in it
  try {
    const { payload, requestId } = await verifier.verifyAndParse(request.headers.signature ?? '', request.rawBody, request.path);
    console.log(`Payment ${payload.paymentId} is ${payload.status} (message ${requestId})`); // retries repeat requestId: be idempotent
    return { status: 200 }; // answer 200 only after verifying and processing
  } catch (error) {
    if (error instanceof InvalidCallbackError) return { status: 401 }; // not trustworthy: do not process
    throw error;
  }
}
