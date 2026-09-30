import { Express, Request, Response } from 'express';
import { MENTION_EXTRAS, MentionItem, mentionNeedsUrl, parseMentionKind } from '../../shared/trackers/mentions.js';
import { listAgentCommands } from '../opencode/commands.js';
import { boardRoots } from '../board/queries.js';
import { searchFiles } from '../git/files.js';
import { route } from '../http/app.js';
import { mentionContext, resolveMention, searchMentions } from '../trackers/index.js';
import { resolveWithinRoots } from '../app/openExternal.js';
import { queryString } from './common.js';

/** Everything behind `@` and `/` in the composer. */
export function registerMentionRoutes(app: Express): void {
  app.get('/api/mentions', route(async (req: Request, res: Response) => {
    res.json(await searchMentions(queryString(req, 'q')));
  }));

  /**
   * One block of context for a picked ticket, PR or run: its description, its
   * comments, its CI checks, a run's jobs or failed logs. The composer asks for the description as soon as the item
   * is picked and for the rest on request; none of it goes into the textarea —
   * that keeps the link, and the block is folded into the prompt on send.
   */
  app.post('/api/mentions/context', route(async (req: Request, res: Response) => {
    const body = req.body as (Partial<MentionItem> & { extra?: string }) | undefined;
    const kind = parseMentionKind(body?.kind);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const extra = MENTION_EXTRAS.find((spec) => spec.id === body?.extra)?.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!extra) return res.status(400).json({ error: `extra must be one of ${MENTION_EXTRAS.map((spec) => spec.id).join(', ')}` });
    res.json(await mentionContext({
      kind,
      id,
      title: typeof body?.title === 'string' ? body.title : id,
      url: typeof body?.url === 'string' ? body.url : '',
      status: typeof body?.status === 'string' ? body.status : undefined,
      subtitle: typeof body?.subtitle === 'string' ? body.subtitle : undefined
    }, extra));
  }));

  /**
   * The title behind a link pasted into the composer. The `@` menu already knows
   * the titles of your own tickets; a pasted one is usually somebody else's, so
   * it is looked up by key rather than found in the assigned list.
   */
  app.post('/api/mentions/resolve', route(async (req: Request, res: Response) => {
    const body = req.body as Partial<MentionItem> | undefined;
    const kind = parseMentionKind(body?.kind);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    // A GitHub lookup reads the repo and number back out of the URL, so a resolve
    // without one has nothing to ask about.
    if (mentionNeedsUrl(kind) && !url) return res.status(400).json({ error: 'url is required' });
    res.json(await resolveMention({ kind, id, title: typeof body?.title === 'string' ? body.title : '', url }));
  }));

  /** Repo files behind `@`, scoped to a folder the board already knows about. */
  app.get('/api/files', route(async (req: Request, res: Response) => {
    const cwd = queryString(req, 'cwd');
    const resolved = cwd ? resolveWithinRoots(cwd, boardRoots()) : null;
    if (!resolved) return res.json({ items: [] });
    res.json(await searchFiles(resolved, queryString(req, 'q')));
  }));

  /**
   * What `/` offers from the agent side: its commands and its skills. Read off
   * disk rather than from ACP, because the board composer writes the prompt that
   * creates the session these would otherwise be announced on.
   */
  app.get('/api/agent-commands', route(async (req: Request, res: Response) => {
    const cwd = queryString(req, 'cwd');
    const resolved = cwd ? resolveWithinRoots(cwd, boardRoots()) : null;
    res.json(listAgentCommands(resolved || undefined));
  }));
}
