/**
 * On a Receipt / Top Up: no API call, the merchant builds the link and the QR image URL.
 * https://docs.bancontactpro.com/guides/instore/receipt052025v4, https://docs.bancontactpro.com/guides/online/topup052025v4
 */
import { BancontactEnvironment, QrCodeImageFormat, QrCodeImageSize, qr } from '../src/index.js';

export function receiptQr(ppid: string) {
  const environment = BancontactEnvironment.Production; // use the same environment for payload and image
  const payload = qr.buildFixedAmountPaymentUrl(environment, ppid, { amountCents: 1000, description: 'Receipt', reference: 'ticket-7' });
  return qr.buildQrCodeImageUrl(environment, payload, QrCodeImageFormat.Png, QrCodeImageSize.L);
}
