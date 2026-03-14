import { HEARTBEAT_INTERVAL_MS } from '../shared/constants.js';
import type { DaemonClient } from './daemon-client.js';

export class HeartbeatSender {
  private interval: NodeJS.Timeout | null = null;
  private client: DaemonClient;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  start(): void {
    // Send immediate heartbeat
    this.sendHeartbeat();

    this.interval = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private sendHeartbeat(): void {
    this.client.heartbeat().catch((err) => {
      console.error('[dialup-mcp] Heartbeat failed:', err.message);
    });
  }
}
