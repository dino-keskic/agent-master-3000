/** Changelog comments and diffs for the review tests. */

import { parseUnifiedDiff } from '../../shared/git/diff.js';
import { ChangelogComment } from '../../shared/types.js';

export function comment(partial: Partial<ChangelogComment> & Pick<ChangelogComment, 'id' | 'path' | 'body'>): ChangelogComment {
  return {
    side: 'add',
    snippet: '+ const x = 1',
    author: 'user',
    createdAt: 1,
    replies: [],
    newLine: 12,
    ...partial
  };
}

/** A one-file diff that adds lines 2 and 3. */
export const twoLineDiff = (file: string) =>
  parseUnifiedDiff(
    [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ -1,1 +1,3 @@',
      ' one',
      '+two',
      '+three'
    ].join('\n')
  );
