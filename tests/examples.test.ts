/** The examples must compile (tsc includes them) and run against mocked HTTP only. */
import { describe, expect, it } from 'vitest';
import { BancontactClientFactory } from '../src/index.js';
import { handleCallback } from '../examples/callback.js';
import { createOnDisplayPayment, createStaticQrPayment } from '../examples/payment.js';
import { receiptQr } from '../examples/qr.js';
import { reconcileDay } from '../examples/reconciliation.js';
import { refundPartially } from '../examples/refund.js';
import { sign, toPublicJwkJson } from '../src/signing.js';
import { BASE, CALLBACK_BODY, CREATED, credentials, empty, FakeFetch, generateEcKey, json, PID } from './helpers.js';

const both = (...products: string[]) => credentials({ products: Object.fromEntries(products.map((p) => [p, { apiKey: 'k', merchantProfileId: 'p' }])) });

function factoryFor(http: FakeFetch, products: string[]) {
  return new BancontactClientFactory(both(...products), { fetch: http.fetch });
}

describe('examples', () => {
  it('payment', async () => {
    const http = new FakeFetch()
      .on('POST', `${BASE}/v3/payments`, json(201, CREATED))
      .on('GET', `${BASE}/v3/payments/${PID}`, json(200, { ...CREATED, expireAt: CREATED.expiresAt }))
      .on('POST', `${BASE}/v3/payments/pos`, json(201, CREATED));
    const factory = factoryFor(http, ['OnDisplay', 'StaticQr']);
    expect((await createOnDisplayPayment(factory)).paymentId).toBe(PID);
    expect((await createStaticQrPayment(factory)).paymentId).toBe(PID);
  });

  it('callback', async () => {
    const bank = generateEcKey();
    const http = new FakeFetch().on('GET', 'https://jwks.preprod.bancontact.net/', () => json(200, { keys: [JSON.parse(toPublicJwkJson(bank.privateKey, 'bank')) as unknown] }));
    const factory = factoryFor(http, []);
    const header = { kid: 'bank', merchantProfileId: 'p', issuer: 'payconiq', issuedAt: new Date(), requestId: 'j', path: '/callback' };
    const signature = sign(header, CALLBACK_BODY, bank.privateKey);
    expect(await handleCallback(factory, { headers: { signature }, rawBody: CALLBACK_BODY, path: '/callback' })).toEqual({ status: 200 });
    expect(await handleCallback(factory, { headers: { signature }, rawBody: Buffer.from('{}'), path: '/callback' })).toEqual({ status: 401 });
  });

  it('refund', async () => {
    const http = new FakeFetch().on(
      'POST',
      `${BASE}/v3/payments/${PID}/refunds`,
      json(201, { refundId: 'r', paymentId: PID, status: 'PENDING', amount: 500, currency: 'EUR', creationDate: '2026-01-02T03:04:05Z' }),
    );
    expect((await refundPartially(factoryFor(http, ['OnDisplay']), PID)).status).toBe('PENDING');
  });

  it('reconciliation', async () => {
    const payout = {
      payoutId: 'po', merchantId: 'm', bulkId: 'b', iban: 'BE1', payoutStatus: 'SUCCEEDED', payoutDate: '2026-01-02T00:00:00Z',
      payoutCurrency: 'EUR', totalPayments: 1, totalRefunds: 0, totalPaymentAmount: 7, totalRefundAmount: 0, payoutAmount: 7,
    };
    const payment = {
      paymentId: PID, paymentProfileId: 'p', merchantName: 'Shop', paymentChannel: 'INSTORE', currency: 'EUR', amount: 7,
      transactionDate: '2026-01-02T00:00:00Z',
    };
    const http = new FakeFetch()
      .on('GET', `${BASE}/v3/reconciliation/payouts?date=2026-01-02&page=0`, json(200, { size: 1, totalPages: 1, totalElements: 1, number: 0, payouts: [payout] }))
      .on('GET', `${BASE}/v3/reconciliation/payments?payout-id=po&page=0`, json(200, { size: 1, totalPages: 1, totalElements: 1, number: 0, payments: [payment] }));
    expect(await reconcileDay(factoryFor(http, ['OnDisplay']), '2026-01-02')).toEqual({ po: 7 });
  });

  it('qr', () => {
    expect(receiptQr(PID)).toMatch(/^https:\/\/qrcodegenerator\.api\.bancontact\.net\/qrcode\?f=PNG&s=L&c=/);
  });

  it('cancel uses an empty 204', async () => {
    const http = new FakeFetch().on('DELETE', `${BASE}/v3/payments/${PID}`, empty(204));
    await (await factoryFor(http, ['OnDisplay']).payments('OnDisplay')).cancel(PID);
    expect(http.calls).toHaveLength(1);
  });
});
