import { generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { BancontactCredentials, FetchLike } from '../src/index.js';
import { BancontactEnvironment, BancontactProduct } from '../src/index.js';

export const BASE = 'https://merchant.api.preprod.bancontact.net';
export const PID = '5c18cbd1296e9a26d3278518';

export function generateEcKey(): { privateKey: KeyObject; publicKey: KeyObject; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicKey, pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

export const signingPair = generateEcKey();

export function credentials(overrides: Partial<BancontactCredentials> = {}): BancontactCredentials {
  return {
    environment: BancontactEnvironment.Preprod,
    products: { [BancontactProduct.OnDisplay]: { apiKey: 'api-key', merchantProfileId: 'ppid-1' } },
    signingKey: { kid: 'my-kid', privateKeyPem: signingPair.pem },
    ...overrides,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
}

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function empty(status: number): Response {
  return new Response(null, { status });
}

/** A fake `fetch`: no network. Unmatched requests fail the test loudly. */
export class FakeFetch {
  readonly calls: RecordedRequest[] = [];
  private readonly routes = new Map<string, Responder>();

  on(method: string, url: string, responder: Responder | Response): this {
    this.routes.set(`${method} ${url}`, typeof responder === 'function' ? responder : () => responder.clone());
    return this;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined || init.body === null ? Buffer.alloc(0) : Buffer.from(init.body as Uint8Array);
    const request = { url: input, method, headers: { ...(init?.headers as Record<string, string>) }, body };
    this.calls.push(request);
    const route = this.routes.get(`${method} ${input}`);
    if (route === undefined) throw new Error(`Unexpected request: ${method} ${input}`);
    return route(request);
  };

  get last(): RecordedRequest {
    const call = this.calls.at(-1);
    if (call === undefined) throw new Error('No request was made.');
    return call;
  }
}

export const LINK = { href: 'https://x' };
export const CREATED = {
  paymentId: PID,
  status: 'PENDING',
  createdAt: '2026-01-02T03:04:05.123456+00:00',
  expiresAt: '2026-01-02T03:06:05.000Z',
  amount: 1000,
  currency: 'EUR',
  creditor: { name: 'Shop' },
  _links: { self: LINK, deeplink: LINK, qrcode: LINK, checkout: LINK },
};

export const CALLBACK_BODY = Buffer.from(
  JSON.stringify({
    paymentId: PID,
    currency: 'EUR',
    amount: 1000,
    description: 'Order #42',
    createdAt: '2026-01-02T03:04:05.000Z',
    expireAt: '2026-01-02T03:19:05.123456+00:00',
    succeededAt: null,
    status: 'AUTHORIZED',
    debtor: { iban: 'BE**********1234', name: 'Jane Doe' },
  }),
);
