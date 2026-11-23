import type { Lang } from '../shared/i18n';
import type { Snapshot } from '../shared/types';
import { ACTIVE } from './jobs/state';
import type { Finished } from './jobs/queue';
import { shellStrings } from './shellStrings';

/** The notification shown when a download or a whole playlist has nothing left to do. */
export function finishedMessage(e: Finished, lang: Lang = 'en'): { title: string; body: string } {
  const t = shellStrings(lang);
  if (e.kind === 'job') {
    const title = e.failed > 0 ? t.jobFailed : e.skipped > 0 ? t.jobSkipped : t.jobFinished;
    return { title, body: t.subject(e.title) };
  }
  const parts = [t.subject(e.title)];
  if (e.failed > 0) parts.push(t.countFailed(e.failed));
  if (e.skipped > 0) parts.push(t.countSkipped(e.skipped));
  return { title: t.groupFinished, body: parts.join(' · ') };
}

export function trayTooltip(s: Snapshot, lang: Lang = 'en'): string {
  const t = shellStrings(lang);
  const active = s.jobs.filter((j) => ACTIVE.has(j.state)).length;
  return active === 0 ? t.tooltipIdle : t.tooltipActive(active);
}

/** The tray icon, drawn here so the project carries no binary asset: a down arrow over a tray line. */
export function trayIconBitmap(): { size: number; data: Buffer } {
  const size = 32;
  const data = Buffer.alloc(size * size * 4); // BGRA, transparent
  const paint = (x: number, y: number): void => {
    const i = (y * size + x) * 4;
    data[i] = 0xeb; // B
    data[i + 1] = 0x6f; // G
    data[i + 2] = 0x1f; // R
    data[i + 3] = 0xff; // A
  };
  for (let y = 3; y <= 15; y += 1) for (let x = 13; x <= 18; x += 1) paint(x, y); // shaft
  for (let row = 0; row <= 8; row += 1) {
    // arrow head, narrowing downwards
    for (let x = 7 + row; x <= 24 - row; x += 1) paint(x, 15 + row);
  }
  for (let y = 26; y <= 28; y += 1) for (let x = 5; x <= 26; x += 1) paint(x, y); // tray line
  return { size, data };
}
