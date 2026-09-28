import { MentionExtra, MentionItem, MentionKind, clipMentionBody } from '../../shared/trackers/mentions.js';
import { githubChecks, githubComments, githubDescription, resolveGithub } from './github.js';
import { jiraComments, jiraDescription, resolveJira } from './jira.js';
import { errorMessage } from '../../shared/errors.js';

/**
 * Going and getting one thing about a ticket that is already picked.
 *
 * Two calls with the same shape: a block of context, and the title behind a
 * pasted link. Both cost a CLI round trip, both are worth being a few minutes
 * out of date on, and neither may throw — the link is already in the composer
 * and stands on its own, so a missing `acli`, a private repo or an expired
 * login costs nothing but the extra text.
 */

const DETAIL_TTL_MS = 5 * 60_000;

function ttlCache<T>() {
  const entries = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = entries.get(key);
      return hit && Date.now() - hit.at < DETAIL_TTL_MS ? hit.value : undefined;
    },
    set(key: string, value: T): void {
      entries.set(key, { at: Date.now(), value });
    }
  };
}

/* ------------------------------------------------------------------ *
 * Fetched context: description, comments, CI checks.
 *
 * The description is fetched the moment a ticket is picked; comments and CI
 * output only when they are asked for. None of it is written into the
 * composer — the prompt carries it, folded in on send.
 * ------------------------------------------------------------------ */

const FETCHERS: Partial<Record<MentionKind, Partial<Record<MentionExtra, (item: MentionItem) => Promise<string>>>>> = {
  jira: { description: jiraDescription, comments: jiraComments },
  github: { description: githubDescription, comments: githubComments, checks: githubChecks }
};

const contextCache = ttlCache<string>();

/** One opt-in block for a ticket or PR. */
export async function mentionContext(
  item: MentionItem,
  extra: MentionExtra
): Promise<{ body: string; error?: string }> {
  const fetcher = FETCHERS[item.kind]?.[extra];
  if (!fetcher) return { body: '', error: `${item.kind} has no ${extra}` };

  const key = `${item.kind}:${item.id}:${extra}`;
  const hit = contextCache.get(key);
  if (hit !== undefined) return { body: hit };

  try {
    const body = clipMentionBody(await fetcher(item));
    contextCache.set(key, body);
    return { body };
  } catch (e) {
    console.warn(`[Mentions] ${key} failed:`, errorMessage(e) ?? e);
    return { body: '', error: `Could not load the ${extra} for ${item.id}` };
  }
}

/* ------------------------------------------------------------------ *
 * Resolving a link.
 *
 * The `@` menu only ever offers what is assigned to you, so it comes with
 * titles already attached. A pasted link does not: it is usually somebody
 * else's ticket, and all the board has is the URL.
 * ------------------------------------------------------------------ */

const RESOLVERS: Partial<Record<MentionKind, (item: MentionItem) => Promise<MentionItem>>> = {
  jira: resolveJira,
  github: resolveGithub
};

const resolveCache = ttlCache<MentionItem>();

/**
 * The title behind a pasted ticket or PR link. Without one the composer leaves
 * the link reading as its ref — which is what was pasted.
 */
export async function resolveMention(item: MentionItem): Promise<{ item?: MentionItem; error?: string }> {
  const resolver = RESOLVERS[item.kind];
  if (!resolver) return { error: `Cannot resolve a ${item.kind} link` };

  const key = `${item.kind}:${item.id}`;
  const hit = resolveCache.get(key);
  if (hit) return { item: hit };

  try {
    const resolved = await resolver(item);
    resolveCache.set(key, resolved);
    return { item: resolved };
  } catch (e) {
    console.warn(`[Mentions] resolve ${key} failed:`, errorMessage(e) ?? e);
    return { error: `Could not look up ${item.id}` };
  }
}
