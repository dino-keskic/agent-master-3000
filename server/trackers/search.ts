import { MentionItem, capMentions, filterMentions } from '../../shared/trackers/mentions.js';
import { searchGithub } from './github.js';
import { searchJira } from './jira.js';
import { errorMessage } from '../../shared/errors.js';

/**
 * What `@` offers, and where it comes from.
 *
 * The list is what is assigned to you: it changes slowly, so it is cached for
 * a minute and served stale while a refresh runs. Typing filters that cached
 * list rather than going out to the CLIs — a lookup per keystroke would make
 * the menu unusable. Only a query that could be a ticket key, or that matches
 * nothing you own, is worth a live search.
 */

const CACHE_TTL_MS = 60_000;

interface SourceCache {
  at: number;
  items: MentionItem[];
}

let jiraCache: SourceCache | null = null;
let githubCache: SourceCache | null = null;
let refreshInFlight: Promise<{ items: MentionItem[]; errors: string[] }> | null = null;

/** A source that fails keeps whatever it had; one bad CLI must not empty the menu. */
async function refreshSource(
  cache: SourceCache | null,
  search: () => Promise<MentionItem[]>,
  label: string
): Promise<SourceCache | null> {
  try {
    return { at: Date.now(), items: await search() };
  } catch (e) {
    console.warn(`[Mentions] ${label} search failed:`, errorMessage(e) ?? e);
    return cache;
  }
}

async function refreshAssigned(): Promise<{ items: MentionItem[]; errors: string[] }> {
  const [jira, github] = await Promise.all([
    refreshSource(jiraCache, () => searchJira(''), 'Jira'),
    refreshSource(githubCache, () => searchGithub(''), 'GitHub')
  ]);
  if (jira) jiraCache = jira;
  if (github) githubCache = github;
  const errors: string[] = [];
  if (!jiraCache?.items.length) errors.push('Jira');
  if (!githubCache?.items.length) errors.push('GitHub');
  return {
    items: [...(jiraCache?.items || []), ...(githubCache?.items || [])],
    errors
  };
}

function cachedAssigned(): MentionItem[] {
  return [...(jiraCache?.items || []), ...(githubCache?.items || [])];
}

function cacheIsFresh(): boolean {
  const now = Date.now();
  return !!jiraCache && !!githubCache && now - jiraCache.at < CACHE_TTL_MS && now - githubCache.at < CACHE_TTL_MS;
}

/** One refresh at a time: every open composer shares the same round trip. */
function kickRefresh(): Promise<{ items: MentionItem[]; errors: string[] }> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAssigned().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function loadAssigned(): Promise<{ items: MentionItem[]; errors: string[] }> {
  if (cacheIsFresh()) return { items: cachedAssigned(), errors: [] };
  const stale = cachedAssigned();
  const pending = kickRefresh();
  if (stale.length > 0) return { items: stale, errors: [] };
  return pending;
}

/**
 * Tickets assigned to the current user that are not done, plus open GitHub
 * PRs they are involved in. `@` in the composer filters this list.
 */
export async function searchMentions(query: string): Promise<{ items: MentionItem[]; error?: string }> {
  try {
    const assigned = await loadAssigned();
    const q = query.trim();
    const error = assigned.errors.length ? `Could not load ${assigned.errors.join(' and ')}` : undefined;
    if (!q) return { items: capMentions(assigned.items), error };

    const filtered = filterMentions(assigned.items, q);
    const looksLikeKey = /^[A-Za-z][A-Za-z0-9]+-\d+$/.test(q) || /^\d+$/.test(q);
    if (filtered.length > 0 && !looksLikeKey) {
      return { items: capMentions(filtered), error };
    }

    const live: MentionItem[] = [];
    const extra = await Promise.allSettled([searchJira(q), searchGithub(q)]);
    if (extra[0].status === 'fulfilled') live.push(...extra[0].value);
    if (extra[1].status === 'fulfilled') live.push(...extra[1].value);

    const byId = new Map<string, MentionItem>();
    for (const item of [...filtered, ...live]) {
      byId.set(`${item.kind}:${item.id}`, item);
    }
    return { items: capMentions([...byId.values()]), error };
  } catch (e) {
    return { items: [], error: errorMessage(e) || 'Could not search tickets' };
  }
}
