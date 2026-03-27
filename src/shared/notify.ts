import * as net from 'node:net';
import { DAEMON_SOCKET_PATH } from './constants.js';
import { buildRequest, serializeMessage, createMessageParser } from './protocol.js';
import type { JsonRpcResponse, JsonRpcErrorResponse } from './types.js';

export function notifyDaemon(agent: string, project: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(DAEMON_SOCKET_PATH);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timeout'));
    }, 3000);

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(err);
    });

    socket.on('connect', () => {
      const msg = buildRequest('dialup.registerAgent', { agent, project }, 1);
      socket.write(serializeMessage(msg));

      const parser = createMessageParser((raw) => {
        clearTimeout(timeout);
        const response = raw as JsonRpcResponse;
        if ('error' in response) {
          const errResp = response as JsonRpcErrorResponse;
          reject(new Error(errResp.error.message));
        } else {
          resolve();
        }
        socket.destroy();
      });

      socket.on('data', parser);
    });
  });
}
