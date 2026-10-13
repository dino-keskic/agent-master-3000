import { useEffect, useState } from 'react';
import { api } from '../../api';
import { pullRequestBranchName } from '../../../shared/git/worktree';

/**
 * The branch a new worktree for a pull request would check out, for the
 * picker to show before it is made.
 *
 * Asking means a `gh` call, so an answer is kept for the life of the page —
 * a PR's branch does not change — and nothing is asked until a new worktree
 * is actually on the table.
 */

const known = new Map<string, string | null>();

/** @param pr the PR the work is on, or nothing when no new worktree is wanted. */
export function usePullRequestBranch(pr: { repo: string; number: number } | undefined): string | undefined {
  const ref = pr ? `${pr.repo}#${pr.number}` : '';
  const [, setAnswered] = useState(0);

  useEffect(() => {
    if (!ref || known.has(ref)) return;
    let cancelled = false;
    api.pullRequestHead(ref)
      .then((head) => {
        known.set(ref, head.branch ? pullRequestBranchName({ branch: head.branch, forkOwner: head.forkOwner }) : null);
      })
      .catch(() => { known.set(ref, null); })
      .finally(() => { if (!cancelled) setAnswered((n) => n + 1); });
    return () => { cancelled = true; };
  }, [ref]);

  return (ref && known.get(ref)) || undefined;
}
