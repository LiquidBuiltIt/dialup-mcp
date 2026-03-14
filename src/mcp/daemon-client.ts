import * as net from 'node:net';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DAEMON_SOCKET_PATH, DAEMON_PID_FILE, DIALUP_DIR } from '../shared/constants.js';
import type {
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  AgentInfo,
  ListAgentsResult,
  AskAgentParams,
  AskAgentResult,
} from '../shared/types.js';
import { buildRequest, serializeMessage, createMessageParser } from '../shared/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REQUEST_TIMEOUT_MS = 610_000; // Slightly longer than 10min claude spawn timeout

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class DaemonClient {
  private socket: net.Socket | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private nextId = 0;

  async ensureDaemon(): Promise<void> {
    // Check if daemon is already running via PID file
    if (await this.isDaemonAlive()) return;

    // Spawn daemon process — strip CLAUDECODE so it doesn't propagate to claude --print spawns
    const daemonPath = join(__dirname, '..', 'daemon', 'index.js');
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const logPath = join(DIALUP_DIR, 'daemon.log');
    const logFd = fs.openSync(logPath, 'a');

    const child = spawn('node', [daemonPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: cleanEnv,
    });
    child.unref();

    // Wait for daemon socket to become connectable
    await this.waitForSocket(3000);
  }

  private async isDaemonAlive(): Promise<boolean> {
    try {
      const pidStr = await readFile(DAEMON_PID_FILE, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);
      if (isNaN(pid)) return false;
      process.kill(pid, 0); // Throws if process doesn't exist
      return true;
    } catch {
      return false;
    }
  }

  private waitForSocket(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const attempt = () => {
        if (Date.now() > deadline) {
          reject(new Error('Daemon did not start within timeout'));
          return;
        }

        const sock = net.connect(DAEMON_SOCKET_PATH);
        sock.on('connect', () => {
          sock.destroy();
          resolve();
        });
        sock.on('error', () => {
          sock.destroy();
          setTimeout(attempt, 100);
        });
      };

      attempt();
    });
  }

  async connect(): Promise<void> {
    if (this.socket) return;

    await this.ensureDaemon();

    return new Promise((resolve, reject) => {
      const socket = net.connect(DAEMON_SOCKET_PATH);

      socket.on('connect', () => {
        this.socket = socket;

        const parser = createMessageParser((msg) => {
          const response = msg as JsonRpcResponse;
          if (!('id' in response)) return;

          const pending = this.pendingRequests.get(response.id);
          if (!pending) return;

          this.pendingRequests.delete(response.id);
          clearTimeout(pending.timer);

          if ('error' in response) {
            const errResp = response as JsonRpcErrorResponse;
            pending.reject(new Error(errResp.error.message));
          } else {
            const successResp = response as JsonRpcSuccessResponse;
            pending.resolve(successResp.result);
          }
        });

        socket.on('data', parser);
        resolve();
      });

      socket.on('error', (err) => {
        if (!this.socket) {
          reject(err);
          return;
        }
        this.handleDisconnect(err);
      });

      socket.on('close', () => {
        this.handleDisconnect(new Error('Socket closed'));
      });
    });
  }

  private handleDisconnect(err: Error): void {
    this.socket = null;
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.socket) {
      await this.connect();
    }

    const id = ++this.nextId;
    const msg = buildRequest(method, params, id);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.socket!.write(serializeMessage(msg));
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
  }

  // --- Convenience methods ---

  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.request<ListAgentsResult>('dialup.listAgents', {});
    return result.agents;
  }

  async askAgent(params: AskAgentParams): Promise<AskAgentResult> {
    return this.request<AskAgentResult>('dialup.askAgent', params as unknown as Record<string, unknown>);
  }

  async askAgentExecute(params: AskAgentParams): Promise<AskAgentResult> {
    return this.request<AskAgentResult>('dialup.askAgent', {
      ...params,
      mode: 'execute',
    } as unknown as Record<string, unknown>);
  }

  async heartbeat(): Promise<void> {
    await this.request('dialup.heartbeat', {});
  }

}
