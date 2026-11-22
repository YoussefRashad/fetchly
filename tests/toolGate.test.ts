import { describe, expect, it } from 'vitest';
import { ToolGate } from '../src/main/toolGate';

/** A task the spec finishes by hand, recording when it started and ended. */
function task(log: string[], name: string) {
  let finish: (v: string) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  const run = (): Promise<string> => {
    log.push(`${name}:start`);
    return new Promise<string>((resolve, reject) => {
      finish = (v) => {
        log.push(`${name}:end`);
        resolve(v);
      };
      fail = (e) => {
        log.push(`${name}:fail`);
        reject(e);
      };
    });
  };
  return { run, finish: (v = name) => finish(v), fail: (e = new Error(name)) => fail(e) };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('ToolGate', () => {
  it('runs shared tasks side by side and returns their results', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const a = task(log, 'a');
    const b = task(log, 'b');
    const pa = gate.shared(a.run);
    const pb = gate.shared(b.run);
    await flush();
    expect(log).toEqual(['a:start', 'b:start']);
    a.finish('A');
    b.finish('B');
    expect(await Promise.all([pa, pb])).toEqual(['A', 'B']);
  });

  it('starts an exclusive task only once the shared tasks already running have ended', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const probe = task(log, 'probe');
    const cleanup = task(log, 'cleanup');
    const pp = gate.shared(probe.run);
    const pc = gate.exclusive(cleanup.run);
    await flush();
    expect(log).toEqual(['probe:start']);
    probe.finish();
    await flush();
    expect(log).toEqual(['probe:start', 'probe:end', 'cleanup:start']);
    cleanup.finish('cleared');
    expect(await pc).toBe('cleared');
    expect(await pp).toBe('probe');
  });

  it('holds a shared task asked for while an exclusive task runs until that task has ended', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const cleanup = task(log, 'cleanup');
    const probe = task(log, 'probe');
    const pc = gate.exclusive(cleanup.run);
    await flush();
    const pp = gate.shared(probe.run);
    await flush();
    expect(log).toEqual(['cleanup:start']);
    cleanup.finish();
    await pc;
    await flush();
    expect(log).toEqual(['cleanup:start', 'cleanup:end', 'probe:start']);
    probe.finish();
    await pp;
  });

  it('holds new shared tasks while an exclusive task waits, so the exclusive task is not starved', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const first = task(log, 'first');
    const cleanup = task(log, 'cleanup');
    const later = task(log, 'later');
    const p1 = gate.shared(first.run);
    const pc = gate.exclusive(cleanup.run);
    const p2 = gate.shared(later.run);
    await flush();
    expect(log).toEqual(['first:start']);
    first.finish();
    await flush();
    expect(log).toEqual(['first:start', 'first:end', 'cleanup:start']);
    cleanup.finish();
    await flush();
    expect(log).toEqual(['first:start', 'first:end', 'cleanup:start', 'cleanup:end', 'later:start']);
    later.finish();
    await Promise.all([p1, pc, p2]);
  });

  it('runs exclusive tasks one after the other', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const one = task(log, 'one');
    const two = task(log, 'two');
    const p1 = gate.exclusive(one.run);
    const p2 = gate.exclusive(two.run);
    await flush();
    expect(log).toEqual(['one:start']);
    one.finish();
    await flush();
    expect(log).toEqual(['one:start', 'one:end', 'two:start']);
    two.finish();
    await Promise.all([p1, p2]);
  });

  it('passes on the rejection of an exclusive task and opens the gate again', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const cleanup = task(log, 'cleanup');
    const pc = gate.exclusive(cleanup.run);
    await flush();
    cleanup.fail(new Error('powershell missing'));
    await expect(pc).rejects.toThrow('powershell missing');
    const probe = task(log, 'probe');
    const pp = gate.shared(probe.run);
    await flush();
    expect(log.at(-1)).toBe('probe:start');
    probe.finish();
    await pp;
  });

  it('passes on the rejection of a shared task and lets a waiting exclusive task run', async () => {
    const gate = new ToolGate();
    const log: string[] = [];
    const probe = task(log, 'probe');
    const cleanup = task(log, 'cleanup');
    const pp = gate.shared(probe.run);
    const pc = gate.exclusive(cleanup.run);
    await flush();
    probe.fail(new Error('timed out'));
    await expect(pp).rejects.toThrow('timed out');
    await flush();
    expect(log.at(-1)).toBe('cleanup:start');
    cleanup.finish();
    await pc;
  });

  it('treats a task that throws at once like one that rejects', async () => {
    const gate = new ToolGate();
    await expect(
      gate.shared(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(
      gate.exclusive(() => {
        throw new Error('sync too');
      }),
    ).rejects.toThrow('sync too');
    expect(await gate.shared(async () => 'still open')).toBe('still open');
  });
});
