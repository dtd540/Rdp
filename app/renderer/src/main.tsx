import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isElectron } from './bridge';
import './styles.css';

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
