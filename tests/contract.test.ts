/**
 * Contract tests: the models, enums, error codes and operations must match the stored copies of Bancontact's OpenAPI
 * specs. The specs in `tests/specs` are the versions below. When Bancontact publishes a newer spec these tests fail on
 * purpose, with a readable list of differences. To refresh them, see `tests/specs/README.md`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BancontactErrorCode,
  BancontactProduct,
  MerchantPaymentStatus,
  PaymentChannel,
  PayoutStatus,
  RefundStatus,
  VERSION,
} from '../src/index.js';
import * as models from '../src/models.js';
import type { AnySchema, Field, Kind } from '../src/schema.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const specUrl = (name: string) => new URL(`./specs/${name}.openapi.json`, import.meta.url);
const load = (name: string): Json => JSON.parse(readFileSync(specUrl(name), 'utf8')) as Json;
const VERSIONS = { 'merchant-payment': '3.6.5', 'refund-public': '3.0.3', 'merchant-reconciliation': '3.0.1' } as const;

/** Follows `$ref` and merges `allOf` into one schema with `properties` and `required`. */
function resolve(spec: Json, schema: Json): Json {
  if (schema.$ref !== undefined) {
    let node: Json = spec;
    for (const part of String(schema.$ref).replace(/^#\//, '').split('/')) node = node[part] as Json;
    return resolve(spec, node);
  }
  const merged: Json = { properties: {}, required: [] as string[] };
  for (const part of (schema.allOf ?? []) as Json[]) {
    const sub = resolve(spec, part);
    Object.assign(merged.properties, sub.properties);
    merged.required.push(...(sub.required ?? []));
  }
  Object.assign(merged.properties, schema.properties ?? {});
  merged.required.push(...(schema.required ?? []));
  for (const key of ['enum', 'type', 'format', 'items']) if (schema[key] !== undefined) merged[key] = schema[key];
  return merged;
}

// [spec, schema, our schema, spec properties deliberately not modelled]
// totalAmount: listed as required but never defined (BancontactPro.Net#28). voucherEligibility: deprecated.
const MODELS: [keyof typeof VERSIONS, string, AnySchema, string[]][] = [
  ['merchant-payment', 'payment_create_request', models.createPaymentRequestSchema, ['voucherEligibility']],
  ['merchant-payment', 'static_qr_payment_create_request', models.createStaticQrPaymentRequestSchema, ['voucherEligibility']],
  ['merchant-payment', 'payment_create_response', models.createPaymentResponseSchema, []],
  ['merchant-payment', 'get_payment_response', models.paymentSchema, ['totalAmount']],
  ['merchant-payment', 'merchant-callback', models.merchantCallbackSchema, ['totalAmount']],
  ['merchant-payment', 'merchant-acknowledge', models.paymentAcknowledgeRequestSchema, []],
  ['merchant-payment', 'payment-search-query', models.paymentSearchQuerySchema, []],
  ['merchant-payment', 'PaymentSearchResponse', models.paymentSearchResponseSchema, []],
  ['merchant-payment', 'refund-response', models.debtorRefundIbanSchema, []],
  ['merchant-payment', 'payment_creditor_response', models.paymentCreditorSchema, []],
  ['merchant-payment', 'links', models.paymentLinksSchema, []],
  ['merchant-payment', 'link', models.paymentLinkSchema, []],
  ['merchant-payment', 'error', models.errorResponseSchema, []],
  ['refund-public', 'CreateRefundRequest', models.createRefundRequestSchema, []],
  ['refund-public', 'RefundCreationResponse', models.refundCreationResponseSchema, []],
  ['refund-public', 'RefundModel', models.refundModelSchema, []],
  ['refund-public', 'ErrorResponse', models.errorResponseSchema, []],
  ['merchant-reconciliation', 'PayoutListItem', models.payoutSchema, []],
  ['merchant-reconciliation', 'PayoutListResponse', models.payoutListResponseSchema, []],
  ['merchant-reconciliation', 'PaymentDetails', models.reconciliationPaymentDetailsSchema, []],
  ['merchant-reconciliation', 'PayoutPaymentsResponse', models.payoutPaymentsResponseSchema, []],
  ['merchant-reconciliation', 'RefundDetails', models.reconciliationRefundDetailsSchema, []],
  ['merchant-reconciliation', 'PayoutRefundsResponse', models.payoutRefundsResponseSchema, []],
];

// The Payment API's error schema requires traceId and spanId, but the same model also serves the Refund and
// Reconciliation errors, which do not define them. Code and message are optional here so a malformed error body still parses.
const OPTIONAL_HERE = new Set(['error:code', 'error:message', 'error:traceId', 'error:spanId', 'ErrorResponse:code', 'ErrorResponse:message']);
// Modelled although this spec's schema lacks them: ErrorResponse is shared, and only the Payment API defines trace and span ids.
const EXTRA_OK: Record<string, string[]> = { 'refund-public:ErrorResponse': ['traceId', 'spanId'] };

function kindName(kind: Kind): string {
  if (typeof kind === 'string') return kind;
  return 'model' in kind ? 'model' : `array of ${kindName(kind.array)}`;
}

/** What our `Kind` should be for a property of the spec. */
function expectedKind(spec: Json, property: Json): string {
  const resolved = resolve(spec, property);
  if (resolved.format === 'date-time') return 'datetime';
  if (resolved.type === 'integer') return 'integer';
  if (resolved.type === 'array') return `array of ${expectedKind(spec, resolved.items as Json)}`;
  if (resolved.type === 'object' || Object.keys(resolved.properties as object).length > 0) return 'model';
  return 'string'; // strings and string enums (tolerant)
}

describe('stored specs', () => {
  it.each(Object.entries(VERSIONS))('%s is version %s', (name, version) => {
    expect((load(name).info as Json).version).toBe(version);
  });
});

describe.each(MODELS)('%s:%s', (specName, schemaName, ours, ignored) => {
  const spec = load(specName);
  const resolved = resolve(spec, (spec.components as Json).schemas[schemaName] as Json);
  const specProps = Object.keys(resolved.properties as object).filter((p) => !ignored.includes(p));
  const extraOk = EXTRA_OK[`${specName}:${schemaName}`] ?? [];

  it('has the same properties', () => {
    const modelled = Object.keys(ours);
    const missing = specProps.filter((p) => !modelled.includes(p));
    const extra = modelled.filter((p) => !specProps.includes(p) && !extraOk.includes(p));
    expect({ 'in the spec but not modelled': missing, 'modelled but not in the spec': extra }).toEqual({
      'in the spec but not modelled': [],
      'modelled but not in the spec': [],
    });
  });

  it('agrees on required and on the kind of every property', () => {
    const problems: string[] = [];
    for (const [name, field] of Object.entries(ours) as [string, Field][]) {
      if (!specProps.includes(name)) continue;
      if (!OPTIONAL_HERE.has(`${schemaName}:${name}`)) {
        const specRequired = (resolved.required as string[]).includes(name);
        if (field.required !== specRequired) problems.push(`${name}: spec says required=${specRequired}, model says required=${field.required}`);
      }
      const want = expectedKind(spec, (resolved.properties as Json)[name] as Json);
      if (kindName(field.kind) !== want) problems.push(`${name}: spec says ${want}, model says ${kindName(field.kind)}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('enums', () => {
  const cases: [keyof typeof VERSIONS, string, Record<string, string>][] = [
    ['merchant-payment', 'merchant-payment-status', MerchantPaymentStatus],
    ['refund-public', 'RefundStatus', RefundStatus],
    ['merchant-reconciliation', 'PayoutStatus', PayoutStatus],
    ['merchant-reconciliation', 'PaymentChannel', PaymentChannel],
  ];
  it.each(cases)('%s:%s has the same values', (specName, schemaName, ours) => {
    const values = (load(specName).components as Json).schemas[schemaName].enum as string[];
    expect(Object.values(ours).sort()).toEqual([...values].sort());
  });
});

describe('operations', () => {
  // Every operation we cover: [spec, method, path]. A new or removed operation in a spec fails the test below.
  const OPERATIONS: [keyof typeof VERSIONS, string, string][] = [
    ['merchant-payment', 'get', '/v3/payments/{id}'],
    ['merchant-payment', 'delete', '/v3/payments/{id}'],
    ['merchant-payment', 'post', '/v3/payments/search'],
    ['merchant-payment', 'post', '/v3/payments'],
    ['merchant-payment', 'post', '/v3/payments/pos'],
    ['merchant-payment', 'post', '/v3/payments/{id}/acknowledge'],
    ['merchant-payment', 'get', '/v3/payments/{id}/debtor/refundIban'],
    ['merchant-payment', 'post', '/callback'], // served by the merchant, verified by BancontactCallbackVerifier
    ['refund-public', 'post', '/v3/payments/{payment-id}/refunds'],
    ['refund-public', 'get', '/v3/payments/{payment-id}/refunds/{refund-id}'],
    ['merchant-reconciliation', 'get', '/v3/reconciliation/payouts'],
    ['merchant-reconciliation', 'get', '/v3/reconciliation/payments'],
    ['merchant-reconciliation', 'get', '/v3/reconciliation/refunds'],
  ];

  it.each(Object.keys(VERSIONS) as (keyof typeof VERSIONS)[])('%s covers exactly the operations in the spec', (name) => {
    const inSpec = Object.entries(load(name).paths as Json).flatMap(([path, item]) =>
      Object.keys(item as Json)
        .filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m))
        .map((m) => `${m} ${path}`),
    );
    const covered = OPERATIONS.filter(([n]) => n === name).map(([, m, p]) => `${m} ${p}`);
    expect({ 'new in spec': inSpec.filter((o) => !covered.includes(o)), 'gone from spec': covered.filter((o) => !inSpec.includes(o)) }).toEqual({
      'new in spec': [],
      'gone from spec': [],
    });
  });
});

describe('error codes and servers', () => {
  const allSpecText = Object.keys(VERSIONS).map((name) => readFileSync(specUrl(name), 'utf8')).join('\n');

  it.each(Object.values(BancontactErrorCode))('%s is documented in a spec', (code) => {
    expect(allSpecText).toContain(code);
  });

  it('uses the documented servers', () => {
    for (const name of Object.keys(VERSIONS)) {
      const urls = ((load(name).servers ?? []) as Json[]).map((s) => String(s.url));
      expect(urls.some((u) => u.includes('merchant.api.preprod.bancontact.net'))).toBe(true);
      expect(urls.some((u) => u.includes('merchant.api.bancontact.net'))).toBe(true);
    }
  });
});

describe('package', () => {
  it('keeps the version in package.json and version.ts in step', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Json;
    expect(pkg.version).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-preview\.\d+)?$/);
  });

  it('knows the four products of the guides', () => {
    expect(Object.values(BancontactProduct).sort()).toEqual(['OnDisplay', 'OnReceipt', 'StaticQr', 'TopUp']);
  });
});
