import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DaemonClient } from './daemon-client.js';
import type { TokenUsage } from '../shared/types.js';

function formatResponse(response: string, usage?: TokenUsage): string {
  if (!usage) return response;
  const inK = usage.inputTokens >= 1000 ? `${(usage.inputTokens / 1000).toFixed(1)}k` : `${usage.inputTokens}`;
  const outK = usage.outputTokens >= 1000 ? `${(usage.outputTokens / 1000).toFixed(1)}k` : `${usage.outputTokens}`;
  return `${response}\n\n---\ndialup: ${inK} tokens in, ${outK} tokens out`;
}

export function registerTools(
  server: McpServer,
  client: DaemonClient,
  selfAgent: string,
  selfProject: string,
): void {
  server.tool(
    'list_agents',
    'List all available dialup agents across registered projects',
    async () => {
      try {
        const agents = await client.listAgents();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(agents, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'ask_agent_readonly',
    'Send a read-only question to another agent. The target agent can read its project to answer but cannot modify files or run commands. Optionally attach files from your project for the target agent to review.',
    {
      agent: z.string().describe('Name of the target agent to ask'),
      message: z.string().describe('The question or message to send to the agent'),
      followUp: z.boolean().optional().default(false).describe('If true, includes previous conversation history with this agent'),
      files: z.array(z.string()).optional().describe('File paths (relative to your project) to send to the target agent for review'),
    },
    async (args) => {
      try {
        const result = await client.askAgent({
          senderAgent: selfAgent,
          senderProject: selfProject,
          targetAgent: args.agent,
          message: args.message,
          followUp: args.followUp,
          files: args.files,
        });
        return {
          content: [{ type: 'text' as const, text: formatResponse(result.response, result.usage) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'ask_agent_execute',
    'Send a request to another agent with execution privileges. Specify which tools the agent should have access to (built-in tools like Bash/Write/Edit and MCP tools like mcp__supersurf__browser_navigate). Use list_agents to discover available capabilities first. You can pass individual tool names via "tools" and/or entire MCP server names via "servers" to grant access to all tools from those servers.',
    {
      agent: z.string().describe('Name of the target agent to ask'),
      message: z.string().describe('The request or instruction to send to the agent'),
      tools: z.array(z.string()).optional().describe('Individual tools to enable. Built-in: Bash, Write, Edit, NotebookEdit. MCP: mcp__<server>__<tool>. Use list_agents to see available tools.'),
      servers: z.array(z.string()).optional().describe('MCP server names to enable all tools from (e.g. "supersurf"). Use list_agents to see available servers.'),
      followUp: z.boolean().optional().default(false).describe('If true, includes previous conversation history with this agent'),
      files: z.array(z.string()).optional().describe('File paths (relative to your project) to send to the target agent'),
    },
    async (args) => {
      try {
        const result = await client.askAgentExecute({
          senderAgent: selfAgent,
          senderProject: selfProject,
          targetAgent: args.agent,
          message: args.message,
          followUp: args.followUp,
          files: args.files,
          tools: args.tools,
          servers: args.servers,
        });
        return {
          content: [{ type: 'text' as const, text: formatResponse(result.response, result.usage) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
