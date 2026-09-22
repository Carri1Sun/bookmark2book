import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './lib/i18n';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/badges.css';
import './styles/book.css';
import './styles/page-cards.css';

document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute(
    'content',
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
