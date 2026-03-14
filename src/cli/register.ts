import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getMcpServerPath(): string {
  return resolve(join(__dirname, '..', 'mcp', 'index.js'));
}

export async function registerMcpServer(global: boolean): Promise<void> {
  const mcpPath = getMcpServerPath();
  const scope = global ? '--scope user' : '--scope project';
  const cmd = `claude mcp add ${scope} dialup-mcp -- node ${mcpPath}`;

  console.log(`\n  Command: ${cmd}\n`);

  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('  MCP server registered successfully.');
  } catch (err) {
    console.error('  Failed to register MCP server. You can run the command manually:');
    console.log(`  ${cmd}`);
  }
}
