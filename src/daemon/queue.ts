export class AgentQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue<T>(targetAgent: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(targetAgent) ?? Promise.resolve();
    const next = prev.then(() => task());
    // Store void version so chain continues regardless of task result
    this.chains.set(targetAgent, next.then(() => {}, () => {}));
    return next;
  }
}
