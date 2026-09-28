import test, { after } from 'node:test';
import assert from 'node:assert';
import { TaskStore } from '../../../server/board/taskStore.js';
import { freshStore } from '../../fixtures/taskStore.js';

/**
 * A task can have several conversations at once. These cover which one
 * follow-ups go to, what happens to the one it replaces, and how the card
 * summarises the run state of them all.
 */

const { store, file, cleanup } = freshStore('sessions');
after(cleanup);

const ask = (requestId: string) => ({
  type: 'question' as const,
  requestId,
  askedAt: 1,
  message: 'go on?',
  mode: 'form' as const,
  fields: []
});

test('retiring a session takes its run state with it', () => {
  const task = store.createTask({ title: 'Two stages', prompt: 'go' });
  store.linkSession(task.id, {
    sessionId: 'ses_first',
    title: 'First',
    kind: 'main',
    origin: 'initial',
    primary: true
  });
  store.setSessionRunState(task.id, 'ses_first', 'running');
  assert.strictEqual(store.getTask(task.id)?.runState, 'running');

  // A new session takes over. The old one is history — nothing polls it any
  // more, so anything it was still claiming would never be corrected.
  store.linkSession(task.id, {
    sessionId: 'ses_second',
    title: 'Second',
    kind: 'main',
    origin: 'new',
    primary: true,
    supersedes: 'ses_first'
  });

  const state = store.getTask(task.id)!;
  const retired = state.sessions?.find((sn) => sn.sessionId === 'ses_first');
  assert.ok(retired?.archivedAt, 'the superseded session is archived');
  assert.strictEqual(retired?.runState, 'idle');
  assert.strictEqual(state.runState, 'idle', 'the card follows the session it retired');
});

test('addLinkedSession records main, btw, and stage sessions', () => {
  const task = store.createTask({ title: 'Multi-Session Task', prompt: 'Initial task' });
  assert.deepStrictEqual(task.sessions, []);

  const updated = store.addLinkedSession(task.id, {
    sessionId: 'ses_main_1',
    title: 'Main Flow',
    kind: 'main',
    createdAt: 1000
  });
  assert.strictEqual(updated?.sessions?.length, 1);
  assert.strictEqual(updated?.sessions?.[0]?.sessionId, 'ses_main_1');
  assert.strictEqual(updated?.sessions?.[0]?.kind, 'main');

  const withBtw = store.addLinkedSession(task.id, {
    sessionId: 'ses_btw_1',
    title: 'Side Question about DB',
    kind: 'btw',
    createdAt: 2000,
    prompt: 'How is the schema?'
  });
  assert.strictEqual(withBtw?.sessions?.length, 2);
  assert.strictEqual(withBtw?.sessions?.[1]?.kind, 'btw');
  assert.strictEqual(withBtw?.sessions?.[1]?.title, 'Side Question about DB');
});

test('switchActiveSession changes activeSessionId', () => {
  const task = store.createTask({ title: 'Switch Test', prompt: 'p' });
  store.addLinkedSession(task.id, { sessionId: 'ses_1', title: 'Session 1', kind: 'main', createdAt: 1 });
  store.addLinkedSession(task.id, { sessionId: 'ses_2', title: 'Session 2', kind: 'btw', createdAt: 2 });

  assert.strictEqual(store.switchActiveSession(task.id, 'ses_2')?.activeSessionId, 'ses_2');
});

test('archiveStageSession turns the current session into a stage archive', () => {
  const task = store.createTask({ title: 'Stage Task', prompt: 'p', columnId: 'plan' });
  store.updateTask(task.id, { sessionId: 'ses_plan_100' });

  const archived = store.archiveStageSession(task.id, 'plan');
  assert.strictEqual(archived?.sessionId, undefined);
  assert.ok(
    archived?.sessions?.some(
      (s) => s.sessionId === 'ses_plan_100' && s.kind === 'stage' && s.stageColumnId === 'plan'
    )
  );
});

test('archiveStageSession leaves nothing running behind', () => {
  const task = store.createTask({ title: 'Stage Reset', prompt: 'p', columnId: 'plan' });
  store.updateTask(task.id, { sessionId: 'ses_stage' });
  store.setSessionRunState(task.id, 'ses_stage', 'running');

  const archived = store.archiveStageSession(task.id, 'plan');
  const link = archived?.sessions?.find((s) => s.sessionId === 'ses_stage');
  assert.strictEqual(archived?.sessionId, undefined);
  assert.strictEqual(link?.kind, 'stage');
  assert.strictEqual(link?.runState, 'idle');
  assert.ok(link?.archivedAt);
  assert.strictEqual(archived?.runState, 'idle');
});

test('per-session run states aggregate onto the task', () => {
  const task = store.createTask({ title: 'Concurrent Task', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_main' });
  store.linkSession(task.id, { sessionId: 'ses_main', title: 'Main', kind: 'main', origin: 'initial', primary: true });
  store.linkSession(task.id, {
    sessionId: 'ses_fork',
    title: 'Fork',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'ses_main',
    primary: false
  });

  const running = store.setSessionRunState(task.id, 'ses_fork', 'running');
  assert.strictEqual(running?.runState, 'running', 'a running fork makes the card running');
  assert.strictEqual(running?.sessions?.find((s) => s.sessionId === 'ses_main')?.runState, undefined);

  // Both busy: the one blocking on a human is what the card must advertise.
  store.setSessionRunState(task.id, 'ses_main', 'running');
  const blocked = store.setSessionPendingRequest(task.id, 'ses_fork', {
    type: 'question',
    requestId: 'req-1',
    askedAt: 1,
    message: 'Which branch?',
    mode: 'form',
    fields: []
  });
  assert.strictEqual(blocked?.runState, 'awaiting_input');
  assert.strictEqual(blocked?.pendingRequest?.requestId, 'req-1');

  // Finishing the fork must not idle the main session that is still working.
  store.setSessionPendingRequest(task.id, 'ses_fork', undefined);
  const afterFork = store.setSessionRunState(task.id, 'ses_fork', 'idle');
  assert.strictEqual(afterFork?.runState, 'running');
  assert.strictEqual(afterFork?.pendingRequest, undefined);

  assert.strictEqual(store.setSessionRunState(task.id, 'ses_main', 'idle')?.runState, 'idle');
});

test('a legacy task gets a session link on its first per-session write', () => {
  const task = store.createTask({ title: 'Legacy Task', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_legacy', sessions: undefined });

  const updated = store.setSessionRunState(task.id, 'ses_legacy', 'running');
  const link = updated?.sessions?.find((s) => s.sessionId === 'ses_legacy');
  assert.strictEqual(link?.kind, 'main');
  assert.strictEqual(link?.runState, 'running');
  assert.strictEqual(updated?.runState, 'running');
});

test('linkSession promotes and archives the session it replaces', () => {
  const task = store.createTask({ title: 'Continue Elsewhere', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_first' });
  store.linkSession(task.id, { sessionId: 'ses_first', title: 'First', kind: 'main', origin: 'initial', primary: true });

  const continued = store.linkSession(task.id, {
    sessionId: 'ses_second',
    title: 'Fresh start',
    kind: 'main',
    origin: 'new',
    primary: true
  });
  assert.strictEqual(continued?.sessionId, 'ses_second', 'follow-ups now target the new session');
  assert.strictEqual(continued?.activeSessionId, 'ses_second');
  assert.ok(
    continued?.sessions?.find((s) => s.sessionId === 'ses_first')?.archivedAt,
    'the old one is archived, not dropped'
  );
  assert.strictEqual(continued?.sessions?.find((s) => s.sessionId === 'ses_second')?.archivedAt, undefined);

  // A fork must never steal the primary slot.
  const forked = store.linkSession(task.id, {
    sessionId: 'ses_fork',
    title: 'BTW',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'ses_second',
    primary: false
  });
  assert.strictEqual(forked?.sessionId, 'ses_second');
  assert.strictEqual(forked?.sessions?.find((s) => s.sessionId === 'ses_fork')?.forkedFrom, 'ses_second');
});

test('a handover that already moved task.sessionId still needs `supersedes`', () => {
  // `session_bound` moves task.sessionId onto the new session before the link
  // is written, so an explicit `supersedes` is the only way to still archive
  // the session that was replaced.
  const raced = store.createTask({ title: 'Raced Handover', prompt: 'p' });
  store.updateTask(raced.id, { sessionId: 'ses_old' });
  store.linkSession(raced.id, { sessionId: 'ses_old', title: 'Old', kind: 'main', origin: 'initial', primary: true });
  store.updateTask(raced.id, { sessionId: 'ses_bound_first' });
  const handedOver = store.linkSession(raced.id, {
    sessionId: 'ses_bound_first',
    title: 'Fresh',
    kind: 'main',
    origin: 'new',
    primary: true,
    supersedes: 'ses_old'
  });
  assert.ok(handedOver?.sessions?.find((s) => s.sessionId === 'ses_old')?.archivedAt);
  assert.strictEqual(handedOver?.sessions?.find((s) => s.sessionId === 'ses_bound_first')?.archivedAt, undefined);
});

test('a side session handed over to a copy retires, and the main line stays', () => {
  const task = store.createTask({ title: 'Side Handover', prompt: 'p' });
  store.linkSession(task.id, { sessionId: 'ses_main', title: 'Main', kind: 'main', origin: 'initial', primary: true });
  store.linkSession(task.id, { sessionId: 'ses_side', title: 'Side', kind: 'btw', origin: 'fork', primary: false });
  const handedOver = store.linkSession(task.id, {
    sessionId: 'ses_side_copy',
    title: 'Side',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'ses_side',
    primary: false,
    supersedes: 'ses_side'
  });
  assert.ok(handedOver?.sessions?.find((s) => s.sessionId === 'ses_side')?.archivedAt);
  assert.strictEqual(handedOver?.sessions?.find((s) => s.sessionId === 'ses_main')?.archivedAt, undefined);
  assert.strictEqual(handedOver?.sessionId, 'ses_main');
});

test('setPrimarySession promotes a fork without archiving the old main', () => {
  const task = store.createTask({ title: 'Promote', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_main' });
  store.linkSession(task.id, { sessionId: 'ses_main', title: 'Main', kind: 'main', origin: 'initial', primary: true });
  store.linkSession(task.id, { sessionId: 'ses_fork', title: 'Fork', kind: 'btw', origin: 'fork', primary: false });

  const promoted = store.setPrimarySession(task.id, 'ses_fork');
  assert.strictEqual(promoted?.sessionId, 'ses_fork');
  assert.strictEqual(promoted?.sessions?.find((s) => s.sessionId === 'ses_main')?.archivedAt, undefined);
});

test('clearPendingRequests releases every blocked session', () => {
  const task = store.createTask({ title: 'Unblock All', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_a' });
  store.linkSession(task.id, { sessionId: 'ses_a', title: 'A', kind: 'main', origin: 'initial', primary: true });
  store.linkSession(task.id, { sessionId: 'ses_b', title: 'B', kind: 'btw', origin: 'fork', primary: false });
  store.setSessionPendingRequest(task.id, 'ses_a', ask('req-a'));
  store.setSessionPendingRequest(task.id, 'ses_b', ask('req-b'));

  const cleared = store.clearPendingRequests(task.id);
  assert.strictEqual(cleared?.pendingRequest, undefined);
  assert.strictEqual(cleared?.runState, 'idle');
  assert.ok(cleared?.sessions?.every((s) => !s.pendingRequest));
});

test('sessions recorded as running do not survive a restart', () => {
  const task = store.createTask({ title: 'Restart', prompt: 'p' });
  store.updateTask(task.id, { sessionId: 'ses_r' });
  store.linkSession(task.id, { sessionId: 'ses_r', title: 'R', kind: 'main', origin: 'initial', primary: true });
  store.setSessionRunState(task.id, 'ses_r', 'running');
  store.setSessionPendingRequest(task.id, 'ses_r', { ...ask('req-restart'), message: 'still there?' });
  store.flush();

  const reloaded = new TaskStore(file);
  const link = reloaded.getTask(task.id)?.sessions?.find((s) => s.sessionId === 'ses_r');
  assert.strictEqual(link?.runState, 'idle');
  assert.strictEqual(link?.pendingRequest, undefined);
  assert.strictEqual(reloaded.getTask(task.id)?.runState, 'idle');
});

test('an OpenCode title replaces a prompt title, but never a user edit', () => {
  const task = store.createTask({
    title: 'Please fix the navbar overflow on mobile',
    prompt: 'Please fix the navbar overflow on mobile'
  });
  store.updateTask(task.id, { sessionId: 'ses_title' });
  store.linkSession(task.id, {
    sessionId: 'ses_title',
    title: 'Please fix the navbar overflow on mobile',
    kind: 'main',
    origin: 'initial',
    primary: true
  });

  const adopted = store.adoptSessionTitle(task.id, 'ses_title', 'Fix navbar overflow');
  assert.strictEqual(adopted?.title, 'Fix navbar overflow');
  assert.strictEqual(adopted?.sessions?.[0]?.title, 'Fix navbar overflow');
  assert.ok(!adopted?.titleLocked);

  store.updateTask(task.id, { title: 'Navbar WIP' });
  const ignored = store.adoptSessionTitle(task.id, 'ses_title', 'Something else');
  assert.strictEqual(store.getTask(task.id)?.title, 'Navbar WIP');
  assert.strictEqual(store.getTask(task.id)?.titleLocked, true);
  assert.strictEqual(ignored?.title, 'Navbar WIP');
  assert.strictEqual(ignored?.sessions?.[0]?.title, 'Something else');
});

test('a new main session does not rename a task its first session already named', () => {
  const task = store.createTask({ title: 'Tidy the auth middleware', prompt: 'Tidy the auth middleware' });
  store.updateTask(task.id, { sessionId: 'ses_first' });
  store.linkSession(task.id, { sessionId: 'ses_first', title: 'Tidy the auth middleware', kind: 'main', origin: 'initial', primary: true });
  assert.strictEqual(store.adoptSessionTitle(task.id, 'ses_first', 'Auth middleware cleanup')?.title, 'Auth middleware cleanup');

  store.linkSession(task.id, { sessionId: 'ses_fresh', title: 'New session', kind: 'main', origin: 'new', primary: true });
  const after = store.adoptSessionTitle(task.id, 'ses_fresh', 'Continue auth refactor');

  assert.strictEqual(store.getTask(task.id)?.title, 'Auth middleware cleanup');
  assert.strictEqual(after?.sessions?.find((s) => s.sessionId === 'ses_fresh')?.title, 'Continue auth refactor');
});

test('a session carried into the next column records the crossing', () => {
  const task = store.createTask({ title: 'One session, two stages', prompt: 'go' });
  store.linkSession(task.id, {
    sessionId: 'ses_carried',
    title: 'Investigate',
    kind: 'main',
    origin: 'initial',
    primary: true
  });

  const startedIn = store.getTask(task.id)?.columnId;
  store.moveTask(task.id, 'plan');
  store.moveTask(task.id, 'execute');

  const link = store.getTask(task.id)?.sessions?.find((s) => s.sessionId === 'ses_carried');
  assert.deepStrictEqual(
    link?.stages?.map((stage) => stage.columnId),
    [startedIn, 'plan', 'execute'],
    'a column that does not demand a fresh session still has to show up as its own phase'
  );
  assert.ok(link?.stages?.every((stage) => stage.at > 0));
  assert.strictEqual(link?.stageColumnId, 'execute', 'the stamp follows the task');
});

test('moving back into the column a session is already in records nothing', () => {
  const task = store.createTask({ title: 'Dragged out and back', prompt: 'go' });
  store.linkSession(task.id, {
    sessionId: 'ses_dragged',
    title: 'Work',
    kind: 'main',
    origin: 'initial',
    primary: true
  });

  store.moveTask(task.id, 'plan');
  const before = store.getTask(task.id)?.sessions?.[0]?.stages?.length;
  store.moveTask(task.id, 'plan');

  assert.strictEqual(store.getTask(task.id)?.sessions?.[0]?.stages?.length, before);
});

test('a retired session keeps the column it finished in', () => {
  const task = store.createTask({ title: 'Retired in plan', prompt: 'go' });
  store.linkSession(task.id, {
    sessionId: 'ses_retired',
    title: 'Planning',
    kind: 'main',
    origin: 'initial',
    primary: true
  });
  store.moveTask(task.id, 'plan');
  store.archiveStageSession(task.id, 'plan');
  store.moveTask(task.id, 'execute');

  // Its work is over; a later move is not more work for it to have done.
  const link = store.getTask(task.id)?.sessions?.find((s) => s.sessionId === 'ses_retired');
  assert.strictEqual(link?.stageColumnId, 'plan');
  assert.ok(!link?.stages?.some((stage) => stage.columnId === 'execute'));
});

test('a fork on another model keeps it to itself', () => {
  const task = store.createTask({ title: 'Picks', prompt: 'go', model: 'opencode/kimi-k3' });
  store.linkSession(task.id, {
    sessionId: 'ses_main',
    title: 'Main',
    kind: 'main',
    origin: 'initial',
    primary: true
  });
  store.linkSession(task.id, {
    sessionId: 'ses_fork',
    title: 'Side Chat',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'ses_main',
    chosen: { model: 'opencode/gpt-6-astra' },
    primary: false
  });

  const state = store.getTask(task.id)!;
  assert.strictEqual(state.model, 'opencode/kimi-k3', 'asking a side question does not re-model the task');
  const main = state.sessions?.find((link) => link.sessionId === 'ses_main');
  const fork = state.sessions?.find((link) => link.sessionId === 'ses_fork');
  assert.strictEqual(main?.chosen, undefined, 'the main conversation made no pick of its own');
  assert.strictEqual(main?.model, 'opencode/kimi-k3');
  assert.strictEqual(fork?.chosen?.model, 'opencode/gpt-6-astra');
  assert.strictEqual(fork?.model, 'opencode/gpt-6-astra', 'and that is what it will run as');
});

test('relinking a session keeps the pick it was started with', () => {
  const task = store.createTask({ title: 'Relink', prompt: 'go', model: 'opencode/kimi-k3' });
  store.linkSession(task.id, {
    sessionId: 'ses_kept',
    title: 'Side Chat',
    kind: 'btw',
    origin: 'fork',
    chosen: { model: 'opencode/gpt-6-astra' },
    primary: false
  });
  // Put back to work — by a column move, say — with nothing said about models.
  store.linkSession(task.id, {
    sessionId: 'ses_kept',
    title: 'Side Chat',
    kind: 'btw',
    origin: 'fork',
    primary: false
  });

  const link = store.getTask(task.id)!.sessions?.find((entry) => entry.sessionId === 'ses_kept');
  assert.strictEqual(link?.chosen?.model, 'opencode/gpt-6-astra');
});
