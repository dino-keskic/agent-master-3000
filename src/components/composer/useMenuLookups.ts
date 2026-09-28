import { useEffect, useState } from 'react';
import { FileItem, MentionItem } from '../../../shared/trackers/mentions';
import { SlashCommand } from '../../../shared/composer/slashCommands';
import { api } from '../../api';

/**
 * What the `/` and `@` menus have to go and find.
 *
 * Three separate reads with three different costs: the agent's commands come
 * off disk once per folder, files come off a cached list in milliseconds, and
 * tickets go out to the Jira and GitHub CLIs and can take seconds.
 */

/** Long enough that typing a ticket key does not fire a lookup per keystroke. */
const LOOKUP_DEBOUNCE_MS = 80;

export interface MenuLookups {
  agentCommands: SlashCommand[];
  files: FileItem[];
  mentions: MentionItem[];
  loading: boolean;
  error?: string;
}

/**
 * The agent's own commands and skills come off disk, so they can be listed
 * before there is a session to announce them.
 */
function useAgentCommands(cwd: string | undefined): SlashCommand[] {
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.agentCommands(cwd || '')
      .then((result) => {
        if (!cancelled) setAgentCommands(result.commands);
      })
      .catch(() => {
        if (!cancelled) setAgentCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  return agentCommands;
}

export function useMenuLookups(
  searching: boolean,
  query: string,
  cwd: string | undefined
): MenuLookups {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const agentCommands = useAgentCommands(cwd);

  // Warms the server's ticket cache, so the first `@` is not the slow one.
  useEffect(() => {
    void api.searchMentions('').catch(() => {});
  }, []);

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    setLoading(true);
    // Files and tickets land separately, so the file list is not held hostage
    // by a network round trip.
    const handle = window.setTimeout(() => {
      void (cwd ? api.searchFiles(cwd, query) : Promise.resolve({ items: [] as FileItem[] }))
        .then((result) => {
          if (!cancelled) setFiles(result.items);
        })
        .catch(() => {
          if (!cancelled) setFiles([]);
        });
      void api.searchMentions(query)
        .then((result) => {
          if (cancelled) return;
          setMentions(result.items);
          setError(result.error);
        })
        .catch(() => {
          if (cancelled) return;
          setMentions([]);
          setError('Could not search tickets');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [searching, query, cwd]);

  return { agentCommands, files, mentions, loading, error };
}
