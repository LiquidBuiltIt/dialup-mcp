# dialup-mcp

Inter-agent communication for Claude Code. Let agents in different projects talk to each other — ask questions, request changes, and collaborate across codebases via MCP.

## What It Does

dialup gives your Claude Code agents a walkie-talkie. Agent A (working on your API) can ask Agent B (working on your frontend) about its data models, request implementation changes, or coordinate across project boundaries — all through a central daemon that manages the communication.

Two modes of operation:

- **`ask_agent_readonly`** — Read-only oracle mode. The target agent reads its codebase and answers questions. Can't modify anything.
- **`ask_agent_execute`** — Collaborator mode. The target agent can read, write, and edit files in its project. Scoped by a per-project tool whitelist. Destructive operations (deletion, git commits/pushes) are blocked at the tool level.

## Architecture

```
Claude Session A → MCP Server A ──┐
                                   ├──→ Daemon (singleton, Unix socket)
Claude Session B → MCP Server B ──┘         │
                                            ├── spawns claude --print for target agent
                                            ├── manages conversation history
                                            ├── queues requests per agent
                                            └── dies after 3min with no heartbeat
```

- **MCP Server**: Per Claude Code session. Exposes `list_agents`, `ask_agent_readonly`, and `ask_agent_execute` tools. Lazily boots the daemon.
- **Daemon**: Singleton process on a Unix socket (`~/.dialup/daemon.sock`). Spawns `claude --print` for target agents, manages conversations, enforces security.
- **Config**: Each project gets a `.dialup.config.json` (single source of truth). Central registry just maps agent names to project paths.

## Setup

### Interactive (humans)

```bash
npx dialup-mcp -- setup
```

The setup wizard:
1. Scans for projects with `CLAUDE.md` files
2. Lets you select which projects to enable as agents
3. Prompts for agent name, description, and optional system prompt
4. Asks whether to enable execute mode and which tools to whitelist
5. Writes `.dialup.config.json` to each project and registers them centrally

### Programmatic (agents / CI)

```bash
npx dialup-mcp -- register \
  --project /path/to/project \
  --agent my-api \
  --description "REST API handling auth and billing" \
  --executeMode false
```

With execute mode enabled:

```bash
npx dialup-mcp -- register \
  --project . \
  --agent my-api \
  --description "REST API" \
  --executeMode Write,Edit \
  --systemPrompt "Focus on the API layer"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--project` | Yes | Path to the project directory |
| `--agent` | Yes | Agent name (unique identifier) |
| `--description` | Yes | What this agent/project does |
| `--executeMode` | Yes | `false` or comma-separated tools: `Bash,Write,Edit,NotebookEdit` |
| `--systemPrompt` | No | Custom system prompt for this agent |

### Daemon Management

```bash
npx dialup-mcp -- service start     # start the daemon
npx dialup-mcp -- service stop      # stop the daemon
npx dialup-mcp -- service restart   # restart (picks up config changes)
npx dialup-mcp -- service status    # check if daemon is running
```

### MCP Server Registration

Add the MCP server to Claude Code:

```bash
claude mcp add dialup -- npx dialup-mcp
```

## Configuration

Each enabled project gets a `.dialup.config.json` in its root:

```json
{
  "agent": "my-api",
  "description": "REST API handling auth, billing, and data layer",
  "systemPrompt": "optional custom context for this agent",
  "executeMode": false
}
```

### `executeMode`

Controls what the agent can do when contacted via `ask_agent_execute`:

```json
"executeMode": false
```
Execute mode disabled. Agent is read-only only.

```json
"executeMode": ["Write", "Edit"]
```
Agent can create and modify files when contacted in execute mode.

```json
"executeMode": ["Bash", "Write", "Edit"]
```
Agent can also run commands (tests, builds, etc). Destructive Bash commands (`rm`, `rmdir`, `git commit`, `git push`, `git reset`) are always blocked regardless of whitelist.

**Valid tools**: `Bash`, `Write`, `Edit`, `NotebookEdit`

Read-only tools (`Read`, `Glob`, `Grep`) are always available and don't need to be specified.

## Security Model

### Oracle Mode (`ask_agent_readonly`)

- Tools: `Read`, `Glob`, `Grep` only
- System prompt enforces read-only behavior
- Cannot modify files, run commands, or alter project state

### Execute Mode (`ask_agent_execute`)

- Tools: Read-only baseline + whitelisted tools from `executeMode`
- **Hard-blocked** (via `--disallowedTools`, enforced at tool level):
  - `rm`, `rmdir` — no file/directory deletion
  - `git commit`, `git push`, `git reset`, `git checkout --`, `git clean` — no git write operations
- System prompt identifies the calling agent and frames them as an **untrusted collaborator**
- Target agent independently evaluates whether requests make sense for its project
- All modifications must be documented in the response

### Trust Boundary

The calling agent is always treated as untrusted. The target agent:
- Knows who is calling (agent name + project path)
- Knows what tools it has available
- Is instructed to critically evaluate requests, not blindly comply
- Drafts changes — the human reviews and commits

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_agents` | List all registered agents with their descriptions |
| `ask_agent_readonly` | Read-only query to another agent |
| `ask_agent_execute` | Request with execution privileges (requires `executeMode` config on target) |

## Development

```bash
npm install          # install dependencies
npm run build        # compile TypeScript
npm run dev          # watch mode
npm run lint         # type check
npm test             # run tests
```

## License

Apache License 2.0 with Commons Clause — see [LICENSE](./LICENSE).
