import React from 'react';
import { Group, Tooltip } from '@mantine/core';
import { CircleDot, GitPullRequest, LucideIcon, Ticket } from 'lucide-react';
import { linkStatusBadge } from '../../../shared/trackers/linkStatus';
import { linkKindLabel } from '../../../shared/task/links';
import { TaskLink, TaskLinkKind } from '../../../shared/types';
import { LinkStatusBadge } from './LinkStatusBadge';

const LINK_ICON: Partial<Record<TaskLinkKind, LucideIcon>> = { jira: Ticket, pr: GitPullRequest, issue: CircleDot };

/**
 * The ticket and the PR, so the board answers "which one is this?" without
 * opening anything, and where each one stands — a ticket's "In Review" is
 * most of why you glance at a card. Sits above the card's own link, and
 * swallows the click. The row wraps rather than hiding a status.
 */
export const TrackerLinks: React.FC<{ links: TaskLink[] }> = ({ links }) => {
  if (links.length === 0) return null;
  return (
    <Group gap={6} wrap="wrap" className="min-w-0">
      {links.map((link) => {
        const Icon = LINK_ICON[link.kind] ?? Ticket;
        const badge = linkStatusBadge(link);
        const finished = link.status?.state === 'merged' || link.status?.state === 'done';
        return (
          <Tooltip
            key={link.id}
            label={[linkKindLabel(link.kind), link.title, link.status?.label].filter(Boolean).join(' · ')}
            withArrow
          >
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              draggable={false}
              className={`relative z-[2] inline-flex items-center gap-1 min-w-0 max-w-full rounded px-1.5 py-0.5 bg-s4 border border-line font-mono text-[10px] hover:text-acc-fg ${
                finished ? 'text-ink-4' : 'text-ink-3'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon className="w-3 h-3 shrink-0" />
              <span className="truncate">{link.ref || link.title}</span>
              {badge && <LinkStatusBadge badge={badge} className="text-[10px] ml-0.5" />}
            </a>
          </Tooltip>
        );
      })}
    </Group>
  );
};
