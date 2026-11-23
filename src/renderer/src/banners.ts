import type { AppStatus, Snapshot } from '../../shared/types';
import { S } from './strings';

/** The FetchlyApi method a banner's button calls. */
export type BannerAction = 'retryEngines' | 'confirmStraysGone';

/** A persistent banner: it shows while its cause lasts and has no close button. */
export interface Banner {
  id: 'engine' | 'server' | 'save' | 'cutOff';
  text: string;
  action: BannerAction | null;
}

/**
 * The persistent banners for the current state, in this order: engine error, browser server
 * (port busy or error), save error, cut-off downloads. Each is state, not an event: it goes
 * away only when its cause does. The server banner has no button: saving Settings retries.
 */
export function banners(status: AppStatus, snapshot: Snapshot): Banner[] {
  const out: Banner[] = [];
  if (status.engine.state === 'error') out.push({ id: 'engine', text: status.engine.message, action: 'retryEngines' });
  if (status.server.state === 'portBusy') out.push({ id: 'server', text: S.portBusyBanner(status.server.port), action: null });
  if (status.server.state === 'error') out.push({ id: 'server', text: status.server.message, action: null });
  if (status.saveError !== null) out.push({ id: 'save', text: status.saveError, action: null });
  if (snapshot.jobs.some((j) => j.interrupted)) out.push({ id: 'cutOff', text: S.cutOffBanner, action: 'confirmStraysGone' });
  return out;
}
