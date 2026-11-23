import type { Snapshot } from '../../../shared/types';
import { matchesFilter, type Filter } from '../format';
import { S } from '../strings';
import { GroupRow } from './GroupRow';
import { JobRow } from './JobRow';

interface Props {
  snapshot: Snapshot;
  filter: Filter;
  onError(message: string): void;
}

export function JobList({ snapshot, filter, onError }: Props) {
  const { jobs, groups } = snapshot;
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <h2>{S.emptyTitle}</h2>
        <p>{S.emptyHint}</p>
      </div>
    );
  }

  // A playlist appears once, where its first item sits in the list.
  const seenGroups = new Set<string>();
  const rows = [];
  for (const job of jobs) {
    if (job.groupId === null) {
      if (matchesFilter(job, filter)) rows.push(<JobRow key={job.id} job={job} onError={onError} />);
      continue;
    }
    if (seenGroups.has(job.groupId)) continue;
    seenGroups.add(job.groupId);
    const group = groups.find((g) => g.id === job.groupId);
    const members = jobs.filter((j) => j.groupId === job.groupId);
    const visible = members.filter((j) => matchesFilter(j, filter));
    if (!group || visible.length === 0) continue;
    rows.push(<GroupRow key={group.id} group={group} members={members} visible={visible} onError={onError} />);
  }

  if (rows.length === 0) return <div className="empty">{S.emptyFilter}</div>;
  const c = S.columns;
  return (
    <>
      {/* The headings use the rows' own grid, so each one sits over its column in both directions. */}
      <div className="jobs-head" aria-hidden="true">
        <span className="job-name">{c.name}</span>
        <span className="job-quality">{c.quality}</span>
        <span className="job-size">{c.size}</span>
        <span className="job-status">{c.status}</span>
        <span className="job-speed">{c.speed}</span>
        <span className="job-eta">{c.timeLeft}</span>
        <span className="job-added">{c.added}</span>
        <span className="job-actions" />
      </div>
      <ul className="jobs">{rows}</ul>
    </>
  );
}
