import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isElectron } from './bridge';
import './styles.css';

// The main process hides the native title bar on Windows and overlays the
// min/max/close buttons on our topbar. Flag that so the stylesheet can inset the
// topbar's right gutter by the width those buttons occupy. Off Windows (and in the
// browser preview) the native bar is still there, so no inset is wanted.
if (isElectron && navigator.userAgent.includes('Windows')) {
  document.documentElement.classList.add('titlebar-overlay');
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
