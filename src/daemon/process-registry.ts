import type { ChildProcess } from 'node:child_process';

export class ProcessRegistry {
  private processes = new Map<string, ChildProcess>();

  get size(): number {
    return this.processes.size;
  }

  register(key: string, child: ChildProcess): void {
    this.processes.set(key, child);
  }

  deregister(key: string): void {
    this.processes.delete(key);
  }

  has(key: string): boolean {
    return this.processes.has(key);
  }

  kill(key: string): boolean {
    const child = this.processes.get(key);
    if (!child) return false;
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already dead — ignore
    }
    this.processes.delete(key);
    return true;
  }

  killAll(): void {
    for (const child of this.processes.values()) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already dead — ignore
      }
    }
    this.processes.clear();
  }
}
