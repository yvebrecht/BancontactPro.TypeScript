/**
 * A small runtime description of each response model. It drives parsing (dates, tolerant enums, required
 * properties) and the contract tests that compare the models with the stored OpenAPI specs.
 *
 * Wire names equal the TypeScript property names (the specs are camelCase), so there is no name mapping. The
 * hypermedia property is literally `_links` in the specs and is kept as is.
 */
import { InvalidResponseError } from './errors.js';

export type Kind = 'string' | 'integer' | 'datetime' | { model: AnySchema } | { array: Kind };

export interface Field {
  kind: Kind;
  required: boolean;
}

/** Any schema, for nesting. */
export type AnySchema = Readonly<Record<string, Field>>;
/** Every property of `T` must be described, and nothing else. */
export type Schema<T> = { readonly [K in keyof Required<T>]: Field };

export const required = (kind: Kind): Field => ({ kind, required: true });
export const optional = (kind: Kind): Field => ({ kind, required: false });

const OFFSET = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/**
 * Parses ISO 8601 with or without fractional seconds (milliseconds or microseconds) and with or without an offset.
 * A value without an offset is read as UTC. Fractions beyond milliseconds are truncated by `Date`.
 */
export function parseDateTime(value: string): Date {
  const hasTime = value.includes('T');
  const normalised = hasTime && !OFFSET.test(value) ? `${value}Z` : value;
  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) throw new InvalidResponseError(`'${value}' is not a valid ISO 8601 date-time.`);
  return parsed;
}

export function parseModel<T>(schema: Schema<T>, data: unknown, path = ''): T {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new InvalidResponseError(`Expected an object${path ? ` at '${path}'` : ''}.`);
  }
  const source = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema as AnySchema)) {
    const value = source[name];
    // Optional is not nullable in the specs, but real callbacks send explicit nulls: treat null as absent.
    if (value === undefined || value === null) {
      if (field.required) throw new InvalidResponseError(`Missing required property '${path}${name}'.`);
      continue;
    }
    result[name] = parseKind(field.kind, value, `${path}${name}`);
  }
  return result as T;
}

function parseKind(kind: Kind, value: unknown, path: string): unknown {
  if (kind === 'string') {
    if (typeof value !== 'string') throw new InvalidResponseError(`Expected a string at '${path}'.`);
    return value;
  }
  if (kind === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidResponseError(`Expected a number at '${path}'.`);
    return value;
  }
  if (kind === 'datetime') {
    if (typeof value !== 'string') throw new InvalidResponseError(`Expected a date-time string at '${path}'.`);
    return parseDateTime(value);
  }
  if ('array' in kind) {
    if (!Array.isArray(value)) throw new InvalidResponseError(`Expected an array at '${path}'.`);
    return value.map((item, index) => parseKind(kind.array, item, `${path}[${index}]`));
  }
  return parseModel(kind.model, value, `${path}.`);
}
