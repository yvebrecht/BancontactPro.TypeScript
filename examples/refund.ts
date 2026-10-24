/**
 * Refund part of a payment. Needs a signing key; createRefund must be activated by Bancontact support.
 * https://docs.bancontactpro.com/guides/general/refunds052025
 */
import { BancontactProduct, RefundIdempotencyConflictError } from '../src/index.js';
import type { BancontactClientFactory } from '../src/index.js';

export async function refundPartially(factory: BancontactClientFactory, paymentId: string) {
  const refunds = await factory.refunds(BancontactProduct.OnDisplay);
  try {
    // Use your own key for anything you might retry: the same key with the same parameters is safe to repeat.
    return await refunds.create(paymentId, { amount: 500, currency: 'EUR', description: 'Returned item' }, `refund-${paymentId}-1`);
  } catch (error) {
    if (error instanceof RefundIdempotencyConflictError) console.error('That key was used with other parameters.');
    throw error;
  }
}
