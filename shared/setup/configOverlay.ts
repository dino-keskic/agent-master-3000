import path from 'path';

/**
 * The config folder the board hands OpenCode 2 when an extra config folder is
 * set: one made of symlinks into the global folder and the extra one.
 *
 * OpenCode 1.x loads `OPENCODE_CONFIG_DIR` on top of the global folder
 * (`~/.config/opencode`). OpenCode 2 makes it *the* global folder, so a shell
 * that sets it for some other tool hides the user's own agents, commands and
 * disabled built-ins without a word. The board keeps 1.x's meaning on both, so
 * the folders it reads (`opencodeConfigDirs`) are the folders OpenCode loads:
 * the extra folder wins where both have the same file, as it does when 1.x
 * loads it last.
 *
 * What belongs here: deciding what that folder holds. Building it on disk is
 * `server/setup/configOverlay.ts`.
 */

export type OverlaySide = 'global' | 'extra';

export interface OverlayEntry {
  name: string;
  /** A folder, following symlinks: what decides whether two of the same name are merged. */
  dir: boolean;
}

/** The two config files OpenCode 2 reads from its global folder, in the order it merges them. */
export const OVERLAY_CONFIG_SLOTS = ['opencode.json', 'opencode.jsonc'] as const;

/** Taken whole from one side rather than merged: a package tree or a repository is one thing, not a list of things. */
const WHOLE = new Set(['node_modules', '.git']);

/**
 * How deep two folders of the same name are merged. Agents, commands and
 * skills are one or two levels down; past that, the extra side's copy is used
 * whole rather than walking someone's arbitrarily deep tree on every start.
 */
export const MAX_MERGE_DEPTH = 4;

export interface OverlayLink {
  /** The name in the overlay folder. */
  name: string;
  side: OverlaySide;
  /** The name on that side, when it is not `name` (a config file moved to the other slot). */
  from?: string;
}

export interface OverlayLevel {
  links: OverlayLink[];
  /** Names both sides have as folders, to be made real folders and merged one level down. */
  merge: string[];
  /** Config files there was no slot for. */
  dropped: { side: OverlaySide; name: string }[];
}

/** Whether the OpenCode at `version` makes `OPENCODE_CONFIG_DIR` its global folder, and so needs the overlay. */
export function needsConfigOverlay(version: string | undefined): boolean {
  return Number(version?.split('.')[0]) >= 2;
}

/** The overlay beside the board's state file, so a scratch board never rebuilds the one the live board's OpenCode is reading. */
export function configOverlayPath(stateFile: string): string {
  const { dir, name } = path.parse(stateFile);
  return path.join(dir, `${name}.opencode-config`);
}

/**
 * Which side's config file goes in which of the two slots. Both slots load,
 * the second on top, so the global side's files come first and the extra
 * side's after — 1.x's order. Three or four files do not fit in two: then
 * each side keeps the one that wins inside its own folder (`opencode.jsonc`)
 * and the other is dropped, for the caller to say so.
 */
export function planConfigSlots(global: readonly string[], extra: readonly string[]): Pick<OverlayLevel, 'links' | 'dropped'> {
  const order = (names: readonly string[]) => OVERLAY_CONFIG_SLOTS.filter((slot) => names.includes(slot));
  let g: string[] = order(global);
  let x: string[] = order(extra);
  const dropped: OverlayLevel['dropped'] = [];
  if (g.length + x.length > OVERLAY_CONFIG_SLOTS.length) {
    const keepLast = (side: OverlaySide, names: string[]) => {
      names.slice(0, -1).forEach((name) => dropped.push({ side, name }));
      return names.slice(-1);
    };
    g = keepLast('global', g);
    x = keepLast('extra', x);
  }
  const files = [...g.map((from) => ({ side: 'global' as const, from })), ...x.map((from) => ({ side: 'extra' as const, from }))];
  const links = files.map(({ side, from }, i): OverlayLink => {
    const name: string = OVERLAY_CONFIG_SLOTS[i] ?? from;
    return from === name ? { name, side } : { name, side, from };
  });
  return { links, dropped };
}

/**
 * One folder of the overlay. A name only one side has links to it; a name
 * both have is merged when both are folders, and is the extra side's
 * otherwise. At the top (`depth` 0) the config files go through
 * `planConfigSlots` instead, since both sides' must load.
 */
export function planOverlayLevel(global: readonly OverlayEntry[], extra: readonly OverlayEntry[], depth: number): OverlayLevel {
  const isSlot = (name: string) => depth === 0 && (OVERLAY_CONFIG_SLOTS as readonly string[]).includes(name);
  const slotNames = (entries: readonly OverlayEntry[]) => entries.filter((e) => isSlot(e.name) && !e.dir).map((e) => e.name);
  const level: OverlayLevel = { links: [], merge: [], dropped: [] };
  if (depth === 0) {
    const slots = planConfigSlots(slotNames(global), slotNames(extra));
    level.links.push(...slots.links);
    level.dropped.push(...slots.dropped);
  }
  // A folder called `opencode.json` is nobody's config; it is left out rather than fight a slot for its name.
  const byName = (entries: readonly OverlayEntry[]) => new Map(entries.filter((e) => !isSlot(e.name)).map((e) => [e.name, e]));
  const g = byName(global);
  const x = byName(extra);
  const names = [...new Set([...g.keys(), ...x.keys()])].sort();
  for (const name of names) {
    const ge = g.get(name);
    const xe = x.get(name);
    if (ge && xe && ge.dir && xe.dir && !WHOLE.has(name) && depth < MAX_MERGE_DEPTH) level.merge.push(name);
    else level.links.push({ name, side: xe ? 'extra' : 'global' });
  }
  return level;
}
