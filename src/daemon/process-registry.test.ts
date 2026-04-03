import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessRegistry } from './process-registry.js';

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    registry = new ProcessRegistry();
  });

  it('tracks a registered process', () => {
    const fakeChild = { pid: 123, kill: () => true } as any;
    registry.register('agent-a', fakeChild);
    assert.equal(registry.size, 1);
  });

  it('removes a process on deregister', () => {
    const fakeChild = { pid: 123, kill: () => true } as any;
    registry.register('agent-a', fakeChild);
    registry.deregister('agent-a');
    assert.equal(registry.size, 0);
  });

  it('has() returns true for registered keys', () => {
    const fakeChild = { pid: 123, kill: () => true } as any;
    registry.register('agent-a', fakeChild);
    assert.equal(registry.has('agent-a'), true);
    assert.equal(registry.has('agent-b'), false);
  });

  it('kill() sends SIGTERM to specific agent and returns true', () => {
    let killed = false;
    const fakeChild = { pid: 123, kill: () => { killed = true; return true; } } as any;
    registry.register('agent-a', fakeChild);
    const result = registry.kill('agent-a');
    assert.equal(result, true);
    assert.equal(killed, true);
    assert.equal(registry.size, 0);
  });

  it('kill() returns false for unknown agent', () => {
    const result = registry.kill('nonexistent');
    assert.equal(result, false);
  });

  it('kill() tolerates already-dead process', () => {
    const fakeChild = { pid: 999, kill: () => { throw new Error('No such process'); } } as any;
    registry.register('agent-a', fakeChild);
    const result = registry.kill('agent-a');
    assert.equal(result, true);
    assert.equal(registry.size, 0);
  });

  it('killAll sends SIGTERM to all tracked processes', () => {
    const killed: number[] = [];
    const child1 = { pid: 1, kill: () => { killed.push(1); return true; } } as any;
    const child2 = { pid: 2, kill: () => { killed.push(2); return true; } } as any;
    registry.register('agent-a', child1);
    registry.register('agent-b', child2);
    registry.killAll();
    assert.deepEqual(killed.sort(), [1, 2]);
  });

  it('killAll tolerates already-dead processes', () => {
    const child = { pid: 999, kill: () => { throw new Error('No such process'); } } as any;
    registry.register('agent-a', child);
    registry.killAll();
    assert.equal(registry.size, 0);
  });

  it('size is 0 after killAll', () => {
    const child = { pid: 1, kill: () => true } as any;
    registry.register('agent-a', child);
    registry.killAll();
    assert.equal(registry.size, 0);
  });
});
