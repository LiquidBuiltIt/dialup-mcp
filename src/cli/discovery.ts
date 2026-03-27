import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_FILENAME } from '../shared/constants.js';
import { parseDialupConfig } from '../shared/config.js';

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

export interface DiscoveredAgent {
  agent: string;
  projectDir: string;
}

export async function discoverDialupConfigs(rootDirs: string[]): Promise<DiscoveredAgent[]> {
  const found: DiscoveredAgent[] = [];
  for (const root of rootDirs) {
    await walkForDialupConfig(root, 0, found);
  }
  return found;
}

async function walkForDialupConfig(dir: string, depth: number, found: DiscoveredAgent[]): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  let hasConfig = false;
  for (const entry of entries) {
    if (entry.name === CONFIG_FILENAME && entry.isFile()) {
      hasConfig = true;
      break;
    }
  }

  if (hasConfig) {
    try {
      const content = await readFile(join(dir, CONFIG_FILENAME), 'utf-8');
      const raw = JSON.parse(content);
      const config = parseDialupConfig(raw);
      found.push({ agent: config.agent, projectDir: dir });
    } catch {
      // Invalid config — skip silently
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    await walkForDialupConfig(join(dir, entry.name), depth + 1, found);
  }
}
