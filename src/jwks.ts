import type { KeyObject } from 'node:crypto';
import type { CredentialsProvider } from './credentials.js';
import { getJwksUrl } from './endpoints.js';
import { BancontactEnvironment } from './enums.js';
import { jwkToPublicKey } from './signing.js';
import type { JwksKeySource } from './signing.js';

/** The HTTP function used for the JWKS download; any `fetch`-compatible function. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JwksClientOptions {
  /** Injected `fetch`; defaults to the global one. */
  fetch?: FetchLike;
  /** Keys are dropped after this long. The callback guide allows caching for up to 12 hours (the default). */
  maxAgeMs?: number;
  /**
   * Minimum time between reloads triggered by an unknown `kid`. Protects the JWKS host (and this process) from a
   * flood of callbacks carrying random key ids; a normal rotation is published 24 hours before the old key leaves.
   */
  minReloadIntervalMs?: number;
  /** Injected clock in milliseconds, for tests. */
  now?: () => number;
}

interface EnvironmentCache {
  keys: Map<string, KeyObject>;
  fetchedAt: number | undefined;
  inFlight: Promise<Map<string, KeyObject>> | undefined;
}

/**
 * Fetches and caches Bancontact's JWKS, one cache per environment.
 *
 * Follows the callback guide (https://docs.bancontactpro.com/guides/general/callback052025): keys are re-fetched when
 * a `kid` is not found (Bancontact can rotate keys, publishing a new key 24 hours before the old one is removed).
 * Concurrent misses share one fetch. The only network traffic is the download through the supplied `fetch`.
 *
 * Long-lived by design: build one and keep it, never one per call.
 */
export class JwksClient implements JwksKeySource {
  private readonly caches = new Map<BancontactEnvironment, EnvironmentCache>();
  private readonly fetchImpl: FetchLike;
  private readonly maxAgeMs: number;
  private readonly minReloadIntervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly credentials: CredentialsProvider,
    options: JwksClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.maxAgeMs = options.maxAgeMs ?? 12 * 3600 * 1000;
    this.minReloadIntervalMs = options.minReloadIntervalMs ?? 30 * 1000;
    this.now = options.now ?? Date.now;
  }

  async getKey(kid: string): Promise<KeyObject | undefined> {
    const environment = (await this.credentials()).environment ?? BancontactEnvironment.Preprod;
    let cache = this.caches.get(environment);
    if (cache === undefined) {
      cache = { keys: new Map(), fetchedAt: undefined, inFlight: undefined };
      this.caches.set(environment, cache);
    }

    const age = cache.fetchedAt === undefined ? Infinity : this.now() - cache.fetchedAt;
    if (age < this.maxAgeMs) {
      const hit = cache.keys.get(kid);
      if (hit !== undefined) return hit;
      // A miss on a fresh cache reloads at most once per interval, so unknown key ids cannot cause a reload storm.
      if (age < this.minReloadIntervalMs) return undefined;
    }

    return (await this.reload(environment, cache)).get(kid);
  }

  private reload(environment: BancontactEnvironment, cache: EnvironmentCache): Promise<Map<string, KeyObject>> {
    cache.inFlight ??= this.download(environment)
      .then((keys) => {
        cache.keys = keys;
        cache.fetchedAt = this.now();
        return keys;
      })
      .finally(() => {
        cache.inFlight = undefined;
      });
    return cache.inFlight;
  }

  private async download(environment: BancontactEnvironment): Promise<Map<string, KeyObject>> {
    const response = await this.fetchImpl(getJwksUrl(environment), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Downloading the Bancontact JWKS failed with status ${response.status}.`);
    const document = (await response.json()) as { keys?: unknown };
    const keys = new Map<string, KeyObject>();
    for (const jwk of Array.isArray(document.keys) ? (document.keys as Record<string, unknown>[]) : []) {
      if (typeof jwk.kid !== 'string') continue;
      const key = jwkToPublicKey(jwk);
      if (key !== undefined) keys.set(jwk.kid, key);
    }
    return keys;
  }
}
