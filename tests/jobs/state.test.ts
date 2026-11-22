import { describe, expect, it } from 'vitest';
import { ACTIVE, IllegalTransition, transition, type JobEvent } from '../../src/main/jobs/state';
import type { JobState } from '../../src/shared/types';
import { makeJob } from '../helpers';

const done: JobEvent = { type: 'done', fileName: 'a.mp4', actualHeight: 1080 };
const fail: JobEvent = { type: 'fail', reason: 'disk full' };
const skip: JobEvent = { type: 'skip', reason: 'private' };

const table: [JobState, JobEvent, JobState][] = [
  ['queued', { type: 'start' }, 'probing'],
  ['probing', { type: 'firstProgress' }, 'downloading'],
  ['probing', { type: 'merging' }, 'merging'],
  ['downloading', { type: 'merging' }, 'merging'],
  ['probing', done, 'done'],
  ['downloading', done, 'done'],
  ['merging', done, 'done'],
  ['queued', { type: 'pause' }, 'paused'],
  ['probing', { type: 'pause' }, 'paused'],
  ['downloading', { type: 'pause' }, 'paused'],
  ['paused', { type: 'resume' }, 'queued'],
  ['failed', { type: 'retry' }, 'queued'],
  ['queued', fail, 'failed'],
  ['probing', fail, 'failed'],
  ['downloading', fail, 'failed'],
  ['merging', fail, 'failed'],
  ['queued', skip, 'skipped'],
  ['probing', skip, 'skipped'],
  ['downloading', skip, 'skipped'],
];

describe('transition', () => {
  it.each(table)('%s + %o -> %s', (from, ev, to) => {
    expect(transition(makeJob({ state: from }), ev).state).toBe(to);
  });

  it('rejects pausing a finished job', () => {
    expect(() => transition(makeJob({ state: 'done' }), { type: 'pause' })).toThrow(IllegalTransition);
  });

  it('rejects pausing during the merge', () => {
    expect(() => transition(makeJob({ state: 'merging' }), { type: 'pause' })).toThrow(IllegalTransition);
  });

  it('rejects skipping during the merge', () => {
    expect(() => transition(makeJob({ state: 'merging' }), skip)).toThrow(IllegalTransition);
  });

  it('keeps the reason of a failure', () => {
    expect(transition(makeJob({ state: 'downloading' }), fail).reason).toBe('disk full');
  });

  it('keeps the reason of a skip', () => {
    expect(transition(makeJob({ state: 'probing' }), skip).reason).toBe('private');
  });

  it('clears the reason on resume', () => {
    const paused = makeJob({ state: 'paused', reason: 'old' });
    expect(transition(paused, { type: 'resume' }).reason).toBeNull();
  });

  it('resets attempts and the reason on retry', () => {
    const failed = makeJob({ state: 'failed', reason: 'download failed', attempts: 3 });
    const next = transition(failed, { type: 'retry' });
    expect(next.attempts).toBe(0);
    expect(next.reason).toBeNull();
  });

  it('records the file and stops the meters when done', () => {
    const next = transition(makeJob({ state: 'merging', speed: 500, eta: 9 }), done);
    expect(next).toMatchObject({ fileName: 'a.mp4', actualHeight: 1080, speed: 0, eta: null });
  });

  it('stops the meters when paused', () => {
    const next = transition(makeJob({ state: 'downloading', speed: 500, eta: 9 }), { type: 'pause' });
    expect(next).toMatchObject({ speed: 0, eta: null });
  });

  it('does not mutate the job it is given', () => {
    const job = makeJob({ state: 'queued' });
    transition(job, { type: 'start' });
    expect(job.state).toBe('queued');
  });
});

describe('ACTIVE', () => {
  it('is exactly the states that hold a queue slot', () => {
    expect([...ACTIVE].sort()).toEqual(['downloading', 'merging', 'probing']);
  });
});
