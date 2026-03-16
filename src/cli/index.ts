#!/usr/bin/env node

import * as p from '@clack/prompts';
import { discoverProjects, getDefaultSearchRoots } from './discovery.js';
import { runWizard } from './wizard.js';
import { writeConfigs } from './config-writer.js';
import { registerMcpServer } from './register.js';
import { handleService } from './service.js';
import { handleRegister } from './register.cmd.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'service') {
    const action = args[1];
    if (!action) {
      console.error('Usage: dialup service <start|stop|restart|status>');
      process.exit(1);
    }
    await handleService(action);
    return;
  }

  if (command === 'register') {
    await handleRegister(args.slice(1));
    return;
  }

  if (command !== 'setup') {
    console.log('Usage:');
    console.log('  dialup setup                                            # interactive setup wizard');
    console.log('  dialup register --project <path> --agent <name> ...     # programmatic registration');
    console.log('  dialup service <start|stop|restart|status>              # manage daemon');
    console.log('');
    console.log('Register flags:');
    console.log('  --project <path>         Project directory (required)');
    console.log('  --agent <name>           Agent name (required)');
    console.log('  --description <desc>     Agent description (required)');
    console.log('  --executeMode <mode>     "false" or comma-separated tools: Bash,Write,Edit,NotebookEdit (required)');
    console.log('  --systemPrompt <prompt>  Custom system prompt (optional)');
    process.exit(0);
  }

  p.intro('dialup-mcp setup');

  const s = p.spinner();
  s.start('Scanning for Claude Code projects...');

  const roots = getDefaultSearchRoots();
  const projects = await discoverProjects(roots);

  if (projects.length === 0) {
    s.stop('No projects found');
    p.log.warn('No Claude Code projects found (no CLAUDE.md files detected).');
    p.outro('Nothing to do.');
    process.exit(0);
  }

  s.stop(`Found ${projects.length} project(s)`);

  const results = await runWizard(projects);

  if (results.length === 0) {
    p.outro('No projects selected.');
    process.exit(0);
  }

  // Write config files
  await writeConfigs(results);
  p.log.success(`Wrote .dialup.config.json to ${results.length} project(s)`);

  // Ask about MCP registration
  const global = await p.confirm({
    message: 'Add dialup-mcp globally to Claude Code?',
    initialValue: true,
  });

  if (p.isCancel(global)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const regSpinner = p.spinner();
  regSpinner.start('Registering MCP server...');

  try {
    await registerMcpServer(global);
    regSpinner.stop('MCP server registered');
  } catch {
    regSpinner.stop('Registration failed — run the command manually');
  }

  p.outro('Setup complete!');
}

main().catch((err) => {
  p.log.error(`Setup failed: ${err.message}`);
  process.exit(1);
});
