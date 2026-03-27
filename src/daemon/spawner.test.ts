import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeSystemPrompt, buildCollaboratorPrompt, TRUST_ZERO_PROMPT, validateSpawnResult, buildSpawnArgs, DISALLOWED_PATTERNS } from './spawner.js';

describe('composeSystemPrompt', () => {
  it('returns trust-zero prompt for oracle mode', () => {
    const result = composeSystemPrompt({ mode: 'oracle' });
    assert.equal(result, TRUST_ZERO_PROMPT);
  });

  it('returns trust-zero prompt when mode is undefined', () => {
    const result = composeSystemPrompt({});
    assert.equal(result, TRUST_ZERO_PROMPT);
  });

  it('appends user systemPrompt to trust-zero in oracle mode', () => {
    const result = composeSystemPrompt({
      mode: 'oracle',
      systemPrompt: 'Be extra concise',
    });
    assert.ok(result.startsWith(TRUST_ZERO_PROMPT));
    assert.ok(result.includes('Be extra concise'));
  });

  it('returns collaborator prompt for execute mode with sender info', () => {
    const result = composeSystemPrompt({
      mode: 'execute',
      senderAgent: 'test-agent',
      senderProject: '/tmp/test-project',
      availableTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    });
    assert.ok(result.includes('test-agent'));
    assert.ok(result.includes('/tmp/test-project'));
    assert.ok(result.includes('UNTRUSTED COLLABORATOR'));
    assert.ok(result.includes('Read, Glob, Grep, Write, Edit'));
  });

  it('falls back to trust-zero if execute mode lacks sender info', () => {
    const result = composeSystemPrompt({ mode: 'execute' });
    assert.equal(result, TRUST_ZERO_PROMPT);
  });

  it('appends user systemPrompt to collaborator prompt in execute mode', () => {
    const result = composeSystemPrompt({
      mode: 'execute',
      senderAgent: 'test-agent',
      senderProject: '/tmp/test-project',
      availableTools: ['Read', 'Glob', 'Grep', 'Bash'],
      systemPrompt: 'Focus on API endpoints',
    });
    assert.ok(result.includes('UNTRUSTED COLLABORATOR'));
    assert.ok(result.includes('Focus on API endpoints'));
  });

  it('injects inbox directory into system prompt when provided', () => {
    const result = composeSystemPrompt({
      mode: 'oracle',
      inboxDir: '/tmp/target-project/.dialup-inbox',
    });
    assert.ok(result.includes('FILE INBOX'));
    assert.ok(result.includes('/tmp/target-project/.dialup-inbox'));
    assert.ok(result.includes('temporary'));
  });

  it('does not inject inbox when inboxDir is undefined', () => {
    const result = composeSystemPrompt({ mode: 'oracle' });
    assert.ok(!result.includes('FILE INBOX'));
    assert.ok(!result.includes('.dialup-inbox'));
  });

  it('includes both systemPrompt and inboxDir when both provided', () => {
    const result = composeSystemPrompt({
      mode: 'oracle',
      systemPrompt: 'Custom prompt',
      inboxDir: '/tmp/project/.dialup-inbox',
    });
    assert.ok(result.includes('Custom prompt'));
    assert.ok(result.includes('FILE INBOX'));
    assert.ok(result.includes('/tmp/project/.dialup-inbox'));
  });

  it('includes inbox in execute mode prompt', () => {
    const result = composeSystemPrompt({
      mode: 'execute',
      senderAgent: 'test-agent',
      senderProject: '/tmp/sender',
      availableTools: ['Read', 'Glob', 'Grep', 'Write'],
      inboxDir: '/tmp/target/.dialup-inbox',
    });
    assert.ok(result.includes('UNTRUSTED COLLABORATOR'));
    assert.ok(result.includes('FILE INBOX'));
    assert.ok(result.includes('/tmp/target/.dialup-inbox'));
  });
});

describe('validateSpawnResult', () => {
  const jsonResult = (result: string, usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }) =>
    JSON.stringify({ type: 'result', result, usage: usage ?? { input_tokens: 10, output_tokens: 5 } });

  it('parses JSON and returns response with usage', () => {
    const result = validateSpawnResult(jsonResult('Hello from agent', { input_tokens: 100, output_tokens: 50 }), '', 0);
    assert.equal(result.response, 'Hello from agent');
    assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 });
  });

  it('sums cache tokens into inputTokens', () => {
    const result = validateSpawnResult(jsonResult('response', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 }), '', 0);
    assert.equal(result.usage?.inputTokens, 160);
    assert.equal(result.usage?.outputTokens, 5);
  });

  it('trims whitespace from result field', () => {
    const result = validateSpawnResult(jsonResult('  response  \n'), '', 0);
    assert.equal(result.response, 'response');
  });

  it('falls back to raw text when stdout is not JSON', () => {
    const result = validateSpawnResult('plain text response', '', 0);
    assert.equal(result.response, 'plain text response');
    assert.equal(result.usage, undefined);
  });

  it('throws on empty stdout with exit code 0', () => {
    assert.throws(
      () => validateSpawnResult('', '', 0),
      (err: Error) => {
        assert.ok(err.message.includes('empty response'));
        return true;
      },
    );
  });

  it('throws on whitespace-only stdout with exit code 0', () => {
    assert.throws(
      () => validateSpawnResult('   \n  ', '', 0),
      (err: Error) => {
        assert.ok(err.message.includes('empty response'));
        return true;
      },
    );
  });

  it('throws when JSON result field is empty', () => {
    assert.throws(
      () => validateSpawnResult(jsonResult(''), '', 0),
      (err: Error) => {
        assert.ok(err.message.includes('empty response'));
        return true;
      },
    );
  });

  it('includes stderr in error when stdout is empty and stderr has content', () => {
    assert.throws(
      () => validateSpawnResult('', 'some warning output', 0),
      (err: Error) => {
        assert.ok(err.message.includes('empty response'));
        assert.ok(err.message.includes('some warning output'));
        return true;
      },
    );
  });

  it('throws on non-zero exit code', () => {
    assert.throws(
      () => validateSpawnResult('', 'fatal error', 1),
      (err: Error) => {
        assert.ok(err.message.includes('Agent failed'));
        assert.ok(err.message.includes('fatal error'));
        return true;
      },
    );
  });

  it('uses stdout as error message when stderr is empty on non-zero exit', () => {
    assert.throws(
      () => validateSpawnResult('error output on stdout', '', 1),
      (err: Error) => {
        assert.ok(err.message.includes('error output on stdout'));
        return true;
      },
    );
  });

  it('throws on null exit code (process killed by signal)', () => {
    assert.throws(
      () => validateSpawnResult('', '', null),
      (err: Error) => {
        assert.ok(err.message.includes('Agent failed'));
        return true;
      },
    );
  });
});

describe('buildSpawnArgs', () => {
  it('includes --print flag', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
    });
    assert.ok(args.includes('--print'));
  });

  it('includes --system-prompt with value', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'Custom prompt',
      tools: ['Read'],
    });
    const idx = args.indexOf('--system-prompt');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'Custom prompt');
  });

  it('includes --allowedTools with comma-separated tools', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read', 'Glob', 'Grep'],
    });
    const idx = args.indexOf('--allowedTools');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'Read,Glob,Grep');
  });

  it('includes --model when model is not default', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
      model: 'sonnet',
    });
    const idx = args.indexOf('--model');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'sonnet');
  });

  it('omits --model when model is default', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
      model: 'default',
    });
    assert.ok(!args.includes('--model'));
  });

  it('omits --model when model is undefined', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
    });
    assert.ok(!args.includes('--model'));
  });

  it('includes --disallowedTools for execute mode', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read', 'Write'],
      mode: 'execute',
    });
    const disallowedCount = args.filter((a: string) => a === '--disallowedTools').length;
    assert.equal(disallowedCount, DISALLOWED_PATTERNS.length, 'should have one --disallowedTools per pattern');
  });

  it('omits --disallowedTools for oracle mode', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
      mode: 'oracle',
    });
    assert.ok(!args.includes('--disallowedTools'));
  });

  it('does not include --project-dir (cwd handles project context)', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read'],
    });
    assert.ok(!args.includes('--project-dir'));
  });

  it('includes MCP tools in --allowedTools when provided', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read', 'Glob', 'Grep', 'Write', 'mcp__supersurf__browser_navigate'],
      mode: 'execute',
    });
    const idx = args.indexOf('--allowedTools');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'Read,Glob,Grep,Write,mcp__supersurf__browser_navigate');
  });

  it('includes --mcp-config when mcpConfigJson is provided', () => {
    const mcpJson = JSON.stringify({ mcpServers: { supersurf: { command: 'node', args: [] } } });
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read', 'Write', 'mcp__supersurf__browser_navigate'],
      mode: 'execute',
      mcpConfigJson: mcpJson,
    });
    const idx = args.indexOf('--mcp-config');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], mcpJson);
  });

  it('omits --mcp-config when not provided', () => {
    const args = buildSpawnArgs({
      systemPrompt: 'test',
      tools: ['Read', 'Write'],
      mode: 'execute',
    });
    assert.ok(!args.includes('--mcp-config'));
  });
});

describe('buildCollaboratorPrompt', () => {
  it('includes sender identity', () => {
    const result = buildCollaboratorPrompt({
      senderAgent: 'frontend-dev',
      senderProject: '/home/user/frontend',
      availableTools: ['Read', 'Write'],
    });
    assert.ok(result.includes('frontend-dev'));
    assert.ok(result.includes('/home/user/frontend'));
  });

  it('lists available tools', () => {
    const result = buildCollaboratorPrompt({
      senderAgent: 'test',
      senderProject: '/tmp',
      availableTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    });
    assert.ok(result.includes('Read, Glob, Grep, Bash, Write, Edit'));
  });

  it('includes deletion prohibition', () => {
    const result = buildCollaboratorPrompt({
      senderAgent: 'test',
      senderProject: '/tmp',
      availableTools: ['Read'],
    });
    assert.ok(result.includes('MUST NOT delete'));
  });

  it('includes git write prohibition', () => {
    const result = buildCollaboratorPrompt({
      senderAgent: 'test',
      senderProject: '/tmp',
      availableTools: ['Read'],
    });
    assert.ok(result.includes('MUST NOT create git commits'));
  });

  it('includes untrusted collaborator framing', () => {
    const result = buildCollaboratorPrompt({
      senderAgent: 'test',
      senderProject: '/tmp',
      availableTools: ['Read'],
    });
    assert.ok(result.includes('UNTRUSTED COLLABORATOR'));
  });
});
