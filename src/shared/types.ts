// --- Executive Tools ---

export const EXECUTE_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit'] as const;
export type ExecuteTool = typeof EXECUTE_TOOLS[number];

// MCP tools follow the pattern: mcp__<server>__<tool>
export const MCP_TOOL_PATTERN = /^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/;

// --- Model ---

export const AGENT_MODELS = ['default', 'haiku', 'sonnet', 'opus'] as const;
export type AgentModel = typeof AGENT_MODELS[number];

// --- Config ---

export interface DialupConfig {
  agent: string;
  description: string;
  systemPrompt?: string;
  executeMode: boolean;
  model: AgentModel;
  parallelWork?: boolean;
}

// --- Agent Capabilities ---
// Keys: "builtIn" for built-in tools, MCP server names for their tools
// Values: arrays of tool name strings

export type AgentCapabilities = Record<string, string[]>;

// --- Agent Info (returned by list_agents) ---

export interface AgentInfo {
  project: string;
  agent: string;
  description: string;
  executeEnabled: boolean;
  capabilities: AgentCapabilities;
}

// --- Discover Agents (lightweight directory) ---

export interface DiscoverAgentInfo {
  agent: string;
  description: string;
  executeEnabled: boolean;
}

export interface DiscoverAgentsParams {
  filter?: string; // Substring match against capability names
}

export interface DiscoverAgentsResult {
  agents: DiscoverAgentInfo[];
}

// --- List Agents (full capabilities for specific agents) ---

export interface ListAgentsParams {
  agents: string[]; // Agent names to query
}

// --- Conversation ---

export interface ConversationExchange {
  sender: string;
  message: string;
  responder: string;
  response: string;
  timestamp: string; // ISO 8601
}

export interface ConversationRecord {
  sessionId: string;
  sender: string;
  recipient: string;
  sessionName?: string;
  exchanges: ConversationExchange[];
}

// --- JSON-RPC ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// --- RPC Method Params/Results ---

export interface ListAgentsResult {
  agents: Record<string, {
    description: string;
    executeEnabled: boolean;
    capabilities: AgentCapabilities;
  }>;
}

export type AgentMode = 'oracle' | 'execute';

export interface AskAgentParams {
  senderAgent: string;
  senderProject: string;
  targetAgent: string;
  message: string;
  followUp?: boolean;
  mode?: AgentMode;
  files?: string[];
  tools?: string[];    // Individual tool names for execute mode
  servers?: string[];  // MCP server names — grants all tools from these servers
  sessionName?: string; // Human-readable label for this conversation (e.g. "AX feedback loop")
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AskAgentResult {
  response: string;
  sessionId: string;
  usage?: TokenUsage;
}

export interface RegisterAgentParams {
  agent: string;
  project: string;
}

// --- Daemon Status ---

export interface DaemonStatusAgent {
  agent: string;
  project: string;
  executeEnabled: boolean;
}

export interface DaemonStatusJob {
  targetAgent: string;
  startedAt: string; // ISO 8601
  runningFor: string; // human-readable duration
  sessionName?: string;
}

export interface DaemonStatusSession {
  sessionId: string;
  sender: string;
  recipient: string;
  sessionName?: string;
  exchanges: number;
}

export interface DaemonStatus {
  pid: number;
  uptime: string; // human-readable
  uptimeMs: number;
  agents: DaemonStatusAgent[];
  activeJobs: DaemonStatusJob[];
  activeProcesses: number;
  sessions: DaemonStatusSession[];
}

// --- Registry ---
// Maps agent name → project directory path
// All config is read from the project's .dialup.config.json (single source of truth)

export type AgentRegistry = Record<string, string>;
