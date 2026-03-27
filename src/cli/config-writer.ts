import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_FILENAME } from '../shared/constants.js';
import { registerAgent } from '../shared/registry.js';
import { notifyDaemon } from '../shared/notify.js';
import type { WizardResult } from './wizard.js';

export async function writeConfigs(results: WizardResult[]): Promise<void> {
  for (const result of results) {
    const config: Record<string, string | boolean> = {
      agent: result.agent,
      description: result.description,
    };
    if (result.systemPrompt) {
      config.systemPrompt = result.systemPrompt;
    }
    config.executeMode = result.executeMode;
    config.model = result.model;

    // Write per-project config (single source of truth)
    const filePath = join(result.projectDir, CONFIG_FILENAME);
    await writeFile(filePath, JSON.stringify(config, null, 2) + '\n');
    console.log(`  Wrote ${filePath}`);

    // Register agent name → project path in central registry
    await registerAgent(result.agent, result.projectDir);
    console.log(`  Registered '${result.agent}' in central registry`);

    // Notify running daemon (best effort — daemon may not be running)
    try {
      await notifyDaemon(result.agent, result.projectDir);
      console.log(`  Notified running daemon about '${result.agent}'`);
    } catch {
      console.log(`  Daemon not running — it will pick up '${result.agent}' on next start`);
    }
  }
}
