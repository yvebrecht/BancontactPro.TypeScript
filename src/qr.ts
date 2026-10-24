/**
 * Client-templated QR and deeplink URLs (On a Receipt, Top Up, Static QR). No HTTP call is made.
 *
 * Two encoding passes matter: `D`, `A` and `R` are percent-encoded once into the payload URL, then the whole payload
 * URL is percent-encoded again as the `c=` parameter of the QR image URL. Both must use the same environment.
 *
 * Sources: https://docs.bancontactpro.com/guides/general/payloadurlupdate,
 * https://docs.bancontactpro.com/guides/instore/receipt052025v4, https://docs.bancontactpro.com/guides/online/topup052025v4,
 * https://docs.bancontactpro.com/guides/instore/staticqr052025v4
 */
import { escape } from './encoding.js';
import { QrCodeImageFormat } from './enums.js';
import type { BancontactEnvironment, QrCodeImageSize } from './enums.js';

// The preprod payment host is not documented (open question). The API itself returns pay.acc.bancontact.net on preprod
// according to the .NET notes, so that is what is used here.
const PAY_HOST: Record<BancontactEnvironment, string> = {
  Production: 'https://pay.bancontact.net',
  Preprod: 'https://pay.acc.bancontact.net',
};
const QR_HOST: Record<BancontactEnvironment, string> = {
  Production: 'https://qrcodegenerator.api.bancontact.net',
  Preprod: 'https://qrcodegenerator.api.preprod.bancontact.net',
};

export interface FixedAmountPaymentOptions {
  /** Cents (`A`). */
  amountCents?: number | undefined;
  /** Shown to the payer (`D`). */
  description?: string | undefined;
  /** Your own reference (`R`). */
  reference?: string | undefined;
}

/** `{host}/t/1/{PPID}?D=..&A=..&R=..` for On a Receipt, Top Up (and Invoice). */
export function buildFixedAmountPaymentUrl(
  environment: BancontactEnvironment,
  productProfileId: string,
  options: FixedAmountPaymentOptions = {},
): string {
  const query: string[] = [];
  if (options.description !== undefined) query.push(`D=${escape(options.description)}`);
  if (options.amountCents !== undefined) {
    if (!Number.isSafeInteger(options.amountCents) || options.amountCents < 1) {
      throw new RangeError('amountCents must be a positive integer number of cents.');
    }
    query.push(`A=${options.amountCents}`);
  }
  if (options.reference !== undefined) query.push(`R=${escape(options.reference)}`);
  const url = `${PAY_HOST[environment]}/t/1/${escape(productProfileId)}`;
  return query.length > 0 ? `${url}?${query.join('&')}` : url;
}

/** `{host}/l/1/{PPID}/{POSId}`: the location link behind a Static QR. */
export function buildStaticQrLocationUrl(environment: BancontactEnvironment, productProfileId: string, posId: string): string {
  return `${PAY_HOST[environment]}/l/1/${escape(productProfileId)}/${escape(posId)}`;
}

/** The QR image URL (`f=PNG|SVG`, `s=S|M|L|XL` for PNG only) for a payload URL. */
export function buildQrCodeImageUrl(
  environment: BancontactEnvironment,
  payloadUrl: string,
  format: QrCodeImageFormat = QrCodeImageFormat.Png,
  size?: QrCodeImageSize,
): string {
  const query = [`f=${format}`];
  if (format === QrCodeImageFormat.Png && size !== undefined) query.push(`s=${size}`);
  query.push(`c=${escape(payloadUrl)}`);
  return `${QR_HOST[environment]}/qrcode?${query.join('&')}`;
}
