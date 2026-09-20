import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/book.css';

document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute(
    'content',
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
