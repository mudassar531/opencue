import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Overlay } from './overlay/Overlay';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('opencue: #root element not found in index.html');
}

// The same HTML powers both the main window and the overlay. The main
// process loads `?view=overlay` for the overlay BrowserWindow so we can
// pick the correct root component at boot.
const view = new URLSearchParams(window.location.search).get('view');
const RootComponent = view === 'overlay' ? Overlay : App;

// The body needs to be transparent for the overlay window so the rounded
// translucent card stands free; the main window keeps its slate background.
if (view === 'overlay') {
  document.body.classList.remove('bg-slate-950');
  document.body.classList.add('bg-transparent');
  document.documentElement.classList.add('bg-transparent');
}

createRoot(rootElement).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
