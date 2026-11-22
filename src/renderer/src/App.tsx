import { useCallback, useEffect, useState } from 'react';
import type { ProbeResult, Settings, Snapshot } from '../../shared/types';
import { AddDialog } from './components/AddDialog';
import { InstallScreen } from './components/InstallScreen';
import { JobList } from './components/JobList';
import { SettingsDialog } from './components/SettingsDialog';
import { UrlBar } from './components/UrlBar';
import { formatSpeed, type Filter } from './format';
import { S } from './strings';

const FILTERS: Filter[] = ['all', 'downloading', 'paused', 'done', 'failed'];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ jobs: [], groups: [] });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toolsReady, setToolsReady] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<{ url: string; probe: ProbeResult } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await window.hammel.snapshot());
  }, []);

  useEffect(() => {
    const stop = window.hammel.onChanged(setSnapshot);
    void refresh();
    void window.hammel.getSettings().then(setSettings);
    void window.hammel.binaries().then((bins) => setToolsReady(bins.every((b) => b.installed)));
    void window.hammel.startupNotice().then((n) => n && setMessage(n));
    return stop;
  }, [refresh]);

  if (toolsReady === null || settings === null) return null;
  if (!toolsReady) {
    return (
      <InstallScreen
        onInstalled={() => {
          setToolsReady(true);
          void refresh();
        }}
      />
    );
  }

  const totalSpeed = snapshot.jobs.reduce((sum, j) => sum + j.speed, 0);

  return (
    <div className="app">
      <UrlBar onProbed={(url, probe) => setAdding({ url, probe })} onOpenSettings={() => setShowSettings(true)} />

      <nav className="filters">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? 'active' : undefined} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {S.filters[f]}
          </button>
        ))}
        <span className="speed">{formatSpeed(totalSpeed)}</span>
      </nav>

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
