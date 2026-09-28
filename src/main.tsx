import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { App } from './app/App';
import { registerNotificationWorker } from './app/notifications/desktop';
import { takeTokenParam, tokenCookie } from '../shared/http/requestGuard';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './index.css';

/*
 * `defaultColorScheme="auto"` means a first visit follows the OS; the header's
 * toggle then stores an explicit choice. Mantine writes that choice to
 * `data-mantine-color-scheme` on `<html>`, which is what `src/theme.css` reads,
 * so Mantine's components and the Tailwind side of the UI can never disagree
 * about which scheme is on.
 */
const theme = createTheme({
  // Tailwind's blue ramp, so a Mantine button and a Tailwind one are the same
  // colour; shade 6 is `--acc-tile` / light `--c-accent` in src/theme.css.
  colors: {
    accent: [
      '#eff6ff',
      '#dbeafe',
      '#bfdbfe',
      '#93c5fd',
      '#60a5fa',
      '#3b82f6',
      '#2563eb',
      '#1d4ed8',
      '#1e40af',
      '#1e3a8a'
    ]
  },
  primaryColor: 'accent',
  primaryShade: 6,
  fontFamily: "'Inter var', Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  defaultRadius: 'md',
  headings: { fontWeight: '600' }
});

/*
 * A board started with BOARD_TOKEN is opened once as `?token=…`. The token
 * moves into a SameSite=Strict cookie — which every API call and the socket
 * then carry — and out of the address bar and the history.
 */
function adoptTokenLink(): void {
  const { token, href } = takeTokenParam(window.location.href);
  if (href === window.location.href) return;
  if (token) document.cookie = tokenCookie(token, window.location.protocol === 'https:');
  window.history.replaceState(window.history.state, '', href);
}

adoptTokenLink();
registerNotificationWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" zIndex={1000} />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
