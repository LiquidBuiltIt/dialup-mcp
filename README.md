# dialup-mcp

Inter-agent communication for Claude Code. Let agents in different projects talk to each other — ask questions, request changes, and collaborate across codebases via MCP.

## What It Does

dialup gives your Claude Code agents a walkie-talkie. Agent A (working on your API) can ask Agent B (working on your frontend) about its data models, request implementation changes, or coordinate across project boundaries — all through a central daemon that manages the communication.

Two modes of operation:

- **`ask_agent_readonly`** — Read-only oracle mode. The target agent reads its codebase and answers questions. Can't modify anything.
- **`ask_agent_execute`** — Collaborator mode. The requesting agent specifies which tools and/or MCP servers to enable per-request. Use `list_agents` to discover available capabilities first. Destructive operations (deletion, git commits/pushes) are blocked at the tool level.

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
4. Asks whether to enable execute mode (boolean gate — tool selection happens per-request)
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
  --agent workspace \
  --description "Browser automation workspace" \
  --executeMode true \
  --systemPrompt "Focus on browser automation tasks"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--project` | Yes | Path to the project directory |
| `--agent` | Yes | Agent name (unique identifier) |
| `--description` | Yes | What this agent/project does |
| `--executeMode` | Yes | `true` or `false` — enables/disables execute mode. Tool selection is dynamic per-request. |
| `--systemPrompt` | No | Custom system prompt for this agent |
| `--model` | No | Agent model: `default`, `haiku`, `sonnet`, `opus` (defaults to `haiku`) |

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

A boolean gate that controls whether the agent accepts execute-mode requests:

- **`false`** — Agent is read-only. Only `ask_agent_readonly` works.
- **`true`** — Agent accepts `ask_agent_execute` requests. The *requesting* agent specifies which tools to enable per-request (not declared upfront in config).

Tool selection is dynamic — the requesting agent discovers capabilities via `list_agents`, then passes the specific `tools` and/or `servers` it wants enabled when calling `ask_agent_execute`.

### `.mcp.json`

If a project has a `.mcp.json` file (standard MCP server config), dialup introspects those servers to discover available MCP tools. These appear in the `capabilities` field of `list_agents` responses, grouped by server name.

## Security Model

### Oracle Mode (`ask_agent_readonly`)

- Tools: `Read`, `Glob`, `Grep` only
- System prompt enforces read-only behavior
- Cannot modify files, run commands, or alter project state

### Execute Mode (`ask_agent_execute`)

- Tools: Read-only baseline + tools specified per-request via `tools` and/or `servers` params
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

### `list_agents`

List all registered agents with their descriptions and capabilities.

Response includes per-agent capability breakdown:

```json
{
  "agent": "workspace",
  "description": "Browser automation workspace",
  "project": "/path/to/workspace",
  "executeEnabled": true,
  "capabilities": {
    "builtIn": ["Bash", "Write", "Edit", "NotebookEdit"],
    "supersurf": ["mcp__supersurf__connect", "mcp__supersurf__browser_navigate", "..."]
  }
}
```

- `builtIn` — always present for execute-enabled agents (`Bash`, `Write`, `Edit`, `NotebookEdit`)
- MCP server entries — one key per server in the target's `.mcp.json`, with the full list of `mcp__<server>__<tool>` names

### `ask_agent_readonly`

Read-only query to another agent. Target can read its codebase but cannot modify anything.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes | Target agent name |
| `message` | string | Yes | Question or message |
| `followUp` | boolean | No | Include previous conversation history |
| `files` | string[] | No | File paths to send for review |

### `ask_agent_execute`

Request with execution privileges. The requesting agent specifies which tools to enable. Use `list_agents` to discover available capabilities first.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes | Target agent name |
| `message` | string | Yes | Request or instruction |
| `tools` | string[] | No | Individual tools to enable (e.g. `["Bash", "Write", "mcp__supersurf__browser_navigate"]`) |
| `servers` | string[] | No | MCP server names — grants access to all tools from those servers (e.g. `["supersurf"]`) |
| `followUp` | boolean | No | Include previous conversation history |
| `files` | string[] | No | File paths to send to the target |

At least one of `tools` or `servers` must be provided. Both can be used together — they're merged and deduplicated.

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
