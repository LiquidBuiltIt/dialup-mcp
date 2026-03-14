import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadDialupConfig } from '../shared/config.js';
import { DaemonClient } from './daemon-client.js';
import { HeartbeatSender } from './heartbeat.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const projectDir = process.cwd();
  const config = await loadDialupConfig(projectDir);

  // Derive sender identity — use config agent name if registered, otherwise project dir name
  const senderAgent = config?.agent ?? path.basename(projectDir);

  // Create daemon client and ensure daemon is running
  const client = new DaemonClient();

  // Start heartbeat
  const heartbeat = new HeartbeatSender(client);
  heartbeat.start();

  // Create MCP server
  const mcpServer = new McpServer(
    { name: 'dialup-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Register tools
  registerTools(mcpServer, client, senderAgent, projectDir);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error(`[dialup-mcp] Connected as '${senderAgent}'`);

  // Cleanup on exit
  const cleanup = async () => {
    heartbeat.stop();
    await client.disconnect();
    await mcpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch((err) => {
  console.error('[dialup-mcp] Fatal:', err);
  process.exit(1);
});
