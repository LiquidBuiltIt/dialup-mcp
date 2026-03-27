import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// --- Types ---

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpJson {
  mcpServers: Record<string, McpServerEntry>;
}

// --- Read .mcp.json ---

export async function readMcpJson(projectDir: string): Promise<McpJson | null> {
  try {
    const content = await readFile(join(projectDir, '.mcp.json'), 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      return null;
    }
    return parsed as McpJson;
  } catch {
    return null;
  }
}

// --- Introspect a single MCP server ---

const INTROSPECT_TIMEOUT_MS = 10_000;

export async function introspectMcpServer(serverName: string, entry: McpServerEntry): Promise<string[]> {
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: entry.env,
    stderr: 'pipe', // Don't pollute daemon stderr
  });

  const client = new Client(
    { name: 'dialup-introspect', version: '1.0.0' },
    { capabilities: {} },
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Introspection of "${serverName}" timed out after ${INTROSPECT_TIMEOUT_MS / 1000}s`)), INTROSPECT_TIMEOUT_MS),
  );

  try {
    await Promise.race([client.connect(transport), timeout]);
    const result = await Promise.race([client.listTools(), timeout]);
    return result.tools.map((tool) => `mcp__${serverName}__${tool.name}`);
  } finally {
    try { await transport.close(); } catch { /* best effort */ }
  }
}

// --- Introspect all MCP servers for a project ---

export async function introspectAllServers(mcpJson: McpJson): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {};

  for (const [serverName, entry] of Object.entries(mcpJson.mcpServers)) {
    try {
      results[serverName] = await introspectMcpServer(serverName, entry);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[dialup-daemon] Failed to introspect MCP server "${serverName}": ${msg}`);
      // Graceful degradation — omit this server from capabilities
    }
  }

  return results;
}

// --- Build filtered .mcp.json for --mcp-config ---

export function buildFilteredMcpConfigJson(mcpJson: McpJson, serverNames: string[]): string {
  const filtered: Record<string, McpServerEntry> = {};
  for (const name of serverNames) {
    if (name in mcpJson.mcpServers) {
      filtered[name] = mcpJson.mcpServers[name];
    }
  }
  return JSON.stringify({ mcpServers: filtered });
}
