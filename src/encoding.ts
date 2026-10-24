/** Percent-encodes one path or query value, leaving only RFC 3986 unreserved characters (`encodeURIComponent` also spares `!'()*`). */
export function escape(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
