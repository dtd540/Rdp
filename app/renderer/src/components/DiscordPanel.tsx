import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { bridge, hasNativeWebviews } from '../bridge';

interface ElementSize {
  width: number;
  height: number;
}

interface DiscordBounds {
  frame: ElementSize;
  webview: ElementSize | null;
}

function elementSize(element: Element | null): ElementSize | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
}

function sameBounds(a: DiscordBounds | null, b: DiscordBounds): boolean {
  return a?.frame.width === b.frame.width && a.frame.height === b.frame.height &&
    a?.webview?.width === b.webview?.width && a?.webview?.height === b.webview?.height;
}

export const DiscordMark: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M19.73 4.87a18.6 18.6 0 0 0-4.61-1.43l-.57 1.17a17.3 17.3 0 0 0-5.1 0l-.57-1.17a18.6 18.6 0 0 0-4.61 1.43C1.35 9.2.55 13.42.95 17.58a18.8 18.8 0 0 0 5.64 2.85l1.2-1.96-1.76-.84.44-.34a13.25 13.25 0 0 0 11.06 0l.44.34-1.76.84 1.2 1.96a18.8 18.8 0 0 0 5.64-2.85c.47-4.82-.8-8.99-3.32-12.71ZM8.12 14.91c-1.08 0-1.98-.99-1.98-2.21s.87-2.21 1.98-2.21 2 .99 1.98 2.21c0 1.22-.88 2.21-1.98 2.21Zm7.76 0c-1.08 0-1.98-.99-1.98-2.21s.87-2.21 1.98-2.21 2 .99 1.98 2.21c0 1.22-.88 2.21-1.98 2.21Z"
    />
  </svg>
);

type DiscordWebview = HTMLElement & { reload: () => void };

export const DiscordPanel: FC = () => {
  const frameRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<DiscordWebview>(null);
  const [reloading, setReloading] = useState(false);
  const [bounds, setBounds] = useState<DiscordBounds | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const frameSize = elementSize(frame);
      if (!frameSize) return;
      const next = { frame: frameSize, webview: elementSize(webviewRef.current) };
      setBounds((current) => sameBounds(current, next) ? current : next);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    if (webviewRef.current) observer.observe(webviewRef.current);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const reloadDiscord = () => {
    webviewRef.current?.reload();
    setReloading(true);
    window.setTimeout(() => setReloading(false), 1200);
  };

  return (
    <section className="discord-panel" aria-label="Discord">
      <div className="discord-webview-frame" ref={frameRef}>
        {hasNativeWebviews ? (
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
        {bounds && <div className="discord-bounds-diagnostic" aria-label="Discord view size diagnostic">
          <span>Frame: {bounds.frame.width} × {bounds.frame.height}px</span>
          {bounds.webview
            ? <span>Webview: {bounds.webview.width} × {bounds.webview.height}px</span>
            : <span>Native webview unavailable in browser preview</span>}
        </div>}
      </div>
    </section>
  );
};

export type TabIcon = ReactNode;