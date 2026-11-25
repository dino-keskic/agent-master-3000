import React, { useEffect, useRef } from 'react';
import { Loader } from '@mantine/core';
import { FileCode, GitPullRequest, Sparkles, Terminal, Ticket } from 'lucide-react';
import { ComposerMenuEntry } from '../../../shared/composer/menu';
import { Chip, Surface } from '../ui';

function sectionOf(entry: ComposerMenuEntry): string {
  if (entry.kind === 'command') return entry.command.kind === 'skill' ? 'Skills' : 'Commands';
  if (entry.kind === 'file') return 'Files';
  return entry.mention.kind === 'jira' ? 'Jira' : 'GitHub';
}

function isDisabled(entry: ComposerMenuEntry): boolean {
  return entry.kind === 'command' && !!entry.command.disabled;
}

function iconFor(entry: ComposerMenuEntry): React.ReactNode {
  if (entry.kind === 'command') {
    return entry.command.kind === 'skill' ? (
      <Sparkles className="w-3.5 h-3.5 text-wait-fg shrink-0 mt-0.5" />
    ) : (
      <Terminal className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
    );
  }
  if (entry.kind === 'file') return <FileCode className="w-3.5 h-3.5 text-acc-fg shrink-0 mt-0.5" />;
  return entry.mention.kind === 'jira' ? (
    <Ticket className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
  ) : (
    <GitPullRequest className="w-3.5 h-3.5 text-run-fg shrink-0 mt-0.5" />
  );
}

function titleOf(entry: ComposerMenuEntry): string {
  if (entry.kind === 'command') return `/${entry.command.label}`;
  if (entry.kind === 'file') return entry.file.name;
  return entry.mention.id;
}

function subtitleOf(entry: ComposerMenuEntry): string {
  if (entry.kind === 'command') return entry.command.description;
  if (entry.kind === 'file') return entry.file.path;
  return entry.mention.title;
}

/** The right-hand hint: where a command came from, or what state an item is in. */
function hintOf(entry: ComposerMenuEntry): string | undefined {
  if (entry.kind === 'command') return entry.command.source === 'board' ? undefined : entry.command.source;
  if (entry.kind === 'file') return undefined;
  return entry.mention.status;
}

interface CommandMenuProps {
  entries: ComposerMenuEntry[];
  active: number;
  /** True while the search behind the current query is in flight. */
  loading?: boolean;
  error?: string;
  /** Shown when nothing matched, so the two triggers explain themselves. */
  emptyHint?: string;
  onHover: (index: number) => void;
  onPick: (entry: ComposerMenuEntry) => void;
  placement?: 'above' | 'below';
}

/**
 * The menu behind both triggers. `/` fills it with commands and skills, `@`
 * with files, tickets and PRs — the sections are the same component either way
 * so the two never drift apart.
 */
export const CommandMenu: React.FC<CommandMenuProps> = ({
  entries,
  active,
  loading,
  error,
  emptyHint,
  onHover,
  onPick,
  placement = 'above'
}) => {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const headers = entries.map((entry, index) => {
    const section = sectionOf(entry);
    return index > 0 && sectionOf(entries[index - 1]!) === section ? null : section;
  });

  return (
    <Surface
      level="s1"
      variant="panel"
      border="default"
      radius="lg"
      className={`absolute left-0 right-0 z-50 overflow-hidden ${
        placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
      }`}
    >
      <div className="max-h-[min(18rem,45vh)] overflow-y-auto">
        <div className="flex flex-col">
          {entries.length === 0 && !loading && !error && (
            <span className="font-mono text-[12px] text-ink-3 px-3 py-2.5">
              {emptyHint || 'Nothing matches'}
            </span>
          )}
          {entries.map((entry, index) => {
            const header = headers[index];
            const disabled = isDisabled(entry);
            const hint = hintOf(entry);
            return (
              <React.Fragment key={entry.id}>
                {header && (
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 px-3 pt-2 pb-1 sticky top-0 bg-surface z-10 border-b border-hairline">
                    {header}
                  </span>
                )}
                <button
                  ref={index === active ? activeRef : undefined}
                  type="button"
                  disabled={disabled}
                  className={`flex items-start gap-2.5 w-full text-left px-3 py-2 border-0 bg-transparent cursor-pointer transition-colors ${
                    disabled
                      ? 'opacity-50 cursor-default'
                      : index === active
                        ? 'bg-acc-bg'
                        : 'hover:bg-s3h'
                  }`}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!disabled) onPick(entry);
                  }}
                >
                  {iconFor(entry)}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-mono text-[12px] font-semibold text-ink truncate">
                      {titleOf(entry)}
                    </span>
                    <span className="text-[12px] text-ink-2 truncate">
                      {subtitleOf(entry)}
                    </span>
                  </div>
                  {hint && (
                    <Chip className="font-mono shrink-0 mt-0.5">{hint}</Chip>
                  )}
                </button>
              </React.Fragment>
            );
          })}
          {loading && (
            <span className="font-mono text-[12px] text-ink-3 px-3 py-2 flex items-center gap-2">
              <Loader size={10} color="gray" />
              Searching…
            </span>
          )}
          {error && (
            <span className="font-mono text-[12px] px-3 py-2 text-wait-fg">
              {error}
            </span>
          )}
        </div>
      </div>
    </Surface>
  );
};
