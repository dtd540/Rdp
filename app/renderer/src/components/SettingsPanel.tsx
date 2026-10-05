import type { FC } from 'react';

/**
 * Settings tab. Options live here as cards; each one reads from and writes back
 * to the persisted app state (see `AppState` in shared/rpc.ts), so anything
 * added survives a restart.
 */
export const SettingsPanel: FC = () => (
  <div className="settings-root">
    <div className="section-heading">
      <div>
        <span className="section-kicker">TUNE THE BRIDGE</span>
        <h2>Settings</h2>
      </div>
    </div>

    <div className="card">
      <h2>Nothing to configure yet</h2>
      <p className="sub">
        Toggles and sliders added to this tab show up here and are saved with your setup.
      </p>
    </div>
  </div>
);