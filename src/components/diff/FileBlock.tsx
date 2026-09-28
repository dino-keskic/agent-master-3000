import React from 'react';
import { ChevronDown, ChevronRight, FileCode2, MessageSquarePlus } from 'lucide-react';
import { DiffFile, FILE_STATUS_LABEL } from '../../../shared/git/diff';
import { firstChangedLine } from '../../../shared/review/diffDrafts';
import { ChangelogComment } from '../../../shared/types';
import { commentsOnFile } from '../../../shared/review/changelogComments';
import { ChangelogCommentThread } from '../notes/ChangelogCommentThread';
import { CommentDraft } from '../notes/CommentDraft';
import { HunkTable } from './HunkTable';
import { DraftControls, ThreadControls } from './controls';
import { Surface } from '../ui/Surface';

export interface FileBlockProps {
  file: DiffFile;
  /** The folder this file is in, when the task works in more than one. */
  cwd?: string;
  comments: ChangelogComment[];
  collapsed: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string, line?: number) => void;
  drafts: DraftControls;
  threads: ThreadControls;
}

const FileHeader: React.FC<FileBlockProps> = ({
  file,
  cwd,
  comments,
  collapsed,
  onToggle,
  onOpenFile,
  drafts
}) => (
  <div
    className="flex items-center gap-2.5 px-3 py-2 bg-surface border-b border-line cursor-pointer select-none"
    role="button"
    tabIndex={0}
    onClick={onToggle}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    }}
  >
    {collapsed ? (
      <ChevronRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
    )}
    <span className="font-mono text-xs font-medium text-ink truncate flex-1" title={file.path}>
      {file.oldPath && file.status === 'renamed' && (
        <span className="text-ink-3">{file.oldPath} → </span>
      )}
      {file.path}
    </span>
    {file.additions > 0 && (
      <span className="font-mono text-[11px] text-add shrink-0">
        +{file.additions}
      </span>
    )}
    {file.deletions > 0 && (
      <span className="font-mono text-[11px] text-del shrink-0">
        −{file.deletions}
      </span>
    )}
    {comments.length > 0 && (
      <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-acc-bg text-acc-fg shrink-0">
        {comments.length} {comments.length === 1 ? 'note' : 'notes'}
      </span>
    )}
    {file.status !== 'modified' && (
      <span className="font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-3 text-ink-3 shrink-0">
        {FILE_STATUS_LABEL[file.status]}
      </span>
    )}
    <button
      type="button"
      title={`Comment on ${file.path}`}
      aria-label={`Comment on ${file.path}`}
      className="p-1 text-ink-3 hover:text-ink rounded hover:bg-surface-2 cursor-pointer border-0 bg-transparent transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        drafts.start({ path: file.path, cwd, side: 'file', snippet: '' });
      }}
    >
      <MessageSquarePlus className="w-3.5 h-3.5" />
    </button>
    {onOpenFile && (
      <button
        type="button"
        title={`Open ${file.path} in your editor`}
        aria-label={`Open ${file.path}`}
        className="p-1 text-ink-3 hover:text-ink rounded hover:bg-surface-2 cursor-pointer border-0 bg-transparent transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onOpenFile(file.path, firstChangedLine(file));
        }}
      >
        <FileCode2 className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

export const FileBlock: React.FC<FileBlockProps> = (props) => {
  const { file, cwd, comments, collapsed, drafts, threads } = props;
  const onThisFile = commentsOnFile(comments, file.path);
  const fileDraft = drafts.target?.path === file.path && drafts.target.side === 'file';
  const ownComments = comments.filter((comment) => comment.path === file.path);

  return (
    <Surface level="s2" border="default" radius="lg" className="mb-3 overflow-hidden shrink-0 shadow-panel">
      <FileHeader {...props} comments={ownComments} />

      {!collapsed && (
        <div>
          {(onThisFile.length > 0 || fileDraft) && (
            <div className="px-3 py-2 bg-surface-2 border-b border-hairline flex flex-col gap-2">
              {onThisFile.map((comment) => (
                <ChangelogCommentThread key={comment.id} comment={comment} showAnchor {...threads} />
              ))}
              {fileDraft && (
                <CommentDraft
                  value={drafts.body}
                  onChange={drafts.setBody}
                  onSubmit={drafts.submit}
                  onCancel={drafts.cancel}
                  submitting={drafts.saving}
                  anchor={`${file.path} — whole file`}
                />
              )}
            </div>
          )}

          {file.hunks.map((hunk, i) => (
            <HunkTable
              key={i}
              path={file.path}
              cwd={cwd}
              hunk={hunk}
              comments={comments}
              drafts={drafts}
              threads={threads}
            />
          ))}
        </div>
      )}
    </Surface>
  );
};
