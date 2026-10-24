/**
 * Request and response models shared by the typed clients and the webhook payload.
 *
 * Amounts are integers in cents (1 - 999,999,999,999). Optional is not nullable: unset request fields are omitted,
 * never sent as `null`. `Payment` and `MerchantCallback` deliberately have no `totalAmount` (the specs list it as
 * required but never define it); `CreatePaymentResponse.expiresAt` and `Payment.expireAt` are genuinely spelled
 * differently in the spec. Response dates are parsed to `Date` (ISO 8601 with or without an offset; fractions beyond
 * milliseconds are dropped); request dates are sent as `yyyy-MM-ddTHH:mm:ss.fffZ`.
 */
import type { MerchantPaymentStatus, PaymentChannel, PayoutStatus, RefundStatus } from './enums.js';
import { optional, required } from './schema.js';
import type { Schema } from './schema.js';

/** The documented amount range, in cents. */
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 999_999_999_999;

// --- Requests ------------------------------------------------------------------------------------------------

/** `POST /v3/payments`. Only `amount` is required. */
export interface CreatePaymentRequest {
  amount: number;
  reference?: string | undefined;
  bulkId?: string | undefined;
  currency?: string | undefined;
  description?: string | undefined;
  identifyCallbackUrl?: string | undefined;
  callbackUrl?: string | undefined;
  returnUrl?: string | undefined;
}

/** `POST /v3/payments/pos`. An active payment for the same pos id and profile is replaced. */
export interface CreateStaticQrPaymentRequest {
  amount: number;
  posId: string;
  reference?: string | undefined;
  bulkId?: string | undefined;
  currency?: string | undefined;
  description?: string | undefined;
  shopId?: string | undefined;
  shopName?: string | undefined;
  identifyCallbackUrl?: string | undefined;
  callbackUrl?: string | undefined;
}

/** `POST /v3/payments/{payment-id}/refunds`. A partial refund is simply a smaller `amount`. */
export interface CreateRefundRequest {
  amount: number;
  currency: string;
  description?: string | undefined;
}

/** `POST /v3/payments/{id}/acknowledge`, for the VOID-mode flow. */
export interface PaymentAcknowledgeRequest {
  currency: string;
  amount: number;
  reference?: string | undefined;
}

/** Filter body for `POST /v3/payments/search`. `from` defaults server-side to yesterday. */
export interface PaymentSearchQuery {
  from?: Date | undefined;
  to?: Date | undefined;
  paymentStatuses?: MerchantPaymentStatus[] | undefined;
  reference?: string | undefined;
}

// --- Payment resources ---------------------------------------------------------------------------------------

export interface PaymentLink {
  href: string;
}

export interface PaymentLinks {
  self: PaymentLink;
  deeplink: PaymentLink;
  qrcode: PaymentLink;
  cancel?: PaymentLink;
  refund?: PaymentLink;
  checkout?: PaymentLink;
}

export interface PaymentCreditor {
  profileId?: string;
  merchantId?: string;
  name?: string;
  iban?: string;
  identifyCallbackUrl?: string;
  callbackUrl?: string;
}

export interface PaymentDebtor {
  name?: string;
  iban?: string;
}

export interface CreatePaymentResponse {
  paymentId: string;
  status: MerchantPaymentStatus;
  createdAt: Date;
  expiresAt: Date;
  amount: number;
  currency: string;
  creditor: PaymentCreditor;
  _links: PaymentLinks;
  description?: string;
  reference?: string;
}

export interface Payment {
  paymentId: string;
  createdAt: Date;
  expireAt: Date;
  currency: string;
  status: MerchantPaymentStatus;
  creditor: PaymentCreditor;
  amount: number;
  /** Optional in `get_payment_response`, unlike `payment_create_response`. */
  _links?: PaymentLinks;
  succeededAt?: Date;
  debtor?: PaymentDebtor;
  description?: string;
  message?: string;
  reference?: string;
  bulkId?: string;
}

export interface PaymentSearchResponse {
  size: number;
  totalPages: number;
  totalElements: number;
  number: number;
  /** Not required by the spec. */
  details?: Payment[];
}

export interface DebtorRefundIban {
  iban: string;
}

// --- Webhook -------------------------------------------------------------------------------------------------

export interface CallbackDebtor {
  iban: string;
  name?: string;
}

/** The body of the `POST /callback` that Bancontact sends to the merchant. */
export interface MerchantCallback {
  paymentId: string;
  currency: string;
  amount: number;
  createdAt: Date;
  status: MerchantPaymentStatus;
  debtor: CallbackDebtor;
  description?: string;
  reference?: string;
  expireAt?: Date;
  succeededAt?: Date;
}

// --- Refunds -------------------------------------------------------------------------------------------------

/** The create response always reports `PENDING`. */
export interface RefundCreationResponse {
  refundId: string;
  paymentId: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  creationDate: Date;
  description?: string;
}

export interface RefundModel {
  refundId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  creationDate: Date;
  description?: string;
}

// --- Reconciliation ------------------------------------------------------------------------------------------

export interface Payout {
  payoutId: string;
  merchantId: string;
  bulkId: string;
  iban: string;
  payoutStatus: PayoutStatus;
  payoutDate: Date;
  payoutCurrency: string;
  totalPayments: number;
  totalRefunds: number;
  totalPaymentAmount: number;
  totalRefundAmount: number;
  payoutAmount: number;
}

export interface PayoutListResponse {
  size: number;
  totalPages: number;
  totalElements: number;
  number: number;
  payouts: Payout[];
}

export interface ReconciliationPaymentDetails {
  paymentId: string;
  paymentProfileId: string;
  merchantName: string;
  paymentChannel: PaymentChannel;
  currency: string;
  amount: number;
  transactionDate: Date;
  payoutId?: string;
  reference?: string;
  description?: string;
}

export interface PayoutPaymentsResponse {
  size: number;
  totalPages: number;
  totalElements: number;
  number: number;
  payments: ReconciliationPaymentDetails[];
}

export interface ReconciliationRefundDetails {
  refundId: string;
  paymentId: string;
  paymentProfileId: string;
  merchantName: string;
  paymentChannel: PaymentChannel;
  currency: string;
  amount: number;
  transactionDate: Date;
  payoutId?: string;
  reference?: string;
  description?: string;
}

export interface PayoutRefundsResponse {
  size: number;
  totalPages: number;
  totalElements: number;
  number: number;
  refunds: ReconciliationRefundDetails[];
}

/** Payment API errors also carry `traceId` and `spanId`; Refund and Reconciliation errors do not. */
export interface ErrorResponse {
  code?: string;
  message?: string;
  traceId?: string;
  spanId?: string;
}

// --- Schemas (response parsing and contract tests) -----------------------------------------------------------

export const paymentLinkSchema: Schema<PaymentLink> = { href: required('string') };

export const paymentLinksSchema: Schema<PaymentLinks> = {
  self: required({ model: paymentLinkSchema }),
  deeplink: required({ model: paymentLinkSchema }),
  qrcode: required({ model: paymentLinkSchema }),
  cancel: optional({ model: paymentLinkSchema }),
  refund: optional({ model: paymentLinkSchema }),
  checkout: optional({ model: paymentLinkSchema }),
};

export const paymentCreditorSchema: Schema<PaymentCreditor> = {
  profileId: optional('string'),
  merchantId: optional('string'),
  name: optional('string'),
  iban: optional('string'),
  identifyCallbackUrl: optional('string'),
  callbackUrl: optional('string'),
};

export const paymentDebtorSchema: Schema<PaymentDebtor> = {
  name: optional('string'),
  iban: optional('string'),
};

export const createPaymentResponseSchema: Schema<CreatePaymentResponse> = {
  paymentId: required('string'),
  status: required('string'),
  createdAt: required('datetime'),
  expiresAt: required('datetime'),
  amount: required('integer'),
  currency: required('string'),
  creditor: required({ model: paymentCreditorSchema }),
  _links: required({ model: paymentLinksSchema }),
  description: optional('string'),
  reference: optional('string'),
};

export const paymentSchema: Schema<Payment> = {
  paymentId: required('string'),
  createdAt: required('datetime'),
  expireAt: required('datetime'),
  currency: required('string'),
  status: required('string'),
  creditor: required({ model: paymentCreditorSchema }),
  amount: required('integer'),
  _links: optional({ model: paymentLinksSchema }),
  succeededAt: optional('datetime'),
  debtor: optional({ model: paymentDebtorSchema }),
  description: optional('string'),
  message: optional('string'),
  reference: optional('string'),
  bulkId: optional('string'),
};

export const paymentSearchResponseSchema: Schema<PaymentSearchResponse> = {
  size: required('integer'),
  totalPages: required('integer'),
  totalElements: required('integer'),
  number: required('integer'),
  details: optional({ array: { model: paymentSchema } }),
};

export const debtorRefundIbanSchema: Schema<DebtorRefundIban> = { iban: required('string') };

export const callbackDebtorSchema: Schema<CallbackDebtor> = {
  iban: required('string'),
  name: optional('string'),
};

export const merchantCallbackSchema: Schema<MerchantCallback> = {
  paymentId: required('string'),
  currency: required('string'),
  amount: required('integer'),
  createdAt: required('datetime'),
  status: required('string'),
  debtor: required({ model: callbackDebtorSchema }),
  description: optional('string'),
  reference: optional('string'),
  expireAt: optional('datetime'),
  succeededAt: optional('datetime'),
};

export const refundCreationResponseSchema: Schema<RefundCreationResponse> = {
  refundId: required('string'),
  paymentId: required('string'),
  status: required('string'),
  amount: required('integer'),
  currency: required('string'),
  creationDate: required('datetime'),
  description: optional('string'),
};

export const refundModelSchema: Schema<RefundModel> = {
  refundId: required('string'),
  paymentId: required('string'),
  amount: required('integer'),
  currency: required('string'),
  status: required('string'),
  creationDate: required('datetime'),
  description: optional('string'),
};

export const payoutSchema: Schema<Payout> = {
  payoutId: required('string'),
  merchantId: required('string'),
  bulkId: required('string'),
  iban: required('string'),
  payoutStatus: required('string'),
  payoutDate: required('datetime'),
  payoutCurrency: required('string'),
  totalPayments: required('integer'),
  totalRefunds: required('integer'),
  totalPaymentAmount: required('integer'),
  totalRefundAmount: required('integer'),
  payoutAmount: required('integer'),
};

export const payoutListResponseSchema: Schema<PayoutListResponse> = {
  size: required('integer'),
  totalPages: required('integer'),
  totalElements: required('integer'),
  number: required('integer'),
  payouts: required({ array: { model: payoutSchema } }),
};

export const reconciliationPaymentDetailsSchema: Schema<ReconciliationPaymentDetails> = {
  paymentId: required('string'),
  paymentProfileId: required('string'),
  merchantName: required('string'),
  paymentChannel: required('string'),
  currency: required('string'),
  amount: required('integer'),
  transactionDate: required('datetime'),
  payoutId: optional('string'),
  reference: optional('string'),
  description: optional('string'),
};

export const payoutPaymentsResponseSchema: Schema<PayoutPaymentsResponse> = {
  size: required('integer'),
  totalPages: required('integer'),
  totalElements: required('integer'),
  number: required('integer'),
  payments: required({ array: { model: reconciliationPaymentDetailsSchema } }),
};

export const reconciliationRefundDetailsSchema: Schema<ReconciliationRefundDetails> = {
  refundId: required('string'),
  paymentId: required('string'),
  paymentProfileId: required('string'),
  merchantName: required('string'),
  paymentChannel: required('string'),
  currency: required('string'),
  amount: required('integer'),
  transactionDate: required('datetime'),
  payoutId: optional('string'),
  reference: optional('string'),
  description: optional('string'),
};

export const payoutRefundsResponseSchema: Schema<PayoutRefundsResponse> = {
  size: required('integer'),
  totalPages: required('integer'),
  totalElements: required('integer'),
  number: required('integer'),
  refunds: required({ array: { model: reconciliationRefundDetailsSchema } }),
};

export const errorResponseSchema: Schema<ErrorResponse> = {
  code: optional('string'),
  message: optional('string'),
  traceId: optional('string'),
  spanId: optional('string'),
};

// Request schemas are not used for parsing; they describe the request models for the contract tests.
export const createPaymentRequestSchema: Schema<CreatePaymentRequest> = {
  amount: required('integer'),
  reference: optional('string'),
  bulkId: optional('string'),
  currency: optional('string'),
  description: optional('string'),
  identifyCallbackUrl: optional('string'),
  callbackUrl: optional('string'),
  returnUrl: optional('string'),
};

export const createStaticQrPaymentRequestSchema: Schema<CreateStaticQrPaymentRequest> = {
  amount: required('integer'),
  posId: required('string'),
  reference: optional('string'),
  bulkId: optional('string'),
  currency: optional('string'),
  description: optional('string'),
  shopId: optional('string'),
  shopName: optional('string'),
  identifyCallbackUrl: optional('string'),
  callbackUrl: optional('string'),
};

export const createRefundRequestSchema: Schema<CreateRefundRequest> = {
  amount: required('integer'),
  currency: required('string'),
  description: optional('string'),
};

export const paymentAcknowledgeRequestSchema: Schema<PaymentAcknowledgeRequest> = {
  currency: required('string'),
  amount: required('integer'),
  reference: optional('string'),
};

export const paymentSearchQuerySchema: Schema<PaymentSearchQuery> = {
  from: optional('datetime'),
  to: optional('datetime'),
  paymentStatuses: optional({ array: 'string' }),
  reference: optional('string'),
};
