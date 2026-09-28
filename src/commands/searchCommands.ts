import { textMatchesQuery } from '../services/trackSearch';
import type { PaletteCommand } from './paletteCommand';

/** A runnable search hit; nested hits carry their parent's title as a path. */
export interface CommandHit {
  command: PaletteCommand;
  path: string[];
}

const RANK_PREFIX = 0;
const RANK_CONTAINS = 1;
const RANK_KEYWORD = 2;

function rank(command: PaletteCommand, query: string): number | null {
  const title = command.title.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (title.startsWith(needle)) return RANK_PREFIX;
  if (textMatchesQuery(command.title, query)) return RANK_CONTAINS;
  if (command.keywords?.some(keyword => textMatchesQuery(keyword, query))) return RANK_KEYWORD;
  return null;
}

/**
 * Empty query lists the given level as-is. A query searches the level and one
 * level of children, so "English" finds the language entry directly; ties
 * keep the registry order.
 */
export function searchCommands(commands: readonly PaletteCommand[], query: string): CommandHit[] {
  if (!query.trim()) return commands.map(command => ({ command, path: [] }));

  const ranked: { hit: CommandHit; rank: number; order: number }[] = [];
  const consider = (command: PaletteCommand, path: string[]) => {
    const score = rank(command, query);
    if (score !== null) ranked.push({ hit: { command, path }, rank: score, order: ranked.length });
  };
  for (const command of commands) {
    consider(command, []);
    for (const child of command.children?.() ?? []) consider(child, [command.title]);
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(entry => entry.hit);
}

export interface CommandLevel {
  commands: PaletteCommand[];
  /** Titles of the entered parents, for the breadcrumb. */
  trail: string[];
}

/** Walks the id stack through the live command tree; stops at a vanished id. */
export function resolveCommandLevel(root: readonly PaletteCommand[], stack: readonly string[]): CommandLevel {
  let commands = [...root];
  const trail: string[] = [];
  for (const id of stack) {
    const parent = commands.find(command => command.id === id);
    if (!parent?.children) break;
    trail.push(parent.title);
    commands = parent.children();
  }
  return { commands, trail };
}
