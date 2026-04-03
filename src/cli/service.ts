import { readFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { DAEMON_PID_FILE, DAEMON_SOCKET_PATH, DIALUP_DIR } from '../shared/constants.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { DaemonClient } from '../mcp/daemon-client.js';
import type { DaemonStatus } from '../shared/types.js';

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

  // Poll until the process is actually dead (up to 10s)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // Check if still alive
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // Process is dead
      break;
    }
  }

  // Clean up stale files (daemon should have done this, but belt-and-suspenders)
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

async function checkActiveJobs(force: boolean): Promise<void> {
  if (force) return;

  const pid = await getDaemonPid();
  if (!pid) return; // not running, nothing to check

  try {
    const client = new DaemonClient();
    await client.connect();
    const status = await client.status();
    await client.disconnect();

    if (status.activeJobs.length > 0) {
      const jobs = status.activeJobs.map((j) => {
        const label = j.sessionName ? ` "${j.sessionName}"` : '';
        return `  → ${j.targetAgent}${label} (running for ${j.runningFor})`;
      }).join('\n');
      console.error(`Refusing — ${status.activeJobs.length} active job(s):\n${jobs}\n\nUse --force to override.`);
      process.exit(1);
    }
  } catch {
    // Can't reach daemon for status — proceed with stop anyway
  }
}

export async function handleService(action: string, extraArgs: string[] = []): Promise<void> {
  const force = extraArgs.includes('--force');

  switch (action) {
    case 'status': {
      const pid = await getDaemonPid();
      if (!pid) {
        console.log('Daemon not running');
        break;
      }

      // Try to get rich status from the daemon
      try {
        const client = new DaemonClient();
        await client.connect();
        const status = await client.status();
        await client.disconnect();
        printStatus(status);
      } catch {
        // Fallback if daemon doesn't respond to status RPC
        console.log(`Daemon running (pid: ${pid})`);
      }
      break;
    }
    case 'stop': {
      await checkActiveJobs(force);
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
      await checkActiveJobs(force);
      await stopDaemon();
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
    case 'kill': {
      const targetAgent = extraArgs[0];
      if (!targetAgent) {
        console.error('Usage: dialup service kill <agent-name>');
        process.exit(1);
      }

      const pid = await getDaemonPid();
      if (!pid) {
        console.error('Daemon not running');
        process.exit(1);
      }

      try {
        const client = new DaemonClient();
        await client.connect();
        await client.kill(targetAgent);
        await client.disconnect();
        console.log(`Killed job for agent: ${targetAgent}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Failed to kill: ${msg}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      console.error('Usage: dialup service <start|stop|restart|status|kill <agent>>');
      process.exit(1);
  }
}

function printStatus(status: DaemonStatus): void {
  console.log(`Daemon running (pid: ${status.pid}, uptime: ${status.uptime})`);
  console.log('');

  // Agents
  console.log(`Agents (${status.agents.length}):`);
  if (status.agents.length === 0) {
    console.log('  (none registered)');
  } else {
    for (const a of status.agents) {
      const mode = a.executeEnabled ? 'execute' : 'read-only';
      console.log(`  ${a.agent} [${mode}] — ${a.project}`);
    }
  }

  // Active jobs
  console.log('');
  console.log(`Active jobs (${status.activeJobs.length}):`);
  if (status.activeJobs.length === 0) {
    console.log('  (idle)');
  } else {
    for (const job of status.activeJobs) {
      const label = job.sessionName ? ` "${job.sessionName}"` : '';
      console.log(`  → ${job.targetAgent}${label} (running for ${job.runningFor})`);
    }
  }

  // Sessions
  console.log('');
  console.log(`Sessions (${status.sessions.length}):`);
  if (status.sessions.length === 0) {
    console.log('  (none)');
  } else {
    for (const s of status.sessions) {
      const label = s.sessionName ? ` "${s.sessionName}"` : '';
      console.log(`  ${s.sender} → ${s.recipient}${label} (${s.exchanges} exchange${s.exchanges !== 1 ? 's' : ''})`);
    }
  }

  // Processes
  console.log('');
  console.log(`Spawned processes: ${status.activeProcesses}`);
}
