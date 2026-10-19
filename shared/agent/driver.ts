/**
 * Which way the board drives OpenCode: the `opencode acp` child it has always
 * started, or OpenCode 2's background service (`opencode service`).
 *
 * The service runs turns in a process the board does not own, so a turn keeps
 * going when the board restarts and the board picks it back up on boot — see
 * `docs/opencode2-background-turns.md`. The child is still what 1.x has, what
 * a stand-in agent (`ACP_COMMAND`, the tests' fake agent) speaks, and what a
 * user can force from Settings if the service misbehaves for them.
 */

export type OpencodeDriver = 'service' | 'acp';

export interface DriverInputs {
  /** `ACP_COMMAND`: an agent other than the OpenCode the setup found. */
  acpCommand?: string;
  /** `opencodeDriver` from the board's setup file. */
  configured?: OpencodeDriver;
  /** The OpenCode's major version; undefined when it would not say. */
  major?: number;
}

export function chooseDriver({ acpCommand, configured, major }: DriverInputs): OpencodeDriver {
  if (acpCommand?.trim()) return 'acp';
  if (configured === 'acp') return 'acp';
  // An OpenCode that does not say its version is treated as 1.x everywhere
  // else too: the child works on every version, the service only on 2.
  return major !== undefined && major >= 2 ? 'service' : 'acp';
}

/** `2.0.24` → 2. */
export function majorOf(version: string | undefined): number | undefined {
  const major = Number(/^(\d+)\./.exec(version ?? '')?.[1]);
  return Number.isInteger(major) ? major : undefined;
}
