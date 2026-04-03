import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { filterAgentsByCapability, type AgentWithCapabilities } from './server.js';

describe('filterAgentsByCapability', () => {
  const agents: AgentWithCapabilities[] = [
    {
      agent: 'web-agent',
      description: 'Has supersurf',
      executeEnabled: true,
      capabilities: {
        builtIn: ['Bash', 'Write', 'Edit'],
        supersurf: ['mcp__supersurf__browser_navigate', 'mcp__supersurf__browser_snapshot'],
      },
    },
    {
      agent: 'code-agent',
      description: 'Code only',
      executeEnabled: true,
      capabilities: {
        builtIn: ['Bash', 'Write', 'Edit'],
      },
    },
    {
      agent: 'oracle-agent',
      description: 'Read only',
      executeEnabled: false,
      capabilities: {},
    },
  ];

  it('returns all agents when no filter provided', () => {
    const result = filterAgentsByCapability(agents, undefined);
    assert.equal(result.length, 3);
  });

  it('filters by server name', () => {
    const result = filterAgentsByCapability(agents, 'supersurf');
    assert.equal(result.length, 1);
    assert.equal(result[0].agent, 'web-agent');
  });

  it('filters by tool name substring', () => {
    const result = filterAgentsByCapability(agents, 'browser_navigate');
    assert.equal(result.length, 1);
    assert.equal(result[0].agent, 'web-agent');
  });

  it('filters by built-in tool name', () => {
    const result = filterAgentsByCapability(agents, 'Bash');
    assert.equal(result.length, 2);
    const names = result.map((a) => a.agent).sort();
    assert.deepEqual(names, ['code-agent', 'web-agent']);
  });

  it('returns empty array when nothing matches', () => {
    const result = filterAgentsByCapability(agents, 'nonexistent_tool');
    assert.equal(result.length, 0);
  });

  it('is case-insensitive', () => {
    const result = filterAgentsByCapability(agents, 'SUPERSURF');
    assert.equal(result.length, 1);
    assert.equal(result[0].agent, 'web-agent');
  });
});
