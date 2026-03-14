import * as net from 'node:net';
import { mkdir, unlink, writeFile, readFile, access } from 'node:fs/promises';
import { DIALUP_DIR, DAEMON_SOCKET_PATH, DAEMON_PID_FILE } from '../shared/constants.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  AskAgentParams,
  AskAgentResult,
  RegisterAgentParams,
  ListAgentsResult,
  AgentInfo,
  DialupConfig,
} from '../shared/types.js';
import { loadRegistry } from '../shared/registry.js';
import { loadDialupConfig } from '../shared/config.js';
import { createMessageParser, serializeMessage, buildSuccessResponse, buildErrorResponse } from '../shared/protocol.js';
import { ConversationManager } from './conversations.js';
import { AgentQueue } from './queue.js';
import { HeartbeatTracker } from './heartbeat.js';
import { composeSystemPrompt, composeMessage, spawnClaude } from './spawner.js';

interface ResolvedAgent extends DialupConfig {
  project: string;
}

export class DaemonServer {
  private server: net.Server | null = null;
  private agentRegistry = new Map<string, ResolvedAgent>();
  private conversationManager = new ConversationManager();
  private agentQueue = new AgentQueue();
  private heartbeatTracker: HeartbeatTracker;

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

    // Load persistent agent registry — registry maps name → project path,
    // config is read from each project's .dialup.config.json (single source of truth)
    const registry = await loadRegistry();
    for (const [agent, projectDir] of Object.entries(registry)) {
      const config = await loadDialupConfig(projectDir);
      if (!config) {
        console.error(`[dialup-daemon] Skipping agent '${agent}': no .dialup.config.json found at ${projectDir}`);
        continue;
      }
      this.agentRegistry.set(agent, { ...config, project: projectDir });
    }
    console.error(`[dialup-daemon] Loaded ${this.agentRegistry.size} agent(s) from registry`);

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
    let response: JsonRpcResponse;

    try {
      switch (request.method) {
        case 'dialup.listAgents':
          response = this.handleListAgents(request);
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

  private handleListAgents(request: JsonRpcRequest): JsonRpcResponse {
    const agents: AgentInfo[] = Array.from(this.agentRegistry.values()).map((r) => ({
      project: r.project,
      agent: r.agent,
      description: r.description,
    }));
    const result: ListAgentsResult = { agents };
    return buildSuccessResponse(request.id, result);
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

    // Reject execute mode if target agent hasn't whitelisted any executive tools
    // executeMode: undefined = never configured, false = explicitly disabled, [] = empty whitelist
    if (mode === 'execute' && (!targetConfig.executeMode || !Array.isArray(targetConfig.executeMode) || targetConfig.executeMode.length === 0)) {
      return buildErrorResponse(
        request.id, -32003,
        `Agent '${params.targetAgent}' does not have executeMode configured. Add "executeMode" to its .dialup.config.json to enable execution.`,
      );
    }

    const result = await this.agentQueue.enqueue<AskAgentResult>(params.targetAgent, async () => {
      // Get or create conversation session
      const sessionId = this.conversationManager.getOrCreateSession(params.senderAgent, params.targetAgent);

      // Build system prompt (mode determines oracle vs collaborator prompt)
      const executeTools = Array.isArray(targetConfig.executeMode) ? targetConfig.executeMode : undefined;
      const allTools = mode === 'execute' && executeTools?.length
        ? ['Read', 'Glob', 'Grep', ...executeTools]
        : ['Read', 'Glob', 'Grep'];
      const systemPrompt = composeSystemPrompt({
        systemPrompt: targetConfig.systemPrompt,
        mode,
        senderAgent: params.senderAgent,
        senderProject: params.senderProject,
        availableTools: allTools,
      });

      // Build message with optional conversation history
      let conversationHistory: string | undefined;
      if (params.followUp) {
        const history = this.conversationManager.formatHistoryForPrompt(sessionId);
        if (history) conversationHistory = history;
      }
      const message = composeMessage({ conversationHistory, message: params.message });

      // Spawn claude (executeMode is guaranteed to be a valid array here if mode=execute, guarded above)
      const response = await spawnClaude(targetConfig.project, systemPrompt, message, mode, executeTools);

      // Record the exchange
      await this.conversationManager.addExchange(sessionId, {
        sender: params.senderAgent,
        message: params.message,
        responder: params.targetAgent,
        response,
        timestamp: new Date().toISOString(),
      });

      return { response, sessionId };
    });

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
    console.error(`[dialup-daemon] Registered agent: ${params.agent} (${params.project})`);
    return buildSuccessResponse(request.id, { ok: true });
  }

  async shutdown(): Promise<void> {
    console.error('[dialup-daemon] Shutting down...');
    this.heartbeatTracker.stop();
    await this.conversationManager.wipeAll();

    if (this.server) {
      this.server.close();
    }

    try { await unlink(DAEMON_SOCKET_PATH); } catch { /* best effort */ }
    try { await unlink(DAEMON_PID_FILE); } catch { /* best effort */ }

    process.exit(0);
  }
}
