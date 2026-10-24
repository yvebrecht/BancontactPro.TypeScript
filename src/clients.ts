/** The three typed API clients. Each wraps a `Transport` bound to one product's credentials. */
import { randomUUID } from 'node:crypto';
import { BancontactApiError, BancontactErrorCode, RefundIdempotencyConflictError } from './errors.js';
import { escape } from './encoding.js';
import type { Transport } from './http.js';
import {
  createPaymentResponseSchema,
  debtorRefundIbanSchema,
  paymentSchema,
  paymentSearchResponseSchema,
  payoutListResponseSchema,
  payoutPaymentsResponseSchema,
  payoutRefundsResponseSchema,
  refundCreationResponseSchema,
  refundModelSchema,
} from './models.js';
import type {
  CreatePaymentRequest,
  CreatePaymentResponse,
  CreateRefundRequest,
  CreateStaticQrPaymentRequest,
  DebtorRefundIban,
  Payment,
  PaymentAcknowledgeRequest,
  PaymentSearchQuery,
  PaymentSearchResponse,
  Payout,
  PayoutListResponse,
  PayoutPaymentsResponse,
  PayoutRefundsResponse,
  ReconciliationPaymentDetails,
  ReconciliationRefundDetails,
  RefundCreationResponse,
  RefundModel,
} from './models.js';
import { parseModel } from './schema.js';

function withQuery(path: string, params: string[]): string {
  return params.length > 0 ? `${path}?${params.join('&')}` : path;
}

function paging(params: string[], page: number | undefined, size: number | undefined): void {
  if (page !== undefined) params.push(`page=${page}`);
  if (size !== undefined) params.push(`size=${size}`);
}

/** Payment API v3: online, VOID-mode and static QR payments. Authenticated by the product's API key. */
export class PaymentClient {
  constructor(private readonly transport: Transport) {}

  /**
   * `POST /v3/payments`.
   *
   * If the call times out the outcome is unknown: Bancontact may have created the payment. Do not retry blindly;
   * look the payment up by the `reference` you sent with `search` first.
   */
  async create(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    return parseModel(createPaymentResponseSchema, await this.transport.request('POST', 'v3/payments', request));
  }

  /** `GET /v3/payments/{id}`: the documented polling fallback. */
  async get(paymentId: string): Promise<Payment> {
    return parseModel(paymentSchema, await this.transport.request('GET', `v3/payments/${escape(paymentId)}`));
  }

  /** `DELETE /v3/payments/{id}` (204), allowed while the payment is PENDING or IDENTIFIED. */
  async cancel(paymentId: string): Promise<void> {
    await this.transport.request('DELETE', `v3/payments/${escape(paymentId)}`);
  }

  /** `POST /v3/payments/search`. `page` is zero-based (default 0); `size` max 100 (default 10). */
  async search(query: PaymentSearchQuery = {}, page?: number, size?: number): Promise<PaymentSearchResponse> {
    const params: string[] = [];
    paging(params, page, size);
    return parseModel(paymentSearchResponseSchema, await this.transport.request('POST', withQuery('v3/payments/search', params), query));
  }

  /** `POST /v3/payments/{id}/acknowledge` for the VOID-mode flow (PENDING_MERCHANT_ACKNOWLEDGEMENT). */
  async acknowledge(paymentId: string, request: PaymentAcknowledgeRequest): Promise<void> {
    await this.transport.request('POST', `v3/payments/${escape(paymentId)}/acknowledge`, request);
  }

  /** `GET /v3/payments/{id}/debtor/refundIban`. Requires the payment to be SUCCEEDED. */
  async getDebtorRefundIban(paymentId: string): Promise<DebtorRefundIban> {
    return parseModel(
      debtorRefundIbanSchema,
      await this.transport.request('GET', `v3/payments/${escape(paymentId)}/debtor/refundIban`),
    );
  }

  /** `POST /v3/payments/pos`. Replaces the till's active payment; a timed-out call has an unknown outcome. */
  async createStaticQrPayment(request: CreateStaticQrPaymentRequest): Promise<CreatePaymentResponse> {
    return parseModel(createPaymentResponseSchema, await this.transport.request('POST', 'v3/payments/pos', request));
  }
}

/** The documented maximum length of the `Idempotency-Key` header. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

/** Refund API v3. Requests are signed with the merchant's key. `createRefund` must be activated by Bancontact support. */
export class RefundClient {
  constructor(private readonly transport: Transport) {}

  /**
   * `POST /v3/payments/{payment-id}/refunds`. Idempotent on the `Idempotency-Key` header (max 64 characters).
   *
   * Pass the same key when retrying the same refund. A UUID is generated when omitted, in which case a retry would
   * create a second refund, so supply your own key for anything you may retry. The response status is always PENDING.
   */
  async create(paymentId: string, request: CreateRefundRequest, idempotencyKey?: string): Promise<RefundCreationResponse> {
    const key = idempotencyKey ?? randomUUID();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new RangeError(`The Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
    }
    let data: unknown;
    try {
      data = await this.transport.request('POST', `v3/payments/${escape(paymentId)}/refunds`, request, { 'Idempotency-Key': key });
    } catch (error) {
      // The key was reused with different parameters: a caller bug, not a transient failure.
      if (error instanceof BancontactApiError && error.code === BancontactErrorCode.RefundRequestConflict) {
        throw new RefundIdempotencyConflictError(key, error);
      }
      throw error;
    }
    return parseModel(refundCreationResponseSchema, data);
  }

  /** `GET /v3/payments/{payment-id}/refunds/{refund-id}`. */
  async get(paymentId: string, refundId: string): Promise<RefundModel> {
    return parseModel(
      refundModelSchema,
      await this.transport.request('GET', `v3/payments/${escape(paymentId)}/refunds/${escape(refundId)}`),
    );
  }
}

/** A calendar date: `YYYY-MM-DD`, or a `Date` (its UTC date is used). */
export type DateOnly = string | Date;

export interface PayoutFilter {
  payoutId?: string | undefined;
  /** Together with `endDate`; the range is at most 30 days. */
  startDate?: DateOnly | undefined;
  endDate?: DateOnly | undefined;
  page?: number | undefined;
  size?: number | undefined;
}

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 30;

function toDateOnly(value: DateOnly): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new RangeError(`'${value}' is not a date in the form YYYY-MM-DD.`);
  }
  return value;
}

/**
 * Reconciliation API v3. Requests are signed with the merchant's key.
 *
 * `size` is fixed by the spec (minimum, maximum and default are all 10000); it is exposed in case that changes.
 * The responses carry their own `Signature` header; verifying it is out of scope until decided (open question).
 */
export class ReconciliationClient {
  constructor(private readonly transport: Transport) {}

  /** `GET /v3/reconciliation/payouts`. `date` defaults server-side to the current UTC date. */
  async getPayouts(options: { date?: DateOnly | undefined; page?: number | undefined; size?: number | undefined } = {}): Promise<PayoutListResponse> {
    const params: string[] = [];
    if (options.date !== undefined) params.push(`date=${toDateOnly(options.date)}`);
    paging(params, options.page, options.size);
    return parseModel(payoutListResponseSchema, await this.transport.request('GET', withQuery('v3/reconciliation/payouts', params)));
  }

  /** `GET /v3/reconciliation/payments`, by payout id or by a date range of at most 30 days. */
  async getPayments(filter: PayoutFilter = {}): Promise<PayoutPaymentsResponse> {
    const params = payoutFilterParams(filter);
    return parseModel(payoutPaymentsResponseSchema, await this.transport.request('GET', withQuery('v3/reconciliation/payments', params)));
  }

  /** `GET /v3/reconciliation/refunds`, by payout id or by a date range of at most 30 days. */
  async getRefunds(filter: PayoutFilter = {}): Promise<PayoutRefundsResponse> {
    const params = payoutFilterParams(filter);
    return parseModel(payoutRefundsResponseSchema, await this.transport.request('GET', withQuery('v3/reconciliation/refunds', params)));
  }

  /** Walks all pages of `getPayouts` (pages are zero-based). */
  iteratePayouts(options: { date?: DateOnly | undefined; size?: number | undefined } = {}): AsyncGenerator<Payout> {
    return paginate((page) => this.getPayouts({ ...options, page }), (response) => response.payouts);
  }

  /** Walks all pages of `getPayments`. */
  iteratePayments(filter: Omit<PayoutFilter, 'page'> = {}): AsyncGenerator<ReconciliationPaymentDetails> {
    return paginate((page) => this.getPayments({ ...filter, page }), (response) => response.payments);
  }

  /** Walks all pages of `getRefunds`. */
  iterateRefunds(filter: Omit<PayoutFilter, 'page'> = {}): AsyncGenerator<ReconciliationRefundDetails> {
    return paginate((page) => this.getRefunds({ ...filter, page }), (response) => response.refunds);
  }
}

function payoutFilterParams(filter: PayoutFilter): string[] {
  if ((filter.startDate === undefined) !== (filter.endDate === undefined)) {
    throw new RangeError('startDate and endDate must be given together.');
  }
  const params: string[] = [];
  if (filter.payoutId !== undefined) params.push(`payout-id=${escape(filter.payoutId)}`);
  if (filter.startDate !== undefined && filter.endDate !== undefined) {
    const start = toDateOnly(filter.startDate);
    const end = toDateOnly(filter.endDate);
    if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS > MAX_RANGE_DAYS) {
      throw new RangeError(`The range between startDate and endDate can be at most ${MAX_RANGE_DAYS} days.`);
    }
    params.push(`start-date=${start}`, `end-date=${end}`);
  }
  paging(params, filter.page, filter.size);
  return params;
}

async function* paginate<R extends { totalPages: number }, T>(
  fetchPage: (page: number) => Promise<R>,
  items: (response: R) => T[],
): AsyncGenerator<T> {
  for (let page = 0; ; page++) {
    const response = await fetchPage(page);
    yield* items(response);
    if (page + 1 >= response.totalPages) return;
  }
}
