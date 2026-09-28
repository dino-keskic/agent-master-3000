import { ModelKey } from './models.js';

/**
 * What is on the demo board: each task, the column it sits in, the sessions it
 * has had, and the lines of conversation that end each session. Earlier turns
 * are generated from `files` and `testCmd` (see `turns.ts`); only the tail is
 * written out, because the tail is what the drawer opens on.
 */

export type RepoKey = 'storefront' | 'payments' | 'mobile' | 'pagination';

export interface ScriptedTurn {
  user?: string;
  reasoning?: string;
  tools?: { tool: string; input: Record<string, unknown>; output: string }[];
  reply: string;
}

export interface DemoSession {
  key: string;
  kind: 'main' | 'btw' | 'stage' | 'subagent';
  title: string;
  model?: ModelKey;
  agent?: string;
  /** Days ago the session started and last worked. */
  from: number;
  to: number;
  turns: number;
  stageColumnId?: string;
  summary?: { files: number; additions: number; deletions: number };
  tail?: ScriptedTurn[];
}

export interface DemoTask {
  number: number;
  title: string;
  prompt: string;
  columnId: 'backlog' | 'plan' | 'execute' | 'deliver';
  repo: RepoKey;
  model: ModelKey;
  agent: string;
  thinking: 'low' | 'medium' | 'high';
  createdDaysAgo: number;
  files: string[];
  testCmd: string;
  sessions: DemoSession[];
  links?: { url: string; title: string; kind: 'pr' | 'issue' | 'doc'; ref: string; state?: 'open' | 'draft' | 'merged'; label?: string }[];
  /** Kicked off after the board is up: `run` streams, `ask` stops on a permission request. */
  live?: { mode: 'run' | 'ask'; prompt: string };
}

const TEST_OK = (files: number, tests: number, ms: number) =>
  `Test Files  ${files} passed (${files})\n     Tests  ${tests} passed (${tests})\n  Start at  10:42:07\n  Duration  ${(ms / 1000).toFixed(2)}s`;

export const TASKS: DemoTask[] = [
  {
    number: 101,
    title: 'Fix currency rounding in invoice PDFs',
    prompt: 'Invoices for JPY and KWD customers show the wrong number of decimals. Use the currency\'s minor units instead of assuming 2, and add tests for JPY, EUR and KWD.',
    columnId: 'deliver', repo: 'payments', model: 'sonnet', agent: 'build', thinking: 'medium', createdDaysAgo: 11,
    files: ['src/invoices/pdf.ts', 'src/invoices/pdf.test.ts', 'src/money/minorUnits.ts'],
    testCmd: 'pnpm vitest run src/invoices',
    sessions: [{
      key: 'main', kind: 'main', title: 'Currency minor units in invoice PDFs', from: 10, to: 8, turns: 14,
      summary: { files: 3, additions: 48, deletions: 19 },
      tail: [{
        user: 'Looks good. Open the PR.',
        tools: [{ tool: 'bash', input: { command: 'gh pr create --fill --base main', description: 'Open the pull request' }, output: 'https://github.com/northwind-labs/payments-api/pull/214' }],
        reply: 'Opened **northwind-labs/payments-api#214**. JPY now renders `¥1,250`, KWD `KD 12.500`, and EUR is unchanged. 23 tests pass.'
      }]
    }],
    links: [{ url: 'https://github.com/northwind-labs/payments-api/pull/214', title: 'Use ISO 4217 minor units in invoice PDFs', kind: 'pr', ref: 'northwind-labs/payments-api#214', state: 'merged', label: 'Merged' }]
  },
  {
    number: 104,
    title: 'Upgrade to React 19 and fix hydration warnings',
    prompt: 'Upgrade storefront-web to React 19. Fix every hydration warning in the SSR build and replace the deprecated `ReactDOM.render` / `defaultProps` usages.',
    columnId: 'deliver', repo: 'storefront', model: 'opus', agent: 'build', thinking: 'high', createdDaysAgo: 9,
    files: ['package.json', 'src/entry-server.tsx', 'src/entry-client.tsx', 'src/components/PriceTag.tsx', 'src/components/ProductCard.tsx'],
    testCmd: 'pnpm vitest run && pnpm build',
    sessions: [
      { key: 'plan', kind: 'stage', title: 'Plan the React 19 upgrade', agent: 'plan', from: 9, to: 9, turns: 6, stageColumnId: 'plan' },
      {
        key: 'main', kind: 'main', title: 'React 19 upgrade', from: 8, to: 2, turns: 24, stageColumnId: 'execute',
        summary: { files: 27, additions: 412, deletions: 389 },
        tail: [{
          user: 'Run the full build once more and summarise what changed for the PR description.',
          tools: [
            { tool: 'bash', input: { command: 'pnpm vitest run && pnpm build', description: 'Tests and production build' }, output: `${TEST_OK(48, 312, 14820)}\n\nvite v7.1.3 building SSR bundle for production...\n✓ 1204 modules transformed.\ndist/server/entry-server.js  412.08 kB\n✓ built in 9.41s` },
            { tool: 'task', input: { description: 'Review the React 19 diff', subagent_type: 'reviewer' }, output: 'No blocking issues. Two nits: prefer `use()` over the ad-hoc suspense wrapper in ProductCard; drop the stale `@types/react-dom` override.' }
          ],
          reply: '## React 19 upgrade\n\n- `react`/`react-dom` 18.3 → 19.1, `@types/*` updated\n- Replaced `ReactDOM.render` with `createRoot` / `hydrateRoot`\n- Removed `defaultProps` from 14 function components (default parameters instead)\n- Fixed 9 hydration mismatches — all were `Date.now()` / `Math.random()` in render or locale-dependent price formatting\n\nBuild is clean, 312 tests pass, zero hydration warnings in the SSR smoke run. The reviewer subagent had two nits; both are fixed.'
        }]
      },
      { key: 'review', kind: 'subagent', title: 'Review the React 19 diff (@reviewer subagent)', model: 'sonnet', agent: 'reviewer', from: 2, to: 2, turns: 5 }
    ],
    links: [{ url: 'https://github.com/northwind-labs/storefront-web/pull/482', title: 'Upgrade to React 19', kind: 'pr', ref: 'northwind-labs/storefront-web#482', state: 'open', label: 'In review' }]
  },
  {
    number: 109,
    title: 'Exponential backoff for payout worker retries',
    prompt: 'The payout worker retries failed transfers immediately and hammers the bank API during outages. Add exponential backoff with jitter, cap at 6 attempts, and send exhausted payouts to the dead-letter queue.',
    columnId: 'deliver', repo: 'payments', model: 'gpt6', agent: 'build', thinking: 'medium', createdDaysAgo: 6,
    files: ['src/payouts/worker.ts', 'src/payouts/backoff.ts', 'src/payouts/worker.test.ts'],
    testCmd: 'pnpm vitest run src/payouts',
    sessions: [{
      key: 'main', kind: 'main', title: 'Backoff with jitter for payout retries', from: 6, to: 3, turns: 11,
      summary: { files: 4, additions: 132, deletions: 27 },
      tail: [{
        user: 'Open it as a draft, I want Priya to look at the DLQ part first.',
        reply: 'Draft PR **northwind-labs/payments-api#221** is up. Delays are 2s, 4s, 8s, 16s, 32s with ±20% jitter; the sixth failure goes to `payouts.dlq` with the last error attached.'
      }]
    }],
    links: [{ url: 'https://github.com/northwind-labs/payments-api/pull/221', title: 'Exponential backoff for payout retries', kind: 'pr', ref: 'northwind-labs/payments-api#221', state: 'draft', label: 'Draft' }]
  },
  {
    number: 108,
    title: 'Paginate order history with a cursor API',
    prompt: 'Order history loads every order a customer ever placed. Paginate it against the new /v3/orders cursor endpoint, 20 per page, with a "Load more" button that keeps scroll position.',
    columnId: 'execute', repo: 'pagination', model: 'opus', agent: 'build', thinking: 'high', createdDaysAgo: 4,
    files: ['src/api/orders.ts', 'src/pages/OrderHistory.tsx', 'src/hooks/usePagedOrders.ts', 'migrations/0042_orders_keyset.sql'],
    testCmd: 'pnpm vitest run src/api src/hooks',
    sessions: [
      {
        key: 'main', kind: 'main', title: 'Cursor pagination for order history', from: 4, to: 0.05, turns: 16,
        summary: { files: 4, additions: 214, deletions: 58 },
        tail: [
          {
            user: 'Use keyset pagination on (created_at, id) instead of OFFSET — the orders table is 40M rows in prod.',
            reasoning: 'OFFSET scans and discards every skipped row, so page 50 costs 50× page 1 on a 40M-row table. A keyset cursor on (created_at DESC, id DESC) is constant-cost as long as there is a matching composite index; id breaks ties between orders placed in the same millisecond.',
            tools: [
              { tool: 'read', input: { filePath: 'src/api/orders.ts' }, output: 'export async function listOrders(opts: { offset: number; limit: number }) …' },
              { tool: 'grep', input: { pattern: 'listOrders', path: 'src' }, output: 'src/pages/OrderHistory.tsx:2\nsrc/api/orders.ts:12' },
              { tool: 'edit', input: { filePath: 'src/api/orders.ts' }, output: 'Edited src/api/orders.ts (+14 −4)' },
              { tool: 'write', input: { filePath: 'src/hooks/usePagedOrders.ts' }, output: 'Wrote src/hooks/usePagedOrders.ts (21 lines)' },
              { tool: 'write', input: { filePath: 'migrations/0042_orders_keyset.sql' }, output: 'Wrote migrations/0042_orders_keyset.sql (3 lines)' },
              { tool: 'bash', input: { command: 'pnpm vitest run src/api src/hooks', description: 'Run the API and hook tests' }, output: `✓ src/api/orders.test.ts (9 tests) 41ms\n✓ src/hooks/usePagedOrders.test.ts (6 tests) 88ms\n\n${TEST_OK(2, 15, 1840)}` }
            ],
            reply: 'Switched to keyset pagination.\n\n- `listOrders` takes an opaque `after` cursor (base64 of `createdAt|id`) and returns `nextCursor`.\n- `usePagedOrders` wraps it in `useInfiniteQuery`; `OrderHistory` renders **Load more** and keeps scroll position.\n- Added `idx_orders_customer_created_id` in `migrations/0042_orders_keyset.sql` (created `CONCURRENTLY`, no table lock).\n\n15 tests pass. On the seeded 2M-row dataset, page 50 went from **1.9 s to 38 ms** (p95).'
          },
          {
            user: 'Nice. Add an empty state and make sure the cursor survives a page reload.',
            tools: [
              { tool: 'edit', input: { filePath: 'src/pages/OrderHistory.tsx' }, output: 'Edited src/pages/OrderHistory.tsx (+19 −9)' },
              { tool: 'bash', input: { command: 'pnpm tsc --noEmit && pnpm vitest run', description: 'Typecheck and run all tests' }, output: TEST_OK(31, 204, 6120) }
            ],
            reply: 'Done — the cursor now lives in the `?after=` query param, so reload and back/forward land on the same page. The empty state reuses `<EmptyState icon="receipt">` with a link back to the catalogue. `tsc` is clean and all 204 tests pass.'
          }
        ]
      },
      {
        key: 'btw', kind: 'btw', title: 'Is keyset pagination safe with deleted orders?', model: 'luna', agent: 'plan', from: 1, to: 1, turns: 3,
        tail: [{
          user: 'If an order is hard-deleted between two page loads, can the cursor skip or repeat rows?',
          reply: 'Neither. The cursor is a *position* (`created_at`, `id`), not a row reference, so deleting the row it came from just means the next query starts after a value that no longer exists — `WHERE (created_at, id) < ($1, $2)` still works. Rows are only skipped if one is **inserted** with an older `created_at`, which the orders table never does.'
        }]
      }
    ]
  },
  {
    number: 115,
    title: 'Migrate cart state from Redux to Zustand',
    prompt: 'Move the cart slice out of Redux into a Zustand store. Keep selector names so components change one import each, and migrate persisted carts from the redux-persist key on first load.',
    columnId: 'execute', repo: 'storefront', model: 'opus', agent: 'build', thinking: 'medium', createdDaysAgo: 2,
    files: ['src/store/cartSlice.ts', 'src/store/cart.ts', 'src/components/CartDrawer.tsx', 'src/components/CheckoutButton.tsx'],
    testCmd: 'pnpm vitest run src/store',
    sessions: [{ key: 'main', kind: 'main', title: 'Cart store: Redux → Zustand', from: 2, to: 0.2, turns: 9, summary: { files: 11, additions: 186, deletions: 241 } }],
    live: { mode: 'run', prompt: 'Carry on with the thunks and the persistence migration.' }
  },
  {
    number: 116,
    title: 'Push notification opt-in screen',
    prompt: 'Add an onboarding screen that explains order-update notifications before the OS prompt. Only ask once, remember a "Not now", and track the opt-in rate.',
    columnId: 'execute', repo: 'mobile', model: 'sonnet', agent: 'build', thinking: 'medium', createdDaysAgo: 3,
    files: ['app/screens/NotificationsOptIn.tsx', 'app/lib/permissions.ts', 'app/navigation/Onboarding.tsx'],
    testCmd: 'pnpm jest app/screens',
    sessions: [{
      key: 'main', kind: 'main', title: 'Notification opt-in onboarding step', from: 3, to: 0.6, turns: 12,
      summary: { files: 5, additions: 176, deletions: 12 },
      tail: [{
        user: 'Snapshot tests are failing on Android.',
        tools: [{ tool: 'bash', input: { command: 'pnpm jest app/screens --ci', description: 'Run the screen tests' }, output: 'PASS  app/screens/NotificationsOptIn.test.tsx\nPASS  app/screens/Settings.test.tsx\n\nTests:       18 passed, 18 total\nSnapshots:   6 passed, 6 total' }],
        reply: 'The Android snapshot differed only in the status-bar inset: the screen read `StatusBar.currentHeight` at import time. It now comes from `useSafeAreaInsets()`, and the 6 snapshots are regenerated. 18 tests pass.'
      }]
    }]
  },
  {
    number: 119,
    title: 'Idempotency keys for the refund API',
    prompt: 'POST /refunds can double-refund when the client retries on a timeout. Accept an Idempotency-Key header, store the first response for 24h, and replay it for repeats.',
    columnId: 'execute', repo: 'payments', model: 'opus', agent: 'build', thinking: 'high', createdDaysAgo: 1,
    files: ['src/refunds/refund.service.ts', 'src/refunds/idempotency.ts', 'prisma/schema.prisma', 'src/refunds/refund.controller.ts'],
    testCmd: 'pnpm vitest run src/refunds',
    sessions: [{ key: 'main', kind: 'main', title: 'Idempotent refunds', from: 1, to: 0.1, turns: 7, summary: { files: 4, additions: 97, deletions: 8 } }],
    live: { mode: 'ask', prompt: 'Apply the migration to the dev database and run the integration tests.' }
  },
  {
    number: 117,
    title: 'Offline queue for cart actions',
    prompt: 'On flaky mobile networks add-to-cart silently fails. Plan an offline queue: persist actions, replay in order on reconnect, and resolve conflicts with the server cart.',
    columnId: 'plan', repo: 'mobile', model: 'gemini', agent: 'plan', thinking: 'high', createdDaysAgo: 1,
    files: ['app/lib/cartSync.ts', 'app/lib/netinfo.ts', 'app/store/cart.ts'],
    testCmd: 'pnpm jest app/lib',
    sessions: [{
      key: 'main', kind: 'main', title: 'Plan: offline cart queue', from: 1, to: 0.8, turns: 3,
      tail: [{
        reply: '## Plan\n\n1. **Queue** — `app/lib/cartQueue.ts`, persisted to MMKV, one entry per action with a client-generated id.\n2. **Replay** — on `NetInfo` reconnect, drain in order; each call sends the id as `Idempotency-Key` (see TASK-119).\n3. **Conflicts** — server cart wins for price and stock; client wins for quantity if the item still exists.\n4. **UI** — a small "Syncing 3 changes" pill on the cart icon.\n\n**Risks:** quantity merges when two devices edit offline; the 24h idempotency window.'
      }]
    }]
  },
  {
    number: 120,
    title: 'Lazy-load the product image carousel',
    prompt: 'The product page downloads all 12 carousel images up front (~3.1 MB). Lazy-load everything past the first slide and add width descriptors for responsive images.',
    columnId: 'plan', repo: 'storefront', model: 'qwen', agent: 'build', thinking: 'medium', createdDaysAgo: 0.5,
    files: ['src/components/ProductCarousel.tsx', 'src/components/ProductImage.tsx'],
    testCmd: 'pnpm vitest run src/components',
    sessions: [{ key: 'main', kind: 'main', title: 'Lazy carousel images', from: 0.5, to: 0.3, turns: 4 }],
    live: { mode: 'run', prompt: 'Go ahead with the plan.' }
  },
  {
    number: 121, title: 'Rate-limit the Stripe webhook endpoint', columnId: 'backlog', repo: 'payments', model: 'sonnet', agent: 'build', thinking: 'medium', createdDaysAgo: 2,
    prompt: 'Add a token-bucket rate limit to /webhooks/stripe (per source IP) and alert when we start dropping events.',
    files: [], testCmd: '', sessions: []
  },
  {
    number: 122, title: 'Investigate flaky checkout e2e on Safari', columnId: 'backlog', repo: 'storefront', model: 'opus', agent: 'plan', thinking: 'high', createdDaysAgo: 1.5,
    prompt: 'checkout.spec.ts fails about 1 in 8 runs on WebKit only, at the 3-D Secure iframe step. Find out why before we add a retry.',
    files: [], testCmd: '', sessions: [],
    links: [{ url: 'https://github.com/northwind-labs/storefront-web/issues/497', title: 'Flaky: checkout.spec.ts on WebKit', kind: 'issue', ref: 'northwind-labs/storefront-web#497', state: 'open', label: 'Open' }]
  },
  {
    number: 123, title: 'Dark mode for account settings', columnId: 'backlog', repo: 'mobile', model: 'haiku', agent: 'build', thinking: 'low', createdDaysAgo: 0.8,
    prompt: 'Account settings ignore the system dark mode. Move the screen onto theme tokens.',
    files: [], testCmd: '', sessions: []
  }
];

/** Sessions that belong to no task on the board: past work, so the spend history has weeks behind it. */
export const HISTORY_TITLES: { title: string; repo: RepoKey }[] = [
  { title: 'Split the product service into catalog and pricing', repo: 'storefront' },
  { title: 'Sentry noise: group ChunkLoadError', repo: 'storefront' },
  { title: 'Migrate payouts to the v2 bank API', repo: 'payments' },
  { title: 'Fix timezone in settlement report', repo: 'payments' },
  { title: 'Deep links for order tracking', repo: 'mobile' },
  { title: 'Upgrade Expo SDK', repo: 'mobile' },
  { title: 'Explain the webhook signature check', repo: 'payments' },
  { title: 'Search results: debounce and cancel stale requests', repo: 'storefront' },
  { title: 'Checkout address autocomplete', repo: 'storefront' },
  { title: 'Chargeback evidence export', repo: 'payments' },
  { title: 'Crash on Android 12 camera permission', repo: 'mobile' },
  { title: 'Remove moment.js', repo: 'storefront' },
  { title: 'Audit log for manual refunds', repo: 'payments' },
  { title: 'Wishlist sync between devices', repo: 'mobile' },
  { title: 'Storybook for design tokens', repo: 'storefront' },
  { title: 'Reconcile Stripe balance transactions nightly', repo: 'payments' }
];
