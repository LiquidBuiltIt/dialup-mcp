import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverDialupConfigs } from './discovery.js';

describe('discoverDialupConfigs', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'dialup-discovery-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('finds a .dialup.config.json in a direct child directory', async () => {
    const projectDir = join(tempRoot, 'my-project');
    await mkdir(projectDir);
    await writeFile(join(projectDir, '.dialup.config.json'), JSON.stringify({
      agent: 'my-agent',
      description: 'Test agent',
      executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    assert.equal(results.length, 1);
    assert.equal(results[0].agent, 'my-agent');
    assert.equal(results[0].projectDir, projectDir);
  });

  it('finds configs in nested directories up to MAX_DEPTH', async () => {
    const nested = join(tempRoot, 'a', 'b', 'project');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, '.dialup.config.json'), JSON.stringify({
      agent: 'nested-agent',
      description: 'Nested',
      executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    assert.equal(results.length, 1);
    assert.equal(results[0].agent, 'nested-agent');
  });

  it('skips node_modules and hidden directories', async () => {
    const nmDir = join(tempRoot, 'node_modules', 'some-pkg');
    const hiddenDir = join(tempRoot, '.hidden', 'project');
    await mkdir(nmDir, { recursive: true });
    await mkdir(hiddenDir, { recursive: true });
    await writeFile(join(nmDir, '.dialup.config.json'), JSON.stringify({
      agent: 'bad1', description: 'x', executeMode: false,
    }));
    await writeFile(join(hiddenDir, '.dialup.config.json'), JSON.stringify({
      agent: 'bad2', description: 'x', executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    assert.equal(results.length, 0);
  });

  it('skips configs that fail schema validation', async () => {
    const projectDir = join(tempRoot, 'bad-config');
    await mkdir(projectDir);
    await writeFile(join(projectDir, '.dialup.config.json'), JSON.stringify({
      agent: '',
      description: 'Test',
      executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    assert.equal(results.length, 0);
  });

  it('returns multiple agents from different directories', async () => {
    const proj1 = join(tempRoot, 'proj1');
    const proj2 = join(tempRoot, 'proj2');
    await mkdir(proj1);
    await mkdir(proj2);
    await writeFile(join(proj1, '.dialup.config.json'), JSON.stringify({
      agent: 'agent-1', description: 'First', executeMode: false,
    }));
    await writeFile(join(proj2, '.dialup.config.json'), JSON.stringify({
      agent: 'agent-2', description: 'Second', executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    const agents = results.map((r) => r.agent).sort();
    assert.deepEqual(agents, ['agent-1', 'agent-2']);
  });

  it('finds a config at the root directory itself', async () => {
    await writeFile(join(tempRoot, '.dialup.config.json'), JSON.stringify({
      agent: 'root-agent',
      description: 'At root',
      executeMode: false,
    }));

    const results = await discoverDialupConfigs([tempRoot]);
    assert.equal(results.length, 1);
    assert.equal(results[0].agent, 'root-agent');
    assert.equal(results[0].projectDir, tempRoot);
  });
});
