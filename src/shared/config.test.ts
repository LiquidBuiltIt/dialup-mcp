import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DialupConfigSchema } from './config.js';

describe('DialupConfigSchema', () => {
  it('parses a minimal valid config with executeMode: false', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      executeMode: false,
    });
    assert.equal(result.agent, 'my-agent');
    assert.equal(result.description, 'A test agent');
    assert.equal(result.executeMode, false);
    assert.equal(result.systemPrompt, undefined);
  });

  it('parses config with executeMode tool whitelist', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      executeMode: ['Bash', 'Write', 'Edit'],
    });
    assert.deepEqual(result.executeMode, ['Bash', 'Write', 'Edit']);
  });

  it('parses config with all fields', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      systemPrompt: 'You are helpful',
      executeMode: ['NotebookEdit'],
    });
    assert.equal(result.systemPrompt, 'You are helpful');
    assert.deepEqual(result.executeMode, ['NotebookEdit']);
  });

  it('rejects missing agent', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        description: 'A test agent',
        executeMode: false,
      });
    });
  });

  it('rejects missing description', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        executeMode: false,
      });
    });
  });

  it('rejects missing executeMode', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
      });
    });
  });

  it('rejects empty agent name', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: '',
        description: 'A test agent',
        executeMode: false,
      });
    });
  });

  it('rejects invalid tool names in executeMode', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: ['Read'],
      });
    });
  });

  it('rejects non-executive tools in executeMode', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: ['Glob'],
      });
    });
  });

  it('rejects random strings in executeMode', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: ['FakeToolThatDoesNotExist'],
      });
    });
  });

  it('accepts empty executeMode array', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      executeMode: [],
    });
    assert.deepEqual(result.executeMode, []);
  });
});
