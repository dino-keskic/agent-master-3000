import React, { useState } from 'react';
import { ActionIcon, Group, Stack, TextInput, Tooltip } from '@mantine/core';
import {
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  Plus,
  PlayCircle,
  Ticket,
  Trash2,
  X
} from 'lucide-react';
import { BoardTask, TaskLink, TaskLinkKind } from '../../../shared/types';
import { linkSettlement, linkStatusBadge, settlementLabel } from '../../../shared/trackers/linkStatus';
import { classifyLink, linkKindLabel, normalizeLinkUrl, showRef, sortTaskLinks } from '../../../shared/task/links';
import { collapseToRecent } from '../../../shared/task/showMore';
import { LinkStatusBadge } from '../card/LinkStatusBadge';
import { api } from '../../api';
import { reportError } from '../../app/notify';
import { SectionLabel } from './SectionLabel';
import { ShowMoreToggle } from './ShowMoreToggle';

interface TaskLinksSectionProps {
  task: BoardTask;
  /** Applied straight away; the WebSocket sends the same snapshot a beat later. */
  onTaskUpdated: (task: BoardTask) => void;
}

const KIND_ICON: Record<TaskLinkKind, React.ComponentType<{ className?: string }>> = {
  jira: Ticket,
  pr: GitPullRequest,
  issue: CircleDot,
  run: PlayCircle,
  commit: GitCommitHorizontal,
  doc: FileText,
  link: Link2
};



const LinkRow: React.FC<{ link: TaskLink; onRemove: () => void }> = ({ link, onRemove }) => {
  const Icon = KIND_ICON[link.kind];
  const badge = linkStatusBadge(link);
  return (
    <div className="flex items-start gap-2 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-s3h transition-colors group">
      <Tooltip label={linkKindLabel(link.kind)} withArrow position="left">
        <Icon className="w-3.5 h-3.5 shrink-0 mt-[3px] text-ink-3" />
      </Tooltip>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip label={link.url} withArrow position="left" multiline maw={360}>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate min-w-0 text-[12.5px] font-medium leading-[1.4] text-ink-2 hover:text-link transition-colors no-underline"
            >
              {showRef(link) && (
                <span className="inline-block mr-1.5 px-1 py-px rounded bg-s3 font-mono text-[10.5px] font-normal text-ink-3">
                  {link.ref}
                </span>
              )}
              {link.title}
            </a>
          </Tooltip>
          {/* Outside the link, so a long title truncates and the status stays. */}
          {badge && <LinkStatusBadge badge={badge} className="text-[11px]" />}
        </div>
        {link.note && (
          <span className="block truncate text-[11.5px] leading-[1.4] text-ink-4 mt-0.5">{link.note}</span>
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
    </div>
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
  const [expanded, setExpanded] = useState(false);

  const links = sortTaskLinks(task.links);
  const finished = settlementLabel(linkSettlement(links));
  const collapsed = collapseToRecent(links, { addedAt: (link) => link.createdAt });
  const shownLinks = expanded ? links : collapsed.visible;
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
    <Stack gap={6} className="px-1">
      <Group justify="space-between" align="center" wrap="nowrap">
        <SectionLabel>
          Links{links.length > 0 ? ` (${links.length})` : ''}
          {finished ? ` · ${finished}` : ''}
        </SectionLabel>
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
          <span className="text-[11px] text-ink-4">
            {url.trim() && !normalized
              ? 'Not an http(s) URL'
              : preview
                ? `${linkKindLabel(preview.kind)}${preview.ref ? ` · ${preview.ref}` : ''} — Enter to add`
                : 'Enter to add, Esc to cancel'}
          </span>
        </Stack>
      )}

      {links.length === 0 && !adding && (
        <span className="text-[12px] text-ink-4">
          No links yet
        </span>
      )}

      {shownLinks.map((link) => (
        <LinkRow key={link.id} link={link} onRemove={() => void remove(link)} />
      ))}
      <ShowMoreToggle
        hiddenCount={collapsed.hiddenCount}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
      />
    </Stack>
  );
};
