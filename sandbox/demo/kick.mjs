/**
 * Starts the demo's live turns once the board is up: the tasks listed in
 * /sandbox/demo-turns.json get a prompt, so the screenshots have work running
 * and one agent waiting on a permission request (see ACP_FAKE_ASK_SESSIONS).
 */
/* global fetch */
import fs from 'fs';

const API = `http://127.0.0.1:${process.env.PORT || 3001}`;
const turns = JSON.parse(fs.readFileSync('/sandbox/demo-turns.json', 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${API}/api/board`)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 120) throw new Error('[demo] The board never came up');
  await sleep(1000);
}

for (const { taskId, prompt } of turns) {
  const res = await fetch(`${API}/api/tasks/${taskId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  console.log(`[demo] ${taskId}: ${res.status}`);
}
