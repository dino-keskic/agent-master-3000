import React, { useMemo, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { DiffFile, DiffLine, diffStat } from '../../../../shared/git/diff';
import { EditDiff } from '../../../../shared/agent/editDiff';
import { highlight, highlightLine, languageFromPath } from '../../../../shared/transcript/highlight';
import { HighlightedCode } from '../HighlightedCode';
import { CODE_PANE, SECTION_LABEL } from './styles';

/**
 * What an edit tool call looks like once `shared/agent/editDiff` has worked out the
 * change: the file, the hunks, and a `+n −m` stat. Deliberately *not*
 * `diff/HunkTable` — that one is a review surface with comment gutters and
 * drafts, and this is a few lines inline in a transcript, so it stays a lean
 * list that collapses to a preview.
 *
 * The rows of every file are flattened into one list so the preview budget is
 * spent across the whole diff rather than per file.
 */

/** Rows shown before the "show all" button. About a screen of a transcript. */
const PREVIEW_ROWS = 14;

type Row =
  | { kind: 'file'; key: string; file: DiffFile }
  | { kind: 'sep'; key: string; label: string }
  | { kind: 'line'; key: string; line: DiffLine; lang?: string };

function toRows(files: DiffFile[]): Row[] {
  const rows: Row[] = [];
  files.forEach((file, fileIndex) => {
    const lang = languageFromPath(file.path);
    // A single-file diff already has its path in the header above the rows.
    if (files.length > 1) rows.push({ kind: 'file', key: `f${fileIndex}`, file });
    file.hunks.forEach((hunk, hunkIndex) => {
      if (fileIndex > 0 || hunkIndex > 0) {
        rows.push({
          kind: 'sep',
          key: `s${fileIndex}-${hunkIndex}`,
          label: `@@ −${hunk.oldStart} +${hunk.newStart} @@ ${hunk.header}`.trimEnd()
        });
      }
      hunk.lines.forEach((line, lineIndex) => {
        rows.push({ kind: 'line', key: `l${fileIndex}-${hunkIndex}-${lineIndex}`, line, lang });
      });
    });
  });
  return rows;
}

const StatLabel: React.FC<{ additions: number; deletions: number }> = ({ additions, deletions }) => (
  <span className="font-mono text-[11px] shrink-0 tabular-nums">
    {additions > 0 && <span className="text-add">+{additions}</span>}
    {additions > 0 && deletions > 0 && ' '}
    {deletions > 0 && <span className="text-del">−{deletions}</span>}
  </span>
);

const DiffRow: React.FC<{ line: DiffLine; lang?: string }> = ({ line, lang }) => {
  const isAdd = line.kind === 'add';
  const isDel = line.kind === 'del';
  const tokens = useMemo(
    () => (isAdd || isDel ? [] : highlightLine(line.text, lang)),
    [isAdd, isDel, line.text, lang]
  );

  return (
    <div
      className={`flex items-start gap-0 px-1 whitespace-pre ${
        isAdd
          ? 'bg-emerald-500/[0.09] text-add'
          : isDel
            ? 'bg-rose-500/[0.09] text-del'
            : 'text-ink-2'
      }`}
    >
      <span className="w-9 shrink-0 pr-1 text-right text-ink-4 select-none tabular-nums">
        {line.oldLine ?? ''}
      </span>
      <span className="w-9 shrink-0 pr-1.5 text-right text-ink-4 select-none tabular-nums border-r border-hairline">
        {line.newLine ?? ''}
      </span>
      <span className="w-3 shrink-0 pl-1.5 text-ink-4 select-none">
        {isAdd ? '+' : isDel ? '−' : ' '}
      </span>
      <span className="min-w-0">
        {isAdd || isDel ? line.text : <HighlightedCode tokens={tokens} />}
      </span>
    </div>
  );
};

export const EditDiffBody: React.FC<{ diff: EditDiff; rawInput?: Record<string, unknown> }> = ({
  diff,
  rawInput
}) => {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => toRows(diff.files), [diff.files]);
  const stat = useMemo(() => diffStat(diff.files), [diff.files]);

  const single = diff.files.length === 1 ? diff.files[0] : undefined;
  const hidden = Math.max(0, rows.length - PREVIEW_ROWS);
  const shown = expanded || hidden === 0 ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-line overflow-hidden bg-code">
        <div className="flex items-center gap-2 px-2 py-1 bg-surface-2 border-b border-hairline">
          <span
            className="font-mono text-[11px] text-ink-2 truncate flex-1 min-w-0"
            title={single?.path}
          >
            {single ? single.path : `${stat.files} files`}
          </span>
          {diff.truncated && (
            <span className="font-mono text-[10px] text-ink-4 shrink-0" title="Capped so a very large edit cannot stall the transcript">
              truncated
            </span>
          )}
          <StatLabel additions={stat.additions} deletions={stat.deletions} />
        </div>

        <div className="overflow-x-auto font-mono text-log-code leading-[1.6] py-0.5">
          {shown.map((row) => {
            if (row.kind === 'line') return <DiffRow key={row.key} line={row.line} lang={row.lang} />;
            if (row.kind === 'sep') {
              return (
                <div
                  key={row.key}
                  className="px-2 py-0.5 text-ink-4 bg-surface border-y border-hairline select-none whitespace-pre"
                >
                  {row.label}
                </div>
              );
            }
            return (
              <div
                key={row.key}
                className="flex items-center gap-2 px-2 py-0.5 bg-surface border-y border-hairline"
              >
                <span className="text-ink-2 truncate flex-1 min-w-0" title={row.file.path}>
                  {row.file.path}
                </span>
                <StatLabel additions={row.file.additions} deletions={row.file.deletions} />
              </div>
            );
          })}
        </div>

        {hidden > 0 && (
          <UnstyledButton
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="w-full px-2 py-1 border-t border-hairline bg-surface-2 hover:bg-surface-3 transition-colors font-mono text-[11px] text-ink-3 text-left"
          >
            {expanded ? 'Show less' : `Show ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`}
          </UnstyledButton>
        )}
      </div>

      {rawInput && Object.keys(rawInput).length > 0 && (
        <details>
          <summary className={`${SECTION_LABEL} cursor-pointer select-none py-0.5`}>Raw input</summary>
          <div className="mt-1">
            <pre className={CODE_PANE}>
              <code>
                <HighlightedCode tokens={highlight(JSON.stringify(rawInput, null, 2), 'json')} />
              </code>
            </pre>
          </div>
        </details>
      )}
    </div>
  );
};
