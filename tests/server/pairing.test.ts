// A1 Task 4 (pairing core): src/main/server/pairing.ts with injected now, randomBytes, safeEqual, save, setTimer.
// See the TEST CONTRACT in tests/server/fakes.ts for the store's shape.
//
// Enumeration (the values the plan derives from the token, S1/S2): token (43 chars, never stored), tokenHash
// (SHA-256 of the ASCII token), proofKey (HMAC of the ASCII token). A stored pairing has exactly seven keys:
// id, origin, port, tokenHash, proofKey, label, pairedAt. The listing view has exactly three: id, label, pairedAt.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPairingFile, savePairingFile, type Pairing, type PairingFile } from '../../src/main/server/pairing';
import { CODE_ALPHABET, CODE_RE, NONCE_RE, PAIRING_ID_RE, TOKEN_RE } from '../../src/shared/protocol';
import {
  ORIGIN_A,
  ORIGIN_B,
  ORIGIN_C,
  ORIGIN_D,
  ORIGIN_E,
  b64url,
  expectedProof,
  makeStore,
  nonceOf,
  pairOnce,
  proofKeyOf,
  storedPairing,
  tokenHashOf,
  type StoreRig,
} from './fakes';

const wrongCodeFor = (code: string): string => `${code.slice(0, 7)}${code.endsWith('0') ? '1' : '0'}`;

describe('code lifecycle (Q1)', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  it('open returns 8 alphabet symbols and a 5-minute lifetime', () => {
    const o = r.store.open();
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.value.code).toMatch(CODE_RE);
    expect(o.value.lifetimeMs).toBe(300_000);
    expect(r.store.codeOpen()).toBe(true);
    expect(r.store.view().codeOpen).toBe(true);
  });

  it('takes the code from the random source: eight bytes, each & 31', () => {
    r.random.queueBytes([0, 1, 2, 3, 4, 5, 6, 7]);
    const o = r.store.open();
    expect(o.ok && o.value.code).toBe('01234567');
    expect(r.random.calls.at(-1)?.size).toBe(8);
  });

  it('masks with & 31, not a modulo or a shift: the high bits are ignored', () => {
    r.random.queueBytes([255, 224, 33, 1, 64, 95, 128, 160]); // & 31 = 31 0 1 1 0 31 0 0
    const o = r.store.open();
    expect(o.ok && o.value.code).toBe('Z0110Z00');
  });

  it('every one of the 32 alphabet symbols can come out, in alphabet order', () => {
    for (let chunk = 0; chunk < 4; chunk += 1) {
      r.random.queueBytes(Array.from({ length: 8 }, (_, i) => chunk * 8 + i));
      const o = r.store.open();
      expect(o.ok && o.value.code).toBe(CODE_ALPHABET.slice(chunk * 8, chunk * 8 + 8));
    }
  });

  it('a right code pairs once; the same code again is pairing_closed', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    const first = r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' });
    expect(first.ok).toBe(true);
    expect(r.store.codeOpen()).toBe(false);
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' })).toEqual({ ok: false, error: 'pairing_closed' });
    expect(r.store.list()).toHaveLength(1);
  });

  it('redeem with no code ever opened is pairing_closed and does not throw', () => {
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: '01234567', label: 'Chrome' })).toEqual({ ok: false, error: 'pairing_closed' });
  });

  it('is valid at 310 000 ms (5 minutes plus 10 s grace) and closed at 310 001 ms', () => {
    for (const [at, ok] of [
      [300_000, true],
      [309_999, true],
      [310_000, true],
      [310_001, false],
      [400_000, false],
    ] as const) {
      const rig = makeStore();
      const o = rig.store.open();
      if (!o.ok) throw new Error('open refused');
      rig.clock.t = at;
      expect(rig.store.codeOpen(), `codeOpen at ${at}`).toBe(ok);
      const res = rig.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' });
      expect(res.ok, `redeem at ${at}`).toBe(ok);
      if (!res.ok) expect(res.error).toBe('pairing_closed');
    }
  });

  it('the lifetime runs from open: a later open starts a new 310 000 ms', () => {
    r.clock.t = 1_000_000;
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    r.clock.t = 1_000_000 + 310_000;
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'x' }).ok).toBe(true);
  });

  it('four wrong codes, then the right one, pairs', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    const wrong = wrongCodeFor(o.value.code);
    for (let i = 0; i < 4; i += 1) {
      expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrong, label: 'Chrome' }), `wrong code ${i + 1}`).toEqual({ ok: false, error: 'bad_code' });
      expect(r.store.codeOpen()).toBe(true);
    }
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' }).ok).toBe(true);
  });

  it('the fifth wrong code answers bad_code and closes pairing; a right code after it is pairing_closed', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    const wrong = wrongCodeFor(o.value.code);
    for (let i = 0; i < 5; i += 1) {
      expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrong, label: 'Chrome' }), `wrong code ${i + 1}`).toEqual({ ok: false, error: 'bad_code' });
    }
    expect(r.store.codeOpen()).toBe(false);
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' })).toEqual({ ok: false, error: 'pairing_closed' });
    expect(r.store.list()).toHaveLength(0);
  });

  it('wrong codes from different origins share the five tries', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    const wrong = wrongCodeFor(o.value.code);
    for (const origin of [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D, ORIGIN_E]) r.store.redeem({ origin, port: 38917, code: wrong, label: 'x' });
    expect(r.store.codeOpen()).toBe(false);
  });

  it('open again replaces the code and resets the tries', () => {
    r.random.queueBytes([0, 0, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 2]);
    const first = r.store.open();
    const second = r.store.open();
    if (!first.ok || !second.ok) throw new Error('open refused');
    expect(first.value.code).not.toBe(second.value.code);
    // four tries used on the second code, then a reopen with a fresh third code: tries start again
    const wrong = wrongCodeFor(second.value.code);
    for (let i = 0; i < 4; i += 1) r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrong, label: 'x' });
    const third = r.store.open();
    if (!third.ok) throw new Error('open refused');
    const wrong3 = wrongCodeFor(third.value.code);
    for (let i = 0; i < 4; i += 1) {
      expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrong3, label: 'x' }).ok).toBe(false);
      expect(r.store.codeOpen()).toBe(true);
    }
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: third.value.code, label: 'x' }).ok).toBe(true);
  });

  it('the replaced code no longer works and is only a wrong try on the new one', () => {
    r.random.queueBytes([0, 0, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 2]);
    const first = r.store.open();
    const second = r.store.open();
    if (!first.ok || !second.ok) throw new Error('open refused');
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: first.value.code, label: 'x' })).toEqual({ ok: false, error: 'bad_code' });
    expect(r.store.codeOpen()).toBe(true);
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: second.value.code, label: 'x' }).ok).toBe(true);
  });

  it('open again restarts the lifetime', () => {
    r.store.open();
    r.clock.t = 200_000;
    const again = r.store.open();
    if (!again.ok) throw new Error('open refused');
    r.clock.t = 200_000 + 310_000;
    expect(r.store.codeOpen()).toBe(true);
    r.clock.t = 200_000 + 310_001;
    expect(r.store.codeOpen()).toBe(false);
  });

  it('cancel closes the code', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    r.store.cancel();
    expect(r.store.codeOpen()).toBe(false);
    expect(r.store.view().codeOpen).toBe(false);
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'Chrome' })).toEqual({ ok: false, error: 'pairing_closed' });
  });

  it('cancel with nothing open does nothing', () => {
    expect(() => r.store.cancel()).not.toThrow();
    expect(r.store.codeOpen()).toBe(false);
  });

  it('open is refused with 4 pairings (and allowed with 3)', () => {
    for (const origin of [ORIGIN_A, ORIGIN_B, ORIGIN_C]) pairOnce(r.store, { origin });
    expect(r.store.open().ok).toBe(true);
    r.store.cancel();
    pairOnce(r.store, { origin: ORIGIN_D });
    expect(r.store.list()).toHaveLength(4);
    const refused = r.store.open();
    expect(refused.ok).toBe(false);
    expect(r.store.codeOpen()).toBe(false);
  });

  it('four pairings of one origin also count: the limit is on pairings, not origins', () => {
    for (let i = 0; i < 4; i += 1) pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.store.open().ok).toBe(false);
  });

  it('open is allowed again after an unpair brings the count to 3', () => {
    const ids = [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D].map((origin) => pairOnce(r.store, { origin }).pairingId);
    expect(r.store.open().ok).toBe(false);
    r.store.unpair(ids[0] ?? '');
    expect(r.store.open().ok).toBe(true);
  });

  it.each<[string, Parameters<typeof makeStore>[0]]>([
    ['portBusy', { status: { state: 'portBusy', port: 38917 } }],
    ['error', { status: { state: 'error', message: 'port 80 cannot be used on this PC; choose another in Settings' } }],
  ])('open is refused while the server state is %s', (_name, over) => {
    const rig = makeStore(over);
    expect(rig.store.open().ok).toBe(false);
    expect(rig.store.codeOpen()).toBe(false);
  });

  it('open is allowed when the server is listening, whatever the port', () => {
    const rig = makeStore({ status: { state: 'listening', port: 50123 } });
    expect(rig.store.open().ok).toBe(true);
  });

  it('open follows the injected server state as it changes', () => {
    r.serverStatus.current = { state: 'portBusy', port: 38917 };
    expect(r.store.open().ok).toBe(false);
    r.serverStatus.current = { state: 'listening', port: 38917 };
    expect(r.store.open().ok).toBe(true);
  });

  it('compares go through safeEqual with equal-length buffers: a wrong code', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    r.safeEqual.calls.length = 0;
    r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrongCodeFor(o.value.code), label: 'x' });
    expect(r.safeEqual.calls).toHaveLength(1);
    const c = r.safeEqual.calls[0];
    expect(c?.a.length).toBe(c?.b.length);
    expect(c?.a.length).toBeGreaterThan(0);
  });

  it('compares go through safeEqual with equal-length buffers: the right code', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    r.safeEqual.calls.length = 0;
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: o.value.code, label: 'x' }).ok).toBe(true);
    expect(r.safeEqual.calls).toHaveLength(1);
    const c = r.safeEqual.calls[0];
    expect(c?.a.length).toBe(c?.b.length);
    expect(c?.a.toString('ascii') === o.value.code || c?.b.toString('ascii') === o.value.code).toBe(true);
  });

  it('a wrong code is compared in full, not by a prefix: same first seven symbols is still wrong', () => {
    const o = r.store.open();
    if (!o.ok) throw new Error('open refused');
    expect(r.store.redeem({ origin: ORIGIN_A, port: 38917, code: wrongCodeFor(o.value.code), label: 'x' })).toEqual({ ok: false, error: 'bad_code' });
  });
});

describe('token issue and match (S1, S2, S4, S6b)', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  it('pair returns a 43-character token and a 22-character id, from 32 and 16 random bytes', () => {
    const p = pairOnce(r.store);
    expect(p.token).toHaveLength(43);
    expect(p.token).toMatch(TOKEN_RE);
    expect(p.pairingId).toHaveLength(22);
    expect(p.pairingId).toMatch(PAIRING_ID_RE);
    expect(p.token).toBe(b64url(r.random.lastOfSize(32) ?? Buffer.alloc(0)));
    expect(p.pairingId).toBe(b64url(r.random.lastOfSize(16) ?? Buffer.alloc(0)));
  });

  it('two pairs give different tokens and ids', () => {
    const a = pairOnce(r.store);
    const b = pairOnce(r.store);
    expect(a.token).not.toBe(b.token);
    expect(a.pairingId).not.toBe(b.pairingId);
  });

  it('the record follows S1 and S2 and holds no token', () => {
    const before = Date.now();
    const p = pairOnce(r.store, { origin: ORIGIN_B, label: 'Edge', port: 40000 });
    const after = Date.now();
    const file = r.disk.last;
    expect(file?.version).toBe(1);
    expect(file?.pairings).toHaveLength(1);
    const rec = file?.pairings[0];
    expect(Object.keys(rec ?? {}).sort()).toEqual(['id', 'label', 'origin', 'pairedAt', 'port', 'proofKey', 'tokenHash']);
    expect(rec).toMatchObject({ id: p.pairingId, origin: ORIGIN_B, port: 40000, label: 'Edge', tokenHash: tokenHashOf(p.token), proofKey: proofKeyOf(p.token) });
    expect(rec?.tokenHash).toHaveLength(43);
    expect(rec?.proofKey).toHaveLength(43);
    expect(rec?.pairedAt).toBeGreaterThanOrEqual(before);
    expect(rec?.pairedAt).toBeLessThanOrEqual(after);
    expect(JSON.stringify(file)).not.toContain(p.token);
    expect(JSON.stringify(r.store.list())).not.toContain(p.token);
    expect(JSON.stringify(r.store.view())).not.toContain(p.token);
  });

  it('pairedAt is the wall clock (Date.now), not the monotonic injected one', () => {
    r.clock.t = 5;
    pairOnce(r.store);
    expect(r.disk.last?.pairings[0]?.pairedAt).toBeGreaterThan(1_000_000_000_000);
  });

  it('authenticate returns the matching pairing', () => {
    const p = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    expect(r.store.authenticate(ORIGIN_A, p.token)).toMatchObject({ id: p.pairingId, origin: ORIGIN_A, port: 38917, label: 'Chrome' });
  });

  it('two pairs from one origin give two entries, and both tokens work', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(r.store, { origin: ORIGIN_A, label: 'Edge' });
    expect(r.store.list()).toHaveLength(2);
    expect(r.store.authenticate(ORIGIN_A, a.token)?.id).toBe(a.pairingId);
    expect(r.store.authenticate(ORIGIN_A, b.token)?.id).toBe(b.pairingId);
  });

  it('a new pair never replaces an entry of the same origin (S4)', () => {
    pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    expect(r.store.list()).toHaveLength(3);
    expect(r.disk.last?.pairings).toHaveLength(3);
  });

  it('with 4 pairings safeEqual is called 4 times, whichever entry matches', () => {
    const origins = [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D];
    const pairs = origins.map((origin) => pairOnce(r.store, { origin }));
    pairs.forEach((p, i) => {
      r.safeEqual.calls.length = 0;
      expect(r.store.authenticate(origins[i] ?? '', p.token)?.id, `entry ${i}`).toBe(p.pairingId);
      expect(r.safeEqual.calls, `calls for entry ${i}`).toHaveLength(4);
      for (const c of r.safeEqual.calls) {
        expect(c.a.length).toBe(32);
        expect(c.b.length).toBe(32);
      }
    });
  });

  it('with 4 pairings safeEqual is called 4 times when none matches', () => {
    for (const origin of [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D]) pairOnce(r.store, { origin });
    r.safeEqual.calls.length = 0;
    expect(r.store.authenticate(ORIGIN_A, b64url(Buffer.alloc(32, 99)))).toBeNull();
    expect(r.safeEqual.calls).toHaveLength(4);
  });

  it('with 2 pairings safeEqual is called 2 times (every stored entry, no more)', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    pairOnce(r.store, { origin: ORIGIN_B });
    r.safeEqual.calls.length = 0;
    r.store.authenticate(ORIGIN_A, a.token);
    expect(r.safeEqual.calls).toHaveLength(2);
  });

  it('a token whose pairing has another origin fails (and is still compared against every entry)', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    pairOnce(r.store, { origin: ORIGIN_B });
    r.safeEqual.calls.length = 0;
    expect(r.store.authenticate(ORIGIN_B, a.token)).toBeNull();
    expect(r.safeEqual.calls).toHaveLength(2);
  });

  it('a token of an origin with no pairing at all fails', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.store.authenticate(ORIGIN_C, a.token)).toBeNull();
  });

  it('a wrong token of the right shape fails; so does the right token with one character changed', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.store.authenticate(ORIGIN_A, b64url(Buffer.alloc(32, 1)))).toBeNull();
    const last = a.token.slice(-1);
    const changed = `${a.token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(r.store.authenticate(ORIGIN_A, changed)).toBeNull();
  });

  it.each([
    ['42 characters', (t: string) => t.slice(0, 42)],
    ['44 characters', (t: string) => `${t}A`],
    ['empty', () => ''],
    ['a plus sign inside', (t: string) => `${t.slice(0, 20)}+${t.slice(21)}`],
    ['padding', (t: string) => `${t.slice(0, 42)}=`],
    ['a trailing space', (t: string) => `${t.slice(0, 42)} `],
  ])('a malformed token (%s) fails without a compare', (_name, mutate) => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    r.safeEqual.calls.length = 0;
    expect(r.store.authenticate(ORIGIN_A, mutate(a.token))).toBeNull();
    expect(r.safeEqual.calls).toHaveLength(0);
  });

  it('authenticate with no pairings at all returns null', () => {
    expect(r.store.authenticate(ORIGIN_A, b64url(Buffer.alloc(32, 3)))).toBeNull();
  });

  it('hasOrigin is true exactly for the origins of stored pairings', () => {
    expect(r.store.hasOrigin(ORIGIN_A)).toBe(false);
    pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.store.hasOrigin(ORIGIN_A)).toBe(true);
    expect(r.store.hasOrigin(ORIGIN_B)).toBe(false);
  });

  it('isStored follows the list', () => {
    const a = pairOnce(r.store);
    expect(r.store.isStored(a.pairingId)).toBe(true);
    expect(r.store.isStored('A'.repeat(22))).toBe(false);
    r.store.unpair(a.pairingId);
    expect(r.store.isStored(a.pairingId)).toBe(false);
  });

  it('a store built from a saved file (a restart) still matches the token and proves with the stored proofKey', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const saved = r.disk.last?.pairings ?? [];
    const again = makeStore({ initial: saved });
    expect(again.store.list().map((p) => p.id)).toEqual([a.pairingId]);
    expect(again.store.authenticate(ORIGIN_A, a.token)?.id).toBe(a.pairingId);
    expect(again.store.proof(ORIGIN_A, a.pairingId, 38917, nonceOf(4))).toBe(expectedProof(a.token, a.pairingId, 38917, nonceOf(4)));
    expect(again.store.view().unsaved).toBe(false);
  });

  it('loads stored pairings given at creation, several of one origin', () => {
    const one = storedPairing({}, 1);
    const two = storedPairing({}, 2);
    const rig = makeStore({ initial: [one, two] });
    expect(rig.store.list().map((p) => p.id)).toEqual([one.id, two.id]);
    expect(rig.store.hasOrigin(ORIGIN_A)).toBe(true);
  });
});

describe('server proof (D6, S2)', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  it('equals an independent HMAC over fetchly-hello-v1, id, port and nonce', () => {
    const p = pairOnce(r.store, { origin: ORIGIN_A });
    const nonce = nonceOf(7);
    const proof = r.store.proof(ORIGIN_A, p.pairingId, 38917, nonce);
    expect(proof).toBe(expectedProof(p.token, p.pairingId, 38917, nonce));
    expect(proof).toHaveLength(43);
    expect(nonce).toMatch(NONCE_RE);
  });

  it('a proof for port + 1 differs, and is the proof of that port', () => {
    const p = pairOnce(r.store);
    const nonce = nonceOf(8);
    const a = r.store.proof(ORIGIN_A, p.pairingId, 38917, nonce);
    const b = r.store.proof(ORIGIN_A, p.pairingId, 38918, nonce);
    expect(a).not.toBe(b);
    expect(b).toBe(expectedProof(p.token, p.pairingId, 38918, nonce));
  });

  it('uses the port it is given, not the stored one', () => {
    const p = pairOnce(r.store, { port: 38917 });
    expect(r.store.proof(ORIGIN_A, p.pairingId, 51000, nonceOf())).toBe(expectedProof(p.token, p.pairingId, 51000, nonceOf()));
  });

  it('changes with the nonce and is the same for the same nonce', () => {
    const p = pairOnce(r.store);
    const x = r.store.proof(ORIGIN_A, p.pairingId, 38917, nonceOf(1));
    const y = r.store.proof(ORIGIN_A, p.pairingId, 38917, nonceOf(2));
    expect(x).not.toBe(y);
    expect(r.store.proof(ORIGIN_A, p.pairingId, 38917, nonceOf(1))).toBe(x);
  });

  it('an unknown id is null (unknown_pairing)', () => {
    pairOnce(r.store);
    expect(r.store.proof(ORIGIN_A, 'B'.repeat(22), 38917, nonceOf())).toBeNull();
  });

  it('an id paired to another origin is null (unknown_pairing)', () => {
    const p = pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.store.proof(ORIGIN_B, p.pairingId, 38917, nonceOf())).toBeNull();
  });

  it('the right id works with a shared origin, each with its own proof', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(r.store, { origin: ORIGIN_A, label: 'Edge' });
    const nonce = nonceOf(5);
    expect(r.store.proof(ORIGIN_A, a.pairingId, 38917, nonce)).toBe(expectedProof(a.token, a.pairingId, 38917, nonce));
    expect(r.store.proof(ORIGIN_A, b.pairingId, 38917, nonce)).toBe(expectedProof(b.token, b.pairingId, 38917, nonce));
    expect(r.store.proof(ORIGIN_A, a.pairingId, 38917, nonce)).not.toBe(r.store.proof(ORIGIN_A, b.pairingId, 38917, nonce));
  });

  it('is not rate limited and does not count against the pairing (hello is unlimited)', () => {
    const p = pairOnce(r.store);
    for (let i = 0; i < 1000; i += 1) expect(r.store.proof(ORIGIN_A, p.pairingId, 38917, nonceOf(i % 200))).not.toBeNull();
    const pairing = r.store.authenticate(ORIGIN_A, p.token);
    if (!pairing) throw new Error('lost the pairing');
    expect(r.store.allow(pairing)).toBe(true);
  });
});

describe('unpair and the unsaved flag (S11)', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  it('unpair removes only that entry; its token and hello fail; a same-origin sibling still works', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(r.store, { origin: ORIGIN_A, label: 'Edge' });
    expect(r.store.unpair(a.pairingId)).toBe(true);
    expect(r.store.list().map((p) => p.id)).toEqual([b.pairingId]);
    expect(r.store.authenticate(ORIGIN_A, a.token)).toBeNull();
    expect(r.store.proof(ORIGIN_A, a.pairingId, 38917, nonceOf())).toBeNull();
    expect(r.store.authenticate(ORIGIN_A, b.token)?.id).toBe(b.pairingId);
    expect(r.store.proof(ORIGIN_A, b.pairingId, 38917, nonceOf())).not.toBeNull();
    expect(r.store.hasOrigin(ORIGIN_A)).toBe(true);
    expect(r.disk.last?.pairings.map((p) => p.id)).toEqual([b.pairingId]);
  });

  it('unpair of the origin’s only pairing: the origin is gone too', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    r.store.unpair(a.pairingId);
    expect(r.store.hasOrigin(ORIGIN_A)).toBe(false);
    expect(r.disk.last?.pairings).toEqual([]);
  });

  it('unpair of an unknown id is false and removes nothing', () => {
    const a = pairOnce(r.store);
    expect(r.store.unpair('Z'.repeat(22))).toBe(false);
    expect(r.store.unpair('')).toBe(false);
    expect(r.store.list()).toHaveLength(1);
    expect(r.store.authenticate(ORIGIN_A, a.token)).not.toBeNull();
  });

  it('unpairing twice: the second is false', () => {
    const a = pairOnce(r.store);
    expect(r.store.unpair(a.pairingId)).toBe(true);
    expect(r.store.unpair(a.pairingId)).toBe(false);
  });

  it('a clean store is not unsaved', () => {
    expect(r.store.view().unsaved).toBe(false);
    pairOnce(r.store);
    expect(r.store.view().unsaved).toBe(false);
    expect(r.clock.pending()).toEqual([]);
  });

  it('save throwing on pair: the pairing works, unsaved is true, the retry at 30 000 ms writes it and clears the flag', () => {
    r.disk.failing = true;
    const p = pairOnce(r.store);
    expect(r.store.authenticate(ORIGIN_A, p.token)?.id).toBe(p.pairingId);
    expect(r.store.view().unsaved).toBe(true);
    expect(r.store.list()).toHaveLength(1);
    expect(r.disk.saved).toHaveLength(0);
    expect(r.clock.pending()).toEqual([30_000]);

    r.disk.failing = false;
    const attempts = r.disk.attempts;
    r.clock.advance(29_999);
    expect(r.disk.attempts).toBe(attempts); // not before 30 000 ms
    expect(r.store.view().unsaved).toBe(true);
    r.clock.advance(1);
    expect(r.disk.attempts).toBe(attempts + 1);
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([p.pairingId]);
    expect(r.store.view().unsaved).toBe(false);
    expect(r.clock.pending()).toEqual([]);
  });

  it('a retry that fails again keeps the flag and arms the next 30 s, one timer at a time', () => {
    r.disk.failing = true;
    pairOnce(r.store);
    r.clock.advance(30_000);
    expect(r.store.view().unsaved).toBe(true);
    expect(r.clock.pending()).toEqual([30_000]);
    r.clock.advance(30_000);
    expect(r.store.view().unsaved).toBe(true);
    expect(r.clock.pending()).toEqual([30_000]);
    r.disk.failing = false;
    r.clock.advance(30_000);
    expect(r.store.view().unsaved).toBe(false);
    expect(r.disk.saved).toHaveLength(1);
    expect(r.clock.pending()).toEqual([]);
  });

  it('several failed changes never stack retry timers', () => {
    r.disk.failing = true;
    pairOnce(r.store);
    pairOnce(r.store, { origin: ORIGIN_B });
    pairOnce(r.store, { origin: ORIGIN_C });
    expect(r.clock.pending()).toHaveLength(1);
  });

  it('save throwing on unpair: revoked at once, unsaved is true; a later pair retries the write, which holds the new state', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([a.pairingId]);
    r.disk.failing = true;
    expect(r.store.unpair(a.pairingId)).toBe(true);
    expect(r.store.authenticate(ORIGIN_A, a.token)).toBeNull(); // revoked at once, whatever the disk says
    expect(r.store.view().unsaved).toBe(true);
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([a.pairingId]); // disk still has the old state

    r.disk.failing = false;
    const b = pairOnce(r.store, { origin: ORIGIN_B });
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([b.pairingId]);
    expect(r.store.view().unsaved).toBe(false);
  });

  it('the retry after a failed unpair writes the list without the entry', () => {
    const a = pairOnce(r.store);
    r.disk.failing = true;
    r.store.unpair(a.pairingId);
    r.disk.failing = false;
    r.clock.advance(30_000);
    expect(r.disk.last?.pairings).toEqual([]);
    expect(r.store.view().unsaved).toBe(false);
  });

  it('after stopRetry(), a failing change sets unsaved and arms no timer; flush() writes it', () => {
    r.store.stopRetry(); // the quit order (R2-7): the server's stop() has run
    r.disk.failing = true;
    const p = pairOnce(r.store);
    expect(r.store.authenticate(ORIGIN_A, p.token)?.id).toBe(p.pairingId); // the change itself works
    expect(r.store.view().unsaved).toBe(true);
    expect(r.clock.pending(), 'no retry timer is armed').toEqual([]);
    expect(r.disk.saved).toHaveLength(0);

    // time passing writes nothing, even once the disk would accept it: only flush() does
    r.disk.failing = false;
    const attempts = r.disk.attempts;
    r.clock.advance(120_000);
    expect(r.disk.attempts).toBe(attempts);
    expect(r.store.view().unsaved).toBe(true);

    r.store.flush();
    expect(r.disk.attempts).toBe(attempts + 1);
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([p.pairingId]);
    expect(r.store.view().unsaved).toBe(false);
    expect(r.clock.pending()).toEqual([]);
  });

  it('after stopRetry(), a failing unpair arms no timer either, and a later successful change still writes the whole list', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    const b = pairOnce(r.store, { origin: ORIGIN_B });
    r.store.stopRetry();
    r.disk.failing = true;
    expect(r.store.unpair(a.pairingId)).toBe(true);
    expect(r.store.authenticate(ORIGIN_A, a.token)).toBeNull(); // revoked at once
    expect(r.store.view().unsaved).toBe(true);
    expect(r.clock.pending()).toEqual([]);

    r.disk.failing = false;
    const c = pairOnce(r.store, { origin: ORIGIN_C });
    expect(r.disk.last?.pairings.map((x) => x.id)).toEqual([b.pairingId, c.pairingId]);
    expect(r.store.view().unsaved).toBe(false);
  });

  it('stopRetry() clears a retry that is already armed, and a change that fails afterwards arms none', () => {
    r.disk.failing = true;
    pairOnce(r.store);
    expect(r.clock.pending()).toEqual([30_000]);
    r.store.stopRetry();
    expect(r.clock.pending()).toEqual([]);
    pairOnce(r.store, { origin: ORIGIN_B });
    expect(r.store.view().unsaved).toBe(true);
    expect(r.clock.pending()).toEqual([]);
  });

  it('flush writes when unsaved and clears the flag', () => {
    r.disk.failing = true;
    pairOnce(r.store);
    r.disk.failing = false;
    r.store.flush();
    expect(r.disk.last?.pairings).toHaveLength(1);
    expect(r.store.view().unsaved).toBe(false);
  });

  it('flush does not write when nothing is unsaved', () => {
    pairOnce(r.store);
    const attempts = r.disk.attempts;
    r.store.flush();
    expect(r.disk.attempts).toBe(attempts);
  });

  it('flush never throws, also when the write fails again; the flag stays', () => {
    r.disk.failing = true;
    pairOnce(r.store);
    expect(() => r.store.flush()).not.toThrow();
    expect(r.store.view().unsaved).toBe(true);
  });

  describe('against a real pairing.json (the documented residual)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fetchly-pairing-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('a fresh load before the retry still shows the old state; after the retry it shows the new one', () => {
      let fail = false;
      // a store whose save writes the real pairing.json through the real writer
      const real = makeStore({
        save: (file: PairingFile) => {
          if (fail) throw new Error('disk full');
          savePairingFile(dir, file);
        },
      });
      const a = pairOnce(real.store, { origin: ORIGIN_A });
      expect(loadPairingFile(dir, 38917).pairings.map((p: Pairing) => p.id)).toEqual([a.pairingId]);

      fail = true;
      real.store.unpair(a.pairingId);
      expect(real.store.authenticate(ORIGIN_A, a.token)).toBeNull();
      // the residual: a restart now would still read the revoked pairing
      expect(loadPairingFile(dir, 38917).pairings.map((p: Pairing) => p.id)).toEqual([a.pairingId]);

      fail = false;
      real.clock.advance(30_000);
      expect(loadPairingFile(dir, 38917).pairings).toEqual([]);
    });
  });
});

describe('rate window (300 a minute per pairing, counted after the token check)', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  const pairing = (rig: StoreRig, origin: string, token: string) => {
    const p = rig.store.authenticate(origin, token);
    if (!p) throw new Error('pairing lost');
    return p;
  };

  it('request 300 passes and 301 is refused', () => {
    const a = pairOnce(r.store);
    for (let i = 1; i <= 300; i += 1) expect(r.store.allow(pairing(r, ORIGIN_A, a.token)), `request ${i}`).toBe(true);
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token)), 'request 301').toBe(false);
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token)), 'request 302').toBe(false);
  });

  it('the window resets at 60 000 ms: 59 999 is still refused, 60 000 passes', () => {
    const a = pairOnce(r.store);
    for (let i = 0; i < 300; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    r.clock.t = 59_999;
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(false);
    r.clock.t = 60_000;
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(true);
  });

  it('a new window holds 300 again, no more', () => {
    const a = pairOnce(r.store);
    for (let i = 0; i < 300; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    r.clock.t = 60_000;
    for (let i = 1; i <= 300; i += 1) expect(r.store.allow(pairing(r, ORIGIN_A, a.token)), `request ${i} of the second window`).toBe(true);
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(false);
  });

  it('refused requests do not move the window', () => {
    const a = pairOnce(r.store);
    for (let i = 0; i < 300; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    r.clock.t = 30_000;
    for (let i = 0; i < 50; i += 1) expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(false);
    r.clock.t = 60_000;
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(true);
  });

  it('two pairings of one origin count apart', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(r.store, { origin: ORIGIN_A, label: 'Edge' });
    r.clock.t = 0;
    for (let i = 0; i < 300; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    expect(r.store.allow(pairing(r, ORIGIN_A, a.token))).toBe(false);
    expect(r.store.allow(pairing(r, ORIGIN_A, b.token))).toBe(true);
  });

  it('pairings of different origins count apart', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    const b = pairOnce(r.store, { origin: ORIGIN_B });
    for (let i = 0; i < 300; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    expect(r.store.allow(pairing(r, ORIGIN_B, b.token))).toBe(true);
  });

  it('the count is kept by pairing, not by the object the caller holds', () => {
    const a = pairOnce(r.store);
    const held = pairing(r, ORIGIN_A, a.token);
    for (let i = 0; i < 150; i += 1) r.store.allow(held);
    for (let i = 0; i < 150; i += 1) r.store.allow(pairing(r, ORIGIN_A, a.token));
    expect(r.store.allow(held)).toBe(false);
  });

  it('authenticate itself is not counted: only allow is', () => {
    const a = pairOnce(r.store);
    for (let i = 0; i < 500; i += 1) r.store.authenticate(ORIGIN_A, a.token);
    for (let i = 1; i <= 300; i += 1) expect(r.store.allow(pairing(r, ORIGIN_A, a.token)), `request ${i}`).toBe(true);
  });
});

describe('listing (PairingInfo, PairingsView) and clear', () => {
  let r: StoreRig;
  beforeEach(() => {
    r = makeStore();
  });

  it('list holds id, label and pairedAt only, in pairing order', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(r.store, { origin: ORIGIN_B, label: 'Edge' });
    const list = r.store.list();
    expect(list.map((p) => p.id)).toEqual([a.pairingId, b.pairingId]);
    expect(list.map((p) => p.label)).toEqual(['Chrome', 'Edge']);
    for (const p of list) {
      expect(Object.keys(p).sort()).toEqual(['id', 'label', 'pairedAt']);
      expect(Number.isFinite(p.pairedAt)).toBe(true);
    }
  });

  it('view is exactly pairings, codeOpen and unsaved', () => {
    pairOnce(r.store);
    const v = r.store.view();
    expect(Object.keys(v).sort()).toEqual(['codeOpen', 'pairings', 'unsaved']);
    expect(v.pairings).toHaveLength(1);
    expect(v.codeOpen).toBe(false);
    expect(v.unsaved).toBe(false);
    expect(JSON.stringify(v)).not.toMatch(/origin|tokenHash|proofKey|chrome-extension/u);
  });

  it('clear empties the list, revokes every token and writes the empty list', () => {
    const a = pairOnce(r.store, { origin: ORIGIN_A });
    const b = pairOnce(r.store, { origin: ORIGIN_B });
    r.store.clear();
    expect(r.store.list()).toEqual([]);
    expect(r.store.authenticate(ORIGIN_A, a.token)).toBeNull();
    expect(r.store.authenticate(ORIGIN_B, b.token)).toBeNull();
    expect(r.store.hasOrigin(ORIGIN_A)).toBe(false);
    expect(r.disk.last).toEqual({ version: 1, pairings: [] });
  });

  it('clear writes unconditionally, even when the list is already empty (R2-1)', () => {
    const before = r.disk.attempts;
    r.store.clear();
    expect(r.disk.attempts).toBe(before + 1);
    expect(r.disk.last).toEqual({ version: 1, pairings: [] });
    r.store.clear();
    expect(r.disk.attempts).toBe(before + 2);
  });

  it('clear with a failing write empties memory anyway, sets unsaved and does not throw', () => {
    const a = pairOnce(r.store);
    r.disk.failing = true;
    expect(() => r.store.clear()).not.toThrow();
    expect(r.store.list()).toEqual([]);
    expect(r.store.authenticate(ORIGIN_A, a.token)).toBeNull();
    expect(r.store.view().unsaved).toBe(true);
    r.disk.failing = false;
    r.clock.advance(30_000);
    expect(r.disk.last).toEqual({ version: 1, pairings: [] });
    expect(r.store.view().unsaved).toBe(false);
  });
});
