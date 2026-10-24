import type { BancontactProduct } from './enums.js';

/**
 * Documented error `code`s, from the error responses of the three specs.
 * Payment: https://docs.bancontactpro.com/_bundle/apis/merchant-payment.openapi.json
 * Refund: https://docs.bancontactpro.com/_bundle/apis/refund-public.openapi.json
 * Reconciliation: https://docs.bancontactpro.com/_bundle/apis/merchant-reconciliation.openapi.json
 * and https://docs.bancontactpro.com/guides/general/errorsandstatuses052025
 */
export const BancontactErrorCode = {
  PaymentNotFound: 'PAYMENT_NOT_FOUND',
  PaymentNotPending: 'PAYMENT_NOT_PENDING',
  PaymentVoided: 'PAYMENT_VOIDED',
  MerchantProfileNotFound: 'MERCHANT_PROFILE_NOT_FOUND',
  CallerNotAllowedToCancel: 'CALLER_NOT_ALLOWED_TO_CANCEL',
  DebtorIbanNotAvailable: 'DEBTOR_IBAN_NOT_AVAILABLE',
  FieldIsInvalid: 'FIELD_IS_INVALID',
  FieldIsRequired: 'FIELD_IS_REQUIRED',
  BodyMissing: 'BODY_MISSING',
  AccessDenied: 'ACCESS_DENIED',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  TechnicalError: 'TECHNICAL_ERROR',
  TryAgainLater: 'TRY_AGAIN_LATER',
  PaymentForRefundNotFound: 'PAYMENT_FOR_REFUND_NOT_FOUND',
  InvalidRefundAmount: 'INVALID_REFUND_AMOUNT',
  RefundNotAllowed: 'REFUND_NOT_ALLOWED',
  RefundNotPossible: 'REFUND_NOT_POSSIBLE',
  RefundNotAvailable: 'REFUND_NOT_AVAILABLE',
  RefundRequestConflict: 'REFUND_REQUEST_CONFLICT',
  RefundNotFound: 'REFUND_NOT_FOUND',
  PayoutNotFound: 'PAYOUT_NOT_FOUND',
} as const;
export type BancontactErrorCode = (typeof BancontactErrorCode)[keyof typeof BancontactErrorCode];

export interface BancontactApiErrorInit {
  status: number;
  /** Empty when the response body was not Bancontact's `{code, message}` shape (a gateway 401, an upstream 502). */
  code?: string;
  message: string;
  /** What to hand Bancontact support; only the Payment API's errors include `traceId` and `spanId`. */
  traceId?: string | undefined;
  spanId?: string | undefined;
  /** The response body exactly as received, so a non-standard error body is never swallowed. */
  body?: string;
}

/** Bancontact returned a non-success HTTP response. 429 and 503 are surfaced, never retried automatically. */
export class BancontactApiError extends Error {
  override readonly name: string = 'BancontactApiError';
  readonly status: number;
  readonly code: string;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly body: string;

  constructor(init: BancontactApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code ?? '';
    this.traceId = init.traceId;
    this.spanId = init.spanId;
    this.body = init.body ?? '';
  }
}

/** The idempotency key was reused with different parameters (`REFUND_REQUEST_CONFLICT`): a caller bug. */
export class RefundIdempotencyConflictError extends BancontactApiError {
  override readonly name: string = 'RefundIdempotencyConflictError';
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string, inner: BancontactApiError) {
    super({
      status: inner.status,
      code: inner.code,
      message: `The idempotency key '${idempotencyKey}' was already used for a refund with different parameters. ${inner.message}`,
      traceId: inner.traceId,
      spanId: inner.spanId,
      body: inner.body,
    });
    this.idempotencyKey = idempotencyKey;
  }
}

/** A success response whose body does not match the documented schema. */
export class InvalidResponseError extends Error {
  override readonly name: string = 'InvalidResponseError';
}

/** A webhook callback could not be trusted: bad signature or unparseable body. Stop processing the request. */
export class InvalidCallbackError extends Error {
  override readonly name: string = 'InvalidCallbackError';
}

export class ProductNotConfiguredError extends Error {
  override readonly name: string = 'ProductNotConfiguredError';
  readonly product: BancontactProduct;

  constructor(product: BancontactProduct) {
    super(
      `Bancontact product '${product}' is not configured: it needs both its apiKey and its merchantProfileId (PPID), the pair Bancontact issued for this product.`,
    );
    this.product = product;
  }
}

export class SigningKeyNotConfiguredError extends Error {
  override readonly name: string = 'SigningKeyNotConfiguredError';

  constructor() {
    super(
      "The Refund and Reconciliation APIs require a signed request. Configure a signing key (kid and privateKeyPem) and host the public key as a JWKS whose URL is shared with Bancontact. The Payment API works with a product's API key alone.",
    );
  }
}
