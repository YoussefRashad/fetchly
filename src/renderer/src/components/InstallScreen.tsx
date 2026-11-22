import { useEffect, useState } from 'react';
import type { BinName } from '../../../shared/types';
import { S } from '../strings';

interface Props {
  onInstalled(): void;
}

export function InstallScreen({ onInstalled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<BinName, number>>>({});

  useEffect(() => window.fetchly.onInstallProgress((name, pct) => setProgress((p) => ({ ...p, [name]: pct }))), []);

  async function install() {
    setBusy(true);
    setError(null);
    const res = await window.fetchly.installBinaries();
    setBusy(false);
    if (res.ok) onInstalled();
    else setError(res.error);
  }

  return (
    <main className="install">
      <h1>{S.installTitle}</h1>
      <p>{S.installBody}</p>
      <ul>
        {S.installTools.map(([name, what]) => (
          <li key={name}>
            <strong>{name}</strong> — {what}
            {progress[name] !== undefined && <span className="pct"> {progress[name]}%</span>}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="primary" disabled={busy} onClick={() => void install()}>
        {busy ? S.installing : error ? S.retryInstall : S.install}
      </button>
    </main>
  );
}
