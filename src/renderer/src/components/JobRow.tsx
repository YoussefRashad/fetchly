import { Fragment } from 'react';
import type { Job, JobVerb } from '../../../shared/types';
import { addedText, addedTitle, allowedVerbs, etaText, percent, qualityLabel, sizeParts, speedText, statusParts, statusText } from '../format';
import type { IconName } from '../model/icons';
import { S } from '../strings';
import { Icon } from './Icon';

const ICONS: Record<JobVerb, IconName> = {
  pause: 'pause',
  resume: 'play',
  cancel: 'close',
  retry: 'retry',
  remove: 'close',
  removeWithFile: 'trash',
};

interface Props {
  job: Job;
  onError(message: string): void;
}

/** The size column: the done figure stands out; the slash, size and unit stay quiet. One left-to-right run. */
function SizeCell({ job }: { job: Job }) {
  const size = sizeParts(job);
  return (
    <span className="job-size" title={size !== null && job.kind === 'media' ? S.size.mediaHint : undefined}>
      {size !== null && (
        <bdi dir="ltr">
          {size.done !== null && <span className="size-done">{size.done}</span>}
          {size.done !== null && size.total !== null && ' / '}
          {size.total !== null && `${size.approx ? '~' : ''}${size.total}`} {size.unit}
        </bdi>
      )}
    </span>
  );
}

export function JobRow({ job, onError }: Props) {
  const pct = percent(job);
  const name = job.fileName ?? (job.index !== null && job.baseName ? job.baseName : job.title);
  const quality = qualityLabel(job);

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
        <span className="job-name" title={job.title}>
          <bdi dir="auto" className="job-name-text">
            {name}
          </bdi>
        </span>
        <span className="job-quality">{quality !== '' && <bdi dir="ltr">{quality}</bdi>}</span>
        <SizeCell job={job} />
        <span className="job-status" title={statusText(job)}>
          {statusParts(job).map((part, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              <bdi>{part}</bdi>
            </Fragment>
          ))}
        </span>
        <span className="job-speed">{speedText(job) !== '' && <bdi dir="ltr">{speedText(job)}</bdi>}</span>
        <span className="job-eta">{etaText(job) !== '' && <bdi dir="ltr">{etaText(job)}</bdi>}</span>
        <span className="job-added" title={addedTitle(job.createdAt)}>
          <bdi>{addedText(job.createdAt)}</bdi>
        </span>
        <span className="job-actions">
          {job.state === 'done' && (
            <button type="button" onClick={() => void open('file')}>
              {S.openFile}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => void open('folder')} title={S.openFolder} aria-label={S.openFolder}>
            <Icon name="folder" />
          </button>
          {allowedVerbs(job).map((verb) => (
            <button key={verb} type="button" className="icon-btn" onClick={() => void act(verb)} title={S.verbs[verb]} aria-label={S.verbs[verb]}>
              <Icon name={ICONS[verb]} />
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
