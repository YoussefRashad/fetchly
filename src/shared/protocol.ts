/**
 * Wire protocol v1 between the app's local server and the browser extension: limits, formats, error
 * tokens and the A1 request and response types. Imported by the main process and by the extension, so
 * it has no Node imports.
 */

export const PROTOCOL = 1;

/** The port the server listens on when settings.json holds none, or an invalid one (never clamped). */
export const DEFAULT_SERVER_PORT = 38917;
export const PORT_MIN = 1024;
export const PORT_MAX = 65535;

/** A whole number from PORT_MIN to PORT_MAX, of type number. No coercion: "38917" is not a port. */
export function isServerPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= PORT_MIN && v <= PORT_MAX;
}

/** Body limit of every route but /v1/handoff and /v1/logins. */
export const BODY_LIMIT = 64 * 1024;
/** Body limit of /v1/handoff and /v1/logins (A3, A6). */
export const LARGE_BODY_LIMIT = 512 * 1024;

/** An unpacked Chrome or Edge extension: 32 letters a to p. */
export const ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/u;
/** 16 random bytes, base64url without padding. */
export const PAIRING_ID_RE = /^[A-Za-z0-9_-]{22}$/u;
/** 32 random bytes, base64url without padding. */
export const NONCE_RE = /^[A-Za-z0-9_-]{43}$/u;
/** 32 random bytes, base64url without padding. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/u;

/** 32 symbols, without I, L, O and U. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/u;

/** The longest label, in UTF-16 code units. */
export const LABEL_MAX = 40;
export const MAX_PAIRINGS = 4;

/** proofKey = HMAC-SHA256(key = the token's ASCII bytes, message = this text). */
export const PROOF_KEY_LABEL = 'fetchly-server-proof-v1';

/** Bidirectional formatting characters: U+200E, U+200F, U+202A..U+202E, U+2066..U+2069. */
export const BIDI = /[‎‏‪-‮⁦-⁩]/u;

/** The UTF-8 message of the server proof; the port in decimal. */
export function helloInput(pairingId: string, port: number, nonce: string): string {
  return `fetchly-hello-v1\n${pairingId}\n${port}\n${nonce}`;
}

/** What Settings shows and the popup reads: `<port>-<code>`. */
export function formatPairingString(port: number, code: string): string {
  return `${port}-${code}`;
}

const PAIRING_STRING_RE = /^([1-9][0-9]{3,4})-([0-9A-HJKMNP-TV-Z]{8})$/u;

/** The port and code of a pairing string, or null when it is not exactly `<port>-<code>`. Never throws. */
export function parsePairingString(s: string): { port: number; code: string } | null {
  if (typeof s !== 'string') return null;
  const m = PAIRING_STRING_RE.exec(s);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const port = Number(m[1]);
  if (!isServerPort(port)) return null;
  return { port, code: m[2] };
}

/** Every error token of the wire protocol (architecture section 3). */
export type ErrorToken =
  | 'bad_request'
  | 'bad_host'
  | 'not_found'
  | 'preflight_refused'
  | 'method_not_allowed'
  | 'bad_origin'
  | 'bad_content_type'
  | 'too_large'
  | 'bad_token'
  | 'rate_limited'
  | 'pairing_closed'
  | 'bad_code'
  | 'unknown_pairing'
  | 'busy'
  | 'not_ready'
  | 'unknown_request'
  | 'storage_unavailable'
  | 'bad_site';

export interface ErrorBody {
  error: ErrorToken;
}

/** POST /v1/pair (no token). */
export interface PairRequest {
  code: string;
  label: string;
}
export interface PairResponse {
  pairingId: string;
  token: string;
  protocol: typeof PROTOCOL;
  appVersion: string;
}

/** POST /v1/hello (no token). */
export interface HelloRequest {
  pairingId: string;
  nonce: string;
}
export interface HelloResponse {
  proof: string;
}

/** POST /v1/status. `engine` is EngineStatus['state']. */
export type StatusRequest = Record<string, never>;
export interface StatusResponse {
  app: 'fetchly';
  protocol: typeof PROTOCOL;
  appVersion: string;
  engine: 'notInstalled' | 'starting' | 'ready' | 'error';
}

/** POST /v1/unpair. */
export type UnpairRequest = Record<string, never>;
export type UnpairResponse = Record<string, never>;
