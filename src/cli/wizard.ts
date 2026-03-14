import * as p from '@clack/prompts';
import { basename } from 'node:path';
import { EXECUTE_TOOLS } from '../shared/types.js';
import type { ExecuteTool } from '../shared/types.js';

export interface WizardResult {
  projectDir: string;
  agent: string;
  description: string;
  systemPrompt?: string;
  executeMode: false | ExecuteTool[];
}

export async function runWizard(discoveredProjects: string[]): Promise<WizardResult[]> {
  const selected = await p.multiselect({
    message: 'Select projects to enable as dialup agents',
    options: discoveredProjects.map((dir) => ({
      value: dir,
      label: basename(dir),
      hint: dir,
    })),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const results: WizardResult[] = [];

  for (const projectDir of selected) {
    const defaultName = basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    p.log.step(`Configure: ${basename(projectDir)}`);

    const config = await p.group(
      {
        agent: () =>
          p.text({
            message: 'Agent name',
            placeholder: defaultName,
            defaultValue: defaultName,
          }),
        description: () =>
          p.text({
            message: 'Description',
            placeholder: 'What does this project/agent do?',
            validate: (val) => {
              if (!val || val.trim().length === 0) return 'Description is required';
            },
          }),
        systemPrompt: () =>
          p.text({
            message: 'System prompt (optional)',
            placeholder: 'Press enter to skip',
            defaultValue: '',
          }),
      },
      {
        onCancel: () => {
          p.cancel('Setup cancelled.');
          process.exit(0);
        },
      },
    );

    let executeMode: false | ExecuteTool[] = false;
    const enableExecute = await p.confirm({
      message: 'Enable execute mode? (allows other agents to run tools in this project)',
      initialValue: false,
    });
    if (p.isCancel(enableExecute)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    if (enableExecute) {
      const selectedTools = await p.multiselect({
        message: 'Which executive tools should remote agents be allowed to use?',
        options: EXECUTE_TOOLS.map((tool) => ({ value: tool, label: tool })),
        required: true,
      });
      if (p.isCancel(selectedTools)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      executeMode = selectedTools as ExecuteTool[];
    }

    results.push({
      projectDir,
      agent: config.agent,
      description: config.description,
      systemPrompt: config.systemPrompt || undefined,
      executeMode,
    });
  }

  return results;
}
