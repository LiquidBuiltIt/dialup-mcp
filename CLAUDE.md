# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**dialup-mcp** — an MCP-based inter-agent communication tool for Claude Code. Lets agents in different projects query agents in other projects as read-only knowledge oracles via a central daemon process.

**Primary use case**: AX (Agent Experience) optimization loops — one agent develops a product, another beta-tests it and reports friction back via dialup. They converse autonomously but no implementation happens without human approval. The agents log discussion summaries for async human review. The core walkie-talkie primitive enables this naturally.

## Architecture

Three components:

1. **MCP Server** (`src/mcp/`) — Spawned per Claude Code session. Exposes `list_agents` and `ask_agent` tools. Lazily boots the daemon if not running. Sends heartbeat pings every 30s to keep daemon alive.

2. **Daemon** (`src/daemon/`) — Singleton process. Listens on a Unix socket (`~/.dialup/daemon.sock`). Receives JSON-RPC requests from MCP servers. Spawns `claude --print --project-dir <path>` for target agents. Manages conversation state. Queues concurrent requests per target agent (one `claude --print` at a time per target). Dies after 3 minutes with no heartbeat.

3. **Setup CLI** (`src/cli/`) — Interactive wizard invoked via `npx dialup-mcp -- setup`. Discovers projects by scanning for CLAUDE.md files, prompts user to name/describe agents, drops `.dialup.config.json` configs, wires up MCP server registration.

### IPC Protocol

JSON-RPC over Unix sockets between MCP servers and daemon.

### Config File

`.dialup.config.json` in project roots:
```json
{
  "agent": "agent-name",
  "description": "What this agent/project does",
  "systemPrompt": "optional custom system prompt"
}
```

### Trust Model

Spawned agents operate under a **trust-zero** model. They are knowledge oracles — they read and reason about their codebase but refuse uncontextualized destructive actions. Agents may receive feature requests or enhancement suggestions from other agents — this is acceptable. The target agent decides whether/how to act within its own project under its own permissions. The trust boundary prevents blind remote execution, not collaboration. System prompt composition order:
1. Trust-zero framing (ours, always outermost)
2. User's `systemPrompt` from `.dialup.config.json`
3. Message with conversation history (if `followUp: true`)

### Conversation Tracking

Each `(sender, recipient)` pair gets a session UUID on first contact. History stored at `~/.dialup/conversations/{sessionUuid}.json`. Wiped when daemon dies/restarts.

## Build & Dev Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm run dev          # run in dev mode (watch)
npm run lint         # lint with eslint
npm test             # run tests
```

## Version Bumping

Use the version bump script for all releases. A message is **mandatory**.

```bash
npm run version.bump patch "fix heartbeat race condition"
npm run version.bump minor "add execute mode"
npm run version.bump major "v1 stable release"
npm run version.bump rollback   # undo last bump if not pushed
```

The script bumps `package.json`, commits as `v{version} — {message}`, and tags. Review the commit then push manually: `git push && git push --tags`.

## Conventions

- TypeScript, strict mode
- Package name: `dialup-mcp`
- Daemon socket path: `~/.dialup/daemon.sock`
- Conversation storage: `~/.dialup/conversations/`
- Config file name: `.dialup.config.json`
- Error responses from failed `claude --print` spawns are returned as clean error messages in MCP tool results, never raw stack traces
