import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DaemonClient } from './daemon-client.js';

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
    'Send a read-only question to another agent. The target agent can read its project to answer but cannot modify files or run commands.',
    {
      agent: z.string().describe('Name of the target agent to ask'),
      message: z.string().describe('The question or message to send to the agent'),
      followUp: z.boolean().optional().default(false).describe('If true, includes previous conversation history with this agent'),
    },
    async (args) => {
      try {
        const result = await client.askAgent({
          senderAgent: selfAgent,
          senderProject: selfProject,
          targetAgent: args.agent,
          message: args.message,
          followUp: args.followUp,
        });
        return {
          content: [{ type: 'text' as const, text: result.response }],
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
    'Send a request to another agent with execution privileges. The target agent can read, write, edit files and run commands in its project to fulfill the request.',
    {
      agent: z.string().describe('Name of the target agent to ask'),
      message: z.string().describe('The request or instruction to send to the agent'),
      followUp: z.boolean().optional().default(false).describe('If true, includes previous conversation history with this agent'),
    },
    async (args) => {
      try {
        const result = await client.askAgentExecute({
          senderAgent: selfAgent,
          senderProject: selfProject,
          targetAgent: args.agent,
          message: args.message,
          followUp: args.followUp,
        });
        return {
          content: [{ type: 'text' as const, text: result.response }],
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
