import type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse } from './types.js';

let requestIdCounter = 0;

export function buildRequest(method: string, params: Record<string, unknown>, id?: string | number): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: id ?? ++requestIdCounter,
    method,
    params,
  };
}

export function buildSuccessResponse(id: string | number, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function buildErrorResponse(id: string | number, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

export function serializeMessage(msg: JsonRpcRequest | JsonRpcResponse): string {
  return JSON.stringify(msg) + '\n';
}

export function createMessageParser(
  onMessage: (msg: JsonRpcRequest | JsonRpcResponse) => void,
): (chunk: Buffer) => void {
  let buffer = '';

  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        onMessage(parsed);
      } catch {
        console.error('[dialup-protocol] Failed to parse message:', trimmed.slice(0, 100));
      }
    }
  };
}
