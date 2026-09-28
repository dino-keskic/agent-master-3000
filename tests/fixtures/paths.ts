import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Where the fixtures are on disk, for the tests that hand a fixture's path to
 * something outside the test — a child process, or `$PATH`. Tests sit at
 * varying depths under `tests/`, so they ask here rather than walk up.
 */

export const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The scripted ACP agent the transport and turn tests drive. */
export const FAKE_AGENT = path.join(FIXTURES_DIR, 'fakeAgent.mjs');
