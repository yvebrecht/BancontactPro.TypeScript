import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, BancontactSignatureVerifier, jwkToPublicKey, sign, toPublicJwkJson, verify } from '../src/signing.js';
import type { JoseHeader } from '../src/signing.js';
import { generateEcKey } from './helpers.js';

const NS = 'https://payconiq.com/';
const HEADER: JoseHeader = {
  kid: 'kid-1',
  merchantProfileId: 'ppid-1',
  issuer: 'Payconiq',
  issuedAt: new Date('2026-01-02T03:04:05.678Z'),
  requestId: 'jti-1',
  path: '/callback',
};
const key = generateEcKey();
const body = Buffer.from('{"a":1}');

const jwks = (keys: Record<string, typeof key.publicKey>) => ({ getKey: (kid: string) => Promise.resolve(keys[kid]) });

describe('detached JWS', () => {
  it('is header..signature with a raw 64-byte r||s, never DER', () => {
    const jws = sign(HEADER, body, key.privateKey);
    const [, middle, signature] = jws.split('.');
    expect(middle).toBe(''); // RFC 7797 detached form documented by Bancontact: empty payload segment
    expect(b64urlDecode(signature as string)).toHaveLength(64);
    expect(verify(jws, body, key.publicKey)).toBe(true);
  });

  it('carries the documented header claims, unescaped, in the documented order', () => {
    const jws = sign(HEADER, body, key.privateKey);
    const raw = b64urlDecode(jws.split('.')[0] as string).toString('utf8');
    const claims = JSON.parse(raw) as Record<string, unknown>;
    expect(claims.typ).toBe('jose+json');
    expect(claims.alg).toBe('ES256');
    expect(claims.kid).toBe('kid-1');
    expect(claims[`${NS}iat`]).toBe('2026-01-02T03:04:05.678Z');
    expect(claims[`${NS}path`]).toBe('/callback');
    expect(claims.crit).toEqual(['sub', 'iss', 'iat', 'jti', 'path'].map((s) => NS + s));
    expect(raw).toContain('https://payconiq.com/sub'); // "/" is not escaped
  });

  it('fails for a tampered body and for another key', () => {
    const jws = sign(HEADER, Buffer.from('original'), key.privateKey);
    expect(verify(jws, Buffer.from('tampered'), key.publicKey)).toBe(false);
    expect(verify(jws, Buffer.from('original'), generateEcKey().publicKey)).toBe(false);
  });

  it('tolerates the single-dot form on verify', () => {
    const [head, , signature] = sign(HEADER, body, key.privateKey).split('.');
    expect(verify(`${head}.${signature}`, body, key.publicKey)).toBe(true);
  });

  it.each(['', 'abc', 'a.b.c.d', 'a..b..c', '!!!..???'])('never throws on malformed input %j', (bad) => {
    expect(verify(bad, body, key.publicKey)).toBe(false);
  });

  it('rejects a signature of the wrong length (for example DER)', () => {
    const [head] = sign(HEADER, body, key.privateKey).split('.');
    expect(verify(`${head}..${b64urlEncode(Buffer.alloc(70, 1))}`, body, key.publicKey)).toBe(false);
  });
});

describe('BancontactSignatureVerifier', () => {
  const verifier = new BancontactSignatureVerifier(jwks({ 'kid-1': key.publicKey }));

  it('returns the claims', async () => {
    const claims = await verifier.verify(sign(HEADER, body, key.privateKey), body, '/callback');
    expect(claims?.requestId).toBe('jti-1');
    expect(claims?.issuedAt).toEqual(HEADER.issuedAt);
  });

  it('rejects a wrong path, an unknown kid and a wrong key', async () => {
    const jws = sign(HEADER, body, key.privateKey);
    expect(await verifier.verify(jws, body, '/other')).toBeUndefined();
    expect(await new BancontactSignatureVerifier(jwks({})).verify(jws, body, '/callback')).toBeUndefined();
    const wrong = new BancontactSignatureVerifier(jwks({ 'kid-1': generateEcKey().publicKey }));
    expect(await wrong.verify(jws, body, '/callback')).toBeUndefined();
  });

  it('rejects an unrecognised critical extension', async () => {
    const jws = sign(HEADER, body, key.privateKey);
    const [head, , signature] = jws.split('.') as [string, string, string];
    const claims = JSON.parse(b64urlDecode(head).toString('utf8')) as { crit: string[] };
    claims.crit.push('https://example.com/extra');
    expect(await verifier.verify(`${b64urlEncode(JSON.stringify(claims))}..${signature}`, body, '/callback')).toBeUndefined();
  });

  it.each(['', 'x', 'a..b', `${b64urlEncode('[]')}..AAAA`, `${b64urlEncode('{"kid":1}')}..AAAA`])(
    'returns undefined for garbage %j',
    async (bad) => {
      expect(await verifier.verify(bad, body, '/callback')).toBeUndefined();
    },
  );
});

describe('JWK helpers', () => {
  it('round-trips a P-256 key and refuses other curves and key types', () => {
    const jwk = JSON.parse(toPublicJwkJson(key.privateKey, 'k')) as Record<string, string>;
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'k', use: 'sig', alg: 'ES256' });
    const imported = jwkToPublicKey(jwk);
    expect(imported?.export({ format: 'jwk' })).toMatchObject({ x: jwk.x, y: jwk.y });
    expect(jwkToPublicKey({ ...jwk, crv: 'P-384' })).toBeUndefined();
    expect(jwkToPublicKey({ kty: 'RSA' })).toBeUndefined();
  });
});
