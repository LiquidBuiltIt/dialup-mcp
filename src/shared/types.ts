// --- Executive Tools ---

export const EXECUTE_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit'] as const;
export type ExecuteTool = typeof EXECUTE_TOOLS[number];

// --- Config ---

export interface DialupConfig {
  agent: string;
  description: string;
  systemPrompt?: string;
  executeMode: false | ExecuteTool[];
}

// --- Agent Info (returned by list_agents) ---

export interface AgentInfo {
  project: string;
  agent: string;
  description: string;
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
  agents: AgentInfo[];
}

export type AgentMode = 'oracle' | 'execute';

export interface AskAgentParams {
  senderAgent: string;
  senderProject: string;
  targetAgent: string;
  message: string;
  followUp?: boolean;
  mode?: AgentMode;
}

export interface AskAgentResult {
  response: string;
  sessionId: string;
}

export interface RegisterAgentParams {
  agent: string;
  project: string;
}

// --- Registry ---
// Maps agent name → project directory path
// All config is read from the project's .dialup.config.json (single source of truth)

export type AgentRegistry = Record<string, string>;
