import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * The three repositories the demo tasks work in, as real git checkouts with a
 * short history, plus one worktree carrying uncommitted work so the Changes tab
 * has a diff to show. Everything here is invented; it only has to look like
 * code a team would have.
 */

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Sam Rivera',
  GIT_AUTHOR_EMAIL: 'sam@northwind.example',
  GIT_COMMITTER_NAME: 'Sam Rivera',
  GIT_COMMITTER_EMAIL: 'sam@northwind.example'
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body.replace(/^\n/, ''));
  }
}

function commit(cwd: string, message: string, daysAgo: number): void {
  git(cwd, 'add', '-A');
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd,
    env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}

const ORDER_HISTORY_BEFORE = `
import { useEffect, useState } from 'react';
import { listOrders, Order } from '../api/orders';
import { OrderRow } from '../components/OrderRow';

const PAGE_SIZE = 20;

export function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    listOrders({ offset: page * PAGE_SIZE, limit: PAGE_SIZE }).then(setOrders);
  }, [page]);

  return (
    <section className="order-history">
      <h1>Your orders</h1>
      {orders.map((order) => <OrderRow key={order.id} order={order} />)}
      <button onClick={() => setPage((p) => p + 1)}>Next page</button>
    </section>
  );
}
`;

const ORDER_HISTORY_AFTER = `
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { OrderRow } from '../components/OrderRow';
import { usePagedOrders } from '../hooks/usePagedOrders';

export function OrderHistory() {
  const [params, setParams] = useSearchParams();
  const { orders, nextCursor, isLoading, loadMore } = usePagedOrders(params.get('after'));

  if (!isLoading && orders.length === 0) {
    return <EmptyState icon="receipt" title="No orders yet" action={{ href: '/catalogue', label: 'Start shopping' }} />;
  }

  return (
    <section className="order-history">
      <h1>Your orders</h1>
      {orders.map((order) => <OrderRow key={order.id} order={order} />)}
      {nextCursor && (
        <button
          disabled={isLoading}
          onClick={() => {
            setParams({ after: nextCursor }, { replace: true, preventScrollReset: true });
            loadMore();
          }}
        >
          Load more
        </button>
      )}
    </section>
  );
}
`;

const ORDERS_API_BEFORE = `
import { http } from './http';

export interface Order {
  id: string;
  createdAt: string;
  totalCents: number;
  currency: string;
  status: 'placed' | 'shipped' | 'delivered' | 'refunded';
}

export async function listOrders(opts: { offset: number; limit: number }): Promise<Order[]> {
  const res = await http.get('/v2/orders', { params: opts });
  return res.data.orders;
}
`;

const ORDERS_API_AFTER = `
import { http } from './http';

export interface Order {
  id: string;
  createdAt: string;
  totalCents: number;
  currency: string;
  status: 'placed' | 'shipped' | 'delivered' | 'refunded';
}

export interface OrderPage {
  orders: Order[];
  /** Opaque: base64 of \`createdAt|id\` for the last row. Absent on the last page. */
  nextCursor?: string;
}

/** Keyset pagination on (created_at, id): constant cost however deep the page. */
export async function listOrders(opts: { after?: string | null; limit?: number }): Promise<OrderPage> {
  const res = await http.get('/v3/orders', { params: { after: opts.after ?? undefined, limit: opts.limit ?? 20 } });
  return { orders: res.data.orders, nextCursor: res.data.next_cursor ?? undefined };
}
`;

const USE_PAGED_ORDERS = `
import { useInfiniteQuery } from '@tanstack/react-query';
import { listOrders } from '../api/orders';

export function usePagedOrders(startAfter: string | null) {
  const query = useInfiniteQuery({
    queryKey: ['orders', startAfter],
    initialPageParam: startAfter,
    queryFn: ({ pageParam }) => listOrders({ after: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? null
  });
  const pages = query.data?.pages ?? [];
  return {
    orders: pages.flatMap((p) => p.orders),
    nextCursor: pages.at(-1)?.nextCursor,
    isLoading: query.isFetching,
    loadMore: () => query.fetchNextPage()
  };
}
`;

const MIGRATION = `
-- Keyset pagination for order history: (customer_id, created_at DESC, id DESC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_created_id
  ON orders (customer_id, created_at DESC, id DESC);
`;

export interface DemoRepos {
  storefront: string;
  payments: string;
  mobile: string;
  /** The worktree TASK-108 works in, with its changes uncommitted. */
  paginationWorktree: string;
}

export function createRepos(workspace: string): DemoRepos {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const storefront = path.join(workspace, 'storefront-web');
  const payments = path.join(workspace, 'payments-api');
  const mobile = path.join(workspace, 'mobile-app');

  for (const repo of [storefront, payments, mobile]) {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
  }

  write(storefront, {
    'package.json': JSON.stringify({ name: 'storefront-web', private: true, scripts: { dev: 'vite', test: 'vitest run' } }, null, 2),
    'README.md': '# storefront-web\n\nThe Northwind customer storefront.\n',
    'src/api/http.ts': "import axios from 'axios';\n\nexport const http = axios.create({ baseURL: import.meta.env.VITE_API_URL });\n",
    'src/api/orders.ts': ORDERS_API_BEFORE,
    'src/pages/OrderHistory.tsx': ORDER_HISTORY_BEFORE,
    'src/components/OrderRow.tsx': "import { Order } from '../api/orders';\n\nexport function OrderRow({ order }: { order: Order }) {\n  return <div className=\"order-row\">{order.id}</div>;\n}\n",
    'src/store/cartSlice.ts': "import { createSlice } from '@reduxjs/toolkit';\n\nexport const cartSlice = createSlice({ name: 'cart', initialState: { items: [] }, reducers: {} });\n"
  });
  commit(storefront, 'Initial storefront', 60);
  write(storefront, { 'src/components/EmptyState.tsx': 'export function EmptyState(props: { icon: string; title: string; action?: { href: string; label: string } }) {\n  return <div className="empty-state">{props.title}</div>;\n}\n' });
  commit(storefront, 'Add EmptyState component', 21);

  write(payments, {
    'package.json': JSON.stringify({ name: 'payments-api', private: true, scripts: { test: 'vitest run' } }, null, 2),
    'prisma/schema.prisma': 'model Refund {\n  id        String   @id @default(cuid())\n  paymentId String\n  amount    Int\n  createdAt DateTime @default(now())\n}\n',
    'src/refunds/refund.service.ts': 'export async function createRefund(paymentId: string, amount: number) {\n  // TODO: idempotency\n}\n',
    'src/payouts/worker.ts': 'export async function runPayout(id: string) {\n  // retried by the queue with no backoff\n}\n',
    'src/invoices/pdf.ts': 'export function formatAmount(cents: number) {\n  return (cents / 100).toFixed(2);\n}\n'
  });
  commit(payments, 'Initial payments service', 60);

  write(mobile, {
    'package.json': JSON.stringify({ name: 'mobile-app', private: true, scripts: { test: 'jest' } }, null, 2),
    'app/screens/Settings.tsx': 'export function Settings() {\n  return null;\n}\n'
  });
  commit(mobile, 'Initial app shell', 60);

  // TASK-108's worktree: branch off main, then leave the work uncommitted.
  const paginationWorktree = path.join(workspace, 'storefront-web.worktrees', 'order-history-pagination');
  git(storefront, 'worktree', 'add', '-q', '-b', 'feat/order-history-pagination', paginationWorktree);
  write(paginationWorktree, {
    'src/api/orders.ts': ORDERS_API_AFTER,
    'src/pages/OrderHistory.tsx': ORDER_HISTORY_AFTER,
    'src/hooks/usePagedOrders.ts': USE_PAGED_ORDERS,
    'migrations/0042_orders_keyset.sql': MIGRATION
  });

  return { storefront, payments, mobile, paginationWorktree };
}
