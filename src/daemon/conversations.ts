import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { CONVERSATIONS_DIR } from '../shared/constants.js';
import type { ConversationExchange, ConversationRecord, DaemonStatusSession } from '../shared/types.js';

export class ConversationManager {
  private sessions = new Map<string, ConversationRecord>();
  private sessionLookup = new Map<string, string>(); // "sender:recipient" → sessionId

  get sessionCount(): number {
    return this.sessions.size;
  }

  getOrCreateSession(senderAgent: string, recipientAgent: string, sessionName?: string): string {
    const key = `${senderAgent}:${recipientAgent}`;
    const existing = this.sessionLookup.get(key);
    if (existing) {
      // Update session name if provided on a follow-up (allows renaming mid-conversation)
      if (sessionName) {
        const record = this.sessions.get(existing);
        if (record) record.sessionName = sessionName;
      }
      return existing;
    }

    const sessionId = uuidv4();
    this.sessions.set(sessionId, {
      sessionId,
      sender: senderAgent,
      recipient: recipientAgent,
      sessionName,
      exchanges: [],
    });
    this.sessionLookup.set(key, sessionId);
    return sessionId;
  }

  getSessionSummaries(): DaemonStatusSession[] {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      sender: s.sender,
      recipient: s.recipient,
      sessionName: s.sessionName,
      exchanges: s.exchanges.length,
    }));
  }

  async addExchange(sessionId: string, exchange: ConversationExchange): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.exchanges.push(exchange);
    await this.persistSession(sessionId);
  }

  getHistory(sessionId: string): ConversationExchange[] {
    return this.sessions.get(sessionId)?.exchanges ?? [];
  }

  formatHistoryForPrompt(sessionId: string): string {
    const exchanges = this.getHistory(sessionId);
    if (exchanges.length === 0) return '';

    const lines = ['--- Previous conversation ---'];
    for (const ex of exchanges) {
      lines.push(`[${ex.sender}] asked: ${ex.message}`);
      lines.push(`[${ex.responder}] replied: ${ex.response}`);
    }
    lines.push('---');
    return lines.join('\n');
  }

  async wipeAll(): Promise<void> {
    this.sessions.clear();
    this.sessionLookup.clear();
    try {
      await rm(CONVERSATIONS_DIR, { recursive: true, force: true });
    } catch {
      // Directory may not exist yet
    }
  }

  private async persistSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    await mkdir(CONVERSATIONS_DIR, { recursive: true });
    await writeFile(
      join(CONVERSATIONS_DIR, `${sessionId}.json`),
      JSON.stringify(record, null, 2),
    );
  }
}
