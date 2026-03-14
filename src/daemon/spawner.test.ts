import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeSystemPrompt, buildCollaboratorPrompt, TRUST_ZERO_PROMPT } from './spawner.js';

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
