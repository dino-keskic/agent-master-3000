/**
 * Persistent OS notifications for Agent Master 3000.
 *
 * `new Notification()` from the page is silent on macOS when Chrome is in the
 * background. `registration.showNotification()` from this worker is what
 * actually lands in Notification Center while Chrome is in the background.
 * It does not call clients.claim(): controlling the page is what kept a
 * notification raised from the focused board from ever being drawn.
 * There is no fetch handler — this worker must not intercept Vite or the API.
 */
self.addEventListener('install', (event) => {
  // Without waitUntil the worker can sit in `waiting` forever, and then
  // showNotification never runs — the page falls back to `new Notification()`,
  // which macOS does not banner while Chrome is in the background.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openBoard(data));
});

async function openBoard(data) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'agent-master-3000:notification-click',
      taskId: data.taskId,
      sessionId: data.sessionId
    });
    if ('focus' in client) {
      await client.focus();
      return;
    }
  }
  const url = data.taskId ? `/?task=${encodeURIComponent(data.taskId)}` : '/';
  await self.clients.openWindow(url);
}
