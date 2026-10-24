/**
 * Detached JWS (RFC 7797) signing and verification, ES256 over P-256.
 *
 * The compact form has an empty payload segment: `base64url(header) + ".." + base64url(signature)`, where the
 * signature covers `base64url(header) + "." + base64url(body)`. The separator in the signing input is not stated by
 * Bancontact's callback guide (it writes `+`); `.` is the RFC 7797 convention and is an open item to confirm with
 * devsupport@bancontact.com against a real sample (BancontactPro.Net#1, #2). The header carries five custom claims
 * under a `https://payconiq.com/` namespace, all listed in `crit`.
 * See https://docs.bancontactpro.com/guides/general/callback052025 and `components.securitySchemes` in the specs.
 *
 * The signature is always raw `r || s` (64 bytes, IEEE P1363), never DER.
 */
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';

const NS = 'https://payconiq.com/';
const CRIT = [`${NS}sub`, `${NS}iss`, `${NS}iat`, `${NS}jti`, `${NS}path`];
const IAT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SIGNATURE_BYTES = 64; // P-256: 32-byte r followed by 32-byte s

export type Bytes = Uint8Array;

export interface JoseHeader {
  kid: string;
  /** The `sub` claim: the merchant profile id (PPID). */
  merchantProfileId: string;
  /** The `iss` claim. */
  issuer: string;
  /** The `iat` claim. */
  issuedAt: Date;
  /** The `jti` claim: unique per message. */
  requestId: string;
  /** The `path` claim: the path of the request URI, without query string. */
  path: string;
}

export function b64urlEncode(data: Bytes | string): string {
  return Buffer.from(data as Uint8Array).toString('base64url');
}

/** Strict unpadded base64url; throws on anything else. */
export function b64urlDecode(text: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('Not valid unpadded base64url.');
  return Buffer.from(text, 'base64url');
}

export function computeSigningInput(encodedHeader: string, body: Bytes): Buffer {
  return Buffer.from(`${encodedHeader}.${b64urlEncode(body)}`, 'ascii');
}

/**
 * Splits `header..signature` (RFC 7797, empty payload segment), as documented by Bancontact's callback guide and
 * API specs. The single-dot form `header.signature` is tolerated on input.
 */
export function trySplit(detachedJws: string): [header: string, signature: string] | undefined {
  const parts = detachedJws.split('.');
  if (parts.length === 3 && parts[1] === '') return [parts[0] as string, parts[2] as string];
  if (parts.length === 2) return [parts[0] as string, parts[1] as string];
  return undefined;
}

/** Signs `body` and returns the detached JWS for the `Signature` header. */
export function sign(header: JoseHeader, body: Bytes, privateKey: KeyObject): string {
  const claims = {
    typ: 'jose+json',
    kid: header.kid,
    alg: 'ES256',
    [`${NS}sub`]: header.merchantProfileId,
    [`${NS}iss`]: header.issuer,
    [`${NS}iat`]: header.issuedAt.toISOString(), // always yyyy-MM-ddTHH:mm:ss.fffZ
    [`${NS}jti`]: header.requestId,
    [`${NS}path`]: header.path,
    crit: CRIT,
  };
  // JSON.stringify writes no whitespace and does not escape "/", so the URI-shaped claim names round-trip byte for byte.
  const encodedHeader = b64urlEncode(JSON.stringify(claims));
  const signature = nodeSign('sha256', computeSigningInput(encodedHeader, body), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${encodedHeader}..${b64urlEncode(signature)}`;
}

/** Verifies a raw `r || s` signature over the signing input. Never throws. */
export function verifyRaw(publicKey: KeyObject, signature: Bytes, signingInput: Bytes): boolean {
  if (signature.length !== SIGNATURE_BYTES) return false;
  try {
    return nodeVerify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

/** Pure signature check (no header policy). Never throws on malformed input. */
export function verify(detachedJws: string, body: Bytes, publicKey: KeyObject): boolean {
  const parts = trySplit(detachedJws);
  if (parts === undefined) return false;
  const [encodedHeader, encodedSignature] = parts;
  let signature: Buffer;
  try {
    signature = b64urlDecode(encodedSignature);
  } catch {
    return false;
  }
  return verifyRaw(publicKey, signature, computeSigningInput(encodedHeader, body));
}

/** Resolves a Bancontact public key by `kid`; returns `undefined` when it does not exist. */
export interface JwksKeySource {
  getKey(kid: string): Promise<KeyObject | undefined>;
}

/**
 * Verifies an inbound detached JWS and its structural policy: `crit`, `path` and `iat`.
 *
 * Returns the parsed claims on success and `undefined` on any failure: malformed or malicious inbound data is an
 * expected, non-exceptional occurrence for anything facing the public internet.
 */
export class BancontactSignatureVerifier {
  constructor(private readonly jwks: JwksKeySource) {}

  async verify(signatureHeader: string, body: Bytes, path: string): Promise<JoseHeader | undefined> {
    const parts = trySplit(signatureHeader);
    if (parts === undefined) return undefined;
    const [encodedHeader, encodedSignature] = parts;

    const claims = parseClaims(encodedHeader);
    if (claims === undefined) return undefined;

    // An unrecognised (or missing) critical extension must cause rejection, never silent ignoring.
    if (claims.crit.length !== CRIT.length || !claims.crit.every((c) => CRIT.includes(c))) return undefined;

    // Defends against a validly signed message being replayed against the wrong route.
    if (claims.path !== path) return undefined;

    let signature: Buffer;
    try {
      signature = b64urlDecode(encodedSignature);
    } catch {
      return undefined;
    }

    const publicKey = await this.jwks.getKey(claims.kid);
    if (publicKey === undefined) return undefined;
    if (!verifyRaw(publicKey, signature, computeSigningInput(encodedHeader, body))) return undefined;

    if (!IAT_PATTERN.test(claims.iat)) return undefined;
    const issuedAt = new Date(claims.iat);
    if (Number.isNaN(issuedAt.getTime())) return undefined;

    return {
      kid: claims.kid,
      merchantProfileId: claims.sub,
      issuer: claims.iss,
      issuedAt,
      requestId: claims.jti,
      path: claims.path,
    };
  }
}

interface ParsedClaims {
  kid: string;
  sub: string;
  iss: string;
  iat: string;
  jti: string;
  path: string;
  crit: string[];
}

function parseClaims(encodedHeader: string): ParsedClaims | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(b64urlDecode(encodedHeader).toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const claims = raw as Record<string, unknown>;
  const { kid, crit } = claims;
  const sub = claims[`${NS}sub`];
  const iss = claims[`${NS}iss`];
  const iat = claims[`${NS}iat`];
  const jti = claims[`${NS}jti`];
  const path = claims[`${NS}path`];
  if (![kid, sub, iss, iat, jti, path].every((v) => typeof v === 'string')) return undefined;
  if (!Array.isArray(crit) || !crit.every((c) => typeof c === 'string')) return undefined;
  return { kid, sub, iss, iat, jti, path, crit } as ParsedClaims;
}

/** Converts an EC/P-256 JWK to a public key, or `undefined` if it is some other kind of key. */
export function jwkToPublicKey(jwk: JsonWebKey): KeyObject | undefined {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return undefined;
  try {
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch {
    return undefined;
  }
}

function assertP256(key: KeyObject): void {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Only P-256 (ES256) keys are supported.');
  }
}

/** Exports the public half of a P-256 key as a JWK, for Bancontact to host and fetch. */
export function toPublicJwkJson(key: KeyObject, kid: string): string {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  assertP256(publicKey);
  const { x, y } = publicKey.export({ format: 'jwk' });
  return JSON.stringify({ kty: 'EC', crv: 'P-256', kid, use: 'sig', alg: 'ES256', x, y });
}

/** Parses a PEM-encoded EC (P-256) private key (PKCS#8 or SEC1). */
export function loadEcPrivateKeyPem(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  assertP256(key);
  return key;
}
