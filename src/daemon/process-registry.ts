import type { ChildProcess } from 'node:child_process';

export class ProcessRegistry {
  private processes = new Set<ChildProcess>();

  get size(): number {
    return this.processes.size;
  }

  register(child: ChildProcess): void {
    this.processes.add(child);
  }

  deregister(child: ChildProcess): void {
    this.processes.delete(child);
  }

  killAll(): void {
    for (const child of this.processes) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already dead — ignore
      }
    }
    this.processes.clear();
  }
}
