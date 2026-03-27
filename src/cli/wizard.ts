import * as p from '@clack/prompts';
import { basename } from 'node:path';
import { AGENT_MODELS } from '../shared/types.js';
import type { AgentModel } from '../shared/types.js';

export interface WizardResult {
  projectDir: string;
  agent: string;
  description: string;
  systemPrompt?: string;
  executeMode: boolean;
  model: AgentModel;
}

export async function runWizard(discoveredProjects: string[]): Promise<WizardResult[]> {
  let selected: string[];

  if (discoveredProjects.length === 1) {
    // Skip multiselect when there's only one project — no point asking
    selected = discoveredProjects;
  } else {
    const chosen = await p.multiselect({
      message: 'Select projects to enable as dialup agents',
      options: discoveredProjects.map((dir) => ({
        value: dir,
        label: basename(dir),
        hint: dir,
      })),
      required: true,
    });

    if (p.isCancel(chosen)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    selected = chosen;
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

    const enableExecute = await p.confirm({
      message: 'Enable execute mode? (allows other agents to request tools in this project)',
      initialValue: false,
    });
    if (p.isCancel(enableExecute)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    const model = await p.select({
      message: 'Model to use for this agent',
      options: AGENT_MODELS.map((m) => ({
        value: m,
        label: m === 'default' ? 'default (uses your configured default)' : m,
      })),
      initialValue: 'haiku' as AgentModel,
    });
    if (p.isCancel(model)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    results.push({
      projectDir,
      agent: config.agent,
      description: config.description,
      systemPrompt: config.systemPrompt || undefined,
      executeMode: enableExecute as boolean,
      model: model as AgentModel,
    });
  }

  return results;
}
