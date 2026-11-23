/**
 * The route table of the local server, and the four A1 routes. Later components register their own routes
 * here. The server runs every check of the check order before a handler; a handler only checks its body's
 * exact shape (step 7) and does its work.
 */
import { BODY_LIMIT, CODE_RE, NONCE_RE, PAIRING_ID_RE, PROTOCOL, type ErrorToken } from '../../shared/protocol';
import type { EngineStatus } from '../../shared/types';
import { isLabel, type Pairing, type PairingStore } from './pairing';

export interface RouteContext {
  /** The request body: a JSON object (its keys are not checked yet). */
  body: Record<string, unknown>;
  /** The request's Origin, already checked against the route's origin rule. */
  origin: string;
  /** The pairing the token matched (auth 'token'); null on auth 'none' routes. */
  pairing: Pairing | null;
  /** The port the listener really has (address().port). */
  port: number;
}

export type Reply = { status: number; body: object };

export interface Route {
  /** Matched exactly against the request target. */
  path: string;
  auth: 'none' | 'token';
  /** Largest body in bytes. */
  bodyLimit: number;
  handle(ctx: RouteContext): Reply | Promise<Reply>;
}

const table = new Map<string, Route>();

/** Adds a route; throws when the path is taken. */
export function register(route: Route): void {
  if (table.has(route.path)) throw new Error(`A route for ${route.path} is already registered`);
  table.set(route.path, route);
}

/** The route registered for exactly this path, if any. */
export function lookup(path: string): Route | undefined {
  return table.get(path);
}

const error = (status: number, token: ErrorToken): Reply => ({ status, body: { error: token } });
const BAD_REQUEST = error(400, 'bad_request');

/** True when the object has exactly these keys, in any order. */
function hasExactKeys(body: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(body);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** The four A1 routes; the caller registers them. */
export function a1Routes(env: { pairing: PairingStore; appVersion: string; engine(): EngineStatus['state'] }): Route[] {
  const { pairing } = env;
  return [
    {
      path: '/v1/pair',
      auth: 'none',
      bodyLimit: BODY_LIMIT,
      handle({ body, origin, port }) {
        // S21: the shape first, so a malformed body uses no try whether or not a code is open.
        if (!hasExactKeys(body, ['code', 'label'])) return BAD_REQUEST;
        const { code, label } = body;
        if (typeof code !== 'string' || !CODE_RE.test(code) || !isLabel(label)) return BAD_REQUEST;
        const res = pairing.redeem({ origin, port, code, label });
        if (!res.ok) return res.error === 'bad_code' ? error(401, 'bad_code') : error(403, 'pairing_closed');
        return { status: 200, body: { pairingId: res.pairingId, token: res.token, protocol: PROTOCOL, appVersion: env.appVersion } };
      },
    },
    {
      path: '/v1/hello',
      auth: 'none',
      bodyLimit: BODY_LIMIT,
      handle({ body, origin, port }) {
        if (!hasExactKeys(body, ['pairingId', 'nonce'])) return BAD_REQUEST;
        const { pairingId, nonce } = body;
        if (typeof pairingId !== 'string' || !PAIRING_ID_RE.test(pairingId) || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return BAD_REQUEST;
        const proof = pairing.proof(origin, pairingId, port, nonce);
        return proof === null ? error(404, 'unknown_pairing') : { status: 200, body: { proof } };
      },
    },
    {
      path: '/v1/status',
      auth: 'token',
      bodyLimit: BODY_LIMIT,
      handle({ body }) {
        if (!hasExactKeys(body, [])) return BAD_REQUEST;
        return { status: 200, body: { app: 'fetchly', protocol: PROTOCOL, appVersion: env.appVersion, engine: env.engine() } };
      },
    },
    {
      path: '/v1/unpair',
      auth: 'token',
      bodyLimit: BODY_LIMIT,
      handle({ body, pairing: matched }) {
        if (!hasExactKeys(body, [])) return BAD_REQUEST;
        // Revoked in memory at once; a failed write is retried (S11) and is not a wire error.
        if (matched) pairing.unpair(matched.id);
        return { status: 200, body: {} };
      },
    },
  ];
}
