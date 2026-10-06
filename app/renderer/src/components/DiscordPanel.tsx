import { useRef, useState, type FC, type ReactNode } from 'react';
import { bridge, isElectron } from '../bridge';

/** Official Discord mark, used for the Discord tab. */
export const DiscordMark: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.2.36-.43.84-.59 1.226a18.27 18.27 0 0 0-5.487 0A12.64 12.64 0 0 0 9.21 3a19.74 19.74 0 0 0-4.435 1.37C1.98 8.573 1.22 12.63 1.6 16.628a19.9 19.9 0 0 0 6.073 3.056c.49-.667.926-1.374 1.3-2.116a12.9 12.9 0 0 0 2.05.983c.375.742.81 1.45 1.3 2.116a19.87 19.87 0 0 0 6.072-3.056c.44-4.63-3.085-12.259ZM8.68 14.17a1.19 1.19 0 0 1-2.43 0c0-1.34.956-2.43 2.43-2.43 1.207 0 2.185 1.1 2.43 2.43Zm6.64 0a1.19 1.19 0 0 1-2.43 0c0-1.34.957-2.43 2.43-2.43 1.207 0 2.185 1.1 2.43 2.43Z"
    />
  </svg>
);

/** Minimal shape of the Electron <webview> tag we drive from React. */
type DiscordWebview = HTMLElement & { reload: () => void };

export const DiscordPanel: FC = () => {
  const webviewRef = useRef<DiscordWebview>(null);
  const [reloading, setReloading] = useState(false);

  const reloadDiscord = () => {
    webviewRef.current?.reload();
    setReloading(true);
    window.setTimeout(() => setReloading(false), 1200);
  };

  return (
    <section className="discord-panel" aria-label="Discord">
      <div className="discord-webview-frame">
        {isElectron ? (
          <>
            <webview
              ref={webviewRef}
              className="discord-webview"
              src="https://discord.com/app"
              partition="persist:discord"
              aria-label="Discord text chat"
            />
            <button
              type="button"
              className={`discord-reload ${reloading ? 'is-reloading' : ''}`}
              onClick={reloadDiscord}
              disabled={reloading}
              title="Reload Discord"
              aria-label="Reload Discord"
            >
              ↻
            </button>
          </>
        ) : (
          <div className="discord-preview-placeholder">
            <div className="discord-preview-icon">D</div>
            <h2>Discord text chat</h2>
            <p>The signed-in Discord webview is available in the Windows desktop app. This browser preview can’t embed Discord.</p>
            <button type="button" className="discord-open-link" onClick={() => void bridge.op('openExternal', 'https://discord.com/app')}>
              Open Discord in browser
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

/** Placeholder so the registry can type icon slots without importing React types everywhere. */
export type TabIcon = ReactNode;