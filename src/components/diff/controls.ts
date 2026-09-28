import { DraftTarget } from '../../../shared/review/diffDrafts';

/**
 * The two bundles of behaviour every level of the diff needs.
 *
 * A file, a hunk and a line all offer the same thing — read the notes here,
 * write a new one — so they are passed down as a pair rather than as a dozen
 * separate callbacks repeated at each level.
 */

/** Writing one review note. */
export interface DraftControls {
  /** The line being commented on, when the draft box is open. */
  target: DraftTarget | null;
  body: string;
  saving: boolean;
  start: (target: DraftTarget) => void;
  setBody: (value: string) => void;
  submit: () => void;
  cancel: () => void;
}

/** Reading and answering the notes already there. */
export interface ThreadControls {
  /** Briefly highlighted, so a jump from the index lands somewhere visible. */
  focusedId: string | null;
  onReply: (commentId: string, body: string) => void | Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => void | Promise<void>;
  onDelete: (commentId: string) => void | Promise<void>;
}
