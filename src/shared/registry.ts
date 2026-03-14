import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DIALUP_DIR, REGISTRY_FILE } from './constants.js';
import type { AgentRegistry } from './types.js';

export async function loadRegistry(): Promise<AgentRegistry> {
  try {
    const data = await readFile(REGISTRY_FILE, 'utf-8');
    return JSON.parse(data) as AgentRegistry;
  } catch {
    return {};
  }
}

export async function saveRegistry(registry: AgentRegistry): Promise<void> {
  await mkdir(DIALUP_DIR, { recursive: true });
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
}

export async function registerAgent(
  agent: string,
  projectDir: string,
): Promise<void> {
  const registry = await loadRegistry();
  registry[agent] = projectDir;
  await saveRegistry(registry);
}

export async function unregisterAgent(agent: string): Promise<void> {
  const registry = await loadRegistry();
  delete registry[agent];
  await saveRegistry(registry);
}
