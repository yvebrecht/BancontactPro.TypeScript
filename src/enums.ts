/**
 * String enums are modelled as a const object (for the known values) plus a union type that also accepts any other
 * string. Bancontact can add a status or channel later; an unknown wire value therefore never breaks parsing of an
 * otherwise valid response. Compare against the constants, and keep a default branch in a `switch`.
 */
type Tolerant<T extends string> = T | (string & {});

export const BancontactEnvironment = {
  Preprod: 'Preprod',
  Production: 'Production',
} as const;
export type BancontactEnvironment = (typeof BancontactEnvironment)[keyof typeof BancontactEnvironment];

/** Bancontact issues credentials per product type, so a client is always bound to one product. */
export const BancontactProduct = {
  OnDisplay: 'OnDisplay',
  OnReceipt: 'OnReceipt',
  StaticQr: 'StaticQr',
  TopUp: 'TopUp',
} as const;
export type BancontactProduct = (typeof BancontactProduct)[keyof typeof BancontactProduct];

/** `merchant-payment-status` in the Payment spec. */
export const MerchantPaymentStatus = {
  Pending: 'PENDING',
  Identified: 'IDENTIFIED',
  Authorized: 'AUTHORIZED',
  AuthorizationFailed: 'AUTHORIZATION_FAILED',
  Succeeded: 'SUCCEEDED',
  Failed: 'FAILED',
  Cancelled: 'CANCELLED',
  Expired: 'EXPIRED',
  PendingMerchantAcknowledgement: 'PENDING_MERCHANT_ACKNOWLEDGEMENT',
  Voided: 'VOIDED',
} as const;
export type MerchantPaymentStatus = Tolerant<(typeof MerchantPaymentStatus)[keyof typeof MerchantPaymentStatus]>;

/** `PaymentChannel` in the Reconciliation spec. */
export const PaymentChannel = {
  Online: 'ONLINE',
  Instore: 'INSTORE',
  Invoice: 'INVOICE',
} as const;
export type PaymentChannel = Tolerant<(typeof PaymentChannel)[keyof typeof PaymentChannel]>;

/** `PayoutStatus` in the Reconciliation spec. */
export const PayoutStatus = {
  Succeeded: 'SUCCEEDED',
  Failed: 'FAILED',
} as const;
export type PayoutStatus = Tolerant<(typeof PayoutStatus)[keyof typeof PayoutStatus]>;

/** `RefundStatus` in the Refund spec. `PROCESSING` was removed in Refund API v3.0.2; do not model it. */
export const RefundStatus = {
  Pending: 'PENDING',
  Refunded: 'REFUNDED',
  Failed: 'FAILED',
} as const;
export type RefundStatus = Tolerant<(typeof RefundStatus)[keyof typeof RefundStatus]>;

export const QrCodeImageFormat = { Png: 'PNG', Svg: 'SVG' } as const;
export type QrCodeImageFormat = (typeof QrCodeImageFormat)[keyof typeof QrCodeImageFormat];

export const QrCodeImageSize = { S: 'S', M: 'M', L: 'L', XL: 'XL' } as const;
export type QrCodeImageSize = (typeof QrCodeImageSize)[keyof typeof QrCodeImageSize];
