/**
 * List the payouts of a day and walk every payment of each. Needs a signing key.
 * https://docs.bancontactpro.com/guides/general/reconciliation052025
 */
import { BancontactProduct } from '../src/index.js';
import type { BancontactClientFactory } from '../src/index.js';

export async function reconcileDay(factory: BancontactClientFactory, date: string) {
  const reconciliation = await factory.reconciliation(BancontactProduct.OnDisplay);
  const totals: Record<string, number> = {};
  for await (const payout of reconciliation.iteratePayouts({ date })) {
    let sum = 0;
    for await (const payment of reconciliation.iteratePayments({ payoutId: payout.payoutId })) sum += payment.amount;
    totals[payout.payoutId] = sum;
  }
  return totals;
}
