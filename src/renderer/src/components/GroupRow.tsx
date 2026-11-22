import { useState } from 'react';
import type { Group, GroupVerb, Job } from '../../../shared/types';
import { groupSummary } from '../format';
import { S } from '../strings';
import { JobRow } from './JobRow';

interface Props {
  group: Group;
  /** every job of the group, for the summary */
  members: Job[];
  /** the members that pass the current filter */
  visible: Job[];
  onError(message: string): void;
}

export function GroupRow({ group, members, visible, onError }: Props) {
  const [open, setOpen] = useState(true);
  const summary = groupSummary(members);
  const canPause = members.some((j) => j.state === 'queued' || j.state === 'probing' || j.state === 'downloading');
  const canResume = members.some((j) => j.state === 'paused');
  const unfinished = members.some((j) => j.state !== 'done' && j.state !== 'skipped' && j.state !== 'failed');

  async function act(verb: GroupVerb) {
    if (verb === 'cancel' && !window.confirm(S.confirmCancelGroup(group.title))) return;
    const res = await window.hammel.group(group.id, verb);
    if (!res.ok) onError(res.error);
  }

  return (
    <li className="group">
      <div className="group-head">
        <button type="button" className="twisty" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={group.title}>
          {open ? '▾' : '▸'}
        </button>
        <span className="job-name" dir="auto" title={group.title}>
          {group.title}
        </span>
        <span className="job-quality">{S.items(summary.done, summary.total)}</span>
        <span className="job-status">{summary.percent}%</span>
        <span className="job-actions">
          {canPause && (
            <button type="button" onClick={() => void act('pause')} title={S.groupVerbs.pause} aria-label={S.groupVerbs.pause}>
              ❚❚
            </button>
          )}
          {canResume && (
            <button type="button" onClick={() => void act('resume')} title={S.groupVerbs.resume} aria-label={S.groupVerbs.resume}>
              ▶
            </button>
          )}
          <button
            type="button"
            onClick={() => void act('cancel')}
            title={unfinished ? S.groupVerbs.cancel : S.verbs.remove}
            aria-label={unfinished ? S.groupVerbs.cancel : S.verbs.remove}
          >
            ✕
          </button>
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div className="fill" style={{ width: `${summary.percent}%` }} />
      </div>
      {open && (
        <ul>
          {visible.map((job) => (
            <JobRow key={job.id} job={job} onError={onError} />
          ))}
        </ul>
      )}
    </li>
  );
}
