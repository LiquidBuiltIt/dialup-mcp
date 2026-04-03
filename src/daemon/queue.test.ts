import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentQueue } from './queue.js';

describe('AgentQueue', () => {
  it('starts with no active jobs', () => {
    const queue = new AgentQueue();
    assert.deepEqual(queue.active, []);
  });

  it('tracks an active job while task is running', async () => {
    const queue = new AgentQueue();
    let captured: typeof queue.active = [];

    await queue.enqueue('test-agent', async () => {
      captured = queue.active;
      return 'done';
    });

    // During execution, job was active
    assert.equal(captured.length, 1);
    assert.equal(captured[0].targetAgent, 'test-agent');
    assert.ok(captured[0].startedAt); // ISO string present

    // After execution, job is cleared
    assert.deepEqual(queue.active, []);
  });

  it('clears active job even if task throws', async () => {
    const queue = new AgentQueue();

    await assert.rejects(
      queue.enqueue('failing-agent', async () => {
        throw new Error('boom');
      }),
      { message: 'boom' },
    );

    assert.deepEqual(queue.active, []);
  });

  it('serializes tasks per agent and tracks only the running one', async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    const p1 = queue.enqueue('agent-a', async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });

    const p2 = queue.enqueue('agent-a', async () => {
      order.push('second-start');
      // At this point, only the second task should be active
      assert.equal(queue.active.length, 1);
      assert.equal(queue.active[0].targetAgent, 'agent-a');
    });

    await Promise.all([p1, p2]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
  });

  it('tracks concurrent jobs for different agents', async () => {
    const queue = new AgentQueue();
    let snapshotDuringBoth: typeof queue.active = [];

    let releaseA: () => void = () => {};
    const waitA = new Promise<void>((r) => { releaseA = r; });
    let releaseB: () => void = () => {};
    const waitB = new Promise<void>((r) => { releaseB = r; });

    const pA = queue.enqueue('agent-a', async () => {
      await waitA;
    });

    const pB = queue.enqueue('agent-b', async () => {
      // Both agent-a and agent-b are now active
      snapshotDuringBoth = queue.active;
      releaseA(); // let agent-a finish
      await waitB;
    });

    // Give agent-b time to start and capture snapshot
    await new Promise((r) => setTimeout(r, 20));
    releaseB();

    await Promise.all([pA, pB]);

    // Both agents were active concurrently when snapshot was taken
    assert.equal(snapshotDuringBoth.length, 2);
    const agents = snapshotDuringBoth.map((j) => j.targetAgent).sort();
    assert.deepEqual(agents, ['agent-a', 'agent-b']);
  });

  it('includes sessionName on active job when provided', async () => {
    const queue = new AgentQueue();
    let captured: typeof queue.active = [];

    await queue.enqueue('test-agent', async () => {
      captured = queue.active;
      return 'done';
    }, { sessionName: 'AX feedback loop' });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].sessionName, 'AX feedback loop');
  });

  it('sessionName is undefined when not provided', async () => {
    const queue = new AgentQueue();
    let captured: typeof queue.active = [];

    await queue.enqueue('test-agent', async () => {
      captured = queue.active;
      return 'done';
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].sessionName, undefined);
  });

  it('runs tasks in parallel for the same agent when parallel option is true', async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    let releaseFirst: () => void = () => {};
    const waitFirst = new Promise<void>((r) => { releaseFirst = r; });
    let releaseSecond: () => void = () => {};
    const waitSecond = new Promise<void>((r) => { releaseSecond = r; });

    const p1 = queue.enqueue('agent-a', async () => {
      order.push('first-start');
      await waitFirst;
      order.push('first-end');
    }, { parallel: true });

    const p2 = queue.enqueue('agent-a', async () => {
      order.push('second-start');
      await waitSecond;
      order.push('second-end');
    }, { parallel: true });

    // Give both tasks time to start
    await new Promise((r) => setTimeout(r, 20));

    // Both should have started (parallel, not serialized)
    assert.deepEqual(order, ['first-start', 'second-start']);

    // Both should be tracked as active
    assert.equal(queue.active.length, 2);
    const agents = queue.active.map((j) => j.targetAgent);
    assert.deepEqual(agents, ['agent-a', 'agent-a']);

    releaseFirst();
    releaseSecond();
    await Promise.all([p1, p2]);

    assert.deepEqual(order, ['first-start', 'second-start', 'first-end', 'second-end']);
    assert.deepEqual(queue.active, []);
  });

  it('still serializes tasks when parallel is not set', async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    const p1 = queue.enqueue('agent-a', async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });

    const p2 = queue.enqueue('agent-a', async () => {
      order.push('second-start');
    });

    await Promise.all([p1, p2]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
  });
});
