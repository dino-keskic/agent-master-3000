/** Two ways to get a second conversation on a task, and what to tell the user about each. */

export type SessionStartMode = 'fork' | 'new';

export const MODE_COPY: Record<SessionStartMode, { title: string; help: string; action: string }> = {
  fork: {
    title: 'Fork this session',
    help:
      'Copies the conversation so far into a new session and asks your question there. ' +
      'The copy knows everything the original knows; the original is left untouched and keeps running.',
    action: 'Start fork'
  },
  new: {
    title: 'New session',
    help:
      'Starts an empty session on this task and makes it the one follow-ups go to. ' +
      'It can run in another project than the rest of the task.',
    action: 'Start session'
  }
};
