import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONFIG_FILENAME } from '../shared/constants.js';
import { EXECUTE_TOOLS } from '../shared/types.js';
import { parseDialupConfig } from '../shared/config.js';
import { registerAgent } from '../shared/registry.js';
import type { ExecuteTool } from '../shared/types.js';

interface RegisterArgs {
  project: string;
  agent: string;
  description: string;
  executeMode: false | ExecuteTool[];
  systemPrompt?: string;
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

  // Parse executeMode: "false" → false, "Write,Edit" → ['Write', 'Edit']
  let executeMode: false | ExecuteTool[];
  if (flags.executeMode === 'false') {
    executeMode = false;
  } else {
    const tools = flags.executeMode.split(',').map((t) => t.trim()).filter(Boolean);
    for (const tool of tools) {
      if (!EXECUTE_TOOLS.includes(tool as ExecuteTool)) {
        console.error(`Invalid tool in --executeMode: "${tool}"`);
        console.error(`Valid tools: ${EXECUTE_TOOLS.join(', ')}`);
        process.exit(1);
      }
    }
    executeMode = tools as ExecuteTool[];
  }

  return {
    project: resolve(flags.project),
    agent: flags.agent,
    description: flags.description,
    executeMode,
    systemPrompt: flags.systemPrompt || undefined,
  };
}

function printUsage(): void {
  console.error('\nUsage: dialup register --project <path> --agent <name> --description <desc> --executeMode <false|tools>');
  console.error('\nExamples:');
  console.error('  dialup register --project . --agent my-api --description "REST API" --executeMode false');
  console.error('  dialup register --project /path/to/project --agent my-api --description "REST API" --executeMode Write,Edit');
  console.error('  dialup register --project . --agent my-api --description "REST API" --executeMode Bash,Write,Edit --systemPrompt "Focus on API layer"');
}

export async function handleRegister(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Build config object and validate via schema
  const configObj: Record<string, string | string[] | false> = {
    agent: parsed.agent,
    description: parsed.description,
    executeMode: parsed.executeMode,
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
}
