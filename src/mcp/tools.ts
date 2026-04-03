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
    'discover_agents',
    'Discover available dialup agents. Returns a lightweight directory of agent names and descriptions. Use the optional filter parameter to search for agents with specific capabilities (e.g. "supersurf", "Bash").',
    {
      filter: z.string().optional().describe('Filter agents by capability — matches against server names and tool names (case-insensitive substring match)'),
    },
    async (args) => {
      try {
        const agents = await client.discoverAgents(args.filter);
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
    'list_agents',
    'Get full capabilities for specific dialup agents. Returns tools and MCP servers available on each requested agent. Use discover_agents first to find agent names.',
    {
      agents: z.array(z.string()).min(1).describe('Agent names to query capabilities for'),
    },
    async (args) => {
      try {
        const capabilities = await client.listAgents(args.agents);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(capabilities, null, 2) }],
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
      sessionName: z.string().optional().describe('Human-readable label for this conversation (e.g. "AX feedback loop", "auth debugging"). Visible in `dialup service status`.'),
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
          sessionName: args.sessionName,
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
    'Send a request to another agent with execution privileges. Specify which tools the agent should have access to (built-in tools like Bash/Write/Edit and MCP tools like mcp__supersurf__browser_navigate). Use discover_agents then list_agents to find available capabilities. You can pass individual tool names via "tools" and/or entire MCP server names via "servers" to grant access to all tools from those servers.',
    {
      agent: z.string().describe('Name of the target agent to ask'),
      message: z.string().describe('The request or instruction to send to the agent'),
      sessionName: z.string().optional().describe('Human-readable label for this conversation (e.g. "AX feedback loop", "deploy fix"). Visible in `dialup service status`.'),
      tools: z.array(z.string()).optional().describe('Individual tools to enable. Built-in: Bash, Write, Edit, NotebookEdit. MCP: mcp__<server>__<tool>. Use discover_agents + list_agents to see available tools.'),
      servers: z.array(z.string()).optional().describe('MCP server names to enable all tools from (e.g. "supersurf"). Use discover_agents + list_agents to see available servers.'),
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
          sessionName: args.sessionName,
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
