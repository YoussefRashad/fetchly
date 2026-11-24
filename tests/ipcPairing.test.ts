// A1 Task 9 (IPC part): the port flow of setSettings (S14, S15, R2-1) and the four pairing handlers
// pairingStart, pairingCancel, pairings, unpair. The pairing store is the real one (injected clock, random
// source, compare and disk); the server and the port-change dialog are the small fakes of tests/server/fakes.ts.
// The Settings panel has no automated test (plan, Task 9): it is covered by docs/manual-checklist-phase2.md.
//
// Enumeration (the setSettings fields, section 9): the rebuild in setSettings carries downloadDir, askEveryTime,
// maxConcurrent, speedLimitKbps, autoResumeOnStart, preferMp4Max1080, defaultQuality, subtitleLangs and now
// serverPort, which is tested raw by isServerPort (no Number(...) coercion, unlike maxConcurrent). The IPC
// surface of A1 is pairingStart, pairingCancel, pairings, unpair (preload: one call(...) entry each).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandlers, type HandlerDeps } from '../src/main/ipc';
import { loadPairingFile, savePairingFile, type PairingFile, type PairingStore } from '../src/main/server/pairing';
import { CODE_RE, parsePairingString } from '../src/shared/protocol';
import type { ServerStatus, Settings } from '../src/shared/types';
import { sleep } from './wait';
import { ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D, makeIpcServerFixture, nonceOf, pairOnce, type IpcFixture } from './server/fakes';
import { makeSettings } from './helpers';

const PORT_TEXT = 'Port must be a whole number from 1024 to 65535';
const DECLINED_TEXT = 'Settings were not saved: the port was not changed';
const BUSY_TEXT = 'Settings are being saved';
const FOUR_TEXT = 'Four browsers are already paired. Unpair one first.';
const UNSAVED_TEXT = 'Unpaired, but the change is not saved yet; Fetchly keeps trying';
const NOT_LISTENING_TEXT = 'Pairing is possible only while Fetchly is listening for the browser';
const NOT_PAIRED_TEXT = 'This browser is not paired';
const BAD_REQUEST_TEXT = 'That request is not valid';

/** What a coded failure answers (Task D, item 2): the English text of today, its code and, for a detail code, its detail. */
const failure = (error: string, code: string, detail?: string): Record<string, unknown> =>
  detail === undefined ? { ok: false, error, code } : { ok: false, error, code, detail };
const PORT_INVALID = failure(PORT_TEXT, 'portInvalid');
const DECLINED = failure(DECLINED_TEXT, 'portChangeDeclined');
const BUSY = failure(BUSY_TEXT, 'settingsBusy');
const FOUR_PAIRED = failure(FOUR_TEXT, 'fourPaired');
const UNPAIR_UNSAVED = failure(UNSAVED_TEXT, 'unpairUnsaved');
const NOT_LISTENING_FAILURE = failure(NOT_LISTENING_TEXT, 'notListening');
const NOT_PAIRED = failure(NOT_PAIRED_TEXT, 'notPaired');
const BAD_REQUEST = failure(BAD_REQUEST_TEXT, 'badRequest');

interface World {
  fx: IpcFixture;
  h: ReturnType<typeof createHandlers>;
  /** What settings.json holds (what getSettings returns); saveSettings changes it. */
  settings: { current: Settings };
  saved: Settings[];
  queueSettings: Settings[];
  /** What the store looked like at the moment saveSettings ran. */
  atSave: { codeOpen: boolean; count: number }[];
  /** When on, saveSettings makes failSave throw. */
  failSave: { on: boolean };
  /**
   * When on, saveSettings sets `settings.current` BEFORE the failSave throw, as src/main/index.ts does in production
   * (`settings = s` first, then the write that can throw). Off (default): a throwing save leaves the settings alone.
   */
  assignFirst: { on: boolean };
}

function world(over: { settings?: Partial<Settings>; fx?: IpcFixture; deps?: Partial<HandlerDeps> } = {}): World {
  const fx = over.fx ?? makeIpcServerFixture();
  const settings = { current: makeSettings(over.settings) };
  const saved: Settings[] = [];
  const queueSettings: Settings[] = [];
  const atSave: World['atSave'] = [];
  const failSave = { on: false };
  const assignFirst = { on: false };
  // The handler's own calls are logged: the plan fixes the order "cancel the code, empty the pairings, save, move".
  const real = fx.rig.store;
  const pairing: PairingStore = {
    ...real,
    cancel: () => {
      fx.log.push('cancel');
      real.cancel();
    },
    clear: () => {
      fx.log.push('clear');
      real.clear();
    },
  };
  const deps: HandlerDeps = {
    queue: () => ({
      add: () => undefined,
      job: async () => ({ ok: true, value: null }),
      group: async () => ({ ok: true, value: null }),
      confirmStraysGone: () => undefined,
      snapshot: () => ({ jobs: [], groups: [] }),
      setSettings: (s) => void queueSettings.push(s),
    }),
    status: () => ({ engine: { state: 'ready' }, saveError: null, server: fx.state.current }),
    retryEngines: async () => undefined,
    getSettings: () => settings.current,
    saveSettings: (s) => {
      fx.log.push('saveSettings');
      atSave.push({ codeOpen: fx.rig.store.codeOpen(), count: fx.rig.store.list().length });
      if (assignFirst.on) settings.current = s;
      if (failSave.on) throw new Error('disk full');
      settings.current = s;
      saved.push(s);
    },
    validateUrl: (raw) => raw,
    probe: async () => ({ kind: 'media', title: 'x', thumbnail: null, heights: [] }),
    binaries: { status: async () => [], ensureAll: async () => undefined, updateYtDlp: async () => '1' },
    onInstallProgress: () => undefined,
    afterInstall: async () => undefined,
    pickFolder: async () => null,
    openPath: async () => undefined,
    confirmOpenRunnable: async () => false,
    showItem: () => undefined,
    startupNotice: () => null,
    ...fx.deps,
    pairing,
    ...over.deps,
  };
  return { fx, h: createHandlers(deps), settings, saved, queueSettings, atSave, failSave, assignFirst };
}

const withPort = (serverPort: unknown): Settings => makeSettings({ serverPort: serverPort as number });

/** Pairs n browsers (different origins) in the world's store. */
function pairMany(w: World, n: number): { pairingId: string; token: string }[] {
  const origins = [ORIGIN_A, ORIGIN_B, ORIGIN_C, ORIGIN_D];
  return origins.slice(0, n).map((origin) => pairOnce(w.fx.rig.store, { origin }));
}

// ---------------------------------------------------------------------------------------------------------

describe('setSettings: serverPort (S14)', () => {
  it('a valid serverPort stays in the save, the queue and the answer', async () => {
    const w = world();
    const res = await w.h.setSettings(withPort(40000));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }) });
    expect(w.saved).toHaveLength(1);
    expect(w.saved[0]?.serverPort).toBe(40000);
    expect(w.queueSettings[0]?.serverPort).toBe(40000);
    expect(res.ok && typeof res.value.serverPort).toBe('number');
  });

  it.each([1024, 1025, 38917, 65534, 65535])('accepts the port %i', async (port) => {
    const w = world();
    const res = await w.h.setSettings(withPort(port));
    expect(res.ok).toBe(true);
    expect(w.saved[0]?.serverPort).toBe(port);
  });

  const BAD: [string, unknown][] = [
    ['1023', 1023],
    ['65536', 65536],
    ['0', 0],
    ['-1', -1],
    ['80', 80],
    ['38917.5', 38917.5],
    ['"38917" (a numeric string, no coercion)', '38917'],
    ['"40000"', '40000'],
    ['" 40000 "', ' 40000 '],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['[] (an array)', []],
    ['[40000]', [40000]],
    ['{} (an object)', {}],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['Number.MAX_VALUE', Number.MAX_VALUE],
    ['-Infinity', -Infinity],
    ['the empty string', ''],
  ];

  it.each(BAD)('refuses %s with the S14 text and saves nothing', async (_name, port) => {
    const w = world();
    const [existing] = pairMany(w, 1);
    const res = await w.h.setSettings(withPort(port));
    expect(res).toEqual(PORT_INVALID);
    expect(w.saved).toEqual([]);
    expect(w.queueSettings).toEqual([]);
    expect(w.fx.ensureCalls).toEqual([]);
    expect(w.fx.confirm.asked).toEqual([]); // no dialog for a refused value
    expect(w.fx.rig.store.list()).toHaveLength(1); // pairings untouched
    expect(w.fx.rig.store.authenticate(ORIGIN_A, existing?.token ?? '')).not.toBeNull();
  });

  it('refuses a settings object without serverPort (an old window), also with the S14 text', async () => {
    const w = world();
    const { serverPort: _omit, ...rest } = makeSettings();
    void _omit;
    const res = await w.h.setSettings(rest as Settings);
    expect(res).toEqual(PORT_INVALID);
    expect(w.saved).toEqual([]);
  });

  it('a bad port is refused even when every other field is fine and the port equals the saved one by value only as a string', async () => {
    const w = world();
    expect(await w.h.setSettings(withPort('38917'))).toEqual(PORT_INVALID);
  });

  it('the other fields are still rebuilt and clamped next to a valid port', async () => {
    const w = world();
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 99, speedLimitKbps: -5 }));
    expect(res.ok && res.value).toMatchObject({ serverPort: 40000, maxConcurrent: 8, speedLimitKbps: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('setSettings: the port-change flow (S15, R2-1)', () => {
  it('the same port: no confirmation, ensure is still called (a retry), and the settings are saved', async () => {
    const w = world();
    pairMany(w, 2);
    const res = await w.h.setSettings(makeSettings({ serverPort: 38917, maxConcurrent: 5 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.ensureCalls).toEqual([38917]);
    expect(w.fx.rig.store.list()).toHaveLength(2); // pairings kept
    expect(w.saved).toHaveLength(1);
    expect(w.fx.log).toEqual(['saveSettings', 'ensure:38917']); // no cancel, no clear: nothing is removed
  });

  it('the same port with an open code: the code stays open', async () => {
    const w = world();
    expect(w.fx.rig.store.open().ok).toBe(true);
    await w.h.setSettings(makeSettings({ serverPort: 38917 }));
    expect(w.fx.rig.store.codeOpen()).toBe(true);
  });

  it('the same port against a settings value that is not the default: compared with what is saved', async () => {
    const w = world({ settings: { serverPort: 40000 } });
    pairMany(w, 1);
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.ensureCalls).toEqual([40000]);
    expect(w.fx.rig.store.list()).toHaveLength(1);
  });

  it('a new port with no pairings: no confirmation; the code is cancelled, the settings are saved, the server moves', async () => {
    const w = world();
    expect(w.fx.rig.store.open().ok).toBe(true);
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.atSave).toEqual([{ codeOpen: false, count: 0 }]);
    expect(w.saved[0]?.serverPort).toBe(40000);
    expect(w.fx.ensureCalls).toEqual([40000]);
    expect(w.fx.rig.store.codeOpen()).toBe(false);
    expect(w.fx.log).toEqual(['cancel', 'clear', 'saveSettings', 'ensure:40000']); // R2-1: clear even with nothing to remove
  });

  it('a new port with no pairings still writes pairing.json, empty (R2-1: unconditionally)', async () => {
    const w = world();
    const before = w.fx.rig.disk.attempts;
    await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(w.fx.rig.disk.attempts).toBeGreaterThan(before);
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
  });

  it('a new port with pairings asks once, with the number of pairings', async () => {
    const w = world();
    pairMany(w, 3);
    await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(w.fx.confirm.asked).toEqual([3]);
  });

  it('confirmed: the order is cancel code, empty pairings, saveSettings, ensure', async () => {
    const w = world();
    const [first] = pairMany(w, 2);
    expect(w.fx.rig.store.open().ok).toBe(true);
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res.ok).toBe(true);
    // when saveSettings ran the code was already closed and the pairings already emptied
    expect(w.atSave).toEqual([{ codeOpen: false, count: 0 }]);
    // ensure ran after saveSettings, with the new port
    expect(w.fx.log).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_A, first?.token ?? '')).toBeNull();
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
    expect(w.saved[0]?.serverPort).toBe(40000);
    expect(w.queueSettings[0]?.serverPort).toBe(40000);
  });

  it('declined: nothing is saved, the pairings and the open code are kept, ensure is not called', async () => {
    const w = world();
    pairMany(w, 2);
    expect(w.fx.rig.store.open().ok).toBe(true);
    w.fx.confirm.answer = false;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual(DECLINED);
    expect(w.saved).toEqual([]);
    expect(w.queueSettings).toEqual([]);
    expect(w.fx.ensureCalls).toEqual([]);
    expect(w.fx.rig.store.list()).toHaveLength(2);
    expect(w.fx.rig.store.codeOpen()).toBe(true);
    expect(w.settings.current.serverPort).toBe(38917);
    expect(w.fx.log).toEqual(['confirm']);
  });

  it('saveSettings throwing: the call fails, the pairings stay emptied, the code is cancelled, the listener is not moved', async () => {
    const w = world();
    pairMany(w, 2);
    expect(w.fx.rig.store.open().ok).toBe(true);
    w.failSave.on = true;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual(failure('Something went wrong: disk full', 'unexpected', 'disk full'));
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.codeOpen()).toBe(false);
    expect(w.fx.ensureCalls).toEqual([]);
    expect(w.queueSettings).toEqual([]);
    expect(w.fx.log).toEqual(['confirm', 'cancel', 'clear', 'saveSettings']);
  });

  it('saveSettings throwing with no pairings: the call fails and the listener is not moved', async () => {
    const w = world();
    w.failSave.on = true;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res.ok).toBe(false);
    expect(w.fx.ensureCalls).toEqual([]);
  });

  describe('a second setSettings while the dialog is open', () => {
    const openDialog = async (w: World): Promise<{ first: Promise<unknown>; release(): void }> => {
      let release: () => void = () => undefined;
      w.fx.confirm.gate = new Promise<void>((r) => {
        release = r;
      });
      const first = w.h.setSettings(makeSettings({ serverPort: 40000 }));
      await vi.waitFor(() => expect(w.fx.confirm.asked).toEqual([1]));
      return { first, release };
    };

    it('fails with "Settings are being saved" and changes nothing', async () => {
      const w = world();
      pairMany(w, 1);
      const { first, release } = await openDialog(w);
      expect(await w.h.setSettings(makeSettings({ serverPort: 38917, maxConcurrent: 6 }))).toEqual(BUSY);
      expect(await w.h.setSettings(makeSettings({ serverPort: 41000 }))).toEqual(BUSY);
      expect(w.saved).toEqual([]);
      expect(w.fx.confirm.asked).toEqual([1]); // no second dialog
      release();
      expect(await first).toMatchObject({ ok: true });
      expect(w.saved).toHaveLength(1);
      expect(w.saved[0]?.serverPort).toBe(40000);
    });

    it('works again once the dialog is answered (confirmed)', async () => {
      const w = world();
      pairMany(w, 1);
      const { first, release } = await openDialog(w);
      release();
      await first;
      expect((await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 2 }))).ok).toBe(true);
    });

    it('works again once the dialog is answered (declined)', async () => {
      const w = world();
      pairMany(w, 1);
      w.fx.confirm.answer = false;
      const { first, release } = await openDialog(w);
      release();
      expect(await first).toEqual(DECLINED);
      w.fx.confirm.gate = null;
      expect((await w.h.setSettings(makeSettings({ serverPort: 38917, maxConcurrent: 2 }))).ok).toBe(true);
    });

    it('works again after saveSettings threw', async () => {
      const w = world();
      pairMany(w, 1);
      w.failSave.on = true;
      const { first, release } = await openDialog(w);
      release();
      expect((await first) as { ok: boolean }).toMatchObject({ ok: false });
      w.failSave.on = false;
      w.fx.confirm.gate = null;
      expect((await w.h.setSettings(makeSettings({ serverPort: 38917 }))).ok).toBe(true);
    });

    it('works again after the dialog itself rejected', async () => {
      const w = world();
      pairMany(w, 1);
      const bad = world({
        fx: w.fx,
        deps: {
          confirmPortChange: async () => {
            throw new Error('dialog failed');
          },
        },
      });
      const res = await bad.h.setSettings(makeSettings({ serverPort: 40000 }));
      expect(res).toEqual(failure('Something went wrong: dialog failed', 'unexpected', 'dialog failed'));
      expect(bad.saved).toEqual([]);
      expect(w.fx.rig.store.list()).toHaveLength(1); // nothing was changed by a dialog that failed
      expect((await bad.h.setSettings(makeSettings({ serverPort: 38917 }))).ok).toBe(true);
    });
  });

  describe('R2-1 against real files: a failed pairing.json write during a port change never revives the removed pairings', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fetchly-r21-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** A "process": a store loaded from the real file for the effective port, writing through the real writer. */
    function boot(effectivePort: number, failWrites: { on: boolean }, settingsPort: number): World {
      const loaded = loadPairingFile(dir, effectivePort);
      const fx = makeIpcServerFixture({
        initial: loaded.pairings,
        save: (file: PairingFile) => {
          if (failWrites.on) throw new Error('disk full');
          savePairingFile(dir, file);
        },
      });
      fx.state.current = { state: 'listening', port: effectivePort };
      return world({ fx, settings: { serverPort: settingsPort } });
    }

    it('port change with a failing write, a restart, and a change back to the first port', async () => {
      const fail = { on: false };
      // 1. a pairing on 38917, saved to the real file
      const first = boot(38917, fail, 38917);
      const a = pairOnce(first.fx.rig.store, { origin: ORIGIN_A, port: 38917 });
      expect(loadPairingFile(dir, 38917).pairings.map((p) => p.id)).toEqual([a.pairingId]);

      // 2. the port is changed to 40000, confirmed; the pairing.json write fails
      fail.on = true;
      const res = await first.h.setSettings(makeSettings({ serverPort: 40000 }));
      expect(res.ok).toBe(true);
      expect(first.fx.rig.store.list()).toEqual([]); // memory emptied
      expect(first.fx.rig.store.view().unsaved).toBe(true);
      // the file still holds the stale pairing (port 38917)
      const stale = JSON.parse(readFileSync(join(dir, 'pairing.json'), 'utf8')) as PairingFile;
      expect(stale.pairings.map((p) => p.id)).toEqual([a.pairingId]);

      // 3. restart on 40000: the stale entry is on another port, so it is ignored (S12) and the file is untouched
      fail.on = false;
      const second = boot(40000, fail, 40000);
      expect(second.fx.rig.store.list()).toEqual([]);
      expect(JSON.parse(readFileSync(join(dir, 'pairing.json'), 'utf8')) as PairingFile).toEqual(stale);

      // 4. the port is changed back to 38917: no pairings in memory, so no dialog, but the file is rewritten
      const back = await second.h.setSettings(makeSettings({ serverPort: 38917 }));
      expect(back.ok).toBe(true);
      expect(second.fx.confirm.asked).toEqual([]);
      expect(JSON.parse(readFileSync(join(dir, 'pairing.json'), 'utf8')) as PairingFile).toEqual({ version: 1, pairings: [] });

      // 5. restart on 38917: the removed pairing is not revived
      const third = boot(38917, fail, 38917);
      expect(third.fx.rig.store.list()).toEqual([]);
      expect(third.fx.rig.store.authenticate(ORIGIN_A, a.token)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

// Review 1, finding 1 (F1). src/main/index.ts assigns `settings = s` BEFORE the write that can throw, so after a
// failed save the settings already say the new port while the listener still has the old one. The fixture of the
// cases above throws before assigning, which hides this; `assignFirst.on` reproduces the production order.
// The handler must decide "is this a new port" against the port of the last `ensure` that resolved (listenerPort),
// not against what getSettings() says (nor against the last completed save, review 2), so a retry of the same port
// still removes the pairings made in between.
describe('setSettings: a failed save, then a retry (production save order)', () => {
  /** Listening on 38917, saving in the production order. */
  function productionWorld(): World {
    const w = world();
    w.assignFirst.on = true;
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
    return w;
  }

  /** A pairing made the way the Settings panel does it: pairingStart, then the extension redeems the string. */
  async function pairViaStart(w: World, origin: string, port = 38917): Promise<{ pairingId: string; token: string }> {
    const started = await w.h.pairingStart();
    if (!started.ok) throw new Error(`pairingStart failed: ${started.error}`);
    expect(started.value.pairingString.startsWith(`${port}-`)).toBe(true);
    const parsed = parsePairingString(started.value.pairingString);
    if (!parsed) throw new Error('the pairing string did not parse');
    const res = w.fx.rig.store.redeem({ origin, port: parsed.port, code: parsed.code, label: 'Edge' });
    if (!res.ok) throw new Error(`redeem was refused: ${res.error}`);
    return { pairingId: res.pairingId, token: res.token };
  }

  it('failure, then a new pairing, then the retry: the retry asks again and removes the new pairing', async () => {
    const w = productionWorld();
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });
    w.failSave.on = true;
    const failed = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(failed.ok).toBe(false);
    expect(w.fx.ensureCalls).toEqual([]);
    expect(w.settings.current.serverPort).toBe(40000); // the production order: the settings already say 40000 ...
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 }); // ... while the listener stays on 38917
    expect(w.fx.confirm.asked).toEqual([1]);

    const b = await pairViaStart(w, ORIGIN_B);
    expect(w.fx.rig.store.list().map((p) => p.id)).toEqual([b.pairingId]);

    w.failSave.on = false;
    const mark = w.fx.log.length;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([1, 1]);
    expect(w.fx.log.slice(mark)).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).toBeNull();
    expect(w.fx.rig.store.proof(ORIGIN_B, b.pairingId, 40000, nonceOf())).toBeNull();
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
    expect(w.fx.ensureCalls).toEqual([40000]);
  });

  it('failure with nothing paired, then a new pairing, then the retry: the retry asks and removes it', async () => {
    const w = productionWorld();
    w.failSave.on = true;
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(false);
    expect(w.fx.confirm.asked).toEqual([]); // nothing was paired: no dialog
    expect(w.settings.current.serverPort).toBe(40000);

    const b = await pairViaStart(w, ORIGIN_B);
    w.failSave.on = false;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([1]);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).toBeNull();
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
    expect(w.fx.ensureCalls).toEqual([40000]);
  });

  it('failure, then the retry with nothing paired: no dialog, but the code is still cancelled and the pairings still cleared (R2-1)', async () => {
    const w = productionWorld();
    w.failSave.on = true;
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(false);
    expect(w.fx.log).toEqual(['cancel', 'clear', 'saveSettings']);

    w.failSave.on = false;
    expect(w.fx.rig.store.open().ok).toBe(true); // a code opened between the two attempts
    const mark = w.fx.log.length;
    const writes = w.fx.rig.disk.attempts;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.log.slice(mark)).toEqual(['cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.codeOpen()).toBe(false);
    expect(w.fx.rig.disk.attempts).toBeGreaterThan(writes); // the empty list is written again, unconditionally
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
  });

  it('failure, then a new pairing, then a save of the old port again: no dialog, the pairing is kept', async () => {
    const w = productionWorld();
    w.failSave.on = true;
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(false);
    const b = await pairViaStart(w, ORIGIN_B);

    w.failSave.on = false;
    const mark = w.fx.log.length;
    const res = await w.h.setSettings(makeSettings({ serverPort: 38917 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.log.slice(mark)).toEqual(['saveSettings', 'ensure:38917']);
    expect(w.fx.rig.store.list().map((p) => p.id)).toEqual([b.pairingId]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).not.toBeNull();
    expect(w.fx.ensureCalls).toEqual([38917]);
    expect(w.settings.current.serverPort).toBe(38917);
  });

  it('two failures, then a success, with a pairing before each attempt: every attempt asks and clears, none survives', async () => {
    const w = productionWorld();
    w.failSave.on = true;
    for (const origin of [ORIGIN_A, ORIGIN_B]) {
      const p = pairOnce(w.fx.rig.store, { origin });
      expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(false);
      expect(w.fx.rig.store.list(), `after the failed attempt for ${origin}`).toEqual([]);
      expect(w.fx.rig.store.authenticate(origin, p.token)).toBeNull();
    }
    w.failSave.on = false;
    const c = pairOnce(w.fx.rig.store, { origin: ORIGIN_C });
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([1, 1, 1]);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_C, c.token)).toBeNull();
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
    expect(w.fx.ensureCalls).toEqual([40000]);
    const attempt = ['confirm', 'cancel', 'clear', 'saveSettings'];
    expect(w.fx.log).toEqual([...attempt, ...attempt, ...attempt, 'ensure:40000']);
  });

  // Task D, item 3 (frozen plan docs/plans/2026-11-23-d-housekeeping.md, "Item 3"). A port counts as moved only once
  // `ensure` resolved for it (review 2, finding 1). The save completes (the settings already say the new port) and then
  // queue.setSettings throws. That no longer stops the move: the listener still moves, listenerPort follows, and the
  // answer is a success with the warning `savedNotApplied` (D3.1 to D3.3). A save that throws, and an `ensure` that
  // rejects (a contract breach, D3.6), still fail the call and leave the listener where it was.

  const QUEUE_REFUSED = 'the queue refused the settings';

  /** The warning of the plan's table (savedNotApplied) for a queue that threw `detail`: the English text, the code, the detail. */
  const savedNotApplied = (detail: string): { error: string; code: string; detail: string } => ({
    error: `Settings were saved, but the running downloads did not take them: ${detail}. Save again, or restart Fetchly.`,
    code: 'savedNotApplied',
    detail,
  });

  /**
   * A world whose queue throws `thrown()` from setSettings while `queueFails.on` (the save completes first), in the
   * production save order. `thrown` is a function, so each call can throw something else. `deps` and `fx` override more.
   */
  function queueRefusingWorld(over: { thrown?: () => unknown; deps?: Partial<HandlerDeps>; fx?: IpcFixture } = {}): { w: World; queueFails: { on: boolean } } {
    const queueFails = { on: true };
    const thrown = over.thrown ?? (() => new Error(QUEUE_REFUSED));
    const w = world({
      ...(over.fx ? { fx: over.fx } : {}),
      deps: {
        queue: () => ({
          add: () => undefined,
          job: async () => ({ ok: true, value: null }),
          group: async () => ({ ok: true, value: null }),
          confirmStraysGone: () => undefined,
          snapshot: () => ({ jobs: [], groups: [] }),
          setSettings: () => {
            if (queueFails.on) throw thrown();
          },
        }),
        ...over.deps,
      },
    });
    w.assignFirst.on = true;
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
    return { w, queueFails };
  }

  it('3.1 the queue refuses on a move to 40000 with one pairing: ok with the savedNotApplied warning, the listener moved', async () => {
    const { w } = queueRefusingWorld();
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });

    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }), warning: savedNotApplied(QUEUE_REFUSED) });
    expect(w.saved.map((s) => s.serverPort)).toEqual([40000]); // the save completed
    expect(w.fx.log).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.ensureCalls).toEqual([40000]);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 40000 }); // the listener is on 40000
    expect(w.fx.rig.store.list()).toEqual([]); // the pairings were emptied before the save
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
  });

  it('3.2 then 40000 is saved again with the queue working: the same port, no dialog, no clear, no warning; a pairing made in between survives', async () => {
    const { w, queueFails } = queueRefusingWorld();
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(true);
    const b = await pairViaStart(w, ORIGIN_B, 40000); // the string starts 40000-: the listener moved there

    queueFails.on = false;
    const mark = w.fx.log.length;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 5 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 40000, maxConcurrent: 5 }) });
    expect(res).not.toHaveProperty('warning');
    expect(w.fx.confirm.asked).toEqual([1]); // only the first move asked
    expect(w.fx.log.slice(mark)).toEqual(['saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.list().map((p) => p.id)).toEqual([b.pairingId]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).not.toBeNull();
    expect(w.fx.ensureCalls).toEqual([40000, 40000]);
  });

  it('3.3 then 38917 is saved: a new port again (confirm when paired, cancel, clear)', async () => {
    const { w, queueFails } = queueRefusingWorld();
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(true);
    const b = await pairViaStart(w, ORIGIN_B, 40000);

    queueFails.on = false;
    const mark = w.fx.log.length;
    const res = await w.h.setSettings(makeSettings({ serverPort: 38917 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 38917 }) });
    expect(w.fx.confirm.asked).toEqual([1, 1]);
    expect(w.fx.log.slice(mark)).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:38917']);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).toBeNull();
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
  });

  it('3.4 the queue refuses on the same port: no dialog, no cancel, no clear, ensure is called, ok with the warning', async () => {
    const { w } = queueRefusingWorld();
    const [a] = pairMany(w, 1);
    expect(w.fx.rig.store.open().ok).toBe(true);

    const res = await w.h.setSettings(makeSettings({ serverPort: 38917, maxConcurrent: 5 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 38917, maxConcurrent: 5 }), warning: savedNotApplied(QUEUE_REFUSED) });
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.log).toEqual(['saveSettings', 'ensure:38917']);
    expect(w.fx.ensureCalls).toEqual([38917]);
    expect(w.fx.rig.store.list()).toHaveLength(1); // the pairing stays
    expect(w.fx.rig.store.authenticate(ORIGIN_A, a?.token ?? '')).not.toBeNull();
    expect(w.fx.rig.store.codeOpen()).toBe(true); // and so does the open code
  });

  it('3.5 the queue refuses twice in a row: each answer carries its own warning, and ensure is called each time', async () => {
    let n = 0;
    const { w } = queueRefusingWorld({
      thrown: () => {
        n += 1;
        return new Error(`refusal ${n}`);
      },
    });
    const first = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    const second = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(first).toMatchObject({ ok: true, warning: savedNotApplied('refusal 1') });
    expect(second).toMatchObject({ ok: true, warning: savedNotApplied('refusal 2') });
    expect(w.fx.ensureCalls).toEqual([40000, 40000]);
    expect(w.saved.map((s) => s.serverPort)).toEqual([40000, 40000]);
  });

  it('3.6 the queue refuses and ensure rejects: unexpected with ensure’s message as detail, no warning, and that port is still a new port', async () => {
    const fx = makeIpcServerFixture();
    const rejectNext = { on: true };
    const { w, queueFails } = queueRefusingWorld({
      fx,
      deps: {
        server: {
          status: fx.deps.server.status,
          ensure: async (port: number): Promise<ServerStatus> => {
            if (rejectNext.on) {
              rejectNext.on = false;
              fx.log.push(`ensure:${port}`);
              fx.ensureCalls.push(port);
              throw new Error('ensure broke its contract'); // before the fake moves its state: the listener stays on 38917
            }
            return fx.deps.server.ensure(port);
          },
        },
      },
    });
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });

    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual({ ok: false, error: 'Something went wrong: ensure broke its contract', code: 'unexpected', detail: 'ensure broke its contract' });
    expect(res).not.toHaveProperty('warning');
    expect(JSON.stringify(res)).not.toContain(QUEUE_REFUSED); // ensure's message, not the queue's
    expect(w.fx.log).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });

    // listenerPort was left alone: the listener is on 38917, a pairing can be made there, and the retry is a new port
    const b = await pairViaStart(w, ORIGIN_B);
    queueFails.on = false;
    const mark = w.fx.log.length;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }) });
    expect(retried).not.toHaveProperty('warning');
    expect(w.fx.confirm.asked).toEqual([1, 1]);
    expect(w.fx.log.slice(mark)).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).toBeNull();
  });

  it('3.7 a second call during the dialog fails with settingsBusy, and the call after a queue refusal is accepted', async () => {
    const { w } = queueRefusingWorld();
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });
    let release: () => void = () => undefined;
    w.fx.confirm.gate = new Promise<void>((r) => {
      release = r;
    });
    const first = w.h.setSettings(makeSettings({ serverPort: 40000 }));
    await vi.waitFor(() => expect(w.fx.confirm.asked).toEqual([1]));

    const busy = await w.h.setSettings(makeSettings({ serverPort: 41000 }));
    expect(busy).toEqual({ ok: false, error: BUSY_TEXT, code: 'settingsBusy' });
    expect(w.saved).toEqual([]);
    expect(w.fx.confirm.asked).toEqual([1]); // no second dialog

    release();
    expect(await first).toMatchObject({ ok: true, warning: { code: 'savedNotApplied' } });
    // settingsBusy was released although the queue threw: the next call is accepted (and refused by the queue again)
    w.fx.confirm.gate = null;
    const after = await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 2 }));
    expect(after).toMatchObject({ ok: true, value: { serverPort: 40000, maxConcurrent: 2 }, warning: { code: 'savedNotApplied' } });
    expect(w.saved.map((s) => s.serverPort)).toEqual([40000, 40000]);
  });

  it('3.8 there is no queue yet (deps.queue() returns null): ok, and no warning', async () => {
    const w = world({ deps: { queue: () => null } });
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }) });
    expect(res).not.toHaveProperty('warning');
    expect(w.fx.log).toEqual(['cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.queueSettings).toEqual([]);
  });

  it('3.9 the queue throws a string that is not an Error: the warning’s detail is that string', async () => {
    const { w } = queueRefusingWorld({ thrown: () => 'plain' });
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }), warning: savedNotApplied('plain') });
    expect(w.fx.ensureCalls).toEqual([40000]);
  });

  it('3.10 the queue refuses and ensure resolves without listening (portBusy): still ok with the warning, and the port counts as moved to', async () => {
    const { w, queueFails } = queueRefusingWorld();
    w.fx.ensureResult.next = { state: 'portBusy', port: 40000 };
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toMatchObject({ ok: true, warning: savedNotApplied(QUEUE_REFUSED) });
    expect(w.fx.state.current).toEqual({ state: 'portBusy', port: 40000 });

    // the port is free now, the queue works: the same port, so no dialog and no clear, and ensure is the retry
    w.fx.ensureResult.next = null;
    queueFails.on = false;
    const mark = w.fx.log.length;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried).toEqual({ ok: true, value: makeSettings({ serverPort: 40000 }) });
    expect(w.fx.log.slice(mark)).toEqual(['saveSettings', 'ensure:40000']);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 40000 });
  });

  it('3.11 the save throws: unchanged, the queue is not reached, no warning, and the listener does not move', async () => {
    const { w } = queueRefusingWorld();
    w.failSave.on = true;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(res).toEqual({ ok: false, error: 'Something went wrong: disk full', code: 'unexpected', detail: 'disk full' });
    expect(res).not.toHaveProperty('warning');
    expect(w.fx.ensureCalls).toEqual([]);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
  });

  it('3.12 the warning is JSON-safe and carries exactly error, code and detail', async () => {
    const { w } = queueRefusingWorld();
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    if (!res.ok) throw new Error('expected ok');
    expect(Object.keys(res.warning ?? {}).sort()).toEqual(['code', 'detail', 'error']);
    expect(Object.keys(res).sort()).toEqual(['ok', 'value', 'warning']);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('ensure rejects once (a contract breach): the listener is still on the old port, so after a pairing there the retry asks and clears', async () => {
    const fx = makeIpcServerFixture();
    const rejectNext = { on: true };
    const w = world({
      fx,
      deps: {
        server: {
          status: fx.deps.server.status,
          ensure: async (port: number): Promise<ServerStatus> => {
            if (rejectNext.on) {
              rejectNext.on = false;
              fx.log.push(`ensure:${port}`);
              fx.ensureCalls.push(port);
              throw new Error('ensure broke its contract'); // before the fake moves its state: the listener stays on 38917
            }
            return fx.deps.server.ensure(port);
          },
        },
      },
    });
    w.assignFirst.on = true;
    pairOnce(w.fx.rig.store, { origin: ORIGIN_A });

    const failed = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(failed.ok).toBe(false);
    expect(w.fx.log).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
    expect(w.fx.confirm.asked).toEqual([1]);
    expect(w.fx.rig.store.list()).toEqual([]);

    const b = await pairViaStart(w, ORIGIN_B); // 38917-...: the listener never left

    const mark = w.fx.log.length;
    const retried = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
    expect(retried.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([1, 1]);
    expect(w.fx.log.slice(mark)).toEqual(['confirm', 'cancel', 'clear', 'saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.list()).toEqual([]);
    expect(w.fx.rig.store.authenticate(ORIGIN_B, b.token)).toBeNull();
    expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
    expect(w.fx.ensureCalls).toEqual([40000, 40000]);
    expect(w.fx.state.current).toEqual({ state: 'listening', port: 40000 });
  });

  // `listenOn` shuts the old listener before every attempt, so once `ensure(B)` resolved, whatever its status, nothing
  // listens on A any more: B is the port that counts as moved to.
  describe('ensure resolved without listening on the new port: that port still counts as moved to', () => {
    const NOT_LISTENING: [string, ServerStatus][] = [
      ['portBusy', { state: 'portBusy', port: 40000 }],
      ['error', { state: 'error', message: 'port 40000 cannot be used on this PC; choose another in Settings' }],
    ];

    it.each(NOT_LISTENING)('%s on 40000, then 40000 again: the same port, so no dialog and no clear, and ensure is the retry', async (_name, status) => {
      const w = productionWorld();
      w.fx.ensureResult.next = status;
      const first = await w.h.setSettings(makeSettings({ serverPort: 40000 }));
      expect(first.ok).toBe(true);
      expect(w.fx.state.current).toEqual(status);
      expect(w.fx.log).toEqual(['cancel', 'clear', 'saveSettings', 'ensure:40000']);

      w.fx.ensureResult.next = null; // the port is free now
      const mark = w.fx.log.length;
      const writes = w.fx.rig.disk.attempts;
      const retried = await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 5 }));
      expect(retried.ok).toBe(true);
      expect(w.fx.confirm.asked).toEqual([]);
      expect(w.fx.log.slice(mark)).toEqual(['saveSettings', 'ensure:40000']);
      expect(w.fx.rig.disk.attempts, 'no clear, so no pairing.json write').toBe(writes);
      expect(w.fx.ensureCalls).toEqual([40000, 40000]);
      expect(w.fx.state.current).toEqual({ state: 'listening', port: 40000 });
    });

    it.each(NOT_LISTENING)('%s on 40000, then the old port 38917: a new port again (nothing listens, so nothing is paired and no dialog), cancel and clear', async (_name, status) => {
      const w = productionWorld();
      w.fx.ensureResult.next = status;
      expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(true);
      expect(w.fx.rig.store.list()).toEqual([]);

      w.fx.ensureResult.next = null;
      const mark = w.fx.log.length;
      const res = await w.h.setSettings(makeSettings({ serverPort: 38917 }));
      expect(res.ok).toBe(true);
      expect(w.fx.confirm.asked).toEqual([]);
      expect(w.fx.log.slice(mark)).toEqual(['cancel', 'clear', 'saveSettings', 'ensure:38917']);
      expect(w.fx.rig.disk.last).toEqual({ version: 1, pairings: [] });
      expect(w.fx.ensureCalls).toEqual([40000, 38917]);
      expect(w.fx.state.current).toEqual({ state: 'listening', port: 38917 });
    });
  });

  it('after the successful retry, saving 40000 again is the same port: no dialog, no clear, ensure as a retry', async () => {
    const w = productionWorld();
    w.failSave.on = true;
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(false);
    w.failSave.on = false;
    expect((await w.h.setSettings(makeSettings({ serverPort: 40000 }))).ok).toBe(true);
    expect(w.fx.ensureCalls).toEqual([40000]);

    const c = pairOnce(w.fx.rig.store, { origin: ORIGIN_C, port: 40000 });
    const mark = w.fx.log.length;
    const res = await w.h.setSettings(makeSettings({ serverPort: 40000, maxConcurrent: 5 }));
    expect(res.ok).toBe(true);
    expect(w.fx.confirm.asked).toEqual([]);
    expect(w.fx.log.slice(mark)).toEqual(['saveSettings', 'ensure:40000']);
    expect(w.fx.rig.store.list().map((p) => p.id)).toEqual([c.pairingId]);
    expect(w.fx.rig.store.authenticate(ORIGIN_C, c.token)).not.toBeNull();
    expect(w.fx.ensureCalls).toEqual([40000, 40000]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('pairingStart', () => {
  it('returns <listening port>-<code> and the lifetime', async () => {
    const w = world();
    const res = await w.h.pairingStart();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lifetimeMs).toBe(300_000);
    expect(Object.keys(res.value).sort()).toEqual(['lifetimeMs', 'pairingString']);
    const parsed = parsePairingString(res.value.pairingString);
    expect(parsed?.port).toBe(38917);
    expect(parsed?.code).toMatch(CODE_RE);
    expect(res.value.pairingString).toBe(`38917-${parsed?.code}`);
    expect(w.fx.rig.store.codeOpen()).toBe(true);
  });

  it('uses the listening port, also when settings hold another port', async () => {
    const w = world({ settings: { serverPort: 40000 } });
    w.fx.state.current = { state: 'listening', port: 38917 };
    const res = await w.h.pairingStart();
    expect(res.ok && res.value.pairingString.startsWith('38917-')).toBe(true);
  });

  it('uses the listening port when it is the settings that say 38917', async () => {
    const w = world({ settings: { serverPort: 38917 } });
    w.fx.state.current = { state: 'listening', port: 41000 };
    const res = await w.h.pairingStart();
    expect(res.ok && res.value.pairingString.startsWith('41000-')).toBe(true);
  });

  const NOT_LISTENING: [string, ServerStatus][] = [
    ['portBusy', { state: 'portBusy', port: 38917 }],
    ['error', { state: 'error', message: 'port 38917 cannot be used on this PC; choose another in Settings' }],
  ];

  it.each(NOT_LISTENING)('fails when the server is %s, and opens no code', async (_name, state) => {
    const w = world();
    w.fx.state.current = state;
    const res = await w.h.pairingStart();
    expect(res).toEqual(NOT_LISTENING_FAILURE); // notListening: portBusy and error alike
    expect(w.fx.rig.store.codeOpen()).toBe(false);
  });

  it.each(NOT_LISTENING)(
    'fails on the server’s own status (%s) even when the pairing store would still open a code',
    async (_name, state) => {
      // The store keeps seeing "listening" (its own server-state dependency), so only the handler can refuse.
      const w = world({ deps: { server: { status: () => state, ensure: async () => state } } });
      const res = await w.h.pairingStart();
      expect(res).toEqual(NOT_LISTENING_FAILURE);
      expect(w.fx.rig.store.codeOpen()).toBe(false);
    },
  );

  it('fails at 4 pairings with the S5 text, and opens no code', async () => {
    const w = world();
    pairMany(w, 4);
    const res = await w.h.pairingStart();
    expect(res).toEqual(FOUR_PAIRED);
    expect(w.fx.rig.store.codeOpen()).toBe(false);
  });

  // D2.5: pairing.ts is not edited, so ipc.ts maps the store's refusal text to a code by comparing it with the two
  // constants of pairing.ts (pinned equal to ERROR_TEXT in tests/errorCodes.test.ts). Anything else is forwarded as it is.
  it('notListening through the store (D2.5): the store refuses with the not-listening text while the server status is listening', async () => {
    const base = world();
    expect(base.fx.state.current.state).toBe('listening');
    const stubbed = world({ fx: base.fx, deps: { pairing: { ...base.fx.rig.store, open: () => ({ ok: false, error: NOT_LISTENING_TEXT }) } } });
    expect(await stubbed.h.pairingStart()).toEqual(NOT_LISTENING_FAILURE);
  });

  it('fourPaired through the store (D2.5): the store refuses with the four-paired text', async () => {
    const base = world();
    const stubbed = world({ fx: base.fx, deps: { pairing: { ...base.fx.rig.store, open: () => ({ ok: false, error: FOUR_TEXT }) } } });
    expect(await stubbed.h.pairingStart()).toEqual(FOUR_PAIRED);
  });

  it.each([
    ['another text', 'The pairing store is closed for maintenance'],
    ['the four-paired text with a trailing space', `${FOUR_TEXT} `],
    ['the not-listening text in lower case', NOT_LISTENING_TEXT.toLowerCase()],
    ['the not-listening text without its last word', NOT_LISTENING_TEXT.replace(' the browser', '')],
    ['an empty text', ''],
  ])('(no code) a store whose open() fails with %s: forwarded as it came, with no code', async (_name, text) => {
    const base = world();
    const stubbed = world({ fx: base.fx, deps: { pairing: { ...base.fx.rig.store, open: () => ({ ok: false, error: text }) } } });
    const res = await stubbed.h.pairingStart();
    expect(res).toEqual({ ok: false, error: text });
    expect(res).not.toHaveProperty('code');
    expect(res).not.toHaveProperty('detail');
  });

  it('works at 3 pairings', async () => {
    const w = world();
    pairMany(w, 3);
    expect((await w.h.pairingStart()).ok).toBe(true);
  });

  it('works again after an unpair brings 4 down to 3', async () => {
    const w = world();
    const four = pairMany(w, 4);
    expect((await w.h.pairingStart()).ok).toBe(false);
    expect(await w.h.unpair(four[0]?.pairingId ?? '')).toEqual({ ok: true, value: null });
    expect((await w.h.pairingStart()).ok).toBe(true);
  });

  it('a second start replaces the code (the old string is dead)', async () => {
    const w = world();
    const a = await w.h.pairingStart();
    const b = await w.h.pairingStart();
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.pairingString).not.toBe(b.value.pairingString);
    const oldCode = parsePairingString(a.value.pairingString)?.code ?? '';
    expect(w.fx.rig.store.redeem({ origin: ORIGIN_A, port: 38917, code: oldCode, label: 'x' })).toEqual({ ok: false, error: 'bad_code' });
  });
});

describe('pairingCancel', () => {
  it('closes the code', async () => {
    const w = world();
    await w.h.pairingStart();
    expect(await w.h.pairingCancel()).toEqual({ ok: true, value: null });
    expect(w.fx.rig.store.codeOpen()).toBe(false);
  });

  it('with nothing open answers ok', async () => {
    const w = world();
    expect(await w.h.pairingCancel()).toEqual({ ok: true, value: null });
  });
});

describe('pairings()', () => {
  it('returns id, label, pairedAt, codeOpen and unsaved only', async () => {
    const w = world();
    const a = pairOnce(w.fx.rig.store, { origin: ORIGIN_A, label: 'Chrome' });
    const b = pairOnce(w.fx.rig.store, { origin: ORIGIN_B, label: 'Edge' });
    const view = await w.h.pairings();
    expect(Object.keys(view).sort()).toEqual(['codeOpen', 'pairings', 'unsaved']);
    expect(view.pairings.map((p) => [p.id, p.label])).toEqual([
      [a.pairingId, 'Chrome'],
      [b.pairingId, 'Edge'],
    ]);
    for (const p of view.pairings) {
      expect(Object.keys(p).sort()).toEqual(['id', 'label', 'pairedAt']);
      expect(Number.isFinite(p.pairedAt)).toBe(true);
    }
    expect(view.codeOpen).toBe(false);
    expect(view.unsaved).toBe(false);
  });

  it('never carries an origin, a tokenHash or a proofKey', async () => {
    const w = world();
    pairMany(w, 2);
    const text = JSON.stringify(await w.h.pairings());
    expect(text).not.toMatch(/origin|tokenHash|proofKey|chrome-extension/u);
    const saved = w.fx.rig.disk.last?.pairings[0];
    expect(text).not.toContain(saved?.tokenHash ?? 'x');
    expect(text).not.toContain(saved?.proofKey ?? 'x');
  });

  it('shows codeOpen while a code is open and unsaved while a write is pending', async () => {
    const w = world();
    await w.h.pairingStart();
    expect((await w.h.pairings()).codeOpen).toBe(true);
    w.fx.rig.disk.failing = true;
    pairOnce(w.fx.rig.store);
    expect((await w.h.pairings()).unsaved).toBe(true);
    w.fx.rig.disk.failing = false;
    w.fx.rig.clock.advance(30_000);
    expect((await w.h.pairings()).unsaved).toBe(false);
  });

  it('answers an empty list when nothing is paired', async () => {
    const w = world();
    expect(await w.h.pairings()).toEqual({ pairings: [], codeOpen: false, unsaved: false });
  });
});

describe('unpair', () => {
  it('removes the entry and answers ok', async () => {
    const w = world();
    const [a, b] = pairMany(w, 2);
    expect(await w.h.unpair(a?.pairingId ?? '')).toEqual({ ok: true, value: null });
    expect(w.fx.rig.store.list().map((p) => p.id)).toEqual([b?.pairingId]);
    expect(w.fx.rig.store.authenticate(ORIGIN_A, a?.token ?? '')).toBeNull();
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['a number', 5],
    ['null', null],
    ['an object', {}],
    ['an array holding an id', ['x']],
    ['true', true],
  ])('a non-string id (%s) fails and removes nothing', async (_name, id) => {
    const w = world();
    pairMany(w, 1);
    const res = await w.h.unpair(id as string);
    expect(res).toEqual(BAD_REQUEST); // badRequest
    expect(w.fx.rig.store.list()).toHaveLength(1);
  });

  it('an unknown id fails and removes nothing', async () => {
    const w = world();
    pairMany(w, 2);
    expect(await w.h.unpair('Z'.repeat(22))).toEqual(NOT_PAIRED); // notPaired
    expect(await w.h.unpair('')).toEqual(NOT_PAIRED);
    expect(w.fx.rig.store.list()).toHaveLength(2);
  });

  it('unpairing twice: the second fails', async () => {
    const w = world();
    const [a] = pairMany(w, 1);
    expect((await w.h.unpair(a?.pairingId ?? '')).ok).toBe(true);
    expect(await w.h.unpair(a?.pairingId ?? '')).toEqual(NOT_PAIRED);
  });

  it('with a failing save removes the entry and fails with the "not saved yet" text', async () => {
    const w = world();
    const [a] = pairMany(w, 1);
    w.fx.rig.disk.failing = true;
    const res = await w.h.unpair(a?.pairingId ?? '');
    expect(res).toEqual(UNPAIR_UNSAVED); // unpairUnsaved
    expect(w.fx.rig.store.list()).toEqual([]); // revoked at once
    expect(w.fx.rig.store.authenticate(ORIGIN_A, a?.token ?? '')).toBeNull();
    expect((await w.h.pairings()).unsaved).toBe(true);
  });

  it('after the failing save, the retry writes the list without the entry', async () => {
    const w = world();
    const [a] = pairMany(w, 1);
    w.fx.rig.disk.failing = true;
    await w.h.unpair(a?.pairingId ?? '');
    w.fx.rig.disk.failing = false;
    w.fx.rig.clock.advance(30_000);
    expect(w.fx.rig.disk.last?.pairings).toEqual([]);
    expect((await w.h.pairings()).unsaved).toBe(false);
  });
});

describe('wiring', () => {
  it('createHandlers exposes the four A1 handlers, each a function', () => {
    const w = world();
    for (const name of ['pairingStart', 'pairingCancel', 'pairings', 'unpair'] as const) expect(typeof w.h[name], name).toBe('function');
  });

  it('the preload has one call(...) entry for each, under the handler’s own name (ipcMain.handle uses the handler keys)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf8');
    for (const name of ['pairingStart', 'pairingCancel', 'pairings', 'unpair']) {
      expect(source, name).toMatch(new RegExp(`${name}:\\s*call\\('${name}'\\)`, 'u'));
    }
  });

  it('a handler never throws across IPC: a store that throws becomes a failed Result', async () => {
    const w = world();
    await sleep(0);
    const broken = world({
      deps: {
        pairing: {
          ...w.fx.rig.store,
          open: () => {
            throw new Error('boom');
          },
          unpair: () => {
            throw new Error('boom');
          },
        },
      },
    });
    expect(await broken.h.pairingStart()).toEqual(failure('Something went wrong: boom', 'unexpected', 'boom'));
    expect(await broken.h.unpair('A'.repeat(22))).toEqual(failure('Something went wrong: boom', 'unexpected', 'boom'));
  });
});
