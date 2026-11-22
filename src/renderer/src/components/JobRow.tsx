import type { Job, JobVerb } from '../../../shared/types';
import { allowedVerbs, percent, qualityLabel, statusText } from '../format';
import { S } from '../strings';

const ICONS: Record<JobVerb, string> = {
  pause: '❚❚',
  resume: '▶',
  cancel: '✕',
  retry: '↻',
  remove: '✕',
  removeWithFile: '🗑',
};

interface Props {
  job: Job;
  onError(message: string): void;
}

export function JobRow({ job, onError }: Props) {
  const pct = percent(job);
  const name = job.fileName ?? (job.index !== null && job.baseName ? job.baseName : job.title);

  async function act(verb: JobVerb) {
    if (verb === 'cancel' && !window.confirm(S.confirmCancel(job.title))) return;
    if (verb === 'removeWithFile' && !window.confirm(S.confirmDeleteFile(job.title))) return;
    const res = await window.fetchly.job(job.id, verb);
    if (!res.ok) onError(res.error);
  }

  async function open(kind: 'file' | 'folder') {
    const res = kind === 'file' ? await window.fetchly.openFile(job.id) : await window.fetchly.openFolder(job.id);
    if (!res.ok) onError(res.error);
  }

  return (
    <li className={`job state-${job.state}${job.groupId ? ' in-group' : ''}`} onDoubleClick={() => job.state === 'done' && void open('file')}>
      <div className="job-main">
        <span className="job-name" dir="auto" title={job.title}>
          {name}
        </span>
        <span className="job-quality">{qualityLabel(job)}</span>
        <span className="job-status">{statusText(job)}</span>
        <span className="job-actions">
          {job.state === 'done' && (
            <button type="button" onClick={() => void open('file')}>
              {S.openFile}
            </button>
          )}
          <button type="button" onClick={() => void open('folder')} title={S.openFolder} aria-label={S.openFolder}>
            📁
          </button>
          {allowedVerbs(job).map((verb) => (
            <button key={verb} type="button" onClick={() => void act(verb)} title={S.verbs[verb]} aria-label={S.verbs[verb]}>
              {ICONS[verb]}
            </button>
          ))}
        </span>
      </div>
      {job.state !== 'done' && job.state !== 'skipped' && (
        <div className="bar" aria-hidden="true">
          <div className={pct === null ? 'fill unknown' : 'fill'} style={{ width: `${pct ?? 100}%` }} />
        </div>
      )}
    </li>
  );
}
