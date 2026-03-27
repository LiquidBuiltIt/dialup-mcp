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
    registry.register(fakeChild);
    assert.equal(registry.size, 1);
  });

  it('removes a process on deregister', () => {
    const fakeChild = { pid: 123, kill: () => true } as any;
    registry.register(fakeChild);
    registry.deregister(fakeChild);
    assert.equal(registry.size, 0);
  });

  it('killAll sends SIGTERM to all tracked processes', () => {
    const killed: number[] = [];
    const child1 = { pid: 1, kill: () => { killed.push(1); return true; } } as any;
    const child2 = { pid: 2, kill: () => { killed.push(2); return true; } } as any;
    registry.register(child1);
    registry.register(child2);
    registry.killAll();
    assert.deepEqual(killed.sort(), [1, 2]);
  });

  it('killAll tolerates already-dead processes', () => {
    const child = { pid: 999, kill: () => { throw new Error('No such process'); } } as any;
    registry.register(child);
    registry.killAll();
    assert.equal(registry.size, 0);
  });

  it('size is 0 after killAll', () => {
    const child = { pid: 1, kill: () => true } as any;
    registry.register(child);
    registry.killAll();
    assert.equal(registry.size, 0);
  });
});
