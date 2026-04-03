import * as net from 'node:net';
import { mkdir, unlink, writeFile, readFile, access } from 'node:fs/promises';
import { DIALUP_DIR, DAEMON_SOCKET_PATH, DAEMON_PID_FILE, SHUTDOWN_GRACE_MS } from '../shared/constants.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  AskAgentParams,
  AskAgentResult,
  RegisterAgentParams,
  ListAgentsResult,
  AgentCapabilities,
  DialupConfig,
  DaemonStatus,
  DaemonStatusAgent,
  DaemonStatusJob,
  DiscoverAgentsParams,
  DiscoverAgentInfo,
  DiscoverAgentsResult,
  ListAgentsParams,
} from '../shared/types.js';
import { EXECUTE_TOOLS, MCP_TOOL_PATTERN } from '../shared/types.js';
import { loadRegistry, saveRegistry } from '../shared/registry.js';
import { discoverDialupConfigs, getDefaultSearchRoots } from '../cli/discovery.js';
import { loadDialupConfig } from '../shared/config.js';
import { createMessageParser, serializeMessage, buildSuccessResponse, buildErrorResponse } from '../shared/protocol.js';
import { readMcpJson, introspectAllServers, buildFilteredMcpConfigJson } from '../shared/mcp-introspect.js';
import { ConversationManager } from './conversations.js';
import { AgentQueue } from './queue.js';
import { HeartbeatTracker } from './heartbeat.js';
import { composeSystemPrompt, composeMessage, spawnClaude } from './spawner.js';
import { ProcessRegistry } from './process-registry.js';
import { stageFiles, cleanupInbox } from './inbox.js';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

interface ResolvedAgent extends DialupConfig {
  project: string;
}

// Exported for testing
export interface AgentWithCapabilities {
  agent: string;
  description: string;
  executeEnabled: boolean;
  capabilities: AgentCapabilities;
}

export function filterAgentsByCapability(
  agents: AgentWithCapabilities[],
  filter: string | undefined,
): AgentWithCapabilities[] {
  if (!filter) return agents;
  const lower = filter.toLowerCase();
  return agents.filter((a) => {
    for (const [serverName, tools] of Object.entries(a.capabilities)) {
      if (serverName.toLowerCase().includes(lower)) return true;
      if (tools.some((tool) => tool.toLowerCase().includes(lower))) return true;
    }
    return false;
  });
}

export class DaemonServer {
  private server: net.Server | null = null;
  private agentRegistry = new Map<string, ResolvedAgent>();
  private capabilitiesCache = new Map<string, AgentCapabilities>();
  private conversationManager = new ConversationManager();
  private agentQueue = new AgentQueue();
  private processRegistry = new ProcessRegistry();
  private heartbeatTracker: HeartbeatTracker;
  private shuttingDown = false;
  private startedAt = Date.now();

  constructor() {
    this.heartbeatTracker = new HeartbeatTracker(() => this.shutdown());
  }

  async start(): Promise<void> {
    await mkdir(DIALUP_DIR, { recursive: true });

    // Clean up stale socket
    await this.cleanupStaleSocket();

    // Wipe conversations on fresh start
    await this.conversationManager.wipeAll();

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(DAEMON_SOCKET_PATH, () => resolve());
    });

    // Write PID file
    await writeFile(DAEMON_PID_FILE, process.pid.toString());

    // Load persistent agent registry
    const registry = await loadRegistry();
    for (const [agent, projectDir] of Object.entries(registry)) {
      const config = await loadDialupConfig(projectDir);
      if (!config) {
        console.error(`[dialup-daemon] Pruning stale agent '${agent}': no .dialup.config.json at ${projectDir}`);
        delete registry[agent];
        continue;
      }
      this.agentRegistry.set(agent, { ...config, project: projectDir });
    }

    // Auto-discover unregistered agents
    let discoveredCount = 0;
    try {
      const discovered = await discoverDialupConfigs(getDefaultSearchRoots());
      for (const { agent, projectDir } of discovered) {
        if (this.agentRegistry.has(agent)) continue; // Already registered
        const config = await loadDialupConfig(projectDir);
        if (!config) continue;
        this.agentRegistry.set(agent, { ...config, project: projectDir });
        registry[agent] = projectDir;
        discoveredCount++;
        console.error(`[dialup-daemon] Auto-discovered agent '${agent}' at ${projectDir}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[dialup-daemon] Discovery scan failed (non-fatal): ${msg}`);
    }

    // Persist updated registry (new discoveries + pruned stale entries)
    if (discoveredCount > 0 || Object.keys(registry).length !== this.agentRegistry.size) {
      await saveRegistry(registry);
    }

    console.error(`[dialup-daemon] Loaded ${this.agentRegistry.size} agent(s) (${discoveredCount} newly discovered)`);

    // Start TTL timer — first heartbeat must arrive within TTL
    this.heartbeatTracker.ping();

    console.error(`[dialup-daemon] Listening on ${DAEMON_SOCKET_PATH} (pid: ${process.pid})`);
  }

  private async cleanupStaleSocket(): Promise<void> {
    try {
      await access(DAEMON_SOCKET_PATH);
    } catch {
      return; // Socket doesn't exist, nothing to clean
    }

    // Socket file exists — check if the owning process is alive
    try {
      const pidStr = await readFile(DAEMON_PID_FILE, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0); // Check if process is alive
          // Process is alive — another daemon is running
          throw new Error(`Another daemon is already running (pid: ${pid})`);
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ESRCH') {
            // Process is dead — clean up stale files
            console.error('[dialup-daemon] Cleaning up stale socket from dead process');
          } else {
            throw err;
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No PID file — stale socket with no PID tracking, safe to clean
        console.error('[dialup-daemon] Cleaning up orphaned socket file');
      } else if (err instanceof Error && err.message.startsWith('Another daemon')) {
        throw err;
      }
      // Other errors: proceed with cleanup
    }

    try {
      await unlink(DAEMON_SOCKET_PATH);
    } catch {
      // Best effort
    }
    try {
      await unlink(DAEMON_PID_FILE);
    } catch {
      // Best effort
    }
  }

  private handleConnection(socket: net.Socket): void {
    const parser = createMessageParser((msg) => {
      const request = msg as JsonRpcRequest;
      if (!request.method) return; // Ignore responses
      this.handleRequest(socket, request);
    });

    socket.on('data', parser);
    socket.on('error', (err) => {
      console.error('[dialup-daemon] Socket error:', err.message);
    });
  }

  private async handleRequest(socket: net.Socket, request: JsonRpcRequest): Promise<void> {
    if (this.shuttingDown) {
      const response = buildErrorResponse(request.id, -32000, 'Daemon is shutting down');
      try { socket.write(serializeMessage(response)); } catch { /* socket may be closed */ }
      return;
    }

    let response: JsonRpcResponse;

    try {
      switch (request.method) {
        case 'dialup.discoverAgents':
          response = await this.handleDiscoverAgents(request);
          break;
        case 'dialup.listAgents':
          response = await this.handleListAgents(request);
          break;
        case 'dialup.askAgent':
          response = await this.handleAskAgent(request);
          break;
        case 'dialup.heartbeat':
          response = this.handleHeartbeat(request);
          break;
        case 'dialup.registerAgent':
          response = await this.handleRegisterAgent(request);
          break;
        case 'dialup.status':
          response = this.handleStatus(request);
          break;
        case 'dialup.kill':
          response = this.handleKill(request);
          break;
        default:
          response = buildErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      response = buildErrorResponse(request.id, -32000, message);
    }

    try {
      socket.write(serializeMessage(response));
    } catch {
      // Socket may have closed
    }
  }

  private async handleDiscoverAgents(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as unknown as DiscoverAgentsParams | undefined;
    const filter = params?.filter;

    if (filter) {
      const agentsWithCaps: AgentWithCapabilities[] = [];
      for (const r of this.agentRegistry.values()) {
        const capabilities = await this.getCapabilities(r);
        agentsWithCaps.push({
          agent: r.agent,
          description: r.description,
          executeEnabled: r.executeMode,
          capabilities,
        });
      }
      const filtered = filterAgentsByCapability(agentsWithCaps, filter);
      const agents: DiscoverAgentInfo[] = filtered.map(({ agent, description, executeEnabled }) => ({
        agent, description, executeEnabled,
      }));
      const result: DiscoverAgentsResult = { agents };
      return buildSuccessResponse(request.id, result);
    }

    const agents: DiscoverAgentInfo[] = [];
    for (const r of this.agentRegistry.values()) {
      agents.push({
        agent: r.agent,
        description: r.description,
        executeEnabled: r.executeMode,
      });
    }
    const result: DiscoverAgentsResult = { agents };
    return buildSuccessResponse(request.id, result);
  }

  private async handleListAgents(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as unknown as ListAgentsParams;

    if (!params?.agents?.length) {
      return buildErrorResponse(request.id, -32602, 'Missing required param: agents (array of agent names)');
    }

    const result: ListAgentsResult = { agents: {} };

    for (const name of params.agents) {
      const config = this.agentRegistry.get(name);
      if (!config) {
        return buildErrorResponse(
          request.id, -32001,
          `Agent '${name}' is not registered. Use discover_agents to see available agents.`,
        );
      }
      const capabilities = await this.getCapabilities(config);
      result.agents[name] = {
        description: config.description,
        executeEnabled: config.executeMode,
        capabilities,
      };
    }

    return buildSuccessResponse(request.id, result);
  }

  private async getCapabilities(agent: ResolvedAgent): Promise<AgentCapabilities> {
    if (!agent.executeMode) return {};

    // Return cached if available
    const cached = this.capabilitiesCache.get(agent.project);
    if (cached) return cached;

    // Build capabilities: builtIn tools + introspect MCP servers
    const capabilities: AgentCapabilities = {
      builtIn: [...EXECUTE_TOOLS],
    };

    const mcpJson = await readMcpJson(agent.project);
    if (mcpJson) {
      const serverTools = await introspectAllServers(mcpJson);
      for (const [server, tools] of Object.entries(serverTools)) {
        capabilities[server] = tools;
      }
    }

    this.capabilitiesCache.set(agent.project, capabilities);
    return capabilities;
  }

  private async handleAskAgent(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as unknown as AskAgentParams;

    if (!params?.targetAgent || !params?.message) {
      return buildErrorResponse(request.id, -32602, 'Missing required params: targetAgent, message');
    }

    const targetConfig = this.agentRegistry.get(params.targetAgent);
    if (!targetConfig) {
      return buildErrorResponse(
        request.id, -32001,
        `Agent '${params.targetAgent}' is not registered. Available: ${Array.from(this.agentRegistry.keys()).join(', ') || 'none'}`,
      );
    }

    const mode = params.mode ?? 'oracle';

    // Reject execute mode if target agent hasn't enabled it
    if (mode === 'execute' && !targetConfig.executeMode) {
      return buildErrorResponse(
        request.id, -32003,
        `Agent '${params.targetAgent}' does not have execute mode enabled. Set "executeMode": true in its .dialup.config.json.`,
      );
    }

    // Reject execute mode without tools or servers
    if (mode === 'execute' && (!params.tools?.length && !params.servers?.length)) {
      return buildErrorResponse(
        request.id, -32602,
        `Execute mode requires "tools" and/or "servers" specifying which tools to enable. Use discover_agents + list_agents to see available capabilities.`,
      );
    }

    const result = await this.agentQueue.enqueue<AskAgentResult>(params.targetAgent, async () => {
      // Stage files into target's inbox (if any)
      let inboxDir: string | null = null;
      if (params.files?.length) {
        inboxDir = await stageFiles(params.senderProject, targetConfig.project, params.files);
        console.error(`[dialup-daemon] Staged ${params.files.length} file(s) to ${inboxDir}`);
      }

      try {
        // Get or create conversation session
        const sessionId = this.conversationManager.getOrCreateSession(params.senderAgent, params.targetAgent, params.sessionName);

        // Resolve tools for this request
        let executeTools: string[] | undefined;
        let mcpConfigJson: string | undefined;

        if (mode === 'execute') {
          const capabilities = await this.getCapabilities(targetConfig);
          const allCapTools = new Set(Object.values(capabilities).flat());
          const allCapServers = new Set(Object.keys(capabilities).filter((k) => k !== 'builtIn'));

          // Validate individual tools
          const resolvedTools = new Set<string>();
          if (params.tools?.length) {
            for (const tool of params.tools) {
              if (!allCapTools.has(tool)) {
                throw new Error(`Tool "${tool}" is not available on agent '${params.targetAgent}'. Use discover_agents + list_agents to see available capabilities.`);
              }
              resolvedTools.add(tool);
            }
          }

          // Expand servers into all their tools
          if (params.servers?.length) {
            for (const server of params.servers) {
              if (!allCapServers.has(server)) {
                throw new Error(`MCP server "${server}" is not available on agent '${params.targetAgent}'. Available servers: ${[...allCapServers].join(', ') || 'none'}`);
              }
              for (const tool of capabilities[server]) {
                resolvedTools.add(tool);
              }
            }
          }

          executeTools = [...resolvedTools];

          // Build filtered MCP config for the spawned subprocess
          const mcpJson = await readMcpJson(targetConfig.project);
          if (mcpJson) {
            // Extract which MCP servers are needed from the resolved tools
            const neededServers = new Set<string>();
            for (const tool of resolvedTools) {
              if (MCP_TOOL_PATTERN.test(tool)) {
                const serverName = tool.split('__')[1];
                neededServers.add(serverName);
              }
            }
            if (neededServers.size > 0) {
              mcpConfigJson = buildFilteredMcpConfigJson(mcpJson, [...neededServers]);
            }
          }
        }

        const allTools = mode === 'execute' && executeTools?.length
          ? ['Read', 'Glob', 'Grep', ...executeTools]
          : ['Read', 'Glob', 'Grep'];

        // Build system prompt (mode determines oracle vs collaborator prompt)
        const systemPrompt = composeSystemPrompt({
          systemPrompt: targetConfig.systemPrompt,
          mode,
          senderAgent: params.senderAgent,
          senderProject: params.senderProject,
          availableTools: allTools,
          inboxDir: inboxDir ?? undefined,
        });

        // Build message with optional conversation history
        let conversationHistory: string | undefined;
        if (params.followUp) {
          const history = this.conversationManager.formatHistoryForPrompt(sessionId);
          if (history) conversationHistory = history;
        }
        const message = composeMessage({ conversationHistory, message: params.message });

        // Spawn claude with dynamically resolved tools + MCP config
        const spawnResult = await spawnClaude(targetConfig.project, systemPrompt, message, mode, executeTools, targetConfig.model, this.processRegistry, mcpConfigJson, params.targetAgent);

        // Defense-in-depth: reject empty responses even if spawnClaude didn't
        if (!spawnResult.response.trim()) {
          throw new Error(`Agent '${params.targetAgent}' returned an empty response`);
        }

        // Record the exchange (usage stays out of conversation history)
        await this.conversationManager.addExchange(sessionId, {
          sender: params.senderAgent,
          message: params.message,
          responder: params.targetAgent,
          response: spawnResult.response,
          timestamp: new Date().toISOString(),
        });

        return { response: spawnResult.response, sessionId, usage: spawnResult.usage };
      } finally {
        // Always clean up inbox, even on failure/timeout
        if (inboxDir) {
          await cleanupInbox(targetConfig.project);
          console.error(`[dialup-daemon] Cleaned up inbox at ${targetConfig.project}`);
        }
      }
    }, { sessionName: params.sessionName, parallel: targetConfig.parallelWork });

    return buildSuccessResponse(request.id, result);
  }

  private handleHeartbeat(request: JsonRpcRequest): JsonRpcResponse {
    this.heartbeatTracker.ping();
    return buildSuccessResponse(request.id, { ok: true });
  }

  private async handleRegisterAgent(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as unknown as RegisterAgentParams;
    if (!params?.agent || !params?.project) {
      return buildErrorResponse(request.id, -32602, 'Missing required params: agent, project');
    }
    const config = await loadDialupConfig(params.project);
    if (!config) {
      return buildErrorResponse(request.id, -32002, `No .dialup.config.json found at ${params.project}`);
    }
    this.agentRegistry.set(params.agent, { ...config, project: params.project });
    this.capabilitiesCache.delete(params.project); // Force re-introspect on next access
    console.error(`[dialup-daemon] Registered agent: ${params.agent} (${params.project})`);
    return buildSuccessResponse(request.id, { ok: true });
  }

  private handleKill(request: JsonRpcRequest): JsonRpcResponse {
    const params = request.params as unknown as { targetAgent?: string };
    if (!params?.targetAgent) {
      return buildErrorResponse(request.id, -32602, 'Missing required param: targetAgent');
    }

    const killed = this.processRegistry.kill(params.targetAgent);
    if (!killed) {
      return buildErrorResponse(
        request.id, -32004,
        `No active process for agent '${params.targetAgent}'. Active: ${this.agentQueue.active.map((j) => j.targetAgent).join(', ') || 'none'}`,
      );
    }

    console.error(`[dialup-daemon] Killed process for agent: ${params.targetAgent}`);
    return buildSuccessResponse(request.id, { ok: true, killed: params.targetAgent });
  }

  private handleStatus(request: JsonRpcRequest): JsonRpcResponse {
    const now = Date.now();
    const uptimeMs = now - this.startedAt;

    const agents: DaemonStatusAgent[] = [];
    for (const r of this.agentRegistry.values()) {
      agents.push({
        agent: r.agent,
        project: r.project,
        executeEnabled: r.executeMode,
      });
    }

    const activeJobs: DaemonStatusJob[] = this.agentQueue.active.map((job) => {
      const runningMs = now - new Date(job.startedAt).getTime();
      return {
        targetAgent: job.targetAgent,
        startedAt: job.startedAt,
        runningFor: formatDuration(runningMs),
        sessionName: job.sessionName,
      };
    });

    const status: DaemonStatus = {
      pid: process.pid,
      uptime: formatDuration(uptimeMs),
      uptimeMs,
      agents,
      activeJobs,
      activeProcesses: this.processRegistry.size,
      sessions: this.conversationManager.getSessionSummaries(),
    };

    return buildSuccessResponse(request.id, status);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    console.error('[dialup-daemon] Shutting down...');
    this.heartbeatTracker.stop();

    // 1. Stop accepting new connections
    if (this.server) {
      this.server.close();
    }

    // 2. Kill all spawned child processes
    const activeCount = this.processRegistry.size;
    if (activeCount > 0) {
      console.error(`[dialup-daemon] Killing ${activeCount} active child process(es)...`);
      this.processRegistry.killAll();
    }

    // 3. Brief grace period for in-flight request handlers to settle
    if (activeCount > 0) {
      console.error(`[dialup-daemon] Waiting up to ${SHUTDOWN_GRACE_MS}ms for cleanup...`);
      await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    }

    // 4. Wipe conversations and clean up files
    await this.conversationManager.wipeAll();
    try { await unlink(DAEMON_SOCKET_PATH); } catch { /* best effort */ }
    try { await unlink(DAEMON_PID_FILE); } catch { /* best effort */ }

    console.error('[dialup-daemon] Shutdown complete');
    process.exit(0);
  }
}
