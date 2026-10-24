import { describe, expect, it } from 'vitest';
import { BancontactCallbackVerifier, BancontactClientFactory, BancontactEnvironment, InvalidCallbackError, JwksClient, MerchantPaymentStatus } from '../src/index.js';
import { BancontactSignatureVerifier, sign, toPublicJwkJson } from '../src/signing.js';
import type { JoseHeader } from '../src/signing.js';
import { CALLBACK_BODY, credentials, FakeFetch, generateEcKey, json } from './helpers.js';

const JWKS_PREPROD = 'https://jwks.preprod.bancontact.net/';
const JWKS_PROD = 'https://jwks.bancontact.net/';
const bank = generateEcKey();

const header = (kid = 'bank-kid', path = '/callback'): JoseHeader => ({
  kid,
  merchantProfileId: 'ppid',
  issuer: 'payconiq',
  issuedAt: new Date('2026-01-02T00:00:00.000Z'),
  requestId: 'jti-xyz',
  path,
});

const jwksDocument = (key = bank, kid = 'bank-kid') => ({
  keys: [JSON.parse(toPublicJwkJson(key.privateKey, kid)) as unknown, { kty: 'RSA', kid: 'rsa' }, { kty: 'EC' }],
});

const fixedKeys = {
  getKey: (kid: string) => Promise.resolve(kid === 'bank-kid' ? bank.publicKey : undefined),
};
const verifier = new BancontactCallbackVerifier(new BancontactSignatureVerifier(fixedKeys));

describe('BancontactCallbackVerifier', () => {
  it('parses a valid callback', async () => {
    const result = await verifier.verifyAndParse(sign(header(), CALLBACK_BODY, bank.privateKey), CALLBACK_BODY, '/callback');
    expect(result.requestId).toBe('jti-xyz');
    expect(result.payload.status).toBe(MerchantPaymentStatus.Authorized);
    expect(result.payload.amount).toBe(1000);
    expect(result.payload.debtor.name).toBe('Jane Doe');
    expect(result.payload.succeededAt).toBeUndefined(); // an explicit null is treated as absent
    expect(result.payload.expireAt?.toISOString()).toBe('2026-01-02T03:19:05.123Z'); // preprod sends microseconds and +00:00
  });

  it('rejects a wrong key, a tampered body, a wrong path and an unknown kid', async () => {
    const other = generateEcKey();
    const good = sign(header(), CALLBACK_BODY, bank.privateKey);
    const tampered = Buffer.from(CALLBACK_BODY.toString().replace('1000', '9999'));
    await expect(verifier.verifyAndParse(sign(header(), CALLBACK_BODY, other.privateKey), CALLBACK_BODY, '/callback')).rejects.toThrow(InvalidCallbackError);
    await expect(verifier.verifyAndParse(good, tampered, '/callback')).rejects.toThrow(InvalidCallbackError);
    await expect(verifier.verifyAndParse(good, CALLBACK_BODY, '/elsewhere')).rejects.toThrow(InvalidCallbackError);
    await expect(
      verifier.verifyAndParse(sign(header('unknown'), CALLBACK_BODY, bank.privateKey), CALLBACK_BODY, '/callback'),
    ).rejects.toThrow(InvalidCallbackError);
  });

  it('never accepts a missing or empty Signature header', async () => {
    await expect(verifier.verifyAndParse('', CALLBACK_BODY, '/callback')).rejects.toThrow(InvalidCallbackError);
  });

  it('raises InvalidCallbackError for a validly signed body that is not a callback', async () => {
    for (const text of ['not json', '{}', '[]', 'null']) {
      const body = Buffer.from(text);
      await expect(verifier.verifyAndParse(sign(header(), body, bank.privateKey), body, '/callback')).rejects.toThrow(InvalidCallbackError);
    }
  });
});

describe('JwksClient', () => {
  const provider = (environment: BancontactEnvironment = BancontactEnvironment.Preprod) => () => ({ environment });

  it('caches, and reloads on an unknown kid', async () => {
    const http = new FakeFetch().on('GET', JWKS_PREPROD, () => json(200, jwksDocument()));
    let now = 0;
    const client = new JwksClient(provider(), { fetch: http.fetch, now: () => now, minReloadIntervalMs: 1000 });

    expect((await client.getKey('bank-kid'))?.export({ format: 'jwk' })).toMatchObject({ kty: 'EC' });
    await client.getKey('bank-kid');
    expect(http.calls).toHaveLength(1); // second hit comes from the cache

    expect(await client.getKey('rotated')).toBeUndefined();
    expect(http.calls).toHaveLength(1); // within the cool-down: no reload storm for unknown key ids

    now = 1001;
    expect(await client.getKey('rotated')).toBeUndefined();
    expect(http.calls).toHaveLength(2); // a miss after the cool-down triggers exactly one reload
    expect(await client.getKey('rsa')).toBeUndefined(); // non-EC keys are ignored
  });

  it('coalesces concurrent misses into one download', async () => {
    const http = new FakeFetch().on('GET', JWKS_PREPROD, () => json(200, jwksDocument()));
    const client = new JwksClient(provider(), { fetch: http.fetch });
    const keys = await Promise.all(Array.from({ length: 10 }, () => client.getKey('bank-kid')));
    expect(keys.every((k) => k !== undefined)).toBe(true);
    expect(http.calls).toHaveLength(1);
  });

  it('drops keys after maxAge and keeps environments apart', async () => {
    const http = new FakeFetch()
      .on('GET', JWKS_PREPROD, () => json(200, jwksDocument()))
      .on('GET', JWKS_PROD, () => json(200, { keys: [] }));
    let now = 0;
    let environment: BancontactEnvironment = BancontactEnvironment.Preprod;
    const client = new JwksClient(() => ({ environment }), { fetch: http.fetch, now: () => now, maxAgeMs: 100 });

    await client.getKey('bank-kid');
    now = 101;
    await client.getKey('bank-kid');
    expect(http.calls).toHaveLength(2); // a stale cache is refreshed

    environment = BancontactEnvironment.Production;
    expect(await client.getKey('bank-kid')).toBeUndefined(); // preprod keys are never used for production
    expect(http.calls.at(-1)?.url).toBe(JWKS_PROD);
  });

  it('surfaces a failed download and retries next time', async () => {
    let status = 500;
    const http = new FakeFetch().on('GET', JWKS_PREPROD, () => (status === 200 ? json(200, jwksDocument()) : json(status, {})));
    const client = new JwksClient(provider(), { fetch: http.fetch });
    await expect(client.getKey('bank-kid')).rejects.toThrow(/500/);
    status = 200;
    expect(await client.getKey('bank-kid')).toBeDefined();
  });
});

describe('factory.callbackVerifier', () => {
  it('verifies end to end through the JWKS download', async () => {
    const http = new FakeFetch().on('GET', JWKS_PREPROD, () => json(200, jwksDocument()));
    const factory = new BancontactClientFactory(credentials(), { fetch: http.fetch });
    const result = await factory
      .callbackVerifier()
      .verifyAndParse(sign(header(), CALLBACK_BODY, bank.privateKey), CALLBACK_BODY, '/callback');
    expect(result.payload.paymentId).toBe('5c18cbd1296e9a26d3278518');
  });
});
