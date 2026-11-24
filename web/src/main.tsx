import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { legacyBoardHash } from './projectNav';
import './index.css';
import { startThemeSync } from './userDefaultsTheme';

// /dispatch (#731, #773): the 세션 보드 lives in the app shell in every mode, so old links go to `/#board…`.
const isDispatch = /^\/dispatch(\/|$)/.test(window.location.pathname);

// The theme follows ~/.dispatch/drawing.json and is written back to it (E555).
startThemeSync();

const root = createRoot(document.getElementById('root')!);

if (isDispatch) location.replace(`/${legacyBoardHash(location.hash)}`);
else
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
