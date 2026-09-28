import React, { useMemo } from 'react';
import { DiffHunk } from '../../../shared/git/diff';
import { draftKey, lineDraft } from '../../../shared/review/diffDrafts';
import { highlightLine, languageFromPath } from '../../../shared/transcript/highlight';
import { ChangelogComment } from '../../../shared/types';
import { commentsOnLine } from '../../../shared/review/changelogComments';
import { MessageSquarePlus } from 'lucide-react';
import { ChangelogCommentThread } from '../notes/ChangelogCommentThread';
import { CommentDraft } from '../notes/CommentDraft';
import { HighlightedCode } from '../stream/HighlightedCode';
import { DraftControls, ThreadControls } from './controls';

/**
 * One hunk, as the table of numbered lines a note can be attached to.
 * Matches Agent Master 3000.dc.html (lines 1191-1225).
 */
export interface HunkTableProps {
  path: string;
  /** The folder the file is in, when the task works in more than one. */
  cwd?: string;
  hunk: DiffHunk;
  comments: ChangelogComment[];
  drafts: DraftControls;
  threads: ThreadControls;
}

export const HunkTable: React.FC<HunkTableProps> = ({ path, cwd, hunk, comments, drafts, threads }) => {
  const lang = languageFromPath(path);
  const highlighted = useMemo(
    () => hunk.lines.map((line) => highlightLine(line.text, lang)),
    [hunk.lines, lang]
  );

  return (
    <div className="overflow-x-auto bg-code">
      <table className="w-full border-collapse font-mono text-xs leading-[1.65]">
        <tbody>
          <tr>
            <td colSpan={4} className="px-3 py-1 text-ink-4 bg-surface border-y border-hairline select-none font-mono text-xs">
              @@ −{hunk.oldStart} +{hunk.newStart} @@ {hunk.header}
            </td>
          </tr>
          {hunk.lines.map((line, i) => {
            const target = lineDraft(path, line, cwd);
            const onThisLine = commentsOnLine(comments, path, line);
            const drafting = drafts.target && draftKey(drafts.target) === draftKey(target);
            const anchor = `${path}:${line.newLine ?? line.oldLine ?? ''}`;
            const isAdd = line.kind === 'add';
            const isDel = line.kind === 'del';

            return (
              <React.Fragment key={i}>
                <tr
                  className={`group transition-colors ${
                    isAdd
                      ? 'bg-emerald-500/[0.09] text-add hover:bg-emerald-500/[0.14]'
                      : isDel
                        ? 'bg-rose-500/[0.09] text-del hover:bg-rose-500/[0.14]'
                        : 'text-ink-2 hover:bg-surface-3/50'
                  } ${onThisLine.length > 0 ? 'outline outline-1 outline-acc-bd' : ''}`}
                >
                  <td className="w-6 px-0.5 text-center align-top select-none">
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-acc-fg p-0.5 border-0 bg-transparent cursor-pointer"
                      aria-label={`Comment on ${anchor}`}
                      onClick={() => drafts.start(target)}
                    >
                      <MessageSquarePlus className="w-3 h-3" />
                    </button>
                  </td>
                  <td
                    className="w-11 px-1 text-right text-ink-4 select-none align-top cursor-pointer tabular-nums"
                    onClick={() => drafts.start(target)}
                  >
                    {line.oldLine ?? ''}
                  </td>
                  <td
                    className="w-11 px-1 text-right text-ink-4 select-none align-top border-r border-hairline cursor-pointer tabular-nums"
                    onClick={() => drafts.start(target)}
                  >
                    {line.newLine ?? ''}
                  </td>
                  <td className="px-2.5 whitespace-pre font-mono">
                    <span className="select-none inline-block w-3 text-ink-4">
                      {isAdd ? '+' : isDel ? '−' : ' '}
                    </span>
                    {isAdd || isDel ? (
                      <span className={isAdd ? 'text-add' : 'text-del'}>{line.text}</span>
                    ) : (
                      <HighlightedCode tokens={highlighted[i] ?? []} />
                    )}
                  </td>
                </tr>
                {onThisLine.map((comment) => (
                  <tr key={comment.id}>
                    <td colSpan={4} className="p-0 bg-surface-2 border-y border-hairline">
                      <div className="py-2 px-3 pl-14">
                        <ChangelogCommentThread comment={comment} {...threads} />
                      </div>
                    </td>
                  </tr>
                ))}
                {drafting && (
                  <tr>
                    <td colSpan={4} className="p-0 bg-surface-2 border-y border-hairline">
                      <div className="py-2 px-3 pl-14">
                        <CommentDraft
                          value={drafts.body}
                          onChange={drafts.setBody}
                          onSubmit={drafts.submit}
                          onCancel={drafts.cancel}
                          submitting={drafts.saving}
                          anchor={anchor}
                          snippet={line.text}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
