import { useState, type FC } from 'react';
import { saveGamerPreferences, useGamerPreferences } from '../gamerStore';
import { bridge, type BackgroundImage } from '../bridge';

export interface SettingsPanelProps {
  /** Resolved background, or null when the default dark theme is in use. */
  background: BackgroundImage | null;
  /** Re-read the persisted background from the main process. */
  refreshBackground: () => Promise<void>;
}

function describe(background: BackgroundImage | null): { title: string; detail: string } {
  if (!background) {
    return { title: 'Default dark theme', detail: 'No picture set — the app uses its built-in background.' };
  }
  if (background.broken) {
    return { title: background.name, detail: background.detail ?? 'That file cannot be shown. Pick it again.' };
  }
  return {
    title: background.name,
    detail: background.animated
      ? 'Animated GIF — it plays behind the app.'
      : 'Still image — stretched to cover the window.'
  };
}

/**
 * Settings tab. Options live here as cards; each one reads from and writes back
 * to the persisted app state (see `AppState` in shared/rpc.ts), so anything
 * added survives a restart.
 */
export const SettingsPanel: FC<SettingsPanelProps> = ({ background, refreshBackground }) => {
  const preferences = useGamerPreferences();
  const updatePreferences = (patch: Parameters<typeof saveGamerPreferences>[0]) => {
    try { saveGamerPreferences(patch); } catch (error) { setNote(`Could not save preferences: ${String(error)}`); }
  };
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { title, detail } = describe(background);
  const usable = Boolean(background && !background.broken && background.url);

  const run = async (op: 'pickBackgroundImage' | 'clearBackground'): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      const result = await bridge.op(op);
      if (result.ok) {
        await refreshBackground();
        return;
      }
      // A closed file dialog is a normal outcome, not something to report.
      if (result.detail && result.detail !== 'cancelled') setNote(result.detail);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-root">
      <div className="section-heading">
        <div>
          <span className="section-kicker">TUNE THE BRIDGE</span>
          <h2>Settings</h2>
        </div>
      </div>

      <div className="card bg-card">
        <h2>App background</h2>
        <p className="sub">
          Paint a picture or an animated GIF behind the app. The file stays on this PC — nothing is
          uploaded — and removing it brings back the default dark theme.
        </p>
        <div className="bg-row">
          <div
            className={`bg-preview ${usable ? 'has-image' : ''}`}
            style={usable ? { backgroundImage: `url("${background!.url}")` } : undefined}
            title={background?.path || undefined}
            aria-hidden="true"
          >
            {usable ? null : <span>No background</span>}
          </div>
          <div className="bg-copy">
            <b>
              {title}
              {usable && background!.animated ? <span className="pill bg-badge">GIF · animated</span> : null}
            </b>
            <span>{detail}</span>
            {background?.path ? (
              <span className="bg-path" title={background.path}>
                {background.path}
              </span>
            ) : null}
            {note ? (
              <p className="bg-note" role="status">
                {note}
              </p>
            ) : null}
          </div>
          <div className="bg-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void run('pickBackgroundImage')}
              disabled={busy}
            >
              {busy ? 'Working…' : usable ? 'Change…' : 'Choose image…'}
            </button>
            {background ? (
              <button type="button" onClick={() => void run('clearBackground')} disabled={busy}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Make it yours</h2>
        <p className="sub">Appearance preferences are saved on this device.</p>
        <label className="field-label">Accent colour<select value={preferences.accent} onChange={(event) => updatePreferences({ accent: event.target.value as 'violet' | 'mint' | 'blue' })}><option value="violet">Violet</option><option value="mint">Mint</option><option value="blue">Blue</option></select></label>
        <label className="check-row"><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => updatePreferences({ reducedMotion: event.target.checked })} />Reduce animations and transitions</label>
        <label className="check-row"><input type="checkbox" checked={preferences.compactGames} onChange={(event) => updatePreferences({ compactGames: event.target.checked })} />Compact game cards</label>
        <div className="divider" />
        <h2>Keyboard shortcuts</h2><p className="hint"><kbd>Ctrl K</kbd> opens quick navigation. <kbd>Escape</kbd> closes dialogs.</p>
        <h2>Privacy by default</h2><p className="hint">World bookmarks, notes, favourites and chatbox templates stay local. PC status is read-only. OSC sends only to this PC, and broadcasts never start automatically. Steam artwork and public-library lookups contact Steam.</p>
      </div>
    </div>
  );
};