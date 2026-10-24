import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { BancontactApiError } from './errors.js';
import type { FetchLike } from './jwks.js';
import { sign } from './signing.js';
import { VERSION } from './version.js';

export const DEFAULT_TIMEOUT_MS = 100_000;
export const USER_AGENT = `bancontactpro-typescript/${VERSION} (+https://github.com/yvebrecht/BancontactPro.TypeScript)`;


export interface Auth {
  apply(headers: Record<string, string>, path: string, body: Uint8Array): void;
}

/** Payment API: the API key alone authenticates (the spec lists the JWS scheme as an alternative). */
export class ApiKeyAuth implements Auth {
  constructor(private readonly apiKey: string) {}

  apply(headers: Record<string, string>): void {
    headers.Authorization = `Bearer ${this.apiKey}`;
  }

  toString(): string {
    return 'ApiKeyAuth(***)';
  }
}

/** Refund and Reconciliation: bearer API key plus a detached JWS `Signature` over the request body. */
export class SigningAuth implements Auth {
  constructor(
    private readonly apiKey: string,
    private readonly merchantProfileId: string,
    private readonly issuer: string,
    private readonly kid: string,
    private readonly privateKey: KeyObject,
    private readonly now: () => Date = () => new Date(),
  ) {}

  apply(headers: Record<string, string>, path: string, body: Uint8Array): void {
    headers.Signature = sign(
      {
        kid: this.kid,
        merchantProfileId: this.merchantProfileId,
        issuer: this.issuer,
        issuedAt: this.now(),
        requestId: randomUUID(),
        path, // the absolute path of the request URI, without the query string
      },
      body,
      this.privateKey,
    );
    headers.Authorization = `Bearer ${this.apiKey}`;
  }

  toString(): string {
    return `SigningAuth(kid=${this.kid}, ***)`;
  }
}

/** One configured connection to the merchant API: base URL, credentials and the `fetch` to use. */
export class Transport {
  private readonly baseUrl: string;

  constructor(
    private readonly fetchImpl: FetchLike,
    baseUrl: string,
    private readonly auth: Auth,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Sends the request, throws `BancontactApiError` on a non-success status, returns decoded JSON (or `undefined` for
   * an empty body). `relativePath` may carry an already-encoded query string. Nothing is retried: a 429 or 503 is
   * surfaced to the caller, who decides.
   */
  async request(method: string, relativePath: string, body?: unknown, headers?: Record<string, string>): Promise<unknown> {
    const [path = '', query] = relativePath.split('?', 2);
    // The exact bytes that are signed are the exact bytes that are sent: no re-serialization in between.
    const content = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
    const requestHeaders: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    this.auth.apply(requestHeaders, `/${path}`, content);

    const url = `${this.baseUrl}/${path}${query ? `?${query}` : ''}`;
    const init: RequestInit = { method, headers: requestHeaders, signal: AbortSignal.timeout(this.timeoutMs) };
    if (content.length > 0) init.body = content;
    const response = await this.fetchImpl(url, init);
    await ensureSuccess(response);
    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as unknown) : undefined;
  }
}

/**
 * Turns a non-success response into `BancontactApiError`.
 *
 * `traceId` and `spanId` are only defined by the Payment API's error schema; they are `undefined` for Refund and
 * Reconciliation errors. A body that is not Bancontact's error shape (an upstream 502, a gateway 401) falls back to a
 * generic error carrying the raw status and text, never an unrelated parse error.
 */
export async function ensureSuccess(response: Response): Promise<void> {
  if (response.ok) return;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const error = parsed as Record<string, unknown>;
    if (typeof error.code === 'string' && error.code) {
      throw new BancontactApiError({
        status: response.status,
        code: error.code,
        message: typeof error.message === 'string' && error.message ? error.message : text,
        traceId: typeof error.traceId === 'string' ? error.traceId : undefined,
        spanId: typeof error.spanId === 'string' ? error.spanId : undefined,
        body: text,
      });
    }
  }

  let message = text.trim()
    ? `Bancontact returned ${response.status}: ${text}`
    : `Bancontact returned ${response.status} with no response body.`;
  const challenge = response.headers.get('WWW-Authenticate');
  if (challenge) message += ` (WWW-Authenticate: ${challenge})`;
  throw new BancontactApiError({ status: response.status, message, body: text });
}
