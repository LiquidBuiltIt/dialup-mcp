import { DAEMON_TTL_MS } from '../shared/constants.js';

export class HeartbeatTracker {
  private timer: NodeJS.Timeout | null = null;
  private onExpired: () => void;

  constructor(onExpired: () => void) {
    this.onExpired = onExpired;
  }

  ping(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.onExpired, DAEMON_TTL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
