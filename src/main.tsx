import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import { initThemeFromStorage } from '@/styles/theme';
import { App } from '@/App';

// 首屏前应用主题（避免深色主题闪烁）
initThemeFromStorage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
