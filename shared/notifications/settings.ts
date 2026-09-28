import { NotificationSettings } from '../types.js';

/**
 * Which events the user wants to hear about, and the one rule every
 * notification passes through before it is raised.
 */

/**
 * Off until the user asks for it: a page that raises a permission prompt on
 * load is user-hostile, and the prompt can only be spent once.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  awaitingInput: true,
  turnComplete: true,
  error: true,
  onlyWhenUnfocused: true,
  sound: false
};

/** The three things that stall progress when nobody is looking at the board. */
export type NotificationEvent = 'awaiting_input' | 'turn_complete' | 'error';

/** Fills the gaps left by a board saved before notifications existed. */
export function resolveNotificationSettings(
  settings?: Partial<NotificationSettings>
): NotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...settings };
}

/** Which per-event toggle governs which event. */
type EventToggle = 'awaitingInput' | 'turnComplete' | 'error';

const EVENT_TOGGLE: Record<NotificationEvent, EventToggle> = {
  awaiting_input: 'awaitingInput',
  turn_complete: 'turnComplete',
  error: 'error'
};

/** The per-event switches, in the order the settings popover lists them. */
export const NOTIFICATION_EVENT_TOGGLES: {
  event: NotificationEvent;
  setting: EventToggle;
  label: string;
  description: string;
}[] = [
  {
    event: 'awaiting_input',
    setting: 'awaitingInput',
    label: 'Needs your answer',
    description: 'A permission request or a question is holding the turn open.'
  },
  {
    event: 'turn_complete',
    setting: 'turnComplete',
    label: 'Turn finished',
    description: 'The agent stopped on its own.'
  },
  {
    event: 'error',
    setting: 'error',
    label: 'Turn failed',
    description: 'The agent reported an error.'
  }
];

/**
 * The one decision every notification passes through. Kept free of the browser
 * so the rule — and the "not while I am looking at it" default — is testable.
 */
export function shouldNotify(
  event: NotificationEvent,
  settings: Partial<NotificationSettings> | undefined,
  documentFocused: boolean
): boolean {
  const resolved = resolveNotificationSettings(settings);
  if (!resolved.enabled) return false;
  // The user is watching the board and probably caused this a moment ago.
  if (resolved.onlyWhenUnfocused && documentFocused) return false;
  return resolved[EVENT_TOGGLE[event]];
}
