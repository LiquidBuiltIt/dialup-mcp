import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CONFIG_FILENAME } from './constants.js';
import { AGENT_MODELS } from './types.js';
import type { DialupConfig } from './types.js';

const AgentModelSchema = z.enum(AGENT_MODELS);

export const DialupConfigSchema = z.object({
  agent: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().optional(),
  executeMode: z.boolean(),
  model: AgentModelSchema.default('haiku'),
  parallelWork: z.boolean().optional(),
});

export function parseDialupConfig(raw: unknown): DialupConfig {
  return DialupConfigSchema.parse(raw) as DialupConfig;
}

export async function loadDialupConfig(projectDir: string): Promise<DialupConfig | null> {
  try {
    const content = await readFile(join(projectDir, CONFIG_FILENAME), 'utf-8');
    const raw = JSON.parse(content);
    return parseDialupConfig(raw);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
