export interface ActiveJob {
  targetAgent: string;
  startedAt: string; // ISO 8601
  sessionName?: string;
}

export interface EnqueueOptions {
  sessionName?: string;
  parallel?: boolean;
}

export class AgentQueue {
  private chains = new Map<string, Promise<void>>();
  private activeJobs = new Map<string, Set<ActiveJob>>();
  private jobCounter = 0;

  get active(): ActiveJob[] {
    return [...this.activeJobs.values()].flatMap((set) => [...set]);
  }

  enqueue<T>(targetAgent: string, task: () => Promise<T>, options?: EnqueueOptions): Promise<T> {
    const runTask = async (): Promise<T> => {
      const job: ActiveJob = { targetAgent, startedAt: new Date().toISOString(), sessionName: options?.sessionName };
      const jobs = this.activeJobs.get(targetAgent) ?? new Set();
      this.activeJobs.set(targetAgent, jobs);
      jobs.add(job);
      try {
        return await task();
      } finally {
        jobs.delete(job);
        if (jobs.size === 0) this.activeJobs.delete(targetAgent);
      }
    };

    if (options?.parallel) {
      // Skip chaining — run immediately
      return runTask();
    }

    const prev = this.chains.get(targetAgent) ?? Promise.resolve();
    const next = prev.then(runTask);
    // Store void version so chain continues regardless of task result
    this.chains.set(targetAgent, next.then(() => {}, () => {}));
    return next;
  }
}
