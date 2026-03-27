import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONFIG_FILENAME } from '../shared/constants.js';
import { AGENT_MODELS } from '../shared/types.js';
import { parseDialupConfig } from '../shared/config.js';
import { registerAgent } from '../shared/registry.js';
import { notifyDaemon } from '../shared/notify.js';
import type { AgentModel } from '../shared/types.js';

interface RegisterArgs {
  project: string;
  agent: string;
  description: string;
  executeMode: boolean;
  systemPrompt?: string;
  model: AgentModel;
}

function parseArgs(args: string[]): RegisterArgs {
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2);
      flags[key] = args[++i];
    }
  }

  if (!flags.project) {
    console.error('Missing required flag: --project');
    printUsage();
    process.exit(1);
  }
  if (!flags.agent) {
    console.error('Missing required flag: --agent');
    printUsage();
    process.exit(1);
  }
  if (!flags.description) {
    console.error('Missing required flag: --description');
    printUsage();
    process.exit(1);
  }
  if (!('executeMode' in flags)) {
    console.error('Missing required flag: --executeMode');
    printUsage();
    process.exit(1);
  }

  // Parse executeMode: "false" → false, "true" → true
  let executeMode: boolean;
  if (flags.executeMode === 'false') {
    executeMode = false;
  } else if (flags.executeMode === 'true') {
    executeMode = true;
  } else {
    console.error(`Invalid --executeMode: "${flags.executeMode}". Must be "true" or "false".`);
    printUsage();
    process.exit(1);
  }

  // Parse model: default to 'default' if not provided
  const model = (flags.model || 'haiku') as AgentModel;
  if (!AGENT_MODELS.includes(model)) {
    console.error(`Invalid --model: "${flags.model}"`);
    console.error(`Valid models: ${AGENT_MODELS.join(', ')}`);
    process.exit(1);
  }

  return {
    project: resolve(flags.project),
    agent: flags.agent,
    description: flags.description,
    executeMode,
    systemPrompt: flags.systemPrompt || undefined,
    model,
  };
}

function printUsage(): void {
  console.error('\nUsage: dialup register --project <path> --agent <name> --description <desc> --executeMode <true|false>');
  console.error('\nExamples:');
  console.error('  dialup register --project . --agent my-api --description "REST API" --executeMode false');
  console.error('  dialup register --project . --agent workspace --description "Browser automation" --executeMode true');
  console.error('  dialup register --project . --agent my-api --description "REST API" --executeMode true --systemPrompt "Focus on API layer"');
  console.error('  dialup register --project . --agent my-api --description "REST API" --executeMode false --model haiku');
}

export async function handleRegister(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Build config object and validate via schema
  const configObj: Record<string, string | boolean> = {
    agent: parsed.agent,
    description: parsed.description,
    executeMode: parsed.executeMode,
    model: parsed.model,
  };
  if (parsed.systemPrompt) {
    configObj.systemPrompt = parsed.systemPrompt;
  }

  // Validate through Zod schema
  try {
    parseDialupConfig(configObj);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown validation error';
    console.error(`Invalid config: ${msg}`);
    process.exit(1);
  }

  // Write .dialup.config.json
  const filePath = join(parsed.project, CONFIG_FILENAME);
  await writeFile(filePath, JSON.stringify(configObj, null, 2) + '\n');
  console.log(`Wrote ${filePath}`);

  // Register in central registry
  await registerAgent(parsed.agent, parsed.project);
  console.log(`Registered '${parsed.agent}' in central registry`);

  // Notify running daemon (best effort — daemon may not be running)
  try {
    await notifyDaemon(parsed.agent, parsed.project);
    console.log(`Notified running daemon about '${parsed.agent}'`);
  } catch {
    console.log('Daemon not running — it will pick up the agent on next start');
  }
}

