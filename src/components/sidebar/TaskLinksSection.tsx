import React, { useState } from 'react';
import { ActionIcon, Anchor, Group, Stack, TextInput, Tooltip } from '@mantine/core';
import {
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  Plus,
  Ticket,
  Trash2,
  X
} from 'lucide-react';
import { BoardTask, TaskLink, TaskLinkKind } from '../../../shared/types';
import { linkSettlement, linkStatusBadge, settlementLabel } from '../../../shared/trackers/linkStatus';
import { classifyLink, linkKindLabel, normalizeLinkUrl, showRef, sortTaskLinks } from '../../../shared/task/links';
import { Type } from '../ui';
import { LinkStatusBadge } from '../card/LinkStatusBadge';
import { api } from '../../api';
import { reportError } from '../../app/notify';

interface TaskLinksSectionProps {
  task: BoardTask;
  /** Applied straight away; the WebSocket sends the same snapshot a beat later. */
  onTaskUpdated: (task: BoardTask) => void;
}

const KIND_ICON: Record<TaskLinkKind, React.ComponentType<{ className?: string }>> = {
  jira: Ticket,
  pr: GitPullRequest,
  issue: CircleDot,
  commit: GitCommitHorizontal,
  doc: FileText,
  link: Link2
};



const LinkRow: React.FC<{ link: TaskLink; onRemove: () => void }> = ({ link, onRemove }) => {
  const Icon = KIND_ICON[link.kind];
  const badge = linkStatusBadge(link);
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" className="group">
      <Tooltip label={linkKindLabel(link.kind)} withArrow position="left">
        <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-3" />
      </Tooltip>

      <div className="min-w-0 flex-1">
        <Group gap={8} wrap="nowrap" className="min-w-0">
          <Tooltip label={link.url} withArrow position="left" multiline maw={360}>
            <Anchor
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              underline="never"
              className="type-copy block truncate min-w-0 text-ink-2 hover:text-acc-fg"
            >
              {showRef(link) && (
                <span className="font-mono text-ink-3">{link.ref} · </span>
              )}
              {link.title}
            </Anchor>
          </Tooltip>
          {/* Outside the link, so a long title truncates and the status stays. */}
          {badge && <LinkStatusBadge badge={badge} className="text-[11px]" />}
        </Group>
        {link.note && (
          <Type role="meta" className="block truncate">{link.note}</Type>
        )}
      </div>

      <Tooltip label="Remove this link" withArrow position="left">
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          className="opacity-0 group-hover:opacity-100 shrink-0"
          aria-label={`Remove ${link.title}`}
          onClick={onRemove}
        >
          <Trash2 className="w-3 h-3" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
};

/**
 * The pages this task is about: the ticket it implements, the PR it produced,
 * the doc it follows.
 *
 * They belong to the task rather than to a session, so they survive a fork, a
 * compact, or a stage that starts the conversation over — and the agent reads
 * and writes the same list through the board's MCP tools.
 */
export const TaskLinksSection: React.FC<TaskLinksSectionProps> = ({ task, onTaskUpdated }) => {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const links = sortTaskLinks(task.links);
  const finished = settlementLabel(linkSettlement(links));
  const normalized = normalizeLinkUrl(url);
  const preview = normalized ? classifyLink(normalized) : null;

  const closeAdd = () => {
    setAdding(false);
    setUrl('');
  };

  const submit = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    try {
      const result = await api.addTaskLinks(task.id, [{ url: normalized }]);
      onTaskUpdated(result.task);
      closeAdd();
    } catch (e) {
      reportError('Could not add that link', e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (link: TaskLink) => {
    try {
      onTaskUpdated(await api.deleteTaskLink(task.id, link.id));
    } catch (e) {
      reportError('Could not remove that link', e);
    }
  };

  return (
    <Stack gap={8}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <span className="type-meta uppercase tracking-[0.06em] text-ink-3 font-medium">
          Links{links.length > 0 ? ` (${links.length})` : ''}
          {finished ? ` · ${finished}` : ''}
        </span>
        <Tooltip label={adding ? 'Cancel' : 'Add a ticket, PR or page'} withArrow>
          <ActionIcon
            size="sm"
            variant="light"
            color="gray"
            aria-label={adding ? 'Cancel adding a link' : 'Add a link'}
            onClick={() => (adding ? closeAdd() : setAdding(true))}
          >
            {adding ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          </ActionIcon>
        </Tooltip>
      </Group>

      {adding && (
        <Stack gap={4}>
          <TextInput
            size="xs"
            autoFocus
            placeholder="Paste a Jira, PR or doc URL"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
              if (e.key === 'Escape') closeAdd();
            }}
          />
          <Type role="meta">
            {url.trim() && !normalized
              ? 'Not an http(s) URL'
              : preview
                ? `${linkKindLabel(preview.kind)}${preview.ref ? ` · ${preview.ref}` : ''} — Enter to add`
                : 'Enter to add, Esc to cancel'}
          </Type>
        </Stack>
      )}

      {links.length === 0 && !adding && (
        <Type role="copy" tone="faint">
          No links yet. Tickets and PRs written into the prompt land here on their own.
        </Type>
      )}

      {links.map((link) => (
        <LinkRow key={link.id} link={link} onRemove={() => void remove(link)} />
      ))}
    </Stack>
  );
};
