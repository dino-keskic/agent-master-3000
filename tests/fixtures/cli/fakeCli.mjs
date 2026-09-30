#!/usr/bin/env node
/**
 * Stand-ins for `acli` and `gh`, for exercising the mention lookups without an
 * account.
 *
 * The real CLIs are installed in the sandbox and deliberately signed out, and
 * the host's authenticated ones are off limits (see AGENTS.md) — so anything
 * that needs an answer back gets it from here. Put this directory first on
 * PATH and `server/mentions/` runs unchanged, all the way down to parsing
 * ADF and `gh pr checks` exiting non-zero while still printing its rows.
 *
 *   PATH="tests/fixtures/cli:$PATH"
 *
 * The fixtures are shaped around the parts that have actually broken: ADF that
 * is more than one paragraph, a comment that is only a screenshot, an HTML
 * comment in a PR body, and a check run with far more green than anyone wants
 * to read.
 */

const [, , tool, ...argv] = process.argv;

/** `--name value` or `--name=value`, the way the real CLIs' flag parser reads them. */
function flag(name) {
  const joined = argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function has(...names) {
  return names.every((name) => argv.includes(name));
}

/** Positional arguments — what is left once the flags and their values are gone. */
function positionals() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // After `--` everything is an argument, however it is spelled.
    if (arg === '--') {
      out.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      if (!arg.includes('=')) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function emit(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/* ---------------------------------- Jira --------------------------------- */

const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (...content) => ({ type: 'paragraph', content });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const li = (...content) => ({ type: 'listItem', content });

const JIRA = {
  'SANDBOX-1': {
    summary: 'Invoice editor drops line items',
    status: 'In Progress',
    issuetype: 'Bug',
    description: doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('What happens')] },
      p(
        t('Saving a plan from the '),
        t('editor', [{ type: 'strong' }]),
        t(' loses every unit past the tenth. Reported in '),
        t('the sync thread', [{ type: 'link', attrs: { href: 'https://example.invalid/thread' } }]),
        t('.')
      ),
      {
        type: 'bulletList',
        content: [
          li(p(t('Only on iOS.'))),
          li(p(t('Only when '), t('units.length > 10', [{ type: 'code' }]), t('.')))
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [t('{ "units": [] }')]
      }
    ),
    comments: [
      {
        author: { displayName: 'Ada Lovelace' },
        created: '2026-05-05T09:12:00.000+0200',
        // Only a screenshot. `comment list` returns this as an empty string.
        body: doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'abc', type: 'file' } }] })
      },
      {
        author: { displayName: 'Grace Hopper' },
        created: '2026-05-15T14:40:00.000+0200',
        body: doc(
          p(t('Repro is in '), t('PlanEditor.tsx', [{ type: 'code' }]), t('. Two things to check:')),
          {
            type: 'orderedList',
            content: [li(p(t('The cap in the reducer.'))), li(p(t('The optimistic write.')))]
          }
        )
      }
    ]
  },
  'SANDBOX-2': {
    summary: 'Sync retries forever after a 409',
    status: 'To Do',
    issuetype: 'Task',
    description: doc(p(t('The backoff never gives up.'))),
    comments: []
  }
};

function jiraItem(key) {
  const row = JIRA[key];
  if (!row) fail(`acli: no work item ${key}`);
  return {
    key,
    fields: {
      summary: row.summary,
      status: { name: row.status },
      issuetype: { name: row.issuetype },
      description: row.description,
      comment: { comments: row.comments, total: row.comments.length }
    }
  };
}

function acli() {
  if (!has('jira', 'workitem')) fail(`acli: unsupported command: ${argv.join(' ')}`);

  if (argv.includes('search')) {
    const jql = flag('--jql') || '';
    const key = /key = "([^"]+)"/.exec(jql)?.[1];
    const term = /(?:summary|text) ~ "([^"*]*)/.exec(jql)?.[1];
    const keys = Object.keys(JIRA).filter((candidate) => {
      if (key) return candidate === key;
      if (term) {
        const hay = `${candidate} ${JIRA[candidate].summary}`.toLowerCase();
        return hay.includes(term.toLowerCase());
      }
      return true;
    });
    // `search` returns the fields it was asked for and nothing heavier.
    return emit(keys.map((k) => {
      const { fields } = jiraItem(k);
      return { key: k, fields: { summary: fields.summary, status: fields.status, issuetype: fields.issuetype } };
    }));
  }

  if (argv.includes('view')) {
    const key = positionals().filter((arg) => !['jira', 'workitem', 'view'].includes(arg))[0];
    if (!key) fail('acli: view needs a key');
    const wanted = (flag('--fields') || '').split(',').map((f) => f.trim()).filter(Boolean);
    const item = jiraItem(key);
    if (wanted.length === 0) return emit(item);
    const fields = {};
    for (const name of wanted) {
      if (name in item.fields) fields[name] = item.fields[name];
    }
    return emit({ key, fields });
  }

  fail(`acli: unsupported command: ${argv.join(' ')}`);
}

/* --------------------------------- GitHub -------------------------------- */

const GITHUB = {
  'acme/web-app#9404': {
    title: 'Fix the plan editor unit cap',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'fix/plan-editor-cap',
    baseRefName: 'main',
    body: '<!-- generated by the PR template, do not edit -->\nDrops the cap in the reducer.\n\n- [x] Tested on iOS\n- [ ] Changelog',
    reviews: [
      {
        author: { login: 'grace-h' },
        state: 'CHANGES_REQUESTED',
        createdAt: '2026-05-16T08:00:00Z',
        body: 'The optimistic write still needs a guard — see `usePlanDraft`.'
      }
    ],
    comments: [
      {
        author: { login: 'ada-l' },
        createdAt: '2026-05-16T10:30:00Z',
        body: 'Reproduced on a device. Numbers:\n\n| units | saved |\n| --- | --- |\n| 12 | 10 |'
      }
    ],
    checks: [
      { name: 'unit', workflow: 'CI', state: 'FAILURE', bucket: 'fail', link: 'https://example.invalid/run/1', description: '2 tests failed' },
      { name: 'e2e', workflow: 'CI', state: 'IN_PROGRESS', bucket: 'pending', link: 'https://example.invalid/run/2', description: '' },
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `lint-${i + 1}`,
        workflow: 'CI',
        state: 'SUCCESS',
        bucket: 'pass',
        link: `https://example.invalid/run/${i + 3}`,
        description: ''
      }))
    ]
  },
  'acme/agent-master-3000#12': {
    title: 'Link tickets with @ instead of pasting them',
    state: 'OPEN',
    isDraft: true,
    headRefName: 'feat/mentions',
    baseRefName: 'master',
    body: 'Draft.',
    reviews: [],
    comments: [],
    checks: []
  }
};

/**
 * Workflow runs, for `gh run view`. One red run with a matrix leg that failed
 * and plenty that did not, and a log with the colour codes, tab-separated
 * columns and timestamps the real one prints.
 */
const RUNS = {
  'acme/web-app#777': {
    databaseId: 777,
    name: 'CI',
    workflowName: 'CI',
    displayTitle: 'Fix the plan editor unit cap',
    status: 'completed',
    conclusion: 'failure',
    event: 'pull_request',
    headBranch: 'fix/unit-cap',
    headSha: '0123456789abcdef',
    attempt: 1,
    url: 'https://github.com/acme/web-app/actions/runs/777',
    jobs: [
      { databaseId: 1, name: 'lint', status: 'completed', conclusion: 'success', steps: [{ number: 1, name: 'eslint', status: 'completed', conclusion: 'success' }] },
      {
        databaseId: 2,
        name: 'test (node 22)',
        status: 'completed',
        conclusion: 'failure',
        startedAt: '2026-09-30T10:00:00Z',
        completedAt: '2026-09-30T10:03:10Z',
        url: 'https://github.com/acme/web-app/actions/runs/777/job/2',
        steps: [
          { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
          { number: 4, name: 'npm test', status: 'completed', conclusion: 'failure' },
          { number: 5, name: 'Upload coverage', status: 'completed', conclusion: 'skipped' }
        ]
      },
      { databaseId: 3, name: 'test (node 20)', status: 'completed', conclusion: 'success', steps: [] }
    ],
    logs: {
      2: [
        'test (node 22)\tnpm test\t2026-09-30T10:02:58.1000000Z \u001b[31m✖ unit cap clamps to the plan maximum\u001b[0m',
        'test (node 22)\tnpm test\t2026-09-30T10:02:58.2000000Z   AssertionError: expected 12 to equal 10',
        'test (node 22)\tnpm test\t2026-09-30T10:02:58.3000000Z   at tests/planEditor.test.ts:41:10'
      ].join('\n')
    }
  }
};

function ghRun() {
  const repo = flag('--repo');
  const jobId = flag('--job');
  const run = jobId
    ? Object.values(RUNS).find((row) => row.jobs.some((job) => String(job.databaseId) === jobId))
    : RUNS[ghKey(repo, positionals().filter((arg) => !['run', 'view'].includes(arg))[0])];
  if (!run) fail(`gh: no run ${repo} ${jobId ? `job ${jobId}` : ''}`);
  if (argv.includes('--log-failed')) {
    process.stdout.write(`${run.logs[jobId] || ''}\n`);
    process.exit(0);
  }
  const wanted = (flag('--json') || '').split(',').map((f) => f.trim()).filter(Boolean);
  const out = {};
  for (const name of wanted) {
    if (name in run && name !== 'logs') out[name] = run[name];
  }
  return emit(out);
}

function ghKey(repo, number) {
  return `${repo}#${number}`;
}

function gh() {
  if (has('search', 'prs')) {
    const term = positionals().filter((arg) => !['search', 'prs'].includes(arg))[0];
    const rows = Object.entries(GITHUB)
      .filter(([key, pr]) => !term || `${key} ${pr.title}`.toLowerCase().includes(term.toLowerCase()))
      .map(([key, pr]) => {
        const [repo, number] = key.split('#');
        return {
          number: Number(number),
          title: pr.title,
          url: `https://github.com/${repo}/pull/${number}`,
          repository: { name: repo.split('/')[1], nameWithOwner: repo }
        };
      });
    return emit(rows);
  }

  if (has('run', 'view')) return ghRun();

  if (!argv.includes('pr')) fail(`gh: unsupported command: ${argv.join(' ')}`);

  const repo = flag('--repo');
  const number = positionals().filter((arg) => !['pr', 'view', 'checks'].includes(arg))[0];
  const pr = GITHUB[ghKey(repo, number)];
  if (!pr) fail(`gh: no pull request ${repo}#${number}`);

  if (argv.includes('checks')) {
    // The real thing exits non-zero when anything is red or still running, and
    // prints the rows anyway. mentions.ts reads stdout off the failure.
    const bad = pr.checks.some((check) => check.bucket !== 'pass' && check.bucket !== 'skipping');
    return emit(pr.checks, bad ? 8 : 0);
  }

  if (argv.includes('view')) {
    const wanted = (flag('--json') || '').split(',').map((f) => f.trim()).filter(Boolean);
    const all = {
      title: pr.title,
      body: pr.body,
      state: pr.state,
      isDraft: pr.isDraft,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      comments: pr.comments,
      reviews: pr.reviews
    };
    const out = {};
    for (const name of wanted.length ? wanted : Object.keys(all)) {
      if (name in all) out[name] = all[name];
    }
    return emit(out);
  }

  fail(`gh: unsupported command: ${argv.join(' ')}`);
}

if (tool === 'acli') acli();
else if (tool === 'gh') gh();
else fail(`fakeCli: unknown tool ${tool}`);
