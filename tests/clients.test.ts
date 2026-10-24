import { describe, expect, it } from 'vitest';
import {
  BancontactApiError,
  BancontactClientFactory,
  BancontactEnvironment,
  BancontactErrorCode,
  BancontactProduct,
  InvalidResponseError,
  MerchantPaymentStatus,
  ProductNotConfiguredError,
  RefundIdempotencyConflictError,
  RefundStatus,
  SigningKeyNotConfiguredError,
} from '../src/index.js';
import type { BancontactCredentials } from '../src/index.js';
import { b64urlDecode, verify } from '../src/signing.js';
import { BASE, CREATED, credentials, empty, FakeFetch, json, PID, signingPair } from './helpers.js';

const PRODUCT = BancontactProduct.OnDisplay;
const NS = 'https://payconiq.com/';

function setup(source: BancontactCredentials | (() => BancontactCredentials) = credentials()) {
  const http = new FakeFetch();
  const factory = new BancontactClientFactory(source, { fetch: http.fetch });
  return { http, factory };
}

const claimsOf = (signature: string) => JSON.parse(b64urlDecode(signature.split('.')[0] as string).toString('utf8')) as Record<string, unknown>;

describe('PaymentClient', () => {
  it('sends the bearer key only and omits unset fields', async () => {
    const { http, factory } = setup();
    http.on('POST', `${BASE}/v3/payments`, json(201, CREATED));
    const response = await (await factory.payments(PRODUCT)).create({ amount: 1000, reference: 'ref', description: undefined });

    expect(http.last.headers.Authorization).toBe('Bearer api-key');
    expect(http.last.headers.Signature).toBeUndefined(); // the Payment API is authenticated by the API key alone
    expect(JSON.parse(http.last.body.toString())).toEqual({ amount: 1000, reference: 'ref' });
    expect(response.status).toBe(MerchantPaymentStatus.Pending);
    expect(response._links.checkout?.href).toBe('https://x');
    expect(response.createdAt.toISOString()).toBe('2026-01-02T03:04:05.123Z'); // microseconds and +00:00 accepted
  });

  it('gets, cancels and escapes the id in the path', async () => {
    const { http, factory } = setup();
    const payment = { ...CREATED, expireAt: CREATED.expiresAt, debtor: { iban: 'BE**1234' } } as Record<string, unknown>;
    delete payment.expiresAt;
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(200, payment)).on('DELETE', `${BASE}/v3/payments/${PID}`, empty(204));
    http.on('GET', `${BASE}/v3/payments/a%2Fb%27c`, json(404, { code: 'PAYMENT_NOT_FOUND', message: 'nope' }));
    const client = await factory.payments(PRODUCT);

    const got = await client.get(PID);
    expect(got.debtor?.iban).toBe('BE**1234');
    expect(got.succeededAt).toBeUndefined();
    await client.cancel(PID);
    expect(http.last.method).toBe('DELETE');
    await expect(client.get("a/b'c")).rejects.toThrow(BancontactApiError);
  });

  it('searches with paging and a filter body', async () => {
    const { http, factory } = setup();
    http.on('POST', `${BASE}/v3/payments/search?page=1&size=50`, json(200, { size: 0, totalPages: 0, totalElements: 0, number: 0 }));
    const result = await (await factory.payments(PRODUCT)).search(
      { paymentStatuses: [MerchantPaymentStatus.Succeeded], reference: 'r', from: new Date('2026-01-01T00:00:00Z') },
      1,
      50,
    );
    expect(JSON.parse(http.last.body.toString())).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      paymentStatuses: ['SUCCEEDED'],
      reference: 'r',
    });
    expect(result.details).toBeUndefined();
  });

  it('covers acknowledge, refund IBAN and static QR', async () => {
    const { http, factory } = setup();
    http
      .on('POST', `${BASE}/v3/payments/${PID}/acknowledge`, empty(204))
      .on('GET', `${BASE}/v3/payments/${PID}/debtor/refundIban`, json(200, { iban: 'BE68539007547034' }))
      .on('POST', `${BASE}/v3/payments/pos`, json(201, CREATED));
    const client = await factory.payments(PRODUCT);
    await client.acknowledge(PID, { currency: 'EUR', amount: 1000 });
    expect((await client.getDebtorRefundIban(PID)).iban).toBe('BE68539007547034');
    await client.createStaticQrPayment({ amount: 1000, posId: 'POS1' });
    expect(JSON.parse(http.last.body.toString())).toEqual({ amount: 1000, posId: 'POS1' });
  });

  it('does not crash on an unknown status value', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(200, { ...CREATED, status: 'SOMETHING_NEW', expireAt: '2026-01-02T03:06:05Z' }));
    const got = await (await factory.payments(PRODUCT)).get(PID);
    expect(got.status).toBe('SOMETHING_NEW');
    expect(got.expireAt.toISOString()).toBe('2026-01-02T03:06:05.000Z');
  });

  it('reads a date-time without an offset as UTC', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(200, { ...CREATED, expireAt: '2026-01-02T03:06:05.5' }));
    expect((await (await factory.payments(PRODUCT)).get(PID)).expireAt.toISOString()).toBe('2026-01-02T03:06:05.500Z');
  });

  it('reports a response that violates the schema', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(200, { paymentId: PID }));
    await expect((await factory.payments(PRODUCT)).get(PID)).rejects.toThrow(InvalidResponseError);
  });
});

describe('errors', () => {
  it('carries code, trace and span ids', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(404, { code: 'PAYMENT_NOT_FOUND', message: 'nope', traceId: 't1', spanId: 's1' }));
    const error = await (await factory.payments(PRODUCT)).get(PID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BancontactApiError);
    expect(error).toMatchObject({ status: 404, code: BancontactErrorCode.PaymentNotFound, traceId: 't1', spanId: 's1' });
  });

  it('keeps a non-JSON gateway body verbatim', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, new Response('<html>Bad gateway</html>', { status: 502, headers: { 'WWW-Authenticate': 'Bearer' } }));
    const error = (await (await factory.payments(PRODUCT)).get(PID).catch((e: unknown) => e)) as BancontactApiError;
    expect(error.code).toBe('');
    expect(error.body).toBe('<html>Bad gateway</html>');
    expect(error.message).toMatch(/502.*Bad gateway.*Bearer/);
  });

  it('keeps a differently shaped JSON error body', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(401, { statusCode: 401, message: 'Access denied' }));
    const error = (await (await factory.payments(PRODUCT)).get(PID).catch((e: unknown) => e)) as BancontactApiError;
    expect(error.status).toBe(401);
    expect(error.code).toBe('');
    expect(error.body).toContain('Access denied');
  });

  it('does not retry a 429 or 503 by itself', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(429, { code: 'TRY_AGAIN_LATER', message: 'slow down' }));
    await expect((await factory.payments(PRODUCT)).get(PID)).rejects.toMatchObject({ status: 429 });
    expect(http.calls).toHaveLength(1);
  });
});

describe('RefundClient', () => {
  const refundBody = { refundId: PID, paymentId: PID, status: 'PENDING', amount: 500, currency: 'EUR', creationDate: '2026-01-02T03:04:05Z' };

  it('is signed and sends the idempotency key', async () => {
    const { http, factory } = setup();
    http.on('POST', `${BASE}/v3/payments/${PID}/refunds`, json(201, refundBody));
    const result = await (await factory.refunds(PRODUCT)).create(PID, { amount: 500, currency: 'EUR' }, 'key-1');

    const request = http.last;
    expect(request.headers['Idempotency-Key']).toBe('key-1');
    expect(request.headers.Authorization).toBe('Bearer api-key');
    expect(verify(request.headers.Signature as string, request.body, signingPair.publicKey)).toBe(true); // signed over the exact bytes sent
    const claims = claimsOf(request.headers.Signature as string);
    expect(claims[`${NS}path`]).toBe(`/v3/payments/${PID}/refunds`);
    expect(claims[`${NS}sub`]).toBe('ppid-1');
    expect(claims[`${NS}iss`]).toBe('Payconiq');
    expect(claims.kid).toBe('my-kid');
    expect(result.status).toBe(RefundStatus.Pending);
  });

  it('generates an idempotency key when none is given', async () => {
    const { http, factory } = setup();
    http.on('POST', `${BASE}/v3/payments/${PID}/refunds`, json(201, refundBody));
    await (await factory.refunds(PRODUCT)).create(PID, { amount: 500, currency: 'EUR' });
    expect(http.last.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('turns REFUND_REQUEST_CONFLICT into its own error', async () => {
    const { http, factory } = setup();
    http.on('POST', `${BASE}/v3/payments/${PID}/refunds`, json(422, { code: 'REFUND_REQUEST_CONFLICT', message: 'conflict' }));
    const error = await (await factory.refunds(PRODUCT)).create(PID, { amount: 500, currency: 'EUR' }, 'key-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RefundIdempotencyConflictError);
    expect(error).toBeInstanceOf(BancontactApiError);
    expect(error).toMatchObject({ idempotencyKey: 'key-1', traceId: undefined });
  });

  it('rejects an over-long or empty idempotency key before sending', async () => {
    const { http, factory } = setup();
    const client = await factory.refunds(PRODUCT);
    await expect(client.create(PID, { amount: 1, currency: 'EUR' }, 'x'.repeat(65))).rejects.toThrow(RangeError);
    await expect(client.create(PID, { amount: 1, currency: 'EUR' }, '')).rejects.toThrow(RangeError);
    expect(http.calls).toHaveLength(0);
  });

  it('gets a refund', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}/refunds/r-1`, json(200, { ...refundBody, status: 'REFUNDED' }));
    expect((await (await factory.refunds(PRODUCT)).get(PID, 'r-1')).status).toBe(RefundStatus.Refunded);
  });
});

describe('ReconciliationClient', () => {
  const page = (key: string, items: unknown[], number: number, totalPages: number) => ({
    size: items.length,
    totalPages,
    totalElements: 3,
    number,
    [key]: items,
  });

  it('signs over the path without the query string', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/reconciliation/payments?payout-id=${PID}&page=0`, json(200, page('payments', [], 0, 1)));
    await (await factory.reconciliation(PRODUCT)).getPayments({ payoutId: PID, page: 0 });
    expect(claimsOf(http.last.headers.Signature as string)[`${NS}path`]).toBe('/v3/reconciliation/payments');
    expect(verify(http.last.headers.Signature as string, Buffer.alloc(0), signingPair.publicKey)).toBe(true);
  });

  it('builds the payouts and date-range queries', async () => {
    const { http, factory } = setup();
    http
      .on('GET', `${BASE}/v3/reconciliation/payouts?date=2026-01-02`, json(200, page('payouts', [], 0, 0)))
      .on('GET', `${BASE}/v3/reconciliation/refunds?start-date=2026-01-01&end-date=2026-01-31&size=10000`, json(200, page('refunds', [], 0, 0)));
    const client = await factory.reconciliation(PRODUCT);
    await client.getPayouts({ date: new Date('2026-01-02T12:00:00Z') });
    await client.getRefunds({ startDate: '2026-01-01', endDate: '2026-01-31', size: 10000 });
    expect(http.calls).toHaveLength(2);
  });

  it('validates the filter before sending', async () => {
    const { http, factory } = setup();
    const client = await factory.reconciliation(PRODUCT);
    await expect(client.getPayments({ startDate: '2026-01-01' })).rejects.toThrow(RangeError);
    await expect(client.getRefunds({ startDate: '2026-01-01', endDate: '2026-03-01' })).rejects.toThrow(/30 days/);
    await expect(client.getPayouts({ date: 'yesterday' })).rejects.toThrow(RangeError);
    expect(http.calls).toHaveLength(0);
  });

  it('surfaces PAYOUT_NOT_FOUND', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/reconciliation/payments?payout-id=x`, json(404, { code: 'PAYOUT_NOT_FOUND', message: 'no' }));
    await expect((await factory.reconciliation(PRODUCT)).getPayments({ payoutId: 'x' })).rejects.toMatchObject({
      code: BancontactErrorCode.PayoutNotFound,
    });
  });

  it('walks all pages', async () => {
    const { http, factory } = setup();
    const payout = (id: string) => ({
      payoutId: id, merchantId: 'm', bulkId: 'b', iban: 'BE1', payoutStatus: 'SUCCEEDED', payoutDate: '2026-01-02T00:00:00Z',
      payoutCurrency: 'EUR', totalPayments: 1, totalRefunds: 0, totalPaymentAmount: 1, totalRefundAmount: 0, payoutAmount: 1,
    });
    http
      .on('GET', `${BASE}/v3/reconciliation/payouts?page=0`, json(200, page('payouts', [payout('a'), payout('b')], 0, 2)))
      .on('GET', `${BASE}/v3/reconciliation/payouts?page=1`, json(200, page('payouts', [payout('c')], 1, 2)));
    const ids: string[] = [];
    for await (const item of (await factory.reconciliation(PRODUCT)).iteratePayouts()) ids.push(item.payoutId);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('BancontactClientFactory', () => {
  it('fails at client creation for a missing product or signing key', async () => {
    const { factory } = setup();
    await expect(factory.payments(BancontactProduct.TopUp)).rejects.toThrow(ProductNotConfiguredError);
    const noKey = setup(credentials({ signingKey: undefined })).factory;
    await expect(noKey.refunds(PRODUCT)).rejects.toThrow(SigningKeyNotConfiguredError);
    await expect(noKey.reconciliation(PRODUCT)).rejects.toThrow(SigningKeyNotConfiguredError);
    expect(await noKey.isConfigured(PRODUCT)).toBe(true);
    expect(await noKey.isConfigured(BancontactProduct.TopUp)).toBe(false);
  });

  it('rejects an unusable signing key with a clear message and no secret in it', async () => {
    const bad = setup(credentials({ signingKey: { kid: 'k', privateKeyPem: 'not a pem' } })).factory;
    const error = (await bad.refunds(PRODUCT).catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/not a valid PEM-encoded EC/);
    expect(error.message).not.toContain('not a pem');
  });

  it('reads the credentials on every call', async () => {
    let current = credentials();
    const { http, factory } = setup(() => current);
    http
      .on('GET', `${BASE}/v3/payments/${PID}`, json(200, { ...CREATED, expireAt: '2026-01-02T03:06:05Z' }))
      .on('GET', `https://merchant.api.bancontact.net/v3/payments/${PID}`, json(200, { ...CREATED, expireAt: '2026-01-02T03:06:05Z' }));
    await (await factory.payments(PRODUCT)).get(PID);
    current = credentials({ environment: BancontactEnvironment.Production });
    await (await factory.payments(PRODUCT)).get(PID);
    expect(http.calls.map((c) => new URL(c.url).host)).toEqual(['merchant.api.preprod.bancontact.net', 'merchant.api.bancontact.net']);
  });

  it('accepts an async provider', async () => {
    const http = new FakeFetch().on('GET', `${BASE}/v3/payments/${PID}`, json(200, { ...CREATED, expireAt: '2026-01-02T03:06:05Z' }));
    const factory = new BancontactClientFactory(() => Promise.resolve(credentials()), { fetch: http.fetch });
    await (await factory.payments(PRODUCT)).get(PID);
    expect(http.calls).toHaveLength(1);
  });

  it('keeps secrets out of its string forms', async () => {
    const { http, factory } = setup();
    http.on('GET', `${BASE}/v3/payments/${PID}`, json(401, {}));
    const error = (await (await factory.payments(PRODUCT)).get(PID).catch((e: unknown) => e)) as Error;
    expect(`${error.message}${String(error.stack)}`).not.toContain('api-key');
  });
});
