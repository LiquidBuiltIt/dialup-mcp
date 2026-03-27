import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readMcpJson, buildFilteredMcpConfigJson } from './mcp-introspect.js';
import type { McpJson } from './mcp-introspect.js';

const TMP = join(import.meta.dirname, '..', '..', '.test-tmp-mcp-introspect');

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('readMcpJson', () => {
  it('reads a valid .mcp.json file', async () => {
    const mcpJson = {
      mcpServers: {
        supersurf: {
          command: 'node',
          args: ['/path/to/supersurf/cli.js'],
        },
      },
    };
    await writeFile(join(TMP, '.mcp.json'), JSON.stringify(mcpJson));
    const result = await readMcpJson(TMP);
    assert.deepEqual(result, mcpJson);
  });

  it('returns null when .mcp.json does not exist', async () => {
    const result = await readMcpJson(TMP);
    assert.equal(result, null);
  });

  it('returns null when .mcp.json is invalid JSON', async () => {
    await writeFile(join(TMP, '.mcp.json'), 'not json');
    const result = await readMcpJson(TMP);
    assert.equal(result, null);
  });

  it('returns null when .mcp.json has no mcpServers key', async () => {
    await writeFile(join(TMP, '.mcp.json'), JSON.stringify({ other: 'stuff' }));
    const result = await readMcpJson(TMP);
    assert.equal(result, null);
  });

  it('reads multiple servers', async () => {
    const mcpJson = {
      mcpServers: {
        supersurf: { command: 'node', args: ['/path/to/supersurf'] },
        'dialup-mcp': { command: 'npx', args: ['dialup-mcp'] },
      },
    };
    await writeFile(join(TMP, '.mcp.json'), JSON.stringify(mcpJson));
    const result = await readMcpJson(TMP);
    assert.ok(result);
    assert.deepEqual(Object.keys(result.mcpServers), ['supersurf', 'dialup-mcp']);
  });
});

describe('buildFilteredMcpConfigJson', () => {
  const fullConfig: McpJson = {
    mcpServers: {
      supersurf: { command: 'node', args: ['/path/to/supersurf'] },
      other: { command: 'node', args: ['/path/to/other'] },
      third: { command: 'node', args: ['/path/to/third'] },
    },
  };

  it('filters config to only include requested servers', () => {
    const result = buildFilteredMcpConfigJson(fullConfig, ['supersurf']);
    const parsed = JSON.parse(result);
    assert.ok('supersurf' in parsed.mcpServers);
    assert.ok(!('other' in parsed.mcpServers));
    assert.ok(!('third' in parsed.mcpServers));
  });

  it('includes multiple requested servers', () => {
    const result = buildFilteredMcpConfigJson(fullConfig, ['supersurf', 'third']);
    const parsed = JSON.parse(result);
    assert.ok('supersurf' in parsed.mcpServers);
    assert.ok(!('other' in parsed.mcpServers));
    assert.ok('third' in parsed.mcpServers);
  });

  it('returns empty mcpServers when no matching servers', () => {
    const result = buildFilteredMcpConfigJson(fullConfig, ['nonexistent']);
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.mcpServers, {});
  });

  it('returns empty mcpServers when serverNames is empty', () => {
    const result = buildFilteredMcpConfigJson(fullConfig, []);
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.mcpServers, {});
  });

  it('preserves server entry details', () => {
    const result = buildFilteredMcpConfigJson(fullConfig, ['supersurf']);
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.mcpServers.supersurf, { command: 'node', args: ['/path/to/supersurf'] });
  });
});
