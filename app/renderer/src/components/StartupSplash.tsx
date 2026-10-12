import { useEffect, useState, type FC } from 'react';
import './StartupSplash.css';

const ANIMATION_MS = 8000;
const FADE_MS = 500;
const LETTERS = ['S', 'P', 'O', 'T', 'T'];

export interface StartupSplashProps {
  onDone: () => void;
}

export const StartupSplash: FC<StartupSplashProps> = ({ onDone }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onDone();
      return;
    }
    const fade = window.setTimeout(() => setLeaving(true), ANIMATION_MS);
    const done = window.setTimeout(onDone, ANIMATION_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [onDone]);

  const skip = () => {
    setLeaving(true);
    window.setTimeout(onDone, FADE_MS);
  };

  return (
    <div
      className={`su-splash${leaving ? ' su-leaving' : ''}`}
      role="img"
      aria-label="SPOTT startup animation"
      onClick={skip}
    >
      <div className="su-glow" aria-hidden="true" />

      <svg className="su-emblem" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <mask id="su-ring-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
            <path className="su-mask-draw" pathLength="1" d="M200 50 A150 150 0 0 1 200 350 A150 150 0 0 1 200 50" />
          </mask>
        </defs>

        <g className="su-disc">
          <circle className="su-disc-top" cx="200" cy="200" r="98" />
          <path className="su-disc-low" d="M118.9 255 A98 98 0 0 0 281.1 255 Z" />
        </g>

        <g className="su-ring" mask="url(#su-ring-mask)">
          <circle className="su-ring-dashes" cx="200" cy="200" r="150" />
        </g>

        <g className="su-radar">
          <path className="su-wedge" d="M200 200 L200 50 A150 150 0 0 0 93.9 93.9 Z" />
          <path className="su-wedge" d="M200 200 L200 50 A150 150 0 0 0 120.5 72.8 Z" />
          <path className="su-wedge" d="M200 200 L200 50 A150 150 0 0 0 148.7 59.1 Z" />
          <path className="su-wedge" d="M200 200 L200 50 A150 150 0 0 0 176.5 51.8 Z" />
          <line className="su-sweep-line" x1="200" y1="200" x2="200" y2="50" />
        </g>

        <path className="su-inner" pathLength="1" d="M200 94.7 A105.3 105.3 0 0 1 200 305.3 A105.3 105.3 0 0 1 200 94.7" />
        <path className="su-tri" pathLength="1" d="M200 120 L273.4 248.5 L126.6 248.5 Z" />

        <circle className="su-ping su-p1" cx="200" cy="200" r="27.5" vectorEffect="non-scaling-stroke" />
        <circle className="su-ping su-p2" cx="200" cy="200" r="27.5" vectorEffect="non-scaling-stroke" />
        <circle className="su-dot" cx="200" cy="200" r="27.5" />
      </svg>

      <div className="su-wm" aria-hidden="true">
        <i className="su-spot" />
        {LETTERS.map((letter, index) => (
          <span key={index} style={{ ['--i' as string]: index }}>{letter}</span>
        ))}
      </div>

      <div className="su-bar" aria-hidden="true">
        <i />
      </div>
    </div>
  );
};

export default StartupSplash;
