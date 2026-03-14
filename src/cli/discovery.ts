import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt']);
const MAX_DEPTH = 4;

export function getDefaultSearchRoots(): string[] {
  return [homedir()];
}

export async function discoverProjects(rootDirs: string[]): Promise<string[]> {
  const found = new Set<string>();

  for (const root of rootDirs) {
    await walkForClaudeMd(root, 0, found);
  }

  return Array.from(found).sort();
}

async function walkForClaudeMd(dir: string, depth: number, found: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied, etc.
  }

  for (const entry of entries) {
    if (entry.name === 'CLAUDE.md' && entry.isFile()) {
      found.add(dir);
      continue;
    }

    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    await walkForClaudeMd(join(dir, entry.name), depth + 1, found);
  }
}
