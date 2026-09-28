/**
 * Jira tickets and GitHub PRs, for `@` in the composer.
 *
 * Three things happen here, in three files. `search.ts` answers what the menu
 * lists. `lookup.ts` goes and gets one thing about an item that is already
 * picked — a block of context, or the title behind a pasted link. Under both,
 * `jira.ts` and `github.ts` are the only files that know what `acli` and `gh`
 * print, and `cli.ts` is the only one that runs them.
 */

export { searchMentions } from './search.js';
export { mentionContext, resolveMention } from './lookup.js';
