/**
 * On a Display: create a payment, show the QR code, poll as the fallback for the callback.
 * https://docs.bancontactpro.com/guides/instore/ondisplay052025v4
 */
import { BancontactProduct } from '../src/index.js';
import type { BancontactClientFactory } from '../src/index.js';

export async function createOnDisplayPayment(factory: BancontactClientFactory) {
  const payments = await factory.payments(BancontactProduct.OnDisplay);
  const payment = await payments.create({ amount: 1000, reference: 'order-42' }); // cents
  console.log('Show this QR code:', payment._links.qrcode.href, 'or open', payment._links.deeplink.href);

  // The callback is the primary signal; polling is the documented fallback.
  return payments.get(payment.paymentId);
}

/**
 * Static QR: the till shows a fixed QR code; ask for a payment at that point of sale.
 * https://docs.bancontactpro.com/guides/instore/staticqr052025v4
 */
export async function createStaticQrPayment(factory: BancontactClientFactory) {
  const payments = await factory.payments(BancontactProduct.StaticQr);
  return payments.createStaticQrPayment({ amount: 1000, posId: 'POS00001', reference: 'order-43' });
}
