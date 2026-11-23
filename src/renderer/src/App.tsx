import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { dirOf, resolveLang } from '../../shared/i18n';
import type { AppStatus, ProbeResult, Settings, Snapshot } from '../../shared/types';
import { banners, type BannerAction } from './banners';
import { AddDialog } from './components/AddDialog';
import { InstallScreen } from './components/InstallScreen';
import { JobList } from './components/JobList';
import { SettingsDialog } from './components/SettingsDialog';
import { UrlBar } from './components/UrlBar';
import { formatSpeed, type Filter } from './format';
import { S, setLanguage } from './strings';

const FILTERS: Filter[] = ['all', 'downloading', 'paused', 'done', 'failed'];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ jobs: [], groups: [] });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<{ url: string; probe: ProbeResult } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<BannerAction | null>(null);

  // The language is known once the settings are; everything below reads S in it.
  const lang = settings === null ? null : resolveLang(settings.language, navigator.language);
  if (lang !== null) setLanguage(lang);

  useLayoutEffect(() => {
    if (lang === null) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);

  const refresh = useCallback(async () => {
    setSnapshot(await window.fetchly.snapshot());
  }, []);

  useEffect(() => {
    const stopChanged = window.fetchly.onChanged(setSnapshot);
    // Subscribe first, then ask: the status is state, so whichever answer arrives last is current.
    const stopStatus = window.fetchly.onStatus(setStatus);
    void window.fetchly.status().then(setStatus);
    void refresh();
    void window.fetchly.getSettings().then(setSettings);
    void window.fetchly.startupNotice().then((n) => n && setMessage(n));
    return () => {
      stopChanged();
      stopStatus();
    };
  }, [refresh]);

  async function runBannerAction(action: BannerAction) {
    if (action === 'confirmStraysGone' && !window.confirm(S.confirmStraysGone)) return;
    setPending(action);
    try {
      const res = await window.fetchly[action]();
      if (!res.ok) setMessage(res.error);
    } finally {
      setPending(null);
    }
  }

  if (status === null || lang === null || settings === null) return null;
  if (status.engine.state === 'notInstalled') {
    return (
      <InstallScreen
        key={lang}
        onInstalled={() => {
          void window.fetchly.status().then(setStatus);
          void refresh();
        }}
      />
    );
  }

  const totalSpeed = snapshot.jobs.reduce((sum, j) => sum + j.speed, 0);
  const actionLabels: Record<BannerAction, string> = { retryEngines: S.retry, confirmStraysGone: S.theyAreGone };

  return (
    <div className="app" key={lang}>
      <UrlBar onProbed={(url, probe) => setAdding({ url, probe })} onOpenSettings={() => setShowSettings(true)} />

      <nav className="filters">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? 'active' : undefined} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {S.filters[f]}
          </button>
        ))}
        <span className="speed">
          <bdi dir="ltr">{formatSpeed(totalSpeed)}</bdi>
        </span>
      </nav>

      {banners(status, snapshot).map(({ id, text, action }) => (
        <p key={id} className={`banner persistent banner-${id}`} role="alert">
          <span>{text}</span>
          {action !== null && (
            <button type="button" disabled={pending !== null} onClick={() => void runBannerAction(action)}>
              {actionLabels[action]}
            </button>
          )}
        </p>
      ))}

      {message && (
        <p className="banner" role="status">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label={S.close}>
            ✕
          </button>
        </p>
      )}

      <main>
        <JobList snapshot={snapshot} filter={filter} onError={setMessage} />
      </main>

      {adding && <AddDialog url={adding.url} probe={adding.probe} settings={settings} onClose={() => setAdding(null)} />}
      {showSettings && <SettingsDialog settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
