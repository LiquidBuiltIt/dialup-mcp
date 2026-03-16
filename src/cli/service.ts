import { readFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { DAEMON_PID_FILE, DAEMON_SOCKET_PATH, DIALUP_DIR } from '../shared/constants.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getDaemonPid(): Promise<number | null> {
  try {
    const pidStr = await readFile(DAEMON_PID_FILE, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (isNaN(pid)) return null;
    process.kill(pid, 0); // throws if dead
    return pid;
  } catch {
    return null;
  }
}

async function stopDaemon(): Promise<boolean> {
  const pid = await getDaemonPid();
  if (!pid) return false;
  process.kill(pid, 'SIGTERM');
  // Clean up stale files
  try { await unlink(DAEMON_SOCKET_PATH); } catch { /* best effort */ }
  try { await unlink(DAEMON_PID_FILE); } catch { /* best effort */ }
  return true;
}

async function startDaemon(): Promise<boolean> {
  const existing = await getDaemonPid();
  if (existing) return false; // already running

  const daemonPath = join(__dirname, '..', 'daemon', 'index.js');
  const logPath = join(DIALUP_DIR, 'daemon.log');
  const logFd = fs.openSync(logPath, 'a');

  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  // Wait for socket to become connectable
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error('Daemon did not start within 3s'));
        return;
      }
      const sock = net.connect(DAEMON_SOCKET_PATH);
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => { sock.destroy(); setTimeout(attempt, 100); });
    };
    attempt();
  });

  return true;
}

export async function handleService(action: string): Promise<void> {
  switch (action) {
    case 'status': {
      const pid = await getDaemonPid();
      if (pid) {
        console.log(`Daemon running (pid: ${pid})`);
      } else {
        console.log('Daemon not running');
      }
      break;
    }
    case 'stop': {
      const stopped = await stopDaemon();
      if (stopped) {
        console.log('Daemon stopped');
      } else {
        console.log('Daemon not running');
      }
      break;
    }
    case 'start': {
      try {
        const started = await startDaemon();
        if (started) {
          console.log('Daemon started');
        } else {
          console.log('Daemon already running');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Failed to start daemon: ${msg}`);
        process.exit(1);
      }
      break;
    }
    case 'restart': {
      await stopDaemon();
      // Brief pause to let socket release
      await new Promise((r) => setTimeout(r, 500));
      try {
        await startDaemon();
        console.log('Daemon restarted');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Failed to restart daemon: ${msg}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      console.error('Usage: dialup service <start|stop|restart|status>');
      process.exit(1);
  }
}
