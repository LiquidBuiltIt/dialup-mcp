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

  it('parses config with executeMode: true', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      executeMode: true,
    });
    assert.equal(result.executeMode, true);
  });

  it('parses config with all fields', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      systemPrompt: 'You are helpful',
      executeMode: true,
    });
    assert.equal(result.systemPrompt, 'You are helpful');
    assert.equal(result.executeMode, true);
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

  it('rejects non-boolean executeMode values', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: 'yes',
      });
    });
  });

  it('rejects array executeMode (no longer supported)', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: ['Write', 'Edit'],
      });
    });
  });

  it('defaults model to haiku when not specified', () => {
    const result = DialupConfigSchema.parse({
      agent: 'my-agent',
      description: 'A test agent',
      executeMode: false,
    });
    assert.equal(result.model, 'haiku');
  });

  it('accepts valid model values', () => {
    for (const model of ['default', 'haiku', 'sonnet', 'opus']) {
      const result = DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: false,
        model,
      });
      assert.equal(result.model, model);
    }
  });

  it('rejects invalid model values', () => {
    assert.throws(() => {
      DialupConfigSchema.parse({
        agent: 'my-agent',
        description: 'A test agent',
        executeMode: false,
        model: 'gpt-4',
      });
    });
  });
});
