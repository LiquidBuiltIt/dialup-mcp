import { homedir } from 'node:os';
import { join } from 'node:path';

export const DIALUP_DIR = join(homedir(), '.dialup');
export const DAEMON_SOCKET_PATH = join(DIALUP_DIR, 'daemon.sock');
export const CONVERSATIONS_DIR = join(DIALUP_DIR, 'conversations');
export const DAEMON_PID_FILE = join(DIALUP_DIR, 'daemon.pid');

export const HEARTBEAT_INTERVAL_MS = 30_000;    // 30 seconds
export const DAEMON_TTL_MS = 180_000;            // 3 minutes

export const CONFIG_FILENAME = '.dialup.config.json';
export const REGISTRY_FILE = join(DIALUP_DIR, 'registry.json');
