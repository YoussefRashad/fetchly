import { useState } from 'react';
import type { ProbeResult } from '../../../shared/types';
import { S } from '../strings';
import { Icon } from './Icon';

interface Props {
  onProbed(url: string, probe: ProbeResult): void;
  onOpenSettings(): void;
}

export function UrlBar({ onProbed, onOpenSettings }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const value = url.trim();
    if (busy || value === '') return;
    setBusy(true);
    setError(null);
    const res = await window.fetchly.probe(value);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setUrl('');
    onProbed(value, res.value);
  }

  return (
    <header className="urlbar">
      <form onSubmit={(e) => void submit(e)}>
        <input
          type="text"
          dir="ltr"
          value={url}
          placeholder={S.urlPlaceholder}
          aria-label={S.urlPlaceholder}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          autoFocus
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={busy || url.trim() === ''}>
          {busy ? S.checking : S.add}
        </button>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label={S.settings} title={S.settings}>
          <Icon name="gear" />
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
